import {spawn} from 'node:child_process';

// The Watchdog deliberately lets durable engine jobs outlive its transport.
// An IPC lease distinguishes Tunnel children: an abrupt coordinator exit must
// terminate them, even when Windows does not deliver a process signal.
if(!process.send)throw Error('Tunnel worker requires an owner IPC lease');
const child=spawn(process.argv[2],process.argv.slice(3),{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['ignore','inherit','inherit']});
let stopping=false;
function stop(){if(stopping)return;stopping=true;if(child.exitCode===null)child.kill();}
process.on('disconnect',stop);
process.on('message',message=>{if(message?.action==='stop')stop();});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.once('error',()=>{process.stderr.write('TUNNEL_START_FAILED\n');process.exitCode=1;if(process.connected)process.disconnect();});
child.once('exit',(code)=>{process.exitCode=stopping?0:code??1;if(process.connected)process.disconnect();});
