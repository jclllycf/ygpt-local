"""Windows CurrentUser DPAPI only. No credential arguments or plaintext files."""
import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sys

class Blob(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]

def crypt(data, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('Windows DPAPI is required; no plaintext fallback')
    data=bytes(data)
    buf=ctypes.create_string_buffer(data)
    src=Blob(len(data),ctypes.cast(buf,ctypes.POINTER(ctypes.c_ubyte)))
    dst=Blob()
    dll=ctypes.WinDLL('crypt32',use_last_error=True)
    fun=dll.CryptUnprotectData if decrypt else dll.CryptProtectData
    fun.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    fun.restype=wintypes.BOOL
    if not fun(ctypes.byref(src),None,None,None,None,1,ctypes.byref(dst)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(dst.data,dst.size)
    finally:
        localfree=ctypes.WinDLL('kernel32').LocalFree
        localfree.argtypes=[ctypes.c_void_p]
        localfree.restype=ctypes.c_void_p
        localfree(dst.data)

def seal(value):
    return 'dpapi:'+base64.b64encode(crypt(value.encode('utf-8'))).decode('ascii')

def unseal(value):
    if not value.startswith('dpapi:'):
        raise ValueError('Unencrypted legacy state rejected; keep it in historical staging')
    return crypt(base64.b64decode(value[6:]),True).decode('utf-8')

if __name__=='__main__':
    request=json.load(sys.stdin)
    if request['action']=='key':
        p=Path(request['root'])/'data-key.dpapi'
        if not p.exists():
            key=os.urandom(32)
            with p.open('xb') as f:
                f.write(crypt(key))
        else:
            key=crypt(p.read_bytes(),True)
        print(base64.b64encode(key).decode('ascii'))
    elif request['action']=='protect':
        sys.stdout.write(seal(request['value']))
    elif request['action']=='unprotect':
        sys.stdout.write(unseal(request['value']))
    else:
        raise ValueError('Unsupported secure-store action')
