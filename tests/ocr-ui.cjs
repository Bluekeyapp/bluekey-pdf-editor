const path = require("node:path"),
  fs = require("node:fs"),
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
      external = [],
      errors = [];
    context.on("request", (r) => {
      if (
        /^https?:/.test(r.url()) &&
        !r
          .url()
          .startsWith(
            (process.env.TEST_BASE_URL || "http://127.0.0.1:4173") + "/",
          )
      )
        external.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.error(m.text());
    });
    await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await page.evaluate(async () => {
      (await import("./i18n.js")).setLanguage("en");
    });
    await page.waitForFunction(() => !!window.pdfApp);
    const scan = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 1600;
      c.height = 1000;
      const x = c.getContext("2d");
      x.fillStyle = "white";
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = "black";
      x.font = "bold 72px Arial";
      x.fillText("CLIENT APPROVAL", 120, 200);
      x.font = "54px Arial";
      x.fillText("Maria Garcia", 120, 350);
      x.fillText("Invoice 12345", 120, 480);
      const d = await PDFLib.PDFDocument.create(),
        p = d.addPage([800, 500]),
        im = await d.embedPng(c.toDataURL());
      p.drawImage(im, { x: 0, y: 0, width: 800, height: 500 });
      return [...(await d.save())];
    });
    fs.writeFileSync("tests/scan-fixture.pdf", Buffer.from(scan));
    await page
      .locator("#file-input")
      .setInputFiles(path.resolve("tests/scan-fixture.pdf"));
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.click('[data-tool="ocr"]');
    await page.click("#run-ocr");
    await page
      .locator("[data-ocr-text]")
      .first()
      .waitFor({ state: "visible", timeout: 90000 });
    const lines = await page
      .locator("[data-ocr-text]")
      .evaluateAll((es) => es.map((e) => e.value));
    assert(lines.join(" ").includes("CLIENT APPROVAL"));
    assert(lines.join(" ").includes("Invoice 12345"));
    const maria = page
      .locator("[data-ocr-text]")
      .filter({ hasText: "Maria Garcia" });
    await maria.fill("María García");
    await page.screenshot({ path: "tests/ocr-review.png", fullPage: true });
    await page.click("#preview-rebuild");
    await page.waitForFunction(
      () => !document.querySelector("#build-ocr").disabled,
    );
    await page.click("#build-ocr");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForSelector("#object-picker");
    const text = await page.evaluate(async () => {
      const pdfjs = await import("/vendor/pdf.min.mjs");
      const d = await pdfjs.getDocument({
        data: await pdfApp.exportBytes(),
        standardFontDataUrl: "/vendor/standard_fonts/",
      }).promise;
      return (await (await d.getPage(1)).getTextContent()).items
        .map((i) => i.str)
        .join(" ");
    });
    assert(text.includes("María García"));
    assert(text.includes("Invoice 12345"));
    assert.equal(await page.locator("#page-count").innerText(), "1");
    await page
      .getByRole("button", {
        name: "Edit PDF · Text: María García",
        exact: true,
      })
      .click();
    await page.locator("#inline-content-text").fill("Client reviewed");
    await page.click("#apply-content");
    await page.locator("#busy").waitFor({ state: "hidden" });
    assert.deepEqual(external, [], "OCR never requests an external service");
    assert.deepEqual(errors, []);
    console.log(
      "PASS: local OCR on image-only PDF, recognized text review, accented correction, separate reconstructed editable PDF, subsequent native editing, no external requests.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
