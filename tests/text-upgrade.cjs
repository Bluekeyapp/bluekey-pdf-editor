const assert = require("node:assert/strict"),
  fs = require("node:fs");
(async () => {
  globalThis.self = globalThis;
  await import("../vendor/pdf-lib.min.js");
  const { PDFDocument, PDFName, StandardFonts, rgb } = PDFLib,
    { inspectContent, previewContent } = await import("../content-engine.js"),
    { textBlocks, collisionItems } = await import("../text-model.js");
  const d = await PDFDocument.create(),
    p = d.addPage([595, 842]),
    f = await d.embedFont(StandardFonts.Helvetica);
  const text = (s, y) =>
    p.drawText(s, { x: 45, y, size: 15, font: f, color: rgb(0.09, 0.23, 0.2) });
  p.drawText("Text editing lab", { x: 45, y: 780, size: 26, font: f });
  text("This sentence starts in one text run.", 710);
  text("The next line belongs to the same paragraph.", 690);
  text("Edit these three lines as one text block.", 670);
  text("An independent line must remain unchanged.", 560);
  const encoding = d.context.obj({
    BaseEncoding: "WinAnsiEncoding",
    Differences: [65, PDFName.of("Aacute"), 66, PDFName.of("uni03A9")],
  });
  const font = d.context.obj({
    Type: "Font",
    Subtype: "Type1",
    BaseFont: "CustomTest",
    Encoding: encoding,
    FirstChar: 65,
    LastChar: 66,
    Widths: [667, 750],
    FontDescriptor: {
      Type: "FontDescriptor",
      FontName: "CustomTest",
      Flags: 32,
      FontBBox: [0, -200, 1000, 900],
      ItalicAngle: 0,
      Ascent: 800,
      Descent: -200,
      CapHeight: 700,
      StemV: 80,
    },
  });
  const ep = d.addPage([595, 842]);
  ep.node.set(PDFName.of("Resources"), d.context.obj({ Font: { F: font } }));
  ep.node.set(
    PDFName.of("Contents"),
    d.context.register(
      d.context.flateStream("BT /F 24 Tf 1 0 0 1 45 720 Tm (AB) Tj ET"),
    ),
  );
  const mp = d.addPage([595, 842]),
    mf = d.context.obj({
      Type: "Font",
      Subtype: "Type1",
      BaseFont: "Helvetica",
      Encoding: "MacRomanEncoding",
    });
  mp.node.set(PDFName.of("Resources"), d.context.obj({ Font: { F: mf } }));
  mp.node.set(
    PDFName.of("Contents"),
    d.context.register(
      d.context.flateStream("BT /F 20 Tf 1 0 0 1 45 720 Tm <4361668e> Tj ET"),
    ),
  );
  const input = await d.save(),
    items = (await inspectContent(input, 0)).items,
    blocks = textBlocks(items);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].items.length, 3);
  assert.equal((await inspectContent(input, 1)).items[0].text, "ÁΩ");
  assert((await inspectContent(input, 1)).items[0].editable);
  assert.equal((await inspectContent(input, 2)).items[0].text, "Café");
  const leader = blocks[0].items[0],
    ids = blocks[0].items.map((i) => i.id),
    edits = {
      [leader.id]: {
        type: "text",
        text: "Résumé: Ελληνικά — Привет мир\nA second editable line.",
        fit: "wrap",
        width: 460,
        font: "embedded",
        groupIds: ids,
      },
    };
  for (const id of ids.slice(1))
    edits[id] = { type: "text", text: "", groupLeader: leader.id };
  const output = await previewContent(input, 0, edits),
    after = (await inspectContent(output, 0)).items;
  assert(after.some((i) => i.text.includes("Ελληνικά")));
  assert(after.some((i) => i.text.includes("Привет")));
  assert(!after.some((i) => i.text.includes("The next line")));
  assert(
    after.some((i) => i.text === "An independent line must remain unchanged."),
  );
  const next = after.find(
    (i) => i.text === "An independent line must remain unchanged.",
  );
  assert.deepEqual(next.matrix, items.at(-1).matrix);
  const info = await import("../font-manager.js");
  const rec = await info.fontRecord();
  info.assertFontCoverage(rec, "Ελληνικά Привет");
  assert.throws(() => info.assertFontCoverage(rec, "中文"), /cannot encode/);
  const customData =
    "data:font/ttf;base64," +
    fs
      .readFileSync("vendor/standard_fonts/LiberationSans-Regular.ttf")
      .toString("base64");
  assert.equal((await info.fontRecord("custom", customData)).name, rec.name);
  const layout = await (
    await import("../content-engine.js")
  ).textLayout(leader, {
    text: "x\nx\nx\nx\nx\nx\nx\nx\nx",
    fit: "keep",
    width: 450,
    size: 15,
  });
  assert(collisionItems(leader, layout, items, ids).length > 0);
  fs.writeFileSync("tests/text-upgrade-before.pdf", input);
  fs.writeFileSync("tests/text-upgrade-after.pdf", output);
  // A friendly playground with real glyphs plus a deliberately clipped area.
  const demo = await PDFDocument.create(),
    [first] = await demo.copyPages(d, [0]);
  demo.addPage(first);
  const clipped = demo.addPage([595, 842]),
    df = await demo.embedFont(StandardFonts.Helvetica);
  clipped.node.set(
    PDFName.of("Resources"),
    demo.context.obj({ Font: { F: df.ref } }),
  );
  clipped.node.set(
    PDFName.of("Contents"),
    demo.context.register(
      demo.context.flateStream(
        "BT /F 24 Tf 1 0 0 1 45 770 Tm (Try area reconstruction) Tj ET q 40 620 500 90 re W n BT /F 18 Tf 1 0 0 1 45 660 Tm (This clipped text needs an editable copy.) Tj ET Q",
      ),
    ),
  );
  const scan = await PDFDocument.load(
    fs.readFileSync("examples/scanned-page.pdf"),
  );
  const [sp] = await demo.copyPages(scan, [0]);
  demo.addPage(sp);
  fs.writeFileSync("tests/text-editing-lab.pdf", await demo.save());
  console.log(
    "PASS: MacRoman and Differences maps, paragraph grouping, Unicode font embedding, custom font coverage, grouped replacement removes old runs and preserves neighbors, overlap detection.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
