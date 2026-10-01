const storageKey = "dessertTreasurer.v1";
const tauriInvoke = window.__TAURI__?.core?.invoke;
const webKitTreasury = window.webkit?.messageHandlers?.treasury;
const tauriStorageEnabled = typeof tauriInvoke === "function";
const nativeStorageEnabled = tauriStorageEnabled || Boolean(webKitTreasury);
const tauriCommandNames = {
  loadState: "load_state",
  saveState: "save_state",
  storeReceipts: "store_receipts",
  getReceipt: "get_receipt",
  getAllReceipts: "get_all_receipts",
  deleteReceipts: "delete_receipts",
  clearReceipts: "clear_receipts",
  importReceipts: "import_receipts",
  printMonthlyReport: "print_monthly_report",
  openExternalUrl: "open_external_url",
  parseMemberSpreadsheet: "parse_member_spreadsheet",
  importMemberSpreadsheetUrl: "import_member_spreadsheet_url"
};
const nativeStorageCall = (action, payload = {}) => {
  if (!nativeStorageEnabled) return Promise.reject(new Error("native storage unavailable"));
  if (tauriStorageEnabled) return tauriInvoke(tauriCommandNames[action] || action, payload);
  return webKitTreasury.postMessage({ action, ...payload });
};
const categories = {
  income: {
    "社費與會費": ["期初社費", "單次活動費", "補繳"],
    "活動收入": ["工作坊報名費", "市集收入", "甜點販售"],
    "補助與贊助": ["學校補助", "系學會補助", "外部贊助"],
    "退款與調整": ["押金退回", "廠商退款", "帳務調整"]
  },
  expense: {
    "食材與耗材": ["乳品", "蛋與油脂", "粉類", "糖與巧克力", "水果與餡料", "包材"],
    "器具與設備": ["烤模", "量測工具", "小型器具", "設備維修"],
    "活動與課程": ["講師費", "場地費", "佈置", "交通搬運"],
    "行政庶務": ["文具印刷", "平台手續費", "保險", "雜支"],
    "退款與調整": ["退費", "差額補款", "帳務調整"]
  }
};

const statusText = {
  pending: "待審核",
  approved: "已核准",
  paid: "已付款",
  rejected: "退回"
};

const sectionMeta = {
  overview: ["總覽", "依月份查看收支、報銷流程與最近 30 天紀錄。"],
  ledger: ["記帳", "新增收入支出，並依分類或日期查詢紀錄。"],
  reimburse: ["報銷", "追蹤代墊申請、憑證與付款狀態。"],
  accounts: ["對帳", "管理現金與銀行帳戶，完成每月餘額核對。"],
  people: ["人員", "管理社員名單、活動參加與繳費狀態。"],
  categories: ["分類", "依甜點社常見情境整理主項目與副項目。"],
  trash: ["垃圾桶", "刪除項目保留 30 天，可在到期前還原。"],
  backup: ["備份", "以 JSON 或 CSV 下載、還原帳務資料。"],
  settings: ["設定", "管理匯入試算表時可辨識的欄位同義詞。"]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const fmt = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
const dayMs = 24 * 60 * 60 * 1000;
const retentionDays = 30;
const receiptDbName = "dessertTreasurer.receipts.v1";
const receiptStoreName = "receipts";
const accountTypeText = { cash: "現金", bank: "銀行帳戶", other: "其他" };

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = () => dateKey();
const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const accountDigits = (value) => String(value || "").replace(/\D/g, "").slice(0, 14);
const normalizeStudentId = (value) => String(value || "").trim().toLocaleUpperCase("en-US").slice(0, 30);
const normalizeEmail = (value) => {
  const email = String(value || "").trim().toLocaleLowerCase("en-US").slice(0, 160);
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};
const normalizeMemberImportLink = (value) => {
  const link = String(value || "").trim().slice(0, 2048);
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.hostname && url.hostname !== "localhost" && !url.hostname.endsWith(".local") ? link : "";
  } catch {
    return "";
  }
};

const hasLegacyPersonGrades = (saved) => Array.isArray(saved?.people) && saved.people.some((person) => Object.hasOwn(person || {}, "grade"));

function cloudLinkUrl(value) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function claimReceiptMarkup(receipt) {
  const url = cloudLinkUrl(receipt);
  return url
    ? `<a class="cloud-link" href="${escapeHtml(url)}" data-open-cloud-link="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}">雲端連結</a>`
    : escapeHtml(receipt || "");
}

async function openCloudLink(url) {
  if (!cloudLinkUrl(url)) return toast("這不是有效的雲端連結。", "error");
  try {
    if (tauriStorageEnabled) await nativeStorageCall("openExternalUrl", { url });
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    toast("無法開啟雲端連結，請確認預設瀏覽器設定。", "error");
  }
}

