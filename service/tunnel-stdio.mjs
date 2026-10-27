import {proxyConnection} from './connection-router.mjs';
try{await proxyConnection({pipe:process.env.YGPT_CONNECTION_PIPE,key:process.env.YGPT_CONNECTION_KEY,connectionId:process.env.YGPT_CONNECTION_ID});}
catch{process.stderr.write('YGPT local connection unavailable; no operation was replayed.\n');process.exitCode=1;}
