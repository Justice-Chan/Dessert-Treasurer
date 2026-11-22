// Validating and submitting claims, receipts and their activity folders.

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
// Listing Drive folders is slow, so a month's list is kept for a few minutes. Creating an activity
// clears it; a folder made or renamed by hand in Drive shows up once the cache runs out.
const ACTIVITY_CACHE_SECONDS = 300;
const activityCacheKey = (month) => `activities:${month}`;

function listActivities(user, payload) {
  const month = /^\d{4}-\d{2}$/.test(payload.month || "") ? payload.month : currentMonth();
  const cache = CacheService.getScriptCache();
  const cached = cache.get(activityCacheKey(month));
  if (cached) return JSON.parse(cached);
  const activities = activityFolders(findMonthFolder(month)).map(({ id, name, label }) => ({ id, name, label }));
  cache.put(activityCacheKey(month), JSON.stringify(activities), ACTIVITY_CACHE_SECONDS);
  return activities;
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
  CacheService.getScriptCache().remove(activityCacheKey(monthName));
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
      forgetSummary();
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
