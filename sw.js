const BASE=new URL('./',self.location.href);
const PREFIX='bluekey-pdf-'+encodeURIComponent(BASE.pathname)+'-';
const CACHE=PREFIX+'v11';
const ASSETS=['/','/index.html','/app.js','/i18n.js','/pdf-core.js','/content-engine.js','/content-lexer.js','/editing-engine.js','/editing-ui.js','/ocr.js','/font-manager.js','/text-model.js','/reconstruction.js','/rebuild-ui.js','/export-check.js','/styles.css','/icon.svg','/manifest.webmanifest','/vendor/pdf-lib.min.js','/vendor/pdf.min.mjs','/vendor/pdf.worker.min.mjs','/vendor/lucide.min.js'];
const asset=path=>new URL('.'+path,BASE).href;
self.addEventListener('install',e=>e.waitUntil(fetch(asset('/offline-assets.json')).then(r=>{if(!r.ok)throw Error('Offline asset list unavailable');return r.json();}).then(async vendor=>{const c=await caches.open(CACHE);await c.addAll([...new Set([...ASSETS,'/offline-assets.json',...vendor].map(asset))]);}).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith(PREFIX)||BASE.pathname==='/'&&/^bluekey-pdf-v\d+$/.test(k))&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)));}return r;}).catch(()=>caches.match(e.request)));});
