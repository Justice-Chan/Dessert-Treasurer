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
  if (state.trash.length === before || storageReadOnly) return;
  noteLedgerChange();
  if (tauriStorageEnabled) {
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
  if (storageReadOnly) {
    toast(readOnlyMessage, "error");
    render();
    return false;
  }
  noteLedgerChange();
  if (tauriStorageEnabled) {
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

// Saves made while a write is in flight collapse into one follow-up write of the latest state.
function enqueueNativeSave(value, failureMessage) {
  if (storageReadOnly) return Promise.reject(new Error(readOnlyMessage));
  const writeScheduled = Boolean(nativeSavePending);
  nativeSavePending = { value, failureMessage };
  if (!writeScheduled) {
    nativeSaveQueue = nativeSaveQueue
      .catch(() => {})
      .then(writePendingNativeSave);
  }
  return nativeSaveQueue;
}

// The desktop app stores one row per record, so a save sends only what changed since the last one
// that reached storage. Until something has been stored this session, the whole state goes.
async function writePendingNativeSave() {
  const { value, failureMessage } = nativeSavePending;
  nativeSavePending = null;
  const next = stateSnapshot(value);
  const changes = persistedState && stateChanges(persistedState, next);
  try {
    if (!persistedState) await nativeStorageCall("saveState", { state: JSON.parse(JSON.stringify(value)) });
    else if (changes) await nativeStorageCall("saveStateChanges", { changes });
    persistedState = next;
  } catch {
    toast(failureMessage);
  }
}

// What storage holds, as JSON text: each record of a list whose items all carry a distinct id
// (with the list's order), and every other value whole.
function isRecordList(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  return value.every((item) => item && typeof item === "object" && !Array.isArray(item)
    && typeof item.id === "string" && item.id && !ids.has(item.id) && ids.add(item.id));
}

function stateSnapshot(value) {
  const snapshot = new Map();
  Object.entries(value).forEach(([key, item]) => {
    if (item === undefined) return;
    if (isRecordList(item)) {
      snapshot.set(key, { records: new Map(item.map((record) => [record.id, JSON.stringify(record)])), order: JSON.stringify(item.map((record) => record.id)) });
    } else {
      snapshot.set(key, { value: JSON.stringify(item) });
    }
  });
  return snapshot;
}

// The records added, changed or removed, lists whose order changed, and values set or removed;
// null when nothing changed. A key that switches between list and value is cleared first.
function stateChanges(before, after) {
  const changes = { records: [], order: {}, values: {}, removedValues: [], dropped: [] };
  after.forEach((next, key) => {
    const previous = before.get(key);
    if (next.records) {
      if (previous && !previous.records) changes.removedValues.push(key);
      const stored = previous?.records || new Map();
      next.records.forEach((payload, id) => {
        if (stored.get(id) !== payload) changes.records.push({ collection: key, id, payload });
      });
      stored.forEach((_, id) => {
        if (!next.records.has(id)) changes.records.push({ collection: key, id, payload: null });
      });
      if (previous?.order !== next.order) changes.order[key] = JSON.parse(next.order);
    } else {
      if (previous?.records) changes.dropped.push(key);
      if (previous?.value !== next.value) changes.values[key] = next.value;
    }
  });
  before.forEach((previous, key) => {
    if (after.has(key)) return;
    if (previous.records) changes.dropped.push(key);
    else changes.removedValues.push(key);
  });
  const changed = changes.records.length || Object.keys(changes.order).length || Object.keys(changes.values).length
    || changes.removedValues.length || changes.dropped.length;
  return changed ? changes : null;
}

