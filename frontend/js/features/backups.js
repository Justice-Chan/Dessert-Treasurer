function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Exports: written straight into the chosen export folder in the desktop app, downloaded in the
// browser. Returns where the file went, for the message.
async function exportFile(name, content, type) {
  // An activity name may hold characters a file name cannot.
  const filename = name.replace(/[\\/:*?"<>|]/g, "_");
  if (!tauriStorageEnabled) {
    download(filename, content, type);
    return "下載資料夾";
  }
  const folder = await exportFolder();
  await nativeStorageCall("writeExportFile", { folder, name: filename, contents: content });
  return backupFolderCrumbs(folder);
}

async function exportFolder() {
  return state.exportFolder || nativeStorageCall("defaultExportFolder").catch(() => "");
}

async function exportWithMessage(filename, content, type, label) {
  try {
    toast(`${label}已匯出到 ${await exportFile(filename, content, type)}。`);
  } catch (error) {
    toast(`匯出失敗：${error?.message || error}`, "error");
  }
}

function csv(rows) {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell ?? "");
    const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replace(/"/g, '""')}"`;
  }).join(",")).join("\n");
}

function parseCsv(text) {
  const source = String(text || "").replace(/^\ufeff/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function combinedReportCsvRows() {
  const rows = [
    ...state.entries.filter((entry) => isActiveEntry(entry) && !entry.claimId).map((entry) => ({ date: entry.date, order: 0, values: [
      entry.type === "income" ? "收入" : "支出",
      entry.date,
      "",
      entry.title || entry.child,
      entry.parent,
      entry.child,
      entry.amount,
      accountName(entry.accountId),
      entry.method,
      entry.type === "income" ? "增加帳面" : "扣除帳面",
      "",
      "",
      "",
      entry.note
    ] })),
    ...state.claims.map((claim) => ({ date: claim.paymentDate || claim.date, order: 1, values: [
      "報銷",
      claim.status === "paid" ? claim.paymentDate : "",
      claim.date,
      claim.title,
      claim.parent,
      claim.child,
      claim.amount,
      claim.status === "paid" ? accountName(claim.paymentAccountId) : "",
      statusText[claim.status],
      claim.status === "paid" ? "扣除帳面" : "尚未入帳",
      claim.person,
      claim.receipt,
      (claim.attachments || []).map((attachment) => attachment.name).join("、"),
      claim.note
    ] }))
  ];
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);
  return [
    ["記錄類型", "記帳或付款日期", "申請日期", "項目或用途", "主項目", "副項目", "金額", "帳戶", "付款方式或狀態", "帳面影響", "申請人", "憑證", "附件", "備註"],
    ...rows.map((row) => row.values)
  ];
}

function ledgerCsvRows() {
  return [["日期", "類型", "項目", "主項目", "副項目", "金額", "帳戶", "付款方式", "備註", "來源"], ...state.entries.filter(isActiveEntry).map((entry) => [entry.date, entry.type === "income" ? "收入" : "支出", entry.title, entry.parent, entry.child, entry.amount, accountName(entry.accountId), entry.method, entry.note, entry.claimId ? "報銷付款" : "一般記帳"])];
}

function claimsCsvRows() {
  return [["申請日期", "申請人", "用途", "主項目", "副項目", "金額", "狀態", "憑證", "附件", "備註"], ...state.claims.map((claim) => [claim.date, claim.person, claim.title, claim.parent, claim.child, claim.amount, statusText[claim.status], claim.receipt, (claim.attachments || []).map((attachment) => attachment.name).join("、"), claim.note])];
}

// A full JSON copy for restoring or handing over; the automatic backup writes the same content.
// Returns where it went; throws when it could not be written.
async function exportCompleteFile() {
  const attachments = await exportReceipts();
  const where = await exportFile(`甜點社總務完整備份-${today()}.json`, JSON.stringify({ backupVersion: 3, ...state, webSync: { ...state.webSync, secret: "" }, attachments }, null, 2), "application/json");
  state.lastBackupAt = new Date().toISOString();
  saveState();
  return where;
}

async function exportComplete() {
  try {
    toast(`完整備份已匯出到 ${await exportCompleteFile()}。`);
  } catch (error) {
    toast(`匯出失敗：${error?.message || error}`, "error");
  }
}

// Reports for people to read; restoring always uses the JSON backup.
function exportCombined() {
  exportWithMessage(`甜點社收支報銷合併報表-${today()}.csv`, "\ufeff" + csv(combinedReportCsvRows()), "text/csv;charset=utf-8", "收支＋報銷");
}

function exportLedger() {
  exportWithMessage(`甜點社收支明細-${today()}.csv`, "\ufeff" + csv(ledgerCsvRows()), "text/csv;charset=utf-8", "收支明細");
}

function exportClaims() {
  exportWithMessage(`甜點社報銷明細-${today()}.csv`, "\ufeff" + csv(claimsCsvRows()), "text/csv;charset=utf-8", "報銷明細");
}

function validateImportedState(data) {
  const safeId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
  const safeText = (value, limit = 2000) => value == null || (typeof value === "string" && value.length <= limit);
  const validAmount = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
  const withinLimit = (value, limit) => !value || (Array.isArray(value) && value.length <= limit);
  const validateEntry = (entry) => {
    if (!entry || !safeId(entry.id) || !isValidDateValue(entry.date) || !["income", "expense"].includes(entry.type) || !validAmount(entry.amount)) throw new Error("invalid entry");
    if (entry.claimId && !safeId(entry.claimId)) throw new Error("invalid entry link");
    if (![entry.title, entry.parent, entry.child, entry.method, entry.accountId, entry.note].every((value) => safeText(value))) throw new Error("invalid entry text");
  };
  const validateClaim = (claim) => {
    if (!claim || !safeId(claim.id) || !isValidDateValue(claim.date) || !Object.hasOwn(statusText, claim.status) || !validAmount(claim.amount)) throw new Error("invalid claim");
    if (![claim.person, claim.title, claim.parent, claim.child, claim.receipt, claim.note, claim.paymentDate, claim.paymentAccountId].every((value) => safeText(value))) throw new Error("invalid claim text");
    if (claim.paymentDate && !isValidDateValue(claim.paymentDate)) throw new Error("invalid payment date");
    if (!Array.isArray(claim.attachments || []) || (claim.attachments || []).length > 100) throw new Error("invalid attachments");
    (claim.attachments || []).forEach((attachment) => {
      if (!attachment || !safeId(attachment.id) || !safeText(attachment.name, 300) || !safeText(attachment.type, 100)) throw new Error("invalid attachment");
    });
  };

  if (!data || typeof data !== "object") throw new Error("invalid backup");
  if (!withinLimit(data.entries, 50000) || !withinLimit(data.claims, 50000) || !withinLimit(data.trash, 50000) || !withinLimit(data.accounts, 200) || !withinLimit(data.payees, 5000) || !withinLimit(data.people, 10000) || !withinLimit(data.activities, 10000) || !withinLimit(data.reconciliations, 50000) || !withinLimit(data.lockedMonths, 1200)) throw new Error("backup too large");
  [data.entries, data.claims, data.trash, data.accounts, data.payees, data.people, data.activities].filter(Array.isArray).forEach((items) => {
    const ids = items.map((item) => item?.id);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate ids");
  });
  (data.entries || []).forEach(validateEntry);
  (data.claims || []).forEach(validateClaim);
  (data.accounts || []).forEach((account) => {
    if (!account || !safeId(account.id) || !safeText(account.name, 160) || !["cash", "bank", "other"].includes(account.type) || !Number.isFinite(Number(account.openingBalance))) throw new Error("invalid account");
    if (account.openingDate && !isValidDateValue(account.openingDate)) throw new Error("invalid account date");
    if (![account.accountNumber, account.qrCodeName].every((value) => safeText(value, 500))) throw new Error("invalid account text");
    const validQr = !account.qrCodeDataUrl || (typeof account.qrCodeDataUrl === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(account.qrCodeDataUrl) && account.qrCodeDataUrl.length <= 1_500_000);
    if ((account.accountNumber && !/^\d{1,14}$/.test(account.accountNumber)) || !validQr) throw new Error("invalid account data");
  });
  (data.payees || []).forEach((payee) => {
    if (!payee || !safeId(payee.id) || !safeText(payee.name, 160) || !safeText(payee.bank, 160) || !safeText(payee.qrCodeName, 500)) throw new Error("invalid payee");
    const validQr = !payee.qrCodeDataUrl || (typeof payee.qrCodeDataUrl === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(payee.qrCodeDataUrl) && payee.qrCodeDataUrl.length <= 1_500_000);
    if (!/^\d{1,14}$/.test(payee.accountNumber || "") || !validQr) throw new Error("invalid payee data");
  });
  (data.people || []).forEach((person) => {
    if (!person || !safeId(person.id) || !safeText(person.name, 80) || !safeText(person.studentId, 30) || !safeText(person.department, 100) || !safeText(person.email, 160)) throw new Error("invalid person");
    if (!person.name.trim() || !person.studentId.trim()) throw new Error("invalid person data");
    if (person.email && !normalizeEmail(person.email)) throw new Error("invalid person email");
  });
  if (data.memberImportLink != null) {
    if (typeof data.memberImportLink !== "object" || !safeText(data.memberImportLink.url, 2048) || !normalizeMemberImportLink(data.memberImportLink.url) || !safeText(data.memberImportLink.lastSyncedAt, 100)) throw new Error("invalid member import link");
  }
  const importedPersonIds = new Set((data.people || []).map((person) => person.id));
  (data.activities || []).forEach((activity) => {
    if (!activity || !safeId(activity.id) || !safeText(activity.name, 160) || !activity.name.trim() || !isValidDateValue(activity.date) || !validAmount(activity.fee) || !safeText(activity.note, 500)) throw new Error("invalid activity");
    if (!Array.isArray(activity.attendance || []) || activity.attendance.length > 10000) throw new Error("invalid activity attendance");
    if (activity.rosterOrder !== undefined && (!Array.isArray(activity.rosterOrder) || activity.rosterOrder.length > 10000)) throw new Error("invalid activity roster order");
    const attendanceIds = new Set();
    (activity.attendance || []).forEach((item) => {
      if (!item || !safeId(item.personId) || !importedPersonIds.has(item.personId) || attendanceIds.has(item.personId) || !["attending", "not_attending"].includes(item.status) || typeof item.paid !== "boolean" || !safeText(item.paidAt || "", 32) || (item.paidAt && !normalizePaymentTime(item.paidAt))) throw new Error("invalid activity attendance");
      if (item.transferLastFive !== undefined && (typeof item.transferLastFive !== "string" || (item.transferLastFive && !/^\d{5}$/.test(item.transferLastFive)))) throw new Error("invalid transfer account suffix");
      attendanceIds.add(item.personId);
    });
    const rosterIds = new Set();
    (activity.rosterOrder || []).forEach((personId) => {
      if (!safeId(personId) || !importedPersonIds.has(personId) || rosterIds.has(personId)) throw new Error("invalid activity roster order");
      rosterIds.add(personId);
    });
  });
  (data.trash || []).forEach((item) => {
    if (!item || !safeId(item.id) || !["entry", "claim"].includes(item.kind)) throw new Error("invalid trash");
    if (typeof item.deletedAt !== "string" || !Number.isFinite(new Date(item.deletedAt).getTime())) throw new Error("invalid trash date");
    if (item.kind === "entry") validateEntry(item.record);
    else validateClaim(item.record);
    if (item.linkedEntry) validateEntry(item.linkedEntry);
  });
  (data.reconciliations || []).forEach((item) => {
    if (!item || !safeId(item.id) || !safeId(item.accountId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month || "")) throw new Error("invalid reconciliation");
    if (![item.calculatedBalance, item.actualBalance, item.difference].every((value) => Number.isFinite(Number(value))) || !safeText(item.note) || !safeText(item.updatedAt, 100)) throw new Error("invalid reconciliation data");
  });
  (data.lockedMonths || []).forEach((month) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("invalid month");
  });
  if (Array.isArray(data.accounts)) {
    const accountIds = new Set(data.accounts.map((account) => account.id));
    if ((data.entries || []).some((entry) => entry.accountId && !accountIds.has(entry.accountId))) throw new Error("unknown account");
    if ((data.claims || []).some((claim) => claim.paymentAccountId && !accountIds.has(claim.paymentAccountId))) throw new Error("unknown account");
  }
  return data;
}

function validateImportedAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length > 1000) throw new Error("invalid attachments");
  attachments.forEach((attachment) => {
    const safeId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
    const validData = typeof attachment?.dataUrl === "string" && /^data:(image\/(png|jpeg|webp|gif)|application\/pdf);base64,/i.test(attachment.dataUrl) && attachment.dataUrl.length <= 18_000_000;
    if (!safeId(attachment?.id) || !safeId(attachment?.claimId) || !validData) throw new Error("invalid attachment data");
  });
  return attachments;
}

function parseImportedContent(filename, text) {
  if (filename.toLowerCase().endsWith(".json")) {
    const imported = JSON.parse(text);
    if (Array.isArray(imported.entries) && Array.isArray(imported.claims)) {
      return { scope: "complete", data: validateImportedState(imported), attachments: validateImportedAttachments(imported.attachments || []) };
    }
    if (imported.exportType === "entries" && Array.isArray(imported.entries)) {
      const entries = validateImportedState({ entries: imported.entries }).entries;
      const knownAccounts = new Set(state.accounts.map((account) => account.id));
      if (entries.some((entry) => entry.accountId && !knownAccounts.has(entry.accountId))) throw new Error("unknown account");
      return { scope: "entries", data: entries };
    }
    if (imported.exportType === "claims" && Array.isArray(imported.claims)) {
      const linkedEntries = Array.isArray(imported.linkedEntries) ? imported.linkedEntries : [];
      validateImportedState({ claims: imported.claims, entries: linkedEntries });
      if (imported.claims.some((claim) => claim.status === "paid" && !linkedEntries.some((entry) => entry.claimId === claim.id))) throw new Error("paid claims require json backup");
      const knownAccounts = new Set(state.accounts.map((account) => account.id));
      if (linkedEntries.some((entry) => entry.accountId && !knownAccounts.has(entry.accountId)) || imported.claims.some((claim) => claim.paymentAccountId && !knownAccounts.has(claim.paymentAccountId))) throw new Error("unknown account");
      return { scope: "claims", data: { claims: imported.claims, linkedEntries }, attachments: validateImportedAttachments(imported.attachments || []) };
    }
    throw new Error("unsupported json");
  }

  if (!filename.toLowerCase().endsWith(".csv")) throw new Error("unsupported file");
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("empty csv");
  if (rows[0][0] === "記錄類型") throw new Error("report only");

  if (rows[0][0] === "資料類型" && rows[0][1] === "完整紀錄") {
    const data = { entries: [], claims: [], trash: [] };
    rows.slice(1).forEach((row) => {
      const record = JSON.parse(row[1]);
      if (row[0] === "記帳") data.entries.push(record);
      else if (row[0] === "報銷") data.claims.push(record);
      else if (row[0] === "垃圾桶") data.trash.push(record);
    });
    return { scope: "complete", data: validateImportedState(data), attachments: [] };
  }

  if (rows[0][0] === "日期" && rows[0][1] === "類型") {
    const hasAccount = rows[0].includes("帳戶");
    const sourceIndex = rows[0].indexOf("來源");
    const typeValues = { 收入: "income", 支出: "expense" };
    const entries = rows.slice(1).map((row) => {
      if (!typeValues[row[1]] || !Number.isFinite(Number(row[5])) || Number(row[5]) <= 0) throw new Error("invalid csv entry");
      const source = sourceIndex >= 0 ? row[sourceIndex] : "";
      if (source === "報銷付款" || (sourceIndex < 0 && String(row[2] || "").startsWith("報銷："))) return null;
      const matchedAccount = hasAccount ? state.accounts.find((account) => account.name === row[6]) : null;
      if (hasAccount && !matchedAccount) throw new Error("unknown account");
      return {
        id: uid(), date: row[0], type: typeValues[row[1]], title: row[2] || "", parent: row[3] || "", child: row[4] || "", amount: Number(row[5]), accountId: matchedAccount?.id, method: row[hasAccount ? 7 : 6] || "", note: row[hasAccount ? 8 : 7] || ""
      };
    }).filter(Boolean);
    return { scope: "entries", data: validateImportedState({ entries }).entries };
  }

  if (rows[0][0] === "申請日期" && rows[0][1] === "申請人") {
    const hasAttachments = rows[0].includes("附件");
    const statusValues = Object.fromEntries(Object.entries(statusText).map(([key, value]) => [value, key]));
    const claims = rows.slice(1).map((row) => {
      const status = statusValues[row[6]];
      if (!status || !Number.isFinite(Number(row[5])) || Number(row[5]) <= 0) throw new Error("invalid csv claim");
      if (status === "paid") throw new Error("paid claims require json backup");
      return { id: uid(), date: row[0], person: row[1] || "", title: row[2] || "", parent: row[3] || "", child: row[4] || "", amount: Number(row[5]), status, receipt: row[7] || "", attachments: [], note: row[hasAttachments ? 9 : 8] || "" };
    });
    return { scope: "claims", data: { claims: validateImportedState({ claims }).claims, linkedEntries: [] } };
  }

  throw new Error("unsupported csv");
}

// ---- Backup card ----
// In the desktop app the native side writes a backup on quit; this card shows when that last
// happened and where. The browser version has no automatic backup, only "另存一份".

const backupTimeFormat = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

async function renderBackupPage() {
  const folder = state.autoBackup.folder;
  $("#backupLocation").hidden = !tauriStorageEnabled;
  $("#exportLocation").hidden = !tauriStorageEnabled;
  if (tauriStorageEnabled) {
    const target = await exportFolder();
    $("#exportFolderPath").textContent = target ? backupFolderCrumbs(target) : "未設定";
    $("#exportFolderPath").title = target;
  }
  $("#autoBackupEdit").textContent = folder ? "變更" : "設定";
  // A breadcrumb, not the path: the path holds the Gmail address, which a screenshot would show.
  $("#backupFolder").textContent = folder ? backupFolderCrumbs(folder) : "未設定";
  $("#backupFolder").title = folder;
  if (!tauriStorageEnabled) {
    // Short, to fit beside the title; the full backup in 匯出 is the browser's only copy.
    return setBackupStatus("warn", "瀏覽器版不會自動備份");
  }
  if (!folder) return setBackupStatus("warn", "尚未設定自動備份。");
  const info = await nativeStorageCall("autoBackupInfo", { folder }).catch(() => null);
  if (state.autoBackup.folder !== folder) return;
  // A backup is only rewritten when the books change, so this is also when they last changed.
  if (info) setBackupStatus("ok", `上次備份 ${backupTimeFormat.format(new Date(info.modifiedAt))}`);
  else setBackupStatus("warn", "還沒有備份，關閉 app 時會自動備份。");
}

// "Google 雲端硬碟 › 我的雲端硬碟 › 甜點社總務備份" for a Drive folder, "本機 › 下載" for Downloads,
// else the last two folders.
function backupFolderCrumbs(folder) {
  const parts = folder.split(/[\\/]+/).filter(Boolean);
  const drive = parts.findIndex((part) => part === "我的雲端硬碟" || part === "My Drive");
  if (drive >= 0) return ["Google 雲端硬碟", ...parts.slice(drive)].join(" › ");
  if (parts.length === 3 && parts.at(-1) === "Downloads") return "本機 › 下載";
  return ["本機", ...parts.slice(-2)].join(" › ");
}

function setBackupStatus(level, text) {
  $("#backupStatus").textContent = text;
  $("#backupStatus").dataset.level = level;
}

// ---- Change a folder ----
// One small dialog for the automatic backup folder and the export folder: the current place, a
// usual choice or a folder picked in the system's own picker, and only then 儲存.

const folderDialogs = {
  backup: {
    title: "自動備份位置",
    usual: "使用 Google 雲端硬碟",
    usualCommand: "defaultBackupFolder",
    missing: "找不到 Google 雲端硬碟電腦版的資料夾，請改用「選擇其他資料夾」。",
    note: "關閉 app 時，若帳務有變動就寫入「甜點社帳務自動備份_月-日.json」，只保留最新一份；沒有變動不會重寫。放在 Google 雲端硬碟電腦版的資料夾裡會同步到雲端，舊版本可從檔案的「版本記錄」找回。",
    current: () => state.autoBackup.folder,
    save: (folder) => { state.autoBackup = { folder }; },
    saved: "已變更自動備份位置。"
  },
  export: {
    title: "匯出位置",
    usual: "使用「下載」資料夾",
    usualCommand: "defaultExportFolder",
    missing: "找不到「下載」資料夾，請改用「選擇其他資料夾」。",
    note: "完整備份和 CSV 報表會直接存到這個資料夾。",
    current: () => state.exportFolder,
    save: (folder) => { state.exportFolder = folder; },
    saved: "已變更匯出位置。"
  }
};
let folderDialog = folderDialogs.backup;
let pendingBackupFolder = "";

async function editFolder(kind) {
  folderDialog = folderDialogs[kind];
  pendingBackupFolder = "";
  const folder = folderDialog.current() || (kind === "export" ? await exportFolder() : "");
  $("#backupFolderDialogTitle").textContent = folderDialog.title;
  $("#autoBackupDetect").textContent = folderDialog.usual;
  $("#folderDialogNote").textContent = folderDialog.note;
  $("#backupFolderCurrent").textContent = folder ? backupFolderCrumbs(folder) : "未設定";
  $("#backupFolderCurrent").title = folder;
  showPendingBackupFolder();
  $("#backupFolderDialog").hidden = false;
}

function closeBackupFolderDialog() {
  $("#backupFolderDialog").hidden = true;
}

function showPendingBackupFolder() {
  const changed = Boolean(pendingBackupFolder) && pendingBackupFolder !== folderDialog.current();
  $("#backupFolderPending").hidden = !pendingBackupFolder;
  $("#backupFolderPending").textContent = pendingBackupFolder ? `改為　${backupFolderCrumbs(pendingBackupFolder)}` : "";
  $("#backupFolderPending").title = pendingBackupFolder;
  $("#autoBackupSave").disabled = !changed;
}

async function detectBackupFolder() {
  const folder = await nativeStorageCall(folderDialog.usualCommand).catch(() => "");
  if (!folder) return toast(folderDialog.missing);
  pendingBackupFolder = folder;
  showPendingBackupFolder();
}

async function chooseBackupFolder() {
  try {
    const current = folderDialog.current();
    const folder = await tauriInvoke("plugin:dialog|open", {
      options: { directory: true, title: `選擇${folderDialog.title}`, ...(current ? { defaultPath: current } : {}) }
    });
    if (!folder) return;
    pendingBackupFolder = String(folder);
    showPendingBackupFolder();
  } catch {
    toast("無法開啟資料夾選擇視窗。");
  }
}

function saveAutoBackupSettings() {
  if (!pendingBackupFolder) return;
  folderDialog.save(pendingBackupFolder.trim().slice(0, 1000));
  if (!saveState()) return;
  closeBackupFolderDialog();
  toast(folderDialog.saved);
}

// ---- Restore ----

// What a picked backup holds, so the wrong file is caught before it replaces anything.
function importSummary(imported, file) {
  const date = new Date(file.lastModified);
  const when = Number.isNaN(date.getTime()) ? "" : `備份日期 ${date.getMonth() + 1}/${date.getDate()}，`;
  if (imported.scope === "entries") return `${when}收支 ${imported.data.length} 筆。\n會取代目前的收支紀錄，報銷與垃圾桶資料會保留。`;
  if (imported.scope === "claims") return `${when}報銷 ${imported.data.claims.length} 筆。\n會取代目前的報銷紀錄，收支與垃圾桶資料會保留。`;
  const { entries = [], claims = [], people = [], activities = [] } = imported.data;
  return `${when}收支 ${entries.length} 筆、報銷 ${claims.length} 筆、人員 ${people.length} 位、活動 ${activities.length} 個。\n會取代目前全部帳務資料。`;
}

// Saves the current books before a restore replaces them: beside the automatic backup in the
// desktop app, or as a download in the browser. Returns a note for the closing message, or throws.
async function saveRestorePoint() {
  if (tauriStorageEnabled && state.autoBackup.folder) {
    await enqueueNativeSave(state, "儲存失敗，無法寫入本機資料夾。");
    await nativeStorageCall("saveRestorePoint");
    return "還原前的資料已另存到備份資料夾（甜點社還原前備份_日期.json）。";
  }
  return `還原前的資料已另存一份到 ${await exportCompleteFile()}。`;
}

// First run on a computer with Google Drive for desktop: pick its folder without asking.
async function setDefaultBackupFolder() {
  if (!tauriStorageEnabled || state.autoBackup.folder) return;
  const folder = await nativeStorageCall("defaultBackupFolder").catch(() => "");
  if (!folder) return;
  state.autoBackup = { folder };
  saveState();
}