function defaultAccounts() {
  return [
    { id: "cash", name: "現金", type: "cash", accountNumber: "", qrCodeDataUrl: "", qrCodeName: "", openingDate: today(), openingBalance: 0, active: true },
    { id: "club-bank", name: "社團帳戶", type: "bank", accountNumber: "", qrCodeDataUrl: "", qrCodeName: "", openingDate: today(), openingBalance: 0, active: true }
  ];
}

function normalizeState(saved = {}) {
  const accounts = Array.isArray(saved.accounts) && saved.accounts.length
    ? saved.accounts.map((account) => ({
        ...account,
        accountNumber: accountDigits(account.accountNumber),
        qrCodeDataUrl: /^data:image\/(png|jpeg|webp|gif);base64,/i.test(account.qrCodeDataUrl || "") ? account.qrCodeDataUrl : "",
        qrCodeName: String(account.qrCodeName || ""),
        openingDate: isValidDateValue(account.openingDate) ? account.openingDate : "",
        openingBalance: Number(account.openingBalance) || 0,
        active: !account.deletedAt
      }))
    : defaultAccounts();
  const accountIds = new Set(accounts.map((account) => account.id));
  const fallbackAccountId = accounts.find((account) => account.active)?.id || accounts[0].id;
  const normalizeEntry = (entry) => ({
    ...entry,
    method: entry.method === "社團帳戶" ? "轉帳" : entry.method,
    accountId: accountIds.has(entry.accountId)
      ? entry.accountId
      : entry.method === "現金" && accountIds.has("cash")
        ? "cash"
        : accountIds.has("club-bank")
          ? "club-bank"
          : fallbackAccountId
  });
  const entries = Array.isArray(saved.entries) ? saved.entries.map(normalizeEntry) : [];
  accounts.forEach((account) => {
    if (account.openingDate) return;
    const earliestEntry = entries
      .filter((entry) => entry.accountId === account.id && isValidDateValue(entry.date))
      .map((entry) => entry.date)
      .sort()[0];
    account.openingDate = earliestEntry || today();
  });
  const normalizeClaim = (claim, linkedOverride) => {
    const linkedEntry = linkedOverride || entries.find((entry) => entry.claimId === claim.id);
    const hasPayment = claim.status === "paid" && linkedEntry;
    return {
      ...claim,
      status: claim.status === "paid" && !hasPayment ? "approved" : claim.status,
      paymentDate: hasPayment ? (claim.paymentDate || linkedEntry.date || claim.date) : "",
      paymentAccountId: hasPayment ? (claim.paymentAccountId || linkedEntry.accountId || "") : "",
      attachments: Array.isArray(claim.attachments) ? claim.attachments : []
    };
  };
  const claims = Array.isArray(saved.claims) ? saved.claims.map(normalizeClaim) : [];
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  entries.forEach((entry) => {
    if (!entry.claimId) return;
    const claim = claimsById.get(entry.claimId);
    if (!claim || claim.status !== "paid") return;
    const accountId = accountIds.has(claim.paymentAccountId) ? claim.paymentAccountId : entry.accountId;
    Object.assign(entry, {
      date: claim.paymentDate || entry.date || claim.date,
      type: "expense",
      title: `報銷：${claim.title}`,
      parent: claim.parent,
      child: claim.child,
      amount: Number(claim.amount),
      method: accounts.find((account) => account.id === accountId)?.type === "cash" ? "現金" : "轉帳",
      accountId,
      note: `${claim.person}｜${claim.receipt || "無憑證註記"}`
    });
  });
  const trash = Array.isArray(saved.trash) ? saved.trash.map((item) => ({
    ...item,
    record: item.kind === "entry"
      ? normalizeEntry(item.record || {})
      : normalizeClaim(item.record || {}, item.linkedEntry),
    linkedEntry: item.linkedEntry ? normalizeEntry(item.linkedEntry) : undefined
  })) : [];
  const payees = Array.isArray(saved.payees) ? saved.payees.map((payee) => ({
    id: String(payee.id || uid()),
    name: String(payee.name || "").slice(0, 160),
    bank: String(payee.bank || "").slice(0, 160),
    accountNumber: accountDigits(payee.accountNumber),
    qrCodeDataUrl: /^data:image\/(png|jpeg|webp|gif);base64,/i.test(payee.qrCodeDataUrl || "") ? payee.qrCodeDataUrl : "",
    qrCodeName: String(payee.qrCodeName || "").slice(0, 500)
  })).filter((payee) => payee.name && payee.accountNumber) : [];
  const people = Array.isArray(saved.people) ? saved.people.map((person) => ({
    id: String(person.id || uid()),
    name: String(person.name || "").trim().slice(0, 80),
    studentId: normalizeStudentId(person.studentId),
    department: String(person.department || "").trim().slice(0, 100),
    email: normalizeEmail(person.email)
  })).filter((person) => person.name && person.studentId) : [];
  const personIds = new Set(people.map((person) => person.id));
  const activities = Array.isArray(saved.activities) ? saved.activities.map((activity) => {
    const seen = new Set();
    const attendance = Array.isArray(activity.attendance) ? activity.attendance
      .filter((item) => item && personIds.has(item.personId) && !seen.has(item.personId) && ["attending", "not_attending"].includes(item.status) && seen.add(item.personId))
      .map((item) => ({
        personId: item.personId,
        status: item.status,
        paid: item.status === "attending" && Boolean(item.paid),
        paidAt: item.status === "attending" && Boolean(item.paid) ? normalizePaymentTime(item.paidAt) : ""
      })) : [];
    const importLinkUrl = normalizeMemberImportLink(activity.importLink?.url);
    return {
      id: String(activity.id || uid()),
      name: String(activity.name || "").trim().slice(0, 160),
      date: isValidDateValue(activity.date) ? activity.date : today(),
      fee: Math.max(0, Number(activity.fee) || 0),
      note: String(activity.note || "").trim().slice(0, 500),
      attendance,
      rosterOrder: Array.isArray(activity.rosterOrder)
        ? [...new Set(activity.rosterOrder.filter((personId) => personIds.has(personId)))]
        : [],
      importLink: importLinkUrl
        ? { url: importLinkUrl, lastSyncedAt: typeof activity.importLink?.lastSyncedAt === "string" ? activity.importLink.lastSyncedAt : "" }
        : null
    };
  }).filter((activity) => activity.name) : [];
  const memberImportLinkUrl = normalizeMemberImportLink(saved.memberImportLink?.url);
  const memberImportLink = memberImportLinkUrl
    ? {
        url: memberImportLinkUrl,
        lastSyncedAt: typeof saved.memberImportLink?.lastSyncedAt === "string" ? saved.memberImportLink.lastSyncedAt : ""
      }
    : null;
  const normalizeSynonymList = (value) => Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim().slice(0, 100)).filter((item) => item && normalizeImportHeader(item)))].slice(0, 30)
    : [];
  const importSynonyms = {
    mode: saved.importSynonyms?.mode === "editable" ? "editable" : "legacy",
    people: {
      name: normalizeSynonymList(saved.importSynonyms?.people?.name),
      studentId: normalizeSynonymList(saved.importSynonyms?.people?.studentId),
      department: normalizeSynonymList(saved.importSynonyms?.people?.department),
      email: normalizeSynonymList(saved.importSynonyms?.people?.email)
    },
    activity: {
      attendance: normalizeSynonymList(saved.importSynonyms?.activity?.attendance),
      payment: normalizeSynonymList(saved.importSynonyms?.activity?.payment),
      paidAt: normalizeSynonymList(saved.importSynonyms?.activity?.paidAt)
    }
  };

  return {
    entries,
    claims,
    trash,
    accounts,
    payees,
    people,
    activities,
    memberImportLink,
    importSynonyms,
    reconciliations: Array.isArray(saved.reconciliations) ? saved.reconciliations : [],
    lastBackupAt: typeof saved.lastBackupAt === "string" ? saved.lastBackupAt : "",
    lockedMonths: Array.isArray(saved.lockedMonths) ? [...new Set(saved.lockedMonths)] : []
  };
}

