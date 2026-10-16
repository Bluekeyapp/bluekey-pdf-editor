const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");
(async () => {
  const browser = await chromium.launch({
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("BROWSER", e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error("CONSOLE", m.text());
  });
  try {
    await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await page.evaluate(async () => {
      (await import("./i18n.js")).setLanguage("en");
    });
    await page.waitForFunction(() => !!window.pdfApp);
    await page.screenshot({ path: "tests/home-desktop.png", fullPage: true });
    await page.click("#sample-card");
    await page.waitForSelector(".pdf-field");
    await page.waitForSelector("#busy", { state: "hidden" });
    assert.equal(await page.locator("#page-count").textContent(), "2");
    await page.locator('[data-field-name="full_name"]').fill("Jane Client");
    await page.locator('[data-field-name="email"]').fill("jane@example.com");
    await page.locator('[data-field-name="approved"]').check();
    await page
      .locator('[data-field-name="service"]')
      .selectOption("Document review");
    await page.locator('[data-tool="text"]').click();
    let box = await page.locator("#marks-canvas").boundingBox();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.74);
    await page.locator("#mark-text").fill("Approved for testing");
    await page.locator("#size").click();
    assert.equal(
      await page.evaluate(() => pdfApp.getState().pages[0].marks[0].text),
      "Approved for testing",
    );
    await page.locator('[data-tool="sign"]').click();
    await page.click("#sig-type");
    await page.fill("#signature-name", "Jane Client");
    await page.click("#sig-use");
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => pdfApp.getState().pages[0].marks.length),
      2,
    );
    await page.click("#undo");
    assert.equal(
      await page.evaluate(() => pdfApp.getState().pages[0].marks.length),
      1,
    );
    await page.click("#redo");
    await page.screenshot({ path: "tests/editor-desktop.png", fullPage: true });
    await page.click("#save-draft");
    await page.waitForFunction(
      () =>
        document.querySelector("#save-status").textContent ===
        "Draft saved on this device",
    );
    await page.reload();
    await page.waitForSelector(".doc-open");
    await page.click(".doc-open");
    await page.waitForSelector(".pdf-field");
    await page.waitForSelector("#busy", { state: "hidden" });
    assert.equal(
      await page.locator('[data-field-name="full_name"]').inputValue(),
      "Jane Client",
    );
    assert.equal(
      await page.evaluate(() => pdfApp.getState().pages[0].marks.length),
      2,
    );
    const bytes = await page.evaluate(async () =>
      Array.from(await pdfApp.exportBytes()),
    );
    fs.writeFileSync("tests/completed.pdf", Buffer.from(bytes));
    const out = await PDFDocument.load(Uint8Array.from(bytes));
    assert.equal(out.getPageCount(), 2);
    assert.equal(out.getForm().getFields().length, 0);
    const content = await page.evaluate(async (b) => {
      const p = await import("/vendor/pdf.min.mjs");
      const doc = await p.getDocument({ data: new Uint8Array(b) }).promise;
      return (await (await doc.getPage(1)).getTextContent()).items
        .map((i) => i.str)
        .join(" ");
    }, bytes);
    assert(content.includes("Jane Client"), "filled name survives export");
    assert(
      content.includes("Approved for testing"),
      "added text survives export",
    );
    assert(content.includes("Document review"), "dropdown survives export");
    await page.click("#rotate");
    await page.waitForTimeout(700);
    assert.equal(
      await page.evaluate(() => pdfApp.getState().pages[0].rotation),
      90,
    );
    const rotated = await page.evaluate(async () =>
      Array.from(await pdfApp.exportBytes()),
    );
    const rotatedDoc = await PDFDocument.load(Uint8Array.from(rotated));
    assert.equal(rotatedDoc.getPage(0).getRotation().angle, 90);
    await page.click("#move-down");
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => pdfApp.getState().pages[1].rotation),
      90,
    );
    await page.click("#undo");
    await page.click("#export");
    const dl = page.waitForEvent("download");
    await page.click("#download-pdf");
    const download = await dl;
    assert(download.suggestedFilename().endsWith(".pdf"));
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.click("#back");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "tests/home-mobile.png", fullPage: true });
    await page.click(".doc-open");
    await page.waitForSelector(".pdf-field");
    await page.waitForSelector("#busy", { state: "hidden" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "tests/editor-mobile.png", fullPage: true });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "mobile page should not overflow horizontally",
    );
    await page.locator('[data-tool="pages"]').click();
    await page.click("#p-extract");
    const dl2 = page.waitForEvent("download");
    await page.click("#download-pdf");
    await (await dl2).saveAs("tests/extracted.pdf");
    const extracted = await PDFDocument.load(
      fs.readFileSync("tests/extracted.pdf"),
    );
    assert.equal(extracted.getPageCount(), 1);
    assert.deepEqual(errors, [], "no browser exceptions");
    console.log(
      "PASS: sample, forms, text, signature, undo/redo, IndexedDB reload, flattened export, exported text, rotation, reorder, download, mobile layout, extraction.",
    );
  } catch (e) {
    await page.screenshot({ path: "tests/failure.png", fullPage: true });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
