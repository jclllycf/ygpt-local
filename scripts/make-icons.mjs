// Rasterizes assets/icon.svg into assets/png/icon-<size>.png and a multi-resolution assets/ygpt.ico.
// Dependency-free: supports only the SVG subset the mark uses (rect with rx, polygon, circle, round-capped line,
// path with M/L/H/V/C/S/Q/Z either filled (even-odd) or stroked with round caps and joins,
// userSpaceOnUse linear/radial gradients with stop-opacity, solid fills, opacity), painted in source order with source-over blending.
// Run from the repo root: node scripts/make-icons.mjs
// Small-size hinting: data-min-size="N" omits an element below N px; data-max-size="N" omits it above N px,
// so a mark can carry a heavier small-size cut next to its full-size drawing. The display attribute is not read: a
// small-size cut can carry display="none" so browsers show only the full-size drawing.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const SIZES=[16,24,32,48,64,128,256],SS=8,src=fs.readFileSync('assets/icon.svg','utf8');
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
const hex=h=>{const v=h.replace('#','');return [0,2,4].map(i=>parseInt(v.slice(i,i+2),16));};
const view=attrs(/<svg\b([^>]*)>/.exec(src)[1]).viewBox.split(/\s+/).map(Number),W=view[2];
const gradients={};for(const m of src.matchAll(/<(linear|radial)Gradient\b([^>]*)>([\s\S]*?)<\/\1Gradient>/g)){const a=attrs(m[2]);gradients[a.id]={radial:m[1]==='radial',x1:+a.x1,y1:+a.y1,x2:+a.x2,y2:+a.y2,cx:+a.cx,cy:+a.cy,r:+a.r,stops:[...m[3].matchAll(/<stop\b([^>]*)\/>/g)].map(s=>{const b=attrs(s[1]);return {offset:+b.offset,color:[...hex(b['stop-color']),+(b['stop-opacity']??1)]};})};}
// Path data -> flattened subpaths. Curves use a fixed number of segments, so output stays deterministic.
function flatten(d){const out=[],tok=d.match(/[MLHVCSQZmlhvcsqz]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g);let i=0,cmd='',x=0,y=0,sx=0,sy=0,cx=0,cy=0,cur=null;const n=()=>+tok[i++],N=24;
 const to=(px,py)=>{cur.push([px,py]);x=px;y=py;};
 while(i<tok.length){if(/[a-z]/i.test(tok[i]))cmd=tok[i++];const rel=cmd===cmd.toLowerCase(),C=cmd.toUpperCase(),ox=rel?x:0,oy=rel?y:0;
  if(C==='M'){cur=[];out.push(cur);to(ox+n(),oy+n());sx=x;sy=y;cmd=rel?'l':'L';cx=x;cy=y;}
  else if(C==='L'){to(ox+n(),oy+n());cx=x;cy=y;}else if(C==='H'){to(ox+n(),y);cx=x;cy=y;}else if(C==='V'){to(x,oy+n());cx=x;cy=y;}
  else if(C==='C'||C==='S'){const x0=x,y0=y;let x1,y1;if(C==='C'){x1=ox+n();y1=oy+n();}else{x1=2*x-cx;y1=2*y-cy;}const x2=ox+n(),y2=oy+n(),x3=ox+n(),y3=oy+n();
   for(let k=1;k<=N;k++){const t=k/N,u=1-t;to(u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3);}cx=x2;cy=y2;}
  else if(C==='Q'){const x0=x,y0=y,x1=ox+n(),y1=oy+n(),x2=ox+n(),y2=oy+n();for(let k=1;k<=N;k++){const t=k/N,u=1-t;to(u*u*x0+2*u*t*x1+t*t*x2,u*u*y0+2*u*t*y1+t*t*y2);}cx=x1;cy=y1;}
  else if(C==='Z'){to(sx,sy);cur.closed=true;cx=x;cy=y;}else throw Error('Unsupported path command '+cmd);}
 return out;}
