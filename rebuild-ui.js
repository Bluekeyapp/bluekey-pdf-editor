import { getLanguage } from "./i18n.js";
import { recognizePage, prepareScan } from "./ocr.js";
import { regionLines, reconstructDocument } from "./reconstruction.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const normalize = (s) => s.normalize("NFKC").replace(/\s/g, "");
export async function openRebuild(
  api,
  region = { x: 0, y: 0, w: 1, h: 1 },
  seed = null,
) {
  const $ = (s) => document.querySelector(s),
    controller = new AbortController();
  let reconstructionMode = "region";
  let bytes,
    canvas,
    lines = [],
    dims,
    vp,
    prepared = null,
    previewDoc = null,
    version = 0,
    fontData,
    originalContent;
  api.modal(
    `<div id="rebuild-workspace" data-step="review">
      <header class="rebuild-header"><h2>Make this area editable</h2><p>Review the text, compare the preview, then create a separate editable copy.</p>
        <nav class="rebuild-steps" aria-label="Reconstruction steps"><button id="ocr-review-step" aria-current="step">1 · Review text</button><button id="ocr-compare-step" disabled>2 · Compare preview</button></nav>
        <p id="ocr-progress" role="status" aria-live="polite">Preparing the current document…</p>
      </header>
      <div class="rebuild-body"><div class="rebuild-layout">
        <section class="rebuild-visual" aria-label="Page preview"><canvas tabindex="-1" id="rebuild-preview" aria-label="Selected area and reconstruction preview"></canvas><div class="compare-tabs"><button id="rebuild-original" class="active">Original</button><button id="rebuild-result" disabled>Reconstructed preview</button></div></section>
        <section class="rebuild-review" aria-label="Review recognized text"><h3>Review recognized text</h3><label>Recognition language<select id="ocr-language"><option value="eng">English</option><option value="spa">Spanish</option><option value="eng+spa">English + Spanish</option></select></label>
          <div class="edit-actions"><button class="secondary" id="run-ocr" disabled>Recognize selected area</button><button class="secondary" id="manual-area" disabled>Type text manually</button></div>
          <div id="ocr-lines"></div>
          <details class="rebuild-settings"><summary>Recognition and replacement settings</summary>
            <div class="edit-grid"><label>Background<input type="color" id="rebuild-background" value="#ffffff"></label><label>Text color<input type="color" id="rebuild-ink" value="#000000"></label></div>
            <label><input id="scan-clean" type="checkbox" checked> Improve scan contrast</label><label><input id="scan-deskew" type="checkbox" checked> Straighten slightly tilted text for recognition</label>
            <label>Optional replacement font (TTF / OTF)<input id="rebuild-font" type="file" accept=".ttf,.otf"></label><p>Bundled font supports Latin, Greek and Cyrillic. Complex scripts need additional layout support.</p>
            <p>Replace the selected areas with editable text. Surrounding page objects, links and document structure are retained when the source text can be safely removed. Fonts and backgrounds inside the selected areas may change. Your original draft stays separate.</p>
            <label><input id="raster-fallback" type="checkbox"> Allow whole-page raster fallback if regional replacement is unsafe</label><p>Whole-page fallback loses this page’s vector, link and accessibility structure and can remove interactive forms and document-level features. Your original draft remains available. It is not secure redaction.</p>
          </details>
        </section>
      </div></div>
      <footer class="dialog-actions"><button class="secondary" id="cancel-ocr">Cancel</button><button class="secondary" id="preview-rebuild" disabled>Preview editable copy</button><button class="primary" id="build-ocr" disabled>Create editable copy</button></footer>
    </div>`,
  );
  const setStep = (step) => {
    const changed = $("#rebuild-workspace").dataset.step !== step;
    $("#rebuild-workspace").dataset.step = step;
    $("#ocr-review-step").setAttribute(
      "aria-current",
      step === "review" ? "step" : "false",
    );
    $("#ocr-compare-step").setAttribute(
      "aria-current",
      step === "compare" ? "step" : "false",
    );
    if (changed) $(".rebuild-body").scrollTop = 0;
  };
  $("#ocr-review-step").onclick = () => setStep("review");
  $("#ocr-compare-step").onclick = () => setStep("compare");
  const languageSelect = $("#ocr-language");
  languageSelect.insertAdjacentHTML(
    "afterbegin",
    '<option value="fra">French</option><option value="fra+eng">French + English</option>',
  );
  languageSelect.value = getLanguage() === "fr" ? "fra" : "eng";
  const alive = () => !controller.signal.aborted && !!$("#rebuild-preview");
  const invalidate = () => {
    version++;
    prepared = null;
    $("#build-ocr").disabled = true;
    $("#rebuild-result").disabled = true;
    $("#ocr-compare-step").disabled = true;
    setStep("review");
  };
  $("#raster-fallback").onchange = () => {
    invalidate();
  };
  const paintPreview = (image, outline = false) => {
    const out = $("#rebuild-preview"),
      pad = 20,
      full = region.w > 0.95 && region.h > 0.95,
      x = Math.max(0, region.x * image.width - pad),
      y = Math.max(0, region.y * image.height - pad),
      w = Math.min(image.width - x, region.w * image.width + pad * 2),
      h = Math.min(
        image.height - y,
        Math.max(region.h * image.height + pad * 2, 100),
      );
    out.width = full ? image.width : w;
    out.height = full ? image.height : h;
    const ctx = out.getContext("2d");
    ctx.drawImage(
      image,
      full ? 0 : x,
      full ? 0 : y,
      out.width,
      out.height,
      0,
      0,
      out.width,
      out.height,
    );
    if (outline) {
      ctx.strokeStyle = "#24816c";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        region.x * image.width - (full ? 0 : x),
        region.y * image.height - (full ? 0 : y),
        region.w * image.width,
        region.h * image.height,
      );
    }
  };
  const original = () => {
    paintPreview(canvas, true);
    $("#rebuild-original").classList.add("active");
    $("#rebuild-result").classList.remove("active");
  };
  const report = (message) => {
    if (alive()) $("#ocr-progress").textContent = message;
  };
  const drawLines = () => {
    $("#ocr-lines").innerHTML = lines
      .map(
        (l, i) =>
          `<div class="ocr-line ${l.confidence !== null && l.confidence < 80 ? "uncertain" : ""}"><label><input type="checkbox" data-ocr-include="${i}" ${l.include ? "checked" : ""}> Area ${i + 1} · ${l.confidence === null ? (l.source === "manual" ? "manual text" : "extracted text") : Math.round(l.confidence) + "% confidence"}${l.confidence !== null && l.confidence < 80 ? " — check carefully" : ""}${l.rotated ? " — rotated text will be rebuilt horizontally" : ""}</label><textarea data-ocr-text="${i}" aria-label="Recognized line ${i + 1}">${esc(l.text)}</textarea></div>`,
      )
      .join("");
    for (const [i, l] of lines.entries()) {
      $(`[data-ocr-text="${i}"]`).oninput = (e) => {
        l.text = e.target.value;
        invalidate();
      };
      $(`[data-ocr-include="${i}"]`).onchange = (e) => {
        l.include = e.target.checked;
        invalidate();
      };
    }
    $("#preview-rebuild").disabled = !lines.length;
  };
  $("#modal").onclose = () => {
    controller.abort();
    previewDoc?.destroy();
  };
  $("#cancel-ocr").onclick = () => api.close();
  $("#rebuild-original").onclick = original;
  for (const id of ["rebuild-background", "rebuild-ink"])
    $("#" + id).oninput = invalidate;
  $("#rebuild-font").onchange = async (e) => {
    invalidate();
    const f = e.target.files[0];
    fontData = null;
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      report("Choose a font below 5 MB.");
      return;
    }
    $("#preview-rebuild").disabled = true;
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      if (!alive()) return;
      fontData = data;
      invalidate();
      report("Replacement font loaded. Preview again to check its characters.");
    } catch (e) {
      report("Font could not load: " + e.message);
    } finally {
      if (alive()) $("#preview-rebuild").disabled = !lines.length;
    }
  };
  $("#manual-area").onclick = () => {
    invalidate();
    lines = lines
      .filter((l) => l.source !== "manual")
      .map((l) => ({ ...l, include: false }));
    lines.push({
      text: "",
      include: true,
      confidence: null,
      source: "manual",
      bbox: {
        x0: region.x * canvas.width,
        y0: region.y * canvas.height,
        x1: (region.x + region.w) * canvas.width,
        y1: (region.y + region.h) * canvas.height,
      },
    });
    drawLines();
    report(
      "Type the replacement text. This manual area replaces everything inside the selected rectangle. Extracted lines have been unchecked to avoid duplicate text.",
    );
  };
  $("#run-ocr").onclick = async () => {
    invalidate();
    $("#run-ocr").disabled = true;
    $("#preview-rebuild").disabled = true;
    $("#manual-area").disabled = true;
    $("#ocr-language").disabled = true;
    try {
      const crop = prepareScan(canvas, region, $("#scan-clean").checked),
        scan = $("#scan-deskew").checked
          ? deskewScan(crop.canvas)
          : { canvas: crop.canvas, restore: (b) => b, angle: 0 };
      const recognized = await recognizePage(
        scan.canvas,
        $("#ocr-language").value,
        (s, p) => report(`${s} ${Math.round((p || 0) * 100)}%`),
        controller.signal,
        { region: region.w < 0.98 || region.h < 0.98 },
      );
      if (!alive()) return;
      lines = recognized.map((l) => {
        const b = scan.restore(l.bbox);
        return {
          ...l,
          include: true,
          bbox: {
            x0: Math.max(0, b.x0 + crop.x),
            y0: Math.max(0, b.y0 + crop.y),
            x1: Math.min(canvas.width, b.x1 + crop.x),
            y1: Math.min(canvas.height, b.y1 + crop.y),
          },
        };
      });
      drawLines();
      original();
      report(
        lines.length
          ? `${lines.length} text areas found${scan.angle ? " after straightening " + scan.angle.toFixed(1) + "°" : ""}. Review every line, especially uncertain words.`
          : "No readable text found. Select a clearer area or type the text manually.",
      );
    } catch (e) {
      report("Recognition failed: " + e.message);
    } finally {
      if (alive()) {
        $("#run-ocr").disabled = false;
        $("#manual-area").disabled = false;
        $("#ocr-language").disabled = false;
        $("#preview-rebuild").disabled = !lines.length;
      }
    }
  };
  const showPreview = async () => {
    if (!previewDoc || !alive()) return;
    const pg = await previewDoc.getPage(api.pageIndex + 1),
      view = pg.getViewport({
        scale: canvas.width / dims[0] / (pg.userUnit || 1),
      }),
      out = document.createElement("canvas");
    out.width = Math.ceil(view.width);
    out.height = Math.ceil(view.height);
    await pg.render({ canvasContext: out.getContext("2d"), viewport: view })
      .promise;
    if (!alive()) return;
    paintPreview(out);
    $("#rebuild-result").classList.add("active");
    $("#rebuild-original").classList.remove("active");
  };
  $("#rebuild-result").onclick = () =>
    showPreview().catch((e) =>
      report("Preview could not render: " + e.message),
    );
  $("#preview-rebuild").onclick = async () => {
    const v = version;
    $("#preview-rebuild").disabled = true;
    $("#build-ocr").disabled = true;
    report("Building and checking the editable PDF…");
    try {
      const output = await reconstructDocument({
        bytes,
        pageIndex: api.pageIndex,
        canvas,
        lines,
        width: dims[0],
        height: dims[1],
        fontData,
        background: $("#rebuild-background").value,
        ink: $("#rebuild-ink").value,
        viewport: vp,
        signal: controller.signal,
        allowRasterFallback: $("#raster-fallback").checked,
        onMode: (mode) => {
          reconstructionMode = mode;
        },
      });
      const doc = await api.pdf(output.slice());
      if (!alive() || v !== version) {
        doc.destroy();
        return;
      }
      const pg = await doc.getPage(api.pageIndex + 1),
        text = normalize(
          (await pg.getTextContent()).items.map((i) => i.str || "").join(""),
        );
      if (
        lines.some(
          (l) =>
            l.include && normalize(l.text) && !text.includes(normalize(l.text)),
        )
      ) {
        doc.destroy();
        throw Error(
          "The exported text did not match the reviewed text. Try another font.",
        );
      }
      const content = await pg.getTextContent(),
        view = pg.getViewport({
          scale: canvas.width / dims[0] / (pg.userUnit || 1),
        });
      for (const line of lines.filter((line) => line.include)) {
        const b = line.bbox,
          region = {
            x: b.x0 / canvas.width,
            y: b.y0 / canvas.height,
            w: (b.x1 - b.x0) / canvas.width,
            h: (b.y1 - b.y0) / canvas.height,
          };
        const actual = normalize(
          regionLines(content, view, region)
            .map((item) => item.text)
            .join(""),
        );
        const expected = normalize(line.text);
        if (expected && !actual.includes(expected)) {
          await doc.destroy();
          throw Error(
            "Replacement text was not found in the selected area. Review the preview and font.",
          );
        }
        for (const old of regionLines(originalContent, vp, region)) {
          const original = normalize(old.text);
          if (!original) continue;
          const count = (value) => value.split(original).length - 1;
          if (count(actual) > count(expected)) {
            await doc.destroy();
            throw Error(
              "Original text is still extractable in the replaced area. Expand the selection or choose the explicit raster fallback.",
            );
          }
        }
      }
      previewDoc?.destroy();
      previewDoc = doc;
      await showPreview();
      if (!alive() || v !== version) return;
      prepared = output;
      $("#build-ocr").disabled = false;
      $("#rebuild-result").disabled = false;
      $("#ocr-compare-step").disabled = false;
      setStep("compare");
      report(
        reconstructionMode === "region"
          ? "Exported text checked. Regional replacement preserves surrounding page objects. Compare Original before creating the editable copy."
          : "Exported text checked. Whole-page raster fallback was used: unselected content on this page is now pixels. Compare Original before creating the editable copy.",
      );
      $("#rebuild-preview").focus({ preventScroll: true });
      $(".rebuild-body").scrollTop = 0;
    } catch (e) {
      report("Cannot build this text: " + e.message);
    } finally {
      if (alive()) $("#preview-rebuild").disabled = false;
    }
  };
  $("#build-ocr").onclick = async () => {
    if (!prepared) return;
    const data = prepared;
    $("#build-ocr").disabled = true;
    await api.create(data);
  };
  try {
    bytes = await api.export();
    if (!alive()) return;
    const doc = await api.pdf(bytes.slice());
    try {
      const pg = await doc.getPage(api.pageIndex + 1),
        unit = pg.userUnit || 1,
        base = pg.getViewport({ scale: 1 / unit });
      dims = [base.width, base.height];
      const scale = Math.min(3, 3000 / Math.max(...dims));
      vp = pg.getViewport({ scale: scale / unit });
      canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp })
        .promise;
      const tc = await pg.getTextContent();
      originalContent = tc;
      if (!alive()) return;
      lines =
        seed?.text != null
          ? [
              {
                text: seed.text,
                confidence: seed.confidence ?? null,
                include: true,
                source: "manual",
                bbox: {
                  x0: region.x * canvas.width,
                  y0: region.y * canvas.height,
                  x1: (region.x + region.w) * canvas.width,
                  y1: (region.y + region.h) * canvas.height,
                },
              },
            ]
          : regionLines(tc, vp, region);
      drawLines();
      original();
      $("#run-ocr").disabled = false;
      $("#manual-area").disabled = false;
      report(
        seed?.text != null
          ? "Reviewed text loaded. Preview the replacement before creating a copy."
          : lines.length
            ? `${lines.length} text areas extracted without OCR. Review them, or use recognition if the extracted text is incorrect.`
            : "This area has no extractable text. Recognize it or type a replacement.",
      );
    } finally {
      doc.destroy();
    }
  } catch (e) {
    report("Could not prepare this page: " + e.message);
  }
}

