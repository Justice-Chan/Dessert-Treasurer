const personImportHeaders = {
  name: ["姓名", "名字", "name", "membername", "學生姓名"],
  studentId: ["學號", "學生學號", "學生編號", "studentid", "studentnumber", "studentno"],
  department: ["系別", "系所", "科系", "學系", "系級", "系別年級", "班級", "department", "major", "departmentgrade"],
  email: ["電子郵件", "電子郵件地址", "電子郵箱", "email", "emailaddress", "emailbox", "mail", "e-mail"]
};

function normalizeImportHeader(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/[\s\-_()（）【】\[\]{}]/g, "");
}

function findPersonImportHeader(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const columns = {};
    rows[rowIndex].forEach((value, index) => {
      const header = normalizeImportHeader(value);
      Object.entries(importHeaders("people")).forEach(([field, aliases]) => {
        if (columns[field] === undefined && aliases.map(normalizeImportHeader).includes(header)) columns[field] = index;
      });
    });
    if (columns.name !== undefined || columns.studentId !== undefined) return { rowIndex, columns };
  }
  return null;
}

function emptyPersonImportPreview() {
  return {
    header: { rowIndex: -1, columns: {} },
    candidates: [],
    supplements: [],
    duplicates: 0,
    invalid: 0,
    awaitingResponses: true
  };
}

function personImportPreview(rows, { allowEmptyLink = false } = {}) {
  const header = findPersonImportHeader(rows);
  if (!header) {
    if (allowEmptyLink && rows.length <= 1) return emptyPersonImportPreview();
    throw new Error("找不到「姓名」或「學號」欄位，請確認試算表包含其中一項標題列。");
  }
  const peopleByStudentId = new Map(state.people.map((person) => [normalizeSearchValue(person.studentId), person]));
  const peopleByName = new Map(state.people.map((person) => [normalizeSearchValue(person.name), person]));
  const importedStudentIds = new Set();
  const importedNames = new Set();
  const candidates = [];
  const supplementsById = new Map();
  let duplicates = 0;
  let invalid = 0;
  rows.slice(header.rowIndex + 1).forEach((row) => {
    const value = (field) => header.columns[field] === undefined ? "" : String(row[header.columns[field]] || "").trim();
    const name = value("name");
    const studentId = normalizeStudentId(value("studentId"));
    if (!name && !studentId) return;
    const nameKey = normalizeSearchValue(name);
    const studentIdKey = normalizeSearchValue(studentId);
    const department = value("department").slice(0, 100);
    const email = normalizeEmail(value("email"));
    const existing = (studentId && peopleByStudentId.get(studentIdKey)) || (name && peopleByName.get(nameKey));
    if (existing) {
      const supplement = supplementsById.get(existing.id) || { id: existing.id, department: "", email: "" };
      let changed = false;
      if (!existing.department && !supplement.department && department) { supplement.department = department; changed = true; }
      if (!existing.email && !supplement.email && email) { supplement.email = email; changed = true; }
      if (changed) supplementsById.set(existing.id, supplement);
      else duplicates += 1;
      return;
    }
    if (!name || !studentId) { invalid += 1; return; }
    if (importedNames.has(nameKey) || importedStudentIds.has(studentIdKey)) {
      duplicates += 1;
      return;
    }
    importedNames.add(nameKey);
    importedStudentIds.add(studentIdKey);
    candidates.push({
      name: name.slice(0, 80),
      studentId,
      department,
      email
    });
  });
  return { header, candidates, supplements: [...supplementsById.values()], duplicates, invalid, awaitingResponses: false };
}

function clearPersonImport() {
  pendingPersonImport = null;
  $("#personImportFile").value = "";
  $("#personImportUrl").value = "";
  $("#enablePersonLink").checked = true;
  $("#personImportLinkDialog").hidden = true;
  $("#personImportPreview").hidden = true;
  $("#personImportSummary").textContent = "";
}

