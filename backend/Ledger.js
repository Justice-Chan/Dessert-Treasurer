// The shared ledger: income and expense entries, claims with their payments, accounts and the
// reconciliation records. It is one JSON file in the receipts folder, read and written by the web
// (treasurer only) and by the desktop app (sync secret). People and activities stay in the app.
// Every write raises the version, and the app's upload names the version it started from, so a
// stale copy is refused instead of overwriting newer books.

const LEDGER_FILE = "甜點社帳本.json";
const LEDGER_FILE_PROPERTY = "LEDGER_FILE_ID";
const LEDGER_FOLDER_PROPERTY = "LEDGER_FOLDER_ID";
const LEDGER_KEYS = ["entries", "claims", "trash", "accounts", "payees", "reconciliations", "lockedMonths"];
const LEDGER_MAX_ITEMS = 50000;
// DriveApp replaces a file's text only up to 10 MB.
const LEDGER_MAX_BYTES = 10 * 1024 * 1024;
const LEDGER_STATUS = { [STATUS_PENDING]: "pending", [STATUS_APPROVED]: "approved", [STATUS_PAID]: "paid", [STATUS_REJECTED]: "rejected" };
const SHEET_STATUS = Object.fromEntries(Object.entries(LEDGER_STATUS).map(([sheet, ledger]) => [ledger, sheet]));
const CLAIM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---- Storage ----

function ledgerFile() {
  const id = PropertiesService.getScriptProperties().getProperty(LEDGER_FILE_PROPERTY);
  if (!id) return null;
  try {
    const file = DriveApp.getFileById(id);
    return file.isTrashed() ? null : file;
  } catch (error) {
    console.error(error);
    return null;
  }
}

// { version, savedAt, ledger }, or null until the app first uploads its books.
function readLedger() {
  const file = ledgerFile();
  return file ? JSON.parse(file.getBlob().getDataAsString("UTF-8")) : null;
}

// LEDGER_FOLDER_ID holds the ledger and the monthly reports; without it, the receipts folder does.
function ledgerFolder() {
  const id = PropertiesService.getScriptProperties().getProperty(LEDGER_FOLDER_PROPERTY) || property("DRIVE_FOLDER_ID");
  return DriveApp.getFolderById(id);
}

// Call inside withLock.
function writeLedger(ledger, version) {
  const doc = { version, savedAt: new Date().toISOString(), ledger };
  const text = JSON.stringify(doc);
  if (Utilities.newBlob(text).getBytes().length > LEDGER_MAX_BYTES) {
    throw appError("invalid", "帳本超過 10 MB，請刪除帳戶或收款帳戶裡較大的 QR code 圖片。");
  }
  const file = ledgerFile();
  const folder = ledgerFolder();
  if (file) {
    file.setContent(text);
    // A ledger made before LEDGER_FOLDER_ID was set moves there on its next write.
    const parents = file.getParents();
    if (!parents.hasNext() || parents.next().getId() !== folder.getId()) file.moveTo(folder);
  } else {
    const created = folder.createFile(LEDGER_FILE, text, "application/json");
    PropertiesService.getScriptProperties().setProperty(LEDGER_FILE_PROPERTY, created.getId());
  }
  return doc;
}

function cleanLedger(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw appError("bad_request", "帳本格式不正確。");
  return Object.fromEntries(LEDGER_KEYS.map((key) => {
    const items = value[key] === undefined ? [] : value[key];
    if (!Array.isArray(items) || items.length > LEDGER_MAX_ITEMS) throw appError("bad_request", "帳本格式不正確。");
    return [key, items];
  }));
}

// ---- Claims from the sheet ----

function sheetClaims() {
  return dataRows(CLAIM_SHEET, CLAIM_HEADER.length).map((row) => ({
    ...claimFromRow(row),
    applicantEmail: cellText(row[COL["申請人 email"]]),
    applicantName: cellText(row[COL["申請人姓名"]]),
    receiptLinks: attachmentIds(row).map(driveLink)
  })).filter((claim) => claim.id);
}

// Ids the 操作紀錄 shows as withdrawn: their rows are gone from the sheet.
function withdrawnClaimIds() {
  return new Set(dataRows(LOG_SHEET, LOG_HEADER.length)
    .filter((row) => cellText(row[2]) === "withdrawRequest")
    .map((row) => cellText(row[3]))
    .filter(Boolean));
}

