"""Single-owner Windows durable jobs. Control requests arrive on stdin, not argv."""
import ctypes
from ctypes import wintypes as wt
import datetime as dt
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from secure_store import seal, unseal

ROOT=Path(os.environ['YGPT_STATE_DIR'])/'jobs'
OWNER=os.environ.get('YGPT_INGRESS_ID','private-stdio-owner')
MAX_LOG=2*1024*1024
MAX_STORAGE=32*1024*1024

def now():return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds')

def db():
    ROOT.mkdir(parents=True,exist_ok=True)
    cx=sqlite3.connect(str(ROOT/'jobs-rc.sqlite3'),timeout=10)
    cx.row_factory=sqlite3.Row
    cx.executescript('''PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,command TEXT NOT NULL,cwd TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT,started_at TEXT,ended_at TEXT,worker_pid INTEGER,worker_identity TEXT,child_pid INTEGER,exit_code INTEGER,cancel_requested INTEGER DEFAULT 0,reason TEXT,timeout_seconds INTEGER,log_bytes INTEGER DEFAULT 0);''')
    return cx

kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.OpenProcess.argtypes=[wt.DWORD,wt.BOOL,wt.DWORD];kernel.OpenProcess.restype=wt.HANDLE
kernel.CloseHandle.argtypes=[wt.HANDLE];kernel.CloseHandle.restype=wt.BOOL
kernel.GetProcessTimes.argtypes=[wt.HANDLE,ctypes.POINTER(wt.FILETIME),ctypes.POINTER(wt.FILETIME),ctypes.POINTER(wt.FILETIME),ctypes.POINTER(wt.FILETIME)];kernel.GetProcessTimes.restype=wt.BOOL

def process_identity(pid):
    h=kernel.OpenProcess(0x1000,False,int(pid or 0))
    if not h:return None
    try:
        times=[wt.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(h,*[ctypes.byref(x) for x in times]):return None
        return str((times[0].dwHighDateTime<<32)|times[0].dwLowDateTime)
    finally:kernel.CloseHandle(h)

class BasicLimit(ctypes.Structure):
    _fields_=[('user',ctypes.c_longlong),('job',ctypes.c_longlong),('flags',wt.DWORD),('min',ctypes.c_size_t),('max',ctypes.c_size_t),('active',wt.DWORD),('affinity',ctypes.c_size_t),('priority',wt.DWORD),('scheduling',wt.DWORD)]
class IOCounters(ctypes.Structure):
    _fields_=[(n,ctypes.c_ulonglong) for n in ['readops','writeops','otherops','readbytes','writebytes','otherbytes']]
class ExtendedLimit(ctypes.Structure):
    _fields_=[('basic',BasicLimit),('io',IOCounters),('processmemory',ctypes.c_size_t),('jobmemory',ctypes.c_size_t),('peakprocess',ctypes.c_size_t),('peakjob',ctypes.c_size_t)]

class JobObject:
    def __init__(self):
        kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,wt.LPCWSTR];kernel.CreateJobObjectW.restype=wt.HANDLE
        kernel.SetInformationJobObject.argtypes=[wt.HANDLE,ctypes.c_int,ctypes.c_void_p,wt.DWORD];kernel.SetInformationJobObject.restype=wt.BOOL
        kernel.AssignProcessToJobObject.argtypes=[wt.HANDLE,wt.HANDLE];kernel.AssignProcessToJobObject.restype=wt.BOOL
        kernel.TerminateJobObject.argtypes=[wt.HANDLE,wt.UINT];kernel.TerminateJobObject.restype=wt.BOOL
        self.handle=kernel.CreateJobObjectW(None,None)
        if not self.handle:raise ctypes.WinError(ctypes.get_last_error())
        limits=ExtendedLimit();limits.basic.flags=0x2000  # KILL_ON_JOB_CLOSE
        if not kernel.SetInformationJobObject(self.handle,9,ctypes.byref(limits),ctypes.sizeof(limits)):raise ctypes.WinError(ctypes.get_last_error())
    def assign(self,child):
        if not kernel.AssignProcessToJobObject(self.handle,wt.HANDLE(int(child._handle))):raise ctypes.WinError(ctypes.get_last_error())
    def terminate(self):
        if not kernel.TerminateJobObject(self.handle,125):raise ctypes.WinError(ctypes.get_last_error())
    def close(self):
        if self.handle:kernel.CloseHandle(self.handle);self.handle=None

