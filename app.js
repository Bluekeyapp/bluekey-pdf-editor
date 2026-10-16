import { createDocumentAnalyzer } from "./document-analysis.js";
import { getLanguage } from "./i18n.js";
import { t, locale } from "./i18n.js";
import { previewContent, cancelEngine, exportPdf } from "./engine-client.js";
import { openDraftDB, draftTransaction } from "./draft-storage.js";
import { encodeProject, decodeProject } from "./project-file.js";
import { renderPageText, findPageMatches } from "./page-text.js";
import { fontRecord, assertFontCoverage } from "./font-manager.js";
import { createContentEditor } from "./editing-ui.js";
import { openRebuild } from "./rebuild-ui.js";
import { regionLines } from "./reconstruction.js";
import { verifyExport } from "./export-check.js";
let compareView = false;
let analysis = null,
  analysisUIEpoch = 0;
let contentPanelEpoch = 0;
const contentPreviews = new Map(),
  proxyLoads = new Map(),
  loadingTasks = new Set();
let documentEpoch = 0;
async function trackedProxy(options, epoch = documentEpoch) {
  const task = pdfjs.getDocument(options);
  loadingTasks.add(task);
  try {
    const proxy = await task.promise;
    if (epoch !== documentEpoch) {
      await proxy.destroy();
      throw new DOMException("Processing canceled", "AbortError");
    }
    return proxy;
  } finally {
    loadingTasks.delete(task);
  }
}
async function pageProxy(src, p) {
  if (
    (compareView && p === page()) ||
    !Object.keys(p.contentEdits || {}).length
  )
    return loadProxy(src);
  const key = JSON.stringify(p.contentEdits),
    cached = contentPreviews.get(p.id);
  if (cached?.key === key) return cached.promise;
  const epoch = documentEpoch,
    entry = { key };
  entry.promise = (async () => {
    const data = await previewContent(src.bytes, p.index, p.contentEdits);
    if (epoch !== documentEpoch)
      throw new DOMException("Processing canceled", "AbortError");
    const proxy = await trackedProxy(
      {
        data,
        standardFontDataUrl: "./vendor/standard_fonts/",
        cMapUrl: "./vendor/cmaps/",
        cMapPacked: true,
        wasmUrl: "./vendor/wasm/",
        isEvalSupported: false,
      },
      epoch,
    );
    entry.proxy = proxy;
    if (cached?.proxy) await cached.proxy.destroy();
    for (const [id, old] of contentPreviews) {
      if (contentPreviews.size <= 6) break;
      if (id !== p.id && id !== page()?.id && old.proxy) {
        contentPreviews.delete(id);
        await old.proxy.destroy();
      }
    }
    return proxy;
  })();
  contentPreviews.set(p.id, entry);
  try {
    return await entry.promise;
  } catch (error) {
    if (contentPreviews.get(p.id) === entry) contentPreviews.delete(p.id);
    throw error;
  }
}
async function contentPanel() {
  return contentUI.refresh();
}
async function ocrDialog(region, seed = null) {
  if (!state) return;
  const document = state,
    pageIndex = active,
    name = state.name;
  if (analysis && !analysis.isPaused()) {
    const owner = analysis;
    owner.pause();
    $("#modal").addEventListener(
      "close",
      () => {
        if (analysis === owner) owner.resume();
      },
      { once: true },
    );
  }
  await openRebuild(
    {
      pageIndex,
      modal,
      close: closeModal,
      export: () =>
        exportPdf(document, null, {
          flattenForms: !canPreserveDocument(document),
        }),
      pdf: (data) =>
        pdfjs.getDocument({
          data,
          standardFontDataUrl: "./vendor/standard_fonts/",
          cMapUrl: "./vendor/cmaps/",
          cMapPacked: true,
          wasmUrl: "./vendor/wasm/",
          isEvalSupported: false,
        }).promise,
      create: async (data) => {
        if (state !== document)
          throw Error("The document changed. Open reconstruction again.");
        if (!(await saveDraft())) return;
        closeModal();
        await importFiles([
          new File(
            [data],
            name.replace(/\.pdf$/i, "") + t(" - editable copy.pdf"),
            { type: "application/pdf" },
          ),
        ]);
        active = pageIndex;
        setTool("content");
        await render();
      },
    },
    region,
    seed,
  );
}
async function extractedAreas() {
  const src = source(),
    p = page(),
    doc = await loadProxy(src),
    pg = await doc.getPage(p.index + 1),
    view = pg.getViewport({ scale: 1, rotation: p.rotation }),
    content = await pg.getTextContent();
  return regionLines(content, view, { x: 0, y: 0, w: 1, h: 1 }).map((l) => ({
    ...l,
    region: {
      x: l.bbox.x0 / view.width,
      y: l.bbox.y0 / view.height,
      w: (l.bbox.x1 - l.bbox.x0) / view.width,
      h: (l.bbox.y1 - l.bbox.y0) / view.height,
    },
  }));
}
import * as pdfjs from "./vendor/pdf.min.mjs";
import {
  createSample,
  inversePoint,
  transformPoint,
  canPreserveDocument,
} from "./pdf-core.js";
pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  uid = () => crypto.randomUUID(),
  clone = (v) => structuredClone(v);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (n) => `<i data-lucide="${n}"></i>`,
  icons = () => lucide.createIcons();
let state = null,
  active = 0,
  tool = "select",
  selected = null,
  zoom = 1,
  currentPage = null,
  viewport = null,
  renderEpoch = 0,
  undo = [],
  redo = [],
  saveTimer,
  saveChain = Promise.resolve(),
  revision = 0,
  savedRevision = 0,
  importMode = "open",
  toastTimer,
  db;
const proxies = new Map(),
  imageCache = new Map(),
  thumbs = new Map();
