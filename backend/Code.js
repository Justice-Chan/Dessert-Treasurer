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

// The one list of expense categories: the web form shows it and the desktop app takes it on sync.
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

// Built on first use: the handlers live in other files, which Apps Script may load after this one.
const actions = () => ({
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
});

// Called by the desktop app with SYNC_SECRET instead of a Google sign-in.
const syncActions = () => ({ syncPull, syncPush });
const SYNCED_AT_PROPERTY = "SUMMARY_SYNCED_AT";
const SYNC_LIMITS = { summaryRows: 50, label: 30, amount: 100000000 };

function doPost(e) {
  try {
    const request = parseRequest(e);
    const payload = request.payload && typeof request.payload === "object" ? request.payload : {};
    const sync = syncActions();
    if (Object.prototype.hasOwnProperty.call(sync, request.action)) {
      verifySyncSecret(request.secret);
      return respond({ ok: true, data: sync[request.action](payload) });
    }
    const handlers = actions();
    const handler = Object.prototype.hasOwnProperty.call(handlers, request.action) ? handlers[request.action] : null;
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
// A verified token is remembered until it expires, under a hash of the token, so later calls in the
// same sign-in skip the round trip to Google. Only the email is kept, never the token itself.
function verifyIdToken(idToken) {
  if (typeof idToken !== "string" || !idToken || idToken.length > 4096) throw appError("unauthenticated", "請重新登入。");
  const cache = CacheService.getScriptCache();
  const key = `idt:${Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken))}`;
  const known = JSON.parse(cache.get(key) || "null");
  if (known && known.exp * 1000 > Date.now()) return known.email;
  const email = checkIdTokenWithGoogle(idToken);
  cacheVerifiedToken(cache, key, email);
  return email.address;
}

function cacheVerifiedToken(cache, key, email) {
  const seconds = Math.min(Math.floor(email.exp - Date.now() / 1000), 21600);
  if (seconds > 0) cache.put(key, JSON.stringify({ email: email.address, exp: email.exp }), seconds);
}

function checkIdTokenWithGoogle(idToken) {
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
  return { address: String(claims.email).trim().toLowerCase(), exp: Number(claims.exp) };
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