def one(cx,id):
    r=cx.execute('SELECT * FROM jobs WHERE owner=? AND id=?',(OWNER,id)).fetchone()
    if r is None:raise ValueError('Job not found for this private owner')
    return dict(r)

def inspect(cx,id):
    r=one(cx,id)
    identity=process_identity(r['worker_pid']) if r['worker_pid'] else None
    stale=(r['worker_identity'] and identity!=r['worker_identity'])
    queued_orphan=(not r['worker_pid'] and (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(r['created_at'])).total_seconds()>30)
    if r['state'] in ('queued','running') and (stale or queued_orphan):
        cx.execute("UPDATE jobs SET state='unknown',ended_at=?,reason='worker-exited-or-identity-changed' WHERE owner=? AND id=? AND state IN ('queued','running')",(now(),OWNER,id));cx.commit();r=one(cx,id)
    return r

def public(r):return {k:v for k,v in r.items() if k not in ['command','owner','worker_identity']}

def prune(cx):
    cutoff=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=14)).isoformat()
    for r in cx.execute("SELECT id FROM jobs WHERE owner=? AND ended_at<? AND state IN ('succeeded','failed','cancelled')",(OWNER,cutoff)).fetchall():
        (ROOT/(r['id']+'.dpapi-log')).unlink(missing_ok=True)
        cx.execute('DELETE FROM jobs WHERE owner=? AND id=?',(OWNER,r['id']))
    cx.commit()

def submit(cx,request):
    cwd=Path(request['cwd']).resolve(strict=True)
    allowed=[Path(p).resolve() for p in json.loads(os.environ['YGPT_PROJECT_ROOTS'])]
    if not cwd.is_dir() or not any(cwd==r or r in cwd.parents for r in allowed):raise ValueError('Job cwd outside owner-configured project roots')
    argv=request['argv']
    if not argv or not all(isinstance(s,str) and '\x00' not in s and '\n' not in s and '\r' not in s for s in argv):raise ValueError('Invalid argv')
    # Require an actual executable path; no CWD/PATH substitution, .cmd or shell guessing.
    exe=Path(argv[0])
    if not exe.is_absolute() or not exe.is_file() or exe.suffix.lower() not in ('.exe','.com'):raise ValueError('argv[0] must be an absolute Windows executable; call scripts through the explicit interpreter')
    job_id=str(uuid.UUID(request['id']))
    cx.execute('BEGIN IMMEDIATE')
    prev=cx.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
    if prev:
        if prev['owner']!=OWNER or unseal(prev['command'])!=json.dumps(argv) or prev['cwd']!=str(cwd):raise ValueError('Job idempotency collision')
        cx.rollback();return {'job_id':job_id,'state':prev['state'],'reused':True}
    for r in cx.execute("SELECT id FROM jobs WHERE owner=? AND state IN ('queued','running')",(OWNER,)).fetchall():inspect(cx,r['id'])
    # inspect may commit; acquire again for atomic concurrency counting/reservation.
    if not cx.in_transaction:cx.execute('BEGIN IMMEDIATE')
    if cx.execute("SELECT count(*) FROM jobs WHERE owner=? AND state IN ('queued','running')",(OWNER,)).fetchone()[0]>=2:raise ValueError('Two concurrent jobs already active')
    if sum(p.stat().st_size for p in ROOT.glob('*.dpapi-log'))>=MAX_STORAGE:raise ValueError('32 MiB retained job log quota reached; review/purge completed jobs')
    timeout=int(request.get('timeoutSeconds',21600))
    if not 1<=timeout<=86400:raise ValueError('Job timeout out of bounds')
    cx.execute('INSERT INTO jobs(id,owner,command,cwd,state,created_at,timeout_seconds) VALUES(?,?,?,?,?,?,?)',(job_id,OWNER,seal(json.dumps(argv)),str(cwd),'queued',now(),timeout));cx.commit()
    kw={'stdin':subprocess.DEVNULL,'stdout':subprocess.DEVNULL,'stderr':subprocess.DEVNULL,'close_fds':True,'creationflags':subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP}
    try:
        p=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'__worker',job_id],**kw)
        cx.execute("UPDATE jobs SET worker_pid=?,worker_identity=? WHERE owner=? AND id=? AND state='queued'",(p.pid,process_identity(p.pid),OWNER,job_id));cx.commit()
    except Exception:
        cx.execute("UPDATE jobs SET state='failed',reason='worker-launch-failed',ended_at=? WHERE owner=? AND id=?",(now(),OWNER,job_id));cx.commit();raise
    return {'job_id':job_id,'state':'queued'}

