const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
(async () => {
  const source = fs.readFileSync("sw.js", "utf8"),
    vendor = JSON.parse(fs.readFileSync("offline-assets.json", "utf8"));
  for (const base of ["/", "/pdf-editor/", "/bluekey-pdf-editor/"]) {
    const events = {},
      requests = [],
      removed = [],
      cacheNames = [],
      responses = new Map(),
      messages = [];
    let claimed = false,
      skipped = false,
      tabCount = 1,
      networkCalls = 0;
    const cache = {
      addAll: async (urls) => requests.push(...urls),
      match: async (request) => responses.get(request.url),
      put: async (request, response) => responses.set(request.url, response),
    };
    const self = {
      location: { href: "https://example.com" + base + "sw.js" },
      addEventListener: (type, fn) => (events[type] = fn),
      skipWaiting: () => {
        skipped = true;
      },
      clients: {
        claim: () => {
          claimed = true;
        },
        matchAll: async () =>
          Array.from({ length: tabCount }, () => ({
            url: "https://example.com" + base + "index.html",
          })),
      },
    };
    const caches = {
      open: async (name) => {
        cacheNames.push(name);
        return cache;
      },
      keys: async () => [
        "unrelated-cache",
        "bluekey-pdf-" + encodeURIComponent(base) + "-old",
        "bluekey-pdf-other-scope-v11",
      ],
      delete: async (name) => removed.push(name),
    };
    const fetch = async (url) => {
      networkCalls++;
      assert.equal(url, "https://example.com" + base + "offline-assets.json");
      return { ok: true, json: async () => vendor };
    };
    vm.runInNewContext(source, {
      self,
      URL,
      caches,
      fetch,
      encodeURIComponent,
      Error,
    });
    let pending;
    events.install({ waitUntil: (promise) => (pending = promise) });
    await pending;
    assert(requests.length > 200);
    assert(
      requests.every((url) => url.startsWith("https://example.com" + base)),
    );
    assert(!requests.some((url) => url.includes("/vendor/ocr/")));
    assert.equal(skipped, false, "updates do not skip waiting automatically");
    for (const file of [
      "index.html",
      "engine-worker.js",
      "draft-storage.js",
      "project-file.js",
      "page-text.js",
      "document-analysis.js",
      "text-layout.js",
      "text-script.js",
    ])
      assert(requests.includes("https://example.com" + base + file));
    events.activate({ waitUntil: (promise) => (pending = promise) });
    await pending;
    assert(claimed);
    assert.equal(removed.length, 1);
    assert(!removed.includes("unrelated-cache"));
    const request = {
        method: "GET",
        url: "https://example.com" + base + "app.js",
      },
      cached = { cached: true };
    responses.set(request.url, cached);
    const count = networkCalls;
    events.fetch({ request, respondWith: (promise) => (pending = promise) });
    assert.equal(await pending, cached);
    assert.equal(
      networkCalls,
      count,
      "cached releases never depend on the network",
    );
    let responded = false;
    events.fetch({
      request: {
        method: "GET",
        url: "https://example.com" + base + ".git/config",
      },
      respondWith: () => (responded = true),
    });
    assert.equal(responded, false);
    if (base !== "/") {
      events.fetch({
        request: { method: "GET", url: "https://example.com/applications" },
        respondWith: () => (responded = true),
      });
      assert.equal(responded, false);
    }
    events.message({
      data: { type: "CACHE_LANGUAGES", languages: ["fra"] },
      ports: [{ postMessage: (message) => messages.push(message) }],
      waitUntil: (promise) => (pending = promise),
    });
    await pending;
    assert(messages.at(-1).ok);
    assert(
      requests.includes(
        "https://example.com" + base + "vendor/ocr/fra.traineddata",
      ),
    );
    assert(
      !requests.includes(
        "https://example.com" + base + "vendor/ocr/spa.traineddata",
      ),
    );
    tabCount = 2;
    events.message({
      data: { type: "ACTIVATE_UPDATE" },
      ports: [{ postMessage: (message) => messages.push(message) }],
      waitUntil: (promise) => (pending = promise),
    });
    await pending;
    assert(messages.at(-1).error);
    assert.equal(skipped, false);
    tabCount = 1;
    events.message({
      data: { type: "ACTIVATE_UPDATE" },
      ports: [{ postMessage: (message) => messages.push(message) }],
      waitUntil: (promise) => (pending = promise),
    });
    await pending;
    assert(skipped);
  }
  const manifest = JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  console.log(
    "PASS: scoped cache-first releases, opt-in offline OCR, explicit update activation, multiple-tab guard, essential worker assets and relative deployment paths.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
