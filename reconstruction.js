import { embedManagedFont } from "./font-manager.js";
import { inspectDocument, applyContentEdits } from "./content-engine.js";
import { inversePoint, transformPoint } from "./pdf-core.js";
import { replacementText } from "./text-script.js";

export async function reconstructRegionPdf(options) {
  const input = await PDFLib.PDFDocument.load(options.bytes, {
    updateMetadata: false,
  });
  return reconstructRegion({ ...options, input });
}

export async function localizedPlan(input, pageIndex, lines, transform) {
  const result = await inspectDocument(input, input.getPage(pageIndex)),
    edits = {};
  if (
    result.warnings.some((warning) =>
      /Nested object limit|content stream|Inline images|token limit|processing limit/i.test(
        warning,
      ),
    )
  )
    throw Error(
      "This page cannot be completely inspected. Enable the whole-page raster fallback after reviewing its limitations.",
    );
  const boxes = lines
    .filter((line) => line.include)
    .map((line) => ({
      x0: line.bbox.x0 - 3,
      y0: line.bbox.y0 - 3,
      x1: line.bbox.x1 + 3,
      y1: line.bbox.y1 + 3,
    }));
  for (const reference of input.getPage(pageIndex).node.Annots()?.asArray() ||
    []) {
    const annotation = input.context.lookup(reference);
    if (
      annotation.lookup(PDFLib.PDFName.of("Subtype"))?.toString() !== "/Widget"
    )
      continue;
    const values = annotation
      .lookup(PDFLib.PDFName.of("Rect"))
      ?.asArray()
      ?.map((value) => value.asNumber());
    if (!values || values.length !== 4)
      throw Error(
        "An interactive form field cannot be located. Fill it directly or export a flattened copy first.",
      );
    const points = [
        [values[0], values[1]],
        [values[2], values[3]],
        [values[0], values[3]],
        [values[2], values[1]],
      ].map((point) => transformPoint(transform, ...point)),
      xs = points.map((point) => point[0]),
      ys = points.map((point) => point[1]);
    const box = {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
    if (
      boxes.some(
        (area) =>
          box.x0 < area.x1 &&
          box.x1 > area.x0 &&
          box.y0 < area.y1 &&
          box.y1 > area.y0,
      )
    )
      throw Error(
        "This area intersects an interactive form field. Use Fill or export a flattened copy before reconstruction.",
      );
  }
  for (const item of result.items.filter((item) => item.type === "text")) {
    if (!item.fontInfo || !item.canRemove)
      throw Error(
        "Some text cannot be safely located or removed. Enable the whole-page raster fallback after reviewing its limitations.",
      );
    const points = item.quad.map((point) =>
        transformPoint(transform, ...point),
      ),
      xs = points.map((point) => point[0]),
      ys = points.map((point) => point[1]);
    const box = {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    };
    const hits = boxes.filter(
      (area) =>
        box.x0 < area.x1 &&
        box.x1 > area.x0 &&
        box.y0 < area.y1 &&
        box.y1 > area.y0,
    );
    if (!hits.length) continue;
    if (
      !hits.some(
        (area) =>
          box.x0 >= area.x0 - 6 &&
          box.x1 <= area.x1 + 6 &&
          box.y0 >= area.y0 - 6 &&
          box.y1 <= area.y1 + 6,
      )
    )
      throw Error(
        "The selected area cuts through a text run. Expand the area or explicitly enable the whole-page raster fallback.",
      );
    edits[item.id] = {
      type: "text",
      remove: true,
      reconstruct: true,
      text: "",
    };
  }
  return edits;
}

async function reconstructRegion({
  input,
  pageIndex,
  canvas,
  lines,
  width,
  height,
  fontData,
  background,
  ink,
  viewport,
}) {
  const page = input.getPage(pageIndex),
    selected = lines.filter((line) => line.include);
  const transform = viewport?.transform || [
    canvas.width / width,
    0,
    0,
    -canvas.height / height,
    0,
    canvas.height,
  ];
  const edits = await localizedPlan(input, pageIndex, lines, transform);
  await applyContentEdits(input, page, edits);
  const { font } = await embedManagedFont(
    input,
    "regular",
    fontData,
    selected.map((line) => line.text).join("\n"),
  );
  const c = (hex) =>
    PDFLib.rgb(
      ...[1, 3, 5].map(
        (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
      ),
    );
  const at = (x, y) => inversePoint(transform, x, y),
    origin = at(0, 0),
    right = at(1, 0),
    unit = Math.hypot(right[0] - origin[0], right[1] - origin[1]),
    angle =
      (Math.atan2(right[1] - origin[1], right[0] - origin[0]) * 180) / Math.PI;
  for (const line of selected) {
    const b = line.bbox,
      rows = line.text.replace(/\r\n?/g, "\n").split("\n"),
      w = b.x1 - b.x0,
      h = b.y1 - b.y0;
    let size = Math.max(2, h / Math.max(1, rows.length * 1.2)),
      widest = Math.max(
        1,
        ...rows.map((text) => font.widthOfTextAtSize(text, size)),
      );
    if (widest > w) size *= w / widest;
    if (size * unit < 2 && line.text.trim())
      throw Error(
        "This text is too long for its selected area. Shorten it or select a larger area.",
      );
    const [x, y] = at(Math.max(0, b.x0 - 3), Math.min(canvas.height, b.y1 + 3));
    page.drawRectangle({
      x,
      y,
      width: (Math.min(canvas.width, b.x1 + 3) - Math.max(0, b.x0 - 3)) * unit,
      height:
        (Math.min(canvas.height, b.y1 + 3) - Math.max(0, b.y0 - 3)) * unit,
      color: c(background),
      rotate: PDFLib.degrees(angle),
    });
    for (const [row, text] of rows.entries()) {
      const [x, y] = at(b.x0, b.y0 + size * 0.85 + row * size * 1.2);
      page.drawText(text, {
        x,
        y,
        size: size * unit,
        font,
        color: c(ink),
        rotate: PDFLib.degrees(angle),
      });
    }
  }
  return input.save({ updateFieldAppearances: false });
}
export function regionLines(content, viewport, region) {
  const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const r = {
    x0: region.x * viewport.width,
    y0: region.y * viewport.height,
    x1: (region.x + region.w) * viewport.width,
    y1: (region.y + region.h) * viewport.height,
  };
  return content.items
    .filter((i) => i.str?.trim())
    .flatMap((i) => {
      const t = multiply(viewport.transform, i.transform),
        h = Math.hypot(t[2], t[3]),
        w = i.width * Math.hypot(viewport.transform[0], viewport.transform[1]),
        angle = Math.atan2(t[1], t[0]),
        ascent = content.styles[i.fontName]?.ascent ?? 0.85;
      const corners = [
        [0, -h * ascent],
        [w, -h * ascent],
        [0, h * (1 - ascent)],
        [w, h * (1 - ascent)],
      ].map(([x, y]) => [
        t[4] + x * Math.cos(angle) - y * Math.sin(angle),
        t[5] + x * Math.sin(angle) + y * Math.cos(angle),
      ]);
      const b = {
        x0: Math.min(...corners.map((p) => p[0])),
        y0: Math.min(...corners.map((p) => p[1])),
        x1: Math.max(...corners.map((p) => p[0])),
        y1: Math.max(...corners.map((p) => p[1])),
      };
      // Include complete intersecting lines, never silently cut characters in half.
      return b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0
        ? [
            {
              text: i.str,
              bbox: b,
              confidence: null,
              include: true,
              source: "extracted",
              rotated: Math.abs(angle) > 0.05,
            },
          ]
        : [];
    });
}
export async function reconstructDocument({
  bytes,
  pageIndex,
  canvas,
  lines,
  width,
  height,
  fontData,
  background = "#ffffff",
  ink = "#000000",
  viewport,
  allowRasterFallback = false,
  onMode = () => {},
  signal,
}) {
  lines = lines.map((line) => ({ ...line, text: replacementText(line.text) }));
  const selected = lines.filter((l) => l.include);
  if (!selected.length) throw Error("Include at least one text area.");
  if (selected.some((l) => l.text.length > 20000))
    throw Error("Keep each text area below 20,000 characters.");
  try {
    const options = {
      bytes,
      pageIndex,
      canvas: { width: canvas.width, height: canvas.height },
      lines,
      width,
      height,
      fontData,
      background,
      ink,
      viewport: viewport ? { transform: [...viewport.transform] } : undefined,
    };
    const output =
      typeof window !== "undefined"
        ? await (
            await import("./engine-client.js")
          ).engineCall("reconstructRegionPdf", [options], {
            signal,
            timeout: 60000,
          })
        : await reconstructRegionPdf(options);
    onMode("region");
    return output;
  } catch (error) {
    if (!allowRasterFallback || signal?.aborted) throw error;
    onMode("page", error.message);
  }
  const { PDFDocument, rgb } = PDFLib,
    input = await PDFDocument.load(bytes, { updateMetadata: false }),
    out = await PDFDocument.create();
  const { font } = await embedManagedFont(
    out,
    "regular",
    fontData,
    selected.map((l) => l.text).join("\n"),
  );
  const raster = document.createElement("canvas");
  raster.width = canvas.width;
  raster.height = canvas.height;
  const ctx = raster.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  ctx.fillStyle = background;
  for (const { bbox: b } of selected) {
    ctx.fillRect(
      Math.max(0, b.x0 - 3),
      Math.max(0, b.y0 - 3),
      b.x1 - b.x0 + 6,
      b.y1 - b.y0 + 6,
    );
  }
  const image = await out.embedPng(raster.toDataURL()),
    sx = width / canvas.width,
    sy = height / canvas.height,
    c = rgb(...[1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16) / 255));
  for (let i = 0; i < input.getPageCount(); i++) {
    if (i !== pageIndex) {
      const [p] = await out.copyPages(input, [i]);
      out.addPage(p);
      continue;
    }
    const page = out.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    for (const line of selected) {
      const b = line.bbox,
        rows = line.text.replace(/\r\n?/g, "\n").split("\n"),
        w = (b.x1 - b.x0) * sx,
        h = (b.y1 - b.y0) * sy;
      let size = Math.max(2, h / Math.max(1, rows.length * 1.2));
      const widest = Math.max(
        1,
        ...rows.map((t) => font.widthOfTextAtSize(t, size)),
      );
      if (widest > w) size *= w / widest;
      if (size < 2 && line.text.trim())
        throw Error(
          "This text is too long for its selected area. Shorten it or select a larger area.",
        );
      for (const [row, text] of rows.entries())
        page.drawText(text, {
          x: b.x0 * sx,
          y: height - b.y0 * sy - size * 0.85 - row * size * 1.2,
          size,
          font,
          color: c,
        });
    }
  }
  out.setTitle("Editable reconstruction");
  return out.save();
}
