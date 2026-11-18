// Listing, reviewing, editing and withdrawing claims, receipts and the overview totals.

// ---- Treasurer review ----

function listAllRequests(user, payload) {
  requireTreasurer(user);
  const status = typeof payload.status === "string" ? payload.status : "";
  const positions = new Map(permissionRows().map((cells) => [String(cells[0]).trim().toLowerCase(), positionOf(cells)]));
  return dataRows(CLAIM_SHEET, CLAIM_HEADER.length)
    .filter((row) => !status || cellText(row[COL["狀態"]]) === status)
    .map((row) => {
      const claim = claimFromRow(row);
      return {
        ...claim,
        applicantEmail: cellText(row[COL["申請人 email"]]),
        applicantName: cellText(row[COL["申請人姓名"]]),
        // People removed from 權限表 keep their claims, filed under 已離任.
        applicantPosition: positions.get(cellText(row[COL["申請人 email"]]).toLowerCase()) || "已離任",
        reviewer: cellText(row[COL["審核人"]]),
        reviewedAt: cellText(row[COL["審核時間"]])
      };
    })
    .sort(newestFirst);
}

function reviewRequest(user, payload) {
  requireTreasurer(user);
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const target = REVIEW_STATUSES.includes(payload.status) ? payload.status : "";
  if (!target) throw appError("bad_request", "不支援的審核動作。");
  const note = requiredText(payload.note, LIMITS.description, "審核備註", target === STATUS_REJECTED);
  return withLock(() => {
    const rows = dataRows(CLAIM_SHEET, CLAIM_HEADER.length);
    const index = rows.findIndex((row) => cellText(row[COL["id"]]) === id);
    if (!id || index < 0) throw missingClaim();
    const status = cellText(rows[index][COL["狀態"]]);
    if (status === target) throw appError("invalid", `這筆申請已經是「${status}」。`);
    const now = new Date().toISOString();
    // 狀態 through 更新時間 are the last five columns, written as one range.
    tab(CLAIM_SHEET).getRange(index + 2, COL["狀態"] + 1, 1, 5)
      .setValues([[target, user.email, now, note, now].map(safeCell)]);
    appendLog(user.email, `reviewRequest:${target}`, id);
    return { id, status: target };
  });
}