function showPersonImportPreview(importData) {
  pendingPersonImport = importData;
  $("#personImportLinkDialog").hidden = true;
  const recognized = Object.keys(importData.header.columns).map((field) => ({ name: "姓名", studentId: "學號", department: "系別", email: "電子郵件" }[field])).join("、");
  const connectsLink = Boolean(importData.sourceUrl && importData.enableLink);
  if (importData.awaitingResponses) {
    $("#personImportSummary").textContent = `連結可正常讀取，目前尚未收到表單回覆。${connectsLink ? "確認後會先啟用連線，之後開啟 App 時自動同步。" : ""}`;
    $("#confirmPersonImport").textContent = connectsLink ? "啟用連線" : "尚未有可匯入的人員";
    $("#confirmPersonImport").disabled = !connectsLink;
    $("#personImportPreview").hidden = false;
    return;
  }
  $("#personImportSummary").textContent = `已辨識欄位：${recognized}。可新增 ${importData.candidates.length} 位；補齊 ${importData.supplements.length} 位；略過完整重複 ${importData.duplicates} 列、無法對應人員 ${importData.invalid} 列。${connectsLink ? "確認後會啟用開啟 App 時的自動同步。" : ""}`;
  const actionable = importData.candidates.length + importData.supplements.length + Number(connectsLink);
  $("#confirmPersonImport").textContent = !actionable ? "沒有可匯入的人員" : connectsLink ? "匯入並啟用連線" : `新增／補齊 ${actionable} 位人員`;
  $("#confirmPersonImport").disabled = !actionable;
  $("#personImportPreview").hidden = false;
}

async function readPersonImportFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast("試算表不可超過 5 MB。", "error");
  if (!tauriStorageEnabled) return toast("試算表匯入僅支援桌面 App。", "error");
  try {
    const fileData = Array.from(new Uint8Array(await file.arrayBuffer()));
    const result = await nativeStorageCall("parseMemberSpreadsheet", { fileName: file.name, fileData });
    showPersonImportPreview({ ...personImportPreview(result.rows || []), rows: result.rows || [], sourceUrl: "", enableLink: false });
  } catch (error) {
    clearPersonImport();
    toast(error?.message || "試算表讀取失敗。", "error");
  }
}

async function readPersonImportUrl() {
  const url = $("#personImportUrl").value.trim();
  if (!url) return toast("請貼上公開試算表連結。", "error");
  if (!tauriStorageEnabled) return toast("試算表匯入僅支援桌面 App。", "error");
  const button = $("#importPersonUrl");
  button.disabled = true;
  button.textContent = "讀取中";
  try {
    const result = await nativeStorageCall("importMemberSpreadsheetUrl", { url });
    showPersonImportPreview({ ...personImportPreview(result.rows || [], { allowEmptyLink: true }), rows: result.rows || [], sourceUrl: url, enableLink: $("#enablePersonLink").checked });
  } catch (error) {
    toast(error?.message || "無法讀取公開試算表連結。", "error");
  } finally {
    button.disabled = false;
    button.textContent = "讀取";
  }
}

function applyPersonImport(importData) {
  state.people.push(...importData.candidates.map((person) => ({ ...person, id: uid() })));
  importData.supplements.forEach((supplement) => {
    const person = state.people.find((item) => item.id === supplement.id);
    if (!person) return;
    if (!person.department && supplement.department) person.department = supplement.department;
    if (!person.email && supplement.email) person.email = supplement.email;
  });
  return { added: importData.candidates.length, supplemented: importData.supplements.length };
}

const activityImportHeaders = {
  ...personImportHeaders,
  attendance: ["參加狀態", "參與狀態", "出席狀態", "參加", "出席", "attendance", "attendancestatus", "participation", "participationstatus"],
  payment: ["匯款狀態", "繳費狀態", "繳款狀態", "付款狀態", "對帳狀態", "匯款", "繳費", "繳款", "付款", "payment", "paymentstatus", "paid", "paidstatus"],
  paidAt: ["匯款日期", "繳費日期", "繳款日期", "付款日期", "匯款時間", "繳費時間", "繳款時間", "付款時間", "paymentdate", "paymenttime", "paidat"]
};