const tools = [
  ["select", "mouse-pointer-2", "Select"],
  ["content", "file-pen-line", "Edit PDF"],
  ["ocr", "scan-text", "OCR"],
  ["fill", "list-checks", "Fill"],
  ["text", "type", "Text"],
  ["sign", "signature", "Sign"],
  ["highlight", "highlighter", "Highlight"],
  ["underline", "underline", "Underline"],
  ["note", "sticky-note", "Note"],
  ["draw", "pencil", "Draw"],
  ["image", "image-plus", "Image"],
  ["pages", "layers", "Pages"],
  ["search", "search", "Search"],
];
const defaults = { color: "#173c33", size: 16, text: "" };
function notify(message, error = false) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  $("#toast").style.background = error ? "#8c4439" : "#213f37";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => ($("#toast").hidden = true),
    error ? 6500 : 3500,
  );
}
async function work(label, fn) {
  $("#busy span").textContent = label;
  $("#busy").hidden = false;
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    notify(
      e.message || "Something went wrong. Your original file is unchanged.",
      true,
    );
  } finally {
    $("#busy").hidden = true;
  }
}
function modal(html) {
  $("#modal-content").innerHTML = html;
  $("#modal").showModal();
  icons();
  $$("[data-close]").forEach((b) => (b.onclick = () => $("#modal").close()));
}
function closeModal() {
  $("#modal").close();
}
const openDB = openDraftDB;
const store = (mode, fn) => draftTransaction(db, mode, fn);
async function saveDraft(silent = true) {
  if (!state) return;
  clearTimeout(saveTimer);
  const capture = clone(state),
    v = revision;
  capture.updated = Date.now();
  const id = state.id;
  $("#save-status").textContent = "Saving draft…";
  const job = saveChain
    .catch(() => {})
    .then(() => store("readwrite", (s) => s.put(capture)));
  saveChain = job;
  try {
    await job;
    if (state?.id === id) {
      savedRevision = v;
      $("#save-status").textContent =
        v === revision ? "Draft saved on this device" : "Saving draft…";
    }
    if (!silent) notify("Draft saved on this device.");
    return true;
  } catch (e) {
    if (state?.id === id)
      $("#save-status").textContent = "Draft not saved — export a copy";
    notify(
      "Could not save the draft. Storage may be full; export a PDF copy.",
      true,
    );
    return false;
  }
}
function changed() {
  searchEpoch++;
  searchMatches = [];
  revision++;
  $("#save-status").textContent = "Unsaved changes";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(), 450);
  updateHistory();
}
function snapshot() {
  const pages = clone(state.pages);
  for (const page of pages) delete page.textDraft;
  return {
    pages,
    values: state.sources.map((s) => [s.id, clone(s.values)]),
    name: state.name,
    active,
  };
}
function remember() {
  undo.push(snapshot());
  if (undo.length > 40) undo.shift();
  redo = [];
}
function restore(s) {
  thumbs.clear();
  state.thumb = null;
  state.pages = s.pages;
  state.name = s.name;
  state.sources.forEach(
    (src) =>
      (src.values = clone(s.values.find((v) => v[0] === src.id)?.[1] || {})),
  );
  active = Math.min(s.active, state.pages.length - 1);
  selected = null;
  $("#document-name").value = state.name;
  changed();
  render();
}
function history(back) {
  if (state.pages.some((page) => page.textDraft))
    return notify(
      "Apply or cancel unfinished text before undoing committed changes.",
      true,
    );
  const from = back ? undo : redo,
    to = back ? redo : undo;
  if (!from.length) return;
  to.push(snapshot());
  restore(from.pop());
}
function updateHistory() {
  $("#undo").disabled = !undo.length;
  $("#redo").disabled = !redo.length;
}
function page() {
  return state.pages[active];
}
function source() {
  return state.sources.find((s) => s.id === page().source);
}
function basis() {
  return {
    transform: [...viewport.transform],
    width: viewport.width,
    height: viewport.height,
    rotation: page().rotation,
  };
}
function mark() {
  return page()?.marks.find((m) => m.id === selected);
}
function cachedImage(data) {
  if (!imageCache.has(data)) {
    const im = new Image();
    im.src = data;
    im.onload = () => {
      if (state) drawMarks();
    };
    imageCache.set(data, im);
  }
  return imageCache.get(data);
}
async function loadProxy(src) {
  if (proxies.has(src.id)) return proxies.get(src.id);
  if (proxyLoads.has(src.id)) return proxyLoads.get(src.id);
  const promise = trackedProxy({
    data: src.bytes.slice(),
    cMapUrl: "./vendor/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "./vendor/standard_fonts/",
    wasmUrl: "./vendor/wasm/",
    isEvalSupported: false,
  }).then((proxy) => {
    src.pageCount = proxy.numPages;
    proxies.set(src.id, proxy);
    return proxy;
  });
  proxyLoads.set(src.id, promise);
  try {
    return await promise;
  } finally {
    proxyLoads.delete(src.id);
  }
}
async function makeSource(file) {
  if (file.size > 40 * 1024 * 1024)
    throw Error("Choose a PDF smaller than 40 MB for this preview.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await PDFLib.PDFDocument.load(bytes);
  } catch (e) {
    throw Error(
      /encrypt/i.test(e.message)
        ? "Password-protected PDFs are not supported in this preview."
        : "This file could not be read as a PDF.",
    );
  }
  if (parsed.getPageCount() > 200)
    throw Error("This preview supports up to 200 pages per file.");
  const form = parsed.getForm();
  if (form.hasXFA())
    throw Error("XFA forms are not supported. Please use a standard PDF form.");
  if (form.getFields().some((f) => f instanceof PDFLib.PDFSignature))
    throw Error(
      "Certificate signature fields are not supported in this preview. Please use an unsigned copy.",
    );
  const src = {
    id: uid(),
    name: file.name,
    bytes,
    values: {},
    hasForms: form.getFields().length > 0,
  };
  const pdf = await loadProxy(src);
  const pages = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const p = await pdf.getPage(i + 1);
    pages.push({
      id: uid(),
      source: src.id,
      index: i,
      rotation: p.rotate,
      marks: [],
    });
  }
  return { src, pages };
}
async function importFiles(files, merge = false) {
  const list = [...files];
  if (!list.length) return;
  if (
    list.length > 200 ||
    list.reduce((n, file) => n + file.size, 0) +
      (merge && state
        ? state.sources.reduce((n, source) => n + source.bytes.length, 0)
        : 0) >
      80 * 1024 * 1024
  )
    return notify("Keep this workspace below 80 MB of source PDFs.", true);
  if (!merge && !(await safeToLeave(() => importFiles(files, merge)))) return;
  await work(merge ? "Adding your pages…" : "Opening your PDF…", async () => {
    const incoming = [];
    for (const f of list) incoming.push(await makeSource(f));
    if (
      incoming.reduce((n, a) => n + a.pages.length, 0) +
        (merge && state ? state.pages.length : 0) >
      200
    )
      throw Error("Keep this workspace below 200 pages.");
    if (merge && state) {
      if (
        state.pages.length + incoming.reduce((n, a) => n + a.pages.length, 0) >
        200
      )
        throw Error("Keep this workspace below 200 pages.");
      remember();
      for (const i of incoming) {
        state.sources.push(i.src);
        state.pages.push(...i.pages);
      }
      active = state.pages.length - incoming.at(-1).pages.length;
      selected = null;
      changed();
      await render();
      notify("PDF pages added.");
    } else {
      await releaseResources();
      state = {
        id: uid(),
        name: list[0].name,
        created: Date.now(),
        updated: Date.now(),
        sources: incoming.map((i) => i.src),
        pages: incoming.flatMap((i) => i.pages),
        thumb: null,
      };
      await enterEditor();
      await saveDraft();
    }
  });
}
async function sample(blank = false) {
  const bytes = await createSample(blank);
  await importFiles([
    new File(
      [bytes],
      blank ? t("Untitled.pdf") : t("Client approval · sample.pdf"),
      { type: "application/pdf" },
    ),
  ]);
}
async function enterEditor() {
  backedUpId = null;
  backedUpRevision = -1;
  contentUI.clear();
  active = 0;
  selected = null;
  undo = [];
  redo = [];
  revision = 0;
  savedRevision = -1;
  zoom = 1;
  tool = state.pages.some((page) => page.textDraft)
    ? "content"
    : state.sources.some((source) => source.hasForms)
      ? "fill"
      : "content";
  analysis?.stop();
  analysisUIEpoch = 0;
  const owner = state;
  analysis = createDocumentAnalyzer({
    document: owner,
    pdf: loadProxy,
    language: getLanguage() === "fr" ? "fra" : "eng",
    drawingOps: [pdfjs.OPS.constructPath, pdfjs.OPS.fill, pdfjs.OPS.stroke],
    imageOps: Object.entries(pdfjs.OPS)
      .filter(([name]) => /paint.*Image|paintJpegXObject/.test(name))
      .map(([, value]) => value),
    onUpdate: (progress) => {
      if (state !== owner) return;
      updateAnalysisStatus(progress);
      const count = analysis?.areas(page())?.length || 0;
      if (count !== analysisUIEpoch) {
        analysisUIEpoch = count;
        contentUI.refreshRecognized();
      }
    },
  });
  document.body.classList.add("editing");
  $("#home").hidden = true;
  $("#editor").hidden = false;
  $("#document-name").value = state.name;
  updateHistory();
  buildToolbar();
  await render();
  analysis.start(page());
}
async function home() {
  if (!(await safeToLeave(home))) return;
  await releaseResources();
  state = null;
  $("#editor").hidden = true;
  $("#home").hidden = false;
  document.body.classList.remove("editing");
  await library();
}
async function library() {
  const rows = db ? await store("readonly", (s) => s.getAll()) : [];
  rows.sort((a, b) => b.updated - a.updated);
  $("#doc-count").textContent = rows.length;
  $("#library-count").textContent = rows.length;
  const q = $("#library-search").value.toLowerCase();
  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q));
  $("#library").innerHTML = filtered.length
    ? filtered
        .map(
          (r) =>
            `<article class="doc-card"><button class="doc-open" data-id="${r.id}"><div class="doc-thumb">${r.thumb ? `<img src="${r.thumb}" alt="Document preview">` : icon("file-text")}</div><div class="doc-info"><strong>${esc(r.name)}</strong><small>${r.pageCount} page${r.pageCount !== 1 ? "s" : ""} · ${new Date(r.updated).toLocaleDateString(locale(), { month: "short", day: "numeric" })} · Draft</small></div></button><button class="doc-delete" aria-label="Delete draft ${esc(r.name)}" data-delete="${r.id}">${icon("trash-2")}</button></article>`,
        )
        .join("")
    : `<div class="empty-state">${icon("folder-open")}<strong>${q ? "No matching documents" : "A fresh start for your paperwork"}</strong><p>${q ? "Try another name." : "Open your first PDF, or try the sample above."}</p></div>`;
  icons();
  $$(".doc-open").forEach(
    (b) =>
      (b.onclick = () =>
        work("Restoring your draft…", async () => {
          await releaseResources();
          state = await store("readonly", (s) => s.get(b.dataset.id));
          for (const src of state.sources) await loadProxy(src);
          await enterEditor();
          savedRevision = revision;
          $("#save-status").textContent = "Draft saved on this device";
        })),
  );
  $$("[data-delete]").forEach(
    (b) =>
      (b.onclick = () => {
        modal(
          `<h2>Delete this draft?</h2><p>This removes the browser draft. Files you downloaded remain on your device.</p><div class="dialog-actions"><button class="secondary" data-close>Keep draft</button><button class="primary" id="confirm-delete">Delete draft</button></div>`,
        );
        $("#confirm-delete").onclick = async () => {
          await store("readwrite", (s) => s.delete(b.dataset.delete));
          closeModal();
          await library();
        };
      }),
  );
}
function buildToolbar() {
  $("#toolbar").innerHTML = tools
    .map(
      ([id, ic, label]) =>
        `<button class="tool ${tool === id ? "active" : ""}" data-tool="${id}" aria-pressed="${tool === id}">${icon(ic)}${label}</button>`,
    )
    .join("");
  $$("[data-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  icons();
}
function setTool(t) {
  contentUI.capture();
  const wasCompare = compareView;
  contentUI.clear();
  selected = null;
  tool = t;
  if (t !== "search")
    textContainer
      .querySelectorAll(".search-match")
      .forEach((span) => span.classList.remove("search-match"));
  buildToolbar();
  properties();
  drawMarks();
  if (t === "sign") signatureDialog();
  if (t === "image") $("#image-input").click();
  if (t === "ocr") ocrDialog();
  if (wasCompare) render();
}
function mobilePanel() {
  requestAnimationFrame(() =>
    document.documentElement.style.setProperty(
      "--panel-height",
      `${$("#properties").offsetHeight}px`,
    ),
  );
}
const contentUI = createContentEditor({
  page,
  source,
  viewport: () => viewport,
  tool: () => tool,
  notify,
  resize: mobilePanel,
  render,
  compare: (v) => {
    compareView = v;
  },
  ocr: ocrDialog,
  extracted: extractedAreas,
  resumeAnalysis: () => analysis?.resume(),
  analysis: (p) => analysis.native(p),
  recognized: (p) => analysis?.areas(p) || [],
  buffer: (p, draft, markChanged = true) => {
    if (!state || !state.pages.includes(p)) return;
    if (draft) p.textDraft = clone(draft);
    else delete p.textDraft;
    if (markChanged) changed();
  },
  commit: async (p, next) => {
    let done = false;
    await work("Updating original content…", async () => {
      const src = state.sources.find((s) => s.id === p.source);
      await previewContent(src.bytes, p.index, next);
      if (!state || page() !== p) return;
      remember();
      p.contentEdits = clone(next);
      p.contentRevision = (p.contentRevision || 0) + 1;
      delete p.textDraft;
      thumbs.delete(p.id);
      state.thumb = null;
      changed();
      await render();
      done = true;
    });
    return done;
  },
});
new ResizeObserver(mobilePanel).observe($("#properties"));
function properties() {
  if (!state) return;
  textContainer.hidden = !["select", "search"].includes(tool);
  $("#content-layer").hidden = tool !== "content";
  if (tool === "ocr") {
    $("#properties").innerHTML =
      '<h3>Scan / OCR</h3><p>Recognize a scanned page, review the text, then create an editable copy.</p><button class="primary" id="start-ocr">Recognize this page</button>';
    $("#start-ocr").onclick = ocrDialog;
    mobilePanel();
    return;
  }
  if (tool === "content") {
    contentPanel();
    return;
  }
  const m = mark();
  const titles = {
    select: "Make yourself at home",
    fill: "Fill your document",
    text: "Add a little context",
    sign: "Make your mark",
    highlight: "Highlight what matters",
    draw: "Draw on the page",
    underline: "Underline a passage",
    note: "Leave a note",
    image: "Add an image",
    pages: "Organize your pages",
    search: "Find in this document",
  };
  const hints = {
    select: "Tap an item you added to move, edit, or resize it.",
    fill: "Tap the blue fields on the page. For a flat PDF, use Text or Checkmark.",
    text: "Tap anywhere on the page to add text. Select it to edit or move it.",
    sign: "Draw or type a signature, then move and resize it on the page.",
    highlight: "Drag across an area to highlight it.",
    draw: "Draw with your finger, pen, or mouse.",
    underline: "Drag under a line of text.",
    note: "Tap the page to add a visible text note.",
    image: "Choose a PNG or JPEG. Then drag it into place.",
    pages:
      "Reorder, rotate, or remove the current page. Add another PDF to combine files.",
    search:
      "Search the selectable text in the original document. Scanned images may have no text.",
  };
  $("#page-hint").textContent = m
    ? "Drag to move · use the corner handle to resize"
    : hints[tool];
  let html = `<h3>${m ? "Selected " + (m.signature ? "signature" : m.type) : titles[tool]}</h3><p>${m ? "Changes are saved to your local draft." : hints[tool]}</p>`;
  if (m && (m.type === "text" || m.type === "note"))
    html += `<label for="mark-text">Text</label><textarea id="mark-text">${esc(m.text)}</textarea>`;
  if (
    (m && ["text", "note", "draw", "underline"].includes(m.type)) ||
    ["text", "note", "draw"].includes(tool)
  )
    html += `<label for="size">${tool === "draw" || m?.type === "draw" ? "Stroke" : "Text size"}</label><input id="size" type="number" min="2" max="72" value="${m?.size || defaults.size}">`;
  if (
    (m?.type !== "image" &&
      ["text", "note", "draw", "highlight", "underline"].includes(tool)) ||
    (m && m.type !== "image")
  )
    html += `<label for="color">Color</label><input type="color" id="color" value="${m?.color || (tool === "highlight" ? "#f1c84a" : defaults.color)}">`;
  if (m) {
    html += `<div class="property-actions"><button class="secondary full" id="duplicate-mark">${icon("copy")} Duplicate</button><button class="secondary full" id="delete-mark">${icon("trash-2")} Remove</button></div>`;
  } else if (tool === "fill")
    html += `<div class="property-actions"><button class="secondary full" id="next-field">${icon("arrow-right")} Next field</button><button class="secondary full" id="add-check">${icon("check")} Add checkmark</button><button class="secondary full" id="add-date">${icon("calendar")} Add today’s date</button></div>`;
  else if (tool === "sign")
    html += `<div class="property-actions"><button class="primary full" id="new-signature">${icon("signature")} Create signature</button></div><div class="note">A visible signature, without certificate verification or an identity audit trail.</div>`;
  else if (tool === "image")
    html += `<div class="property-actions"><button class="primary full" id="choose-image">${icon("image-plus")} Choose image</button></div>`;
  else if (tool === "pages")
    html += `<div class="property-actions"><button class="secondary full" id="p-up">${icon("arrow-up")} Move earlier</button><button class="secondary full" id="p-down">${icon("arrow-down")} Move later</button><button class="secondary full" id="p-rotate">${icon("rotate-cw")} Rotate 90°</button><button class="secondary full" id="p-merge">${icon("plus")} Add PDF</button><button class="secondary full" id="p-extract">${icon("file-output")} Extract this page</button><button class="secondary full" id="p-delete">${icon("trash-2")} Delete this page</button></div>`;
  else if (tool === "search")
    html += `<label for="find-text">Search text</label><input type="text" id="find-text" value="${esc(searchQuery)}" placeholder="Search words…"><div class="property-actions"><button class="primary full" id="find-go">Search</button><button class="secondary" id="find-prev" ${searchMatches.length ? "" : "disabled"}>Previous match</button><button class="secondary" id="find-next" ${searchMatches.length ? "" : "disabled"}>Next match</button></div><p id="find-count" aria-live="polite">${searchMatches.length ? `${searchIndex + 1} / ${searchMatches.length}` : ""}</p><div id="find-results"></div>`;
  if (["select", "text", "image"].includes(tool) && !m)
    html += `<div class="note">${icon("info")}You can edit text and images added here. Use Edit PDF to change supported original text and images.</div>`;
  $("#properties").innerHTML = html;
  icons();
  const edit = (id, key, parse = (v) => v) => {
    const el = $(id);
    if (el) {
      let recorded = false;
      el.onfocus = () => (recorded = false);
      el.oninput = () => {
        const value = parse(el.value);
        if (m) {
          if (!recorded) {
            remember();
            recorded = true;
          }
          m[key] = value;
          if (key === "text" || key === "size") measureText(m);
          if (key === "text") validateAddedText(m, value);
          changed();
          drawMarks();
        } else defaults[key] = value;
      };
    }
  };
  edit("#mark-text", "text");
  edit("#color", "color");
  edit("#size", "size", (v) => Math.min(72, Math.max(2, Number(v) || 16)));
  const bind = (id, fn) => {
    if ($(id)) $(id).onclick = fn;
  };
  bind("#delete-mark", () => {
    remember();
    page().marks = page().marks.filter((v) => v.id !== selected);
    selected = null;
    changed();
    drawMarks();
    properties();
  });
  bind("#duplicate-mark", () => {
    remember();
    const n = clone(m);
    n.id = uid();
    n.x += 12;
    n.y += 12;
    if (n.points) n.points = n.points.map(([x, y]) => [x + 12, y + 12]);
    page().marks.push(n);
    selected = n.id;
    changed();
    drawMarks();
    properties();
  });
  bind("#next-field", () => {
    const fields = $$(".pdf-field:not([disabled])");
    if (!fields.length) {
      notify("No editable fields on this page. Use Text or Checkmark.");
      return;
    }
    const i = fields.indexOf(document.activeElement);
    fields[(i + 1) % fields.length].focus();
  });
  bind("#add-check", () =>
    addMark({
      type: "check",
      x: viewport.width * 0.3,
      y: viewport.height * 0.4,
      w: 18,
      h: 18,
    }),
  );
  bind("#add-date", () =>
    addMark({
      type: "text",
      text: new Date().toLocaleDateString(locale()),
      x: viewport.width * 0.25,
      y: viewport.height * 0.45,
      size: 14,
    }),
  );
  bind("#new-signature", signatureDialog);
  bind("#choose-image", () => $("#image-input").click());
  bind("#p-up", () => movePage(-1));
  bind("#p-down", () => movePage(1));
  bind("#p-rotate", rotatePage);
  bind("#p-delete", deletePage);
  bind("#p-merge", () => pick("merge"));
  bind("#p-extract", () => exportDialog(true));
  bind("#find-go", findText);
  bind("#find-prev", () => showMatch(-1));
  bind("#find-next", () => showMatch(1));
  renderSearchResults();
  if ($("#find-text"))
    $("#find-text").onkeydown = (e) => {
      if (e.key === "Enter") findText();
    };
  mobilePanel();
  $("#marks-canvas").classList.toggle(
    "interact",
    ["text", "note", "highlight", "draw", "underline"].includes(tool) || !!m,
  );
}
function measureText(m) {
  if (m.type !== "text" && m.type !== "note") return;
  const ctx = $("#marks-canvas").getContext("2d");
  ctx.font = `${m.size}px Arial`;
  m.w = Math.max(
    20,
    ...m.text.split("\n").map((t) => ctx.measureText(t).width),
  );
  m.h = Math.max(m.size, m.text.split("\n").length * m.size * 1.25);
}
function addMark(data) {
  remember();
  const m = {
    id: uid(),
    basis: basis(),
    color: defaults.color,
    size: defaults.size,
    ...data,
  };
  measureText(m);
  page().marks.push(m);
  selected = m.id;
  tool = "select";
  changed();
  buildToolbar();
  drawMarks();
  properties();
  return m;
}
async function render() {
  if (!state) return;
  contentUI.capture();
  const epoch = ++renderEpoch;
  try {
    selected = null;
    const p = page(),
      src = source();
    analysis?.prioritize(p);
    const pdf = await pageProxy(src, p);
    const pg = await pdf.getPage(p.index + 1);
    if (epoch !== renderEpoch) return;
    currentPage = pg;
    viewport = pg.getViewport({
      scale: 1 / (pg.userUnit || 1),
      rotation: p.rotation,
    });
    const avail = Math.max(
      200,
      $("#stage").clientWidth - (innerWidth < 760 ? 20 : 65),
    );
    const scale = Math.min(1.15, avail / viewport.width) * zoom,
      dpr = Math.min(devicePixelRatio || 1, 2);
    const vp = pg.getViewport({
      scale: (scale * dpr) / (pg.userUnit || 1),
      rotation: p.rotation,
    });
    const tmp = document.createElement("canvas");
    tmp.width = Math.ceil(vp.width);
    tmp.height = Math.ceil(vp.height);
    await pg.render({
      canvasContext: tmp.getContext("2d"),
      viewport: vp,
      annotationMode: compareView
        ? pdfjs.AnnotationMode.ENABLE
        : pdfjs.AnnotationMode.ENABLE_FORMS,
    }).promise;
    if (epoch !== renderEpoch) return;
    const canvas = $("#pdf-canvas");
    canvas.width = tmp.width;
    canvas.height = tmp.height;
    canvas.style.width = `${viewport.width * scale}px`;
    canvas.style.height = `${viewport.height * scale}px`;
    canvas.getContext("2d").drawImage(tmp, 0, 0);
    $("#page-wrap").style.width = canvas.style.width;
    $("#page-wrap").style.height = canvas.style.height;
    $("#marks-canvas").width = tmp.width;
    $("#marks-canvas").height = tmp.height;
    $("#page-count").textContent = state.pages.length;
    $("#page-position").textContent = `${active + 1} / ${state.pages.length}`;
    $("#zoom-fit").textContent =
      zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;
    $("#prev-page").disabled = active === 0;
    $("#next-page").disabled = active === state.pages.length - 1;
    if (compareView) $("#fields").replaceChildren();
    else await renderFields(pg, epoch);
    if (epoch !== renderEpoch) return;
    await renderText(pg, scale, epoch);
    if (epoch !== renderEpoch) return;
    drawMarks();
    properties();
    renderPageList(epoch).catch((error) => {
      if (epoch === renderEpoch) notify(error.message, true);
    });
    if (!state.thumb) {
      const t = document.createElement("canvas");
      t.width = 180;
      t.height = (180 * tmp.height) / tmp.width;
      t.getContext("2d").drawImage(tmp, 0, 0, t.width, t.height);
      state.thumb = t.toDataURL("image/png");
    }
  } catch (error) {
    if (epoch === renderEpoch) throw error;
  }
}
async function renderFields(pg, epoch) {
  const annotations = await pg.getAnnotations();
  if (epoch !== renderEpoch) return;
  $("#fields").innerHTML = "";
  for (const a of annotations) {
    if (
      a.subtype !== "Widget" ||
      !a.fieldName ||
      a.fieldType === "Sig" ||
      a.pushButton
    )
      continue;
    const rect = viewport.convertToViewportRectangle(a.rect);
    const left = Math.min(rect[0], rect[2]),
      top = Math.min(rect[1], rect[3]),
      w = Math.abs(rect[2] - rect[0]),
      h = Math.abs(rect[3] - rect[1]);
    let el;
    const values = source().values;
    const value = Object.hasOwn(values, a.fieldName)
      ? values[a.fieldName]
      : a.fieldValue;
    if (a.fieldType === "Tx") {
      el = document.createElement(a.multiLine ? "textarea" : "input");
      el.value = value || "";
      if (a.maxLen) el.maxLength = a.maxLen;
      if (a.password) el.type = "password";
    } else if (a.fieldType === "Btn") {
      el = document.createElement("input");
      el.type = a.radioButton ? "radio" : "checkbox";
      el.name = a.fieldName;
      if (a.radioButton) el.checked = value === a.buttonValue;
      else
        el.checked =
          typeof value === "boolean" ? value : !!value && value !== "Off";
    } else if (a.fieldType === "Ch") {
      el = document.createElement("select");
      el.multiple = !!a.multiSelect;
      for (const o of a.options || []) {
        const opt = document.createElement("option");
        opt.value = o.exportValue;
        opt.textContent = o.displayValue;
        opt.selected = Array.isArray(value)
          ? value.includes(o.exportValue)
          : value === o.exportValue;
        el.append(opt);
      }
    } else continue;
    const angle = (page().rotation + (a.rotation || 0)) % 360,
      swap = angle === 90 || angle === 270,
      fw = swap ? h : w,
      fh = swap ? w : h;
    el.dataset.fieldName = a.fieldName;
    el.className = "pdf-field";
    el.setAttribute("aria-label", a.alternativeText || a.fieldName);
    el.style.cssText = `left:${((left + w / 2) / viewport.width) * 100}%;top:${((top + h / 2) / viewport.height) * 100}%;width:${(fw / viewport.width) * 100}%;height:${(fh / viewport.height) * 100}%;transform:translate(-50%,-50%) rotate(${angle}deg);font-size:${Math.max(6, (fh * 0.48 * $("#page-wrap").clientWidth) / viewport.width)}px`;
    let recorded = false;
    el.onfocus = () => (recorded = false);
    el.disabled = !!a.readOnly;
    el.oninput = () => {
      if (!recorded) {
        remember();
        recorded = true;
      }
      source().values[a.fieldName] =
        a.fieldType === "Btn"
          ? a.radioButton
            ? a.buttonValue
            : el.checked
          : el.multiple
            ? [...el.selectedOptions].map((o) => o.value)
            : el.value;
      changed();
    };
    $("#fields").append(el);
  }
}
async function renderPageList(epoch) {
  const id = state.id;
  $("#page-list").innerHTML = state.pages
    .map(
      (p, i) =>
        `<button class="page-button ${i === active ? "active" : ""}" data-page="${i}" aria-label="Go to page ${i + 1}"><span class="thumb">${thumbs.has(p.id) ? `<img src="${thumbs.get(p.id)}" alt="">` : icon("file-text")}</span><span>Page ${i + 1}</span></button>`,
    )
    .join("");
  icons();
  $$("[data-page]").forEach(
    (b) => (b.onclick = () => goPage(Number(b.dataset.page))),
  );
  for (const [i, p] of state.pages.entries()) {
    if (epoch !== renderEpoch || state?.id !== id) return;
    if (thumbs.has(p.id) || Math.abs(i - active) > 8) continue;
    const src = state.sources.find((s) => s.id === p.source),
      proxy = await pageProxy(src, p),
      pg = await proxy.getPage(p.index + 1),
      vp = pg.getViewport({ scale: 0.17, rotation: p.rotation }),
      c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    try {
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp })
        .promise;
    } catch {
      continue;
    }
    if (epoch !== renderEpoch) return;
    const data = c.toDataURL();
    thumbs.set(p.id, data);
    const el = $(`[data-page="${i}"] .thumb`);
    if (el) el.innerHTML = `<img src="${data}" alt="">`;
  }
}
function markMatrix(m) {
  const t = m.basis.transform;
  const p0 = inversePoint(t, 0, 0),
    px = inversePoint(t, 1, 0),
    py = inversePoint(t, 0, 1);
  const a = transformPoint(viewport.transform, ...p0),
    b = transformPoint(viewport.transform, ...px),
    c = transformPoint(viewport.transform, ...py);
  return [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1], a[0], a[1]];
}
function drawMarks() {
  renderAnnotationHits();
  if (!state || !viewport) return;
  const c = $("#marks-canvas"),
    ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  if (compareView) return;
  ctx.save();
  ctx.scale(c.width / viewport.width, c.height / viewport.height);
  for (const m of page().marks) {
    ctx.save();
    ctx.transform(...markMatrix(m));
    ctx.fillStyle = m.color;
    ctx.strokeStyle = m.color;
    ctx.lineWidth = m.size || 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (m.type === "text" || m.type === "note") {
      ctx.font = `${m.size}px Arial`;
      ctx.textBaseline = "alphabetic";
      m.text
        .split("\n")
        .forEach((s, i) =>
          ctx.fillText(s, m.x, m.y + m.size * 0.83 + i * m.size * 1.25),
        );
    }
    if (m.type === "image") {
      const im = cachedImage(m.data);
      if (im.complete && im.naturalWidth) ctx.drawImage(im, m.x, m.y, m.w, m.h);
    }
    if (m.type === "highlight") {
      ctx.globalAlpha = 0.3;
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.globalAlpha = 1;
    }
    if (m.type === "draw" || m.type === "underline") {
      ctx.beginPath();
      m.points.forEach(([x, y], i) =>
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
      );
      ctx.stroke();
    }
    if (m.type === "check") {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y + m.h * 0.5);
      ctx.lineTo(m.x + m.w * 0.36, m.y + m.h);
      ctx.lineTo(m.x + m.w, m.y);
      ctx.stroke();
    }
    if (m.id === selected) {
      ctx.strokeStyle = "#2c9582";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(m.x - 4, m.y - 4, m.w + 8, m.h + 8);
      ctx.setLineDash([]);
      ctx.fillStyle = "white";
      ctx.fillRect(m.x + m.w - 4, m.y + m.h - 4, 8, 8);
      ctx.strokeRect(m.x + m.w - 4, m.y + m.h - 4, 8, 8);
    }
    ctx.restore();
  }
  ctx.restore();
}
function canvasPoint(e) {
  const r = $("#marks-canvas").getBoundingClientRect();
  return [
    ((e.clientX - r.left) * viewport.width) / r.width,
    ((e.clientY - r.top) * viewport.height) / r.height,
  ];
}
function toMark(m, p) {
  return inversePoint(markMatrix(m), ...p);
}
let gesture = null;
$("#marks-canvas").onpointerdown = (e) => {
  if (!state || !viewport) return;
  const [x, y] = canvasPoint(e),
    c = e.currentTarget;
  if (tool === "text" || tool === "note") {
    addMark({
      type: tool,
      x,
      y,
      text: tool === "note" ? t("Note: Your comment") : t("Your text"),
      size: defaults.size,
    });
    $("#mark-text")?.focus();
    $("#mark-text")?.select();
    return;
  }
  if (["draw", "highlight", "underline"].includes(tool)) {
    remember();
    const m = {
      id: uid(),
      type: tool,
      basis: basis(),
      x,
      y,
      w: 1,
      h: 1,
      points: [[x, y]],
      size: tool === "draw" ? Math.min(defaults.size, 6) : 1,
      color:
        tool === "highlight" ? $("#color")?.value || "#f1c84a" : defaults.color,
    };
    page().marks.push(m);
    gesture = { kind: "new", m, start: [x, y] };
    c.setPointerCapture(e.pointerId);
    return;
  }
  const hit = [...page().marks].reverse().find((m) => {
    const [a, b] = toMark(m, [x, y]);
    return (
      a >= m.x - 8 && a <= m.x + m.w + 8 && b >= m.y - 8 && b <= m.y + m.h + 8
    );
  });
  if (hit) {
    selected = hit.id;
    const q = toMark(hit, [x, y]);
    gesture = {
      kind:
        Math.abs(q[0] - hit.x - hit.w) < 12 &&
        Math.abs(q[1] - hit.y - hit.h) < 12
          ? "resize"
          : "move",
      m: hit,
      start: q,
      original: clone(hit),
      before: snapshot(),
      moved: false,
    };
    c.setPointerCapture(e.pointerId);
    c.classList.add("interact");
  } else selected = null;
  drawMarks();
  properties();
};
$("#marks-canvas").onpointermove = (e) => {
  if (!gesture) return;
  const g = gesture,
    pt = canvasPoint(e),
    [x, y] = toMark(g.m, pt),
    m = g.m;
  if (g.kind === "new") {
    if (m.type === "draw") {
      m.points.push([x, y]);
      const xs = m.points.map((p) => p[0]),
        ys = m.points.map((p) => p[1]);
      m.x = Math.min(...xs);
      m.y = Math.min(...ys);
      m.w = Math.max(1, Math.max(...xs) - m.x);
      m.h = Math.max(1, Math.max(...ys) - m.y);
    } else if (m.type === "underline") {
      m.points = [g.start, [x, g.start[1]]];
      m.x = Math.min(x, g.start[0]);
      m.y = g.start[1];
      m.w = Math.abs(x - g.start[0]);
      m.h = 2;
    } else {
      m.x = Math.min(x, g.start[0]);
      m.y = Math.min(y, g.start[1]);
      m.w = Math.abs(x - g.start[0]);
      m.h = Math.abs(y - g.start[1]);
    }
  } else {
    g.moved = true;
    const dx = x - g.start[0],
      dy = y - g.start[1],
      o = g.original;
    if (g.kind === "move") {
      m.x = o.x + dx;
      m.y = o.y + dy;
      if (m.points) m.points = o.points.map(([a, b]) => [a + dx, b + dy]);
    } else {
      const k = Math.max(0.12, Math.min(8, (o.w + dx) / Math.max(o.w, 1)));
      m.w = o.w * k;
      m.h = o.h * k;
      if (m.type === "text" || m.type === "note") {
        m.size = Math.max(2, o.size * k);
        measureText(m);
      }
      if (m.points)
        m.points = o.points.map(([a, b]) => [
          o.x + (a - o.x) * k,
          o.y + (b - o.y) * k,
        ]);
    }
  }
  drawMarks();
};
function finishGesture(cancel = false) {
  if (!gesture) return;
  const g = gesture;
  gesture = null;
  if (cancel) {
    if (g.kind === "new") {
      page().marks = page().marks.filter((m) => m.id !== g.m.id);
      undo.pop();
    } else Object.assign(g.m, g.original);
  } else {
    if (g.kind !== "new" && g.moved) {
      undo.push(g.before);
      redo = [];
    }
    if (g.kind === "new" || g.moved) {
      selected = g.m.id;
      changed();
    }
  }
  drawMarks();
  properties();
}
$("#marks-canvas").onpointerup = () => finishGesture();
$("#marks-canvas").onpointercancel = () => finishGesture(true);
function goPage(i) {
  contentUI.capture();
  if (i < 0 || i >= state.pages.length) return;
  active = i;
  selected = null;
  render().catch((e) => notify(e.message, true));
}
function movePage(d) {
  const n = active + d;
  if (n < 0 || n >= state.pages.length) return;
  remember();
  [state.pages[active], state.pages[n]] = [state.pages[n], state.pages[active]];
  active = n;
  changed();
  render();
}
function rotatePage() {
  remember();
  page().rotation = (page().rotation + 90) % 360;
  thumbs.delete(page().id);
  changed();
  render();
}
function deletePage() {
  if (state.pages.length === 1) {
    notify("Keep at least one page in the document.");
    return;
  }
  modal(
    `<h2>Delete page ${active + 1}?</h2><p>You can undo this while the document is open.</p><div class="dialog-actions"><button class="secondary" data-close>Keep page</button><button class="primary" id="remove-page">Delete page</button></div>`,
  );
  $("#remove-page").onclick = () => {
    remember();
    state.pages.splice(active, 1);
    active = Math.min(active, state.pages.length - 1);
    changed();
    closeModal();
    render();
  };
}
function pick(mode = "open") {
  importMode = mode;
  $("#file-input").value = "";
  $("#file-input").click();
}
$("#file-input").onchange = (e) =>
  importFiles(e.target.files, importMode === "merge");
