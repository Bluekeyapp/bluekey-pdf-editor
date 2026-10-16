const path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
    headless: true,
  });
  try {
    const context = await browser.newContext(),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.error(m.text());
    });
    await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await page.evaluate(async () => {
      (await import("./i18n.js")).setLanguage("en");
    });
    console.log("loaded");
    await page.evaluate(async () => {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("SW activation timed out")), 15000),
        ),
      ]);
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    console.log("controlled");
    await page.click("#offline-languages");
    await page.locator('[name="offline-language"][value="spa"]').check();
    await page.click("#cache-languages");
    await page.waitForFunction(() =>
      document
        .querySelector("#offline-status")
        .textContent.includes("ready offline"),
    );
    await page.locator("#modal [data-close]").click();
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => !!window.pdfApp);
    console.log("offline app loaded");
    await page
      .locator("#file-input")
      .setInputFiles(path.resolve("tests/scan-fixture.pdf"));
    await page.locator("#busy").waitFor({ state: "hidden" });
    if (!(await page.locator('[data-tool="ocr"]').isVisible()))
      await page.locator(".tool-overflow > summary").click();
    await page.click('[data-tool="ocr"]');
    await page.selectOption("#ocr-language", "spa");
    await page.click("#run-ocr");
    await page
      .locator("[data-ocr-text]")
      .first()
      .waitFor({ state: "visible", timeout: 90000 });
    assert(
      (await page.locator("#ocr-lines").innerText()).includes("confidence"),
    );
    await page.click("#cancel-ocr");
    if (!(await page.locator('[data-tool="ocr"]').isVisible()))
      await page.locator(".tool-overflow > summary").click();
    await page.click('[data-tool="ocr"]');
    await page.click("#run-ocr");
    await page.click("#cancel-ocr");
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#modal").evaluate((d) => d.open), false);
    await page.click('[data-tool="content"]');
    await page.waitForSelector("#object-picker");
    const preparationCancel = await page.evaluate(async () => {
      const { recognizePage } = await import("./ocr.js"),
        canvas = document.createElement("canvas"),
        controller = new AbortController();
      canvas.width = canvas.height = 50;
      const encode = canvas.toBlob.bind(canvas);
      canvas.toBlob = (callback) =>
        encode((blob) => {
          controller.abort();
          callback(blob);
        });
      try {
        await recognizePage(canvas, "eng", () => {}, controller.signal);
        return "unexpected success";
      } catch (error) {
        return error.name;
      }
    });
    assert.equal(
      preparationCancel,
      "AbortError",
      "cancel during image preparation must not enqueue a terminated worker job",
    );
    await page.waitForTimeout(100);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: cached web app and Spanish OCR work offline; recognition can be canceled and editor remains usable.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
