import {embedManagedFont} from './font-manager.js';
export function regionLines(content,viewport,region){
 const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
 const r={x0:region.x*viewport.width,y0:region.y*viewport.height,x1:(region.x+region.w)*viewport.width,y1:(region.y+region.h)*viewport.height};
 return content.items.filter(i=>i.str?.trim()).flatMap(i=>{const t=multiply(viewport.transform,i.transform),h=Math.hypot(t[2],t[3]),w=i.width*viewport.scale,angle=Math.atan2(t[1],t[0]),ascent=content.styles[i.fontName]?.ascent??.85;
  const corners=[[0,-h*ascent],[w,-h*ascent],[0,h*(1-ascent)],[w,h*(1-ascent)]].map(([x,y])=>[t[4]+x*Math.cos(angle)-y*Math.sin(angle),t[5]+x*Math.sin(angle)+y*Math.cos(angle)]);
  const b={x0:Math.min(...corners.map(p=>p[0])),y0:Math.min(...corners.map(p=>p[1])),x1:Math.max(...corners.map(p=>p[0])),y1:Math.max(...corners.map(p=>p[1]))};
  // Include complete intersecting lines, never silently cut characters in half.
  return b.x0<r.x1&&b.x1>r.x0&&b.y0<r.y1&&b.y1>r.y0?[{text:i.str,bbox:b,confidence:null,include:true,source:'extracted',rotated:Math.abs(angle)>.05}]:[];
 });
}
export async function reconstructDocument({bytes,pageIndex,canvas,lines,width,height,fontData,background='#ffffff',ink='#000000'}){
 const {PDFDocument,rgb}=PDFLib,input=await PDFDocument.load(bytes),out=await PDFDocument.create();
 const selected=lines.filter(l=>l.include);if(!selected.length)throw Error('Include at least one text area.');
 if(selected.some(l=>l.text.length>20000))throw Error('Keep each text area below 20,000 characters.');
 const {font}=await embedManagedFont(out,'regular',fontData,selected.map(l=>l.text).join('\n'));
 const raster=document.createElement('canvas');raster.width=canvas.width;raster.height=canvas.height;const ctx=raster.getContext('2d');ctx.drawImage(canvas,0,0);ctx.fillStyle=background;
 for(const {bbox:b}of selected){ctx.fillRect(Math.max(0,b.x0-3),Math.max(0,b.y0-3),b.x1-b.x0+6,b.y1-b.y0+6);}
 const image=await out.embedPng(raster.toDataURL()),sx=width/canvas.width,sy=height/canvas.height,c=rgb(...[1,3,5].map(i=>parseInt(ink.slice(i,i+2),16)/255));
 for(let i=0;i<input.getPageCount();i++){
  if(i!==pageIndex){const [p]=await out.copyPages(input,[i]);out.addPage(p);continue;}
  const page=out.addPage([width,height]);page.drawImage(image,{x:0,y:0,width,height});
  for(const line of selected){const b=line.bbox,rows=line.text.replace(/\r\n?/g,'\n').split('\n'),w=(b.x1-b.x0)*sx,h=(b.y1-b.y0)*sy;let size=Math.max(2,h/Math.max(1,rows.length*1.2));
   const widest=Math.max(1,...rows.map(t=>font.widthOfTextAtSize(t,size)));if(widest>w)size*=w/widest;
   if(size<2&&line.text.trim())throw Error('This text is too long for its selected area. Shorten it or select a larger area.');
   for(const [row,text]of rows.entries())page.drawText(text,{x:b.x0*sx,y:height-b.y0*sy-size*.85-row*size*1.2,size,font,color:c});
  }
 }
 out.setTitle('Editable reconstruction');return out.save();
}