$("#image-input").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) {
    notify("Choose an image smaller than 8 MB.", true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const im = new Image();
    im.onload = () => {
      const w = Math.min(220, viewport.width * 0.5),
        h = (w * im.height) / im.width;
      addMark({
        type: "image",
        x: (viewport.width - w) / 2,
        y: Math.max(20, (viewport.height - h) / 3),
        w,
        h,
        data: reader.result,
      });
    };
    im.onerror = () => notify("Choose a valid PNG or JPEG image.", true);
    im.src = reader.result;
  };
  reader.readAsDataURL(f);
  e.target.value = "";
};
async function signatureDialog() {
  modal(
    `<h2>Your signature, your way.</h2><p>Create a visible signature to place on this document.</p><div class="signature-tabs"><button class="active" id="sig-draw">Draw</button><button id="sig-type">Type</button></div><div id="sig-draw-area"><canvas id="signature-pad" width="900" height="360"></canvas><button class="text-button" id="sig-clear">Clear signature</button></div><div id="sig-type-area" hidden><input class="modal-input sig-type" id="signature-name" placeholder="Your name" aria-label="Type your signature" maxlength="80"></div><div class="dialog-actions"><button class="secondary" data-close>Cancel</button><button class="primary" id="sig-use">Place signature</button></div>`,
  );
  const c = $("#signature-pad"),
    ctx = c.getContext("2d");
  ctx.strokeStyle = "#173c33";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let mode = "draw",
    drawing = false,
    hasInk = false;
  const p = (e) => {
    const r = c.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * c.width) / r.width,
      ((e.clientY - r.top) * c.height) / r.height,
    ];
  };
  c.onpointerdown = (e) => {
    drawing = true;
    hasInk = true;
    c.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...p(e));
  };
  c.onpointermove = (e) => {
    if (drawing) {
      ctx.lineTo(...p(e));
      ctx.stroke();
    }
  };
  c.onpointerup = c.onpointercancel = () => (drawing = false);
  $("#sig-clear").onclick = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    hasInk = false;
  };
  const tab = (t) => {
    mode = t;
    $("#sig-draw-area").hidden = t !== "draw";
    $("#sig-type-area").hidden = t !== "type";
    $("#sig-draw").classList.toggle("active", t === "draw");
    $("#sig-type").classList.toggle("active", t === "type");
    if (t === "type") $("#signature-name").focus();
  };
  $("#sig-draw").onclick = () => tab("draw");
  $("#sig-type").onclick = () => tab("type");
  $("#sig-use").onclick = () => {
    let data;
    if (mode === "type") {
      const text = $("#signature-name").value.trim();
      if (!text) {
        notify("Enter your name first.");
        return;
      }
      const t = document.createElement("canvas");
      t.width = 900;
      t.height = 220;
      const cx = t.getContext("2d");
      cx.font = "italic 85px Georgia";
      const size = Math.min(85, (840 / cx.measureText(text).width) * 85);
      cx.font = `italic ${size}px Georgia`;
      cx.fillStyle = "#173c33";
      cx.textAlign = "center";
      cx.fillText(text, 450, 140);
      data = t.toDataURL();
    } else {
      if (!hasInk) {
        notify("Draw your signature first.");
        return;
      }
      data = c.toDataURL();
    }
    const w = Math.min(230, viewport.width * 0.5),
      h = w * (mode === "draw" ? 0.4 : 220 / 900);
    addMark({
      type: "image",
      signature: true,
      x: (viewport.width - w) / 2,
      y: viewport.height * 0.6,
      w,
      h,
      data,
    });
    closeModal();
  };
}
let searchQuery = "",
  searchMatches = [],
  searchIndex = 0,
  searchEpoch = 0,
  textLayer;
