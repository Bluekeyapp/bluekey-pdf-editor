const { spawn } = require("node:child_process");
const path = require("node:path");
process.chdir(path.join(__dirname, ".."));
const unit = [
  "fixtures",
  "core",
  "content-engine",
  "advanced-engine",
  "text-upgrade",
  "reconstruction",
  "i18n",
  "deployment",
  "reliability",
  "text-experience",
];
const browser = [
  "smoke",
  "advanced-ui",
  "ocr-ui",
  "offline-ocr",
  "reliability-ui",
  "text-experience-ui",
  "workspace-ui",
];
function run(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/${name}.cjs`], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`${name} failed (${code})`)),
    );
  });
}
(async () => {
  if (!process.argv.includes("--browser")) {
    for (const name of unit) await run(name);
    return;
  }
  await run("fixtures");
  await run("content-engine");
  const server = spawn(process.execPath, ["server.cjs"], {
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Local server did not start.")),
        10000,
      );
      server.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      server.once("error", reject);
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error(`Local server exited (${code}).`));
      });
    });
    process.env.TEST_BASE_URL = `http://127.0.0.1:${process.env.PORT || 4173}`;
    for (const name of browser.filter(
      (name) =>
        !process.argv.some((arg) => arg.startsWith("--suite=")) ||
        process.argv.includes("--suite=" + name),
    ))
      await run(name);
  } finally {
    server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
