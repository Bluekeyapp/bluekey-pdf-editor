const fs = require("node:fs");
module.exports = async function fixtures() {
  globalThis.self = globalThis;
  await import("../vendor/pdf-lib.min.js");
  const { embedManagedFont } = await import("../font-manager.js");
  const document = await PDFLib.PDFDocument.create();
  const { font } = await embedManagedFont(
    document,
    "regular",
    null,
    "María café",
  );
  document
    .addPage([595, 842])
    .drawText("María café", { x: 45, y: 700, size: 20, font });
  fs.writeFileSync("tests/embedded-fixture.pdf", await document.save());
  const { createCanvas } = require("@napi-rs/canvas");
  const canvas = createCanvas(1600, 1000),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = "black";
  ctx.font = "bold 72px Arial";
  ctx.fillText("CLIENT APPROVAL", 120, 200);
  ctx.font = "54px Arial";
  ctx.fillText("Maria Garcia", 120, 350);
  ctx.fillText("Invoice 12345", 120, 480);
  const scan = await PDFLib.PDFDocument.create(),
    image = await scan.embedPng(canvas.toDataURL());
  scan
    .addPage([800, 500])
    .drawImage(image, { x: 0, y: 0, width: 800, height: 500 });
  fs.writeFileSync("tests/scan-fixture.pdf", await scan.save());
};
if (require.main === module)
  module.exports().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
