const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
let failed = false;
for (const directory of [".", "scripts", "tests"]) {
  for (const name of fs
    .readdirSync(directory)
    .filter((name) => /\.(c?js)$/.test(name))) {
    const result = spawnSync(
      process.execPath,
      ["--check", `${directory}/${name}`],
      { stdio: "inherit" },
    );
    if (result.status) failed = true;
  }
}
if (failed) process.exitCode = 1;
