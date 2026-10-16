const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".png": "image/png",
};
http
  .createServer((req, res) => {
    let file;
    try {
      file = path.resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (file === root) file = path.join(root, "index.html");
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`BlueKey PDF Editor: http://localhost:${port}`),
  );
