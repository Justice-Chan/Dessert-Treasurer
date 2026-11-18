// Parses every .js file in the given folders without running it, so a typo fails CI before deploy.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Script } from "node:vm";

let failed = false;
for (const folder of process.argv.slice(2)) {
  for (const name of (await readdir(folder)).filter((file) => file.endsWith(".js"))) {
    const path = join(folder, name);
    try {
      new Script(await readFile(path, "utf8"), { filename: path });
    } catch (error) {
      failed = true;
      console.error(`${path}: ${error.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
