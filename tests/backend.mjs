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
  let uuidCount = 0;
  const context = createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => ({ SYNC_SECRET: secret, DRIVE_FOLDER_ID: "root" })[name] || null }) },
    DriveApp: { getFolderById: () => root },
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) ?? null, put: (key, value) => cache.set(key, value), remove: (key) => cache.delete(key) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }) },
    Utilities: {
      getUuid: () => `uuid-${(uuidCount += 1)}`,
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

// ---- Shared ledger ----

// Values made inside the context have its own prototypes, so compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sheetClaim = (n, status, extra = {}) => ({
  id: id(n), status, date: "2026-11-02", amount: 450, parent: "食材與耗材", child: "乳品", activity: "社課",
  vendor: "", description: "", reviewNote: "", applicantEmail: `p${n}@example.com`, applicantName: `幹部${n}`, receiptLinks: [], ...extra
});
const emptyLedger = () => ({
  entries: [], claims: [], trash: [], reconciliations: [], payees: [], lockedMonths: [],
  accounts: [{ id: "cash", name: "現金", type: "cash", openingDate: "2026-01-01", openingBalance: 1000 }]
});

// Keeps the ledger file and the claims sheet in memory.
async function loadLedgerBackend(sheet = [], withdrawn = []) {
  const backend = await loadBackend();
  const store = { doc: null, sheet, withdrawn, statuses: [] };
  backend.run("(store) => { globalThis.store = store; }")(store);
  backend.run(`
    readLedger = () => store.doc && JSON.parse(JSON.stringify(store.doc));
    writeLedger = (ledger, version) => (store.doc = JSON.parse(JSON.stringify({ version, savedAt: "now", ledger })));
    sheetClaims = () => store.sheet;
    dataRows = () => store.sheet.map((claim) => { const row = []; row[COL["id"]] = claim.id; return row; });
    setSheetStatus = (index, status) => store.statuses.push([store.sheet[index].id, status]);
    appendLog = () => {};
  `);
  const treasurer = { email: "t@example.com", role: "treasurer" };
  return { ...backend, store, call: (name, payload) => JSON.parse(JSON.stringify(backend.run(name)(treasurer, payload))) };
}

test("the sheet's claims are merged into the ledger", async () => {
  const { run } = await loadBackend();
  const ledger = emptyLedger();
  ledger.claims.push(
    { id: id(2), source: "web", status: "pending", amount: 100 },
    { id: id(3), source: "web", status: "paid", amount: 450, parent: "食材與耗材", child: "乳品", title: "乳品" }
  );
  ledger.entries.push({ id: "e3", claimId: id(3), type: "expense", amount: 450, parent: "食材與耗材", child: "乳品" });
  ledger.trash.push({ id: "t", kind: "claim", record: { id: id(5) } });
  const remote = [sheetClaim(2, "已付款", { amount: 520 }), sheetClaim(3, "已核准", { amount: 999, child: "包材" }), sheetClaim(4, "待審核"), sheetClaim(5, "待審核")];
  assert.equal(run("mergeSheetClaims")(ledger, remote), true);
  const byId = Object.fromEntries(ledger.claims.map((claim) => [claim.id, claim]));
  assert.deepEqual(plain(Object.keys(byId).sort()), [id(2), id(3), id(4)]);
  // Marked paid on the web only: still approved, with a reminder to record the payment.
  assert.equal(byId[id(2)].status, "approved");
  assert.equal(byId[id(2)].webPaid, true);
  assert.equal(byId[id(2)].amount, 520);
  // Paid here: keeps amount and status, follows the category, and so does its expense.
  assert.equal(byId[id(3)].amount, 450);
  assert.equal(byId[id(3)].status, "paid");
  assert.equal(ledger.entries[0].child, "包材");
  assert.equal(run("mergeSheetClaims")(ledger, remote), false);
  // Deleted from the sheet while unpaid: to the trash.
  run("mergeSheetClaims")(ledger, remote.slice(0, 2));
  assert.deepEqual(plain(ledger.trash.map((item) => item.record.id)), [id(5), id(4)]);
});

