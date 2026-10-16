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
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.error(m.text());
    });
    await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await page.evaluate(async () => {
      (await import("./i18n.js")).setLanguage("en");
    });
    await page.click("#sample-card");
    await page.waitForSelector(".pdf-field");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.click('[data-tool="content"]');
    await page
      .getByRole("button", {
        name: "Edit PDF · Text: Let's make it official.",
        exact: true,
      })
      .click();
    await page.locator("#inline-content-text").fill("María approved");
    await page.click("#apply-content");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForSelector("#content-text");
    assert.equal(
      await page.locator("#content-text").inputValue(),
      "María approved",
    );
    await page.click("#show-original");
    await page.waitForSelector("#show-edited");
    await page.locator("#inline-content-text").waitFor({ state: "detached" });
    assert.equal(await page.locator("#inline-content-text").count(), 0);
    await page.click("#show-edited");
    await page.waitForSelector("#content-text");
    await page.click("#undo");
    await page.waitForFunction(
      () =>
        document.querySelector("#content-text")?.value ===
        "Let's make it official.",
    );
    await page.click("#redo");
    await page.waitForFunction(
      () => document.querySelector("#content-text")?.value === "María approved",
    );
    await page
      .locator("#content-text")
      .fill("This is a substantially longer replacement sentence for review.");
    await page.locator("#text-fit").selectOption("keep");
    await page.waitForFunction(() =>
      document.querySelector("#edit-status")?.textContent.includes("exceeds"),
    );
    await page.locator("#text-fit").selectOption("wrap");
    await page.waitForTimeout(150);
    assert((await page.locator("#edit-status").innerText()).includes("lines"));
    await page.click("#cancel-content");
    assert.equal(
      await page.locator("#content-text").inputValue(),
      "María approved",
    );
    await page.locator("#save-menu > summary").click();
    await page.click("#save-draft");
    await page.waitForTimeout(500);
    await page.reload();
    await page.locator(".doc-open").first().click();
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.click('[data-tool="content"]');
    await page
      .getByRole("button", {
        name: "Edit PDF · Text: Let's make it official.",
        exact: true,
      })
      .click();
    assert.equal(
      await page.locator("#content-text").inputValue(),
      "María approved",
    );
    const extracted = await page.evaluate(async () => {
      const { exportPdf } = await import("/pdf-core.js"),
        pdfjs = await import("/vendor/pdf.min.mjs");
      const bytes = await exportPdf(pdfApp.getState());
      const doc = await pdfjs.getDocument({
        data: bytes,
        standardFontDataUrl: "/vendor/standard_fonts/",
      }).promise;
      return (await (await doc.getPage(1)).getTextContent()).items
        .map((i) => i.str)
        .join(" ");
    });
    assert(extracted.includes("María approved"));
    assert(!extracted.includes("Let's make it official."));
    await page.screenshot({
      path: "tests/content-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: "tests/content-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.click("#back");
    // The click starts asynchronous draft saving and resource cleanup. Wait for
    // the library before importing, otherwise home() can hide the new editor.
    await page.locator("#home").waitFor({ state: "visible" });
    await page.waitForFunction(() => pdfApp.getState() === null);
    await page
      .locator("#file-input")
      .setInputFiles(path.resolve("tests/content-fixture.pdf"));
    await page.waitForFunction(
      () => pdfApp.getState()?.name === "content-fixture.pdf",
    );
    await page.locator("#editor").waitFor({ state: "visible" });
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.click('[data-tool="content"]');
    await page
      .getByRole("button", { name: /^Edit PDF · Image:/ })
      .first()
      .click();
    await page
      .locator("#replace-content-image")
      .setInputFiles(path.resolve("tests/content-desktop.png"));
    await page.waitForFunction(() =>
      document
        .querySelector("#edit-status")
        ?.textContent.includes("Replacement ready"),
    );
    await page.locator("#image-dx").fill("25");
    await page.locator("#image-scaleX").fill("1.5");
    await page.locator("#image-rotation").fill("30");
    await page.click("#apply-content");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForSelector("#image-dx");
    assert.equal(
      await page.locator("#image-dx").inputValue(),
      "25",
      await page.locator("#toast").innerText(),
    );
    const edits = await page.evaluate(() =>
      Object.values(pdfApp.getState().pages[0].contentEdits),
    );
    assert.equal(edits[0].scaleX, 1.5);
    assert.equal(edits[0].scaleY, 1.5);
    assert.equal(edits[0].rotation, 30);
    await page.click("#reset-object");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForSelector("#image-dx");
    assert.equal(await page.locator("#image-dx").inputValue(), "0");
    await page.click("#remove-content-image");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page.waitForSelector("#object-picker", { state: "attached" });
    assert.equal(
      await page.getByRole("button", { name: /^Edit PDF · Image:/ }).count(),
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: direct selection, inline editing, overflow/wrap, comparison, undo/redo, draft recovery, export extraction, mobile layout, proportional image replacement/transform, object reset/removal.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
