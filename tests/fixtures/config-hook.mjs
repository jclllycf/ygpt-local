// Module hook: redirect every import of runtime/config.mjs to the
// Windows-shaped stub so the access policy can be unit-tested on any host.
const stub=new URL('./policy-config-stub.mjs',import.meta.url).href;
export async function resolve(specifier,context,next){
  const resolved=await next(specifier,context);
  if(resolved.url.endsWith('/runtime/config.mjs'))return {url:stub,shortCircuit:true};
  return resolved;
}
