async function initializeApp() {
  let shouldRemoveLegacyGrades = false;
  if (tauriStorageEnabled) {
    try {
      const savedState = await nativeStorageCall("loadState");
      // Later saves send only what differs from what storage now holds.
      persistedState = stateSnapshot(savedState);
      shouldRemoveLegacyGrades = hasLegacyPersonGrades(savedState);
      state = normalizeState(savedState);
    } catch {
      state = normalizeState();
      toast("無法讀取本機資料，已暫時開啟空白帳本。");
    }
    if (shouldRemoveLegacyGrades) {
      try {
        await nativeStorageCall("saveState", { state });
        persistedState = stateSnapshot(state);
      } catch {
        toast("年級欄位已在目前畫面移除，但暫時無法寫回本機資料。請先下載完整備份。", "error");
      }
    }
  }
  agreedLedgerJson = state.ledgerSync.dirty ? null : ledgerJson();
  purgeExpiredTrash();
  applyExpenseCategories();
  setupDateControls();
  setupCategorySelects();
  refreshAccountSelects();
  resetEntryForm();
  resetClaimForm();
  resetAccountForm();
  resetPayeeForm();
  resetPersonForm();
  resetActivityForm();
  $("#reconcileMonth").value = selectedMonth;
  loadReconciliationForm();
  bindEvents();
  render();
  scheduleMemberImportSync();
  setDefaultBackupFolder();
  // Take the cloud ledger, with the web's claims merged in, each time the app opens.
  startLedgerSync();
}

initializeApp();
