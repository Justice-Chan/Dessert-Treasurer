// The desktop app's sync, authorised by SYNC_SECRET.

// ---- Desktop app sync ----

// Compares every character so the response time does not reveal how much of a guess was right.
function verifySyncSecret(secret) {
  const expected = property("SYNC_SECRET");
  const given = typeof secret === "string" ? secret : "";
  let difference = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ (given.charCodeAt(index) || 0);
  }
  if (difference !== 0 || expected.length < 32) throw appError("unauthorized", "同步金鑰不正確。");
}

function driveLink(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

// Every claim, plus the ids the 操作紀錄 shows as withdrawn so the app can drop them.
function syncPull() {
  const claims = dataRows(CLAIM_SHEET, CLAIM_HEADER.length).map((row) => {
    const claim = claimFromRow(row);
    return {
      id: claim.id,
      createdAt: claim.createdAt,
      applicantEmail: cellText(row[COL["申請人 email"]]),
      applicantName: cellText(row[COL["申請人姓名"]]),
      date: claim.date,
      amount: claim.amount,
      parent: claim.parent,
      child: claim.child,
      activity: claim.activity,
      vendor: claim.vendor,
      description: claim.description,
      status: claim.status,
      reviewNote: claim.reviewNote,
      receiptLinks: attachmentIds(row).map(driveLink)
    };
  }).filter((claim) => claim.id);
  const withdrawnIds = dataRows(LOG_SHEET, LOG_HEADER.length)
    .filter((row) => cellText(row[2]) === "withdrawRequest")
    .map((row) => cellText(row[3]))
    .filter(Boolean);
  return { claims, withdrawnIds: [...new Set(withdrawnIds)], categories: CATEGORIES };
}

function syncSummaryRows(value) {
  if (!Array.isArray(value) || value.length > SYNC_LIMITS.summaryRows) throw appError("bad_request", "財務彙總格式不正確。");
  return value.map((item) => {
    const label = item && typeof item.label === "string" ? item.label.trim() : "";
    const amount = item ? item.amount : NaN;
    if (!label || label.length > SYNC_LIMITS.label || typeof amount !== "number" || !Number.isFinite(amount) || Math.abs(amount) > SYNC_LIMITS.amount) {
      throw appError("bad_request", "財務彙總格式不正確。");
    }
    return [safeCell(label), Math.round(amount)];
  });
}

// Replaces the summary tab as a whole. Claim statuses are never changed here.
function syncPush(payload) {
  const summary = syncSummaryRows(payload.summary);
  return withLock(() => {
    const summaryTab = tab(SUMMARY_SHEET, SUMMARY_HEADER, true);
    if (summaryTab.getLastRow() > 1) summaryTab.getRange(2, 1, summaryTab.getLastRow() - 1, SUMMARY_HEADER.length).clearContent();
    if (summary.length) summaryTab.getRange(2, 1, summary.length, SUMMARY_HEADER.length).setValues(summary);
    PropertiesService.getScriptProperties().setProperty(SYNCED_AT_PROPERTY, new Date().toISOString());
    return { summaryRows: summary.length };
  });
}