const shapes=[];for(const m of src.matchAll(/<(rect|polygon|circle|line|path)\b([^>]*)\/>/g)){const a=attrs(m[2]),s={kind:m[1],fill:a.fill&&a.fill!=='none'?a.fill:a.stroke,alpha:+(a.opacity??1),min:+(a['data-min-size']??0),max:+(a['data-max-size']??Infinity)};
 if(s.kind==='rect')Object.assign(s,{x:+a.x,y:+a.y,w:+a.width,h:+a.height,r:+(a.rx??0)});else if(s.kind==='circle')Object.assign(s,{cx:+a.cx,cy:+a.cy,r:+a.r});
 else if(s.kind==='line')Object.assign(s,{x1:+a.x1,y1:+a.y1,x2:+a.x2,y2:+a.y2,r:+a['stroke-width']/2});
 else if(s.kind==='path'){const subs=flatten(a.d),stroked=!a.fill||a.fill==='none',r=stroked?+a['stroke-width']/2:0,xs=subs.flat().map(p=>p[0]),ys=subs.flat().map(p=>p[1]);
  Object.assign(s,{subs,stroked,r,bx0:Math.min(...xs)-r,by0:Math.min(...ys)-r,bx1:Math.max(...xs)+r,by1:Math.max(...ys)+r});}
 else s.pts=a.points.trim().split(/\s+/).map(p=>p.split(',').map(Number));shapes.push(s);}
