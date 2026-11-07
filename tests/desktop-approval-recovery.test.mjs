import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopApprovalResult} from '../runtime/desktop-approval-state.mjs';
const operation={id:'grant-fixture',kind:'desktop-full-access',tool:'y_desktop_bind',contextHash:'original'};
const ledger={fullAccess:hash=>hash==='original'?{operation_id:operation.id,expires:Date.now()+6000000}:null};
const stale={isError:true,structuredContent:{state:'failed',executed:false,code:'DESKTOP_TARGET_STALE',error:{code:'DESKTOP_TARGET_STALE',outcomeUnknown:false,nativeCode:'NO_WINDOW'}},content:[]};

test('Stale consent binding returns fresh inventory and a successful grant without choosing or executing a target',async()=>{
 let reads=0;const windows=[{hwnd:'new-window',pid:100,birth:'fixture',title:'Fixture only'}];
 const result=await desktopApprovalResult(ledger,operation,stale,async()=>{reads++;return {windows};});
 assert.equal(result.isError,false);const v=result.structuredContent;
 assert.equal(reads,1);assert.equal(v.state,'succeeded');assert.equal(v.executed,false);assert.equal(v.bindingRequired,true);assert.equal(v.desktopStep.code,'DESKTOP_TARGET_STALE');assert.equal(v.error,undefined);
 assert.deepEqual(v.recovery.inventory.windows,windows);assert.equal(v.nextAction.tool,'y_desktop_bind');assert.equal(v.nextAction.requiresNewApproval,false);assert.equal(v.targetId,undefined);assert.equal(v.nextAction.arguments,undefined);
 assert.equal(stale.isError,true);assert.equal(stale.structuredContent.error.code,'DESKTOP_TARGET_STALE','Original response is not mutated');
});

test('Unavailable inventory preserves the grant and gives an explicit read-only next step',async()=>{
 const result=await desktopApprovalResult(ledger,operation,stale,async()=>{throw Object.assign(Error('fixture'),{code:'UIA_TIMEOUT'});});
 assert.equal(result.isError,false);assert.equal(result.structuredContent.desktopAccess.active,true);assert.equal(result.structuredContent.nextAction.tool,'y_desktop_windows');assert.equal(result.structuredContent.recovery.inventoryError.code,'UIA_TIMEOUT');
});

test('A window closing during the read-only bind itself also preserves permission without claiming a target',async()=>{
 const response={isError:true,structuredContent:{ok:false,error:{code:'NO_WINDOW',message:'Choose one current window'}},content:[]};
 const result=await desktopApprovalResult(ledger,operation,response,async()=>({windows:[]}));
 assert.equal(result.isError,false);assert.equal(result.structuredContent.executed,false);assert.equal(result.structuredContent.bindingRequired,true);assert.equal(result.structuredContent.desktopStep.code,'NO_WINDOW');assert.equal(result.structuredContent.nextAction.tool,'y_desktop_windows');
});

test('Stale inputs, uncertain bindings, inactive grants and foreign contexts are never converted into successful bindings',async()=>{
 for(const [op,response] of [[{...operation,tool:'y_desktop_action'},stale],[operation,{...stale,structuredContent:{...stale.structuredContent,executed:null,error:{...stale.structuredContent.error,outcomeUnknown:true}}}],[{...operation,id:'other-grant'},stale],[{...operation,contextHash:'other-chat'},stale],[{...operation,kind:'ordinary'},stale]]){
  const result=await desktopApprovalResult(ledger,op,response,async()=>({windows:[]}));assert.equal(result.isError,true);assert.equal(result.structuredContent.bindingRequired,undefined);
 }
});
