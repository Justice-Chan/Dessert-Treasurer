// Dessert Treasurer claims backend (Google Apps Script web app).
//
// Script Properties (Project Settings > Script Properties), never in code:
//   OAUTH_CLIENT_ID  Google OAuth client ID used by web/ for sign-in
//   SHEET_ID         Spreadsheet holding the tabs below
//   DRIVE_FOLDER_ID  Drive folder holding the monthly (YYYY-MM) receipt folders
//
// 權限表 is maintained by hand. The other tabs are created and written by this script.

const TIME_ZONE = "Asia/Taipei";
const PERMISSION_SHEET = "權限表";
const LOG_SHEET = "操作紀錄";
const LOG_HEADER = ["時間", "操作者 email", "動作", "目標 id"];
const CLAIM_SHEET = "報帳申請";
const CLAIM_HEADER = [
  "id", "建立時間", "申請人 email", "申請人姓名", "消費日期", "金額", "主項目", "副項目", "活動／社課",
  "店家", "說明", "附件", "狀態", "審核人", "審核時間", "審核備註", "更新時間"
];
const COL = Object.fromEntries(CLAIM_HEADER.map((name, index) => [name, index]));
const SUMMARY_SHEET = "財務彙總";
const SUMMARY_HEADER = ["項目", "金額"];

const ROLES = { "總務": "treasurer", "幹部": "officer" };
const TOKEN_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const STATUS_PENDING = "待審核";
const STATUS_REJECTED = "退回";
// A claim can be withdrawn until it is approved; afterwards the treasurer handles it.
const WITHDRAWABLE = [STATUS_PENDING, STATUS_REJECTED];
const OTHER_CATEGORY = "其他";

// Mirrors the expense categories in frontend/js/core/state.js so synced claims fit the app.
const CATEGORIES = {
  "食材與耗材": ["乳品", "蛋與油脂", "粉類", "糖與巧克力", "水果與餡料", "包材"],
  "器具與設備": ["烤模", "量測工具", "小型器具", "設備維修"],
  "活動與課程": ["講師費", "場地費", "佈置", "交通搬運"],
  "行政庶務": ["文具印刷", "平台手續費", "保險", "雜支"],
  "退款與調整": ["退費", "差額補款", "帳務調整"]
};

const LIMITS = {
  amount: 1000000,
  category: 30,
  shortText: 60,
  description: 300,
  files: 5,
  fileBytes: 5 * 1024 * 1024,
  earliestDate: "2020-01-01"
};

// Extension and leading bytes per accepted type; the declared type alone is not trusted.
const FILE_TYPES = {
  "image/jpeg": { extension: "jpg", matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  "image/png": { extension: "png", matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) },
  "image/heic": { extension: "heic", matches: (bytes) => startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) },
  "application/pdf": { extension: "pdf", matches: (bytes) => startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) }
};

const ACTIONS = {
  whoami: (user) => ({
    ...user,
    categories: CATEGORIES,
    limits: { files: LIMITS.files, fileBytes: LIMITS.fileBytes, category: LIMITS.category }
  }),
  submitRequest,
  listMyRequests,
  withdrawRequest,
  getSummary
};

function doPost(e) {
  try {
    const request = parseRequest(e);
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, request.action) ? ACTIONS[request.action] : null;
    if (!handler) throw appError("bad_request", "不支援的操作。");
    const user = authorize(request.idToken);
    const payload = request.payload && typeof request.payload === "object" ? request.payload : {};
    return respond({ ok: true, data: handler(user, payload) });
  } catch (error) {
    if (!error.code) console.error(error);
    return respond({
      ok: false,
      error: {
        code: error.code || "internal",
        message: error.code ? error.message : "系統發生錯誤，請稍後再試或聯絡總務。"
      }
    });
  }
}

function parseRequest(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    if (request && typeof request === "object") return request;
  } catch (error) {
    // fall through to the shared error below
  }
  throw appError("bad_request", "請求格式不正確。");
}

