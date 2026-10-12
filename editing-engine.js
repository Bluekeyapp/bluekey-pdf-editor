import {tokenize} from './content-lexer.js';
import {getEncoding} from './vendor/encodings.js';
import {getGlyphsUnicode} from './vendor/glyphlist-source.js';
import {embedManagedFont,managedMetrics,fontStyle} from './font-manager.js';
const L=()=>globalThis.PDFLib,N=s=>L().PDFName.of(s),I=[1,0,0,1,0,0];
export const matrix=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
function inverse(m){const d=m[0]*m[3]-m[1]*m[2];if(Math.abs(d)<1e-10)throw Error('Degenerate object transform');return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
const num=o=>o?.asNumber?.()??Number(o?.toString()),get=(d,k)=>d?.lookup?.(N(k)),nm=o=>o?.decodeText?.()??o?.toString()?.slice(1),arr=o=>o?.asArray?.()||[];
const raw=stream=>Array.from(L().decodePDFRawStream(stream).decode(),c=>String.fromCharCode(c)).join('');
const bytes=s=>Uint8Array.from(s,c=>c.charCodeAt(0)),hex=s=>Array.from(s,c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
const fmt=n=>{if(!Number.isFinite(n))throw Error('Invalid geometry');return Number(n.toFixed(6));},mt=m=>m.map(fmt).join(' ');
const win=new TextDecoder('windows-1252'),winMap=new Map(Array.from({length:256},(_,i)=>[win.decode(Uint8Array.of(i)),String.fromCharCode(i)]));
const std=/^(Helvetica(-Bold|-Oblique|-BoldOblique)?|Times-(Roman|Bold|Italic|BoldItalic)|Courier(-Bold|-Oblique|-BoldOblique)?)$/;
const metricCache=new Map();
async function metrics(base){if(!metricCache.has(base)){const doc=await L().PDFDocument.create();metricCache.set(base,await doc.embedFont(base));}return metricCache.get(base);}
function fallback(base=''){const bold=/bold/i.test(base),italic=/italic|oblique/i.test(base);return /times|serif/i.test(base)?`Times-${bold?(italic?'BoldItalic':'Bold'):(italic?'Italic':'Roman')}`:/courier|mono/i.test(base)?`Courier${bold?(italic?'-BoldOblique':'-Bold'):(italic?'-Oblique':'')}`:`Helvetica${bold?(italic?'-BoldOblique':'-Bold'):(italic?'-Oblique':'')}`;}
function unicodeHex(h){if(h.length%4)throw Error('Unsupported Unicode map');return h.match(/.{4}/g).map(v=>String.fromCharCode(parseInt(v,16))).join('');}
function glyphText(name){const plain=name.split('.')[0],value=getGlyphsUnicode()[plain];if(value!=null)return String.fromCodePoint(value);if(/^uni([\da-f]{4})+$/i.test(plain))return unicodeHex(plain.slice(3));if(/^u[\da-f]{4,6}$/i.test(plain)){const n=parseInt(plain.slice(1),16);if(n<=0x10ffff)return String.fromCodePoint(n);}return null;}
function simpleMapping(encoding,base,subtype){
 const named=nm(encoding),isDict=!!encoding?.lookup;let baseName=isDict?nm(get(encoding,'BaseEncoding')):named;
 if(!baseName&&((std.test(base)&&subtype==='Type1')||isDict&&subtype==='Type1'))baseName='StandardEncoding';
 const names=getEncoding(baseName);if(!names&&!(isDict&&get(encoding,'Differences')))return null;const map=new Map();(names||[]).forEach((name,i)=>{const text=glyphText(name);if(text)map.set(i.toString(16).padStart(2,'0').toUpperCase(),text);});
 if(isDict){let code;for(const v of arr(get(encoding,'Differences'))){if(v instanceof L().PDFNumber){code=num(v);continue;}if(code==null||code<0||code>255)throw Error('Invalid font Differences map');const text=glyphText(nm(v)||''),key=(code++).toString(16).padStart(2,'0').toUpperCase();if(text)map.set(key,text);else map.delete(key);}}
 return map;
}
function cmap(stream){
 const text=raw(stream),map=new Map();if(/usecmap/.test(text))throw Error('Inherited character map');
 for(const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const m of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))map.set(m[1].toUpperCase(),unicodeHex(m[2]));
 for(const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))for(const m of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*(<([\da-f]+)>|\[([^\]]*)\])/gi)){
  const first=parseInt(m[1],16),last=parseInt(m[2],16);if(last-first>65536)throw Error('Oversized character map');const values=m[5]?.match(/<[\da-f]+>/gi);
  for(let code=first;code<=last;code++){const h=values?values[code-first]?.slice(1,-1):(parseInt(m[4],16)+code-first).toString(16).padStart(m[4].length,'0');if(!h)throw Error('Incomplete character map');map.set(code.toString(16).padStart(m[1].length,'0').toUpperCase(),unicodeHex(h));}
 }return map;
}
async function fontInfo(dict){
 if(!dict)throw Error('Missing font resource');const base=nm(get(dict,'BaseFont'))||'Unknown',subtype=nm(get(dict,'Subtype')),encoding=get(dict,'Encoding');
 const composite=subtype==='Type0';if(composite&&nm(encoding)!=='Identity-H')throw Error('Vertical or custom composite encoding');if(!['Type1','TrueType','Type0'].includes(subtype))throw Error('Unsupported font type');
 const child=composite?dict.context.lookup(arr(get(dict,'DescendantFonts'))[0]):dict;
 const mapping=get(dict,'ToUnicode')?cmap(get(dict,'ToUnicode')):(!composite?simpleMapping(encoding,base,subtype):null);
 if(!mapping&&nm(encoding)!=='WinAnsiEncoding'&&!(std.test(base)&&!encoding))throw Error('Font has no usable Unicode mapping');
 const lengths=mapping?[...new Set([...mapping.keys()].map(k=>k.length/2))].sort((a,b)=>b-a):[1];
 const widths={};if(composite){const w=arr(get(child,'W'));for(let i=0;i<w.length;){const start=num(w[i++]),next=child.context.lookup(w[i++]);if(next instanceof L().PDFArray){arr(next).forEach((v,j)=>widths[start+j]=num(v));}else{const end=num(next),width=num(w[i++]);if(end-start>65536)throw Error('Oversized font widths');for(let c=start;c<=end;c++)widths[c]=width;}}}else{const first=num(get(dict,'FirstChar'))||0;arr(get(dict,'Widths')).forEach((v,i)=>widths[first+i]=num(v));}
 const standard=std.test(base)&&!get(dict,'FontDescriptor')&&!get(dict,'Widths');const metric=await metrics(fallback(base));
 const decode=s=>{if(!encoding&&!mapping&&/[^\x20-\x7e]/.test(s))throw Error('Non-ASCII default font encoding is read-only.');const glyphs=[];for(let i=0;i<s.length;){let code,txt,len;if(mapping){for(const n of lengths){const h=hex(s.slice(i,i+n)).toUpperCase();if(h.length===n*2&&mapping.has(h)){len=n;code=parseInt(h,16);txt=mapping.get(h);break;}}if(!len)throw Error('Unmapped embedded-font character');}else{len=1;code=s.charCodeAt(i);txt=win.decode(Uint8Array.of(code));}
   const width=widths[code]??(standard?metric.widthOfTextAtSize(txt,1000):(composite?(Number.isFinite(num(get(child,'DW')))?num(get(child,'DW')):1000):num(get(get(dict,'FontDescriptor'),'MissingWidth'))));
   if(!Number.isFinite(width))throw Error('Missing glyph width');glyphs.push({text:txt,code,encoded:s.slice(i,i+len),width});i+=len;}return glyphs;};
 const reverse={};if(mapping)for(const [h,txt] of mapping)if([...txt].length===1)reverse[txt]=h;else{}else for(const [txt,s]of winMap)if(encoding||(s.charCodeAt(0)>=32&&s.charCodeAt(0)<=126))reverse[txt]=hex(s);
 return {base,standard,subtype,widths,defaultWidth:composite?(Number.isFinite(num(get(child,'DW')))?num(get(child,'DW')):1000):num(get(get(dict,'FontDescriptor'),'MissingWidth')),reverse,fallback:fallback(base),decode};
}
function contentStreams(page){const c=page.node.Contents();return !c?[]:c instanceof L().PDFArray?arr(c).map(r=>page.doc.context.lookup(r)):[c];}
const quad=(m,x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>point(m,...p));
export async function inspectDocument(doc,page){
 const items=[],warnings=[],fontCache=new Map();let total=0;
 const font=async(res,key)=>{const d=get(get(res,'Font'),key);if(!fontCache.has(d))fontCache.set(d,await fontInfo(d));return fontCache.get(d);};
 async function walk(stream,res,root,path,parent,depth,sharedState){
  if(depth>8||++total>1000){warnings.push('Nested object limit reached.');return;}
  let ts;try{ts=tokenize(raw(stream));if(ts.some(t=>t.type==='word'&&t.raw==='BI'))throw Error('Inline images are read-only');}catch(e){warnings.push(e.message||'Unreadable content stream');if(sharedState?.gs)sharedState.gs.unsafe=true;return;}
  let gs=sharedState?.gs||{ctm:parent.slice(),font:null,size:12,tc:0,tw:0,tz:1,leading:0,rise:0,mode:0,color:'0 g',clip:false,unsafe:false},stack=sharedState?.stack||[],tm=sharedState?.tm||I.slice(),tlm=sharedState?.tlm||I.slice(),inText=sharedState?.inText||false,positionKnown=sharedState?.positionKnown??true,marked=sharedState?.marked||[],operands=[];
  const translate=(x,y)=>{tlm=matrix(tlm,[1,0,0,1,x,y]);tm=tlm.slice();positionKnown=true;};
  for(const t of ts){if(t.type!=='word'||/^[-+]?\d*\.?\d+$/.test(t.raw)){operands.push(t);continue;}const op=t.raw,a=operands;operands=[];const vals=a.map(v=>Number(v.raw)),key=a[0]?.type==='name'?a[0].raw.slice(1).replace(/#([\da-f]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))):null;
   if(op==='BDC'||op==='BMC'){marked.push(gs.actualText);const prop=a.at(-1)?.type==='name'?get(get(res,'Properties'),a.at(-1).raw.slice(1)):null;gs.actualText=gs.actualText||a.some(v=>v.raw==='/ActualText')||!!get(prop,'ActualText');}else if(op==='EMC')gs.actualText=marked.pop();
   else if(op==='q')stack.push(structuredClone(gs));else if(op==='Q'){gs=stack.pop()||gs;}
   else if(op==='cm'&&vals.length===6)gs.ctm=matrix(gs.ctm,vals);
   else if(op==='W'||op==='W*')gs.clip=true;
   else if(op==='gs'){const ext=get(get(res,'ExtGState'),key);if(get(ext,'Font'))gs.unsafe=true;}
   else if(['g','rg','k','sc','scn','cs'].includes(op)){gs.color=op==='cs'?a.map(v=>v.raw).join(' ')+' cs':a.map(v=>v.raw).join(' ')+' '+op;}
   else if(op==='BT'){tm=I.slice();tlm=I.slice();inText=true;positionKnown=true;}
   else if(op==='ET')inText=false;
   else if(op==='Tf'){gs.font=key;gs.size=vals[1];}
   else if(op==='Tc')gs.tc=vals[0];else if(op==='Tw')gs.tw=vals[0];else if(op==='Tz')gs.tz=vals[0]/100;else if(op==='TL')gs.leading=vals[0];else if(op==='Ts')gs.rise=vals[0];else if(op==='Tr')gs.mode=vals[0];
   else if(op==='Tm'&&vals.length===6){tm=vals;tlm=vals.slice();positionKnown=true;}
   else if(op==='Td'||op==='TD'){if(op==='TD')gs.leading=-vals[1];translate(vals[0],vals[1]);}
   else if(op==='T*')translate(0,-gs.leading);
   else if(['Tj','TJ',"'",'"'].includes(op)&&inText){
    if(op==='"'){gs.tw=vals[0];gs.tc=vals[1];}if(op==='"'||op==="'")translate(0,-gs.leading);
    const id=`${root}:${path.map(p=>p.offset).join('.')}${path.length?':':''}${t.start}`;let text='',advance=0,info,reason='';
    try{info=await font(res,gs.font);for(const v of a){if(v.type==='string'){for(const g of info.decode(v.value)){text+=g.text;advance+=(g.width/1000*gs.size+gs.tc+(g.encoded.length===1&&g.code===32?gs.tw:0))*gs.tz;}}else if(op==='TJ'&&v.type==='word'&&Number.isFinite(Number(v.raw)))advance-=Number(v.raw)/1000*gs.size*gs.tz;}
     if(!positionKnown)reason='An earlier unsupported text run prevents accurate positioning.';
     if(gs.actualText)reason='Accessibility replacement text (ActualText) is read-only.';
     if(gs.mode!==0||gs.clip||gs.unsafe)reason='Clipped, stroked, invisible, or graphics-state font text is read-only.';
     if(gs.size<=0||gs.tz<=0)reason='Unsupported text scale.';
    }catch(e){reason=e.message;positionKnown=false;}
    const m=matrix(gs.ctm,tm),item={id,type:'text',root,path:structuredClone(path),start:a[0]?.start??t.start,end:t.end,text,font:gs.font,label:info?.base||'Unsupported font',fontInfo:info?{...info,decode:undefined}:null,size:gs.size,color:gs.color,tc:gs.tc,tw:gs.tw,tz:gs.tz,rise:gs.rise,matrix:m,textMatrix:tm.slice(),lineMatrix:tlm.slice(),ctm:gs.ctm.slice(),advance,endMatrix:matrix(tm,[1,0,0,1,advance,0]),leading:gs.leading,operator:op,editable:!reason,reason,quad:quad(m,0,gs.rise-gs.size*.22,Math.max(advance,gs.size*.3),gs.size*1.15)};
    if(a.some(v=>v.type==='string'))items.push(item);tm=item.endMatrix.slice();if(reason)warnings.push(reason);
   }else if(op==='Do'&&key){
    const obj=get(get(res,'XObject'),key),sub=nm(get(obj?.dict,'Subtype'));const start=a[0].start;
    if(sub==='Image')items.push({id:`${root}:${path.map(p=>p.offset).join('.')}${path.length?':':''}${t.start}`,type:'image',root,path:structuredClone(path),start,end:t.end,resource:key,label:`Image ${key}`,width:num(get(obj.dict,'Width')),height:num(get(obj.dict,'Height')),matrix:gs.ctm.slice(),quad:quad(gs.ctm,0,0,1,1),editable:!gs.clip&&!gs.unsafe,reason:gs.clip||gs.unsafe?'Image has a clipping path or unknown graphics state; editing is disabled.':''});
    else if(sub==='Form'){
     const fm=arr(get(obj.dict,'Matrix')).map(num),next=matrix(gs.ctm,fm.length===6?fm:I);await walk(obj,get(obj.dict,'Resources')||res,root,[...path,{offset:t.start,start,end:t.end,resource:key}],next,depth+1,{gs:{...structuredClone(gs),ctm:next}});
    }
   }
  }if(sharedState)Object.assign(sharedState,{gs,stack,tm,tlm,inText,positionKnown,marked});
 }
 const shared={gs:null};for(const [i,s]of contentStreams(page).entries())await walk(s,page.node.Resources(),i,[],I,0,shared);
 return {items,warnings:[...new Set(warnings)]};
}
export async function inspectContent(data,index){const d=await L().PDFDocument.load(data);return inspectDocument(d,d.getPage(index));}
function encodeOriginal(info,text){let encoded='';for(const c of text){if(!info.reverse[c])return null;encoded+=info.reverse[c];}return encoded;}
export async function textLayout(item,edit){
 const value=edit.text??item.text;if(typeof value!=='string'||value.length>20000)throw Error('Keep each text object below 20,000 characters.');const text=value.replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
 if(edit.font==='custom'&&!edit.fontData)throw Error('Import a TTF or OTF font before choosing the imported-font option.');
 const original=encodeOriginal(item.fontInfo,text.replace(/\n/g,''));let useFallback=!!edit.fontData||['fallback','embedded','custom'].includes(edit.font)||original===null;
 let metric=await metrics(item.fontInfo.fallback),managed=!!edit.fontData||['embedded','custom'].includes(edit.font),fontName=item.fontInfo.fallback;
 if(useFallback&&!managed){try{metric.encodeText(text.replace(/\n/g,''));}catch{managed=true;}}
 const style=fontStyle(item.label);if(managed){const loaded=await managedMetrics(style,edit.fontData,text);metric=loaded.font;fontName=loaded.name;useFallback=true;}
 const widthAt=(s,size)=>{
  if(useFallback){metric.encodeText(s);return metric.widthOfTextAtSize(s,size)*item.tz;}
  let w=0;for(const c of s){const h=item.fontInfo.reverse[c],code=parseInt(h,16);const unit=item.fontInfo.widths[code]??(item.fontInfo.standard?metric.widthOfTextAtSize(c,1000):item.fontInfo.defaultWidth);if(unit===undefined){return metric.widthOfTextAtSize(s,size)*item.tz;}w+=(unit/1000*size+item.tc+(h==='20'?item.tw:0))*item.tz;}return w;
 };
 let size=Math.max(2,Math.min(200,Number(edit.size)||item.size)),width=Math.max(4,Number(edit.width)||Math.abs(item.advance)||100),lines=text.split('\n');
 // Validate fallback coverage before changing a document.
 if(useFallback)for(const line of lines)metric.encodeText(line);
 if(edit.fit==='shrink'){const widest=Math.max(1,...lines.map(l=>widthAt(l,size)));if(widest>width)size=Math.max(2,size*width/widest);}
 if(edit.fit==='wrap'){lines=[];for(const para of text.split('\n')){let line='';for(const word of para.split(/(\s+)/)){if(line&&widthAt(line+word,size)>width){lines.push(line.trimEnd());line=word.trimStart();}else line+=word;}lines.push(line);}}
 const lineHeight=Math.max(.8,Math.min(3,Number(edit.lineHeight)||1.2));const overflow=lines.some(l=>widthAt(l,size)>width+.5);return {lines,size,width,height:lines.length*size*lineHeight,lineHeight,overflow,useFallback,managed,style,font:fontName,widths:lines.map(l=>widthAt(l,size))};
}
export function imageMatrix(item,edit={}){
 const dx=Number(edit.dx)||0,dy=Number(edit.dy)||0,sx=edit.scaleX==null?1:Number(edit.scaleX),sy=edit.scaleY==null?sx:Number(edit.scaleY),rad=(Number(edit.rotation)||0)*Math.PI/180;
 if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<.05||sy<.05||sx>20||sy>20)throw Error('Image scale must be between 5% and 2000%.');
 let m=matrix([1,0,0,1,dx,dy],item.matrix);m=matrix(m,[1,0,0,1,.5,.5]);m=matrix(m,[Math.cos(rad)*sx,Math.sin(rad)*sx,-Math.sin(rad)*sy,Math.cos(rad)*sy,0,0]);return matrix(m,[1,0,0,1,-.5,-.5]);
}
export async function applyContentEdits(doc,page,edits={}){
 if(!Object.keys(edits).length)return;const {items}=await inspectDocument(doc,page),byId=new Map(items.map(i=>[i.id,i]));
 for(const [id,e]of Object.entries(edits)){const i=byId.get(id);if(!i?.editable)throw Error(i?.reason||'An edit no longer matches supported original content.');if(e.type!==i.type)throw Error('Mismatched object type.');}
 async function rewrite(stream,res,subset,depth){
  let resources=res.clone(doc.context);const replacements=[];
  const resource=(kind,ref)=>{let d=get(resources,kind);d=d?d.clone(doc.context):doc.context.obj({});let key=`BK${kind}${d.keys().length}`;while(d.has(N(key)))key+='x';d.set(N(key),ref);resources.set(N(kind),d);return key;};
  const groups=new Map();
  for(const [id,edit]of subset){const item=byId.get(id);
   if(item.path.length>depth){const step=item.path[depth];if(!groups.has(step.offset))groups.set(step.offset,{step,entries:[]});groups.get(step.offset).entries.push([id,edit]);continue;}
   let replacement='';
   if(item.type==='text'){
    const lay=await textLayout(item,edit);if(lay.overflow&&!edit.allowOverflow)throw Error('Text exceeds its box. Choose shrink, wrap, widen the box, or allow overflow.');
    let font=item.font,encoder=s=>'<'+encodeOriginal(item.fontInfo,s)+'>';
    if(lay.useFallback){const f=lay.managed?(await embedManagedFont(doc,lay.style,edit.fontData,lay.lines.join('\n'))).font:await doc.embedFont(lay.font);font=resource('Font',f.ref);encoder=s=>f.encodeText(s).toString();}
    const oldTc=item.tc,oldTw=item.tw;replacement=`/${font} ${fmt(lay.size)} Tf\n`+(lay.useFallback?'0 Tc 0 Tw\n':'');
    for(let n=0;n<lay.lines.length;n++){const dx=edit.align==='center'?(lay.width-lay.widths[n])/2:edit.align==='right'?lay.width-lay.widths[n]:0;const m=matrix(item.textMatrix,[1,0,0,1,dx,-n*lay.size*lay.lineHeight]);replacement+=`${mt(m)} Tm ${encoder(lay.lines[n])} Tj\n`;}
    // Restore both text and line matrices: later mixed-style runs keep their positions.
    const delta=point(inverse(item.lineMatrix),item.endMatrix[4],item.endMatrix[5]);
    replacement+=`/${item.font} ${fmt(item.size)} Tf ${fmt(oldTc)} Tc ${fmt(oldTw)} Tw\n${mt(item.lineMatrix)} Tm\n[${fmt(-delta[0]*1000/(item.size*item.tz))}] TJ`;
   }else if(!edit.remove){
    let key=item.resource;let fit=I;
    if(edit.data){if(!/^data:image\/(png|jpeg);base64,/.test(edit.data))throw Error('Use a PNG or JPEG image.');const im=edit.data.startsWith('data:image/png')?await doc.embedPng(edit.data):await doc.embedJpg(edit.data);key=resource('XObject',im.ref);
     const w=Math.hypot(item.matrix[0],item.matrix[1]),h=Math.hypot(item.matrix[2],item.matrix[3]),ratio=im.width/im.height/(w/h);let fw=1,fh=1;if(edit.fit==='cover'){if(ratio>1)fw=ratio;else fh=1/ratio;}else{if(ratio>1)fh=1/ratio;else fw=ratio;}fit=[fw,0,0,fh,(1-fw)/2,(1-fh)/2];}
    const delta=matrix(inverse(item.matrix),imageMatrix(item,edit));replacement=`q ${mt(delta)} cm ${edit.fit==='cover'?'0 0 1 1 re W n ':''}${mt(fit)} cm /${key} Do Q`;
   }
   replacements.push({start:item.start,end:item.end,replacement});
  }
  for(const {step,entries}of groups.values()){
   const original=get(get(resources,'XObject'),step.resource),child=await rewrite(original,get(original.dict,'Resources')||resources,entries,depth+1);
   const dict=original.dict.clone(doc.context);dict.delete(N('Filter'));dict.delete(N('DecodeParms'));dict.delete(N('Length'));dict.set(N('Resources'),child.resources);
   const copy=doc.context.stream(bytes(child.text),{});copy.dict=dict;const key=resource('XObject',doc.context.register(copy));replacements.push({...step,replacement:`/${key} Do`});
  }
  let text=raw(stream);for(const r of replacements.sort((a,b)=>b.start-a.start))text=text.slice(0,r.start)+r.replacement+text.slice(r.end);return {text,resources};
 }
 const entries=Object.entries(edits),refs=[];let res=page.node.Resources();for(const [idx,s]of contentStreams(page).entries()){const relevant=entries.filter(([id])=>byId.get(id).root===idx);if(relevant.length){const r=await rewrite(s,res,relevant,0);res=r.resources;refs.push(doc.context.register(doc.context.flateStream(bytes(r.text))));}else refs.push(doc.context.register(s));}
 page.node.set(N('Resources'),res);page.node.set(N('Contents'),doc.context.obj(refs));
}
export async function previewContent(data,index,edits){const doc=await L().PDFDocument.load(data);await applyContentEdits(doc,doc.getPage(index),edits);return doc.save();}
