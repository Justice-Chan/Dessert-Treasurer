async function initializeApp() {
  let shouldRemoveLegacyGrades = false;
  if (tauriStorageEnabled) {
    try {
      const savedState = await nativeStorageCall("loadState");
      shouldRemoveLegacyGrades = hasLegacyPersonGrades(savedState);
      state = normalizeState(savedState);
    } catch {
      state = normalizeState();
      toast("無法讀取本機資料，已暫時開啟空白帳本。");
    }
    if (shouldRemoveLegacyGrades) {
      try {
        await nativeStorageCall("saveState", { state });
      } catch {
        toast("年級欄位已在目前畫面移除，但暫時無法寫回本機資料。請先下載完整備份。", "error");
      }
    }
  }
  purgeExpiredTrash();
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
  updateExportUi();
  bindEvents();
  render();
  scheduleMemberImportSync();
}

initializeApp();
