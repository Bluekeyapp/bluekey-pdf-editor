const assert = require("node:assert/strict"),
  fs = require("node:fs");
const {
  createCanvas,
  DOMMatrix,
  Path2D,
  ImageData,
} = require("@napi-rs/canvas");
Object.assign(globalThis, {
  self: globalThis,
  DOMMatrix,
  Path2D,
  ImageData,
  document: { createElement: () => createCanvas(1, 1) },
});
if (!Uint8Array.prototype.toHex)
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value() {
      return Buffer.from(this).toString("hex");
    },
  });
for (const Type of [Map, WeakMap])
  if (!Type.prototype.getOrInsertComputed)
    Object.defineProperty(Type.prototype, "getOrInsertComputed", {
      value(key, create) {
        if (!this.has(key)) this.set(key, create(key));
        return this.get(key);
      },
    });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) =>
  String(input).startsWith("file:")
    ? Promise.resolve(new Response(fs.readFileSync(new URL(input))))
    : originalFetch(input, options);
(async () => {
  await import("../vendor/pdf-lib.min.js");
  const { PDFDocument, PDFName, PDFNumber } = PDFLib;
  const { inspectContent, previewContent, textLayout } = await import(
    "../content-engine.js"
  );
  const { textBlocks } = await import("../text-model.js"),
    { wrapText, textSelection } = await import("../text-layout.js");
  const { reconstructDocument, regionLines } = await import(
    "../reconstruction.js"
  );
  const { classifyPage, uniqueRecognized } = await import(
    "../document-analysis.js"
  );
  const { encodeProject, decodeProject } = await import("../project-file.js");
  const { assertReplacementLayout } = await import("../text-script.js");
  const pdfjs = await import("../vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../vendor/pdf.worker.min.mjs",
    require("node:url").pathToFileURL(__filename),
  ).href;
  const render = async (bytes, index = 0) => {
    const doc = await pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: new URL(
        "../vendor/standard_fonts/",
        require("node:url").pathToFileURL(__filename),
      ).href,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const page = await doc.getPage(index + 1),
      viewport = page.getViewport({ scale: 2 / (page.userUnit || 1) }),
      canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
    await page.render({ canvasContext: canvas.getContext("2d"), viewport })
      .promise;
    const content = await page.getTextContent();
    await doc.destroy();
    return { canvas, viewport, content };
  };
  const d = await PDFDocument.create(),
    p = d.addPage([400, 400]),
    font = await d.embedFont("Helvetica");
  p.drawText("Change this phrase", { x: 40, y: 320, size: 18, font });
  p.drawText("Neighbor untouched", { x: 40, y: 200, size: 18, font });
  const bytes = await d.save(),
    before = (await inspectContent(bytes, 0)).items;
  const output = await previewContent(bytes, 0, {
    [before[0].id]: {
      type: "text",
      text: "Moved phrase",
      dx: 15,
      dy: -10,
      color: "#b52244",
      family: "Times",
      style: "bold",
      fit: "shrink",
    },
  });
  const after = (await inspectContent(output, 0)).items;
  assert.equal(after[0].label, "Times-Bold");
  assert.equal(after[0].matrix[4], 55);
  assert.equal(after[0].matrix[5], 310);
  assert.notEqual(after[0].color, before[0].color);
  assert.equal(after[1].color, before[1].color);
  assert.deepEqual(after[1].matrix, before[1].matrix);
  assert.deepEqual(
    wrapText("中文测试", 2, (text) => Array.from(text).length),
    ["中文", "测试"],
  );
  assert.deepEqual(
    wrapText(
      "a\u0301b",
      1,
      (text) =>
        [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            text,
          ),
        ].length,
    ),
    ["a\u0301", "b"],
  );
  const composed = await textLayout(before[0], {
    text: "Cafe\u0301",
    fit: "shrink",
  });
  assert.equal(composed.lines[0], "Café");
  assert.throws(() => assertReplacementLayout("مرحبا"), /bidirectional/);
  assert.throws(() => assertReplacementLayout("שָׁלוֹם"), /bidirectional/);
  assert.deepEqual(textSelection("First word. Next sentence!", 3, "sentence"), {
    start: 0,
    end: 12,
  });
  const rotated = await PDFDocument.create(),
    rp = rotated.addPage([400, 400]),
    rf = await rotated.embedFont("Helvetica");
  rp.drawText("Rotated first", {
    x: 120,
    y: 100,
    size: 14,
    font: rf,
    rotate: PDFLib.degrees(90),
  });
  rp.drawText("Rotated next", {
    x: 140,
    y: 100,
    size: 14,
    font: rf,
    rotate: PDFLib.degrees(90),
  });
  rp.drawText("Other column", {
    x: 140,
    y: 280,
    size: 14,
    font: rf,
    rotate: PDFLib.degrees(90),
  });
  const groups = textBlocks(
    (await inspectContent(await rotated.save(), 0)).items,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert(groups[0].width > 20);
  for (const rotation of [0, 90]) {
    const doc = await PDFDocument.create(),
      page = doc.addPage([400, 400]),
      f = await doc.embedFont("Helvetica");
    page.node.set(
      PDFName.of("Resources"),
      doc.context.obj({ Font: { F: f.ref } }),
    );
    page.node.set(
      PDFName.of("Contents"),
      doc.context.register(
        doc.context.flateStream(
          "q 35 290 170 45 re W n BT /F 18 Tf 1 0 0 1 40 310 Tm (Clipped phrase) Tj ET Q BT /F 18 Tf 1 0 0 1 40 200 Tm (Neighbor stays native) Tj 1 0 0 1 40 100 Tm (Clipped phrase) Tj ET",
        ),
      ),
    );
    page.drawRectangle({
      x: 280,
      y: 20,
      width: 60,
      height: 70,
      color: PDFLib.rgb(0.2, 0.6, 0.4),
    });
    const link = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [280, 20, 340, 90],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFLib.PDFString.of("https://example.com"),
      },
    });
    page.node.set(
      PDFName.of("Annots"),
      doc.context.obj([doc.context.register(link)]),
    );
    page.setRotation(PDFLib.degrees(rotation));
    if (rotation) {
      page.setCropBox(10, 20, 380, 360);
      page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    }
    doc.addPage([200, 200]).drawText("Keep other page", { x: 20, y: 100 });
    const field = doc.getForm().createTextField("preserved-field");
    field.setText("Keep field");
    field.addToPage(page, { x: 280, y: 180, width: 80, height: 20 });
    doc.setAuthor("Preserved");
    await doc.attach(new TextEncoder().encode("Attachment"), "evidence.txt");
    const original = await doc.save(),
      view = await render(original),
      extracted = regionLines(view.content, view.viewport, {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      });
    const selected = extracted.find((line) => line.text === "Clipped phrase");
    assert(selected);
    if (process.env.DEBUG_TEXT)
      console.log(
        "REGION",
        rotation,
        selected.bbox,
        (await inspectContent(original, 0)).items
          .filter((item) => item.type === "text")
          .map((item) => ({
            text: item.text,
            quad: item.quad.map((point) =>
              view.viewport.convertToViewportPoint(...point),
            ),
          })),
      );
    const line = { ...selected, text: "Changed phrase" };
    let mode;
    const rebuilt = await reconstructDocument({
      bytes: original,
      pageIndex: 0,
      canvas: view.canvas,
      viewport: view.viewport,
      lines: [line],
      width: view.viewport.width / 2,
      height: view.viewport.height / 2,
      onMode: (value) => (mode = value),
    });
    assert.equal(mode, "region");
    const loaded = await PDFDocument.load(rebuilt);
    assert.equal(loaded.getAuthor(), "Preserved");
    assert.equal(
      loaded.getForm().getTextField("preserved-field").getText(),
      "Keep field",
    );
    assert(loaded.catalog.has(PDFName.of("Names")));
    assert.equal(loaded.getPage(0).node.Annots().size(), 2);
    assert.equal(loaded.getPage(0).getRotation().angle, rotation);
    const rendered = await render(rebuilt),
      text = rendered.content.items.map((item) => item.str).join(" ");
    assert(text.includes("Changed phrase"));
    assert(text.includes("Neighbor stays native"));
    assert.equal(
      text.match(/Clipped phrase/g)?.length,
      1,
      "only the selected occurrence is removed",
    );
    const a = view.canvas
        .getContext("2d")
        .getImageData(0, 0, view.canvas.width, view.canvas.height).data,
      b = rendered.canvas
        .getContext("2d")
        .getImageData(0, 0, view.canvas.width, view.canvas.height).data;
    let outside = 0,
      inside = 0;
    for (let y = 0; y < view.canvas.height; y++)
      for (let x = 0; x < view.canvas.width; x++) {
        const at = (y * view.canvas.width + x) * 4;
        if (
          a[at] !== b[at] ||
          a[at + 1] !== b[at + 1] ||
          a[at + 2] !== b[at + 2]
        ) {
          if (
            x >= selected.bbox.x0 - 4 &&
            x <= selected.bbox.x1 + 4 &&
            y >= selected.bbox.y0 - 4 &&
            y <= selected.bbox.y1 + 4
          )
            inside++;
          else outside++;
        }
      }
    assert.equal(
      outside,
      0,
      "no rendered change outside selected region at rotation " + rotation,
    );
    assert(inside > 0);
  }
  // Hidden OCR text must not become a duplicate editable outline or OCR candidate.
  const hidden = await PDFDocument.create(),
    hp = hidden.addPage([400, 400]),
    hf = await hidden.embedFont("Helvetica");
  hp.pushOperators(PDFLib.setTextRenderingMode(3));
  hp.drawText("Hidden OCR layer", { x: 40, y: 300, size: 18, font: hf });
  hp.pushOperators(PDFLib.setTextRenderingMode(0));
  const hi = (await inspectContent(await hidden.save(), 0)).items;
  assert.equal(hi[0].renderMode, 3);
  assert(hi[0].canRemove);
  const recognized = {
      text: "Hidden OCR layer",
      region: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 },
    },
    summary = classifyPage(hi, [recognized], [{ x: 0, y: 0, w: 1, h: 1 }]);
  assert.equal(summary.kind, "searchable-scan");
  assert.equal(classifyPage([], [], [], true).kind, "scan");
  assert.equal(uniqueRecognized([recognized], [recognized]).length, 0);
  const state = {
    name: "Draft",
    sources: [{ id: "s", name: "source.pdf", bytes, values: {} }],
    pages: [
      {
        id: "p",
        source: "s",
        index: 0,
        rotation: 0,
        marks: [],
        textDraft: {
          kind: "native",
          id: before[0].id,
          buffer: { type: "text", text: "Unfinished Ω" },
          baseRevision: 0,
          caret: { start: 2, end: 6 },
        },
      },
    ],
  };
  const restored = decodeProject(encodeProject(state));
  assert.equal(restored.pages[0].textDraft.buffer.text, "Unfinished Ω");
  assert.equal(restored.pages[0].textDraft.caret.end, 6);
  // Unknown marked-content semantics require explicit consent for full raster fallback.
  const marked = await PDFDocument.create(),
    mp = marked.addPage([400, 400]),
    mf = await marked.embedFont("Helvetica");
  mp.node.set(
    PDFName.of("Resources"),
    marked.context.obj({ Font: { F: mf.ref } }),
  );
  mp.node.set(
    PDFName.of("Contents"),
    marked.context.register(
      marked.context.flateStream(
        "/Span << /ActualText (Semantic text) >> BDC BT /F 18 Tf 1 0 0 1 40 300 Tm (Visible text) Tj ET EMC",
      ),
    ),
  );
  const markedBytes = await marked.save(),
    mv = await render(markedBytes),
    lines = [
      {
        text: "Reviewed replacement",
        include: true,
        bbox: { x0: 70, y0: 150, x1: 350, y1: 220 },
      },
    ];
  await assert.rejects(
    () =>
      reconstructDocument({
        bytes: markedBytes,
        pageIndex: 0,
        canvas: mv.canvas,
        viewport: mv.viewport,
        lines,
        width: 400,
        height: 400,
      }),
    /whole-page raster fallback/,
  );
  let fallback;
  await reconstructDocument({
    bytes: markedBytes,
    pageIndex: 0,
    canvas: mv.canvas,
    viewport: mv.viewport,
    lines,
    width: 400,
    height: 400,
    allowRasterFallback: true,
    onMode: (mode) => (fallback = mode),
  });
  assert.equal(fallback, "page");
  fs.writeFileSync("tests/text-experience.pdf", bytes);
  console.log(
    "PASS: text color/style/movement with neighbor preservation, rotated paragraph grouping, grapheme wrapping, shaping refusals, clipped-region reconstruction at 0/90 degrees with crop/UserUnit/links/attachments, independent pixels, duplicate hidden OCR, typing backup and explicit lossy fallback.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