function respond(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function appError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function property(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`Missing script property: ${name}`);
  return value;
}

// Run from the Apps Script editor after any setup change. It exercises every permission
// the web app needs, so a missing grant shows up here instead of as a failed request.
function checkSetup() {
  const checks = {
    "OAUTH_CLIENT_ID 已設定": () => property("OAUTH_CLIENT_ID") && "OK",
    "試算表可開啟": () => spreadsheet().getName(),
    "權限表分頁存在": () => {
      if (!spreadsheet().getSheetByName(PERMISSION_SHEET)) throw new Error(`找不到「${PERMISSION_SHEET}」分頁`);
      return "OK";
    },
    "收據資料夾可開啟": () => DriveApp.getFolderById(property("DRIVE_FOLDER_ID")).getName(),
    "可連線到 Google 登入驗證": () => {
      UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=x", { muteHttpExceptions: true });
      return "OK";
    }
  };
  Object.entries(checks).forEach(([label, check]) => {
    try {
      console.log(`✅ ${label}：${check()}`);
    } catch (error) {
      console.log(`❌ ${label}：${error.message}`);
    }
  });
}

// ---- Identity and roles ----

// Identity comes only from a Google-verified ID token; the caller cannot supply an email.
function verifyIdToken(idToken) {
  if (typeof idToken !== "string" || !idToken || idToken.length > 4096) throw appError("unauthenticated", "請重新登入。");
  const response = UrlFetchApp.fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) throw appError("unauthenticated", "登入已過期，請重新登入。");
  const claims = JSON.parse(response.getContentText());
  const valid = claims.aud === property("OAUTH_CLIENT_ID")
    && TOKEN_ISSUERS.includes(claims.iss)
    && Number(claims.exp) * 1000 > Date.now()
    && String(claims.email_verified) === "true"
    && claims.email;
  if (!valid) throw appError("unauthenticated", "登入已過期，請重新登入。");
  return String(claims.email).trim().toLowerCase();
}

function authorize(idToken) {
  const email = verifyIdToken(idToken);
  const tab = spreadsheet().getSheetByName(PERMISSION_SHEET);
  if (!tab) throw new Error(`Missing sheet: ${PERMISSION_SHEET}`);
  const row = tab.getDataRange().getValues().slice(1)
    .find((cells) => String(cells[0]).trim().toLowerCase() === email);
  const role = row ? ROLES[String(row[1]).trim()] : null;
  if (!role) throw appError("unauthorized", "無權限，請聯絡總務。");
  return { email, role, name: String(row[2] || "").trim() };
}

// ---- Sheet access ----

let cachedSpreadsheet = null;
function spreadsheet() {
  if (!cachedSpreadsheet) cachedSpreadsheet = SpreadsheetApp.openById(property("SHEET_ID"));
  return cachedSpreadsheet;
}