// Estimate a small skew from horizontal ink projections; transform boxes back
// to the untouched source image so recognition cleanup never changes its pixels.
export function deskewScan(source) {
  const small = document.createElement("canvas"),
    scale = Math.min(1, 700 / source.width);
  small.width = Math.ceil(source.width * scale);
  small.height = Math.ceil(source.height * scale);
  const ctx = small.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, small.width, small.height);
  const d = ctx.getImageData(0, 0, small.width, small.height).data,
    pts = [];
  for (let y = 0; y < small.height; y += 2)
    for (let x = 0; x < small.width; x += 2) {
      const i = (y * small.width + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] < 360)
        pts.push([x - small.width / 2, y - small.height / 2]);
    }
  const score = (deg) => {
    const a = (deg * Math.PI) / 180,
      bins = new Uint32Array(small.height + small.width + 10);
    for (const [x, y] of pts) {
      const bin = Math.round(
        x * Math.sin(a) + y * Math.cos(a) + (small.height + small.width) / 2,
      );
      bins[bin]++;
    }
    let value = 0;
    for (const n of bins) value += n * n;
    return value;
  };
  let angle = 0,
    best = score(0),
    baseline = best;
  if (pts.length > 100 && pts.length < small.width * small.height * 0.25)
    for (let a = -5; a <= 5; a += 0.5) {
      const value = score(a);
      if (value > best) {
        best = value;
        angle = a;
      }
    }
  if (best < baseline * 1.12 || Math.abs(angle) < 0.5)
    return { canvas: source, restore: (b) => b, angle: 0 };
  const rad = (angle * Math.PI) / 180,
    c = Math.cos(rad),
    s = Math.sin(rad),
    canvas = document.createElement("canvas");
  canvas.width = Math.ceil(
    Math.abs(source.width * c) + Math.abs(source.height * s),
  );
  canvas.height = Math.ceil(
    Math.abs(source.width * s) + Math.abs(source.height * c),
  );
  const out = canvas.getContext("2d");
  out.fillStyle = "white";
  out.fillRect(0, 0, canvas.width, canvas.height);
  out.translate(canvas.width / 2, canvas.height / 2);
  out.rotate(rad);
  out.drawImage(source, -source.width / 2, -source.height / 2);
  const restore = (b) => {
    const p = [
      [b.x0, b.y0],
      [b.x1, b.y0],
      [b.x0, b.y1],
      [b.x1, b.y1],
    ].map(([x, y]) => {
      x -= canvas.width / 2;
      y -= canvas.height / 2;
      return [
        c * x + s * y + source.width / 2,
        -s * x + c * y + source.height / 2,
      ];
    });
    return {
      x0: Math.min(...p.map((v) => v[0])),
      y0: Math.min(...p.map((v) => v[1])),
      x1: Math.max(...p.map((v) => v[0])),
      y1: Math.max(...p.map((v) => v[1])),
    };
  };
  return { canvas, restore, angle };
}
