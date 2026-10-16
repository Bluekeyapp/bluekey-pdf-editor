const BASE = new URL("./", self.location.href);
const PREFIX = "bluekey-pdf-" + encodeURIComponent(BASE.pathname) + "-";
const CACHE = PREFIX + "fb1fa0550ae46401";
const ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/i18n.js",
  "/pdf-core.js",
  "/content-engine.js",
  "/content-lexer.js",
  "/editing-engine.js",
  "/editing-ui.js",
  "/document-analysis.js",
  "/text-layout.js",
  "/text-script.js",
  "/engine-client.js",
  "/engine-worker.js",
  "/draft-storage.js",
  "/project-file.js",
  "/page-text.js",
  "/ocr.js",
  "/font-manager.js",
  "/text-model.js",
  "/reconstruction.js",
  "/rebuild-ui.js",
  "/export-check.js",
  "/styles.css",
  "/icon.svg",
  "/manifest.webmanifest",
  "/vendor/pdf-lib.min.js",
  "/vendor/pdf.min.mjs",
  "/vendor/pdf.worker.min.mjs",
  "/vendor/lucide.min.js",
];
const asset = (path) => new URL("." + path, BASE).href;
async function assets() {
  const response = await fetch(asset("/offline-assets.json"), {
    cache: "no-store",
  });
  if (!response.ok) throw Error("Offline asset list unavailable");
  return response.json();
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const vendor = await assets();
      const cache = await caches.open(CACHE);
      // OCR is opt-in; an unavailable language model must not break shell installation.
      await cache.addAll([
        ...new Set(
          [
            ...ASSETS,
            "/offline-assets.json",
            ...vendor.filter((path) => !path.startsWith("/vendor/ocr/")),
          ].map(asset),
        ),
      ]);
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") {
    event.waitUntil(
      (async () => {
        const tabs = (
          await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          })
        ).filter((client) => client.url.startsWith(BASE.href));
        if (tabs.length > 1) {
          event.ports[0]?.postMessage({
            error: "Close other BlueKey tabs before updating.",
          });
          return;
        }
        event.ports[0]?.postMessage({ ok: true });
        await self.skipWaiting();
      })(),
    );
    return;
  }
  if (event.data?.type !== "CACHE_LANGUAGES") return;
  event.waitUntil(
    (async () => {
      try {
        const languages = event.data.languages;
        if (
          !Array.isArray(languages) ||
          !languages.length ||
          languages.some(
            (language) => !["eng", "fra", "spa"].includes(language),
          )
        )
          throw Error("Choose an OCR language.");
        const vendor = await assets(),
          cache = await caches.open(CACHE);
        const paths = vendor.filter(
          (path) =>
            path.startsWith("/vendor/ocr/") &&
            (!path.endsWith(".traineddata") ||
              languages.some((language) =>
                path.endsWith("/" + language + ".traineddata"),
              )),
        );
        await cache.addAll(paths.map(asset));
        event.ports[0]?.postMessage({ ok: true });
      } catch (error) {
        event.ports[0]?.postMessage({ error: error.message });
      }
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== BASE.origin ||
    !url.pathname.startsWith(BASE.pathname)
  )
    return;
  // Never cache development endpoints, arbitrary files, or project documents.
  const pathname = url.pathname.slice(BASE.pathname.length);
  if (
    !ASSETS.some((path) => path.slice(1) === pathname) &&
    !/^(vendor|examples)\//.test(pathname) &&
    pathname !== "offline-assets.json"
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })(),
  );
});
