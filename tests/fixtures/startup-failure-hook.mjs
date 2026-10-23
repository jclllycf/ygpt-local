// Exercise the real bootstrap/import/audit failure path without Windows APIs.
import {registerHooks} from 'node:module';
const config=new URL('./policy-config-stub.mjs',import.meta.url).href;
registerHooks({
  resolve(specifier,context,next){const result=next(specifier,context);return result.url.endsWith('/runtime/config.mjs')?{url:config,shortCircuit:true}:result;},
  load(url,context,next){
    if(url.endsWith('/runtime/windows-native.mjs'))return {format:'module',shortCircuit:true,source:`export function nativeWindows(){throw Object.assign(Error('Native Windows check failed: STATE_LINK_REFUSED at D:\\\\YGPT state\\\\link -> D:\\\\wrong; Bearer private-fixture-secret'),{code:'STATE_LINK_REFUSED',path:'D:\\\\YGPT state\\\\link',target:'\\\\??\\\\D:\\\\wrong'});}`};
    return next(url,context);
  }
});
