// Unit tests for the Apps Script backend. The files run in one Node context, as Apps Script runs
// them in one global scope, with small stand-ins for the Google services they touch.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const backend = new URL("../backend/", import.meta.url);

// A Drive-like folder: children are listed through hasNext/next iterators.
function folder(name, id = name, children = []) {
  return {
    trashed: false,
    created: [],
    getName: () => name,
    getId: () => id,
    isTrashed() { return this.trashed; },
    getFolders: () => iterate(children),
    getFoldersByName: (wanted) => iterate(children.filter((child) => child.getName() === wanted)),
    createFolder(childName) {
      const child = folder(childName, `new-${childName}`);
      children.push(child);
      this.created.push(childName);
      return child;
    }
  };
}

function iterate(items) {
  let index = 0;
  return { hasNext: () => index < items.length, next: () => items[index++] };
}

async function loadBackend({ month = folder("2026-11"), secret = "s".repeat(32) } = {}) {
  const root = folder("receipts", "root", [month]);
  const cache = new Map();
  const context = createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => ({ SYNC_SECRET: secret, DRIVE_FOLDER_ID: "root" })[name] || null }) },
    DriveApp: { getFolderById: () => root },
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) ?? null, put: (key, value) => cache.set(key, value), remove: (key) => cache.delete(key) }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }) },
    Utilities: {
      formatDate: (date, zone, pattern) => {
        const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date).split("-");
        return pattern.replace("yyyy", y).replace("MM", m).replace("dd", d);
      }
    }
  });
  const files = (await readdir(backend)).filter((name) => name.endsWith(".js")).sort();
  for (const name of files) runInContext(await readFile(new URL(name, backend), "utf8"), context, { filename: name });
  return { run: (code) => runInContext(code, context), month, cache };
}

const claim = (extra = {}) => ({ date: "2026-11-01", amount: 320, parent: "食材與耗材", child: "乳品", vendor: "", description: "", ...extra });

test("claims are validated before they are saved", async () => {
  const { run } = await loadBackend();
  const validate = run("validateClaim");
  assert.equal(validate(claim()).amount, 320);
  assert.throws(() => validate(claim({ date: "2099-01-01" })), /未來/);
  assert.throws(() => validate(claim({ amount: 3.5 })), /整數/);
  assert.throws(() => validate(claim({ parent: "其他" })), /自訂/);
});

test("cells that would start a formula are kept as text", async () => {
  const { run } = await loadBackend();
  const safeCell = run("safeCell");
  assert.equal(safeCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(safeCell("-5"), "'-5");
  assert.equal(safeCell("全聯"), "全聯");
});

test("activity folders drop their number, and repeated names show the session", async () => {
  const month = folder("2026-11", "m", [folder("02_泡芙 實作課"), folder("01_杜拜巧克力"), folder("01_泡芙 實作課")]);
  const { run } = await loadBackend({ month });
  // Arrays made inside the context have its own prototype, so copy before comparing.
  const labels = Array.from(run("activityFolders")(month), (item) => item.label);
  assert.deepEqual(labels, ["杜拜巧克力", "泡芙 實作課（第 1 堂）", "泡芙 實作課（第 2 堂）"]);
});

test("a typed activity that already exists becomes its next session and clears the cached list", async () => {
  const month = folder("2026-11", "m", [folder("01_野餐")]);
  const { run, cache } = await loadBackend({ month });
  cache.set("activities:2026-11", "[]");
  const result = run("resolveActivity")({ activityName: "野餐" }, "2026-11");
  assert.equal(result.label, "野餐（第 2 堂）");
  assert.deepEqual([...month.created], ["02_野餐"]);
  assert.equal(cache.has("activities:2026-11"), false);
});

test("an activity id from another month is refused", async () => {
  const { run } = await loadBackend({ month: folder("2026-11", "m", [folder("01_野餐", "a1")]) });
  assert.throws(() => run("resolveActivity")({ activityId: "elsewhere" }, "2026-11"), /不存在/);
});

test("the sync secret must match exactly", async () => {
  const { run } = await loadBackend();
  const verify = run("verifySyncSecret");
  assert.doesNotThrow(() => verify("s".repeat(32)));
  assert.throws(() => verify("s".repeat(31)), /金鑰/);
  assert.throws(() => verify(undefined), /金鑰/);
});

test("an unknown action is refused before any sign-in check", async () => {
  const { run } = await loadBackend();
  const reply = run("doPost")({ postData: { contents: JSON.stringify({ action: "dropTables" }) } });
  assert.equal(reply.ok, false);
  assert.equal(reply.error.code, "bad_request");
});
