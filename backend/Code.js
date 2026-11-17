// Dessert Treasurer claims backend (Google Apps Script web app).
//
// Script Properties (Project Settings > Script Properties), never in code:
//   OAUTH_CLIENT_ID  Google OAuth client ID used by web/ for sign-in
//   SHEET_ID         Spreadsheet holding the tabs below
//   DRIVE_FOLDER_ID  Drive folder holding the monthly (YYYY-MM) receipt folders
//   SYNC_SECRET      Long random string the desktop app sends for syncPull and syncPush
//
// 權限表 is maintained by hand: email, position (職位), name and a free-text note the script never reads.
// Position 總務 gets the treasurer's rights; any other position is an officer. The other tabs are created
// and written by this script.

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

const TREASURER_POSITION = "總務";
const TOKEN_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const STATUS_PENDING = "待審核";
const STATUS_APPROVED = "已核准";
const STATUS_REJECTED = "退回";
// A claim can be withdrawn until it is approved; afterwards the treasurer handles it.
const WITHDRAWABLE = [STATUS_PENDING, STATUS_REJECTED];
// The applicant may change anything on their claim, except the amount once it has been paid.
const STATUS_PAID = "已付款";
// The treasurer may move a claim to any of these. 已付款 here is a marker only: the app still
// records the payment itself, and its sync reminds the treasurer to do so.
const REVIEW_STATUSES = [STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED, STATUS_PAID];
const OTHER_CATEGORY = "其他";

// Mirrors the expense categories in frontend/js/core/state.js so synced claims fit the app.
const CATEGORIES = {
  "食材與耗材": ["乳品", "蛋與油脂", "粉類", "糖與巧克力", "餡料與醬", "包材"],
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
  editRequest,
  getAttachment,
  listAllRequests,
  reviewRequest,
  getSummary,
  listActivities
};

// Called by the desktop app with SYNC_SECRET instead of a Google sign-in.
const SYNC_ACTIONS = { syncPull, syncPush };
const SYNCED_AT_PROPERTY = "SUMMARY_SYNCED_AT";
const SYNC_LIMITS = { summaryRows: 50, label: 30, amount: 100000000 };

function doPost(e) {
  try {
    const request = parseRequest(e);
    const payload = request.payload && typeof request.payload === "object" ? request.payload : {};
    if (Object.prototype.hasOwnProperty.call(SYNC_ACTIONS, request.action)) {
      verifySyncSecret(request.secret);
      return respond({ ok: true, data: SYNC_ACTIONS[request.action](payload) });
    }
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, request.action) ? ACTIONS[request.action] : null;
    if (!handler) throw appError("bad_request", "不支援的操作。");
    const user = authorize(request.idToken);
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
    "每月備份已排程": () => {
      if (!ScriptApp.getProjectTriggers().some((trigger) => trigger.getHandlerFunction() === "monthlyBackup")) throw new Error("請執行 setupMonthlyBackup");
      return "OK";
    },
    "SYNC_SECRET 已設定且夠長": () => {
      if (property("SYNC_SECRET").length < 32) throw new Error("至少需要 32 個字元");
      return "OK";
    },
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

function permissionRows() {
  const tab = spreadsheet().getSheetByName(PERMISSION_SHEET);
  if (!tab) throw new Error(`Missing sheet: ${PERMISSION_SHEET}`);
  return tab.getDataRange().getValues().slice(1);
}

function positionOf(row) {
  return String(row[1] || "").trim();
}

function authorize(idToken) {
  const email = verifyIdToken(idToken);
  const row = permissionRows().find((cells) => String(cells[0]).trim().toLowerCase() === email);
  // A listed email with any position may sign in; only 總務 may review.
  const position = row ? positionOf(row) : "";
  if (!position) throw appError("unauthorized", "無權限，請聯絡總務。");
  const role = position === TREASURER_POSITION ? "treasurer" : "officer";
  return { email, role, name: String(row[2] || "").trim(), position };
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
    vendor: requiredText(payload.vendor, LIMITS.shortText, "店家", false),
    description: requiredText(payload.description, LIMITS.description, "說明", false)
  };
}

