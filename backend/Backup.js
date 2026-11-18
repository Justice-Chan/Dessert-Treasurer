// The monthly copy of the spreadsheet.

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
