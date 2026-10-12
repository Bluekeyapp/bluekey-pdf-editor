// All recognition assets and page pixels stay on this origin/device.
let scriptPromise;
function load(){return scriptPromise??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./vendor/ocr/tesseract.min.js';s.onload=resolve;s.onerror=()=>{scriptPromise=null;reject(Error('The local OCR runtime could not load.'));};document.head.append(s);});}
export async function recognizePage(canvas,language,progress,signal,options={}){
 await load();if(signal.aborted)throw new DOMException('Canceled','AbortError');let worker;
 const cancel=()=>worker?.terminate();signal.addEventListener('abort',cancel,{once:true});
 try{worker=await Tesseract.createWorker(language,1,{workerPath:new URL('./vendor/ocr/worker.min.js',import.meta.url).href,corePath:new URL('./vendor/ocr/',import.meta.url).href,langPath:new URL('./vendor/ocr',import.meta.url).href,gzip:false,logger:m=>progress(m.status,m.progress),errorHandler:()=>{}});
  if(signal.aborted)throw new DOMException('Canceled','AbortError');
  const aborted=new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true}));
  await worker.setParameters({tessedit_pageseg_mode:options.region?'6':'3',preserve_interword_spaces:'1'});
  const {data}=await Promise.race([worker.recognize(canvas,options.deskew?{rotateAuto:true}:{}, {text:true,blocks:true}),aborted]);
  return (data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[])).filter(l=>l.text.trim()).map((l,i)=>({id:i,text:l.text.trim(),confidence:l.confidence,bbox:l.bbox}));
 }finally{signal.removeEventListener('abort',cancel);if(worker)await worker.terminate().catch(()=>{});}
}
export function prepareScan(canvas,region={x:0,y:0,w:1,h:1},clean=true){
 const x=Math.max(0,Math.floor(region.x*canvas.width)),y=Math.max(0,Math.floor(region.y*canvas.height)),w=Math.max(1,Math.min(canvas.width-x,Math.ceil(region.w*canvas.width))),h=Math.max(1,Math.min(canvas.height-y,Math.ceil(region.h*canvas.height)));
 const crop=document.createElement('canvas');crop.width=w;crop.height=h;const ctx=crop.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,x,y,w,h,0,0,w,h);
 if(clean){const pixels=ctx.getImageData(0,0,w,h),hist=new Uint32Array(256);for(let i=0;i<pixels.data.length;i+=4)hist[Math.round(.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2])]++;
  const total=w*h;let lo=0,hi=255,n=0;while(lo<254&&(n+=hist[lo])<total*.01)lo++;n=0;while(hi>lo+1&&(n+=hist[hi])<total*.01)hi--;
  for(let i=0;i<pixels.data.length;i+=4){const v=Math.max(0,Math.min(255,(.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2]-lo)*255/Math.max(1,hi-lo)));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;}ctx.putImageData(pixels,0,0);
 }return {canvas:crop,x,y};
}
export async function reconstructPage(canvas,lines,width,height){
 const {PDFDocument,StandardFonts,rgb}=PDFLib,doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),page=doc.addPage([width,height]);
 const background=document.createElement('canvas');background.width=canvas.width;background.height=canvas.height;const ctx=background.getContext('2d');ctx.drawImage(canvas,0,0);
 const sx=width/canvas.width,sy=height/canvas.height;
 for(const line of lines){if(!line.include)continue;font.encodeText(line.text.replace(/\n/g,''));const b=line.bbox;ctx.fillStyle='#ffffff';ctx.fillRect(Math.max(0,b.x0-2),Math.max(0,b.y0-2),b.x1-b.x0+4,b.y1-b.y0+4);}
 const image=await doc.embedPng(background.toDataURL());page.drawImage(image,{x:0,y:0,width,height});
 for(const line of lines){if(!line.include)continue;const b=line.bbox,w=(b.x1-b.x0)*sx;let size=Math.max(4,(b.y1-b.y0)*sy);for(const [i,text]of line.text.split('\n').entries()){const natural=font.widthOfTextAtSize(text,size);const fit=natural>w?size*w/natural:size;page.drawText(text,{x:b.x0*sx,y:height-b.y1*sy-i*size*1.2,size:fit,font,color:rgb(0,0,0)});}}
 doc.setTitle('OCR reconstructed page');return doc.save();
}
