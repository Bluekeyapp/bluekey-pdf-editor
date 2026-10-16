const assert = require("node:assert/strict"),
  fs = require("node:fs");
(async () => {
  await require("./fixtures.cjs")();
  globalThis.self = globalThis;
  await import("../vendor/pdf-lib.min.js");
  const { PDFDocument, PDFName, StandardFonts } = PDFLib,
    { inspectContent, previewContent, textLayout } = await import(
      "../content-engine.js"
    );
  const d = await PDFDocument.create(),
    p = d.addPage([500, 700]),
    f = await d.embedFont(StandardFonts.Helvetica),
    b = await d.embedFont(StandardFonts.HelveticaBold);
  p.node.set(
    PDFName.of("Resources"),
    d.context.obj({ Font: { F: f.ref, B: b.ref } }),
  );
  p.node.set(
    PDFName.of("Contents"),
    d.context.register(
      d.context.flateStream(
        "q 1 0 0 1 10 20 cm BT /F 14 Tf 1 0 0 1 30 500 Tm [(First) 40 ( run)] TJ /B 14 Tf (Neighbor) Tj 18 TL T* /F 14 Tf (Next line) Tj ET Q",
      ),
    ),
  );
  const original = await d.save(),
    before = await inspectContent(original, 0),
    first = before.items[0];
  assert.equal(first.text, "First run");
  assert.equal(before.items.length, 3);
  const edits = {
    [first.id]: { type: "text", text: "María approved", fit: "shrink" },
  };
  const after = await inspectContent(
    await previewContent(original, 0, edits),
    0,
  );
  assert.equal(after.items[0].text, "María approved");
  for (let i = 1; i < 3; i++)
    for (let n = 0; n < 6; n++)
      assert(
        Math.abs(after.items[i].matrix[n] - before.items[i].matrix[n]) < 0.0001,
        "mixed-style neighbor and next line unchanged",
      );
  const layout = await textLayout(first, {
    text: "A much longer replacement sentence for testing",
    fit: "wrap",
    width: 90,
  });
  assert(layout.lines.length > 1);
  await assert.rejects(
    () =>
      previewContent(original, 0, {
        [first.id]: {
          type: "text",
          text: "far too long to fit here at the original font size",
          fit: "keep",
        },
      }),
    /exceeds/,
  );
  const parent = await PDFDocument.create(),
    pp = parent.addPage([600, 800]),
    [nested] = await parent.embedPdf(original);
  pp.drawPage(nested, { x: 0, y: 0, width: 250, height: 350 });
  pp.drawPage(nested, { x: 280, y: 350, width: 250, height: 350 });
  const nestedBytes = await parent.save(),
    nestedItems = (await inspectContent(nestedBytes, 0)).items;
  assert.equal(nestedItems.length, 6);
  assert(nestedItems[0].path.length);
  const nestedAfter = (
    await inspectContent(
      await previewContent(nestedBytes, 0, {
        [nestedItems[0].id]: { type: "text", text: "Only here", fit: "shrink" },
      }),
      0,
    )
  ).items;
  assert.equal(nestedAfter[0].text, "Only here");
  assert.equal(
    nestedAfter[3].text,
    "First run",
    "shared Form occurrence isolated",
  );
  // A genuine subset embedded font with a ToUnicode CMap.
  const fb = new Uint8Array(fs.readFileSync("tests/embedded-fixture.pdf")),
    fi = (await inspectContent(fb, 0)).items[0];
  assert(fi.editable, fi.reason);
  assert.equal(fi.text, "María café");
  const reused = await inspectContent(
    await previewContent(fb, 0, {
      [fi.id]: { type: "text", text: "café María", fit: "shrink" },
    }),
    0,
  );
  assert.equal(reused.items[0].text, "café María");
  assert.equal(reused.items[0].label, fi.label);
  const fallback = await inspectContent(
    await previewContent(fb, 0, {
      [fi.id]: { type: "text", text: "Zoe approved", fit: "shrink" },
    }),
    0,
  );
  assert.equal(fallback.items[0].text, "Zoe approved");
  assert.equal(fallback.items[0].label, "Helvetica");
  // Accessibility replacement strings must not leave extraction out of sync.
  const tagged = await PDFDocument.load(original),
    tp = tagged.getPage(0);
  tp.node.set(
    PDFName.of("Contents"),
    tagged.context.register(
      tagged.context.flateStream(
        "/Span << /ActualText (Accessible original) >> BDC BT /F 14 Tf 1 0 0 1 30 500 Tm (Visible text) Tj ET EMC",
      ),
    ),
  );
  const blocked = (await inspectContent(await tagged.save(), 0)).items[0];
  assert.equal(blocked.editable, false);
  assert.match(blocked.reason, /ActualText/);
  // Clipped text is identified rather than rewritten using guessed geometry.
  tp.node.set(
    PDFName.of("Contents"),
    tagged.context.register(
      tagged.context.flateStream(
        "q 0 0 100 100 re W n BT /F 14 Tf 1 0 0 1 30 50 Tm (Clipped) Tj ET Q",
      ),
    ),
  );
  assert.equal(
    (await inspectContent(await tagged.save(), 0)).items[0].editable,
    false,
  );
  fs.writeFileSync("tests/advanced-fixture.pdf", nestedBytes);
  fs.writeFileSync("tests/embedded-fixture.pdf", fb);
  console.log(
    "PASS: Spanish accents, TJ kerning, mixed fonts, next-line matrix preservation, overflow/wrap, nested shared Form isolation, embedded subset font reuse and explicit fallback.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
