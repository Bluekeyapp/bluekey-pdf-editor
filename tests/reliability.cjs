const assert = require("node:assert/strict");
const { DOMMatrix, Path2D, ImageData } = require("@napi-rs/canvas");
Object.assign(globalThis, { self: globalThis, DOMMatrix, Path2D, ImageData });
if (!Uint8Array.prototype.toHex)
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value() {
      return Buffer.from(this).toString("hex");
    },
  });
(async () => {
  await import("../vendor/pdf-lib.min.js");
  const pdfjs = await import("../vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../vendor/pdf.worker.min.mjs",
    require("node:url").pathToFileURL(__filename),
  ).href;
  const { exportPdf } = await import("../pdf-core.js");
  const { inspectContent } = await import("../content-engine.js");
  const { verifyExport } = await import("../export-check.js");
  const { encodeProject, decodeProject } = await import("../project-file.js");
  const { findPageMatches } = await import("../page-text.js");
  const d = await PDFLib.PDFDocument.create(),
    page = d.addPage([595, 842]),
    font = await d.embedFont("Helvetica");
  page.drawText("Original text", { x: 45, y: 700, size: 18, font });
  page.drawText("Already exists", { x: 45, y: 600, size: 18, font });
  d.setAuthor("Preserved author");
  d.setSubject("Preserved subject");
  await d.attach(
    new TextEncoder().encode("keep this attachment"),
    "evidence.txt",
  );
  const outline = d.context.obj({ Type: "Outlines", Count: 0 });
  d.catalog.set(PDFLib.PDFName.of("Outlines"), d.context.register(outline));
  const field = d.getForm().createTextField("name");
  field.addToPage(page, { x: 45, y: 500, width: 300, height: 25 });
  const bytes = await d.save(),
    item = (await inspectContent(bytes, 0)).items.find(
      (item) => item.text === "Original text",
    );
  const state = {
    name: "Reliability.pdf",
    sources: [
      { id: "source", name: "source.pdf", bytes, values: { name: "Ελληνικά" } },
    ],
    pages: [
      {
        id: "page",
        source: "source",
        index: 0,
        rotation: 0,
        marks: [],
        contentEdits: {
          [item.id]: { type: "text", text: "Already exists", fit: "shrink" },
        },
      },
    ],
  };
  await assert.rejects(
    () => verifyExport(state, bytes),
    /geometry did not survive/,
    "text elsewhere cannot satisfy an unapplied edit",
  );
  const output = await exportPdf(state),
    result = await verifyExport(state, output);
  assert.equal(result.checked, 1);
  const exported = await PDFLib.PDFDocument.load(output);
  assert.equal(exported.getAuthor(), "Preserved author");
  assert.equal(exported.getSubject(), "Preserved subject");
  assert(
    exported.catalog.has(PDFLib.PDFName.of("Names")),
    "attachment tree retained",
  );
  assert(
    exported.catalog.has(PDFLib.PDFName.of("Outlines")),
    "outline tree retained",
  );
  const interactive = await PDFLib.PDFDocument.load(
    await exportPdf(state, null, { flattenForms: false }),
  );
  assert.equal(
    interactive.getForm().getTextField("name").getText(),
    "Ελληνικά",
  );
  await verifyExport(
    state,
    await exportPdf(state, null, { flattenForms: false }),
    null,
    { flattenForms: false },
  );
  state.pages[0].marks.push({
    id: "mark",
    type: "text",
    text: "Ελληνικά — Привет",
    x: 50,
    y: 100,
    size: 16,
    color: "#173c33",
    basis: { transform: [1, 0, 0, -1, 0, 842], rotation: 0 },
  });
  const unicode = await exportPdf(state);
  await verifyExport(state, unicode);
  assert(
    (await inspectContent(unicode, 0)).items.some(
      (item) => item.text === "Ελληνικά — Привет",
    ),
  );
  const broken = await PDFLib.PDFDocument.load(unicode);
  broken.getPage(0).setRotation(PDFLib.degrees(90));
  const brokenBytes = await broken.save();
  await assert.rejects(() => verifyExport(state, brokenBytes), /rotation/);
  const roundtrip = decodeProject(encodeProject(state));
  assert.deepEqual(roundtrip.sources[0].bytes, bytes);
  assert.deepEqual(roundtrip.pages, state.pages);
  assert.equal(roundtrip.sources[0].values.name, "Ελληνικά");
  const invalid = JSON.parse(encodeProject(state));
  invalid.document.pages[0].marks[0].type = "script";
  assert.throws(() => decodeProject(JSON.stringify(invalid)), /annotation/);
  assert.equal(
    findPageMatches(
      { items: [{ str: "Client" }, { str: "approval Client approval" }] },
      "client approval",
    ).length,
    2,
  );
  const matches = findPageMatches(
    { items: [{ str: "Sentence sentence." }] },
    "sentence",
  );
  assert.deepEqual(
    matches.map((m) => m.ranges),
    [[{ index: 0, start: 0, end: 8 }], [{ index: 0, start: 9, end: 17 }]],
  );
  assert.equal(matches[1].hit, "sentence");
  assert.deepEqual(
    findPageMatches({ items: [{ str: "İ hello" }] }, "hello")[0].ranges,
    [{ index: 0, start: 2, end: 7 }],
  );
  assert.deepEqual(
    findPageMatches(
      { items: [{ str: "Client" }, { str: "approval" }] },
      "client approval",
    )[0].ranges,
    [
      { index: 0, start: 0, end: 6 },
      { index: 1, start: 0, end: 8 },
    ],
  );
  assert.equal(
    (await PDFLib.PDFDocument.load(bytes))
      .getForm()
      .getTextField("name")
      .getText(),
    undefined,
    "original bytes unchanged",
  );
  const { createCanvas } = require("@napi-rs/canvas"),
    canvas = createCanvas(20, 20),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, 20, 20);
  const red = canvas.toDataURL();
  ctx.fillStyle = "blue";
  ctx.fillRect(0, 0, 20, 20);
  const blue = canvas.toDataURL();
  const imageDoc = await PDFLib.PDFDocument.create(),
    embedded = await imageDoc.embedPng(red);
  imageDoc
    .addPage([200, 200])
    .drawImage(embedded, { x: 30, y: 40, width: 100, height: 100 });
  const imageBytes = await imageDoc.save(),
    imageItem = (await inspectContent(imageBytes, 0)).items[0];
  const imageState = {
    name: "image",
    sources: [{ id: "s", bytes: imageBytes, values: {} }],
    pages: [
      {
        source: "s",
        index: 0,
        rotation: 0,
        marks: [],
        contentEdits: {
          [imageItem.id]: { type: "image", data: blue, fit: "contain" },
        },
      },
    ],
  };
  await assert.rejects(
    () => verifyExport(imageState, imageBytes),
    /geometry did not survive/,
    "same dimensions do not hide an unapplied image replacement",
  );
  await verifyExport(imageState, await exportPdf(imageState));
  const backupState = structuredClone(state);
  backupState.pages[0].marks = [0, 1].map((index) => ({
    type: "image",
    id: String(index),
    x: 20,
    y: 20 + index * 30,
    w: 20,
    h: 20,
    data: red,
    basis: { transform: [1, 0, 0, -1, 0, 842], rotation: 0 },
  }));
  const packed = JSON.parse(encodeProject(backupState));
  assert.equal(
    Object.keys(packed.resources).length,
    1,
    "repeated assets are stored once",
  );
  assert.equal(
    decodeProject(JSON.stringify(packed)).pages[0].marks[1].data,
    red,
  );
  console.log(
    "PASS: duplicate-text false positives rejected, geometry/rotation verified, Unicode annotations/forms, preserved attachments/outlines/metadata, interactive forms, portable projects and multi-match search.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
