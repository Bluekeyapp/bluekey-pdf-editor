const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
  try {
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await page.waitForFunction(() => !!window.pdfApp);
    await page.evaluate(async () => {
      (await import("./i18n.js")).setLanguage("en");
    });
    await page.click("#sample-card");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.locator('[data-field-name="full_name"]').fill("María Portable");
    await page.click('[data-tool="text"]');
    const box = await page.locator("#marks-canvas").boundingBox();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.75);
    await page.locator("#mark-text").fill("Ελληνικά — Привет");
    await page.click("#save-draft");
    await page.waitForFunction(
      () =>
        document.querySelector("#save-status").textContent ===
        "Draft saved on this device",
    );
    // A quota failure must preserve the active state, both for Home and import.
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.restoreStorage = () => (IDBObjectStore.prototype.put = put);
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "documents")
          throw new DOMException(
            "Simulated quota failure",
            "QuotaExceededError",
          );
        return put.apply(this, args);
      };
    });
    await page.locator("#mark-text").fill("Ελληνικά — unsaved");
    await page.click("#back");
    await page.waitForSelector("#recover-project");
    assert(await page.evaluate(() => !!pdfApp.getState()));
    assert(
      (await page.locator("#save-status").innerText()).includes("not saved"),
    );
    await page.click("#recover-pdf");
    await page.click("#download-pdf");
    await page.waitForFunction(() =>
      document
        .querySelector("#export-result")
        .textContent.includes("Draft not saved"),
    );
    await page.locator("#modal [data-close]").click();
    await page.click("#back");
    const download = page.waitForEvent("download");
    await page.click("#recover-project");
    await (await download).saveAs("tests/portable.bluekey.json");
    await page.waitForFunction(() => pdfApp.getState() === null);
    await page.evaluate(() => restoreStorage());
    // Reopen in a separate browser context with no IndexedDB or language history.
    const fresh = await browser.newContext(),
      restored = await fresh.newPage();
    restored.on("pageerror", (error) => errors.push(error.message));
    await restored.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await restored.waitForFunction(() => !!window.pdfApp);
    await restored.evaluate(async () => {
      (await import("./i18n.js")).setLanguage("en");
    });
    await restored
      .locator("#project-input")
      .setInputFiles(path.resolve("tests/portable.bluekey.json"));
    await restored.waitForSelector(".pdf-field");
    await restored.locator("#busy").waitFor({ state: "hidden" });
    const recovered = await restored.evaluate(() => pdfApp.getState());
    assert.equal(recovered.sources[0].values.full_name, "María Portable");
    assert.equal(recovered.pages[0].marks[0].text, "Ελληνικά — unsaved");
    await restored.click('[data-tool="search"]');
    await restored.fill("#find-text", "document");
    await restored.click("#find-go");
    await restored.waitForSelector(".search-match");
    const first = await restored.locator("#find-count").innerText();
    await restored.click("#find-next");
    await restored.waitForFunction(
      (old) => document.querySelector("#find-count").textContent !== old,
      first,
    );
    assert.notEqual(await restored.locator("#find-count").innerText(), first);
    await restored.click('[data-tool="select"]');
    assert(
      (await restored.locator(".textLayer span").count()) > 0,
      "selectable page text exists",
    );
    await restored.evaluate(() => {
      const span = document.querySelector(".textLayer span");
      const selection = getSelection(),
        range = document.createRange();
      range.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    assert(
      (await restored.evaluate(() => getSelection().toString())).length > 0,
    );
    await restored.setViewportSize({ width: 390, height: 844 });
    await restored.waitForFunction(
      () =>
        document.querySelector("#page-wrap").getBoundingClientRect().width <=
        innerWidth,
    );
    await restored.screenshot({
      path: "tests/reliability-mobile.png",
      fullPage: true,
    });
    assert(
      await restored.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    // Independently compare rendered pixels outside the edited native text box.
    const visual = await restored.evaluate(async () => {
      const { inspectContent } = await import("./engine-client.js"),
        { exportPdf } = await import("./pdf-core.js"),
        pdfjs = await import("./vendor/pdf.min.mjs");
      const d = await PDFLib.PDFDocument.create(),
        p = d.addPage([400, 400]);
      p.drawText("Old text", { x: 40, y: 300, size: 20 });
      p.drawText("Unchanged neighbor", { x: 40, y: 200, size: 18 });
      const bytes = await d.save(),
        item = (await inspectContent(bytes, 0)).items[0],
        state = {
          name: "visual",
          sources: [{ id: "s", bytes, values: {} }],
          pages: [
            {
              source: "s",
              index: 0,
              rotation: 0,
              marks: [],
              contentEdits: {
                [item.id]: { type: "text", text: "New text", fit: "shrink" },
              },
            },
          ],
        };
      const render = async (data) => {
        const doc = await pdfjs.getDocument({
          data,
          standardFontDataUrl: "./vendor/standard_fonts/",
        }).promise;
        try {
          const page = await doc.getPage(1),
            canvas = document.createElement("canvas");
          canvas.width = 400;
          canvas.height = 400;
          await page.render({
            canvasContext: canvas.getContext("2d"),
            viewport: page.getViewport({ scale: 1 }),
          }).promise;
          return canvas.getContext("2d").getImageData(0, 0, 400, 400).data;
        } finally {
          await doc.destroy();
        }
      };
      const before = await render(bytes.slice()),
        after = await render(await exportPdf(state));
      let outside = 0,
        inside = 0;
      for (let y = 0; y < 400; y++)
        for (let x = 0; x < 400; x++) {
          const at = (y * 400 + x) * 4;
          if (
            before[at] !== after[at] ||
            before[at + 1] !== after[at + 1] ||
            before[at + 2] !== after[at + 2]
          ) {
            if (x >= 35 && x <= 140 && y >= 75 && y <= 110) inside++;
            else outside++;
          }
        }
      return { outside, inside };
    });
    assert.equal(visual.outside, 0);
    assert(visual.inside > 0);
    // Canceling a worker operation must reject promptly and allow another operation.
    const cancellation = await restored.evaluate(async () => {
      const engine = await import("./engine-client.js"),
        controller = new AbortController();
      const promise = engine
        .engineCall("inspectContent", [pdfApp.getState().sources[0].bytes, 0], {
          signal: controller.signal,
        })
        .then(
          () => false,
          (error) => error.name === "AbortError",
        );
      controller.abort();
      const canceled = await promise;
      const next = await engine.inspectContent(
        pdfApp.getState().sources[0].bytes,
        0,
      );
      return canceled && next.items.length > 0;
    });
    assert(cancellation);
    // Migrate an actual v1 database, then prove library reads use summaries only.
    const legacyContext = await browser.newContext(),
      legacy = await legacyContext.newPage();
    await legacy.route("**/seed.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Migration setup</title>",
      }),
    );
    await legacy.goto(
      (process.env.TEST_BASE_URL || "http://127.0.0.1:4173") + "/seed.html",
    );
    await legacy.evaluate(async () => {
      await import("../vendor/pdf-lib.min.js");
      const { createSample } = await import("../pdf-core.js"),
        bytes = await createSample();
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("bluekey-pdf", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("documents", { keyPath: "id" });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("documents", "readwrite");
          tx.objectStore("documents").put({
            id: "legacy",
            name: "Legacy.pdf",
            updated: Date.now(),
            sources: [{ id: "legacy-source", bytes, values: {} }],
            pages: [
              {
                id: "legacy-page",
                source: "legacy-source",
                index: 0,
                rotation: 0,
                marks: [],
              },
            ],
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    });
    await legacyContext.addInitScript(() => {
      const original = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        if (this.name === "documents") throw Error("Library loaded full PDFs");
        return original.apply(this, args);
      };
    });
    await legacy.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await legacy.waitForSelector(".doc-open");
    assert(
      (await legacy.locator(".doc-info").innerText()).includes("Legacy.pdf"),
    );
    await legacy.click(".doc-open");
    await legacy.locator("#busy").waitFor({ state: "hidden" });
    assert.equal(await legacy.locator("#page-count").innerText(), "1");
    const many = await legacy.evaluate(async () => {
      const d = await PDFLib.PDFDocument.create();
      for (let i = 0; i < 40; i++) d.addPage([200, 200]);
      return [...(await d.save())];
    });
    await legacy.locator("#file-input").setInputFiles({
      name: "forty.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(many),
    });
    await legacy.waitForFunction(() => pdfApp.getState()?.pages.length === 40);
    await legacy.locator("#busy").waitFor({ state: "hidden" });
    await legacy.click('[data-page="39"]');
    await legacy.waitForSelector('[data-page="39"] img');
    await legacy.click("#back");
    await legacy.waitForFunction(() => pdfApp.getState() === null);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: storage-failure navigation guard and honest export status, portable project across browsers, selectable/searchable text, mobile layout and independent PDF pixel preservation.",
    );
  } catch (error) {
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page
          .screenshot({ path: "tests/reliability-failure.png", fullPage: true })
          .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