test("the overview totals follow the app's rules", async () => {
  const { run } = await loadBackend();
  const ledger = emptyLedger();
  ledger.entries.push(
    { id: "a", type: "income", amount: 300, date: "2026-11-03", accountId: "cash", parent: "社費與會費" },
    { id: "b", type: "expense", amount: 50, date: "2026-11-04", accountId: "cash", parent: "行政庶務" },
    { id: "c", type: "expense", amount: 70, date: "2026-11-05", accountId: "cash", claimId: id(9) }
  );
  ledger.claims.push({ id: id(8), status: "pending", amount: 200, date: "2026-11-01", parent: "食材與耗材" });
  const rows = Object.fromEntries(Array.from(run("summaryRows")(ledger, "2026-11"), (row) => [row.label, row.amount]));
  assert.equal(rows["帳面餘額"], 1250);
  assert.equal(rows["本月收入"], 300);
  assert.equal(rows["本月支出"], 250);
  assert.equal(rows["待處理報銷"], 200);
  assert.equal(rows["食材與耗材"], 200);
});

test("the app's upload is refused when the cloud ledger moved on", async () => {
  const { run, store } = await loadLedgerBackend([sheetClaim(1, "待審核")]);
  const sync = (payload) => JSON.parse(JSON.stringify(run("syncLedger")(payload)));
  assert.equal(sync({}).ledger, null);
  const first = sync({ baseVersion: 0, ledger: emptyLedger() });
  assert.equal(first.version, 1);
  assert.equal(first.ledger.claims[0].id, id(1));
  const stale = sync({ baseVersion: 0, ledger: { ...emptyLedger(), lockedMonths: ["2026-10"] } });
  assert.equal(stale.conflict, true);
  assert.deepEqual(plain(store.doc.ledger.lockedMonths), []);
  assert.equal(sync({ baseVersion: 1, ledger: { ...first.ledger, lockedMonths: ["2026-10"] } }).version, 2);
  assert.deepEqual(plain(store.doc.ledger.lockedMonths), ["2026-10"]);
});

test("entries saved on the web respect locked months and claim payments", async () => {
  const { call, run, store } = await loadLedgerBackend();
  run("writeLedger")({ ...emptyLedger(), lockedMonths: ["2026-10"] }, 1);
  const entry = { type: "income", date: "2026-11-03", parent: "社費與會費", child: "補繳", amount: 200, accountId: "cash" };
  const view = call("saveEntry", { entry });
  assert.equal(view.version, 2);
  assert.equal(view.entries[0].amount, 200);
  assert.equal(store.doc.ledger.entries[0].method, "現金");
  assert.throws(() => call("saveEntry", { entry: { ...entry, date: "2026-10-31" } }), /鎖定/);
  assert.throws(() => call("saveEntry", { entry: { ...entry, amount: 2.5 } }), /正整數/);
  assert.throws(() => call("saveEntry", { entry: { ...entry, accountId: "nope" } }), /帳戶/);
  call("trashEntry", { id: view.entries[0].id });
  assert.equal(store.doc.ledger.entries.length, 0);
  assert.equal(store.doc.ledger.trash[0].kind, "entry");
});

test("paying a claim on the web books the expense, and leaving 已付款 takes it back", async () => {
  const { call, run, store } = await loadLedgerBackend([sheetClaim(1, "已核准")]);
  run("writeLedger")(emptyLedger(), 1);
  const view = call("payClaim", { id: id(1), date: "2026-11-05", accountId: "cash" });
  assert.deepEqual(view.payments, [{ id: id(1), date: "2026-11-05", accountId: "cash" }]);
  assert.equal(view.entries[0].amount, 450);
  assert.deepEqual(plain(store.statuses), [[id(1), "已付款"]]);
  assert.throws(() => call("payClaim", { id: id(1), date: "2026-11-05", accountId: "cash" }), /已經記錄付款/);
  run("revokePayment")(id(1), "已核准");
  assert.equal(store.doc.ledger.entries.length, 0);
  assert.equal(store.doc.ledger.claims[0].status, "approved");
});

