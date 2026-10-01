function isMonthLocked(dateOrMonth) {
  const month = String(dateOrMonth || "").slice(0, 7);
  return state.lockedMonths.includes(month);
}

function affectsLockedBalance(date) {
  return isValidDateValue(date) && state.lockedMonths.some((month) => date <= monthEndKey(month));
}

function isClaimLocked(claim) {
  if (!claim) return false;
  const linkedEntry = state.entries.find((entry) => entry.claimId === claim.id);
  return isMonthLocked(claim.date) || Boolean(linkedEntry && affectsLockedBalance(linkedEntry.date));
}

function accountName(accountId) {
  return state.accounts.find((account) => account.id === accountId)?.name || "未指定帳戶";
}

function isActiveEntry(entry) {
  if (!entry.claimId) return true;
  const claim = state.claims.find((item) => item.id === entry.claimId);
  return Boolean(claim && claim.status === "paid");
}

function accountBalance(accountId, endDate = "9999-12-31") {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) return 0;
  const openingDate = account.openingDate || "0001-01-01";
  if (endDate < openingDate) return 0;
  return Number(account.openingBalance) + state.entries
    .filter((entry) => isActiveEntry(entry) && entry.accountId === accountId && entry.date && entry.date >= openingDate && entry.date <= endDate)
    .reduce((sum, entry) => sum + signedAmount(entry), 0);
}

function accountExistsAt(account, endDate) {
  const openingDate = account.openingDate || "0001-01-01";
  const deletedDate = account.deletedAt ? String(account.deletedAt).slice(0, 10) : "";
  return openingDate <= endDate && (!deletedDate || endDate < deletedDate);
}

function monthEndKey(month) {
  const [year, monthNumber] = String(month || "").split("-").map(Number);
  return year && monthNumber ? dateKey(new Date(year, monthNumber, 0)) : "";
}

function currentReconciliationValues(item) {
  const calculatedBalance = accountBalance(item.accountId, monthEndKey(item.month));
  return {
    calculatedBalance,
    difference: Number(item.actualBalance) - calculatedBalance,
    stale: calculatedBalance !== Number(item.calculatedBalance)
  };
}

function incompleteReconciliationAccounts(month) {
  const endDate = monthEndKey(month);
  return state.accounts
    .filter((account) => account.active && !account.deletedAt && accountExistsAt(account, endDate))
    .filter((account) => {
      const saved = state.reconciliations.find((item) => item.month === month && item.accountId === account.id);
      return !saved || currentReconciliationValues(saved).stale;
    });
}

function purgeExpiredTrash() {
  const cutoff = Date.now() - retentionDays * dayMs;
  const before = state.trash.length;
  const expiredClaimIds = [];
  state.trash = state.trash.filter((item) => {
    const deletedAt = new Date(item.deletedAt).getTime();
    const keep = Number.isFinite(deletedAt) && deletedAt > cutoff;
    if (!keep && item.kind === "claim" && item.record?.id) expiredClaimIds.push(item.record.id);
    return keep;
  });
  if (state.trash.length === before) return;
  if (nativeStorageEnabled) {
    enqueueNativeSave(state, "自動清理後無法寫入本機資料檔。");
    if (expiredClaimIds.length) deleteReceiptsForClaims(expiredClaimIds).catch(() => {});
    return;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    if (expiredClaimIds.length) deleteReceiptsForClaims(expiredClaimIds).catch(() => {});
  } catch {
    state = loadState();
  }
}

function saveState() {
  if (nativeStorageEnabled) {
    enqueueNativeSave(state, "儲存失敗，無法寫入本機資料夾。請先下載完整備份。");
    render();
    return true;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    state = loadState();
    refreshAccountSelects();
    loadReconciliationForm();
    render();
    toast("儲存失敗，瀏覽器空間可能不足。請先下載完整備份，再移除不需要的圖片。");
    return false;
  }
  render();
  return true;
}

function enqueueNativeSave(value, failureMessage) {
  const snapshot = typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  nativeSaveQueue = nativeSaveQueue
    .catch(() => {})
    .then(() => nativeStorageCall("saveState", { state: snapshot }))
    .catch(() => toast(failureMessage));
  return nativeSaveQueue;
}