// Script-written tabs are plain text so dates and IDs are stored exactly as sent.
// Only create a tab while holding the lock.
function tab(name, header, create) {
  let sheet = spreadsheet().getSheetByName(name);
  if (!sheet && create) {
    sheet = spreadsheet().insertSheet(name);
    sheet.getRange(1, 1, sheet.getMaxRows(), header.length).setNumberFormat("@");
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function dataRows(name, width) {
  const sheet = tab(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
}

function cellText(value) {
  if (value instanceof Date) return Utilities.formatDate(value, TIME_ZONE, "yyyy-MM-dd");
  return String(value === null || value === undefined ? "" : value).trim();
}

// A leading = + - @ would be read as a formula; the apostrophe keeps it literal.
function safeCell(value) {
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function withLock(task) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw appError("busy", "系統忙碌中，請稍後再試。");
  try {
    return task();
  } finally {
    lock.releaseLock();
  }
}

// Call inside withLock.
function appendLog(email, action, targetId) {
  tab(LOG_SHEET, LOG_HEADER, true).appendRow([new Date().toISOString(), email, action, targetId].map(safeCell));
}

// ---- Claims ----

function requiredText(value, max, label, required) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw appError("invalid", `請填寫${label}。`);
  if (text.length > max) throw appError("invalid", `${label}最多 ${max} 個字。`);
  return text;
}

function validateClaim(payload) {
  const date = typeof payload.date === "string" ? payload.date : "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw appError("invalid", "請填寫正確的消費日期。");
  }
  const today = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
  if (date > today || date < LIMITS.earliestDate) throw appError("invalid", "消費日期不能是未來，也不能太久以前。");

  const amount = payload.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > LIMITS.amount) {
    throw appError("invalid", `金額必須是 1 到 ${LIMITS.amount} 之間的整數。`);
  }

  // Like the desktop app, a category may be one of CATEGORIES or free text typed under 其他.
  const parent = requiredText(payload.parent, LIMITS.category, "主項目", true);
  const child = requiredText(payload.child, LIMITS.category, "副項目", true);
  if (parent === OTHER_CATEGORY || child === OTHER_CATEGORY) throw appError("invalid", "選擇「其他」時請填寫自訂項目名稱。");

  return {
    date,
    amount,
    parent,
    child,
    activity: requiredText(payload.activity, LIMITS.shortText, "活動／社課", false),
    vendor: requiredText(payload.vendor, LIMITS.shortText, "店家", false),
    description: requiredText(payload.description, LIMITS.description, "說明", false)
  };
}

function startsWith(bytes, signature, offset) {
  const start = offset || 0;
  return bytes.length >= start + signature.length
    && signature.every((value, index) => (bytes[start + index] & 0xff) === value);
}

function decodeAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) throw appError("invalid", "請至少附上一張收據照片。");
  if (attachments.length > LIMITS.files) throw appError("invalid", `一次最多上傳 ${LIMITS.files} 個附件。`);
  return attachments.map((attachment) => {
    const type = attachment && Object.prototype.hasOwnProperty.call(FILE_TYPES, attachment.type) ? FILE_TYPES[attachment.type] : null;
    if (!type || typeof attachment.data !== "string") throw appError("invalid", "附件只接受 JPG、PNG、HEIC 或 PDF。");
    if (attachment.data.length * 0.75 > LIMITS.fileBytes) throw appError("invalid", "照片太大，請壓縮後再上傳。");
    let bytes;
    try {
      bytes = Utilities.base64Decode(attachment.data);
    } catch (error) {
      throw appError("invalid", "附件讀取失敗，請重新選擇檔案。");
    }
    if (!type.matches(bytes)) throw appError("invalid", "附件只接受 JPG、PNG、HEIC 或 PDF。");
    return { bytes, mimeType: attachment.type, extension: type.extension };
  });
}

// Receipts are filed by submission month (YYYY-MM) under the configured folder.
// Call inside withLock so two submissions cannot create the same folder twice.
function monthFolder(month) {
  const root = DriveApp.getFolderById(property("DRIVE_FOLDER_ID"));
  const matches = root.getFoldersByName(month);
  while (matches.hasNext()) {
    const folder = matches.next();
    if (!folder.isTrashed()) return folder;
  }
  return root.createFolder(month);
}