test("the monthly report shows the month's figures, entries and claims", async () => {
  const { run } = await loadBackend();
  const ledger = emptyLedger();
  ledger.entries.push(
    { id: "a", type: "income", amount: 3000, date: "2026-10-03", accountId: "cash", parent: "社費與會費", child: "期初社費", title: "期初社費" },
    { id: "b", type: "expense", amount: 1250, date: "2026-10-09", accountId: "cash", parent: "食材與耗材", child: "乳品", claimId: id(1) },
    { id: "c", type: "expense", amount: 99, date: "2026-11-01", accountId: "cash", parent: "行政庶務", child: "雜支" }
  );
  ledger.claims.push(
    { id: id(1), status: "paid", amount: 1250, date: "2026-10-08", paymentDate: "2026-10-09", person: "<王小明>", title: "乳品" },
    { id: id(2), status: "approved", amount: 400, date: "2026-10-20", person: "李小華", title: "包材" }
  );
  ledger.reconciliations.push({ month: "2026-10", accountId: "cash", actualBalance: 2750, calculatedBalance: 2750 });
  const html = run("monthlyReportHtml")(ledger, "2026-10", "2026/11/01 12:00");
  for (const text of ["2026 年 10 月", "月結已核對", "$3,000", "$1,250", "$1,750", "$400", "期初社費", "&lt;王小明&gt;", "已核准"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("雜支"));
});

test("only the newest twelve copies of a backup are kept", async () => {
  const { run } = await loadBackend();
  const files = Array.from({ length: 14 }, (_, n) => ({ name: `甜點社帳本 備份 ${n}`, created: n, trashed: false }));
  files.push({ name: "Access Sheet 備份 1", created: 0, trashed: false });
  const folder = { getFiles: () => iterate(files.map((file) => ({ getName: () => file.name, getDateCreated: () => file.created, setTrashed: (value) => { file.trashed = value; } }))) };
  assert.equal(run("keepNewest")(folder, "甜點社帳本 備份"), 12);
  assert.deepEqual(files.filter((file) => file.trashed).map((file) => file.name), ["甜點社帳本 備份 0", "甜點社帳本 備份 1"]);
});

test("a withdrawn claim leaves the ledger at once, unless it was paid", async () => {
  const { run, store } = await loadLedgerBackend();
  run("writeLedger")({ ...emptyLedger(), claims: [{ id: id(1), status: "pending" }, { id: id(2), status: "paid" }] }, 1);
  run("dropWithdrawnClaim")(id(1));
  run("dropWithdrawnClaim")(id(2));
  assert.deepEqual(plain(store.doc.ledger.claims.map((claim) => claim.id)), [id(2)]);
  assert.equal(store.doc.version, 2);
});

test("the app's changes go in record by record, and the web's edits to the same records win", async () => {
  const { run, store } = await loadLedgerBackend();
  const entry = (n, amount, extra = {}) => ({ id: `e${n}`, type: "expense", amount, date: "2026-11-02", accountId: "cash", ...extra });
  const claim = { id: id(7), status: "approved", amount: 300 };
  run("writeLedger")({ ...emptyLedger(), entries: [entry(1, 10), entry(2, 20)], claims: [claim] }, 1);
  // Meanwhile the web edited e2 and paid the claim.
  run("writeLedger")({ ...emptyLedger(), entries: [entry(1, 10), entry(2, 25), entry(9, 300, { claimId: id(7) })], claims: [{ ...claim, status: "paid" }] }, 2);
  const reply = JSON.parse(JSON.stringify(run("syncLedger")({
    baseVersion: 1,
    patch: {
      records: {
        entries: [
          { id: "e1", base: entry(1, 10), next: entry(1, 11) },
          { id: "e2", base: entry(2, 20), next: entry(2, 21) },
          { id: "e3", base: null, next: entry(3, 30) },
          { id: "e8", base: null, next: entry(8, 300, { claimId: id(7) }) }
        ],
        claims: [{ id: id(7), base: claim, next: { ...claim, status: "paid" , paymentDate: "2026-11-03" } }]
      },
      lockedMonths: { added: ["2026-10"] }
    }
  })));
  const amounts = Object.fromEntries(store.doc.ledger.entries.map((item) => [item.id, item.amount]));
  assert.deepEqual(amounts, { e1: 11, e2: 25, e3: 30, e9: 300 });
  assert.equal(reply.skipped, 3);
  assert.equal(reply.version, 3);
  assert.deepEqual(plain(store.doc.ledger.lockedMonths), ["2026-10"]);
});

test("the web's ledger view carries each month's figures and the locked date", async () => {
  const { run } = await loadBackend();
  const ledger = { ...emptyLedger(), lockedMonths: ["2026-09", "2026-08"] };
  ledger.accounts[0].openingDate = "2026-09-15";
  ledger.entries.push({ id: "a", type: "income", amount: 300, date: "2026-10-03", accountId: "cash" }, { id: "b", type: "expense", amount: 50, date: "2026-10-04", accountId: "cash" });
  const view = plain(run("ledgerView")({ version: 1, savedAt: "", ledger }));
  assert.equal(view.lockedUntil, "2026-09-30");
  assert.equal(Object.keys(view.months)[0], "2026-09");
  assert.deepEqual(view.months["2026-09"], { balance: 1000, accounts: [{ name: "現金", amount: 1000 }], income: 0, expense: 0 });
  assert.deepEqual(view.months["2026-10"], { balance: 1250, accounts: [{ name: "現金", amount: 1250 }], income: 300, expense: 50 });
});
