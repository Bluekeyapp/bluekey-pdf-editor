const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
}
const assets = [...files("vendor"), ...files("examples")].sort();
fs.writeFileSync(
  "offline-assets.json",
  JSON.stringify(
    assets.map((name) => "/" + name),
    null,
    2,
  ) + "\n",
);
const hash = crypto.createHash("sha256");
for (const name of [
  ...fs
    .readdirSync(".")
    .filter(
      (name) =>
        /\.(js|css|html|svg|webmanifest)$/.test(name) && name !== "sw.js",
    ),
  ...assets,
].sort()) {
  const bytes = fs.readFileSync(name);
  const text =
    /\.(js|mjs|json|md|txt|html|css|svg|webmanifest)$/.test(name) ||
    path.basename(name).includes("LICENSE");
  hash
    .update(name)
    .update(text ? bytes.toString("utf8").replace(/\r\n/g, "\n") : bytes);
}
hash.update(
  fs
    .readFileSync("sw.js", "utf8")
    .replace(/\r\n/g, "\n")
    .replace(
      /const CACHE = PREFIX \+ [^;]+;/,
      "const CACHE = PREFIX + RELEASE;",
    ),
);
const version = hash.digest("hex").slice(0, 16);
const source = fs
  .readFileSync("sw.js", "utf8")
  .replace(
    /const CACHE = PREFIX \+ [^;]+;/,
    `const CACHE = PREFIX + "${version}";`,
  );
fs.writeFileSync("sw.js", source);
console.log(`Built offline asset manifest and release ${version}.`);
