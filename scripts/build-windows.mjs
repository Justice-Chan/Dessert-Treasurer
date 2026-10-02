import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("Build Windows installers on Windows or use GitHub Actions > Build Windows Installer. No cross-compilation tools are required on macOS.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const result = spawnSync(process.execPath, [cli, "build", "--bundles", "nsis", "--target", "x86_64-pc-windows-msvc", "--", "--locked"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