const textContainer = document.createElement("div");
textContainer.className = "textLayer";
textContainer.dataset.noI18n = "";
$("#pdf-canvas").after(textContainer);
const annotationHits = document.createElement("div");
annotationHits.className = "annotation-hits";
$("#page-wrap").append(annotationHits);
async function renderText(pg, scale, epoch) {
  textLayer?.cancel();
  const view = pg.getViewport({
    scale: scale / (pg.userUnit || 1),
    rotation: page().rotation,
  });
  try {
    textLayer = await renderPageText(
      pdfjs,
      pg,
      view,
      textContainer,
      searchMatches.filter((match) => match.page === active),
    );
  } catch (e) {
    if (e.name !== "AbortException") throw e;
  }
  if (epoch !== renderEpoch) textLayer?.cancel();
}
function renderSearchResults() {
  const result = $("#find-results");
  if (!result) return;
  result.innerHTML = searchMatches
    .map(
      (match, index) =>
        `<button class="search-result" data-match="${index}"><b>Page ${match.page + 1}</b><span class="search-excerpt">${esc(match.excerpt)}</span></button>`,
    )
    .join("");
  $$("[data-match]").forEach(
    (button) =>
      (button.onclick = () => {
        searchIndex = Number(button.dataset.match);
        showMatch(0);
      }),
  );
}
async function showMatch(delta) {
  if (!searchMatches.length) return;
  searchIndex =
    (searchIndex + delta + searchMatches.length) % searchMatches.length;
  active = searchMatches[searchIndex].page;
  await render();
  textContainer
    .querySelector(".search-match")
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
async function findText() {
  searchQuery = $("#find-text").value.trim();
  searchMatches = [];
  searchIndex = 0;
  const epoch = ++searchEpoch,
    document = state;
  if (!searchQuery) {
    properties();
    await render();
    return;
  }
  $("#find-results").textContent = "Searching…";
  for (const [i, p] of document.pages.entries()) {
    const pdf = await pageProxy(
        document.sources.find((source) => source.id === p.source),
        p,
      ),
      pg = await pdf.getPage(p.index + 1),
      content = await pg.getTextContent();
    if (epoch !== searchEpoch || state !== document) return;
    searchMatches.push(
      ...findPageMatches(content, searchQuery).map((match) => ({
        ...match,
        page: i,
      })),
    );
  }
  if (searchMatches.length) await showMatch(0);
  else {
    properties();
    $("#find-results").textContent =
      "No matches. Scanned pages may not contain searchable text.";
  }
}
async function releaseResources() {
  analysis?.stop();
  analysis = null;
  analysisStatus.hidden = true;
  documentEpoch++;
  await Promise.allSettled([...loadingTasks].map((task) => task.destroy()));
  proxyLoads.clear();
  renderEpoch++;
  searchEpoch++;
  searchQuery = "";
  searchMatches = [];
  textLayer?.cancel();
  textContainer.replaceChildren();
  contentUI.dispose();
  cancelEngine();
  const documents = new Set([
    ...proxies.values(),
    ...Array.from(contentPreviews.values(), (entry) => entry.proxy).filter(
      Boolean,
    ),
  ]);
  proxies.clear();
  contentPreviews.clear();
  imageCache.clear();
  thumbs.clear();
  undo = [];
  redo = [];
  currentPage = null;
  viewport = null;
  await Promise.allSettled(
    [...documents].map((document) => document.destroy()),
  );
}
let backedUpId = null,
  backedUpRevision = -1;
async function safeToLeave(retry) {
  if (!state) return true;
  if (backedUpId === state.id && backedUpRevision === revision) return true;
  const document = state;
  do {
    if (!(await saveDraft())) {
      recoveryDialog(retry);
      return false;
    }
  } while (state === document && savedRevision !== revision);
  return state === document;
}
function backupProject() {
  try {
    download(
      encodeProject(state),
      state.name.replace(/\.pdf$/i, "") + ".bluekey.json",
      "application/json",
    );
    backedUpId = state.id;
    backedUpRevision = revision;
    return true;
  } catch (error) {
    notify(error.message, true);
    return false;
  }
}
function recoveryDialog(retry) {
  modal(
    `<h2>Keep your changes safe</h2><p>Your draft could not be saved. The document is still open.</p><div class="dialog-actions"><button class="secondary" data-close>Keep editing</button><button class="secondary" id="retry-save">Retry saving</button><button class="secondary" id="recover-pdf">Export PDF</button><button class="primary" id="recover-project">Download project and continue</button></div>`,
  );
  $("#retry-save").onclick = async () => {
    closeModal();
    await retry();
  };
  $("#recover-pdf").onclick = () => {
    closeModal();
    exportDialog();
  };
  $("#recover-project").onclick = async () => {
    if (!backupProject()) return;
    closeModal();
    await retry();
  };
}
async function openProject(file) {
  if (!file) return;
  if (file.size > 120 * 1024 * 1024)
    return notify("Choose a project smaller than 120 MB.", true);
  if (!(await safeToLeave(() => openProject(file)))) return;
  await work("Opening project…", async () => {
    const incoming = decodeProject(await file.text()),
      mapping = new Map();
    for (const source of incoming.sources) {
      const checked = await makeSource(
        new File([source.bytes], source.name, { type: "application/pdf" }),
      );
      mapping.set(source.id, {
        id: checked.src.id,
        count: checked.pages.length,
      });
      source.hasForms = checked.src.hasForms;
      source.id = checked.src.id;
      source.pageCount = checked.pages.length;
    }
    for (const page of incoming.pages) {
      const source = mapping.get(page.source);
      if (page.index >= source.count)
        throw Error("Invalid project page reference.");
      page.id = uid();
      page.source = source.id;
      for (const mark of page.marks) mark.id = uid();
    }
    await releaseResources();
    state = {
      ...incoming,
      id: uid(),
      created: Date.now(),
      updated: Date.now(),
      thumb: null,
    };
    await enterEditor();
    await saveDraft();
  });
}
function download(bytes, name, type = "application/pdf") {
  const u = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}
async function exportDialog(extract = false) {
  const pending = state.pages.find((page) => page.textDraft);
  if (pending) {
    await saveDraft();
    active = state.pages.indexOf(pending);
    setTool("content");
    await render();
    notify(
      "Apply or cancel the recovered text before exporting. Your unfinished typing is saved in the draft.",
      true,
    );
    return;
  }
  const draftSaved = await saveDraft();
  modal(
    `<h2>${extract ? "Extract this page" : "Ready to go."}</h2><p>Export a PDF copy. Choose whether form fields remain interactive. Your editable draft stays here.</p><label><input type="checkbox" id="flatten-forms" checked> Flatten form fields</label><p id="export-preservation">${canPreserveDocument(state, extract ? active : null) ? "The original document structure is preserved when all source pages remain." : "Merged, reordered or extracted copies may lose bookmarks, attachments and accessibility structure."}</p><label class="modal-label" for="export-name">File name</label><input class="modal-input" id="export-name" value="${esc(state.name.replace(/\.pdf$/i, "") + (extract ? ` - page ${active + 1}` : t(" - completed")) + ".pdf")}"><div class="dialog-actions"><button class="secondary" data-close>Cancel</button><button class="secondary" id="share-pdf">${icon("share-2")} Share</button><button class="primary" id="download-pdf">${icon("download")} Download PDF</button></div><p id="export-result" aria-live="polite"></p>`,
  );
  if (!canPreserveDocument(state, extract ? active : null))
    $("#flatten-forms").disabled = true;
  let prepared = null,
    verification = "";
  $("#flatten-forms").onchange = () => {
    prepared = null;
  };
  const generate = async () => {
    if (!prepared) {
      const options = { flattenForms: $("#flatten-forms").checked };
      const output = await exportPdf(state, extract ? active : null, options);
      $("#export-result").textContent = "Checking exported text…";
      const check = await verifyExport(
        state,
        output,
        extract ? active : null,
        options,
      );
      prepared = output;
      verification = check.message;
      $("#export-result").textContent = check.message;
    }
    const name = ($("#export-name").value.trim() || "document.pdf").replace(
      /[\\/:*?"<>|]/g,
      "-",
    );
    return {
      bytes: prepared,
      name: /\.pdf$/i.test(name) ? name : name + ".pdf",
    };
  };
  $("#download-pdf").onclick = () =>
    work("Preparing your PDF…", async () => {
      const { bytes, name } = await generate();
      download(bytes, name);
      $("#export-result").textContent =
        "Download started. " +
        verification +
        " " +
        (draftSaved
          ? "Your draft is saved here."
          : "Draft not saved. Keep the app open or download a project backup.");
      notify("PDF ready. Check your downloads.");
    });
  $("#share-pdf").onclick = async () => {
    try {
      if (!prepared) {
        $("#export-result").textContent =
          "Preparing file. Tap Share again when ready.";
        await generate();
        $("#export-result").textContent = "Ready. Tap Share to choose an app.";
        return;
      }
      const { bytes, name } = await generate();
      const file = new File([bytes], name, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
      } else {
        $("#export-result").textContent =
          "File sharing is unavailable in this browser. Download the PDF and attach it in your preferred app.";
      }
    } catch (e) {
      if (e.name !== "AbortError") notify(e.message, true);
    }
  };
}
$("#document-name").onchange = (e) => {
  if (!e.target.value.trim()) {
    e.target.value = state.name;
    return;
  }
  remember();
  state.name = e.target.value.trim();
  changed();
};
$("#back").onclick = home;
$("#nav-home").onclick = home;
$(".brand").onclick = (e) => {
  e.preventDefault();
  home();
};
$("#nav-import").onclick = () => pick();
$("#open-pdf").onclick = (e) => {
  e.stopPropagation();
  pick();
};
$("#dropzone").onclick = () => pick();
$("#dropzone").onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pick();
  }
};
$("#nav-demo").onclick = $("#sample-card").onclick = () => sample();
$("#blank-card").onclick = () => sample(true);
$("#library-search").oninput = library;
$("#dropzone").ondragover = (e) => {
  e.preventDefault();
  $("#dropzone").classList.add("dragover");
};
$("#dropzone").ondragleave = () => $("#dropzone").classList.remove("dragover");
$("#dropzone").ondrop = (e) => {
  e.preventDefault();
  $("#dropzone").classList.remove("dragover");
  importFiles(e.dataTransfer.files);
};
$("#undo").onclick = () => history(true);
$("#redo").onclick = () => history(false);
$("#save-draft").onclick = () => saveDraft(false);
$("#export").onclick = () => exportDialog();
$("#merge").onclick = () => pick("merge");
$("#move-up").onclick = () => movePage(-1);
$("#move-down").onclick = () => movePage(1);
$("#rotate").onclick = rotatePage;
$("#delete-page").onclick = deletePage;
$("#prev-page").onclick = () => goPage(active - 1);
$("#next-page").onclick = () => goPage(active + 1);
$("#zoom-in").onclick = () => {
  zoom = Math.min(3, zoom + 0.25);
  render();
};
$("#zoom-out").onclick = () => {
  zoom = Math.max(0.5, zoom - 0.25);
  render();
};
$("#zoom-fit").onclick = () => {
  zoom = 1;
  render();
};
$("#about").onclick = () =>
  modal(
    `<h2>BlueKey PDF Editor</h2><p>A local mobile-friendly prototype for reading, filling, signing, and sharing PDFs.</p><ul class="limit-list"><li>Files stay in this browser. Clearing browser data removes drafts.</li><li>Added text and images are editable. Edit PDF rewrites supported simple text and page-level images. Embedded fonts with usable mappings and nested Form objects are supported. Some encodings and clipped objects remain read-only.</li><li>Complete single-document exports retain the original structure. Page rearrangement, merge and extraction may lose advanced structures.</li><li>Password-protected files, XFA forms, and certificate signatures are not supported. OCR supports French, English and Spanish locally.</li><li>Added text and form values support Latin, Greek and Cyrillic. Missing glyphs and complex scripts require additional support.</li></ul><p>Built with PDF.js (Apache-2.0), pdf-lib (MIT), and Lucide (ISC). No PdfCraft code or branding is bundled.</p><div class="dialog-actions"><button class="primary" data-close>Got it</button></div>`,
  );
