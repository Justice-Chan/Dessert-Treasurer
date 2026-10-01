import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("This installer requires macOS.");

const source = fileURLToPath(new URL("../src-tauri/target/release/bundle/macos/Dessert Treasurer.app", import.meta.url));
const destination = "/Applications/Dessert Treasurer.app";
if (!existsSync(source)) throw new Error("Build the app before installing it.");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed; installation stopped.`);
}

// Stage and verify the complete bundle before replacing the installed app.
const staging = mkdtempSync("/Applications/.dessert-treasurer-update-");
const stagedApp = join(staging, "Dessert Treasurer.app");
const previousApp = join(staging, "previous.app");
try {
  run("/usr/bin/ditto", [source, stagedApp]);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagedApp]);
  run("/usr/bin/osascript", ["-e", 'if application id "com.justicechan.dessert-treasurer" is running then tell application id "com.justicechan.dessert-treasurer" to quit']);
  if (existsSync(destination)) renameSync(destination, previousApp);
  try {
    renameSync(stagedApp, destination);
  } catch (error) {
    if (existsSync(previousApp)) renameSync(previousApp, destination);
    throw error;
  }
} catch (error) {
  if (existsSync(previousApp)) {
    console.error(`The previous app is preserved at ${previousApp}.`);
  } else {
    rmSync(staging, { recursive: true, force: true });
  }
  throw error;
}
rmSync(staging, { recursive: true, force: true });
console.log(`Updated ${destination}. Open it from Applications or the Dock.`);
