// All public generation entrypoints use the owner's board-derived HD master.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
execFileSync(process.env.YGPT_ICON_PYTHON??'python3',[fileURLToPath(new URL('./make-icons-from-original.py',import.meta.url))],{stdio:'inherit'});
