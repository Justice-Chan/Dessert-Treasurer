// Reading and writing the spreadsheet tabs.

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
