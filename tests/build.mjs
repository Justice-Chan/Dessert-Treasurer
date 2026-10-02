import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { before, test } from "node:test";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

before(async () => {
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL("scripts/build-web.mjs", root))]);
});

test("build includes every source file exactly once in manifest order", async () => {
  const paths = JSON.parse(await read("frontend/scripts.json"));
  assert.ok(paths.length > 0);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every((path) => /^js\/[a-z/.-]+\.js$/.test(path) && !path.includes("..")));
  const source = (await Promise.all(paths.map((path) => read(`frontend/${path}`)))).join("");
  assert.equal(await read("dist/app.js"), source);
  assert.doesNotThrow(() => new Script(source));
  assert.equal(paths.at(-1), "js/bootstrap.js");
});

test("HTML and CSS are copied without changes and all entry assets exist", async () => {
  const html = await read("frontend/index.html");
  assert.equal(await read("dist/index.html"), html);
  assert.equal(await read("dist/styles/app.css"), await read("frontend/styles/app.css"));
  assert.match(html, /<link rel="stylesheet" href="styles\/app\.css">/);
  assert.match(html, /<script src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /<style>|<script>/);
});

test("platform packaging shares app identity and references existing icons", async () => {
  const base = JSON.parse(await read("src-tauri/tauri.conf.json"));
  assert.equal(base.identifier, "com.justicechan.dessert-treasurer");
  assert.deepEqual(base.bundle.targets, []);
  for (const [platform, targets] of [["macos", ["app", "dmg"]], ["windows", ["nsis"]]]) {
    const config = JSON.parse(await read(`src-tauri/tauri.${platform}.conf.json`));
    assert.equal(config.identifier, undefined);
    assert.equal(config.version, undefined);
    assert.deepEqual(config.bundle.targets, targets);
    for (const icon of config.bundle.icon) await access(new URL(`src-tauri/${icon}`, root));
  }
  const windows = JSON.parse(await read("src-tauri/tauri.windows.conf.json"));
  assert.equal(windows.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(windows.bundle.windows.webviewInstallMode.type, "downloadBootstrapper");
});

test("CI uses the same pinned Rust version as local builds", async () => {
  const toolchain = await read("rust-toolchain.toml");
  const version = toolchain.match(/^channel = "(\d+\.\d+\.\d+)"$/m)?.[1];
  assert.ok(version, "Use a specific Rust version, not a moving stable channel");
  for (const path of [".github/workflows/ci.yml", ".github/workflows/build-windows.yml"]) {
    assert.ok((await read(path)).includes(`toolchain: ${version}`));
  }
});

test("Windows installer build refuses to run on other operating systems", { skip: process.platform === "win32" }, async () => {
  await assert.rejects(
    promisify(execFile)(process.execPath, [fileURLToPath(new URL("scripts/build-windows.mjs", root))]),
    (error) => error.code === 1 && error.stderr.includes("Build Windows installers on Windows")
  );
});
