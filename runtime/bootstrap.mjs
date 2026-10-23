import {recordStartupFailure} from './startup-diagnostics.mjs';
try{await import('./enhanced-server.mjs');}
catch(e){recordStartupFailure(e);process.exitCode=1;}
