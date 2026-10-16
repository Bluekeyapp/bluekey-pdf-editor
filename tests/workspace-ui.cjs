const { chromium } = require("playwright"),
  assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const box = (selector) => page.locator(selector).boundingBox();
  const disjoint = (a, b) =>
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y;
  const tool = async (id) => {
    const target = page.locator(`[data-tool="${id}"]`);
    if (!(await target.isVisible()))
      await page.locator(".tool-overflow > summary").click();
    await target.click();
  };
  try {
    await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
    await page.waitForFunction(() => !!window.pdfApp);
    assert.match(
      await page.locator(".home-footer").innerText(),
      /Les brouillons/,
    );
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.click("#text-demo");
    await page.locator("#busy").waitFor({ state: "hidden" });
    await page
      .getByRole("button", {
        name: "Edit PDF · Text: This sentence starts in one text run.",
        exact: true,
      })
      .click();
    await page.waitForSelector("#inline-content-text");
    await page.waitForTimeout(100);
    assert(
      disjoint(
        await box(".inline-formatbar"),
        await box("#inline-content-text"),
      ),
      "desktop toolbar must clear its text",
    );
    assert(
      (await box("#content-text")).y < 500,
      "replacement controls appear before long page instructions",
    );
    assert.equal(
      await page.locator(".advanced-settings").getAttribute("open"),
      null,
    );
    // Blank paper dismisses the editor, leaving nearby text available to click.
    await page.locator("#page-wrap").click({ position: { x: 8, y: 80 } });
    assert.equal(await page.locator("#inline-content-text").count(), 0);
    assert.equal(await page.locator(".inline-formatbar").count(), 0);
    await page
      .getByRole("button", {
        name: "Edit PDF · Text: This sentence starts in one text run.",
        exact: true,
      })
      .click();
    assert(await page.locator("#inline-content-text").isVisible());
    await page.locator("#save-menu > summary").click();
    assert(await page.locator("#backup-project").isVisible());
    assert.match(
      await page.locator(".save-options").innerText(),
      /automatically/,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#save-menu").getAttribute("open"), null);
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `no page overflow at ${width}`,
      );
      const toolbar = await box(".inline-formatbar"),
        input = await box("#inline-content-text");
      assert(disjoint(toolbar, input), `toolbar clears text at ${width}`);
      assert(
        toolbar.x >= 0 && toolbar.x + toolbar.width <= width + 1,
        `formatting fits at ${width}`,
      );
      assert.equal(
        await page.locator(".tool-overflow").getAttribute("open"),
        null,
      );
      await page.locator(".tool-overflow > summary").click();
      const menu = await box(".tool-menu");
      assert(
        menu.x >= 0 && menu.x + menu.width <= width + 1,
        `tools menu fits at ${width}`,
      );
      await page.keyboard.press("Escape");
      if (width <= 760) {
        // Use an outside target that stays clear of the wrapping mobile toolbar.
        await page.locator("#page-hint").click();
        assert.equal(await page.locator("#inline-content-text").count(), 0);
        assert.equal(await page.locator(".inline-formatbar").count(), 0);
        await page
          .getByRole("button", {
            name: "Edit PDF · Text: This sentence starts in one text run.",
            exact: true,
          })
          .click();
        assert.equal(await page.locator("#properties").isVisible(), false);
        await page.click("#inline-more");
        assert(await page.locator("#content-text").isVisible());
        assert.equal(
          await page
            .locator("#toggle-properties")
            .getAttribute("aria-expanded"),
          "true",
        );
        await page.click("#toggle-properties");
        assert.equal(await page.locator("#properties").isVisible(), false);
        const undo = await box("#undo"),
          exportBox = await box("#export");
        assert(
          Math.abs(undo.y - exportBox.y) < 10,
          "header actions have a deliberate shared row",
        );
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    await page.screenshot({ path: "tests/workspace-mobile.png" });
    await tool("ocr");
    await page.waitForFunction(
      () => !document.querySelector("#preview-rebuild")?.disabled,
    );
    assert(await page.locator('[data-ocr-text="0"]').isVisible());
    assert.equal(
      await page
        .locator("#ocr-lines")
        .evaluate((e) => getComputedStyle(e).overflowY),
      "visible",
    );
    assert.equal(await page.locator("#rebuild-preview").isVisible(), false);
    const body = await box(".rebuild-body"),
      footer = await box("#rebuild-workspace > footer");
    assert(
      body.y + body.height <= footer.y + 1,
      "footer does not overlay correction fields",
    );
    await page.screenshot({ path: "tests/workspace-ocr-mobile.png" });
    // This fixture's extracted glyph boxes cut across native runs. The app must
    // retain its safety refusal; explicitly preview the opt-in fallback here.
    await page.locator(".rebuild-settings > summary").click();
    await page.check("#raster-fallback");
    await page.click("#preview-rebuild");
    await page.waitForFunction(
      () => !document.querySelector("#build-ocr")?.disabled,
    );
    assert.equal(
      await page.locator("#rebuild-workspace").getAttribute("data-step"),
      "compare",
    );
    assert(await page.locator("#rebuild-preview").isVisible());
    await page.click("#ocr-review-step");
    await page.locator('[data-ocr-text="0"]').fill("Reviewed title");
    assert(
      await page.locator("#build-ocr").isDisabled(),
      "corrections invalidate an older preview",
    );
    assert(await page.locator("#ocr-compare-step").isDisabled());
    await page.click("#cancel-ocr");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(150); // Let the responsive toolbar rebuild finish.
    await tool("search");
    await page.fill("#find-text", "sentence");
    await page.click("#find-go");
    await page.waitForSelector("mark.search-match.current");
    assert.deepEqual(
      await page.locator("mark.search-match").allTextContents(),
      ["sentence"],
    );
    assert.equal(
      await page
        .locator(".search-result b")
        .evaluate((e) => getComputedStyle(e).display),
      "block",
    );
    await tool("select");
    assert.equal(await page.locator("mark.search-match").count(), 0);
    await page.getByRole("button", { name: "Français", exact: true }).click();
    await page.click("#back");
    await page.waitForSelector("#offline-languages");
    await page.click("#offline-languages");
    await page.getByRole("button", { name: "Fermer", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: contextual properties, save menu, exact search highlights, toolbar clearance and overflow menus at 1440/1100/390/320px, mobile drawer and header, OCR single-scroll review/compare/footer, preview invalidation and French UI.",
    );
  } catch (error) {
    await page.screenshot({
      path: "tests/workspace-failure.png",
      fullPage: true,
    });
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
