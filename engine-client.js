// Isolate content-stream parsing from the UI. Termination also cancels a hung parser.
let worker;
let sequence = 0;
const pending = new Map();
function reset(reason) {
  worker?.terminate();
  worker = null;
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(reason);
  }
  pending.clear();
  status();
}
export function cancelEngine() {
  reset(new DOMException("Processing canceled", "AbortError"));
}
export function engineCall(method, args, { timeout = 30000, signal } = {}) {
  if (signal?.aborted)
    return Promise.reject(
      new DOMException("Processing canceled", "AbortError"),
    );
  worker ??= new Worker(new URL("./engine-worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    status();
    clearTimeout(job.timer);
    data.error ? job.reject(Error(data.error)) : job.resolve(data.result);
  };
  worker.onerror = () =>
    reset(
      Error("PDF processing failed. Your original and draft are unchanged."),
    );
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const abort = () =>
      reset(new DOMException("Processing canceled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = (fn) => (value) => {
      signal?.removeEventListener("abort", abort);
      fn(value);
    };
    const timer = setTimeout(
      () =>
        reset(Error("PDF processing took too long. Try a smaller document.")),
      timeout,
    );
    pending.set(id, {
      resolve: cleanup(resolve),
      reject: cleanup(reject),
      timer,
    });
    status();
    try {
      worker.postMessage({ id, method, args });
    } catch (error) {
      reset(error);
    }
  });
}
export const inspectContent = (...args) => engineCall("inspectContent", args);
export const previewContent = (...args) => engineCall("previewContent", args);

function status() {
  document.dispatchEvent(
    new CustomEvent("pdf-processing", { detail: pending.size > 0 }),
  );
}
export const exportPdf = (...args) =>
  engineCall("exportPdf", args, { timeout: 60000 });