document.addEventListener("keydown", (e) => {
  if (!state || $("#modal").open) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveDraft(false);
    return;
  }
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    history(!e.shiftKey);
  }
  if (e.key === "Escape") {
    finishGesture(true);
    selected = null;
    drawMarks();
    properties();
  }
  if ((e.key === "Delete" || e.key === "Backspace") && selected) {
    e.preventDefault();
    $("#delete-mark")?.click();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (state && revision !== savedRevision) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state) saveDraft();
});
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state) render();
  }, 180);
});
try {
  db = await openDB();
} catch (e) {
  notify(
    "Draft storage is unavailable. You can still open and export PDFs.",
    true,
  );
}
await library();
icons();

// Expose only a small read-only diagnostic surface for local integration tests.
window.pdfApp = {
  getState: () => clone(state),
  exportBytes: () => exportPdf(state),
};

async function openExample(name) {
  await work("Opening example…", async () => {
    const response = await fetch("./examples/" + name);
    if (!response.ok) throw Error("Example could not load.");
    await importFiles([
      new File([await response.arrayBuffer()], name, {
        type: "application/pdf",
      }),
    ]);
    setTool("content");
  });
}
$("#editing-demo").onclick = () => openExample("editing-playground.pdf");
$("#scan-demo").onclick = () => openExample("scanned-page.pdf");

