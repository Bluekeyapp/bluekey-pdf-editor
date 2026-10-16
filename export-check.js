import * as pdfjs from "./vendor/pdf.min.mjs";
import { inversePoint } from "./pdf-core.js";
const normalize = (text) => text.normalize("NFKC").replace(/\s/g, "");
const near = (a, b) =>
  a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 0.15);
const same = (a, b) =>
  a.type === b.type &&
  near(a.matrix, b.matrix) &&
  (a.type === "text"
    ? normalize(a.text) === normalize(b.text) &&
      Math.abs(a.size - b.size) < 0.05 &&
      a.color === b.color &&
      Math.abs(a.advance - b.advance) < 0.15
    : a.width === b.width &&
      a.height === b.height &&
      a.fingerprint === b.fingerprint);
const readable = (item) =>
  item.type === "image" ||
  (item.type === "text" && item.fontInfo && normalize(item.text));

export async function verifyExport(
  state,
  bytes,
  onlyPage = null,
  options = {},
) {
  const pages = onlyPage === null ? state.pages : [state.pages[onlyPage]];
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: "./vendor/standard_fonts/",
    cMapUrl: "./vendor/cmaps/",
    cMapPacked: true,
    wasmUrl: "./vendor/wasm/",
    isEvalSupported: false,
  }).promise;
  let checked = 0;
  try {
    if (doc.numPages !== pages.length)
      throw Error("Export verification failed: the page count changed.");
    const { inspectContent, previewContent } = await (typeof window ===
    "undefined"
      ? import("./content-engine.js")
      : import("./engine-client.js"));
    const sources = new Map();
    const output = await PDFLib.PDFDocument.load(bytes, {
      updateMetadata: false,
    });
    for (const [i, page] of pages.entries()) {
      const fail = (detail) => {
        throw Error(
          `Export verification failed on page ${i + 1}: ${detail}. Your draft is still available.`,
        );
      };
      const source = state.sources.find((source) => source.id === page.source);
      if (!sources.has(source.id))
        sources.set(
          source.id,
          await PDFLib.PDFDocument.load(source.bytes, {
            updateMetadata: false,
          }),
        );
      const originalPage = sources.get(source.id).getPage(page.index),
        exportedPage = output.getPage(i);
      for (const box of ["getMediaBox", "getCropBox"]) {
        if (
          !near(
            Object.values(originalPage[box]()),
            Object.values(exportedPage[box]()),
          )
        )
          fail("page dimensions changed");
      }
      if (exportedPage.getRotation().angle !== page.rotation)
        fail("page rotation changed");
      const edits = Object.values(page.contentEdits || {});
      if (
        !edits.length &&
        !page.marks.some((mark) =>
          ["text", "note", "image"].includes(mark.type),
        )
      )
        continue;
      const actual = (await inspectContent(bytes, i)).items;
      const available = actual.slice();
      if (edits.length) {
        const expectedBytes = await previewContent(
          source.bytes,
          page.index,
          page.contentEdits,
        );
        const expected = (
          await inspectContent(expectedBytes, page.index)
        ).items.filter(readable);
        // Consume occurrences at their expected transforms, rather than accepting
        // replacement words already present elsewhere on the same page.
        for (const item of expected) {
          const match = available.findIndex((candidate) =>
            same(item, candidate),
          );
          if (match < 0) fail("edited text or image geometry did not survive");
          available.splice(match, 1);
        }
        const original = (await inspectContent(source.bytes, page.index)).items;
        const removed = original.filter(
          (item) =>
            readable(item) &&
            !expected.some((candidate) => same(item, candidate)),
        );
        if (
          removed.some((item) =>
            available.some((candidate) => same(item, candidate)),
          )
        )
          fail("replaced content is still present");
      } else {
        const original = (
          await inspectContent(source.bytes, page.index)
        ).items.filter(readable);
        for (const item of original) {
          const match = available.findIndex((candidate) =>
            same(item, candidate),
          );
          if (match < 0) fail("original text or image changed");
          available.splice(match, 1);
        }
      }
      const extracted = normalize(
        (await (await doc.getPage(i + 1)).getTextContent()).items
          .map((item) => item.str || "")
          .join(""),
      );
      for (const edit of edits.filter(
        (edit) => edit.type === "text" && edit.text?.trim(),
      )) {
        if (!extracted.includes(normalize(edit.text)))
          fail("replacement text could not be read back");
        checked++;
      }
      for (const mark of page.marks.filter((mark) =>
        ["text", "note"].includes(mark.type),
      )) {
        for (const [line, text] of mark.text.split("\n").entries()) {
          if (!text.trim()) continue;
          const [x, y] = inversePoint(
            mark.basis.transform,
            mark.x,
            mark.y + mark.size * 0.83 + line * mark.size * 1.25,
          );
          const match = available.findIndex(
            (item) =>
              item.type === "text" &&
              normalize(item.text) === normalize(text) &&
              Math.abs(item.matrix[4] - x) < 0.15 &&
              Math.abs(item.matrix[5] - y) < 0.15,
          );
          if (match < 0) fail("added text position changed");
          available.splice(match, 1);
          checked++;
        }
      }
      for (const mark of page.marks.filter((mark) => mark.type === "image")) {
        const sample = await PDFLib.PDFDocument.create();
        const image = mark.data.startsWith("data:image/jpeg")
          ? await sample.embedJpg(mark.data)
          : await sample.embedPng(mark.data);
        sample
          .addPage()
          .drawImage(image, { x: 0, y: 0, width: mark.w, height: mark.h });
        const expected = (
          await inspectContent(await sample.save(), 0)
        ).items.find((item) => item.type === "image");
        const [x, y] = inversePoint(
            mark.basis.transform,
            mark.x,
            mark.y + mark.h,
          ),
          angle = (mark.basis.rotation * Math.PI) / 180;
        const matrix = [
          mark.w * Math.cos(angle),
          mark.w * Math.sin(angle),
          -mark.h * Math.sin(angle),
          mark.h * Math.cos(angle),
          x,
          y,
        ];
        const match = available.findIndex(
          (item) =>
            item.type === "image" &&
            item.fingerprint === expected.fingerprint &&
            near(item.matrix, matrix),
        );
        if (match < 0) fail("added image content or position changed");
        available.splice(match, 1);
      }
    }
    if (options.flattenForms === false) {
      const fields = output.getForm();
      for (const source of state.sources)
        for (const [name, value] of Object.entries(source.values || {})) {
          const field = fields.getField(name),
            actual =
              field.getText?.() ?? field.getSelected?.() ?? field.isChecked?.();
          if (
            JSON.stringify(
              Array.isArray(actual) && !Array.isArray(value)
                ? actual[0]
                : actual,
            ) !== JSON.stringify(value)
          )
            throw Error("Export verification failed: a form value changed.");
        }
    }
    return {
      checked,
      message: checked
        ? `Reopened PDF and checked ${checked} text edits, page dimensions and object positions. Review the appearance before sharing.`
        : "PDF reopened; page count, dimensions and rotation checked.",
    };
  } finally {
    await doc.destroy();
  }
}
