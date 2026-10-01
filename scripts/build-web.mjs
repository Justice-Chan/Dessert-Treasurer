import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Script } from "node:vm";

const frontend = new URL("../frontend/", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const scripts = JSON.parse(await readFile(new URL("scripts.json", frontend), "utf8"));
// One script preserves the existing shared scope and function hoisting.
const source = (await Promise.all(scripts.map((path) => readFile(new URL(path, frontend), "utf8")))).join("");
new Script(source, { filename: "app.js" });

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("index.html", frontend), new URL("index.html", output));
await cp(new URL("styles/", frontend), new URL("styles/", output), { recursive: true });
await writeFile(new URL("app.js", output), source);
