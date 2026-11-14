// Dessert Treasurer claims backend (Google Apps Script web app).
//
// Script Properties (Project Settings > Script Properties), never in code:
//   OAUTH_CLIENT_ID  Google OAuth client ID used by web/ for sign-in
//   SHEET_ID         Spreadsheet holding the 權限表 and 操作紀錄 tabs

const PERMISSION_SHEET = "權限表";
const LOG_SHEET = "操作紀錄";
const LOG_HEADER = ["時間", "操作者 email", "動作", "目標 id"];
const ROLES = { "總務": "treasurer", "幹部": "officer" };
const TOKEN_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

const ACTIONS = {
  whoami: (user) => user,
  writeTest: (user) => {
    appendLog(user.email, "writeTest", "");
    return { written: true };
  }
};

function doPost(e) {
  try {
    const request = parseRequest(e);
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, request.action) ? ACTIONS[request.action] : null;
    if (!handler) throw appError("bad_request", "不支援的操作。");
    const user = authorize(request.idToken);
    return respond({ ok: true, data: handler(user, request.payload || {}) });
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
  const sheet = SpreadsheetApp.openById(property("SHEET_ID")).getSheetByName(PERMISSION_SHEET);
  if (!sheet) throw new Error(`Missing sheet: ${PERMISSION_SHEET}`);
  const row = sheet.getDataRange().getValues().slice(1)
    .find((cells) => String(cells[0]).trim().toLowerCase() === email);
  const role = row ? ROLES[String(row[1]).trim()] : null;
  if (!role) throw appError("unauthorized", "無權限，請聯絡總務。");
  return { email, role, name: String(row[2] || "").trim() };
}

function appendLog(email, action, targetId) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw appError("busy", "系統忙碌中，請稍後再試。");
  try {
    const spreadsheet = SpreadsheetApp.openById(property("SHEET_ID"));
    let sheet = spreadsheet.getSheetByName(LOG_SHEET);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(LOG_SHEET);
      sheet.appendRow(LOG_HEADER);
    }
    sheet.appendRow([new Date().toISOString(), email, action, targetId]);
  } finally {
    lock.releaseLock();
  }
}
