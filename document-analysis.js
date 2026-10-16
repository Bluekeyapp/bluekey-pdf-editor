import { regionLines } from "./reconstruction.js";
import { recognizePage, prepareScan } from "./ocr.js";

const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
export function intersects(a, b, ratio = 0.35) {
  const overlap =
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return overlap > Math.min(area(a), area(b)) * ratio;
}
export function uniqueRecognized(areas, existing = []) {
  const output = [];
  for (const candidate of areas)
    if (
      candidate.text?.trim() &&
      area(candidate.region) > 0 &&
      !existing.some((item) => intersects(candidate.region, item.region)) &&
      !output.some((item) => intersects(candidate.region, item.region))
    )
      output.push(candidate);
  return output;
}
export function classifyPage(items, extracted, imageRegions, drawn = false) {
  const visible = items.filter(
    (item) =>
      item.type === "text" &&
      item.renderMode !== 3 &&
      item.renderMode !== 7 &&
      item.text?.trim(),
  );
  const direct = visible.filter((item) => item.editable).length;
  const imageCoverage = Math.min(
    1,
    imageRegions.reduce((sum, region) => sum + area(region), 0),
  );
  const kind =
    imageCoverage > 0.03
      ? visible.length
        ? "mixed"
        : extracted.length
          ? "searchable-scan"
          : "scan"
      : visible.length || extracted.length
        ? "text"
        : drawn
          ? "scan"
          : "empty";
  return {
    kind,
    direct,
    rebuild:
      visible.length -
      direct +
      extracted.filter(
        (line) => !visible.some((item) => item.text === line.text),
      ).length,
    imageCoverage,
  };
}

