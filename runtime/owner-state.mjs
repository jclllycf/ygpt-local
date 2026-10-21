// Active runtime state for owner opt-out of ALL human-approval interfaces.
// Intentionally does not import HTTP portals, WPF panel, MCP-App review UI,
// or code that can create awaiting_user operations.
import path from 'node:path';
import {config} from './config.mjs';
import {prepareState,acquireLease} from './secure-state.mjs';
import {DurableLedger} from './durable.mjs';

export const acl=prepareState();
export const releaseLease=acquireLease();
export const ledger=new DurableLedger(path.join(config.stateDir,'operations-rc.sqlite3'),{owner:config.ingressId});
export const closePanel=()=>{};
export const portal=()=> 'disabled';
export const pending=()=>[];
export const lookup=()=>{throw Error('Human approval queue is disabled in this runtime');};
export const launchPortal=async()=>{throw Error('Human approval portal is disabled in this runtime');};