// Receipts are served through the backend, so nobody needs direct access to the Drive folder.
// The caller names a claim and a position, never a Drive file id.
function getAttachment(user, payload) {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const row = dataRows(CLAIM_SHEET, CLAIM_HEADER.length).find((cells) => cellText(cells[COL["id"]]) === id);
  if (!id || !row || !(user.role === "treasurer" || ownsRow(user, row))) throw missingClaim();
  const fileId = Number.isInteger(payload.index) ? attachmentIds(row)[payload.index] : null;
  if (!fileId) throw appError("not_found", "找不到這個附件。");
  let blob;
  try {
    blob = DriveApp.getFileById(fileId).getBlob();
  } catch (error) {
    console.error(error);
    throw appError("not_found", "附件已不在雲端硬碟，可能被移動或刪除。");
  }
  return { name: blob.getName(), type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

// The applicant edits their own claim: any field, the activity and the receipts. A paid claim keeps
// its amount and status; an approved or rejected one goes back to 待審核 for another look.
function editRequest(user, payload) {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const added = decodeAttachments(payload.attachments);
  const owner = (user.name || user.email.split("@")[0]).replace(/[^\p{L}\p{N}_-]/gu, "") || "applicant";
  const findRow = () => {
    const rows = dataRows(CLAIM_SHEET, CLAIM_HEADER.length);
    const index = rows.findIndex((row) => cellText(row[COL["id"]]) === id);
    if (!id || index < 0 || !ownsRow(user, rows[index])) throw missingClaim();
    return { index, row: rows[index] };
  };

  // First pass: check the claim and settle the folder, so files can be written outside the lock.
  const plan = withLock(() => {
    const { row } = findRow();
    const current = attachmentIds(row);
    const keep = Array.isArray(payload.keep) ? current.filter((_, position) => payload.keep.includes(position)) : current;
    if (keep.length + added.length > LIMITS.files) throw appError("invalid", `一次最多上傳 ${LIMITS.files} 個附件。`);
    const moving = Boolean(payload.activityId || payload.activityName);
    const activity = moving ? resolveActivity(payload, submittedMonth(row)) : { folder: claimFolder(row, current), label: cellText(row[COL["活動／社課"]]) };
    return { keep, removed: current.filter((fileId) => !keep.includes(fileId)), activity, moving };
  });

  const created = [];
  try {
    added.forEach((file, position) => {
      const name = `${Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd")}_${owner}_${id}_${Date.now()}_${position + 1}.${file.extension}`;
      created.push(plan.activity.folder.createFile(Utilities.newBlob(file.bytes, file.mimeType, name)));
    });
    const result = withLock(() => {
      const { index, row } = findRow();
      const status = cellText(row[COL["狀態"]]);
      const claim = validateClaim({ ...payload, amount: status === STATUS_PAID ? Number(row[COL["金額"]]) : payload.amount });
      const next = row.slice();
      next[COL["消費日期"]] = claim.date;
      next[COL["金額"]] = claim.amount;
      next[COL["主項目"]] = claim.parent;
      next[COL["副項目"]] = claim.child;
      next[COL["活動／社課"]] = plan.activity.label;
      next[COL["店家"]] = claim.vendor;
      next[COL["說明"]] = claim.description;
      next[COL["附件"]] = [...plan.keep, ...created.map((file) => file.getId())].join(",");
      if (status === STATUS_REJECTED || status === STATUS_APPROVED) next[COL["狀態"]] = STATUS_PENDING;
      next[COL["更新時間"]] = new Date().toISOString();
      tab(CLAIM_SHEET).getRange(index + 2, 1, 1, CLAIM_HEADER.length).setValues([next.map((cell) => safeCell(cellText(cell)))]);
      appendLog(user.email, "editRequest", id);
      return claimFromRow(next);
    });
    // Receipts follow a changed activity into its folder; removed ones go to the Drive trash.
    if (plan.moving) plan.keep.forEach((fileId) => {
      try { DriveApp.getFileById(fileId).moveTo(plan.activity.folder); } catch (error) { console.error(error); }
    });
    plan.removed.forEach((fileId) => {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (error) { console.error(error); }
    });
    return result;
  } catch (error) {
    created.forEach((file) => {
      try { file.setTrashed(true); } catch (cleanupError) { console.error(cleanupError); }
    });
    throw error;
  }
}

// The folder a claim's receipts live in: its first receipt's folder, else the activity folder of the
// same name in its month, else the month folder itself. Call inside withLock.
function claimFolder(row, fileIds) {
  try {
    if (fileIds.length) return DriveApp.getFileById(fileIds[0]).getParents().next();
  } catch (error) {
    console.error(error);
  }
  const month = monthFolder(submittedMonth(row));
  const match = activityFolders(month).find((item) => item.label === cellText(row[COL["活動／社課"]]));
  return match ? match.folder : month;
}

// Removes the claim row and moves its receipts to the Drive trash (recoverable for 30 days).
// The log row is the only remaining trace, and tells the app sync which id disappeared.
function withdrawRequest(user, payload) {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) throw missingClaim();
  const fileIds = withLock(() => {
    const rows = dataRows(CLAIM_SHEET, CLAIM_HEADER.length);
    const index = rows.findIndex((row) => cellText(row[COL["id"]]) === id);
    const row = rows[index];
    if (!row || !(user.role === "treasurer" || ownsRow(user, row))) throw missingClaim();
    if (!WITHDRAWABLE.includes(cellText(row[COL["狀態"]]))) {
      throw appError("invalid", "已核准或已付款的申請不能撤銷，請聯絡總務。");
    }
    tab(CLAIM_SHEET).deleteRow(index + 2);
    appendLog(user.email, "withdrawRequest", id);
    return attachmentIds(row);
  });
  fileIds.forEach((fileId) => {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (error) { console.error(error); }
  });
  return { id };
}

// Totals only; the summary tab must never hold personal data.
// syncedAt says how fresh the totals are; only the treasurer gets the review count.
function getSummary(user) {
  const summary = {
    items: dataRows(SUMMARY_SHEET, SUMMARY_HEADER.length)
      .map((row) => ({ label: cellText(row[0]), amount: Number(row[1]) }))
      .filter((item) => item.label && Number.isFinite(item.amount)),
    syncedAt: PropertiesService.getScriptProperties().getProperty(SYNCED_AT_PROPERTY) || ""
  };
  if (user.role === "treasurer") {
    summary.pendingReview = dataRows(CLAIM_SHEET, CLAIM_HEADER.length)
      .filter((row) => cellText(row[COL["狀態"]]) === STATUS_PENDING).length;
  }
  return summary;
}