def worker(id):
    cx=db();cx.execute('BEGIN IMMEDIATE');row=one(cx,id)
    if row['state']!='queued':cx.rollback();return
    if row['cancel_requested']:
        cx.execute("UPDATE jobs SET state='cancelled',ended_at=? WHERE id=?",(now(),id));cx.commit();return
    cx.execute("UPDATE jobs SET state='running',started_at=?,worker_pid=?,worker_identity=? WHERE owner=? AND id=? AND state='queued'",(now(),os.getpid(),process_identity(os.getpid()),OWNER,id));cx.commit()
    child=None;job=None;code=None;reason=None;written=0;errors=[]
    try:
        job=JobObject()
        child=subprocess.Popen(json.loads(unseal(row['command'])),cwd=row['cwd'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,shell=False,close_fds=True,creationflags=subprocess.CREATE_NO_WINDOW)
        job.assign(child)
        cx.execute('UPDATE jobs SET child_pid=? WHERE id=?',(child.pid,id));cx.commit()
        log=ROOT/(id+'.dpapi-log')
        def drain():
            nonlocal written
            try:
                with log.open('ab',buffering=0) as stream:
                    while True:
                        data=os.read(child.stdout.fileno(),8192)
                        if not data:break
                        remaining=MAX_LOG-written
                        if remaining>0:
                            selected=data[:remaining];written+=len(selected)
                            stream.write(seal(selected.decode('utf-8',errors='replace')).encode('ascii')+b'\n')
            except Exception as e:errors.append(type(e).__name__)
        thread=threading.Thread(target=drain,daemon=True);thread.start();started=time.monotonic()
        while child.poll() is None:
            if cx.execute('SELECT cancel_requested FROM jobs WHERE id=?',(id,)).fetchone()[0]:reason='user-cancelled';job.terminate();break
            if time.monotonic()-started>row['timeout_seconds']:reason='deadline-exceeded';job.terminate();break
            time.sleep(.2)
        code=child.wait(timeout=10)
        job.close();job=None;thread.join(timeout=3)
        if thread.is_alive() or errors:reason='log-drain-incomplete'
    except Exception as exc:
        reason='worker-error:'+type(exc).__name__
        if child and child.poll() is None:child.kill()
    finally:
        if job:job.close()
    final='cancelled' if reason=='user-cancelled' else ('succeeded' if code==0 and reason is None else 'failed')
    cx.execute('UPDATE jobs SET state=?,ended_at=?,exit_code=?,reason=?,log_bytes=? WHERE owner=? AND id=? AND state=\'running\'',(final,now(),code,reason,written,OWNER,id));cx.commit()

def control(r):
    action=r['action']
    if action=='identity':return {'identity':process_identity(int(r['pid']))}
    cx=db();prune(cx)
    if action=='submit':return submit(cx,r)
    if action=='list':return [public(inspect(cx,x['id'])) for x in cx.execute('SELECT id FROM jobs WHERE owner=? ORDER BY created_at DESC LIMIT ?',(OWNER,max(1,min(100,int(r.get('limit',20)))))).fetchall()]
    id=str(uuid.UUID(r['id']));item=inspect(cx,id)
    if action=='status':return public(item)
    if action=='cancel':
        cx.execute("UPDATE jobs SET cancel_requested=1 WHERE owner=? AND id=? AND state IN ('queued','running')",(OWNER,id));cx.commit();return {'id':id,'cancel_requested':True,'state':item['state']}
    if action=='tail':
        log=ROOT/(id+'.dpapi-log');tail=''
        if log.exists():
            with log.open('rb') as f:
                for line in f:
                    if len(line)>32768:raise ValueError('Corrupt encrypted log frame')
                    try:tail=(tail+unseal(line.decode('ascii').strip()))[-65536:]
                    except (ValueError,OSError):continue  # ignore a partial final frame while writer is active
        lines=tail.splitlines()[-max(1,min(100,int(r.get('lines',30)))):]
        return {'id':id,'text':'\n'.join(lines),'state':item['state'],'truncated':item['log_bytes']>=MAX_LOG}
    raise ValueError('Unknown action')

if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='__worker':worker(str(uuid.UUID(sys.argv[2])))
    else:
        try:print(json.dumps(control(json.load(sys.stdin)),ensure_ascii=False))
        except Exception as exc:
            print(json.dumps({'error':type(exc).__name__+': '+str(exc)},ensure_ascii=False));sys.exit(1)
