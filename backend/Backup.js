// The monthly copies of the spreadsheet and the shared ledger.

// ---- Monthly backup ----

const BACKUP_FOLDER = "備份";
const BACKUP_KEEP = 12;

// Copies the whole spreadsheet, and the shared ledger once it exists, into 備份 in the ledger folder
// (LEDGER_FOLDER_ID, else the receipts folder), then keeps only the newest BACKUP_KEEP copies of each. Runs on the 1st of each month once
// setupMonthlyBackup has been run. Older copies go to the Drive trash, recoverable for 30 days.
function monthlyBackup() {
  const root = ledgerFolder();
  const existing = root.getFoldersByName(BACKUP_FOLDER);
  const folder = existing.hasNext() ? existing.next() : root.createFolder(BACKUP_FOLDER);
  const date = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
  const sheetName = `${spreadsheet().getName()} 備份`;
  DriveApp.getFileById(property("SHEET_ID")).makeCopy(`${sheetName} ${date}`, folder);
  const kept = [`試算表 ${keepNewest(folder, sheetName)} 份`];
  const ledger = ledgerFile();
  if (ledger) {
    ledger.makeCopy(`${LEDGER_BACKUP_NAME} ${date}.json`, folder);
    kept.push(`帳本 ${keepNewest(folder, LEDGER_BACKUP_NAME)} 份`);
  }
  console.log(`備份完成，保留${kept.join("、")}。`);
}

const LEDGER_BACKUP_NAME = "甜點社帳本 備份";

// Trashes all but the newest BACKUP_KEEP files in the folder whose names start with prefix.
function keepNewest(folder, prefix) {
  const copies = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().startsWith(prefix)) copies.push(file);
  }
  copies.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(BACKUP_KEEP).forEach((file) => file.setTrashed(true));
  return Math.min(copies.length, BACKUP_KEEP);
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
