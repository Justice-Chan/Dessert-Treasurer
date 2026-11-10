function normalizeImportHeader(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/[\s\-_()（）【】\[\]{}+\/&、]/g, "");
}

// Name cells may carry a department/grade label, e.g. "外文119 黃小明" or "黃小明 / 外文119".
function parseImportedName(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const separator = "[\\s\\-_/|,，、.．:：()（）\\[\\]]*";
  const labelFirst = text.match(new RegExp(`^(\\S*?\\d+(?:年級|級|年|[甲乙丙丁A-Za-z])?)${separator}([^\\d]+)$`));
  if (labelFirst && labelFirst[2].trim()) return { name: labelFirst[2].replace(/[()（）\[\]]/g, "").trim(), department: labelFirst[1].replace(/[()（）\[\]]/g, "").trim() };
  const nameFirst = text.match(new RegExp(`^([^\\d]+?)[\\s\\-_/|,，、:：(（\\[]+(\\S*\\d+(?:年級|級|年|[甲乙丙丁A-Za-z])?)[)）\\]]?$`));
  if (nameFirst && nameFirst[1].trim()) return { name: nameFirst[1].trim(), department: nameFirst[2].trim() };
  return { name: text, department: "" };
}

function importDepartmentStem(value) {
  return normalizeSearchValue(value).replace(/\s/g, "").replace(/\d.*$/, "").replace(/(學系|系所|系|所)$/, "");
}

// Matches by student ID first, then by name, including names that carry a department/grade label.
// People who share a name are told apart by department; a name that still fits several people is reported as ambiguous.
function createImportPersonMatcher(people) {
  const byStudentId = new Map(people.map((person) => [normalizeSearchValue(person.studentId), person]));
  const byName = new Map();
  people.forEach((person) => {
    const key = normalizeSearchValue(person.name);
    byName.set(key, [...(byName.get(key) || []), person]);
  });
  return (studentId, rawName, department = "") => {
    if (studentId) {
      const person = byStudentId.get(normalizeSearchValue(studentId));
      if (person) return { person, ambiguous: false };
    }
    if (!rawName) return { person: null, ambiguous: false };
    const parsed = parseImportedName(rawName);
    const keys = [rawName, parsed.name, ...String(rawName).normalize("NFKC").split(/[\s\-_/|,，、:：]+/)];
    for (const key of keys) {
      const sameName = key && byName.get(normalizeSearchValue(key));
      if (!sameName) continue;
      if (sameName.length === 1) return { person: sameName[0], ambiguous: false };
      const stem = importDepartmentStem(department || parsed.department);
      const sameDepartment = stem ? sameName.filter((person) => {
        const personStem = importDepartmentStem(person.department);
        return personStem && (personStem.startsWith(stem) || stem.startsWith(personStem));
      }) : [];
      return sameDepartment.length === 1 ? { person: sameDepartment[0], ambiguous: false } : { person: null, ambiguous: true };
    }
    return { person: null, ambiguous: false };
  };
}

function findImportHeader(rows, scope) {
  const fields = Object.entries(importHeaders(scope)).map(([field, aliases]) => [field, new Set(aliases.map(normalizeImportHeader))]);
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const columns = {};
    rows[rowIndex].forEach((value, index) => {
      const header = normalizeImportHeader(value);
      fields.forEach(([field, aliases]) => {
        if (columns[field] === undefined && aliases.has(header)) columns[field] = index;
      });
    });
    if (columns.name !== undefined || columns.studentId !== undefined) return { rowIndex, columns };
  }
  return null;
}

function importRowReader(header) {
  return (row) => (field) => header.columns[field] === undefined ? "" : String(row[header.columns[field]] ?? "").trim();
}

function emptyPersonImportPreview() {
  return {
    header: { rowIndex: -1, columns: {} },
    candidates: [],
    supplements: [],
    duplicates: 0,
    invalid: 0,
    unmatched: [],
    awaitingResponses: true
  };
}