function submitRequest(user, payload) {
  const claim = validateClaim(payload);
  const files = decodeAttachments(payload.attachments);
  const id = Utilities.getUuid();
  const now = new Date().toISOString();
  const owner = (user.name || user.email.split("@")[0]).replace(/[^\p{L}\p{N}_-]/gu, "") || "applicant";
  const folder = withLock(() => monthFolder(Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM")));
  const created = [];
  try {
    files.forEach((file, index) => {
      const name = `${claim.date}_${owner}_${id}_${index + 1}.${file.extension}`;
      created.push(folder.createFile(Utilities.newBlob(file.bytes, file.mimeType, name)));
    });
    withLock(() => {
      const row = [];
      row[COL["id"]] = id;
      row[COL["建立時間"]] = now;
      row[COL["申請人 email"]] = user.email;
      row[COL["申請人姓名"]] = user.name;
      row[COL["消費日期"]] = claim.date;
      row[COL["金額"]] = claim.amount;
      row[COL["主項目"]] = claim.parent;
      row[COL["副項目"]] = claim.child;
      row[COL["活動／社課"]] = claim.activity;
      row[COL["店家"]] = claim.vendor;
      row[COL["說明"]] = claim.description;
      row[COL["附件"]] = created.map((file) => file.getId()).join(",");
      row[COL["狀態"]] = STATUS_PENDING;
      row[COL["審核人"]] = "";
      row[COL["審核時間"]] = "";
      row[COL["審核備註"]] = "";
      row[COL["更新時間"]] = now;
      tab(CLAIM_SHEET, CLAIM_HEADER, true).appendRow(row.map(safeCell));
      appendLog(user.email, "submitRequest", id);
    });
  } catch (error) {
    created.forEach((file) => {
      try { file.setTrashed(true); } catch (cleanupError) { console.error(cleanupError); }
    });
    throw error;
  }
  return { id };
}

function listMyRequests(user) {
  return dataRows(CLAIM_SHEET, CLAIM_HEADER.length)
    .filter((row) => cellText(row[COL["申請人 email"]]).toLowerCase() === user.email)
    .map((row) => ({
      id: cellText(row[COL["id"]]),
      createdAt: cellText(row[COL["建立時間"]]),
      date: cellText(row[COL["消費日期"]]),
      amount: Number(row[COL["金額"]]) || 0,
      parent: cellText(row[COL["主項目"]]),
      child: cellText(row[COL["副項目"]]),
      activity: cellText(row[COL["活動／社課"]]),
      vendor: cellText(row[COL["店家"]]),
      description: cellText(row[COL["說明"]]),
      attachmentCount: cellText(row[COL["附件"]]).split(",").filter(Boolean).length,
      status: cellText(row[COL["狀態"]]),
      canWithdraw: WITHDRAWABLE.includes(cellText(row[COL["狀態"]])),
      reviewNote: cellText(row[COL["審核備註"]])
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Removes the claim row and moves its receipts to the Drive trash (recoverable for 30 days).
// The log row is the only remaining trace, and tells the app sync which id disappeared.
function withdrawRequest(user, payload) {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const missing = () => appError("not_found", "找不到這筆申請，可能已經被撤銷。");
  if (!id) throw missing();
  const fileIds = withLock(() => {
    const rows = dataRows(CLAIM_SHEET, CLAIM_HEADER.length);
    const index = rows.findIndex((row) => cellText(row[COL["id"]]) === id);
    const row = rows[index];
    const allowed = row && (user.role === "treasurer" || cellText(row[COL["申請人 email"]]).toLowerCase() === user.email);
    if (!allowed) throw missing();
    if (!WITHDRAWABLE.includes(cellText(row[COL["狀態"]]))) {
      throw appError("invalid", "已核准或已付款的申請不能撤銷，請聯絡總務。");
    }
    tab(CLAIM_SHEET).deleteRow(index + 2);
    appendLog(user.email, "withdrawRequest", id);
    return cellText(row[COL["附件"]]).split(",").filter(Boolean);
  });
  fileIds.forEach((fileId) => {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (error) { console.error(error); }
  });
  return { id };
}

// Totals only; the summary tab must never hold personal data.
function getSummary() {
  return {
    items: dataRows(SUMMARY_SHEET, SUMMARY_HEADER.length)
      .map((row) => ({ label: cellText(row[0]), amount: Number(row[1]) }))
      .filter((item) => item.label && Number.isFinite(item.amount))
  };
}
