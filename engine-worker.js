import "./vendor/pdf-lib.min.js";
import { inspectContent, previewContent } from "./content-engine.js";
import { exportPdf } from "./pdf-core.js";
import { reconstructRegionPdf } from "./reconstruction.js";
const methods = {
  inspectContent,
  previewContent,
  exportPdf,
  reconstructRegionPdf,
};
self.onmessage = async ({ data }) => {
  const { id, method, args } = data;
  try {
    if (!Object.hasOwn(methods, method)) throw Error("Unknown PDF operation.");
    self.postMessage({ id, result: await methods[method](...args) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
