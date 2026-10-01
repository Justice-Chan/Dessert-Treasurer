import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