function driveLink(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

function claimNote(remote) {
  return [
    remote.activity && `活動／社課：${remote.activity}`,
    remote.vendor && `店家：${remote.vendor}`,
    remote.description,
    remote.reviewNote && `審核備註：${remote.reviewNote}`,
    `網頁申請：${remote.applicantEmail}`
  ].filter(Boolean).join("\n");
}

// A sheet claim as the ledger keeps it. 已付款 alone is not a payment: the payment needs a date
// and an account, so until one is recorded the claim stays approved and carries webPaid.
function ledgerClaim(remote) {
  const status = LEDGER_STATUS[remote.status];
  return {
    id: remote.id,
    source: "web",
    date: remote.date,
    person: remote.applicantName || remote.applicantEmail,
    title: remote.child,
    parent: remote.parent,
    child: remote.child,
    amount: Number(remote.amount),
    status: status === "paid" ? "approved" : status,
    paymentDate: "",
    paymentAccountId: "",
    receipt: remote.receiptLinks.join(" "),
    attachments: [],
    note: claimNote(remote)
  };
}

function isValidSheetClaim(remote) {
  return CLAIM_ID_PATTERN.test(remote.id) && LEDGER_STATUS[remote.status] && DATE_PATTERN.test(remote.date)
    && remote.amount > 0 && remote.parent && remote.child;
}

// Brings the claims sheet into the ledger: adds new claims, follows edits and review decisions on
// unpaid ones, drops withdrawn ones and moves unpaid claims deleted from the sheet to the trash.
// A paid claim keeps its amount and status, which came with the payment. Returns true on a change.
function mergeSheetClaims(ledger, remoteClaims = sheetClaims(), withdrawn = withdrawnClaimIds()) {
  const before = JSON.stringify(ledger);
  const trashed = new Set(ledger.trash.filter((item) => item.kind === "claim").map((item) => item.record && item.record.id));
  ledger.claims = ledger.claims.filter((claim) => !(claim.source === "web" && withdrawn.has(claim.id) && claim.status !== "paid"));

  const onSheet = new Set(remoteClaims.map((claim) => claim.id));
  const deletedAt = new Date().toISOString();
  ledger.claims = ledger.claims.filter((claim) => {
    const gone = claim.source === "web" && claim.status !== "paid" && !onSheet.has(claim.id);
    if (gone) ledger.trash.push({ id: Utilities.getUuid(), kind: "claim", deletedAt, record: claim });
    return !gone;
  });

  remoteClaims.filter(isValidSheetClaim).forEach((remote) => {
    let claim = ledger.claims.find((item) => item.id === remote.id);
    const fresh = ledgerClaim(remote);
    if (!claim) {
      if (trashed.has(remote.id)) return;
      claim = fresh;
      ledger.claims.push(claim);
    } else {
      const fields = claim.status === "paid"
        ? ["date", "parent", "child", "title", "note", "receipt"]
        : ["date", "amount", "parent", "child", "title", "note", "receipt", "status"];
      fields.forEach((field) => { claim[field] = fresh[field]; });
      // A paid claim's ledger expense carries its category, so keep the two in step.
      const entry = claim.status === "paid" && ledger.entries.find((item) => item.claimId === claim.id);
      if (entry) Object.assign(entry, { parent: claim.parent, child: claim.child, title: `報銷：${claim.title}` });
    }
    claim.webPaid = remote.status === STATUS_PAID && claim.status !== "paid";
  });
  return JSON.stringify(ledger) !== before;
}

// ---- Totals ----

function monthEnd(month) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

// Payment entries count only while their claim is paid.
function activeEntries(ledger) {
  const paid = new Set(ledger.claims.filter((claim) => claim.status === "paid").map((claim) => claim.id));
  return ledger.entries.filter((entry) => !entry.claimId || paid.has(entry.claimId));
}

function accountExistsAt(account, end) {
  const deleted = account.deletedAt ? String(account.deletedAt).slice(0, 10) : "";
  return (account.openingDate || "0001-01-01") <= end && (!deleted || end < deleted);
}

function accountBalance(account, entries, end) {
  const opening = account.openingDate || "0001-01-01";
  if (end < opening) return 0;
  return Number(account.openingBalance || 0) + entries
    .filter((entry) => entry.accountId === account.id && entry.date >= opening && entry.date <= end)
    .reduce((sum, entry) => sum + (entry.type === "income" ? 1 : -1) * Number(entry.amount), 0);
}

// The overview rows for one month, worked out the same way as the app's overview.
function summaryRows(ledger, month) {
  const end = monthEnd(month);
  const entries = activeEntries(ledger);
  const balance = ledger.accounts
    .filter((account) => accountExistsAt(account, end))
    .reduce((sum, account) => sum + accountBalance(account, entries, end), 0);
  const monthEntries = entries.filter((entry) => String(entry.date || "").startsWith(month));
  const income = monthEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const claimIds = new Set(ledger.claims.map((claim) => claim.id));
  const monthClaims = ledger.claims.filter((claim) => String(claim.date || "").startsWith(month));
  const byParent = {};
  const add = (label, amount) => { byParent[label || "未分類"] = (byParent[label || "未分類"] || 0) + Number(amount); };
  monthClaims.filter((claim) => claim.status !== "rejected").forEach((claim) => add(claim.parent, claim.amount));
  monthEntries.filter((entry) => entry.type === "expense" && (!entry.claimId || !claimIds.has(entry.claimId))).forEach((entry) => add(entry.parent, entry.amount));
  const expense = Object.values(byParent).reduce((sum, value) => sum + value, 0);
  const pending = monthClaims.filter((claim) => claim.status === "pending" || claim.status === "approved").reduce((sum, claim) => sum + Number(claim.amount), 0);
  return [
    { label: "帳面餘額", amount: balance },
    { label: "本月收入", amount: income },
    { label: "本月支出", amount: expense },
    { label: "待處理報銷", amount: pending },
    ...Object.entries(byParent).sort((a, b) => b[1] - a[1]).map(([label, amount]) => ({ label: label.slice(0, 30), amount }))
  ];
}

// ---- Desktop app ----

// The app's one sync call. It uploads its books when it has changes, then receives the current
// books with the claims sheet merged in. An upload based on an older version is refused and the
// reply says so; the app then takes the cloud copy.
function syncLedger(payload) {
  const baseVersion = Number.isInteger(payload.baseVersion) ? payload.baseVersion : -1;
  const upload = payload.ledger === undefined ? null : cleanLedger(payload.ledger);
  return withLock(() => {
    const doc = readLedger();
    let version = doc ? doc.version : 0;
    let ledger = doc ? doc.ledger : null;
    const conflict = Boolean(upload) && baseVersion !== version;
    if (upload && !conflict) {
      ledger = upload;
      version += 1;
    }
    if (ledger) {
      const merged = mergeSheetClaims(ledger);
      if (upload && !conflict) writeLedger(ledger, version);
      else if (merged) writeLedger(ledger, (version += 1));
    }
    return { version, ledger, conflict, categories: CATEGORIES };
  });
}

// ---- Treasurer on the web ----

function missingLedger() {
  return appError("not_found", "雲端帳本還沒建立，請先打開記帳 app 同步一次。");
}

// What the web's ledger page and payment form need: no QR images, bank numbers or people.
function ledgerView(doc) {
  const ledger = doc.ledger;
  return {
    version: doc.version,
    savedAt: doc.savedAt,
    entries: activeEntries(ledger).map((entry) => ({
      id: entry.id, date: entry.date, type: entry.type, parent: entry.parent, child: entry.child,
      amount: Number(entry.amount), accountId: entry.accountId, note: entry.note || "", claimId: entry.claimId || ""
    })),
    accounts: ledger.accounts.map((account) => ({
      id: account.id, name: account.name, type: account.type, openingDate: account.openingDate || "",
      openingBalance: Number(account.openingBalance || 0), deletedAt: account.deletedAt || ""
    })),
    payments: ledger.claims.filter((claim) => claim.status === "paid")
      .map((claim) => ({ id: claim.id, date: claim.paymentDate, accountId: claim.paymentAccountId })),
    lockedMonths: ledger.lockedMonths,
    categories: { income: INCOME_CATEGORIES, expense: CATEGORIES }
  };
}

function getLedger(user) {
  requireTreasurer(user);
  return withLock(() => {
    const doc = readLedger();
    if (!doc) throw missingLedger();
    return ledgerView(mergeSheetClaims(doc.ledger) ? writeLedger(doc.ledger, doc.version + 1) : doc);
  });
}

// Runs one change on the current books, merged with the sheet first, and saves them.
// Call inside withLock.
function changeLedger(change) {
  const doc = readLedger();
  if (!doc) throw missingLedger();
  mergeSheetClaims(doc.ledger);
  change(doc.ledger);
  return writeLedger(doc.ledger, doc.version + 1);
}

function affectsLockedBalance(ledger, date) {
  return ledger.lockedMonths.some((month) => date <= monthEnd(month));
}

function requireOpenDate(ledger, date) {
  if (affectsLockedBalance(ledger, date)) throw appError("invalid", "這個日期會影響已鎖定月份的帳面，請先在記帳 app 的「對帳」解鎖。");
}

function ledgerDate(value, label) {
  const date = typeof value === "string" ? value : "";
  if (!DATE_PATTERN.test(date) || date < LIMITS.earliestDate || date > Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd")) {
    throw appError("invalid", `${label}不正確，不能是未來的日期。`);
  }
  return date;
}

function usableAccount(ledger, accountId, date) {
  const account = ledger.accounts.find((item) => item.id === accountId && !item.deletedAt);
  if (!account) throw appError("invalid", "請選擇帳戶。");
  if (account.openingDate && date < account.openingDate) throw appError("invalid", `日期不能早於「${account.name}」的期初日期 ${account.openingDate}。`);
  return account;
}

function saveEntry(user, payload) {
  requireTreasurer(user);
  const input = payload.entry && typeof payload.entry === "object" ? payload.entry : {};
  const type = input.type === "income" || input.type === "expense" ? input.type : "";
  if (!type) throw appError("invalid", "請選擇收入或支出。");
  const date = ledgerDate(input.date, "日期");
  const parent = requiredText(input.parent, LIMITS.category, "主項目", true);
  const child = requiredText(input.child, LIMITS.category, "副項目", true);
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > LIMITS.amount) throw appError("invalid", "金額需為正整數。");
  const note = requiredText(input.note, LIMITS.description, "備註", false);
  let saved = null;
  const doc = withLock(() => changeLedger((ledger) => {
    const existing = input.id ? ledger.entries.find((entry) => entry.id === input.id) : null;
    if (input.id && !existing) throw appError("not_found", "找不到這筆紀錄，可能已被刪除。");
    if (existing && existing.claimId) throw appError("invalid", "這筆支出由報銷付款產生，請到審核報帳處理。");
    if (existing) requireOpenDate(ledger, existing.date);
    requireOpenDate(ledger, date);
    const account = usableAccount(ledger, input.accountId, date);
    saved = {
      ...(existing || {}),
      id: existing ? existing.id : Utilities.getUuid(),
      date,
      type,
      title: existing && existing.parent === parent && existing.child === child ? existing.title : child,
      parent,
      child,
      amount,
      method: account.type === "cash" ? "現金" : "轉帳",
      accountId: account.id,
      note
    };
    if (existing) ledger.entries[ledger.entries.indexOf(existing)] = saved;
    else ledger.entries.push(saved);
  }));
  return ledgerView(doc);
}

