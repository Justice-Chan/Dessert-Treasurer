import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const appPath = fileURLToPath(new URL("../src-tauri/target/release/bundle/macos/Dessert Treasurer.app", import.meta.url));
const result = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
  stdio: "inherit"
});

if (result.status !== 0) process.exit(result.status ?? 1);
