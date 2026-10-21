import {nativeWindows} from '../../runtime/windows-native.mjs';
export async function protectState(stateDir,{verifyOnly=false}={}){
  return nativeWindows(verifyOnly?'state-verify':'state-prepare',{root:stateDir},20000);
}