function loadState() {
  try {
    if (!tauriStorageEnabled && nativeStorageEnabled && window.__nativeInitialState && typeof window.__nativeInitialState === "object") {
      return normalizeState(window.__nativeInitialState);
    }
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return normalizeState(saved);
  } catch {
    return normalizeState();
  }
}

function normalizeSearchValue(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/\s+/g, " ").trim();
}

function matchesSearch(values, query) {
  const terms = normalizeSearchValue(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const searchable = normalizeSearchValue(values.join(" "));
  return terms.every((term) => searchable.includes(term));
}

let state = loadState();
let selectedMonth = today().slice(0, 7);
let displayedYear = Number(selectedMonth.slice(0, 4));
let selectedExportFormat = "json";
let removeAccountQr = false;
let pendingAccountQrDataUrl = "";
let removePayeeQr = false;
let pendingPayeeQrDataUrl = "";
let attachmentPreviewUrl = "";
let pendingAppAction = null;
let calendarTarget = null;
let calendarMonth = new Date();
let calendarMode = "days";
let monthlyReportPrintActive = false;
let nativeSaveQueue = Promise.resolve();
let selectedTrashIds = new Set();
let trashPurgeTimer = null;
let rosterPointerDrag = null;
let pendingPersonImport = null;
let pendingActivityImport = null;
let memberImportSyncing = false;
let activityImportSyncing = new Set();