// Deleted entries go to the app's trash, where they can be restored for 30 days.
function trashEntry(user, payload) {
  requireTreasurer(user);
  const doc = withLock(() => changeLedger((ledger) => {
    const entry = ledger.entries.find((item) => item.id === payload.id);
    if (!entry) throw appError("not_found", "找不到這筆紀錄，可能已被刪除。");
    if (entry.claimId) throw appError("invalid", "這筆支出由報銷付款產生，請到審核報帳處理。");
    requireOpenDate(ledger, entry.date);
    ledger.trash.push({ id: Utilities.getUuid(), kind: "entry", deletedAt: new Date().toISOString(), record: entry });
    ledger.entries = ledger.entries.filter((item) => item !== entry);
  }));
  return ledgerView(doc);
}

// Records the payment of a claim: an expense entry on the chosen account, and 已付款 on the sheet.
function payClaim(user, payload) {
  requireTreasurer(user);
  const date = ledgerDate(payload.date, "付款日期");
  const note = requiredText(payload.note, LIMITS.description, "審核備註", false);
  const doc = withLock(() => {
    const rows = dataRows(CLAIM_SHEET, CLAIM_HEADER.length);
    const index = rows.findIndex((row) => cellText(row[COL["id"]]) === payload.id);
    if (!payload.id || index < 0) throw missingClaim();
    const saved = changeLedger((ledger) => {
      const claim = ledger.claims.find((item) => item.id === payload.id);
      if (!claim) throw missingClaim();
      if (claim.status === "paid") throw appError("invalid", "這筆申請已經記錄付款。");
      requireOpenDate(ledger, date);
      const account = usableAccount(ledger, payload.accountId, date);
      let entry = ledger.entries.find((item) => item.claimId === claim.id);
      if (!entry) {
        entry = { id: Utilities.getUuid(), claimId: claim.id };
        ledger.entries.push(entry);
      }
      Object.assign(entry, {
        date,
        type: "expense",
        title: `報銷：${claim.title}`,
        parent: claim.parent,
        child: claim.child,
        amount: Number(claim.amount),
        method: account.type === "cash" ? "現金" : "轉帳",
        accountId: account.id,
        note: `${claim.person}｜${claim.receipt || "無憑證註記"}`
      });
      Object.assign(claim, { status: "paid", paymentDate: date, paymentAccountId: account.id, webPaid: false });
    });
    setSheetStatus(index, STATUS_PAID, user.email, note);
    appendLog(user.email, "payClaim", payload.id);
    return saved;
  });
  return ledgerView(doc);
}

// Undoes a recorded payment when the treasurer moves a paid claim to another status: the expense
// entry goes and the claim takes the new status. Call inside withLock.
function revokePayment(id, target) {
  const doc = readLedger();
  const claim = doc && doc.ledger.claims.find((item) => item.id === id);
  if (!claim || claim.status !== "paid") return;
  if (claim.paymentDate) requireOpenDate(doc.ledger, claim.paymentDate);
  doc.ledger.entries = doc.ledger.entries.filter((entry) => entry.claimId !== id);
  Object.assign(claim, { status: LEDGER_STATUS[target], paymentDate: "", paymentAccountId: "" });
  writeLedger(doc.ledger, doc.version + 1);
}