$("#text-demo").onclick = () => openExample("text-editing-lab.pdf");

// Refresh locale-formatted library dates without touching an open editor or its buffer.
document.addEventListener("languagechange", () => {
  if (!state) library();
});

let textValidationEpoch = 0;
async function validateAddedText(mark, value) {
  const epoch = ++textValidationEpoch;
  try {
    assertFontCoverage(await fontRecord("regular"), value);
  } catch (error) {
    if (epoch === textValidationEpoch && mark.text === value)
      notify(error.message, true);
  }
}
const backupButton = document.createElement("button");
backupButton.id = "backup-project";
backupButton.className = "secondary";
backupButton.textContent = "Backup project";
backupButton.onclick = backupProject;
$("#save-draft").after(backupButton);
const projectInput = document.createElement("input");
projectInput.type = "file";
projectInput.accept = ".bluekey.json,application/json";
projectInput.hidden = true;
projectInput.id = "project-input";
projectInput.onchange = () => openProject(projectInput.files[0]);
document.body.append(projectInput);
const projectButton = document.createElement("button");
projectButton.className = "secondary";
projectButton.id = "open-project";
projectButton.textContent = "Open project backup";
projectButton.onclick = () => {
  projectInput.value = "";
  projectInput.click();
};
$(".demo-links").append(projectButton);
let serviceRegistration;
async function offlineLanguages() {
  if (!("serviceWorker" in navigator))
    return notify(
      "Offline setup is unavailable. You can continue online.",
      true,
    );
  modal(
    `<h2>Offline OCR languages</h2><p>Download recognition assets while online. Document editing works offline without OCR.</p><label><input type="checkbox" name="offline-language" value="eng" checked> English</label><label><input type="checkbox" name="offline-language" value="fra"> French</label><label><input type="checkbox" name="offline-language" value="spa"> Spanish</label><p id="offline-status" aria-live="polite"></p><div class="dialog-actions"><button class="secondary" data-close>Close</button><button class="primary" id="cache-languages">Download languages</button></div>`,
  );
  $("#cache-languages").onclick = async () => {
    const button = $("#cache-languages"),
      status = $("#offline-status");
    button.disabled = true;
    status.textContent = "Downloading…";
    try {
      const registration = await navigator.serviceWorker.ready,
        channel = new MessageChannel();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Download timed out. Try again while online.")),
          120000,
        );
        channel.port1.onmessage = ({ data }) => {
          clearTimeout(timer);
          data.ok ? resolve() : reject(Error(data.error));
        };
        registration.active.postMessage(
          {
            type: "CACHE_LANGUAGES",
            languages: $$('[name="offline-language"]:checked').map(
              (input) => input.value,
            ),
          },
          [channel.port2],
        );
      });
      status.textContent = "Selected languages are ready offline.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
