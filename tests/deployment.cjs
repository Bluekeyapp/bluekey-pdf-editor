const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const source=fs.readFileSync('sw.js','utf8'),vendor=JSON.parse(fs.readFileSync('offline-assets.json','utf8'));
 const paths=['/','/pdf-editor/','/bluekey-pdf-editor/'];
 for(const base of paths){
  const events={},requests=[],removed=[],cacheKeys=[],cache={addAll:async urls=>requests.push(...urls),put:async()=>{}};
  let claimed=false;const self={location:{href:'https://example.com'+base+'sw.js'},addEventListener:(type,fn)=>events[type]=fn,skipWaiting:()=>{},clients:{claim:()=>claimed=true}};
  const caches={open:async name=>{cacheKeys.push(name);return cache;},keys:async()=>['unrelated-cache','bluekey-pdf-'+encodeURIComponent(base)+'-v10','bluekey-pdf-other-scope-v11'],delete:async name=>removed.push(name),match:async()=>null};
  const fetch=async url=>{assert.equal(url,'https://example.com'+base+'offline-assets.json');return {ok:true,json:async()=>vendor};};
  vm.runInNewContext(source,{self,URL,caches,fetch,encodeURIComponent,Error});
  let pending;events.install({waitUntil:p=>pending=p});await pending;
  assert(requests.length>200);assert(requests.every(url=>url.startsWith('https://example.com'+base)));
  assert(requests.includes('https://example.com'+base+'vendor/ocr/fra.traineddata'));
  assert(requests.includes('https://example.com'+base+'index.html'));
  events.activate({waitUntil:p=>pending=p});await pending;assert(claimed);assert.equal(removed.length,1);assert(!removed.includes('unrelated-cache'));
  if(base!=='/'){let responded=false;events.fetch({request:{method:'GET',url:'https://example.com/applications'},respondWith:()=>responded=true});assert.equal(responded,false);}
 }
 const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
 console.log('PASS: root and nested deployment assets, French OCR path, scope-isolated caches, no interception of company site, relative PWA start/scope.');
})().catch(e=>{console.error(e);process.exitCode=1;});