function startsWith(bytes, signature, offset) {
  const start = offset || 0;
  return bytes.length >= start + signature.length
    && signature.every((value, index) => (bytes[start + index] & 0xff) === value);
}

// Receipts are optional: small purchases often have none, or only a paper slip.
function decodeAttachments(attachments) {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments)) throw appError("bad_request", "附件格式不正確。");
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

// Receipts are filed by submission month (YYYY-MM), then by activity, under the configured folder.
function currentMonth() {
  return Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM");
}

function findMonthFolder(month) {
  const matches = DriveApp.getFolderById(property("DRIVE_FOLDER_ID")).getFoldersByName(month);
  while (matches.hasNext()) {
    const folder = matches.next();
    if (!folder.isTrashed()) return folder;
  }
  return null;
}

// Call inside withLock so two submissions cannot create the same folder twice.
function monthFolder(month) {
  return findMonthFolder(month) || DriveApp.getFolderById(property("DRIVE_FOLDER_ID")).createFolder(month);
}

// Activity folders are named "01_泡芙實作課"; the number tells apart sessions of the same course.
const ACTIVITY_PREFIX = /^(\d+)_\s*/;

function activityFolders(month) {
  if (!month) return [];
  const folders = [];
  const iterator = month.getFolders();
  while (iterator.hasNext()) {
    const folder = iterator.next();
    if (folder.isTrashed()) continue;
    const name = folder.getName();
    const prefix = name.match(ACTIVITY_PREFIX);
    folders.push({ folder, id: folder.getId(), name: prefix ? name.slice(prefix[0].length) : name, session: prefix ? Number(prefix[1]) : 0 });
  }
  // A session number is shown only when the month holds more than one folder with that name.
  const counts = folders.reduce((map, item) => map.set(item.name, (map.get(item.name) || 0) + 1), new Map());
  return folders
    .map((item) => ({ ...item, label: counts.get(item.name) > 1 && item.session ? `${item.name}（第 ${item.session} 堂）` : item.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant") || a.session - b.session);
}

// This month's activities, for the claim form.
// A month's activities for the claim form: this month by default, or a claim's own month when editing.
function listActivities(user, payload) {
  const month = /^\d{4}-\d{2}$/.test(payload.month || "") ? payload.month : currentMonth();
  return activityFolders(findMonthFolder(month))
    .map(({ id, name, label }) => ({ id, name, label }));
}

// Picks an existing activity folder by id, or creates one for a typed name. A typed name that
// already exists becomes its next session. Call inside withLock.
function resolveActivity(payload, monthName = currentMonth()) {
  const month = monthFolder(monthName);
  const existing = activityFolders(month);
  const id = typeof payload.activityId === "string" ? payload.activityId.trim() : "";
  if (id) {
    const match = existing.find((item) => item.id === id);
    if (!match) throw appError("invalid", "這個活動資料夾已不存在，請重新選擇。");
    return { folder: match.folder, label: match.label };
  }
  const name = requiredText(payload.activityName, LIMITS.shortText, "活動／社課", true).replace(ACTIVITY_PREFIX, "");
  if (!name || /[\/\\]/.test(name)) throw appError("invalid", "活動名稱不能是空白，也不能包含斜線。");
  const sessions = existing.filter((item) => item.name === name).map((item) => item.session);
  const session = sessions.length ? Math.max(...sessions, 1) + 1 : 1;
  const folder = month.createFolder(`${String(session).padStart(2, "0")}_${name}`);
  return { folder, label: sessions.length ? `${name}（第 ${session} 堂）` : name };
}

function submitRequest(user, payload) {
  const claim = validateClaim(payload);
  const files = decodeAttachments(payload.attachments);
  const id = Utilities.getUuid();
  const now = new Date().toISOString();
  const owner = (user.name || user.email.split("@")[0]).replace(/[^\p{L}\p{N}_-]/gu, "") || "applicant";
  const activity = withLock(() => resolveActivity(payload));
  const folder = activity.folder;
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
      row[COL["活動／社課"]] = activity.label;
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

function claimFromRow(row) {
  const status = cellText(row[COL["狀態"]]);
  return {
    id: cellText(row[COL["id"]]),
    createdAt: cellText(row[COL["建立時間"]]),
    date: cellText(row[COL["消費日期"]]),
    amount: Number(row[COL["金額"]]) || 0,
    parent: cellText(row[COL["主項目"]]),
    child: cellText(row[COL["副項目"]]),
    activity: cellText(row[COL["活動／社課"]]),
    vendor: cellText(row[COL["店家"]]),
    description: cellText(row[COL["說明"]]),
    attachmentCount: attachmentIds(row).length,
    status,
    canWithdraw: WITHDRAWABLE.includes(status),
    editable: status === STATUS_PAID ? "fixedAmount" : "full",
    // Receipts and activity folders live under the month the claim was submitted.
    month: submittedMonth(row),
    reviewNote: cellText(row[COL["審核備註"]])
  };
}

function submittedMonth(row) {
  const created = new Date(cellText(row[COL["建立時間"]]));
  return Number.isNaN(created.getTime()) ? currentMonth() : Utilities.formatDate(created, TIME_ZONE, "yyyy-MM");
}

function attachmentIds(row) {
  return cellText(row[COL["附件"]]).split(",").filter(Boolean);
}

function ownsRow(user, row) {
  return cellText(row[COL["申請人 email"]]).toLowerCase() === user.email;
}

function newestFirst(a, b) {
  return b.createdAt.localeCompare(a.createdAt);
}

function requireTreasurer(user) {
  if (user.role !== "treasurer") throw appError("forbidden", "只有總務可以執行這個操作。");
}

function missingClaim() {
  return appError("not_found", "找不到這筆申請，可能已經被撤銷。");
}

function listMyRequests(user) {
  return dataRows(CLAIM_SHEET, CLAIM_HEADER.length)
    .filter((row) => ownsRow(user, row))
    .map(claimFromRow)
    .sort(newestFirst);
}

// ---- Treasurer review ----

function listAllRequests(user, payload) {
  requireTreasurer(user);
  const status = typeof payload.status === "string" ? payload.status : "";
  const positions = new Map(permissionRows().map((cells) => [String(cells[0]).trim().toLowerCase(), positionOf(cells)]));
  return dataRows(CLAIM_SHEET, CLAIM_HEADER.length)
    .filter((row) => !status || cellText(row[COL["狀態"]]) === status)
    .map((row) => {
      const claim = claimFromRow(row);
      return {
        ...claim,
        applicantEmail: cellText(row[COL["申請人 email"]]),
        applicantName: cellText(row[COL["申請人姓名"]]),
        // People removed from 權限表 keep their claims, filed under 已離任.
        applicantPosition: positions.get(cellText(row[COL["申請人 email"]]).toLowerCase()) || "已離任",
        reviewer: cellText(row[COL["審核人"]]),
        reviewedAt: cellText(row[COL["審核時間"]])
      };
    })
    .sort(newestFirst);
}

function reviewRequest(user, payload) {
  requireTreasurer(user);
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const target = REVIEW_STATUSES.includes(payload.status) ? payload.status : "";
  if (!target) throw appError("bad_request", "不支援的審核動作。");
  const note = requiredText(payload.note, LIMITS.description, "審核備註", target === STATUS_REJECTED);
  return withLock(() => {
    const rows = dataRows(CLAIM_SHEET, CLAIM_HEADER.length);
    const index = rows.findIndex((row) => cellText(row[COL["id"]]) === id);
    if (!id || index < 0) throw missingClaim();
    const status = cellText(rows[index][COL["狀態"]]);
    if (status === target) throw appError("invalid", `這筆申請已經是「${status}」。`);
    const now = new Date().toISOString();
    // 狀態 through 更新時間 are the last five columns, written as one range.
    tab(CLAIM_SHEET).getRange(index + 2, COL["狀態"] + 1, 1, 5)
      .setValues([[target, user.email, now, note, now].map(safeCell)]);
    appendLog(user.email, `reviewRequest:${target}`, id);
    return { id, status: target };
  });
}

// Receipts are served through the backend, so nobody needs direct access to the Drive folder.
// The caller names a claim and a position, never a Drive file id.
function getAttachment(user, payload) {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const row = dataRows(CLAIM_SHEET, CLAIM_HEADER.length).find((cells) => cellText(cells[COL["id"]]) === id);
  if (!id || !row || !(user.role === "treasurer" || ownsRow(user, row))) throw missingClaim();
  const fileId = Number.isInteger(payload.index) ? attachmentIds(row)[payload.index] : null;
  if (!fileId) throw appError("not_found", "找不到這個附件。");
  let blob;
  try {
    blob = DriveApp.getFileById(fileId).getBlob();
  } catch (error) {
    console.error(error);
    throw appError("not_found", "附件已不在雲端硬碟，可能被移動或刪除。");
  }
  return { name: blob.getName(), type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

// The applicant edits their own claim: any field, the activity and the receipts. A paid claim keeps
// its amount and status; an approved or rejected one goes back to 待審核 for another look.
function editRequest(user, payload) {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const added = decodeAttachments(payload.attachments);
  const owner = (user.name || user.email.split("@")[0]).replace(/[^\p{L}\p{N}_-]/gu, "") || "applicant";
  const findRow = () => {
    const rows = dataRows(CLAIM_SHEET, CLAIM_HEADER.length);
    const index = rows.findIndex((row) => cellText(row[COL["id"]]) === id);
    if (!id || index < 0 || !ownsRow(user, rows[index])) throw missingClaim();
    return { index, row: rows[index] };
  };

  // First pass: check the claim and settle the folder, so files can be written outside the lock.
  const plan = withLock(() => {
    const { row } = findRow();
    const current = attachmentIds(row);
    const keep = Array.isArray(payload.keep) ? current.filter((_, position) => payload.keep.includes(position)) : current;
    if (keep.length + added.length > LIMITS.files) throw appError("invalid", `一次最多上傳 ${LIMITS.files} 個附件。`);
    const moving = Boolean(payload.activityId || payload.activityName);
    const activity = moving ? resolveActivity(payload, submittedMonth(row)) : { folder: claimFolder(row, current), label: cellText(row[COL["活動／社課"]]) };
    return { keep, removed: current.filter((fileId) => !keep.includes(fileId)), activity, moving };
  });

  const created = [];
  try {
    added.forEach((file, position) => {
      const name = `${Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd")}_${owner}_${id}_${Date.now()}_${position + 1}.${file.extension}`;
      created.push(plan.activity.folder.createFile(Utilities.newBlob(file.bytes, file.mimeType, name)));
    });
    const result = withLock(() => {
      const { index, row } = findRow();
      const status = cellText(row[COL["狀態"]]);
      const claim = validateClaim({ ...payload, amount: status === STATUS_PAID ? Number(row[COL["金額"]]) : payload.amount });
      const next = row.slice();
      next[COL["消費日期"]] = claim.date;
      next[COL["金額"]] = claim.amount;
      next[COL["主項目"]] = claim.parent;
      next[COL["副項目"]] = claim.child;
      next[COL["活動／社課"]] = plan.activity.label;
      next[COL["店家"]] = claim.vendor;
      next[COL["說明"]] = claim.description;
      next[COL["附件"]] = [...plan.keep, ...created.map((file) => file.getId())].join(",");
      if (status === STATUS_REJECTED || status === STATUS_APPROVED) next[COL["狀態"]] = STATUS_PENDING;
      next[COL["更新時間"]] = new Date().toISOString();
      tab(CLAIM_SHEET).getRange(index + 2, 1, 1, CLAIM_HEADER.length).setValues([next.map((cell) => safeCell(cellText(cell)))]);
      appendLog(user.email, "editRequest", id);
      return claimFromRow(next);
    });
    // Receipts follow a changed activity into its folder; removed ones go to the Drive trash.
    if (plan.moving) plan.keep.forEach((fileId) => {
      try { DriveApp.getFileById(fileId).moveTo(plan.activity.folder); } catch (error) { console.error(error); }
    });
    plan.removed.forEach((fileId) => {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (error) { console.error(error); }
    });
    return result;
  } catch (error) {
    created.forEach((file) => {
      try { file.setTrashed(true); } catch (cleanupError) { console.error(cleanupError); }
    });
    throw error;
  }
}

// The folder a claim's receipts live in: its first receipt's folder, else the activity folder of the
// same name in its month, else the month folder itself. Call inside withLock.
function claimFolder(row, fileIds) {
  try {
    if (fileIds.length) return DriveApp.getFileById(fileIds[0]).getParents().next();
  } catch (error) {
    console.error(error);
  }
  const month = monthFolder(submittedMonth(row));
  const match = activityFolders(month).find((item) => item.label === cellText(row[COL["活動／社課"]]));
  return match ? match.folder : month;
}

// Removes the claim row and moves its receipts to the Drive trash (recoverable for 30 days).
// The log row is the only remaining trace, and tells the app sync which id disappeared.
function withdrawRequest(user, payload) {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) throw missingClaim();
  const fileIds = withLock(() => {
    const rows = dataRows(CLAIM_SHEET, CLAIM_HEADER.length);
    const index = rows.findIndex((row) => cellText(row[COL["id"]]) === id);
    const row = rows[index];
    if (!row || !(user.role === "treasurer" || ownsRow(user, row))) throw missingClaim();
    if (!WITHDRAWABLE.includes(cellText(row[COL["狀態"]]))) {
      throw appError("invalid", "已核准或已付款的申請不能撤銷，請聯絡總務。");
    }
    tab(CLAIM_SHEET).deleteRow(index + 2);
    appendLog(user.email, "withdrawRequest", id);
    return attachmentIds(row);
  });
  fileIds.forEach((fileId) => {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (error) { console.error(error); }
  });
  return { id };
}

// Totals only; the summary tab must never hold personal data.
// syncedAt says how fresh the totals are; only the treasurer gets the review count.
function getSummary(user) {
  const summary = {
    items: dataRows(SUMMARY_SHEET, SUMMARY_HEADER.length)
      .map((row) => ({ label: cellText(row[0]), amount: Number(row[1]) }))
      .filter((item) => item.label && Number.isFinite(item.amount)),
    syncedAt: PropertiesService.getScriptProperties().getProperty(SYNCED_AT_PROPERTY) || ""
  };
  if (user.role === "treasurer") {
    summary.pendingReview = dataRows(CLAIM_SHEET, CLAIM_HEADER.length)
      .filter((row) => cellText(row[COL["狀態"]]) === STATUS_PENDING).length;
  }
  return summary;
}

// ---- Desktop app sync ----

// Compares every character so the response time does not reveal how much of a guess was right.
function verifySyncSecret(secret) {
  const expected = property("SYNC_SECRET");
  const given = typeof secret === "string" ? secret : "";
  let difference = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ (given.charCodeAt(index) || 0);
  }
  if (difference !== 0 || expected.length < 32) throw appError("unauthorized", "同步金鑰不正確。");
}

function driveLink(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

// Every claim, plus the ids the 操作紀錄 shows as withdrawn so the app can drop them.
function syncPull() {
  const claims = dataRows(CLAIM_SHEET, CLAIM_HEADER.length).map((row) => {
    const claim = claimFromRow(row);
    return {
      id: claim.id,
      createdAt: claim.createdAt,
      applicantEmail: cellText(row[COL["申請人 email"]]),
      applicantName: cellText(row[COL["申請人姓名"]]),
      date: claim.date,
      amount: claim.amount,
      parent: claim.parent,
      child: claim.child,
      activity: claim.activity,
      vendor: claim.vendor,
      description: claim.description,
      status: claim.status,
      reviewNote: claim.reviewNote,
      receiptLinks: attachmentIds(row).map(driveLink)
    };
  }).filter((claim) => claim.id);
  const withdrawnIds = dataRows(LOG_SHEET, LOG_HEADER.length)
    .filter((row) => cellText(row[2]) === "withdrawRequest")
    .map((row) => cellText(row[3]))
    .filter(Boolean);
  return { claims, withdrawnIds: [...new Set(withdrawnIds)] };
}

function syncSummaryRows(value) {
  if (!Array.isArray(value) || value.length > SYNC_LIMITS.summaryRows) throw appError("bad_request", "財務彙總格式不正確。");
  return value.map((item) => {
    const label = item && typeof item.label === "string" ? item.label.trim() : "";
    const amount = item ? item.amount : NaN;
    if (!label || label.length > SYNC_LIMITS.label || typeof amount !== "number" || !Number.isFinite(amount) || Math.abs(amount) > SYNC_LIMITS.amount) {
      throw appError("bad_request", "財務彙總格式不正確。");
    }
    return [safeCell(label), Math.round(amount)];
  });
}

// Replaces the summary tab as a whole. Claim statuses are never changed here.
function syncPush(payload) {
  const summary = syncSummaryRows(payload.summary);
  return withLock(() => {
    const summaryTab = tab(SUMMARY_SHEET, SUMMARY_HEADER, true);
    if (summaryTab.getLastRow() > 1) summaryTab.getRange(2, 1, summaryTab.getLastRow() - 1, SUMMARY_HEADER.length).clearContent();
    if (summary.length) summaryTab.getRange(2, 1, summary.length, SUMMARY_HEADER.length).setValues(summary);
    PropertiesService.getScriptProperties().setProperty(SYNCED_AT_PROPERTY, new Date().toISOString());
    return { summaryRows: summary.length };
  });
}

// ---- Monthly backup ----

const BACKUP_FOLDER = "備份";
const BACKUP_KEEP = 12;

// Copies the whole spreadsheet into 備份 under the receipts folder, then keeps only the newest
// BACKUP_KEEP copies. Runs on the 1st of each month once setupMonthlyBackup has been run.
function monthlyBackup() {
  const root = DriveApp.getFolderById(property("DRIVE_FOLDER_ID"));
  const existing = root.getFoldersByName(BACKUP_FOLDER);
  const folder = existing.hasNext() ? existing.next() : root.createFolder(BACKUP_FOLDER);
  const name = `${spreadsheet().getName()} 備份`;
  DriveApp.getFileById(property("SHEET_ID")).makeCopy(`${name} ${Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd")}`, folder);
  const copies = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().startsWith(name)) copies.push(file);
  }
  copies.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(BACKUP_KEEP).forEach((file) => file.setTrashed(true));
  console.log(`備份完成，保留 ${Math.min(copies.length, BACKUP_KEEP)} 份。`);
}

// Run once from the Apps Script editor. Replaces any earlier schedule, so running it again is safe.
function setupMonthlyBackup() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "monthlyBackup")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("monthlyBackup").timeBased().onMonthDay(1).atHour(3).inTimezone(TIME_ZONE).create();
  monthlyBackup();
  console.log("已排程：每月 1 日凌晨 3 點自動備份，並已先備份一次。");
}
