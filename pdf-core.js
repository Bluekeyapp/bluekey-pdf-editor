import {t} from './i18n.js';
import {applyContentEdits} from './content-engine.js';
const lib = () => globalThis.PDFLib;
export function inversePoint(t,x,y){const d=t[0]*t[3]-t[1]*t[2];return [(t[3]*(x-t[4])-t[2]*(y-t[5]))/d,(-t[1]*(x-t[4])+t[0]*(y-t[5]))/d];}
export function transformPoint(t,x,y){return [t[0]*x+t[2]*y+t[4],t[1]*x+t[3]*y+t[5]];}
export function color(hex){const {rgb}=lib();return rgb(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255));}
export async function createSample(blank=false){
 const {PDFDocument,StandardFonts,rgb}=lib();const doc=await PDFDocument.create();const f=await doc.embedFont(StandardFonts.Helvetica);const bold=await doc.embedFont(StandardFonts.HelveticaBold);const green=rgb(.08,.35,.30);
 if(blank){doc.addPage([595,842]);return doc.save();}
 const page=doc.addPage([595,842]);const form=doc.getForm();
 const alternative=(field,label)=>field.acroField.dict.set(lib().PDFName.of('TU'),lib().PDFHexString.fromText(t(label)));
 const text=(s,x,y,size=11,font=f,c=rgb(.30,.36,.34))=>page.drawText(t(s),{x,y,size,font,color:c});
 page.drawRectangle({x:0,y:810,width:595,height:32,color:green});text('BLUE KEY  /  SAMPLE DOCUMENT',45,768,10,bold,green);
 text('Let\'s make it official.',45,719,28,bold);text('Client information & approval',45,691,12);
 text('A sample to explore your new PDF workspace.',45,651,11);text('Fill the fields below, add a signature, and export your copy.',45,632,11);
 const field=(name,label,x,y,w)=>{text(label,x,y+36,9,bold);const v=form.createTextField(name);alternative(v,label);v.addToPage(page,{x,y,width:w,height:28,borderWidth:1,borderColor:rgb(.78,.83,.80),backgroundColor:rgb(.98,.99,.98)});v.setFontSize(12);};
 field('full_name','FULL NAME',45,553,245);field('company','COMPANY',310,553,240);field('email','EMAIL ADDRESS',45,479,505);
 text('SERVICE',45,437,9,bold);const dd=form.createDropdown('service');alternative(dd,'SERVICE');dd.addOptions(['Select a service','Consultation','Document review','Support'].map(t));dd.select(t('Select a service'));dd.addToPage(page,{x:45,y:399,width:505,height:28,borderWidth:1,borderColor:rgb(.78,.83,.80)});
 const cb=form.createCheckBox('approved');alternative(cb,'I have reviewed the information above.');cb.addToPage(page,{x:45,y:351,width:14,height:14,borderWidth:1,borderColor:green});text('I have reviewed the information above.',70,353);
 page.drawLine({start:{x:45,y:320},end:{x:550,y:320},thickness:1,color:rgb(.86,.89,.87)});
 text('YOUR SIGNATURE',45,288,9,bold);page.drawRectangle({x:45,y:175,width:310,height:91,borderColor:rgb(.80,.85,.81),borderWidth:1});text('Use the Sign tool to place your signature here.',55,189,9);
 field('date','DATE',385,220,165);text('Your document. Your device.',45,110,13,bold,green);text('This sample contains no real client information.',45,90,10);text('01 / 02',505,45,9);
 const p2=doc.addPage([595,842]);p2.drawText(t('A little room for your notes.'),{x:45,y:740,size:25,font:bold,color:green});p2.drawText(t('Try adding text, highlighting, drawing, or inserting an image.'),{x:45,y:708,size:11,font:f});for(let y=650;y>170;y-=35)p2.drawLine({start:{x:45,y},end:{x:550,y},thickness:.5,color:rgb(.88,.90,.88)});p2.drawText('02 / 02',{x:505,y:45,size:9,font:f});
 // PDF.js reads tooltips from widget dictionaries; keep the field and widget labels aligned.
 for(const field of form.getFields()){const label=field.acroField.dict.get(lib().PDFName.of('TU'));if(label)for(const widget of field.acroField.getWidgets())widget.dict.set(lib().PDFName.of('TU'),label);}
 return doc.save();
}
export async function exportPdf(state,onlyPage=null){
 const {PDFDocument,StandardFonts,degrees}=lib();const out=await PDFDocument.create();const font=await out.embedFont(StandardFonts.Helvetica);const prepared=new Map();
 const pages=onlyPage===null?state.pages:[state.pages[onlyPage]];
 for(const p of pages){
  if(!prepared.has(p.source)){
   const src=state.sources.find(s=>s.id===p.source);const input=await PDFDocument.load(src.bytes);for(const entry of state.pages.filter(v=>v.source===p.source))await applyContentEdits(input,input.getPage(entry.index),entry.contentEdits);const form=input.getForm();
   if(form.hasXFA())throw Error('XFA forms are not supported in this preview. Use a standard PDF form.');
   if(form.getFields().some(f=>f instanceof PDFLib.PDFSignature))throw Error('This document has certificate signature fields. Export is disabled to avoid invalidating a digital signature.');
   for(const [name,value] of Object.entries(src.values||{})){
    const f=form.getField(name);
    if(typeof f.setText==='function')f.setText(String(value));
    else if(typeof f.check==='function'){value?f.check():f.uncheck();}
    else if(typeof f.select==='function'){if(value!==''&&value!=null)f.select(value);else if(f.clear)f.clear();}
   }
   if(form.getFields().length){form.updateFieldAppearances();form.flatten();}
   prepared.set(p.source,input);
  }
  const [page]=await out.copyPages(prepared.get(p.source),[p.index]);out.addPage(page);page.setRotation(degrees(p.rotation));
  for(const m of p.marks){
   const at=(x,y)=>{const [a,b]=inversePoint(m.basis.transform,x,y);return {x:a,y:b};};const c=color(m.color||'#173c33');
   if(m.type==='text'||m.type==='note'){
    const lines=m.text.split('\n');for(let n=0;n<lines.length;n++){font.encodeText(lines[n]);page.drawText(lines[n],{...at(m.x,m.y+m.size*.83+n*m.size*1.25),size:m.size,font,color:c,rotate:degrees(m.basis.rotation)});}
   }else if(m.type==='image'){
    const img=m.data.startsWith('data:image/jpeg')?await out.embedJpg(m.data):await out.embedPng(m.data);page.drawImage(img,{...at(m.x,m.y+m.h),width:m.w,height:m.h,rotate:degrees(m.basis.rotation)});
   }else if(m.type==='highlight'){
    page.drawRectangle({...at(m.x,m.y+m.h),width:m.w,height:m.h,color:c,opacity:.3,rotate:degrees(m.basis.rotation)});
   }else if(m.type==='draw'||m.type==='underline'){
    for(let i=1;i<m.points.length;i++)page.drawLine({start:at(...m.points[i-1]),end:at(...m.points[i]),thickness:m.size,color:c});
   }else if(m.type==='check'){
    const points=[[m.x,m.y+m.h*.5],[m.x+m.w*.36,m.y+m.h],[m.x+m.w,m.y]];for(let i=1;i<points.length;i++)page.drawLine({start:at(...points[i-1]),end:at(...points[i]),thickness:2,color:c});
   }
  }
 }
 out.setTitle(state.name.replace(/\.pdf$/i,''));out.setCreator('BlueKey PDF Editor local preview');out.setProducer('pdf-lib');return out.save();
}