function importHeaders(scope) {
  const aliasesFor = (defaults, configured) => {
    const seen = new Set();
    const values = state.importSynonyms.mode === "editable" ? configured : [...defaults, ...configured];
    return values.filter((alias) => {
      const normalized = normalizeImportHeader(alias);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  };
  const people = Object.fromEntries(Object.entries(personImportHeaders).map(([field, defaults]) => [field, aliasesFor(defaults, state.importSynonyms.people[field] || [])]));
  if (scope === "people") return people;
  return {
    ...people,
    attendance: aliasesFor(activityImportHeaders.attendance, state.importSynonyms.activity.attendance || []),
    payment: aliasesFor(activityImportHeaders.payment, state.importSynonyms.activity.payment || []),
    paidAt: aliasesFor(activityImportHeaders.paidAt, state.importSynonyms.activity.paidAt || [])
  };
}

function splitImportSynonyms(value) {
  const seen = new Set();
  return String(value || "").split(/[、,，\n]/).map((item) => item.trim().slice(0, 100)).filter((item) => {
    const normalized = normalizeImportHeader(item);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 30);
}

function renderImportSynonymSettings() {
  const fields = [
    ["synonymPersonName", "people", "name"], ["synonymPersonStudentId", "people", "studentId"],
    ["synonymPersonDepartment", "people", "department"], ["synonymPersonEmail", "people", "email"],
    ["synonymActivityAttendance", "activity", "attendance"], ["synonymActivityPayment", "activity", "payment"],
    ["synonymActivityPaidAt", "activity", "paidAt"]
  ];
  fields.forEach(([id, scope, field]) => { $("#" + id).value = importHeaders(scope)[field].join("、"); });
}

function saveImportSynonyms(event) {
  event.preventDefault();
  const nextSynonyms = {
    mode: "editable",
    people: {
      name: splitImportSynonyms($("#synonymPersonName").value), studentId: splitImportSynonyms($("#synonymPersonStudentId").value),
      department: splitImportSynonyms($("#synonymPersonDepartment").value), email: splitImportSynonyms($("#synonymPersonEmail").value)
    },
    activity: {
      attendance: splitImportSynonyms($("#synonymActivityAttendance").value), payment: splitImportSynonyms($("#synonymActivityPayment").value),
      paidAt: splitImportSynonyms($("#synonymActivityPaidAt").value)
    }
  };
  if (!nextSynonyms.people.name.length || !nextSynonyms.people.studentId.length) {
    toast("姓名與學號各至少保留一個可辨識的欄位名稱。", "error");
    return;
  }
  state.importSynonyms = nextSynonyms;
  if (!saveState()) return;
  toast("匯入欄位同義詞已儲存。");
}

function findActivityImportHeader(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const columns = {};
    rows[rowIndex].forEach((value, index) => {
      const header = normalizeImportHeader(value);
      Object.entries(importHeaders("activity")).forEach(([field, aliases]) => {
        if (columns[field] === undefined && aliases.map(normalizeImportHeader).includes(header)) columns[field] = index;
      });
    });
    if (columns.name !== undefined || columns.studentId !== undefined) return { rowIndex, columns };
  }
  return null;
}

function importedAttendanceStatus(value) {
  const normalized = normalizeSearchValue(value).replace(/[\s・,，;；:：()（）]/g, "");
  if (!normalized) return "attending";
  if (["未參加", "不參加", "缺席", "否", "no", "n", "false", "0"].some((item) => normalized === item || normalized.includes(item))) return "not_attending";
  return "attending";
}

function importedPaymentStatus(value) {
  const normalized = normalizeSearchValue(value).replace(/[\s・,，;；:：()（）]/g, "");
  if (!normalized) return null;
  if (["未繳", "未付款", "未匯款", "待繳", "待付款", "待匯款", "否", "no", "n", "false", "0", "unpaid", "pending"].some((item) => normalized === item || normalized.includes(item))) return false;
  if (["已繳", "已付款", "已匯款", "已收款", "已確認", "完成", "是", "yes", "y", "true", "1", "paid", "completed"].some((item) => normalized === item || normalized.includes(item))) return true;
  return null;
}

function normalizeImportedPaymentTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const serial = Number(raw);
  if (/^\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(serial) && serial >= 1 && serial <= 90000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
    return normalizePaymentTime(`${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`);
  }
  const text = raw.normalize("NFKC").replace(/[年月]/g, "-").replace(/日/g, " ").replace(/[T／]/g, " ").replace(/[：]/g, ":");
  const match = text.match(/(?:\d{2,4}[-\/]?)?(\d{1,2})[-\/](\d{1,2})\s+([01]?\d|2[0-3]):([0-5]\d)/);
  if (!match) return "";
  return normalizePaymentTime(`${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")} ${match[3].padStart(2, "0")}:${match[4]}`);
}

function activityImportPreview(rows, activity, options = {}) {
  const peopleImport = personImportPreview(rows, options);
  const header = findActivityImportHeader(rows);
  if (!header && peopleImport.awaitingResponses) {
    return {
      header: peopleImport.header,
      peopleImport,
      attendance: [],
      duplicateRows: 0,
      invalidRows: 0,
      activityId: activity.id,
      awaitingResponses: true
    };
  }
  if (!header) throw new Error("找不到「姓名」或「學號」欄位，請確認試算表包含其中一項標題列。");
  const existingByStudentId = new Map(state.people.map((person) => [normalizeSearchValue(person.studentId), person]));
  const existingByName = new Map(state.people.map((person) => [normalizeSearchValue(person.name), person]));
  const candidateByStudentId = new Map(peopleImport.candidates.map((person) => [normalizeSearchValue(person.studentId), person]));
  const candidateByName = new Map(peopleImport.candidates.map((person) => [normalizeSearchValue(person.name), person]));
  const importedPeople = new Set();
  const attendance = [];
  let duplicateRows = 0;
  let invalidRows = 0;
  rows.slice(header.rowIndex + 1).forEach((row) => {
    const value = (field) => header.columns[field] === undefined ? "" : String(row[header.columns[field]] || "").trim();
    const name = value("name");
    const studentId = normalizeStudentId(value("studentId"));
    if (!name && !studentId) return;
    const existing = (studentId && existingByStudentId.get(normalizeSearchValue(studentId))) || (name && existingByName.get(normalizeSearchValue(name)));
    const candidate = (studentId && candidateByStudentId.get(normalizeSearchValue(studentId))) || (name && candidateByName.get(normalizeSearchValue(name)));
    if (!existing && !candidate) { invalidRows += 1; return; }
    const personKey = existing ? `person:${existing.id}` : `candidate:${normalizeSearchValue(candidate.studentId)}`;
    if (importedPeople.has(personKey)) { duplicateRows += 1; return; }
    importedPeople.add(personKey);
    const status = importedAttendanceStatus(value("attendance"));
    const paidAt = normalizeImportedPaymentTime(value("paidAt"));
    const importedPaid = importedPaymentStatus(value("payment"));
    const paid = status === "attending" && (importedPaid === true || (header.columns.payment === undefined && Boolean(paidAt)));
    attendance.push({
      personId: existing?.id || "",
      candidateStudentId: candidate?.studentId || "",
      status,
      paid,
      paidAt: paid ? paidAt : ""
    });
  });
  return {
    header,
    peopleImport,
    attendance,
    duplicateRows,
    invalidRows,
    activityId: activity.id,
    awaitingResponses: false
  };
}

function clearActivityImport() {
  pendingActivityImport = null;
  $("#activityImportFile").value = "";
  $("#activityImportUrl").value = "";
  $("#enableActivityLink").checked = true;
  $("#activityImportDialog").hidden = true;
  $("#activityImportLinkDialog").hidden = true;
  $("#activityImportPreview").hidden = true;
  $("#activityImportSummary").textContent = "";
}

function showActivityImportPreview(importData) {
  pendingActivityImport = importData;
  $("#activityImportLinkDialog").hidden = true;
  const labels = { name: "姓名", studentId: "學號", department: "系別", email: "電子郵件", attendance: "參加狀態", payment: "繳費狀態", paidAt: "繳費日期" };
  const recognized = Object.keys(importData.header.columns).map((field) => labels[field]).filter(Boolean).join("、");
  const existingRecords = new Map((state.activities.find((item) => item.id === importData.activityId)?.attendance || []).map((record) => [record.personId, record]));
  const updates = importData.attendance.filter((record) => {
    const personId = record.personId;
    const current = personId && existingRecords.get(personId);
    return !current || current.status !== record.status || current.paid !== record.paid || current.paidAt !== record.paidAt;
  }).length;
  const peopleChanges = importData.peopleImport.candidates.length + importData.peopleImport.supplements.length;
  const connectsLink = Boolean(importData.sourceUrl && importData.enableLink);
  if (importData.awaitingResponses) {
    $("#activityImportSummary").textContent = `連結可正常讀取，目前尚未收到表單回覆。${connectsLink ? "確認後會先啟用活動名單連線，之後開啟 App 時自動同步。" : ""}`;
    $("#confirmActivityImport").textContent = connectsLink ? "啟用連線" : "尚未有可匯入的資料";
    $("#confirmActivityImport").disabled = !connectsLink;
    $("#activityImportPreview").hidden = false;
    return;
  }
  $("#activityImportSummary").textContent = `已辨識欄位：${recognized}。可新增 ${importData.peopleImport.candidates.length} 位、補齊 ${importData.peopleImport.supplements.length} 位人員；將登記或更新 ${updates} 筆活動狀態。略過重複 ${importData.duplicateRows} 列、無法對應人員 ${importData.invalidRows} 列。${connectsLink ? "確認後會啟用開啟 App 時的自動同步。" : ""}`;
  const actionable = peopleChanges + updates + Number(connectsLink);
  $("#confirmActivityImport").textContent = !actionable ? "沒有可匯入的資料" : connectsLink ? "匯入並啟用連線" : `匯入 ${importData.attendance.length} 位活動人員`;
  $("#confirmActivityImport").disabled = !actionable;
  $("#activityImportPreview").hidden = false;
}

async function readActivityImportFile(file) {
  const activity = state.activities.find((item) => item.id === $("#activityId").value);
  if (!file || !activity) return;
  if (file.size > 5 * 1024 * 1024) return toast("試算表不可超過 5 MB。", "error");
  if (!tauriStorageEnabled) return toast("試算表匯入僅支援桌面 App。", "error");
  try {
    const fileData = Array.from(new Uint8Array(await file.arrayBuffer()));
    const result = await nativeStorageCall("parseMemberSpreadsheet", { fileName: file.name, fileData });
    showActivityImportPreview({ ...activityImportPreview(result.rows || [], activity), rows: result.rows || [], sourceUrl: "", enableLink: false });
  } catch (error) {
    clearActivityImport();
    toast(error?.message || "試算表讀取失敗。", "error");
  }
}

async function readActivityImportUrl() {
  const activity = state.activities.find((item) => item.id === $("#activityId").value);
  const url = $("#activityImportUrl").value.trim();
  if (!activity || !url) return toast("請貼上公開試算表連結。", "error");
  if (!tauriStorageEnabled) return toast("試算表匯入僅支援桌面 App。", "error");
  const button = $("#importActivityUrl");
  button.disabled = true;
  button.textContent = "讀取中";
  try {
    const result = await nativeStorageCall("importMemberSpreadsheetUrl", { url });
    showActivityImportPreview({ ...activityImportPreview(result.rows || [], activity, { allowEmptyLink: true }), rows: result.rows || [], sourceUrl: url, enableLink: $("#enableActivityLink").checked });
  } catch (error) {
    toast(error?.message || "無法讀取公開試算表連結。", "error");
  } finally {
    button.disabled = false;
    button.textContent = "讀取";
  }
}

function applyActivityImport(activity, importData) {
  const peopleChanges = applyPersonImport(importData.peopleImport);
  const personByStudentId = new Map(state.people.map((person) => [normalizeSearchValue(person.studentId), person]));
  let updated = 0;
  importData.attendance.forEach((record) => {
    const personId = record.personId || personByStudentId.get(normalizeSearchValue(record.candidateStudentId))?.id;
    if (!personId) return;
    const current = activityRecord(activity, personId);
    if (current && current.status === record.status && current.paid === record.paid && current.paidAt === record.paidAt) return;
    if (current) Object.assign(current, { personId, status: record.status, paid: record.paid, paidAt: record.paidAt });
    else activity.attendance.push({ personId, status: record.status, paid: record.paid, paidAt: record.paidAt });
    updated += 1;
  });
  return { ...peopleChanges, updated };
}

function confirmActivityImport() {
  if (!pendingActivityImport) return;
  const activity = state.activities.find((item) => item.id === pendingActivityImport.activityId);
  if (!activity || $("#activityId").value !== activity.id) return toast("活動已切換，請重新選擇試算表。", "error");
  const importData = { ...activityImportPreview(pendingActivityImport.rows, activity, { allowEmptyLink: Boolean(pendingActivityImport.sourceUrl && pendingActivityImport.enableLink) }), sourceUrl: pendingActivityImport.sourceUrl || "", enableLink: Boolean(pendingActivityImport.enableLink) };
  const connectsLink = Boolean(importData.sourceUrl && importData.enableLink);
  const changes = applyActivityImport(activity, importData);
  if (!changes.added && !changes.supplemented && !changes.updated && !connectsLink) return showActivityImportPreview(importData);
  if (connectsLink) activity.importLink = { url: importData.sourceUrl, lastSyncedAt: new Date().toISOString() };
  if (!saveState()) return;
  clearActivityImport();
  renderPeople();
  toast(connectsLink
    ? `已新增 ${changes.added} 位、補齊 ${changes.supplemented} 位，更新 ${changes.updated} 筆活動狀態，活動名單連線已啟用。`
    : `已新增 ${changes.added} 位、補齊 ${changes.supplemented} 位人員，更新 ${changes.updated} 筆活動狀態。`
  );
}

async function syncMemberImportLink({ quiet = false } = {}) {
  const link = state.memberImportLink;
  if (!link?.url || !tauriStorageEnabled || memberImportSyncing) return;
  memberImportSyncing = true;
  renderMemberImportLink();
  try {
    const result = await nativeStorageCall("importMemberSpreadsheetUrl", { url: link.url });
    const changes = applyPersonImport(personImportPreview(result.rows || [], { allowEmptyLink: true }));
    link.lastSyncedAt = new Date().toISOString();
    if (!saveState()) return;
    if (!quiet || changes.added || changes.supplemented) {
      toast(changes.added || changes.supplemented
        ? `名單連線已新增 ${changes.added} 位，補齊 ${changes.supplemented} 位。`
        : "名單連線已同步，沒有新資料。"
      );
    }
  } catch (error) {
    toast(quiet ? "名單連線同步失敗，原有人員資料已保留。" : (error?.message || "名單連線同步失敗，原有人員資料已保留。"), "error");
  } finally {
    memberImportSyncing = false;
    renderMemberImportLink();
  }
}

async function syncActivityImportLink(activityId, { quiet = false } = {}) {
  const activity = state.activities.find((item) => item.id === activityId);
  const link = activity?.importLink;
  if (!activity || !link?.url || !tauriStorageEnabled || activityImportSyncing.has(activityId)) return;
  activityImportSyncing.add(activityId);
  renderPeople();
  try {
    const result = await nativeStorageCall("importMemberSpreadsheetUrl", { url: link.url });
    const changes = applyActivityImport(activity, activityImportPreview(result.rows || [], activity, { allowEmptyLink: true }));
    link.lastSyncedAt = new Date().toISOString();
    if (!saveState()) return;
    if (!quiet || changes.added || changes.supplemented || changes.updated) {
      toast(changes.added || changes.supplemented || changes.updated
        ? `「${activity.name}」已新增 ${changes.added} 位、補齊 ${changes.supplemented} 位，更新 ${changes.updated} 筆狀態。`
        : `「${activity.name}」名單連線已同步，沒有新資料。`
      );
    }
  } catch (error) {
    toast(quiet ? `「${activity.name}」名單連線同步失敗，原有資料已保留。` : (error?.message || `「${activity.name}」名單連線同步失敗，原有資料已保留。`), "error");
  } finally {
    activityImportSyncing.delete(activityId);
    renderPeople();
  }
}

async function syncActivityImportLinks({ quiet = false } = {}) {
  const ids = state.activities.filter((activity) => activity.importLink?.url).map((activity) => activity.id);
  for (const id of ids) await syncActivityImportLink(id, { quiet });
}

function confirmPersonImport() {
  if (!pendingPersonImport) return;
  const importData = { ...personImportPreview(pendingPersonImport.rows, { allowEmptyLink: Boolean(pendingPersonImport.sourceUrl && pendingPersonImport.enableLink) }), sourceUrl: pendingPersonImport.sourceUrl || "", enableLink: Boolean(pendingPersonImport.enableLink) };
  const connectsLink = Boolean(importData.sourceUrl && importData.enableLink);
  if (!importData.candidates.length && !importData.supplements.length && !connectsLink) return showPersonImportPreview(importData);
  const changes = applyPersonImport(importData);
  if (connectsLink) state.memberImportLink = { url: importData.sourceUrl, lastSyncedAt: new Date().toISOString() };
  if (!saveState()) return;
  clearPersonImport();
  renderPeople();
  toast(connectsLink
    ? `已新增 ${changes.added} 位，補齊 ${changes.supplemented} 位，名單連線已啟用。`
    : `已新增 ${changes.added} 位，補齊 ${changes.supplemented} 位人員資料。`
  );
}