const nearSegment=(x,y,x1,y1,x2,y2,r)=>{const dx=x2-x1,dy=y2-y1,l=dx*dx+dy*dy,t=l?Math.min(1,Math.max(0,((x-x1)*dx+(y-y1)*dy)/l)):0;return (x-x1-t*dx)**2+(y-y1-t*dy)**2<=r*r;};
function inside(s,x,y){
 if(s.kind==='rect'){if(x<s.x||y<s.y||x>s.x+s.w||y>s.y+s.h)return false;const cx=Math.min(Math.max(x,s.x+s.r),s.x+s.w-s.r),cy=Math.min(Math.max(y,s.y+s.r),s.y+s.h-s.r);return (x-cx)**2+(y-cy)**2<=s.r*s.r;}
 if(s.kind==='circle')return (x-s.cx)**2+(y-s.cy)**2<=s.r*s.r;
 if(s.kind==='line'){const dx=s.x2-s.x1,dy=s.y2-s.y1,t=Math.min(1,Math.max(0,((x-s.x1)*dx+(y-s.y1)*dy)/(dx*dx+dy*dy)));return (x-s.x1-t*dx)**2+(y-s.y1-t*dy)**2<=s.r*s.r;}// stroke-linecap="round" only
 if(s.kind==='path'){if(x<s.bx0||y<s.by0||x>s.bx1||y>s.by1)return false;
  if(s.stroked){for(const p of s.subs)for(let i=1;i<p.length;i++)if(nearSegment(x,y,p[i-1][0],p[i-1][1],p[i][0],p[i][1],s.r))return true;return false;}// round caps and joins only
  let c=false;for(const p of s.subs)for(let i=0,j=p.length-1;i<p.length;j=i++){const [xi,yi]=p[i],[xj,yj]=p[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}// even-odd fill
 let c=false;for(let i=0,j=s.pts.length-1;i<s.pts.length;j=i++){const [xi,yi]=s.pts[i],[xj,yj]=s.pts[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
function paint(fill,x,y){const g=/^url\(#(.+)\)$/.exec(fill);if(!g)return [...hex(fill),1];const d=gradients[g[1]];let t;
 if(d.radial)t=Math.min(1,Math.hypot(x-d.cx,y-d.cy)/d.r);else{const dx=d.x2-d.x1,dy=d.y2-d.y1;t=Math.min(1,Math.max(0,((x-d.x1)*dx+(y-d.y1)*dy)/(dx*dx+dy*dy)));}
 let a=d.stops[0],b=d.stops.at(-1);for(let i=1;i<d.stops.length;i++)if(t<=d.stops[i].offset){a=d.stops[i-1];b=d.stops[i];break;}const u=b.offset>a.offset?Math.min(1,Math.max(0,(t-a.offset)/(b.offset-a.offset))):0;return a.color.map((v,i)=>v+(b.color[i]-v)*u);}
function render(size){const k=W/size,out=Buffer.alloc(size*size*4),active=shapes.filter(s=>size>=s.min&&size<=s.max);
 for(let py=0;py<size;py++)for(let px=0;px<size;px++){let r=0,g=0,b=0,a=0;// per subsample: source-over in document order (premultiplied), then box-filtered
  for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++){const x=(px+(sx+.5)/SS)*k,y=(py+(sy+.5)/SS)*k;let cr=0,cg=0,cb=0,ca=0;for(const s of active)if(inside(s,x,y)){const c=paint(s.fill,x,y),o=c[3]*s.alpha;cr=c[0]*o+cr*(1-o);cg=c[1]*o+cg*(1-o);cb=c[2]*o+cb*(1-o);ca=o+ca*(1-o);}r+=cr;g+=cg;b+=cb;a+=ca;}
  const o=(py*size+px)*4;if(a){out[o]=Math.round(r/a);out[o+1]=Math.round(g/a);out[o+2]=Math.round(b/a);out[o+3]=Math.round(255*a/(SS*SS));}}
 return out;}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
const crc=b=>{let c=0xFFFFFFFF;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum]);};
function png(rgba,size){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;const raw=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++)rgba.copy(raw,y*(size*4+1)+1,y*size*4,(y+1)*size*4);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
// Classic 32bpp DIB entry (BGRA bottom-up + empty AND mask) for sizes below 256 so every Win32/System.Drawing consumer can read it; PNG for 256.
function dib(rgba,size){const head=Buffer.alloc(40);head.writeUInt32LE(40,0);head.writeInt32LE(size,4);head.writeInt32LE(size*2,8);head.writeUInt16LE(1,12);head.writeUInt16LE(32,14);head.writeUInt32LE(size*size*4,20);
 const px=Buffer.alloc(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const s=(y*size+x)*4,d=((size-1-y)*size+x)*4;px[d]=rgba[s+2];px[d+1]=rgba[s+1];px[d+2]=rgba[s];px[d+3]=rgba[s+3];}
 return Buffer.concat([head,px,Buffer.alloc(Math.ceil(size/32)*4*size)]);}
fs.mkdirSync('assets/png',{recursive:true});const entries=[];
for(const size of SIZES){const rgba=render(size),p=png(rgba,size);fs.writeFileSync(path.join('assets/png','icon-'+size+'.png'),p);entries.push({size,data:size>=256?p:dib(rgba,size)});}
const dir=Buffer.alloc(6+16*entries.length);dir.writeUInt16LE(1,2);dir.writeUInt16LE(entries.length,4);let offset=dir.length;
entries.forEach((e,i)=>{const o=6+16*i;dir[o]=e.size>=256?0:e.size;dir[o+1]=e.size>=256?0:e.size;dir.writeUInt16LE(1,o+4);dir.writeUInt16LE(32,o+6);dir.writeUInt32LE(e.data.length,o+8);dir.writeUInt32LE(offset,o+12);offset+=e.data.length;});
fs.writeFileSync('assets/ygpt.ico',Buffer.concat([dir,...entries.map(e=>e.data)]));
// Plugin logo: 512 px so ChatGPT/marketplace surfaces stay crisp on high-DPI displays.
fs.mkdirSync('plugin/assets',{recursive:true});fs.writeFileSync('plugin/assets/logo.png',png(render(512),512));
console.log('Icons generated from assets/icon.svg: '+SIZES.join('/')+' px PNG, assets/ygpt.ico, plugin/assets/logo.png (512 px)');
