function updateExportUi() {
  const isJson = selectedExportFormat === "json";
  $("#exportComplete").textContent = isJson ? "下載完整備份" : "下載合併報表";
  $("#exportDescription").textContent = isJson
    ? "JSON 完整備份可供日後還原，並包含帳戶、月結、人員、活動與收據附件。"
    : "CSV 合併報表以一般欄位整理收入、支出與報銷，已付款報銷只列一次；完整還原請使用 JSON。";
}

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

async function exportComplete() {
  if (selectedExportFormat === "json") {
    const attachments = await exportReceipts();
    download(`甜點社總務完整備份-${today()}.json`, JSON.stringify({ backupVersion: 3, ...state, attachments }, null, 2), "application/json");
    state.lastBackupAt = new Date().toISOString();
    saveState();
    toast("完整備份已開始下載。");
  } else {
    download(`甜點社收支報銷合併報表-${today()}.csv`, "\ufeff" + csv(combinedReportCsvRows()), "text/csv;charset=utf-8");
    toast("合併報表已開始下載。");
  }
}

function exportLedger() {
  if (selectedExportFormat === "json") {
    download(`甜點社收支明細-${today()}.json`, JSON.stringify({ exportType: "entries", entries: state.entries }, null, 2), "application/json");
  } else {
    download(`甜點社收支明細-${today()}.csv`, "\ufeff" + csv(ledgerCsvRows()), "text/csv;charset=utf-8");
  }
}

async function exportClaims() {
  if (selectedExportFormat === "json") {
    const attachments = await exportReceipts(state.claims.map((claim) => claim.id));
    const linkedEntries = state.entries.filter((entry) => entry.claimId);
    download(`甜點社報銷明細-${today()}.json`, JSON.stringify({ exportType: "claims", claims: state.claims, linkedEntries, attachments }, null, 2), "application/json");
  } else {
    download(`甜點社報銷明細-${today()}.csv`, "\ufeff" + csv(claimsCsvRows()), "text/csv;charset=utf-8");
  }
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