function personImportPreview(rows, { allowEmptyLink = false } = {}) {
  const header = findImportHeader(rows, "people");
  if (!header) {
    if (allowEmptyLink && rows.length <= 1) return emptyPersonImportPreview();
    throw new Error("找不到「姓名」或「學號」欄位，請確認試算表包含其中一項標題列。");
  }
  const findPerson = createImportPersonMatcher(state.people);
  const readRow = importRowReader(header);
  const importedStudentIds = new Set();
  const importedNames = new Set();
  const candidates = [];
  const supplementsById = new Map();
  const unmatched = [];
  let duplicates = 0;
  let invalid = 0;
  rows.slice(header.rowIndex + 1).forEach((row) => {
    const value = readRow(row);
    const rawName = value("name");
    const parsedName = parseImportedName(rawName);
    const name = parsedName.name;
    const studentId = normalizeStudentId(value("studentId"));
    if (!name && !studentId) return;
    const nameKey = normalizeSearchValue(name);
    const studentIdKey = normalizeSearchValue(studentId);
    const department = (value("department") || parsedName.department).slice(0, 100);
    const email = normalizeEmail(value("email"));
    const { person: existing, ambiguous } = findPerson(studentId, rawName, value("department"));
    if (ambiguous) {
      invalid += 1;
      unmatched.push({ label: rawName, reason: "有多位同名人員，請加上學號或系別" });
      return;
    }
    if (existing) {
      const supplement = supplementsById.get(existing.id) || { id: existing.id, department: "", email: "" };
      let changed = false;
      if (!existing.department && !supplement.department && department) { supplement.department = department; changed = true; }
      if (!existing.email && !supplement.email && email) { supplement.email = email; changed = true; }
      if (changed) supplementsById.set(existing.id, supplement);
      else duplicates += 1;
      return;
    }
    if (!name || !studentId) {
      invalid += 1;
      unmatched.push({ label: rawName || studentId, reason: name ? "尚未登記，且缺少學號" : "尚未登記，且缺少姓名" });
      return;
    }
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
  return { header, candidates, supplements: [...supplementsById.values()], duplicates, invalid, unmatched, awaitingResponses: false };
}

// Names the rows an import cannot place, so a spreadsheet can be corrected without guessing which ones they were.
function renderImportUnmatched(listId, unmatched = []) {
  const list = $("#" + listId);
  const shown = unmatched.slice(0, 50);
  list.hidden = !shown.length;
  list.innerHTML = shown.map(({ label, reason }) => `<li>${escapeHtml(label)} <span>— ${escapeHtml(reason)}</span></li>`).join("")
    + (unmatched.length > shown.length ? `<li><span>另有 ${unmatched.length - shown.length} 列未列出</span></li>` : "");
}

function clearPersonImport() {
  pendingPersonImport = null;
  $("#personImportFile").value = "";
  $("#personImportUrl").value = "";
  $("#enablePersonLink").checked = true;
  $("#personImportLinkDialog").hidden = true;
  $("#personImportPreview").hidden = true;
  $("#personImportSummary").textContent = "";
  renderImportUnmatched("personImportUnmatched");
}

function showPersonImportPreview(importData) {
  pendingPersonImport = importData;
  $("#personImportLinkDialog").hidden = true;
  const recognized = Object.keys(importData.header.columns).map((field) => ({ name: "姓名", studentId: "學號", department: "系別", email: "電子郵件" }[field])).join("、");
  const connectsLink = Boolean(importData.sourceUrl && importData.enableLink);
  renderImportUnmatched("personImportUnmatched", importData.unmatched);
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

async function readImportFile(file, showPreview, clearImport) {
  if (file.size > 5 * 1024 * 1024) return toast("試算表不可超過 5 MB。", "error");
  if (!tauriStorageEnabled) return toast("試算表匯入僅支援桌面 App。", "error");
  try {
    const fileData = Array.from(new Uint8Array(await file.arrayBuffer()));
    const result = await nativeStorageCall("parseMemberSpreadsheet", { fileName: file.name, fileData });
    showPreview(result.rows || []);
  } catch (error) {
    clearImport();
    toast(error?.message || "試算表讀取失敗。", "error");
  }
}

async function readImportUrl(url, button, showPreview) {
  if (!tauriStorageEnabled) return toast("試算表匯入僅支援桌面 App。", "error");
  button.disabled = true;
  button.textContent = "讀取中";
  try {
    const result = await nativeStorageCall("importMemberSpreadsheetUrl", { url });
    showPreview(result.rows || []);
  } catch (error) {
    toast(error?.message || "無法讀取公開試算表連結。", "error");
  } finally {
    button.disabled = false;
    button.textContent = "讀取";
  }
}

async function readPersonImportFile(file) {
  if (!file) return;
  await readImportFile(file, (rows) => showPersonImportPreview({ ...personImportPreview(rows), rows, sourceUrl: "", enableLink: false }), clearPersonImport);
}

async function readPersonImportUrl() {
  const url = $("#personImportUrl").value.trim();
  if (!url) return toast("請貼上公開試算表連結。", "error");
  await readImportUrl(url, $("#importPersonUrl"), (rows) => showPersonImportPreview({ ...personImportPreview(rows, { allowEmptyLink: true }), rows, sourceUrl: url, enableLink: $("#enablePersonLink").checked }));
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

function importHeaders(scope) {
  const scopes = scope === "people" ? ["people"] : ["people", "activity"];
  return Object.fromEntries(scopes.flatMap((fieldScope) => Object.entries(importHeaderDefaults[fieldScope]).map(([field, defaults]) => {
    const { added = [], removed = [] } = state.importSynonyms[fieldScope]?.[field] || {};
    const removedKeys = new Set(removed.map(normalizeImportHeader));
    const seen = new Set();
    const aliases = [...defaults.filter((alias) => !removedKeys.has(normalizeImportHeader(alias))), ...added].filter((alias) => {
      const normalized = normalizeImportHeader(alias);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    return [field, aliases];
  })));
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
    ["synonymActivityPaidAt", "activity", "paidAt"], ["synonymActivityTransferLastFive", "activity", "transferLastFive"]
  ];
  fields.forEach(([id, scope, field]) => { $("#" + id).value = importHeaders(scope)[field].join("、"); });
}

function saveImportSynonyms(event) {
  event.preventDefault();
  const lists = {
    people: {
      name: splitImportSynonyms($("#synonymPersonName").value), studentId: splitImportSynonyms($("#synonymPersonStudentId").value),
      department: splitImportSynonyms($("#synonymPersonDepartment").value), email: splitImportSynonyms($("#synonymPersonEmail").value)
    },
    activity: {
      attendance: splitImportSynonyms($("#synonymActivityAttendance").value), payment: splitImportSynonyms($("#synonymActivityPayment").value),
      paidAt: splitImportSynonyms($("#synonymActivityPaidAt").value),
      transferLastFive: splitImportSynonyms($("#synonymActivityTransferLastFive").value)
    }
  };
  if (!lists.people.name.length || !lists.people.studentId.length) {
    toast("姓名與學號各至少保留一個可辨識的欄位名稱。", "error");
    return;
  }
  state.importSynonyms = Object.fromEntries(Object.entries(lists).map(([scope, fields]) => [
    scope,
    Object.fromEntries(Object.entries(fields).map(([field, aliases]) => [field, splitImportSynonymChanges(aliases, importHeaderDefaults[scope][field], true)]))
  ]));
  if (!saveState()) return;
  toast("匯入欄位同義詞已儲存。");
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
  const header = findImportHeader(rows, "activity");
  if (!header && peopleImport.awaitingResponses) {
    return {
      header: peopleImport.header,
      peopleImport,
      attendance: [],
      duplicateRows: 0,
      invalidRows: 0,
      unmatched: [],
      activityId: activity.id,
      awaitingResponses: true
    };
  }
  if (!header) throw new Error("找不到「姓名」或「學號」欄位，請確認試算表包含其中一項標題列。");
  const findExisting = createImportPersonMatcher(state.people);
  const findCandidate = createImportPersonMatcher(peopleImport.candidates);
  const readRow = importRowReader(header);
  const importedPeople = new Set();
  const attendance = [];
  const unmatched = [];
  let duplicateRows = 0;
  let invalidRows = 0;
  rows.slice(header.rowIndex + 1).forEach((row) => {
    const value = readRow(row);
    const name = value("name");
    const studentId = normalizeStudentId(value("studentId"));
    if (!name && !studentId) return;
    const { person: existing, ambiguous } = findExisting(studentId, name, value("department"));
    const candidate = ambiguous ? null : findCandidate(studentId, name).person;
    if (!existing && !candidate) {
      invalidRows += 1;
      unmatched.push({ label: name || studentId, reason: ambiguous ? "有多位同名人員，請加上學號或系別" : studentId && name ? "找不到此人" : name ? "尚未登記，且缺少學號" : "找不到這個學號" });
      return;
    }
    const personKey = existing ? `person:${existing.id}` : `candidate:${normalizeSearchValue(candidate.studentId)}`;
    if (importedPeople.has(personKey)) { duplicateRows += 1; return; }
    importedPeople.add(personKey);
    const status = importedAttendanceStatus(value("attendance"));
    let paidAt = normalizeImportedPaymentTime(value("paidAt"));
    const importedPaid = importedPaymentStatus(value("payment"));
    const paid = status === "attending" && (importedPaid === true || (header.columns.payment === undefined && Boolean(paidAt)));
    if (paid && header.columns.paidAt === undefined && existing) paidAt = activityRecord(activity, existing.id)?.paidAt || "";
    const rawSuffix = value("transferLastFive").normalize("NFKC");
    const transferLastFive = /^\d{1,5}$/.test(rawSuffix) ? rawSuffix.padStart(5, "0") : rawSuffix ? undefined : "";
    attendance.push({
      personId: existing?.id || "",
      candidateStudentId: candidate?.studentId || "",
      status,
      paid,
      paidAt: paid ? paidAt : "",
      ...(header.columns.transferLastFive !== undefined && transferLastFive !== undefined ? { transferLastFive } : {})
    });
  });
  return {
    header,
    peopleImport,
    attendance,
    duplicateRows,
    invalidRows,
    unmatched,
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
  renderImportUnmatched("activityImportUnmatched");
}

function showActivityImportPreview(importData) {
  pendingActivityImport = importData;
  $("#activityImportLinkDialog").hidden = true;
  const labels = { name: "姓名", studentId: "學號", department: "系別", email: "電子郵件", attendance: "參加狀態", payment: "繳費狀態", paidAt: "繳費日期", transferLastFive: "匯款後五碼" };
  const recognized = Object.keys(importData.header.columns).map((field) => labels[field]).filter(Boolean).join("、");
  const existingRecords = new Map((state.activities.find((item) => item.id === importData.activityId)?.attendance || []).map((record) => [record.personId, record]));
  const updates = importData.attendance.filter((record) => {
    const personId = record.personId;
    const current = personId && existingRecords.get(personId);
    return !current || current.status !== record.status || current.paid !== record.paid || current.paidAt !== record.paidAt || (record.transferLastFive !== undefined && (current.transferLastFive || "") !== record.transferLastFive);
  }).length;
  const peopleChanges = importData.peopleImport.candidates.length + importData.peopleImport.supplements.length;
  const connectsLink = Boolean(importData.sourceUrl && importData.enableLink);
  renderImportUnmatched("activityImportUnmatched", importData.unmatched);
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
  await readImportFile(file, (rows) => showActivityImportPreview({ ...activityImportPreview(rows, activity), rows, sourceUrl: "", enableLink: false }), clearActivityImport);
}

async function readActivityImportUrl() {
  const activity = state.activities.find((item) => item.id === $("#activityId").value);
  const url = $("#activityImportUrl").value.trim();
  if (!activity || !url) return toast("請貼上公開試算表連結。", "error");
  await readImportUrl(url, $("#importActivityUrl"), (rows) => showActivityImportPreview({ ...activityImportPreview(rows, activity, { allowEmptyLink: true }), rows, sourceUrl: url, enableLink: $("#enableActivityLink").checked }));
}

function applyActivityImport(activity, importData) {
  const peopleChanges = applyPersonImport(importData.peopleImport);
  const personByStudentId = new Map(state.people.map((person) => [normalizeSearchValue(person.studentId), person]));
  let updated = 0;
  importData.attendance.forEach((record) => {
    const personId = record.personId || personByStudentId.get(normalizeSearchValue(record.candidateStudentId))?.id;
    if (!personId) return;
    const current = activityRecord(activity, personId);
    const transferLastFive = record.transferLastFive ?? current?.transferLastFive ?? "";
    if (current && current.status === record.status && current.paid === record.paid && current.paidAt === record.paidAt && (current.transferLastFive || "") === transferLastFive) return;
    const values = { personId, status: record.status, paid: record.paid, paidAt: record.paidAt, transferLastFive };
    if (current) Object.assign(current, values);
    else activity.attendance.push(values);
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
