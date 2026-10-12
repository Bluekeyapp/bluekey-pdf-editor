// Local font assets only. Font bytes are retained in drafts for imported fonts.
const cache=new Map(),embedded=new WeakMap();
const browserFaces=new Map();
async function toolkit(){if(!globalThis.fontkit){const module=await import('./vendor/fontkit/fontkit.umd.min.js');globalThis.fontkit=globalThis.fontkit||module.default;}return globalThis.fontkit;}
async function asset(path){
 if(typeof window==='undefined'){const fs=await import('node:fs/promises');return new Uint8Array(await fs.readFile(new URL(path,import.meta.url)));}
 const response=await fetch(new URL(path,import.meta.url));if(!response.ok)throw Error('The local font could not load.');return new Uint8Array(await response.arrayBuffer());
}
export async function fontRecord(choice='regular',data){
 const key=data||choice;if(cache.has(key))return cache.get(key);
 const kit=await toolkit();let bytes;
 if(data){if(!/^data:.*;base64,/.test(data))throw Error('Invalid font data.');bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));if(bytes.length>5*1024*1024)throw Error('Choose a font below 5 MB.');}
 else {const style={regular:'Regular',bold:'Bold',italic:'Italic',bolditalic:'BoldItalic'}[choice]||'Regular';bytes=await asset('./vendor/standard_fonts/LiberationSans-'+style+'.ttf');}
 const parsed=kit.create(bytes);if(!parsed.hasGlyphForCodePoint)throw Error('Choose a single TTF or OTF font, not a font collection.');
 const record={bytes,parsed,name:parsed.fullName||'Imported font',key};cache.set(key,record);if(cache.size>12)cache.delete(cache.keys().next().value);return record;
}
export function fontStyle(base=''){return /bold/i.test(base)?(/italic|oblique/i.test(base)?'bolditalic':'bold'):(/italic|oblique/i.test(base)?'italic':'regular');}
export function assertFontCoverage(record,text){
 const missing=[...new Set([...text.replace(/[\r\n\t]/g,'')].filter(c=>!record.parsed.hasGlyphForCodePoint(c.codePointAt(0))))];
 if(missing.length)throw Error(`The font ${record.name} cannot encode: ${missing.slice(0,8).join(' ')}. Choose a font containing these characters.`);
 // Correct bidi and mark positioning require more than glyph substitution.
 if(/[\u0590-\u0fff\u1780-\u17ff\u202a-\u202e\u2066-\u2069]/u.test(text))throw Error('This script needs bidirectional or complex text layout, which is not supported for replacement text yet.');
}
export async function embedManagedFont(doc,choice='regular',data,text=''){
 const record=await fontRecord(choice,data);assertFontCoverage(record,text);doc.registerFontkit(await toolkit());
 let fonts=embedded.get(doc);if(!fonts){fonts=new Map();embedded.set(doc,fonts);}if(!fonts.has(record.key))fonts.set(record.key,await doc.embedFont(record.bytes,{subset:true,features:{liga:false,clig:false}}));
 return {font:fonts.get(record.key),name:record.name};
}
export async function managedMetrics(choice,data,text){const doc=await PDFLib.PDFDocument.create();return embedManagedFont(doc,choice,data,text);}
export async function previewFont(choice,data){
 const record=await fontRecord(choice,data);if(!browserFaces.has(record.key)){
  const family='BlueKeyFont'+browserFaces.size+'_'+crypto.randomUUID().replace(/-/g,'');const face=new FontFace(family,record.bytes);await face.load();document.fonts.add(face);browserFaces.set(record.key,{family,face});
  if(browserFaces.size>12){const [key,old]=browserFaces.entries().next().value;document.fonts.delete(old.face);browserFaces.delete(key);}
 }return browserFaces.get(record.key).family;
}
