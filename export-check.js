import * as pdfjs from './vendor/pdf.min.mjs';
const normalize=text=>text.normalize('NFKC').replace(/\s/g,'');
export async function verifyExport(state,bytes,onlyPage=null){
 const pages=onlyPage===null?state.pages:[state.pages[onlyPage]],doc=await pdfjs.getDocument({data:bytes.slice(),standardFontDataUrl:'./vendor/standard_fonts/',cMapUrl:'./vendor/cmaps/',cMapPacked:true,wasmUrl:'./vendor/wasm/',isEvalSupported:false}).promise;
 let checked=0;try{
  if(doc.numPages!==pages.length)throw Error('Export verification failed: the page count changed.');
  for(const [i,page]of pages.entries()){
   const expected=Object.values(page.contentEdits||{}).filter(e=>e.type==='text'&&e.text?.trim());if(!expected.length)continue;
   const content=await (await doc.getPage(i+1)).getTextContent(),text=normalize(content.items.map(item=>item.str||'').join(''));
   for(const edit of expected){if(!text.includes(normalize(edit.text)))throw Error(`Export verification failed on page ${i+1}: replacement text could not be read back. Your draft is still available.`);checked++;}
  }
  return {checked,message:checked?`Reopened PDF and verified ${checked} text edits. Review the appearance before sharing.`:'PDF reopened and page count checked.'};
 }finally{doc.destroy();}
}
