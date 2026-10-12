const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 globalThis.self=globalThis;await import('../vendor/pdf-lib.min.js');
 const {createCanvas}=require(path.join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
 globalThis.document={createElement:tag=>{assert.equal(tag,'canvas');return createCanvas(1,1);}};
 const {reconstructDocument,regionLines}=await import('../reconstruction.js'),{prepareScan}=await import('../ocr.js'),{deskewScan}=await import('../rebuild-ui.js');
 const canvas=createCanvas(1200,800),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,800);ctx.fillStyle='black';ctx.font='40px Arial';ctx.fillText('Original image text',100,150);ctx.fillStyle='#3c8060';ctx.fillRect(800,450,180,150);
 const original=await PDFLib.PDFDocument.create(),page=original.addPage([600,400]),image=await original.embedPng(canvas.toDataURL());page.drawImage(image,{x:0,y:0,width:600,height:400});const font=await original.embedFont('Helvetica');original.addPage([600,400]).drawText('Keep this other page.',{x:45,y:300,size:18,font});
 const bytes=await original.save(),lines=[{text:'María García — Ελληνικά',include:true,bbox:{x0:95,y0:105,x1:620,y1:165}}];
 const output=await reconstructDocument({bytes,pageIndex:0,canvas,lines,width:600,height:400});const out=await PDFLib.PDFDocument.load(output);assert.equal(out.getPageCount(),2);
 const items=(await (await import('../content-engine.js')).inspectContent(output,0)).items;assert(items.some(i=>i.text==='María García — Ελληνικά'));assert(items.find(i=>i.type==='text').editable);
 await assert.rejects(()=>reconstructDocument({bytes,pageIndex:0,canvas,lines:[{...lines[0],text:'中文'}],width:600,height:400}),/cannot encode/);
 const view={width:600,height:400,scale:1,transform:[1,0,0,-1,0,400]},extracted=regionLines({items:[{str:'Text',transform:[20,0,0,20,50,300],width:80,fontName:'f'}],styles:{f:{ascent:.8}}},view,{x:0,y:.2,w:1,h:.2});assert.equal(extracted.length,1);assert.equal(extracted[0].bbox.x0,50);assert.equal(extracted[0].bbox.y0,84);
 const crop=prepareScan(canvas,{x:.05,y:.1,w:.5,h:.2});assert.equal(crop.x,60);assert.equal(crop.y,80);assert.equal(crop.canvas.width,600);assert.equal(crop.canvas.height,160);
 const angled=createCanvas(1000,500),ac=angled.getContext('2d');ac.fillStyle='white';ac.fillRect(0,0,1000,500);ac.translate(500,250);ac.rotate(3*Math.PI/180);ac.fillStyle='black';ac.font='30px Arial';for(let i=0;i<5;i++)ac.fillText('Straighten this printed line for local recognition',-400,-100+i*45);
 const straight=deskewScan(angled);assert(Math.abs(straight.angle+3)<1.1,straight.angle);assert(straight.canvas.width>=angled.width);const restored=straight.restore({x0:200,y0:150,x1:500,y1:200});assert(Object.values(restored).every(Number.isFinite));
 fs.writeFileSync('tests/reconstruction-before.pdf',bytes);fs.writeFileSync('tests/reconstruction-after.pdf',output);
 console.log('PASS: separate multipage reconstruction, editable Unicode text, unsupported glyph rejection, region extraction/cropping, scan deskew and inverse box mapping.');
})().catch(e=>{console.error(e);process.exitCode=1;});