const offlineButton = document.createElement("button");
offlineButton.className = "secondary";
offlineButton.id = "offline-languages";
offlineButton.textContent = "Offline OCR languages";
offlineButton.onclick = offlineLanguages;
$(".demo-links").append(offlineButton);
async function showUpdate(registration) {
  if (
    !navigator.serviceWorker.controller ||
    !registration.active ||
    !registration.waiting ||
    $("#app-update")
  )
    return;
  const button = document.createElement("button");
  button.id = "app-update";
  button.className = "update-banner";
  button.textContent = "Update ready — save and reload";
  button.onclick = async () => {
    if (!(await safeToLeave(() => button.click()))) return;
    button.disabled = true;
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => {
      if (data.error) {
        button.disabled = false;
        notify(data.error, true);
      }
    };
    registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" }, [
      channel.port2,
    ]);
  };
  document.body.append(button);
}
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then((registration) => {
      serviceRegistration = registration;
      showUpdate(registration);
      registration.addEventListener("updatefound", () =>
        registration.installing?.addEventListener("statechange", () =>
          showUpdate(registration),
        ),
      );
    })
    .catch(() =>
      notify("Offline setup is unavailable. You can continue online.", true),
    );

function renderAnnotationHits() {
  annotationHits.replaceChildren();
  if (!state || !viewport || tool !== "select" || selected) return;
  for (const mark of page().marks) {
    const matrix = markMatrix(mark),
      corners = [
        [mark.x, mark.y],
        [mark.x + mark.w, mark.y],
        [mark.x, mark.y + mark.h],
        [mark.x + mark.w, mark.y + mark.h],
      ].map((p) => transformPoint(matrix, ...p));
    const xs = corners.map((p) => p[0]),
      ys = corners.map((p) => p[1]),
      button = document.createElement("button");
    button.setAttribute(
      "aria-label",
      "Select annotation: " + (mark.text || mark.type),
    );
    button.style.cssText = `left:${(Math.min(...xs) / viewport.width) * 100}%;top:${(Math.min(...ys) / viewport.height) * 100}%;width:${(Math.max(10, Math.max(...xs) - Math.min(...xs)) / viewport.width) * 100}%;height:${(Math.max(10, Math.max(...ys) - Math.min(...ys)) / viewport.height) * 100}%;`;
    button.onpointerdown = (event) => {
      event.preventDefault();
      $("#marks-canvas").dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          buttons: event.buttons,
          button: event.button,
          pointerType: event.pointerType,
        }),
      );
    };
    button.onclick = () => {
      selected = mark.id;
      properties();
      drawMarks();
    };
    annotationHits.append(button);
  }
}

const cancelProcessing = document.createElement("button");
cancelProcessing.className = "secondary";
cancelProcessing.textContent = "Cancel processing";
cancelProcessing.hidden = true;
cancelProcessing.onclick = cancelEngine;
$("#busy").append(cancelProcessing);
document.addEventListener("pdf-processing", (event) => {
  cancelProcessing.hidden = !event.detail;
});

const analysisStatus = document.createElement("div");
analysisStatus.id = "document-analysis";
analysisStatus.className = "analysis-status";
analysisStatus.hidden = true;
$("#toolbar").after(analysisStatus);
function updateAnalysisStatus(progress) {
  analysisStatus.hidden = false;
  const summary = analysis?.summary(page()),
    label = summary?.kind || "analyzing";
  analysisStatus.innerHTML = `<span aria-live="polite">${progress.completed} / ${progress.total} pages analyzed · ${esc(label)}${progress.processing ? " · Recognizing text…" : ""}${progress.paused ? " · Paused" : ""}</span><button class="text-button" id="toggle-analysis">${progress.paused ? "Resume analysis" : "Pause analysis"}</button>`;
  $("#toggle-analysis").onclick = () =>
    progress.paused ? analysis.resume() : analysis.pause();
}
