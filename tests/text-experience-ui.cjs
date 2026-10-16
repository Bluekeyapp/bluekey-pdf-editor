const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  path = require("node:path");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    page = await context.newPage();
    const errors = [],
      external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    context.on("request", (request) => {
      if (
        /^https?:/.test(request.url()) &&
        !request
          .url()
          .startsWith(process.env.TEST_BASE_URL || "http://127.0.0.1:4173")
      )
        external.push(request.url());
    });
    await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await page.waitForFunction(() => !!window.pdfApp);
    await page.evaluate(async () => {
      (await import("./i18n.js")).setLanguage("en");
    });
    const bytes = await page.evaluate(async () => {
      const d = await PDFLib.PDFDocument.create(),
        font = await d.embedFont("Helvetica");
      d.addPage([600, 800]).drawText("First editable sentence.", {
        x: 45,
        y: 700,
        size: 20,
        font,
      });
      d.getPage(0).drawText("Paragraph line one.", {
        x: 45,
        y: 600,
        size: 16,
        font,
      });
      d.getPage(0).drawText("Paragraph line two.", {
        x: 45,
        y: 580,
        size: 16,
        font,
      });
      d.getPage(0).drawText("Neighbor remains unchanged.", {
        x: 45,
        y: 500,
        size: 18,
        font,
      });
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 800;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 1200, 800);
      ctx.fillStyle = "black";
      ctx.font = "bold 64px Arial";
      ctx.fillText("SCANNED CLIENT", 80, 160);
      ctx.font = "52px Arial";
      ctx.fillText("Maria Garcia", 80, 330);
      const image = await d.embedPng(canvas.toDataURL());
      d.addPage([600, 400]).drawImage(image, {
        x: 0,
        y: 0,
        width: 600,
        height: 400,
      });
      const searchable = d.addPage([600, 400]);
      searchable.drawImage(image, { x: 0, y: 0, width: 600, height: 400 });
      searchable.pushOperators(PDFLib.setTextRenderingMode(3));
      searchable.drawText("SCANNED CLIENT", { x: 40, y: 320, size: 32, font });
      searchable.drawText("Maria Garcia", { x: 40, y: 235, size: 26, font });
      searchable.pushOperators(PDFLib.setTextRenderingMode(0));
      const mixed = d.addPage([600, 500]);
      mixed.drawText("Native heading", { x: 40, y: 450, size: 24, font });
      mixed.drawImage(image, { x: 0, y: 0, width: 600, height: 400 });
      return [...(await d.save())];
    });
    await page.locator("#file-input").setInputFiles({
      name: "text-experience.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(bytes),
    });
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForSelector("#object-picker");
    await page.click("#toggle-analysis");
    await page.waitForFunction(() =>
      document
        .querySelector("#document-analysis")
        .textContent.includes("Paused"),
    );

    await page.selectOption("#text-selection", "paragraph");
    await page
      .getByRole("button", {
        name: "Edit PDF · Text: Paragraph line one.",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () => pdfApp.getState().pages[0].textDraft?.buffer.groupIds?.length === 2,
    );
    assert(
      (await page.locator("#inline-content-text").inputValue()).includes(
        "Paragraph line two.",
      ),
    );
    await page.click("#inline-cancel");
    await page.selectOption("#text-selection", "word");
    await page
      .getByRole("button", {
        name: "Edit PDF · Text: First editable sentence.",
        exact: true,
      })
      .click();
    await page.keyboard.type("revised");
    await page.waitForFunction(
      () =>
        document.querySelector("#inline-content-text")?.value ===
        "First revised sentence.",
    );
    await page
      .locator("#inline-content-text")
      .fill("Unfinished changed sentence.");
    await page.evaluate(() => {
      const input = document.querySelector("#inline-content-text");
      input.setSelectionRange(3, 12);
      input.dispatchEvent(new Event("select"));
    });
    await page.click("#save-draft");
    await page.waitForFunction(
      () =>
        document.querySelector("#save-status").textContent ===
        "Draft saved on this device",
    );
    await page.click("#zoom-in");
    await page.waitForFunction(
      () =>
        document.querySelector("#inline-content-text")?.value ===
        "Unfinished changed sentence.",
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#inline-content-text")?.selectionStart === 3,
    );
    await page.click("#rotate");
    await page.waitForFunction(
      () => pdfApp.getState().pages[0].rotation === 90,
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#inline-content-text")?.value ===
        "Unfinished changed sentence.",
    );
    assert(
      (
        await page.locator("#inline-content-text").getAttribute("style")
      ).includes("matrix("),
    );
    const projectDownload = page.waitForEvent("download");
    await page.click("#backup-project");
    await (await projectDownload).saveAs("tests/typing.bluekey.json");
    await page.click("#save-draft");
    await page.waitForFunction(
      () =>
        document.querySelector("#save-status").textContent ===
        "Draft saved on this device",
    );
    if ((await page.locator("#toggle-analysis").innerText()).includes("Resume"))
      await page.click("#toggle-analysis");
    await page.reload();
    await page.waitForSelector(".doc-open");
    await page.click(".doc-open");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.querySelector("#inline-content-text")?.value ===
        "Unfinished changed sentence.",
    );
    await page.locator("#text-dx").fill("8");
    await page.locator("#text-dy").fill("-8");
    await page.locator("#inline-color").fill("#b52244");
    await page.locator("#inline-family").selectOption("Times");
    await page.click("#inline-bold");
    await page.click("#inline-apply");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        !pdfApp.getState().pages[0].textDraft &&
        Object.values(pdfApp.getState().pages[0].contentEdits || {}).some(
          (edit) => edit.text === "Unfinished changed sentence.",
        ),
    );
    const style = await page.evaluate(
      () => Object.values(pdfApp.getState().pages[0].contentEdits)[0],
    );
    assert.equal(style.color, "#b52244");
    assert.equal(style.style, "bold");
    assert.equal(style.family, "Times");
    assert.equal(style.dx, 8);
    await page.click("#undo");
    await page.waitForFunction(
      () => !Object.keys(pdfApp.getState().pages[0].contentEdits || {}).length,
    );
    await page.click("#redo");
    await page.waitForFunction(
      () =>
        Object.keys(pdfApp.getState().pages[0].contentEdits || {}).length > 0,
    );
    await page.click('[data-page="2"]');
    await page.waitForFunction(() =>
      document
        .querySelector("#document-analysis")
        .textContent.includes("searchable-scan"),
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label^="Make this text editable: "]')
          .length === 2,
    );
    assert.equal(
      await page
        .locator('[aria-label="Content is read-only · Text: Maria Garcia"]')
        .count(),
      0,
      "hidden OCR text is offered once through extraction",
    );
    await page.click('[data-page="1"]');
    await page.waitForSelector(
      '[aria-label="Make this text editable: Maria Garcia"]',
      { timeout: 90000 },
    );
    await page.click('[aria-label="Make this text editable: Maria Garcia"]');
    await page.locator("#recovery-inline").fill("María Reviewed");
    await page.click("#save-draft");
    await page.click("#review-recovered");
    await page.waitForSelector("[data-ocr-text]");
    assert.equal(
      await page.locator("[data-ocr-text]").first().inputValue(),
      "María Reviewed",
    );
    await page.click("#preview-rebuild");
    await page.waitForFunction(
      () => !document.querySelector("#build-ocr").disabled,
    );
    assert(
      (await page.locator("#ocr-progress").innerText()).includes(
        "Regional replacement",
      ),
    );
    await page.click("#build-ocr");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      pdfApp.getState()?.name.includes("editable copy"),
    );
    await page.waitForSelector(
      '[aria-label="Edit PDF · Text: María Reviewed"]',
    );
    assert.equal(await page.locator("#page-count").innerText(), "4");
    const output = await page.evaluate(async () => {
      const pdfjs = await import("./vendor/pdf.min.mjs"),
        bytes = await pdfApp.exportBytes(),
        doc = await pdfjs.getDocument({ data: bytes }).promise;
      try {
        return {
          first: (await (await doc.getPage(1)).getTextContent()).items
            .map((item) => item.str)
            .join(" "),
          second: (await (await doc.getPage(2)).getTextContent()).items
            .map((item) => item.str)
            .join(" "),
          mixed: (await (await doc.getPage(4)).getTextContent()).items
            .map((item) => item.str)
            .join(" "),
        };
      } finally {
        await doc.destroy();
      }
    });
    assert(output.first.includes("Unfinished changed sentence."));
    assert(output.first.includes("Neighbor remains unchanged."));
    assert(output.second.includes("María Reviewed"));
    assert(output.mixed.includes("Native heading"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () =>
        document.querySelector("#page-wrap").getBoundingClientRect().width <=
        innerWidth,
    );
    await page.screenshot({
      path: "tests/text-experience-mobile.png",
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    // A portable backup also retains the unfinished native buffer.
    const fresh = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      restored = await fresh.newPage();
    await restored.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await restored.waitForFunction(() => !!window.pdfApp);
    await restored.evaluate(async () => {
      (await import("./i18n.js")).setLanguage("en");
    });
    await restored
      .locator("#project-input")
      .setInputFiles(path.resolve("tests/typing.bluekey.json"));
    await restored.waitForSelector("#inline-content-text");
    assert.equal(
      await restored.locator("#inline-content-text").inputValue(),
      "Unfinished changed sentence.",
    );
    assert.equal(
      await restored
        .locator("#inline-content-text")
        .evaluate((input) => input.selectionStart),
      3,
    );
    const clippedBytes = await page.evaluate(async () => {
      const doc = await PDFLib.PDFDocument.create(),
        page = doc.addPage([400, 400]),
        font = await doc.embedFont("Helvetica");
      page.node.set(
        PDFLib.PDFName.of("Resources"),
        doc.context.obj({ Font: { F: font.ref } }),
      );
      page.node.set(
        PDFLib.PDFName.of("Contents"),
        doc.context.register(
          doc.context.flateStream(
            "q 35 280 300 70 re W n BT /F 20 Tf 1 0 0 1 45 310 Tm (Clipped native sentence.) Tj ET Q",
          ),
        ),
      );
      return [...(await doc.save())];
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator("#file-input")
      .setInputFiles({
        name: "clipped.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(clippedBytes),
      });
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page
      .getByRole("button", {
        name: "Content is read-only · Text: Clipped native sentence.",
        exact: true,
      })
      .click();
    await page.fill("#recovery-inline", "Reviewed native sentence.");
    await page.click("#review-recovered");
    await page.waitForSelector("[data-ocr-text]");
    await page.click("#preview-rebuild");
    await page.waitForFunction(
      () => !document.querySelector("#build-ocr").disabled,
    );
    assert.equal(await page.locator("#raster-fallback").isChecked(), false);
    await page.click("#build-ocr");
    await page.waitForSelector(
      '[aria-label="Edit PDF · Text: Reviewed native sentence."]',
    );
    const clippedText = await page.evaluate(async () => {
      const pdfjs = await import("./vendor/pdf.min.mjs"),
        doc = await pdfjs.getDocument({ data: await pdfApp.exportBytes() })
          .promise;
      try {
        return (await (await doc.getPage(1)).getTextContent()).items
          .map((item) => item.str)
          .join(" ");
      } finally {
        await doc.destroy();
      }
    });
    assert(clippedText.includes("Reviewed native sentence."));
    assert(!clippedText.includes("Clipped native sentence."));
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      "PASS: automatic text/scan/mixed/searchable-scan analysis, direct OCR typing and regional preview, unfinished typing/caret across zoom/rotation/reload/project import, floating formatting, undo/redo, exports and mobile fit.",
    );
  } catch (error) {
    if (page)
      await page
        .screenshot({
          path: "tests/text-experience-failure.png",
          fullPage: true,
        })
        .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