// Analysis has its own worker, so canceling background work cannot cancel Apply or Export.
function inspectionClient() {
  let worker,
    id = 0;
  const jobs = new Map();
  function cancel(
    reason = new DOMException("Analysis canceled", "AbortError"),
  ) {
    worker?.terminate();
    worker = null;
    for (const job of jobs.values()) {
      clearTimeout(job.timer);
      job.reject(reason);
    }
    jobs.clear();
  }
  return {
    cancel,
    inspect(bytes, index) {
      worker ??= new Worker(new URL("./engine-worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        const job = jobs.get(data.id);
        if (!job) return;
        jobs.delete(data.id);
        clearTimeout(job.timer);
        data.error ? job.reject(Error(data.error)) : job.resolve(data.result);
      };
      worker.onerror = () =>
        cancel(
          Error(
            "Text analysis failed on this page. Use area selection or OCR.",
          ),
        );
      return new Promise((resolve, reject) => {
        const key = ++id,
          timer = setTimeout(
            () =>
              cancel(
                Error(
                  "Text analysis reached its processing limit. Use area selection for this page.",
                ),
              ),
            30000,
          );
        jobs.set(key, { resolve, reject, timer });
        worker.postMessage({
          id: key,
          method: "inspectContent",
          args: [bytes, index],
        });
      });
    },
  };
}

export function createDocumentAnalyzer({
  document: doc,
  pdf,
  language = "eng",
  onUpdate = () => {},
  imageOps = [],
  drawingOps = [],
}) {
  const client = inspectionClient(),
    details = new Map(),
    pending = new Map(),
    summaries = new Map(),
    recognized = new Map();
  let stopped = false,
    paused = false,
    running = false,
    priority = doc.pages[0]?.id,
    priorityKey = "",
    recognition,
    processing = null;
  let queue = doc.pages.map((page) => page.id);
  const update = () => {
    if (!stopped)
      onUpdate({
        completed: doc.pages.filter((page) => summaries.has(page.id)).length,
        total: doc.pages.length,
        processing,
        paused,
        summaries,
        recognized,
      });
  };
  const source = (page) =>
    doc.sources.find((source) => source.id === page.source);
  const key = (page) => page.id + ":" + page.rotation;
  async function native(page) {
    const k = key(page),
      rotation = page.rotation;
    if (details.has(k)) return details.get(k);
    if (pending.has(k)) return pending.get(k);
    const job = (async () => {
      const proxy = await pdf(source(page)),
        pg = await proxy.getPage(page.index + 1),
        view = pg.getViewport({ scale: 1 / (pg.userUnit || 1), rotation });
      const [content, inspection] = await Promise.all([
        pg.getTextContent(),
        client.inspect(source(page).bytes, page.index),
      ]);
      if (stopped) throw new DOMException("Analysis canceled", "AbortError");
      const extracted = regionLines(content, view, {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      }).map((line, index) => ({
        ...line,
        id: "extract-" + index,
        region: {
          x: Math.max(0, line.bbox.x0 / view.width),
          y: Math.max(0, line.bbox.y0 / view.height),
          w: (line.bbox.x1 - line.bbox.x0) / view.width,
          h: (line.bbox.y1 - line.bbox.y0) / view.height,
        },
      }));
      const images = inspection.items
        .filter((item) => item.type === "image")
        .map((item) => {
          const points = item.quad.map((point) =>
              view.convertToViewportPoint(...point),
            ),
            xs = points.map((point) => point[0]),
            ys = points.map((point) => point[1]);
          const x = Math.max(0, Math.min(...xs) / view.width),
            y = Math.max(0, Math.min(...ys) / view.height);
          return {
            x,
            y,
            w: Math.max(0, Math.min(1, Math.max(...xs) / view.width) - x),
            h: Math.max(0, Math.min(1, Math.max(...ys) / view.height) - y),
          };
        })
        .filter((region) => area(region) > 0.03);
      let drawn = false;
      if (!images.length) {
        const operations = await pg.getOperatorList();
        drawn = operations.fnArray.some((op) => drawingOps.includes(op));
        if (operations.fnArray.some((op) => imageOps.includes(op)))
          images.push({ x: 0, y: 0, w: 1, h: 1 });
      }
      const summary = classifyPage(inspection.items, extracted, images, drawn);
      const result = { ...inspection, extracted, images, summary };
      details.set(k, result);
      while (details.size > 8) {
        const oldest = [...details.keys()].find(
          (id) => !id.startsWith(priority + ":"),
        );
        if (!oldest) break;
        details.delete(oldest);
      }
      summaries.set(page.id, { ...summary, status: "analyzed" });
      update();
      return result;
    })();
    pending.set(k, job);
    try {
      return await job;
    } finally {
      pending.delete(k);
    }
  }
  async function recognize(page, result) {
    if (
      !["scan", "mixed"].includes(result.summary.kind) ||
      recognized.has(key(page))
    )
      return;
    const k = key(page),
      rotation = page.rotation;
    recognition = new AbortController();
    const signal = recognition.signal;
    const proxy = await pdf(source(page)),
      pg = await proxy.getPage(page.index + 1),
      base = pg.getViewport({ scale: 1 / (pg.userUnit || 1), rotation });
    const scale = Math.min(2, 2200 / Math.max(base.width, base.height)),
      view = pg.getViewport({ scale: scale / (pg.userUnit || 1), rotation });
    if (signal.aborted || stopped) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(view.width);
    canvas.height = Math.ceil(view.height);
    const task = pg.render({
      canvasContext: canvas.getContext("2d"),
      viewport: view,
      annotationMode: 0,
    });
    signal.addEventListener("abort", () => task.cancel(), { once: true });
    try {
      await task.promise;
      if (signal.aborted || stopped) return;
      const regions =
        result.summary.kind === "scan"
          ? [{ x: 0, y: 0, w: 1, h: 1 }]
          : result.images.sort((a, b) => area(b) - area(a)).slice(0, 8);
      const lines = [];
      for (const region of regions) {
        if (signal.aborted)
          throw new DOMException("Analysis canceled", "AbortError");
        const crop = prepareScan(canvas, region, true);
        const found = await recognizePage(
          crop.canvas,
          language,
          () => {},
          signal,
          { region: regions.length > 1 },
        );
        for (const line of found) {
          const b = line.bbox;
          lines.push({
            id: "ocr-" + lines.length,
            source: "ocr",
            text: line.text,
            confidence: line.confidence,
            region: {
              x: (b.x0 + crop.x) / canvas.width,
              y: (b.y0 + crop.y) / canvas.height,
              w: (b.x1 - b.x0) / canvas.width,
              h: (b.y1 - b.y0) / canvas.height,
            },
          });
        }
      }
      recognized.set(
        k,
        uniqueRecognized(lines, result.extracted).slice(0, 1000),
      );
      while (recognized.size > 16) {
        const oldest = [...recognized.keys()].find(
          (id) => !id.startsWith(priority + ":"),
        );
        if (!oldest) break;
        recognized.delete(oldest);
      }
      summaries.set(page.id, {
        ...result.summary,
        status: "recognized",
        recognized: recognized.get(k)?.length || 0,
      });
      update();
    } finally {
      canvas.width = canvas.height = 1;
      recognition = null;
    }
  }
  async function run() {
    if (running || paused || stopped) return;
    running = true;
    try {
      while (queue.length && !paused && !stopped) {
        const id = queue.shift(),
          page = doc.pages.find((page) => page.id === id);
        if (!page) continue;
        processing = id;
        update();
        try {
          const result = await native(page);
          if (!paused && !stopped) await recognize(page, result);
        } catch (error) {
          if (stopped) break;
          if (
            error.name === "AbortError" ||
            error.name === "RenderingCancelledException"
          ) {
            if (!queue.includes(id)) queue.push(id);
          } else
            summaries.set(id, {
              kind: "unsupported",
              status: "error",
              error: error.message,
            });
        }
        processing = null;
        update();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      running = false;
      processing = null;
      update();
    }
  }
  return {
    native,
    areas: (page) => (page ? recognized.get(key(page)) || [] : []),
    prioritize(page) {
      if (!page || stopped) return;
      if (priorityKey !== key(page)) recognition?.abort();
      priority = page.id;
      priorityKey = key(page);
      queue = queue.filter((id) => id !== page.id);
      if (processing !== page.id) queue.unshift(page.id);
      for (const candidate of doc.pages)
        if (
          !summaries.has(candidate.id) &&
          candidate.id !== processing &&
          !queue.includes(candidate.id)
        )
          queue.push(candidate.id);
      run();
    },
    start(page) {
      paused = false;
      this.prioritize(page);
    },
    pause() {
      paused = true;
      if (processing && !queue.includes(processing)) queue.unshift(processing);
      recognition?.abort();
      client.cancel();
      update();
    },
    isPaused: () => paused,
    resume() {
      paused = false;
      run();
    },
    stop() {
      stopped = true;
      recognition?.abort();
      client.cancel();
      details.clear();
      recognized.clear();
      queue = [];
    },
    summary: (page) => summaries.get(page.id),
  };
}
