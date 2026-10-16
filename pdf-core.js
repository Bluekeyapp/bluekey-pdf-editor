import { t } from "./i18n.js";
import { applyContentEdits } from "./content-engine.js";
import { embedManagedFont } from "./font-manager.js";
const lib = () => globalThis.PDFLib;
export function inversePoint(t, x, y) {
  const d = t[0] * t[3] - t[1] * t[2];
  return [
    (t[3] * (x - t[4]) - t[2] * (y - t[5])) / d,
    (-t[1] * (x - t[4]) + t[0] * (y - t[5])) / d,
  ];
}
export function transformPoint(t, x, y) {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}
export function color(hex) {
  const { rgb } = lib();
  return rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
}
export async function createSample(blank = false) {
  const { PDFDocument, StandardFonts, rgb } = lib();
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.08, 0.35, 0.3);
  if (blank) {
    doc.addPage([595, 842]);
    return doc.save();
  }
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  const alternative = (field, label) =>
    field.acroField.dict.set(
      lib().PDFName.of("TU"),
      lib().PDFHexString.fromText(t(label)),
    );
  const text = (s, x, y, size = 11, font = f, c = rgb(0.3, 0.36, 0.34)) =>
    page.drawText(t(s), { x, y, size, font, color: c });
  page.drawRectangle({ x: 0, y: 810, width: 595, height: 32, color: green });
  text("BLUE KEY  /  SAMPLE DOCUMENT", 45, 768, 10, bold, green);
  text("Let's make it official.", 45, 719, 28, bold);
  text("Client information & approval", 45, 691, 12);
  text("A sample to explore your new PDF workspace.", 45, 651, 11);
  text(
    "Fill the fields below, add a signature, and export your copy.",
    45,
    632,
    11,
  );
  const field = (name, label, x, y, w) => {
    text(label, x, y + 36, 9, bold);
    const v = form.createTextField(name);
    alternative(v, label);
    v.addToPage(page, {
      x,
      y,
      width: w,
      height: 28,
      borderWidth: 1,
      borderColor: rgb(0.78, 0.83, 0.8),
      backgroundColor: rgb(0.98, 0.99, 0.98),
    });
    v.setFontSize(12);
  };
  field("full_name", "FULL NAME", 45, 553, 245);
  field("company", "COMPANY", 310, 553, 240);
  field("email", "EMAIL ADDRESS", 45, 479, 505);
  text("SERVICE", 45, 437, 9, bold);
  const dd = form.createDropdown("service");
  alternative(dd, "SERVICE");
  dd.addOptions(
    ["Select a service", "Consultation", "Document review", "Support"].map(t),
  );
  dd.select(t("Select a service"));
  dd.addToPage(page, {
    x: 45,
    y: 399,
    width: 505,
    height: 28,
    borderWidth: 1,
    borderColor: rgb(0.78, 0.83, 0.8),
  });
  const cb = form.createCheckBox("approved");
  alternative(cb, "I have reviewed the information above.");
  cb.addToPage(page, {
    x: 45,
    y: 351,
    width: 14,
    height: 14,
    borderWidth: 1,
    borderColor: green,
  });
  text("I have reviewed the information above.", 70, 353);
  page.drawLine({
    start: { x: 45, y: 320 },
    end: { x: 550, y: 320 },
    thickness: 1,
    color: rgb(0.86, 0.89, 0.87),
  });
  text("YOUR SIGNATURE", 45, 288, 9, bold);
  page.drawRectangle({
    x: 45,
    y: 175,
    width: 310,
    height: 91,
    borderColor: rgb(0.8, 0.85, 0.81),
    borderWidth: 1,
  });
  text("Use the Sign tool to place your signature here.", 55, 189, 9);
  field("date", "DATE", 385, 220, 165);
  text("Your document. Your device.", 45, 110, 13, bold, green);
  text("This sample contains no real client information.", 45, 90, 10);
  text("01 / 02", 505, 45, 9);
  const p2 = doc.addPage([595, 842]);
  p2.drawText(t("A little room for your notes."), {
    x: 45,
    y: 740,
    size: 25,
    font: bold,
    color: green,
  });
  p2.drawText(
    t("Try adding text, highlighting, drawing, or inserting an image."),
    { x: 45, y: 708, size: 11, font: f },
  );
  for (let y = 650; y > 170; y -= 35)
    p2.drawLine({
      start: { x: 45, y },
      end: { x: 550, y },
      thickness: 0.5,
      color: rgb(0.88, 0.9, 0.88),
    });
  p2.drawText("02 / 02", { x: 505, y: 45, size: 9, font: f });
  // PDF.js reads tooltips from widget dictionaries; keep the field and widget labels aligned.
  for (const field of form.getFields()) {
    const label = field.acroField.dict.get(lib().PDFName.of("TU"));
    if (label)
      for (const widget of field.acroField.getWidgets())
        widget.dict.set(lib().PDFName.of("TU"), label);
  }
  return doc.save();
}
export function canPreserveDocument(state, onlyPage = null) {
  return (
    onlyPage === null &&
    state.sources.length === 1 &&
    (state.sources[0].pageCount == null ||
      state.sources[0].pageCount === state.pages.length) &&
    state.pages.every(
      (page, index) =>
        page.source === state.sources[0].id && page.index === index,
    )
  );
}
export async function textFont(doc, text) {
  const font = await doc.embedFont(lib().StandardFonts.Helvetica);
  try {
    font.encodeText(text.replace(/\n/g, ""));
    return font;
  } catch {
    return (await embedManagedFont(doc, "regular", null, text)).font;
  }
}
export async function exportPdf(state, onlyPage = null, options = {}) {
  const { PDFDocument, degrees } = lib();
  const pages = onlyPage === null ? state.pages : [state.pages[onlyPage]];
  const prepared = new Map();
  let preserve =
    canPreserveDocument(state, onlyPage) && options.preserveDocument !== false;
  const original = preserve
    ? await PDFDocument.load(state.sources[0].bytes, { updateMetadata: false })
    : null;
  preserve = preserve && original.getPageCount() === pages.length;
  if (options.flattenForms === false && !preserve)
    throw Error(
      "Keeping interactive forms requires one complete PDF in its original page order.",
    );
  const out = preserve ? original : await PDFDocument.create();
  for (const sourceId of new Set(pages.map((page) => page.source))) {
    const source = state.sources.find((source) => source.id === sourceId);
    const input = preserve
      ? out
      : await PDFDocument.load(source.bytes, { updateMetadata: false });
    for (const entry of pages.filter((page) => page.source === sourceId))
      await applyContentEdits(
        input,
        input.getPage(entry.index),
        entry.contentEdits,
      );
    const form = input.getForm();
    if (form.hasXFA()) throw Error("XFA forms are not supported.");
    if (form.getFields().some((field) => field instanceof PDFLib.PDFSignature))
      throw Error(
        "This document has certificate signature fields. Export is disabled to avoid invalidating a digital signature.",
      );
    for (const [name, value] of Object.entries(source.values || {})) {
      const field = form.getField(name);
      if (typeof field.setText === "function") field.setText(String(value));
      else if (typeof field.check === "function")
        value ? field.check() : field.uncheck();
      else if (typeof field.select === "function") {
        if (value !== "" && value != null) field.select(value);
        else field.clear?.();
      }
    }
    if (form.getFields().length) {
      const text = form
        .getFields()
        .flatMap((field) => [
          field.getText?.() || "",
          ...(field.getSelected?.() || []),
          ...(field.getOptions?.() || []),
        ])
        .join("\n");
      form.updateFieldAppearances(await textFont(input, text));
      if (options.flattenForms !== false)
        form.flatten({ updateFieldAppearances: false });
    }
    prepared.set(sourceId, input);
  }
  for (const p of pages) {
    let page;
    if (preserve) page = out.getPage(p.index);
    else {
      [page] = await out.copyPages(prepared.get(p.source), [p.index]);
      out.addPage(page);
    }
    page.setRotation(degrees(p.rotation));
    for (const m of p.marks) {
      const at = (x, y) => {
        const [a, b] = inversePoint(m.basis.transform, x, y);
        return { x: a, y: b };
      };
      const c = color(m.color || "#173c33");
      if (m.type === "text" || m.type === "note") {
        const font = await textFont(out, m.text);
        for (const [n, line] of m.text.split("\n").entries())
          page.drawText(line, {
            ...at(m.x, m.y + m.size * 0.83 + n * m.size * 1.25),
            size: m.size,
            font,
            color: c,
            rotate: degrees(m.basis.rotation),
          });
      } else if (m.type === "image") {
        const img = m.data.startsWith("data:image/jpeg")
          ? await out.embedJpg(m.data)
          : await out.embedPng(m.data);
        page.drawImage(img, {
          ...at(m.x, m.y + m.h),
          width: m.w,
          height: m.h,
          rotate: degrees(m.basis.rotation),
        });
      } else if (m.type === "highlight")
        page.drawRectangle({
          ...at(m.x, m.y + m.h),
          width: m.w,
          height: m.h,
          color: c,
          opacity: 0.3,
          rotate: degrees(m.basis.rotation),
        });
      else if (m.type === "draw" || m.type === "underline") {
        for (let i = 1; i < m.points.length; i++)
          page.drawLine({
            start: at(...m.points[i - 1]),
            end: at(...m.points[i]),
            thickness: m.size,
            color: c,
          });
      } else if (m.type === "check") {
        const points = [
          [m.x, m.y + m.h * 0.5],
          [m.x + m.w * 0.36, m.y + m.h],
          [m.x + m.w, m.y],
        ];
        for (let i = 1; i < points.length; i++)
          page.drawLine({
            start: at(...points[i - 1]),
            end: at(...points[i]),
            thickness: 2,
            color: c,
          });
      }
    }
  }
  if (!preserve) {
    const source = prepared.values().next().value;
    for (const [get, set] of [
      ["getAuthor", "setAuthor"],
      ["getSubject", "setSubject"],
      ["getCreationDate", "setCreationDate"],
    ]) {
      const value = source[get]();
      if (value) out[set](value);
    }
    const keywords = source.getKeywords();
    if (keywords) out.setKeywords([keywords]);
    out.setCreator("BlueKey PDF Editor");
    out.setProducer("pdf-lib");
  }
  out.setTitle(state.name.replace(/\.pdf$/i, ""));
  return out.save({ updateFieldAppearances: false });
}
