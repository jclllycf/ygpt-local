import {nativeWindows} from './windows-native.mjs';

// A sibling of each exact state root, never a shared system TEMP or another
// account's configured home. Do not load keys, approvals or jobs from here.
export function executionTemp(stateDir){
 return nativeWindows('execution-temp',{root:stateDir}).path;
}

export function executionHome(stateDir,kind){
 return nativeWindows('execution-home',{root:stateDir,kind}).path;
}
