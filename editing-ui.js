import { textSelection } from "./text-layout.js";
import { t } from "./i18n.js";
import {
  textLayout,
  imageMatrix,
  matrix,
  point,
  textMatrix,
} from "./content-engine.js";
import { inspectContent } from "./engine-client.js";
import { previewFont, fontStyle } from "./font-manager.js";
import { textBlocks, collisionItems, analyzeRoutes } from "./text-model.js";
const getChangedLabel = () => t(" • changed");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function createContentEditor(api) {
  let selected = null,
    selectionPage = null,
    result = null,
    epoch = 0,
    layoutEpoch = 0,
    comparison = false,
    buffer = null,
    drag = null,
    dirty = false,
    editVersion = "",
    selectionScope = "word",
    pendingFocus = null,
    recovery = null;
  document.addEventListener("languagechange", () => {
    for (const option of document.querySelectorAll(
      "#object-picker option[data-label]",
    ))
      option.textContent =
        (option.dataset.documentText === "true"
          ? option.dataset.label
          : option.dataset.label.replace(
              /^(🔒 )?(.*)$/s,
              (_, lock, label) => (lock || "") + t(label),
            )) + (option.dataset.changed === "true" ? getChangedLabel() : "");
  });
  const analyses = new Map();
  let blocks = [],
    recoveries = [],
    regionMode = false;
  const layer = document.createElement("div");
  layer.id = "content-layer";
  document.querySelector("#page-wrap").append(layer);
  const $ = (s) => document.querySelector(s),
    panel = () => $("#properties");
  function persistBuffer(caretOnly = false) {
    const p = api.page();
    if (
      !p ||
      p.id !== selectionPage ||
      comparison ||
      (caretOnly && !p.textDraft)
    )
      return;
    if (recovery) {
      api.buffer?.(
        p,
        {
          kind: "recovery",
          id: recovery.id,
          region: recovery.region,
          confidence: recovery.confidence,
          text: recovery.text,
          caret: $("#recovery-inline")
            ? {
                start: $("#recovery-inline").selectionStart,
                end: $("#recovery-inline").selectionEnd,
              }
            : recovery.caret,
        },
        !caretOnly,
      );
      return;
    }
    if (!dirty || !buffer || current()?.type !== "text") return;
    const input = $("#inline-content-text");
    api.buffer?.(
      p,
      {
        kind: "native",
        id: selected,
        buffer: structuredClone(buffer),
        baseRevision: p.contentRevision || 0,
        caret: input
          ? {
              start: input.selectionStart,
              end: input.selectionEnd,
              direction: input.selectionDirection,
            }
          : p.textDraft?.caret,
      },
      !caretOnly,
    );
  }
  function focusText(range) {
    pendingFocus = range || { start: 0, end: buffer?.text?.length || 0 };
  }
  function selectNext(delta) {
    const items = result.items.filter(
      (item) =>
        item.type === "text" &&
        item.editable &&
        !api.page().contentEdits?.[item.id]?.groupLeader,
    );
    const index = items.findIndex((item) => item.id === selected);
    if (items.length)
      choose(items[(index + delta + items.length) % items.length].id);
  }
  const current = () => result?.items.find((i) => i.id === selected);
  function bounds(item, edit) {
    let q = item.quad;
    if (item.type === "text" && edit && !comparison)
      q = q.map(([x, y]) => [
        x + Number(edit.dx || 0),
        y + Number(edit.dy || 0),
      ]);
    if (item.type === "image" && edit && !comparison) {
      const m = imageMatrix(item, edit);
      q = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map((p) => point(m, ...p));
    }
    if (item.type === "text" && edit?.groupIds && !comparison)
      q = edit.groupIds.flatMap(
        (id) => result.items.find((i) => i.id === id)?.quad || [],
      );
    const pts = q.map((p) => point(api.viewport().transform, ...p)),
      xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1]);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(8, Math.max(...xs) - Math.min(...xs)),
      h: Math.max(12, Math.max(...ys) - Math.min(...ys)),
    };
  }
  function place(el, b) {
    const vp = api.viewport();
    Object.assign(el.style, {
      left: `${(100 * b.x) / vp.width}%`,
      top: `${(100 * b.y) / vp.height}%`,
      width: `${(100 * b.w) / vp.width}%`,
      height: `${(100 * b.h) / vp.height}%`,
    });
  }
  function capture() {
    const input = $("#inline-content-text") || $("#recovery-inline");
    if (input) {
      pendingFocus = {
        start: input.selectionStart,
        end: input.selectionEnd,
        focus: document.activeElement === input,
      };
      persistBuffer(true);
    }
  }
  function clear() {
    regionMode = false;
    epoch++;
    layer.replaceChildren();
    layer.hidden = true;
    comparison = false;
    api.compare(false);
    dirty = false;
    recovery = null;
    layoutEpoch++;
  }
  function draw() {
    layer.replaceChildren();
    layer.hidden = api.tool() !== "content";
    if (layer.hidden || !result) return;
    const p = api.page();
    if (regionMode) {
      regionOverlay();
      return;
    }
    for (const item of result.items) {
      if (
        !item.quad.every((pt) => pt.every(Number.isFinite)) ||
        (item.type === "text" &&
          (!item.fontInfo || item.reason?.startsWith("An earlier unsupported")))
      )
        continue;
      if (item.type === "text" && item.renderMode === 3) continue;
      const edit =
        item.id === selected && buffer ? buffer : p.contentEdits?.[item.id];
      if ((edit?.remove || edit?.groupLeader) && !comparison) continue;
      const box = document.createElement("button");
      box.type = "button";
      box.className = `content-hit ${item.type === "image" ? "image-hit" : ""} ${item.editable ? "" : "read-only"} ${item.id === selected ? "selected" : ""}`;
      box.setAttribute(
        "aria-label",
        `${item.editable ? "Edit PDF" : "Content is read-only"} · ${item.type === "text" ? "Text" : "Image"}: ${item.text || item.label}`,
      );
      box.dataset.pdfTitle = String(!item.reason);
      box.title = item.reason || item.text || item.label;
      place(box, bounds(item, edit));
      box.onclick = (e) => {
        e.stopPropagation();
        if (drag) return;
        if (selectionScope === "paragraph") {
          const block = blocks.find((block) =>
            block.items.some((member) => member.id === item.id),
          );
          if (block && !dirty) {
            chooseBlock(block);
            return;
          }
        }
        choose(item.id, e);
      };
      layer.append(box);
      if (
        item.id === selected &&
        item.type === "image" &&
        item.editable &&
        !comparison
      ) {
        const handle = document.createElement("span");
        handle.className = "content-resize";
        handle.title = "Resize image";
        box.append(handle);
        box.onpointerdown = (e) => {
          e.preventDefault();
          box.setPointerCapture(e.pointerId);
          drag = {
            id: item.id,
            start: [e.clientX, e.clientY],
            edit: structuredClone(buffer || edit || { type: "image" }),
            resize: e.target === handle,
            box,
            bounds: bounds(item, edit),
            moved: false,
          };
        };
        box.onpointermove = moveImage;
        box.onpointerup = () => {
          if (drag?.moved) {
            dirty = true;
            persistBuffer();
            syncImageControls();
            updateImagePreview();
            setTimeout(() => (drag = null), 0);
          } else drag = null;
        };
        box.onpointercancel = () => {
          if (drag) buffer = drag.edit;
          drag = null;
          draw();
        };
      }
    }
    for (const [i, area] of recoveries.entries()) {
      const button = document.createElement("button");
      button.className = "content-hit read-only";
      button.setAttribute(
        "aria-label",
        "Make this text editable: " + area.text,
      );
      button.title = "Create an editable copy of this text";
      Object.assign(button.style, {
        left: area.region.x * 100 + "%",
        top: area.region.y * 100 + "%",
        width: area.region.w * 100 + "%",
        height: area.region.h * 100 + "%",
      });
      button.onclick = () => chooseRecovery(area);
      layer.append(button);
    }
    if (recovery && !comparison) {
      recoveryInline();
      return;
    }
    if (current()?.type === "text" && current().editable && !comparison)
      inlineText();
  }
  function choose(id, event) {
    if (recovery && api.page().textDraft) {
      api.notify("Apply or cancel the current edit first.");
      return;
    }
    id = api.page().contentEdits?.[id]?.groupLeader || id;
    if (dirty && id !== selected) {
      api.notify("Apply or cancel the current edit first.");
      return;
    }
    const target = result.items.find((item) => item.id === id);
    if (target?.type === "text" && !target.editable) {
      const b = bounds(target),
        vp = api.viewport();
      chooseRecovery({
        id: target.id,
        text: target.text,
        reason: target.reason,
        confidence: null,
        region: {
          x: Math.max(0, b.x / vp.width),
          y: Math.max(0, b.y / vp.height),
          w: Math.min(1 - b.x / vp.width, b.w / vp.width),
          h: Math.min(1 - b.y / vp.height, b.h / vp.height),
        },
      });
      return;
    }
    recovery = null;
    selected = id;
    if ($("#object-picker")) $("#object-picker").value = id;
    buffer = structuredClone(
      api.page().contentEdits?.[id] || {
        type: current().type,
        ...(current().type === "text"
          ? { text: current().text, fit: "shrink" }
          : {}),
      },
    );
    dirty = false;
    const text = buffer.text || "",
      boundsBox = bounds(current(), buffer),
      rect = $("#page-wrap").getBoundingClientRect();
    let index = 0;
    if (event) {
      const transform = matrix(
          api.viewport().transform,
          textMatrix(current(), buffer),
        ),
        [a, b, c, d, e, f] = transform,
        det = a * d - b * c;
      const px =
          ((event.clientX - rect.left) / rect.width) * api.viewport().width,
        py = ((event.clientY - rect.top) / rect.height) * api.viewport().height;
      const x = (d * (px - e) - c * (py - f)) / det,
        ratio = Math.max(0, Math.min(1, x / Math.max(1, current().advance)));
      const context = document.createElement("canvas").getContext("2d");
      context.font = current().size + "px Arial";
      const width = context.measureText(text).width,
        target = width * ratio;
      while (
        index < text.length &&
        context.measureText(text.slice(0, index + 1)).width < target
      )
        index++;
    }
    focusText(textSelection(text, index, selectionScope));
    details();
    draw();
  }
  function inlineText() {
    const item = current(),
      edit = buffer || api.page().contentEdits?.[item.id] || {},
      b = bounds(item, edit),
      input = document.createElement("textarea");
    input.id = "inline-content-text";
    input.setAttribute("aria-label", "Edit text on page");
    input.value = edit.text ?? item.text;
    input.spellcheck = true;
    input.style.fontWeight = /bold|semibold/i.test(item.label) ? "700" : "400";
    input.style.fontStyle = /italic|oblique/i.test(item.label)
      ? "italic"
      : "normal";
    place(input, { ...b, w: Math.max(b.w, 80), h: Math.max(b.h, 24) });
    const scale = $("#page-wrap").clientWidth / api.viewport().width;
    input.style.fontSize = `${Math.max(10, (Number(edit.size) || item.size) * Math.hypot(item.matrix[2], item.matrix[3]) * scale)}px`;
    input.style.fontFamily = /times/i.test(item.label)
      ? "Georgia,serif"
      : /courier/i.test(item.label)
        ? "monospace"
        : "Arial,sans-serif";
    input.oninput = () => {
      buffer.text = input.value;
      dirty = true;
      persistBuffer();
      const side = $("#content-text");
      if (side) side.value = input.value;
      checkLayout();
    };
    input.onselect = input.onkeyup = () => persistBuffer(true);
    input.onkeydown = (e) => {
      if (e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        selectNext(e.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    };
    layer.append(input);
    floatingToolbar();
    if (pendingFocus) {
      const range = pendingFocus;
      pendingFocus = null;
      if (range.focus !== false) input.focus({ preventScroll: true });
      input.setSelectionRange(
        Math.min(range.start, input.value.length),
        Math.min(range.end, input.value.length),
      );
    }
    checkLayout();
  }
  function originalColor(item) {
    const parts = item.color?.split(" ") || [],
      operator = parts.pop(),
      values = parts.map(Number);
    let rgb = [0.09, 0.23, 0.2];
    if (operator === "rg") rgb = values;
    if (operator === "g") rgb = [values[0], values[0], values[0]];
    if (operator === "k")
      rgb = values.slice(0, 3).map((value) => (1 - value) * (1 - values[3]));
    return (
      "#" +
      rgb
        .map((value) =>
          Math.max(0, Math.min(255, Math.round(value * 255)))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }
  function positionInline(input, item, edit, layout) {
    const transform = matrix(api.viewport().transform, textMatrix(item, edit)),
      scale = $("#page-wrap").clientWidth / api.viewport().width,
      yScale = Math.hypot(transform[2], transform[3]);
    const [x, y] = point(transform, 0, item.rise + layout.size * 0.93);
    Object.assign(input.style, {
      left: x * scale + "px",
      top: y * scale + "px",
      width: Math.max(30, layout.width * yScale * scale + 10) + "px",
      height: Math.max(28, layout.height * yScale * scale + 8) + "px",
      fontSize: Math.max(4, layout.size * yScale * scale) + "px",
      transformOrigin: "0 0",
      transform: `matrix(${transform[0] / yScale},${transform[1] / yScale},${-transform[2] / yScale},${-transform[3] / yScale},0,0)`,
      color: edit.color || originalColor(item),
      fontWeight: /bold/.test(edit.style || fontStyle(item.label))
        ? "700"
        : "400",
      fontStyle: /italic/.test(edit.style || fontStyle(item.label))
        ? "italic"
        : "normal",
    });
    input.wrap = edit.fit === "wrap" ? "soft" : "off";
    positionFormatbar();
  }
  let barFrame;
  const barResize = new ResizeObserver(positionFormatbar);
  function positionFormatbar() {
    cancelAnimationFrame(barFrame);
    barFrame = requestAnimationFrame(() => {
      const bar = layer.querySelector(".inline-formatbar"),
        input = $("#inline-content-text");
      if (!bar || !input) return;
      const stage = $("#stage").getBoundingClientRect(),
        box = input.getBoundingClientRect(),
        visual = window.visualViewport,
        top = Math.max(stage.top, visual?.offsetTop || 0) + 8,
        bottom =
          Math.min(
            stage.bottom,
            (visual?.offsetTop || 0) + (visual?.height || innerHeight),
          ) - 8;
      bar.style.maxWidth =
        Math.max(240, Math.min(620, stage.width - 16)) + "px";
      const size = bar.getBoundingClientRect();
      bar.style.left =
        Math.max(
          stage.left + 8,
          Math.min(box.left, stage.right - size.width - 8),
        ) + "px";
      const above = box.top - size.height - 10,
        below = box.bottom + 10;
      bar.style.top =
        (above >= top ? above : below + size.height <= bottom ? below : top) +
        "px";
      bar.hidden = box.bottom < top || box.top > bottom;
    });
  }
  $("#stage").addEventListener("scroll", positionFormatbar, { passive: true });
  window.addEventListener("resize", positionFormatbar);
  window.visualViewport?.addEventListener("resize", positionFormatbar);
  new ResizeObserver(positionFormatbar).observe(layer);
  function floatingToolbar() {
    const bar = document.createElement("div");
    bar.className = "inline-formatbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Text formatting");
    bar.innerHTML = `<button type="button" id="inline-previous" title="Previous text">←</button><button type="button" id="inline-next" title="Next text">→</button><select id="inline-family" aria-label="Text typeface"><option value="original">Original</option><option value="Helvetica">Helvetica</option><option value="Times">Times</option><option value="Courier">Courier</option></select><button type="button" id="inline-bold" aria-label="Bold">B</button><button type="button" id="inline-italic" aria-label="Italic">I</button><input id="inline-size" aria-label="Text size" type="number" min="2" max="200"><input id="inline-color" aria-label="Text color" type="color"><select id="inline-align" aria-label="Text alignment"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select><button type="button" id="inline-apply">Apply</button><button type="button" id="inline-cancel">Cancel</button>`;
    layer.append(bar);
    const more = document.createElement("button");
    more.id = "inline-more";
    more.type = "button";
    more.textContent = "More formatting";
    more.onclick = () => api.showProperties?.();
    bar.append(more);
    barResize.disconnect();
    barResize.observe(bar);
    positionFormatbar();
    $("#inline-previous").onclick = () => selectNext(-1);
    $("#inline-next").onclick = () => selectNext(1);
    $("#inline-apply").onclick = apply;
    $("#inline-cancel").onclick = cancel;
    for (const [inline, side] of [
      ["inline-family", "text-family"],
      ["inline-size", "text-size"],
      ["inline-color", "text-color"],
      ["inline-align", "text-align"],
    ])
      $("#" + inline).oninput = () => {
        const control = $("#" + side);
        control.value = $("#" + inline).value;
        control.dispatchEvent(new Event("input"));
      };
    const toggle = (kind) => {
      const style = buffer.style || fontStyle(current().label),
        bold = /bold/.test(style) !== (kind === "bold"),
        italic = /italic/.test(style) !== (kind === "italic");
      $("#text-style").value = bold
        ? italic
          ? "bolditalic"
          : "bold"
        : italic
          ? "italic"
          : "regular";
      $("#text-style").dispatchEvent(new Event("input"));
    };
    $("#inline-bold").onclick = () => toggle("bold");
    $("#inline-italic").onclick = () => toggle("italic");
    syncToolbar();
  }
  function syncToolbar(effectiveStyle) {
    if (!$("#inline-size") || !current() || !buffer) return;
    $("#inline-size").value = buffer.size || current().size;
    $("#inline-family").value = buffer.family || "original";
    $("#inline-color").value = buffer.color || originalColor(current());
    $("#inline-align").value = buffer.align || "left";
    const style = effectiveStyle || buffer.style || fontStyle(current().label);
    $("#inline-bold").disabled = $("#inline-italic").disabled =
      !!buffer.fontData;
    $("#inline-bold").setAttribute("aria-pressed", String(/bold/.test(style)));
    $("#inline-italic").setAttribute(
      "aria-pressed",
      String(/italic/.test(style)),
    );
  }
  function chooseRecovery(area) {
    if (dirty) {
      api.notify("Apply or cancel the current edit first.");
      return;
    }
    selected = null;
    recovery = { ...area };
    selectionPage = api.page().id;
    persistBuffer();
    recoveryDetails();
    draw();
    $("#recovery-inline")?.focus({ preventScroll: true });
  }
  function recoveryDetails() {
    if (!$("#object-details")) return;
    $("#object-details").innerHTML =
      `<h4>Recognized text</h4><p>${recovery.confidence == null ? "Extracted text — review before replacing." : Math.round(recovery.confidence) + "% OCR confidence — review before replacing."}</p><p>Type directly on the page, then preview a regional replacement. Your original draft is retained.</p><button class="primary" id="review-recovered">Preview replacement</button><button class="secondary" id="cancel-recovered">Cancel</button>`;
    $("#review-recovered").onclick = () =>
      api.ocr(recovery.region, {
        text: recovery.text,
        confidence: recovery.confidence,
      });
    $("#cancel-recovered").onclick = () => {
      api.buffer?.(api.page(), null, true);
      recovery = null;
      selected = null;
      refresh();
    };
    prioritizeDetails();
    api.resize();
  }
  function recoveryInline() {
    const input = document.createElement("textarea");
    input.id = "recovery-inline";
    input.setAttribute("aria-label", "Edit recognized text");
    input.value = recovery.text;
    Object.assign(input.style, {
      left: recovery.region.x * 100 + "%",
      top: recovery.region.y * 100 + "%",
      width: Math.max(recovery.region.w * 100, 12) + "%",
      height: Math.max(recovery.region.h * 100, 3) + "%",
    });
    input.oninput = () => {
      recovery.text = input.value;
      persistBuffer();
    };
    input.onselect = input.onkeyup = () => persistBuffer(true);
    input.onkeydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        $("#review-recovered").click();
      }
      if (event.key === "Escape") $("#cancel-recovered").click();
    };
    layer.append(input);
    input.style.fontSize =
      Math.max(
        10,
        (recovery.region.h * $("#page-wrap").clientHeight * 0.78) /
          Math.max(1, recovery.text.split("\n").length),
      ) + "px";
    const caret = pendingFocus || recovery.caret;
    pendingFocus = null;
    if (caret) {
      if (caret.focus !== false && document.activeElement?.tagName === "BODY")
        input.focus({ preventScroll: true });
      input.setSelectionRange(
        Math.min(caret.start, input.value.length),
        Math.min(caret.end, input.value.length),
      );
    }
  }
  function moveImage(e) {
    if (!drag) return;
    const item = current(),
      rect = $("#page-wrap").getBoundingClientRect(),
      vp = api.viewport(),
      dx = ((e.clientX - drag.start[0]) * vp.width) / rect.width,
      dy = ((e.clientY - drag.start[1]) * vp.height) / rect.height;
    buffer = structuredClone(drag.edit);
    drag.moved = true;
    if (drag.resize) {
      const factor = Math.max(0.05, (drag.bounds.w + dx) / drag.bounds.w);
      buffer.scaleX = Math.min(
        20,
        Math.max(0.05, (drag.edit.scaleX || 1) * factor),
      );
      buffer.scaleY = Math.min(
        20,
        Math.max(0.05, (drag.edit.scaleY || drag.edit.scaleX || 1) * factor),
      );
    } else {
      const m = vp.transform,
        det = m[0] * m[3] - m[1] * m[2];
      buffer.dx = (drag.edit.dx || 0) + (m[3] * dx - m[2] * dy) / det;
      buffer.dy = (drag.edit.dy || 0) + (-m[1] * dx + m[0] * dy) / det;
    }
    place(drag.box, bounds(item, buffer));
  }
  function syncImageControls() {
    for (const key of ["dx", "dy", "scaleX", "scaleY", "rotation"]) {
      const el = $(`#image-${key}`);
      if (el)
        el.value = Number(
          (buffer[key] ?? (key.startsWith("scale") ? 1 : 0)).toFixed(2),
        );
    }
  }
  function updateImagePreview() {
    const box = layer.querySelector(".selected");
    if (box) place(box, bounds(current(), buffer));
    $("#edit-status").textContent =
      "Preview outline updated. Apply to update the image.";
  }
  async function checkLayout() {
    if (!current() || !buffer) return;
    const n = ++layoutEpoch;
    try {
      const lay = await textLayout(current(), buffer),
        family = lay.managed
          ? await previewFont(lay.style, buffer.fontData)
          : null;
      if (n !== layoutEpoch || !$("#edit-status")) return;
      $("#edit-status").textContent =
        `${lay.useFallback ? `Font fallback: ${lay.font}. ` : "Original font preserved. "}${lay.overflow ? "Text still exceeds the box. Widen it or allow overflow." : `${lay.lines.length} line${lay.lines.length === 1 ? "" : "s"} · ${lay.size.toFixed(1)} pt.`}${lay.lines.length > 1 ? " Wrapped lines can overlap other objects; review the page." : ""}`;
      const collisions = collisionItems(
        current(),
        lay,
        result.items,
        buffer.groupIds || [],
        buffer,
      );
      if (collisions.length)
        $("#edit-status").textContent +=
          " Overlaps " + collisions.length + " nearby content area(s).";
      $("#edit-status").classList.toggle(
        "error",
        lay.overflow || collisions.length > 0,
      );
      const input = $("#inline-content-text");
      if (input) {
        const scale = $("#page-wrap").clientWidth / api.viewport().width,
          b = bounds(current(), buffer);
        input.style.height = `${Math.max(28, lay.height * Math.hypot(current().matrix[2], current().matrix[3]) * scale)}px`;
        input.style.width = `${Math.max(60, lay.width * Math.hypot(current().matrix[0], current().matrix[1]) * scale)}px`;
        input.style.fontSize = `${Math.max(9, lay.size * Math.hypot(current().matrix[2], current().matrix[3]) * scale)}px`;
        if (input.value !== buffer.text) input.value = buffer.text;
        input.style.lineHeight = String(lay.lineHeight);
        input.style.textAlign = buffer.align || "left";
        positionInline(input, current(), buffer, lay);
        syncToolbar(lay.managed ? fontStyle(lay.font) : undefined);
        if ($("#text-style")) $("#text-style").disabled = !!buffer.fontData;
        if (family) {
          input.style.fontFamily = family;
          input.style.fontStyle = "normal";
          input.style.fontWeight = "normal";
        }
      }
    } catch (e) {
      if ($("#edit-status")) $("#edit-status").textContent = e.message;
    }
  }
  async function apply() {
    if (!current() || !buffer) return;
    try {
      if (current().type === "text") {
        const layout = await textLayout(current(), buffer),
          hits = collisionItems(
            current(),
            layout,
            result.items,
            buffer.groupIds || [],
            buffer,
          );
        if (hits.length && !buffer.allowOverlap) {
          api.notify(
            "This text overlaps nearby content. Reduce its size, change its width, or allow overlap after review.",
            true,
          );
          return;
        }
      }
      const p = api.page(),
        next = {
          ...(p.contentEdits || {}),
          [selected]: structuredClone(buffer),
        };
      for (const id of buffer.groupIds || [])
        if (id !== selected)
          next[id] = {
            type: "text",
            text: "",
            fit: "keep",
            groupLeader: selected,
          };
      if (await api.commit(p, next)) {
        dirty = false;
      }
    } catch (e) {
      api.notify(e.message, true);
    }
  }
  function cancel() {
    api.buffer?.(api.page(), null, true);
    recovery = null;
    dirty = false;
    buffer = structuredClone(
      api.page().contentEdits?.[selected] || {
        type: current().type,
        ...(current().type === "text"
          ? { text: current().text, fit: "shrink" }
          : {}),
      },
    );
    details();
    draw();
  }
  let detailKey = null;
  function prioritizeDetails() {
    const next = recovery
      ? "recovery:" + JSON.stringify(recovery.region)
      : selected;
    const options = panel().querySelector(".page-options");
    if (options && next) options.open = false;
    if (next !== detailKey) panel().scrollTop = 0;
    detailKey = next;
    api.resize();
  }
  function details() {
    const item = current();
    if (!item) return;
    const edit = buffer || {},
      hasEdit = !!api.page().contentEdits?.[item.id];
    if (recovery) return;
    $("#object-details").innerHTML =
      `<h4>${item.type === "text" ? "Text" : "Image"} ${item.path.length ? "· nested object" : ""}</h4><p class="original-value">${esc(item.text || `${item.width} × ${item.height} pixels`)}</p>${
        !item.editable
          ? `<p class="compatibility">${esc(item.reason)}</p><button class="primary" id="rebuild-object">Make this text editable</button>`
          : comparison
            ? "<p>Showing the original page. Switch to Edited to make changes.</p>"
            : item.type === "text"
              ? `<label for="content-text">Replacement text</label><textarea id="content-text" aria-label="Edit original text">${esc(edit.text ?? item.text)}</textarea><div class="edit-grid"><label>Size (pt)<input id="text-size" type="number" min="2" max="200" value="${edit.size || item.size}"></label><label>Box width<input id="text-width" type="number" min="4" value="${edit.width || Math.max(4, Math.round(item.advance))}"></label></div><label for="text-fit">Longer text</label><select id="text-fit"><option value="shrink">Shrink to fit</option><option value="wrap">Wrap into lines</option><option value="keep">Keep size</option></select><details class="advanced-settings"><summary>Font, position and overflow</summary><label for="text-font">Font</label><select id="text-font"><option value="auto">Reuse original when possible</option><option value="fallback">Use matching standard font</option><option value="embedded">Embed Liberation Sans</option><option value="custom">Use imported font</option></select><div class="edit-grid"><label>Typeface<select id="text-family"><option value="original">Original family</option><option value="Helvetica">Helvetica</option><option value="Times">Times</option><option value="Courier">Courier</option></select></label><label>Style<select id="text-style"><option value="original">Original style</option><option value="regular">Regular</option><option value="bold">Bold</option><option value="italic">Italic</option><option value="bolditalic">Bold italic</option></select></label><label>Text color<input id="text-color" type="color" value="${edit.color || originalColor(item)}"></label><label>Move X<input id="text-dx" type="number" step="1" value="${edit.dx || 0}"></label><label>Move Y<input id="text-dy" type="number" step="1" value="${edit.dy || 0}"></label></div><label>Import a font (TTF / OTF)<input id="import-text-font" type="file" accept=".ttf,.otf"></label><div class="edit-grid"><label>Alignment<select id="text-align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Line spacing<input id="text-leading" type="number" min="0.8" max="3" step="0.1" value="${edit.lineHeight || 1.2}"></label></div><label><input type="checkbox" id="allow-overlap" ${edit.allowOverlap ? "checked" : ""}> Allow overlap after review</label><label><input type="checkbox" id="allow-overflow" ${edit.allowOverflow ? "checked" : ""}> Allow overflow after review</label></details>`
              : `<label>Replace image<input type="file" id="replace-content-image" aria-label="Replace original image" accept="image/png,image/jpeg"></label><label>Replacement fit<select id="image-fit"><option value="contain">Keep proportions (fit)</option><option value="cover">Keep proportions (crop to fill)</option></select></label><div class="edit-grid">${[
                  ["dx", "Move X", 0],
                  ["dy", "Move Y", 0],
                  ["scaleX", "Width scale", 1],
                  ["scaleY", "Height scale", 1],
                  ["rotation", "Rotation (°)", 0],
                ]
                  .map(
                    ([key, label, def]) =>
                      `<label>${label}<input id="image-${key}" type="number" step="${key.startsWith("scale") ? ".05" : "1"}" value="${edit[key] ?? def}"></label>`,
                  )
                  .join(
                    "",
                  )}</div><label><input type="checkbox" id="lock-ratio" checked> Lock proportions</label><button id="remove-content-image" class="secondary">Remove image</button>`
      }<p id="edit-status" aria-live="polite"></p><div class="edit-actions">${item.editable && !comparison ? '<button class="primary" id="apply-content">Apply</button><button class="secondary" id="cancel-content">Cancel</button>' : ""}${hasEdit ? '<button class="secondary" id="reset-object">Reset this object</button>' : ""}</div>`;
    const actions = $("#object-details>.edit-actions");
    if (actions) $("#object-details").prepend(actions);
    prioritizeDetails();
    if ($("#reset-object"))
      $("#reset-object").onclick = async () => {
        const p = api.page(),
          next = { ...p.contentEdits };
        for (const id of next[item.id]?.groupIds || []) delete next[id];
        delete next[item.id];
        dirty = false;
        api.buffer?.(p, null, true);
        await api.commit(p, next);
      };
    if (!item.editable || comparison) {
      if ($("#rebuild-object"))
        $("#rebuild-object").onclick = () => {
          const b = bounds(item),
            vp = api.viewport();
          if (!item.fontInfo) {
            regionMode = true;
            draw();
          } else
            api.ocr({
              x: Math.max(0, b.x / vp.width),
              y: Math.max(0, b.y / vp.height),
              w: Math.min(1, b.w / vp.width),
              h: Math.min(1, b.h / vp.height),
            });
        };
      api.resize();
      return;
    }
    $("#apply-content").onclick = apply;
    $("#cancel-content").onclick = cancel;
    if (item.type === "text") {
      $("#text-fit").value = edit.fit || "shrink";
      $("#text-font").value = edit.font || "auto";
      $("#text-align").value = edit.align || "left";
      $("#text-family").value = edit.family || "original";
      $("#text-style").value = edit.style || "original";
      const change = () => {
        if ($("#text-family").value !== (buffer.family || "original")) {
          delete buffer.fontData;
          $("#text-font").value =
            $("#text-family").value === "original" ? "auto" : "fallback";
        }
        buffer = {
          ...buffer,
          type: "text",
          text: $("#content-text").value,
          size: Number($("#text-size").value),
          width: Number($("#text-width").value),
          fit: $("#text-fit").value,
          font: $("#text-font").value,
          allowOverflow: $("#allow-overflow").checked,
          allowOverlap: $("#allow-overlap").checked,
          align: $("#text-align").value,
          lineHeight: Number($("#text-leading").value),
          family: $("#text-family").value,
          style:
            $("#text-style").value === "original"
              ? undefined
              : $("#text-style").value,
          dx: Number($("#text-dx").value),
          dy: Number($("#text-dy").value),
        };
        dirty = true;
        persistBuffer();
        checkLayout();
      };
      for (const id of [
        "content-text",
        "text-size",
        "text-width",
        "text-fit",
        "text-font",
        "allow-overflow",
        "allow-overlap",
        "text-align",
        "text-leading",
        "text-family",
        "text-style",
        "text-dx",
        "text-dy",
      ])
        $("#" + id).oninput = change;
      $("#text-color").oninput = () => {
        buffer.color = $("#text-color").value;
        dirty = true;
        persistBuffer();
        checkLayout();
      };
      checkLayout();
      $("#import-text-font").onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024)
          return api.notify("Choose a font below 5 MB.", true);
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        buffer.fontData = data;
        buffer.family = "original";
        delete buffer.style;
        $("#text-family").value = "original";
        $("#text-style").value = "original";
        buffer.font = "custom";
        $("#text-font").value = "custom";
        dirty = true;
        persistBuffer();
        checkLayout();
      };
      $("#text-font").onchange = () => {
        if ($("#text-font").value !== "custom") delete buffer.fontData;
        change();
      };
    } else {
      $("#image-fit").value = edit.fit || "contain";
      $("#image-fit").onchange = (e) => {
        buffer.fit = e.target.value;
        dirty = true;
        persistBuffer();
      };
      for (const key of ["dx", "dy", "scaleX", "scaleY", "rotation"])
        $(`#image-${key}`).oninput = (e) => {
          buffer[key] = Number(e.target.value);
          if (key.startsWith("scale") && $("#lock-ratio").checked) {
            buffer.scaleX = buffer.scaleY = buffer[key];
            syncImageControls();
          }
          dirty = true;
          persistBuffer();
          try {
            updateImagePreview();
          } catch (err) {
            $("#edit-status").textContent = err.message;
          }
        };
      $("#replace-content-image").onchange = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 8 * 1024 * 1024)
          return api.notify("Choose an image smaller than 8 MB.", true);
        const r = new FileReader();
        r.onload = () => {
          buffer.data = r.result;
          buffer.remove = false;
          dirty = true;
          persistBuffer();
          $("#edit-status").textContent =
            "Replacement ready. Apply to preview it.";
        };
        r.readAsDataURL(f);
      };
      $("#remove-content-image").onclick = () => {
        buffer.remove = true;
        dirty = true;
        persistBuffer();
        apply();
      };
    }
    api.resize();
  }
  async function refresh() {
    if (api.tool() !== "content") {
      clear();
      return;
    }
    const e = ++epoch,
      p = api.page();
    if (selectionPage !== p.id) {
      selected = null;
      selectionPage = p.id;
      dirty = false;
      comparison = false;
      api.compare(false);
    }
    layer.hidden = false;
    $("#page-hint").textContent = comparison
      ? "Original page · switch to Edited to make changes"
      : "Tap outlined text or an image to edit it.";
    panel().innerHTML = "<h3>Edit PDF</h3><p>Finding text and images…</p>";
    try {
      const cacheKey = api.source().id + ":" + p.index + ":" + p.rotation;
      if (!analyses.has(cacheKey)) {
        analyses.set(
          cacheKey,
          api.analysis
            ? await api.analysis(p)
            : await inspectContent(api.source().bytes, p.index),
        );
        if (analyses.size > 8) analyses.delete(analyses.keys().next().value);
      }
      result = analyses.get(cacheKey);
      if (e !== epoch || api.tool() !== "content" || api.page() !== p) return;
      blocks = textBlocks(result.items);
      recoveries = [];
      try {
        const areas = result.extracted || (await api.extracted());
        if (e !== epoch) return;
        recoveries = areas.filter(
          (area) =>
            !result.items.some((i) => {
              if (
                i.type !== "text" ||
                i.renderMode === 3 ||
                !i.fontInfo ||
                i.reason?.startsWith("An earlier unsupported")
              )
                return false;
              const b = bounds(i),
                v = api.viewport(),
                r = area.region;
              return (
                b.x / v.width < r.x + r.w &&
                b.x / v.width + b.w / v.width > r.x &&
                b.y / v.height < r.y + r.h &&
                b.y / v.height + b.h / v.height > r.y
              );
            }),
        );
      } catch {}
      recoveries.push(...(api.recognized?.(p) || []));
      const routes = analyzeRoutes(result.items, recoveries.length);
      const edits = Object.keys(p.contentEdits || {}).length;
      panel().innerHTML = `<h3>Edit PDF</h3><p>Tap text to edit it, or select an area to reconstruct.</p><div class="route-summary">${routes.direct} direct text edits · ${routes.rebuild} need reconstruction${routes.scan ? " · No native text detected" : ""}</div><label>Selection<select id="text-selection"><option value="word">Word</option><option value="sentence">Sentence</option><option value="paragraph">Paragraph</option></select></label><p>Click text and type. Alt + Left / Right selects nearby text. Unapplied typing is saved in your draft.</p><button class="primary full" id="select-text-area">Make an area editable</button>${blocks.length ? `<label>Sentences & paragraphs<select id="text-block-picker"><option value="">Choose a text block</option>${blocks.map((b, i) => `<option value="${i}">${esc(b.text.slice(0, 70))}</option>`).join("")}</select></label>` : ""}<div class="compare-tabs"><button id="show-edited" class="${comparison ? "" : "active"}">Edited</button><button id="show-original" class="${comparison ? "active" : ""}">Original</button></div><p class="object-count">${result.items.filter((i) => i.type === "image" && i.editable).length} editable images · ${edits} changed objects</p><label for="object-picker">Page objects</label><select id="object-picker"><option value="">Choose text or an image</option>${result.items.map((i) => `<option value="${esc(i.id)}" data-label="${esc((i.editable ? "" : "🔒 ") + (i.text || i.label || i.reason).slice(0, 85))}" data-document-text="${!!i.text}" data-changed="${!!p.contentEdits?.[i.id]}">${i.editable ? "" : "🔒 "}${esc((i.text || t(i.label || i.reason)).slice(0, 85))}${p.contentEdits?.[i.id] ? getChangedLabel() : ""}</option>`).join("")}</select><div id="object-details"><p>Select an object to edit it. Green text is directly editable. Amber text needs review and reconstruction. Image outlines appear on hover or selection.</p></div><details class="compatibility"><summary>Compatibility details</summary><p>${esc(result.warnings.join(" ") || "All recognized objects on this page are supported.")}</p><p>Fonts with missing replacement characters use a standard-font fallback. Scans require OCR. Removal is not secure redaction.</p></details><div class="edit-actions"><button class="secondary" id="reset-content" ${edits ? "" : "disabled"}>Reset page edits</button><button class="secondary" id="ocr-page">Scan / OCR</button></div>`;
      const pageOptions = document.createElement("details");
      pageOptions.className = "page-options";
      pageOptions.open = !selected && !recovery;
      pageOptions.innerHTML = "<summary>Page tools and recognition</summary>";
      const heading = panel().querySelector("h3"),
        detail = $("#object-details"),
        compareTabs = panel().querySelector(".compare-tabs"),
        scopeLabel = $("#text-selection").closest("label");
      for (const node of [...panel().children])
        if (
          node !== heading &&
          node !== detail &&
          node !== compareTabs &&
          node !== scopeLabel
        )
          pageOptions.append(node);
      panel().append(pageOptions);
      heading.after(compareTabs, scopeLabel, detail);
      $("#text-selection").value = selectionScope;
      $("#text-selection").onchange = (event) => {
        selectionScope = event.target.value;
      };
      $("#select-text-area").onclick = () => {
        if (dirty) return api.notify("Apply or cancel your edit first.");
        regionMode = true;
        draw();
        $("#page-hint").textContent =
          "Drag a rectangle around the text to make editable. Escape cancels.";
      };
      if ($("#text-block-picker"))
        $("#text-block-picker").onchange = (e) => {
          if (e.target.value !== "")
            chooseBlock(blocks[Number(e.target.value)]);
        };
      $("#object-picker").value = selected || "";
      $("#object-picker").onchange = (e) => {
        if (e.target.value) choose(e.target.value);
      };
      const compare = async (v) => {
        if (dirty) {
          api.notify("Apply or cancel your edit before comparing.");
          return;
        }
        comparison = v;
        api.compare(v);
        draw();
        await api.render();
      };
      $("#show-original").onclick = () => compare(true);
      $("#show-edited").onclick = () => compare(false);
      $("#reset-content").onclick = async () => {
        dirty = false;
        await api.commit(p, {});
      };
      $("#ocr-page").onclick = () => api.ocr();
      const version = JSON.stringify(p.contentEdits || {});
      if (version !== editVersion) dirty = false;
      editVersion = version;
      const saved = p.textDraft;
      if (
        saved?.kind === "native" &&
        result.items.some((item) => item.id === saved.id && item.editable)
      ) {
        selected = saved.id;
        buffer = structuredClone(saved.buffer);
        dirty = true;
        if (
          saved.caret &&
          !pendingFocus &&
          document.activeElement?.tagName === "BODY"
        )
          pendingFocus = saved.caret;
        if (saved.baseRevision !== (p.contentRevision || 0))
          api.notify(
            "This recovered edit is based on older content. Review it before applying.",
            true,
          );
      }
      if (
        saved?.kind === "native" &&
        !result.items.some((item) => item.id === saved.id && item.editable)
      ) {
        $("#object-details").innerHTML =
          `<h4>Recovered typing needs review</h4><p>The original text object is no longer directly editable. Copy your saved text before choosing an area to reconstruct.</p><textarea id="unmatched-typing" aria-label="Recovered unfinished text">${esc(saved.buffer.text)}</textarea><button id="discard-unmatched" class="secondary">Discard recovered typing</button>`;
        $("#discard-unmatched").onclick = () => {
          api.buffer?.(p, null, true);
          refresh();
        };
      }
      if (saved?.kind === "recovery") {
        recovery = { ...saved };
        selected = null;
        recoveryDetails();
      }
      if (current()) {
        if (!dirty)
          buffer = structuredClone(
            p.contentEdits?.[selected] || {
              type: current().type,
              ...(current().type === "text"
                ? { text: current().text, fit: "shrink" }
                : {}),
            },
          );
        details();
      }
      draw();
      if (saved?.kind === "native" && $("#edit-status"))
        $("#edit-status").textContent =
          "Unapplied text recovered. Apply or Cancel after review.";
      api.resize();
    } catch (err) {
      if (e !== epoch || api.tool() !== "content") return;
      if (err.name === "AbortError") {
        panel().innerHTML =
          '<h3>Analysis paused</h3><button class="secondary" id="resume-page-analysis">Resume analysis</button>';
        $("#resume-page-analysis").onclick = () => {
          api.resumeAnalysis?.();
          refresh();
        };
        return;
      }
      panel().innerHTML = `<h3>Content is read-only</h3><p>${esc(err.message)}</p><button class="secondary" id="ocr-page">Scan / OCR</button>`;
      $("#ocr-page").onclick = () => api.ocr();
    }
  }
  function chooseBlock(block) {
    if (dirty) return api.notify("Apply or cancel your edit first.");
    if (block.items.some((i) => api.page().contentEdits?.[i.id]))
      return api.notify(
        "Reset the existing edits in this block before combining it.",
      );
    choose(block.id);
    buffer = {
      type: "text",
      text: block.text,
      fit: "wrap",
      width: block.width,
      groupIds: block.items.map((i) => i.id),
      lineHeight: block.lineHeight,
    };
    dirty = true;
    persistBuffer();
    focusText({ start: 0, end: buffer.text.length });
    details();
    draw();
  }
  function regionOverlay() {
    const hit = document.createElement("div");
    hit.className = "region-selector";
    hit.tabIndex = 0;
    hit.setAttribute("role", "region");
    hit.setAttribute("aria-label", "Drag to select text area");
    layer.append(hit);
    const cancel = document.createElement("button");
    cancel.className = "secondary region-cancel";
    cancel.textContent = "Cancel area selection";
    cancel.onclick = () => {
      regionMode = false;
      draw();
    };
    hit.append(cancel);
    let start, outline;
    const pos = (e) => {
      const r = hit.getBoundingClientRect();
      return [
        Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
      ];
    };
    hit.onpointerdown = (e) => {
      if (e.target === cancel) return;
      e.preventDefault();
      start = pos(e);
      hit.setPointerCapture(e.pointerId);
      outline = document.createElement("div");
      outline.className = "region-box";
      hit.append(outline);
    };
    hit.onpointermove = (e) => {
      if (!start) return;
      const p = pos(e);
      Object.assign(outline.style, {
        left: Math.min(start[0], p[0]) * 100 + "%",
        top: Math.min(start[1], p[1]) * 100 + "%",
        width: Math.abs(p[0] - start[0]) * 100 + "%",
        height: Math.abs(p[1] - start[1]) * 100 + "%",
      });
    };
    hit.onpointerup = (e) => {
      if (!start) return;
      const p = pos(e),
        region = {
          x: Math.min(start[0], p[0]),
          y: Math.min(start[1], p[1]),
          w: Math.abs(p[0] - start[0]),
          h: Math.abs(p[1] - start[1]),
        };
      start = null;
      regionMode = false;
      draw();
      if (region.w < 0.01 || region.h < 0.008)
        return api.notify("Drag a larger rectangle around the text.");
      api.ocr(region);
    };
    hit.onpointercancel = () => {
      start = null;
      regionMode = false;
      draw();
    };
    hit.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        regionMode = false;
        draw();
      }
    };
    hit.focus();
  }
  return {
    refresh,
    clear,
    capture,
    refreshRecognized: () => {
      if (!dirty && !recovery && api.tool() === "content") {
        capture();
        refresh();
      }
    },
    dispose: () => {
      clear();
      analyses.clear();
      result = null;
      buffer = null;
    },
    isComparing: () => comparison,
  };
}
