function bindAsyncSubmit(form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.saving === "true") return;
    const submitButton = form.querySelector('button[type="submit"]');
    form.dataset.saving = "true";
    if (submitButton) submitButton.disabled = true;
    try {
      await handler(event);
    } finally {
      delete form.dataset.saving;
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function closeActionMenus(except) {
  $$("[data-action-menu]").forEach((menu) => {
    if (menu === except) return;
    menu.querySelector(".action-menu-list").hidden = true;
    menu.querySelector(".action-menu-trigger").setAttribute("aria-expanded", "false");
  });
}

function bindActionMenus() {
  $$("[data-action-menu]").forEach((menu) => {
    const trigger = menu.querySelector(".action-menu-trigger");
    const list = menu.querySelector(".action-menu-list");
    const items = () => [...list.querySelectorAll('[role="menuitem"]:not(:disabled):not([hidden])')];
    trigger.addEventListener("click", () => {
      const open = list.hidden;
      closeActionMenus(menu);
      list.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) items()[0]?.focus();
    });
    list.addEventListener("click", (event) => {
      if (event.target.closest('[role="menuitem"]')) closeActionMenus();
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !list.hidden) {
        event.stopPropagation();
        closeActionMenus();
        trigger.focus();
      } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !list.hidden) {
        event.preventDefault();
        const options = items();
        const index = options.indexOf(document.activeElement);
        options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
      }
    });
  });
  document.addEventListener("click", (event) => {
    const rowMenu = event.target.closest("[data-row-menu]");
    if (rowMenu) {
      const list = rowMenu.nextElementSibling;
      const open = list.hidden;
      closeActionMenus();
      // Fixed to the window, so a scrolling table cannot clip it.
      const bounds = rowMenu.getBoundingClientRect();
      Object.assign(list.style, { position: "fixed", top: `${bounds.bottom + 6}px`, right: `${window.innerWidth - bounds.right}px`, left: "auto" });
      list.hidden = !open;
      rowMenu.setAttribute("aria-expanded", String(open));
      return;
    }
    if (!event.target.closest("[data-action-menu]") || event.target.closest(".row-menu [role=\"menuitem\"]")) closeActionMenus();
  });
}

function bindEvents() {
  bindActionMenus();
  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.section;
      $$(".nav-button").forEach((item) => item.removeAttribute("aria-current"));
      button.setAttribute("aria-current", "page");
      $$(".section").forEach((node) => node.classList.toggle("active", node.id === section));
      $("#pageTitle").textContent = sectionMeta[section][0];
      $("#pageSubtitle").textContent = sectionMeta[section][1];
      renderCurrentSection(section);
      requestAnimationFrame(syncScrollableLists);
    });
  });

  $("#entryType").addEventListener("change", () => {
    const type = $("#entryType").value;
    setSelectOptions($("#entryParent"), parentOptions(type));
    updateChildSelect(type, $("#entryParent"), $("#entryChild"));
  });
  $("#entryParent").addEventListener("change", () => updateChildSelect($("#entryType").value, $("#entryParent"), $("#entryChild")));
  $("#entryChild").addEventListener("change", () => syncOtherFields("entry"));
  $("#claimParent").addEventListener("change", () => updateChildSelect("expense", $("#claimParent"), $("#claimChild")));
  $("#claimChild").addEventListener("change", () => syncOtherFields("claim"));
  $("#entryForm").addEventListener("submit", upsertEntry);
  bindAsyncSubmit($("#claimForm"), upsertClaim);
  $("#claimPaymentForm").addEventListener("submit", payClaim);
  bindAsyncSubmit($("#accountForm"), upsertAccount);
  bindAsyncSubmit($("#payeeForm"), upsertPayee);
  $("#personForm").addEventListener("submit", upsertPerson);
  const closePersonImportLinkDialog = () => { $("#personImportLinkDialog").hidden = true; };
  $("#cancelPersonImportLink").addEventListener("click", closePersonImportLinkDialog);
  $("#personImportLinkDialog").addEventListener("click", (event) => {
    if (event.target === $("#personImportLinkDialog")) closePersonImportLinkDialog();
  });
  $("#choosePersonImport").addEventListener("click", () => $("#personImportFile").click());
  $("#personImportFile").addEventListener("change", () => readPersonImportFile($("#personImportFile").files[0]));
  $("#openPersonImportLink").addEventListener("click", () => {
    $("#personImportLinkDialog").hidden = false;
    $("#personImportUrl").focus();
  });
  $("#importPersonUrl").addEventListener("click", readPersonImportUrl);
  $("#personImportUrl").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); readPersonImportUrl(); }
  });
  $("#cancelPersonImport").addEventListener("click", clearPersonImport);
  $("#confirmPersonImport").addEventListener("click", confirmPersonImport);
  $("#syncPersonLink").addEventListener("click", () => syncMemberImportLink());
  $("#disconnectPersonLink").addEventListener("click", () => {
    if (!state.memberImportLink) return;
    requestAppActionConfirmation({
      title: "取消名單連線",
      message: "取消後不再於開啟 App 時自動同步；已匯入的人員資料會保留。",
      confirmLabel: "確認取消",
      action: () => {
        state.memberImportLink = null;
        if (!saveState()) return;
        toast("名單連線已取消。");
      }
    });
  });
  $("#importSynonymForm").addEventListener("submit", saveImportSynonyms);
  $("#webSyncForm").addEventListener("submit", saveWebSyncSettings);
  $("#autoBackupEdit").addEventListener("click", () => editFolder("backup"));
  $("#exportFolderEdit").addEventListener("click", () => editFolder("export"));
  $("#autoBackupChoose").addEventListener("click", chooseBackupFolder);
  $("#autoBackupSave").addEventListener("click", saveAutoBackupSettings);
  $("#autoBackupCancel").addEventListener("click", closeBackupFolderDialog);
  $("#backupFolderDialog").addEventListener("click", (event) => {
    if (event.target === $("#backupFolderDialog")) closeBackupFolderDialog();
  });
  $("#syncWebClaims").addEventListener("click", () => syncLedger());
  $("#resetImportSynonyms").addEventListener("click", () => {
    requestAppActionConfirmation({
      title: "還原預設同義詞",
      message: "將放棄目前的自訂名稱，恢復 App 原本的可辨識欄位名稱。",
      confirmLabel: "確認還原",
      action: () => {
        state.importSynonyms = emptyImportSynonyms();
        if (!saveState()) return;
        renderImportSynonymSettings();
        toast("匯入同義詞已還原預設。");
      }
    });
  });
  $("#activityForm").addEventListener("submit", upsertActivity);
  const closeActivityImportLinkDialog = () => { $("#activityImportLinkDialog").hidden = true; };
  // Both import choices sit in the roster's menu; they need an activity to fill.
  $("#chooseActivityImport").addEventListener("click", () => {
    if (!selectedActivityId) return toast("請先選擇一個活動。", "error");
    $("#activityImportFile").click();
  });
  $("#openActivityImportLink").addEventListener("click", () => {
    if (!selectedActivityId) return toast("請先選擇一個活動。", "error");
    $("#activityImportLinkDialog").hidden = false;
    $("#activityImportUrl").focus();
  });
  $("#cancelActivityImportLink").addEventListener("click", closeActivityImportLinkDialog);
  $("#activityImportLinkDialog").addEventListener("click", (event) => { if (event.target === $("#activityImportLinkDialog")) closeActivityImportLinkDialog(); });
  $("#activityImportFile").addEventListener("change", () => readActivityImportFile($("#activityImportFile").files[0]));
  $("#importActivityUrl").addEventListener("click", readActivityImportUrl);
  $("#activityImportUrl").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); readActivityImportUrl(); }
  });
  $("#cancelActivityImport").addEventListener("click", clearActivityImport);
  $("#confirmActivityImport").addEventListener("click", confirmActivityImport);
  $("#syncActivityLink").addEventListener("click", () => syncActivityImportLink(selectedActivityId));
  $("#disconnectActivityLink").addEventListener("click", () => {
    const activity = state.activities.find((item) => item.id === selectedActivityId);
    if (!activity?.importLink) return;
    requestAppActionConfirmation({
      title: "取消活動名單連線",
      message: "取消後不再於開啟 App 時自動同步；已匯入的人員與活動紀錄會保留。",
      confirmLabel: "確認取消",
      action: () => {
        activity.importLink = null;
        if (!saveState()) return;
        toast("活動名單連線已取消。");
      }
    });
  });
  $("#reconciliationForm").addEventListener("submit", saveReconciliation);
  $("#entryCancel").addEventListener("click", () => {
    resetEntryForm();
    renderLedger();
  });
  $("#newClaim").addEventListener("click", openClaimDialog);
  $("#claimCancel").addEventListener("click", closeClaimDialog);
  $("#claimDialog").addEventListener("click", (event) => { if (event.target === $("#claimDialog")) closeClaimDialog(); });
  $("#claimDialog").addEventListener("keydown", (event) => { if (event.key === "Escape") closeClaimDialog(); });
  $("#newAccount").addEventListener("click", () => openAccountDialog());
  $("#accountCancel").addEventListener("click", closeAccountDialog);
  $("#accountDelete").addEventListener("click", () => deleteSelectedAccount($("#accountId").value));
  $("#newPayee").addEventListener("click", () => openPayeeDialog());
  $("#payeeCancel").addEventListener("click", closePayeeDialog);
  $("#payeeDelete").addEventListener("click", () => deleteSelectedPayee($("#payeeId").value));
  [["#accountDialog", closeAccountDialog], ["#payeeDialog", closePayeeDialog]].forEach(([dialog, close]) => {
    $(dialog).addEventListener("click", (event) => { if (event.target === $(dialog)) close(); });
    $(dialog).addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  });
  $("#newPerson").addEventListener("click", () => openPersonDialog());
  $("#personCancel").addEventListener("click", closePersonDialog);
  $("#personDelete").addEventListener("click", () => deletePerson($("#personId").value));
  $("#newActivity").addEventListener("click", () => openActivityDialog());
  $("#editActivity").addEventListener("click", () => openActivityDialog(state.activities.find((item) => item.id === selectedActivityId)));
  $("#activityCancel").addEventListener("click", closeActivityDialog);
  $("#activityDelete").addEventListener("click", () => deleteActivity($("#activityId").value));
  [["#personDialog", closePersonDialog], ["#activityDialog", closeActivityDialog]].forEach(([dialog, close]) => {
    $(dialog).addEventListener("click", (event) => { if (event.target === $(dialog)) close(); });
    $(dialog).addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  });
  $("#accountType").addEventListener("change", updateAccountBankFields);
  ["accountNumber", "payeeNumber"].forEach((id) => $("#" + id).addEventListener("input", (event) => {
    event.target.value = accountDigits(event.target.value);
  }));
  $("#accountQrFile").addEventListener("change", async () => {
    const file = $("#accountQrFile").files[0];
    $("#accountQrFileName").textContent = file ? file.name : "尚未選取圖片";
    pendingAccountQrDataUrl = "";
    if (!file) return renderCurrentAccountQr(state.accounts.find((account) => account.id === $("#accountId").value));
    try {
      pendingAccountQrDataUrl = await readQrImage(file);
      removeAccountQr = false;
      renderCurrentAccountQr(null);
    } catch (error) {
      $("#accountQrFile").value = "";
      $("#accountQrFileName").textContent = "尚未選取圖片";
      renderCurrentAccountQr(state.accounts.find((account) => account.id === $("#accountId").value));
      toast(error.message);
    }
  });
  $("#accountQrCurrent").addEventListener("click", (event) => {
    if (event.target.closest("#previewPendingAccountQr") && pendingAccountQrDataUrl) {
      openAccountQrPreview(pendingAccountQrDataUrl, $("#accountName").value.trim() || "QR Code 預覽", $("#accountNumber").value.trim() ? `帳號：${$("#accountNumber").value.trim()}` : "尚未儲存");
    }
    if (event.target.closest("#removeAccountQr")) {
      removeAccountQr = true;
      pendingAccountQrDataUrl = "";
      $("#accountQrFile").value = "";
      $("#accountQrFileName").textContent = "尚未選取圖片";
      renderCurrentAccountQr(null);
    }
  });
  $("#payeeQrFile").addEventListener("change", async () => {
    const file = $("#payeeQrFile").files[0];
    $("#payeeQrFileName").textContent = file ? file.name : "尚未選取圖片";
    pendingPayeeQrDataUrl = "";
    if (!file) return renderCurrentPayeeQr(state.payees.find((payee) => payee.id === $("#payeeId").value));
    try {
      pendingPayeeQrDataUrl = await readQrImage(file);
      removePayeeQr = false;
      renderCurrentPayeeQr(null);
    } catch (error) {
      $("#payeeQrFile").value = "";
      $("#payeeQrFileName").textContent = "尚未選取圖片";
      renderCurrentPayeeQr(state.payees.find((payee) => payee.id === $("#payeeId").value));
      toast(error.message);
    }
  });
  $("#payeeQrCurrent").addEventListener("click", (event) => {
    if (event.target.closest("#previewPendingPayeeQr") && pendingPayeeQrDataUrl) {
      openAccountQrPreview(pendingPayeeQrDataUrl, $("#payeeName").value.trim() || "QR Code 預覽", $("#payeeNumber").value ? `帳號：${$("#payeeNumber").value}` : "尚未儲存");
    }
    if (event.target.closest("#removePayeeQr")) {
      removePayeeQr = true;
      pendingPayeeQrDataUrl = "";
      $("#payeeQrFile").value = "";
      $("#payeeQrFileName").textContent = "尚未選取圖片";
      renderCurrentPayeeQr(null);
    }
  });
  $("#closeAccountQr").addEventListener("click", closeAccountQrPreview);
  $("#accountQrDialog").addEventListener("click", (event) => {
    if (event.target === $("#accountQrDialog")) closeAccountQrPreview();
  });
  $("#closeAttachmentPreview").addEventListener("click", closeAttachmentPreview);
  $("#attachmentPreviewDialog").addEventListener("click", (event) => {
    if (event.target === $("#attachmentPreviewDialog")) closeAttachmentPreview();
  });
  $("#attachmentPreviewDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAttachmentPreview();
  });
  $("#closeClaimPayment").addEventListener("click", closeClaimPayment);
  $("#cancelClaimPayment").addEventListener("click", closeClaimPayment);
  $("#claimPaymentDialog").addEventListener("click", (event) => {
    if (event.target === $("#claimPaymentDialog")) closeClaimPayment();
  });
  $("#claimPaymentDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeClaimPayment();
  });
  $("#cancelAppActionConfirm").addEventListener("click", closeAppActionConfirmation);
  $("#confirmAppAction").addEventListener("click", () => {
    const action = pendingAppAction;
    closeAppActionConfirmation();
    action?.();
  });
  $("#appActionConfirmDialog").addEventListener("click", (event) => {
    if (event.target === $("#appActionConfirmDialog")) closeAppActionConfirmation();
  });
  $("#claimFiles").addEventListener("change", () => {
    const files = Array.from($("#claimFiles").files || []);
    $("#claimFilesName").textContent = files.length ? files.map((file) => file.name).join("、") : "尚未選取附件";
    const claim = state.claims.find((item) => item.id === $("#claimId").value);
    renderClaimAttachmentList(claim, files);
  });
  $("#reconcilePrev").addEventListener("click", () => shiftReconcileMonth(-1));
  $("#reconcileNext").addEventListener("click", () => shiftReconcileMonth(1));
  $("#reconcileHelpToggle").addEventListener("click", () => {
    const open = $("#reconcileHelp").hidden;
    $("#reconcileHelp").hidden = !open;
    $("#reconcileHelpToggle").setAttribute("aria-expanded", String(open));
  });
  // The difference follows each actual balance as it is typed.
  $("#reconcileRows").addEventListener("input", (event) => {
    const input = event.target.closest("[data-reconcile-actual]");
    if (!input) return;
    const row = input.closest("[data-reconcile-account]");
    const difference = input.value === "" ? null : Number(input.value) - Number(row.dataset.expected);
    row.querySelector("[data-reconcile-difference]").innerHTML = differenceMarkup(difference);
  });
  // A history row loads its month into the table above; its button prints that month.
  $("#reconciliationRows").addEventListener("click", (event) => {
    const print = event.target.closest("[data-print-month]");
    if (print) return printMonthlyReport(print.dataset.printMonth);
    const row = event.target.closest("[data-load-reconcile-month]");
    if (!row) return;
    setReconcileMonth(row.dataset.loadReconcileMonth);
    renderReconciliationHistory();
    $("#reconciliationForm").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  window.addEventListener("afterprint", finishMonthlyReportPrint);
  window.addEventListener("focus", () => {
    if (monthlyReportPrintActive) setTimeout(finishMonthlyReportPrint, 100);
  });
  $("#toggleMonthLock").addEventListener("click", () => {
    const month = $("#reconcileMonth").value;
    if (!month) return toast("請先選擇月份。");
    const locked = isMonthLocked(month);
    if (!locked && !monthReadyToLock(month)) return toast("所有帳戶都儲存、差額都是 0 後，才能鎖定這個月。");
    const message = locked
      ? `確定解鎖 ${month}？解鎖後可修改該月帳務。`
      : `確定鎖定 ${month}？鎖定後該月帳務不可修改。`;
    requestAppActionConfirmation({ title: locked ? "解鎖月份" : "鎖定月份", message, confirmLabel: locked ? "確認解鎖" : "確認鎖定", action: () => {
      state.lockedMonths = locked ? state.lockedMonths.filter((item) => item !== month) : [...state.lockedMonths, month];
      if (!saveState()) return;
      toast(locked ? "月份已解鎖。" : "月份已鎖定。");
    }});
  });
  $("#ledgerType").addEventListener("change", () => {
    updateLedgerParentFilter();
    renderLedger();
  });
  ["ledgerSearch", "ledgerParent", "ledgerDateFrom", "ledgerDateTo", "claimSearch", "claimStatusFilter", "claimParentFilter", "claimDateFrom", "claimDateTo"].forEach((id) => $("#" + id).addEventListener("input", render));
  ["personSearch", "activitySearch", "activityPersonSearch"].forEach((id) => $("#" + id).addEventListener("input", renderPeople));
  // Five digits typed in full count at once (and mark the person paid); fewer wait for the field to be left.
  $("#activityPersonRows").addEventListener("input", (event) => {
    const transferLastFive = event.target.closest("[data-transfer-last-five]");
    if (!transferLastFive) return;
    const digits = transferLastFive.value.normalize("NFKC").replace(/\D/g, "").slice(0, 5);
    if (transferLastFive.value !== digits) transferLastFive.value = digits;
    if (digits.length === 5) setActivityTransferLastFive(transferLastFive.dataset.activityId, transferLastFive.dataset.personId, digits);
  });
  $("#activityPersonRows").addEventListener("change", (event) => {
    const transferLastFive = event.target.closest("[data-transfer-last-five]");
    const attendance = event.target.closest("[data-toggle-attendance]");
    const select = event.target.closest("[data-roster-select]");
    if (transferLastFive) setActivityTransferLastFive(transferLastFive.dataset.activityId, transferLastFive.dataset.personId, transferLastFive.value);
    if (attendance) setActivityAttendance(attendance.dataset.activityId, attendance.dataset.personId, attendance.checked ? "attending" : "not_attending");
    if (select) {
      if (select.checked) rosterSelection.add(select.dataset.rosterSelect);
      else rosterSelection.delete(select.dataset.rosterSelect);
      renderRosterBatch();
    }
  });
  $("#activityPersonRows").addEventListener("click", (event) => {
    const payment = event.target.closest("[data-toggle-payment]");
    if (payment) setActivityPayment(payment.dataset.activityId, payment.dataset.personId, payment.getAttribute("aria-pressed") !== "true");
  });
  $("#activityStatusSummary").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-roster-filter]");
    if (!chip) return;
    rosterFilter = chip.dataset.rosterFilter;
    rosterSelection = new Set();
    renderPeople();
  });
  $("#rosterSelectAll").addEventListener("change", (event) => {
    rosterSelection = event.target.checked ? new Set(rosterVisibleIds) : new Set();
    renderPeople();
  });
  $("#rosterBatchPaid").addEventListener("click", () => batchUpdateRoster("paid"));
  $("#rosterBatchUnpaid").addEventListener("click", () => batchUpdateRoster("unpaid"));
  $("#rosterBatchAttend").addEventListener("click", () => batchUpdateRoster("attending"));
  $("#rosterBatchClear").addEventListener("click", () => {
    rosterSelection = new Set();
    renderPeople();
  });
  $("#trashRows").addEventListener("click", (event) => {
    const row = event.target.closest("[data-select-trash-row]");
    if (!row) return;
    const id = row.dataset.selectTrashRow;
    if (selectedTrashIds.has(id)) selectedTrashIds.delete(id);
    else selectedTrashIds.add(id);
    renderTrash();
  });
  $("#restoreSelectedTrash").addEventListener("click", () => {
    const count = selectedTrashIds.size;
    if (!count) return;
    requestAppActionConfirmation({
      title: "還原選取項目",
      message: `將還原選取的 ${count} 筆資料。確定繼續？`,
      confirmLabel: "確認還原",
      action: () => restoreTrashItems([...selectedTrashIds])
    });
  });
  $("#purgeSelectedTrash").addEventListener("click", () => {
    const count = selectedTrashIds.size;
    if (!count) return;
    requestAppActionConfirmation({
      title: "永久刪除選取項目",
      message: `將永久刪除選取的 ${count} 筆資料與其附件，之後無法還原。確定繼續？`,
      confirmLabel: "永久刪除",
      action: () => permanentlyDeleteTrashItems([...selectedTrashIds])
    });
  });
  $("#previousYear").addEventListener("click", () => {
    displayedYear -= 1;
    selectedMonth = `${displayedYear}-${selectedMonth.slice(5)}`;
    renderOverview();
  });
  $("#nextYear").addEventListener("click", () => {
    displayedYear += 1;
    selectedMonth = `${displayedYear}-${selectedMonth.slice(5)}`;
    renderOverview();
  });

  document.addEventListener("click", async (event) => {
    const monthButton = event.target.closest("[data-month]");
    const selectEntryRow = event.target.closest("[data-select-entry]");
    const deleteEntry = event.target.closest("[data-delete-entry]");
    const deleteClaim = event.target.closest("[data-delete-claim]");
    const payClaimButton = event.target.closest("[data-pay-claim]");
    const revokePayment = event.target.closest("[data-revoke-payment]");
    const restoreItem = event.target.closest("[data-restore-trash]");
    const purgeItem = event.target.closest("[data-purge-trash]");
    const selectAccountRow = event.target.closest("[data-select-account]");
    const selectPayeeRow = event.target.closest("[data-select-payee]");
    const selectClaimRow = event.target.closest("[data-select-claim]");
    const selectPersonRow = event.target.closest("[data-select-person]");
    const selectActivityRow = event.target.closest("[data-select-activity]");
    const copyAccount = event.target.closest("[data-copy-account-number]");
    const copyPayee = event.target.closest("[data-copy-payee-number]");
    const copyPersonEmailButton = event.target.closest("[data-copy-person-email]");
    const viewAccountQr = event.target.closest("[data-view-account-qr]");
    const viewPayeeQr = event.target.closest("[data-view-payee-qr]");
    const downloadAttachment = event.target.closest("[data-download-attachment]");
    const previewAttachment = event.target.closest("[data-preview-attachment]");
    const previewPendingClaim = event.target.closest("[data-preview-pending-claim]");
    const removeAttachment = event.target.closest("[data-remove-attachment]");
    const cloudLink = event.target.closest("[data-open-cloud-link]");

    if (cloudLink) {
      event.preventDefault();
      await openCloudLink(cloudLink.dataset.openCloudLink);
      return;
    }

    if (monthButton) {
      selectedMonth = monthButton.dataset.month;
      displayedYear = Number(selectedMonth.slice(0, 4));
      renderOverview();
    }

    if (selectEntryRow && !event.target.closest("button")) {
      selectEntry(state.entries.find((item) => item.id === selectEntryRow.dataset.selectEntry));
    }

    if (deleteEntry) {
      const entry = state.entries.find((item) => item.id === deleteEntry.dataset.deleteEntry);
      if (affectsLockedBalance(entry?.date)) return toast("這筆資料會影響已鎖定月份的帳面，請先到「對帳」解鎖。");
      if (!entry) return toast("找不到這筆收支紀錄。");
      requestAppActionConfirmation({
        title: "刪除收支紀錄",
        message: "這筆收支紀錄會移至垃圾桶，30 天內仍可還原。",
        confirmLabel: "確認刪除",
        action: () => moveToTrash("entry", entry.id)
      });
    }

    if (payClaimButton) openClaimPayment(state.claims.find((item) => item.id === payClaimButton.dataset.payClaim));

    if (revokePayment) revokeClaimPayment(state.claims.find((item) => item.id === revokePayment.dataset.revokePayment));

    if (deleteClaim) {
      const claim = state.claims.find((item) => item.id === deleteClaim.dataset.deleteClaim);
      if (isMonthLocked(claim?.date)) return toast("這個月份已鎖定，請先到「對帳」解鎖。");
      if (!claim) return toast("找不到這筆報銷申請。");
      requestAppActionConfirmation({
        title: "刪除報銷",
        message: "這筆報銷申請會移至垃圾桶，30 天內仍可還原。",
        confirmLabel: "確認刪除",
        action: () => moveToTrash("claim", claim.id)
      });
    }

    if (restoreItem) restoreTrash(restoreItem.dataset.restoreTrash);

    if (purgeItem) {
      requestAppActionConfirmation({
        title: "永久刪除",
        message: "永久刪除後無法還原，確定繼續？",
        confirmLabel: "永久刪除",
        action: () => permanentlyDeleteTrashItems([purgeItem.dataset.purgeTrash])
      });
    }

    if (selectAccountRow && !event.target.closest("button")) {
      selectAccount(state.accounts.find((item) => item.id === selectAccountRow.dataset.selectAccount));
    }

    if (selectPayeeRow && !event.target.closest("button")) {
      selectPayee(state.payees.find((item) => item.id === selectPayeeRow.dataset.selectPayee));
    }

    if (selectClaimRow && !event.target.closest("button, a")) {
      selectClaim(state.claims.find((item) => item.id === selectClaimRow.dataset.selectClaim));
    }

    if (selectPersonRow && !event.target.closest("button")) {
      selectPerson(state.people.find((item) => item.id === selectPersonRow.dataset.selectPerson));
    }

    if (selectActivityRow && !event.target.closest("button")) {
      selectActivity(state.activities.find((item) => item.id === selectActivityRow.dataset.selectActivity));
    }


    if (copyAccount) await copyAccountNumber(copyAccount.dataset.copyAccountNumber);
    if (copyPayee) await copyAccountNumber(copyPayee.dataset.copyPayeeNumber);
    if (copyPersonEmailButton) await copyPersonEmail(copyPersonEmailButton.dataset.copyPersonEmail);

    if (viewAccountQr) {
      const account = state.accounts.find((item) => item.id === viewAccountQr.dataset.viewAccountQr);
      if (!account?.qrCodeDataUrl) return toast("這個帳戶尚未設定 QR Code。");
      openAccountQrPreview(account.qrCodeDataUrl, account.name, account.accountNumber ? `帳號：${account.accountNumber}` : "掃描前請再次核對收款帳戶。");
    }

    if (viewPayeeQr) {
      const payee = state.payees.find((item) => item.id === viewPayeeQr.dataset.viewPayeeQr);
      if (!payee?.qrCodeDataUrl) return toast("這筆收款資料尚未設定 QR Code。");
      openAccountQrPreview(payee.qrCodeDataUrl, payee.name, `${payee.bank ? `${payee.bank} · ` : ""}帳號：${payee.accountNumber}`);
    }

    if (previewAttachment) await openAttachmentPreview(previewAttachment.dataset.previewAttachment, previewAttachment.dataset.attachmentName);

    if (previewPendingClaim) {
      const file = $("#claimFiles").files[Number(previewPendingClaim.dataset.previewPendingClaim)];
      if (file) openBlobPreview(file, file.name, file.type || "");
    }

    if (downloadAttachment) {
      try {
        const receipt = await getReceipt(downloadAttachment.dataset.downloadAttachment);
        if (!receipt) return toast("找不到這個附件。");
        download(receipt.name, receipt.blob, receipt.type);
      } catch {
        toast("附件讀取失敗。");
      }
    }

    if (removeAttachment) {
      const claim = state.claims.find((item) => item.id === removeAttachment.dataset.claimId);
      if (!claim) return toast("找不到這筆報銷資料。");
      const linkedEntry = state.entries.find((entry) => entry.claimId === claim.id);
      if (isMonthLocked(claim.date) || (linkedEntry && affectsLockedBalance(linkedEntry.date))) return toast("這筆資料會影響已鎖定月份，請先到「對帳」解鎖。");
      requestAppActionConfirmation({ title: "移除附件", message: "確定移除這個收據附件？", confirmLabel: "確認移除", action: async () => {
        const previousAttachments = [...(claim.attachments || [])];
        claim.attachments = previousAttachments.filter((item) => item.id !== removeAttachment.dataset.removeAttachment);
        if (!saveState()) return;
        try { await deleteReceipt(removeAttachment.dataset.removeAttachment); }
        catch { claim.attachments = previousAttachments; saveState(); return toast("附件移除失敗，原附件仍保留。"); }
        renderClaimAttachmentList(claim); toast("附件已移除。");
      }});
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#calendarPopover").hidden) { closeCalendar(); return; }
    const row = event.target.closest?.("[data-select-entry], [data-select-account], [data-select-payee], [data-select-claim], [data-select-person], [data-select-activity]");
    if (!row || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (row.dataset.selectEntry) selectEntry(state.entries.find((item) => item.id === row.dataset.selectEntry));
    else if (row.dataset.selectAccount) selectAccount(state.accounts.find((item) => item.id === row.dataset.selectAccount));
    else if (row.dataset.selectPayee) selectPayee(state.payees.find((item) => item.id === row.dataset.selectPayee));
    else if (row.dataset.selectPerson) selectPerson(state.people.find((item) => item.id === row.dataset.selectPerson));
    else if (row.dataset.selectActivity) selectActivity(state.activities.find((item) => item.id === row.dataset.selectActivity));
    else selectClaim(state.claims.find((item) => item.id === row.dataset.selectClaim));
  });

  document.addEventListener("click", (event) => {
    const popover = $("#calendarPopover");
    if (!popover.hidden && !event.target.closest("#calendarPopover, [data-date-control]")) closeCalendar();
    const button = event.target.closest("[data-calendar-date], [data-calendar-prev], [data-calendar-next], [data-calendar-months], [data-calendar-years], [data-calendar-month], [data-calendar-year], [data-calendar-year-prev], [data-calendar-year-next], [data-calendar-years-prev], [data-calendar-years-next]");
    if (!button) return;
    if (button.dataset.calendarDate) { setDateValue(calendarTarget.id, button.dataset.calendarDate); calendarTarget.dispatchEvent(new Event("input", { bubbles: true })); closeCalendar(); }
    else if (button.hasAttribute("data-calendar-prev")) { calendarMonth.setMonth(calendarMonth.getMonth() - 1); renderCalendar(); }
    else if (button.hasAttribute("data-calendar-next")) { calendarMonth.setMonth(calendarMonth.getMonth() + 1); renderCalendar(); }
    else if (button.hasAttribute("data-calendar-months")) { calendarMode = "months"; renderCalendar(); }
    else if (button.hasAttribute("data-calendar-years")) { calendarMode = "years"; renderCalendar(); }
    else if (button.dataset.calendarMonth !== undefined) { calendarMonth.setMonth(Number(button.dataset.calendarMonth)); calendarMode = "days"; renderCalendar(); }
    else if (button.dataset.calendarYear) { calendarMonth.setFullYear(Number(button.dataset.calendarYear)); calendarMode = "months"; renderCalendar(); }
    else if (button.hasAttribute("data-calendar-year-prev") || button.hasAttribute("data-calendar-years-prev")) { calendarMonth.setFullYear(calendarMonth.getFullYear() - (button.hasAttribute("data-calendar-years-prev") ? 12 : 1)); renderCalendar(); }
    else if (button.hasAttribute("data-calendar-year-next") || button.hasAttribute("data-calendar-years-next")) { calendarMonth.setFullYear(calendarMonth.getFullYear() + (button.hasAttribute("data-calendar-years-next") ? 12 : 1)); renderCalendar(); }
  });

  $("#clearBtn").addEventListener("click", () => requestAppActionConfirmation({
    title: "清空資料",
    message: "確定清空全部帳務、人員與活動資料？此動作無法復原。",
    confirmLabel: "確認",
    action: clearAllData
  }));

  async function clearAllData() {
    state = normalizeState();
    if (!saveState()) return;
    try {
      await clearReceipts();
    } catch {
      toast("帳務已清空，但舊附件清理失敗；不影響新資料。");
      return;
    }
    refreshAccountSelects();
    resetEntryForm();
    resetClaimForm();
    resetAccountForm();
    resetPayeeForm();
    resetPersonForm();
    resetActivityForm();
    $("#reconcileMonth").value = selectedMonth;
    loadReconciliationForm();
    toast("資料已清空。");
  }

  $("#exportComplete").addEventListener("click", exportComplete);
  $("#exportLedger").addEventListener("click", exportLedger);
  $("#exportClaims").addEventListener("click", exportClaims);
  $("#exportCombined").addEventListener("click", exportCombined);
  $("#exportActivityUnpaid").addEventListener("click", exportActivityUnpaid);
  $("#importFile").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("#importFileName").textContent = file.name;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = parseImportedContent(file.name, reader.result);
        requestAppActionConfirmation({
          title: `還原「${file.name}」`,
          message: `${importSummary(imported, file)}\n還原前會先自動備份目前資料。`,
          confirmLabel: "確認還原",
          action: async () => {
            let note;
            try {
              note = await saveRestorePoint();
            } catch (error) {
              return toast(`無法先備份目前資料，還原已取消：${error?.message || error}`, "error");
            }
            applyImportedBackup(imported, note);
          }
        });
      } catch (error) {
        const message = error.message === "report only"
          ? "合併報表僅供閱讀，完整還原請使用 JSON 備份。"
          : error.message === "paid claims require json backup"
            ? "已付款報銷包含付款連動資料，請使用 JSON 備份還原。"
            : error.message === "unknown account"
              ? "明細中的帳戶不存在；請先建立同名帳戶，或改用完整 JSON 備份。"
              : error.message === "attachment import failed"
                ? "附件還原失敗，原有資料已保留。"
                : "這個檔案不是可用的 JSON 或 CSV 備份。";
        toast(message);
      } finally {
        event.target.value = "";
      }
    };
    reader.onerror = () => {
      event.target.value = "";
      toast("無法讀取這個備份檔案。");
    };
    reader.readAsText(file);
  });

  async function applyImportedBackup(imported, note = "") {
    const previousState = state;
    let replacesAllReceipts = false;
    let replacedClaimIds = null;
    try {
      if (imported.scope === "complete") {
        // Backups never hold the sync secret, so keep this computer's sync settings. The restored
        // books are then uploaded on top of the cloud ledger this computer last saw.
        state = normalizeState({ ...imported.data, webSync: previousState.webSync, ledgerSync: previousState.ledgerSync, autoBackup: previousState.autoBackup, exportFolder: previousState.exportFolder, expenseCategories: previousState.expenseCategories });
        replacesAllReceipts = true;
      } else if (imported.scope === "entries") {
        const currentClaimIds = new Set(state.claims.map((claim) => claim.id));
        const importedLinked = new Map(imported.data.filter((entry) => entry.claimId && currentClaimIds.has(entry.claimId)).map((entry) => [entry.claimId, entry]));
        const existingLinked = new Map(state.entries.filter((entry) => entry.claimId && currentClaimIds.has(entry.claimId)).map((entry) => [entry.claimId, entry]));
        const linkedEntries = state.claims.map((claim) => importedLinked.get(claim.id) || existingLinked.get(claim.id)).filter(Boolean);
        state = normalizeState({ ...state, entries: [...imported.data.filter((entry) => !entry.claimId), ...linkedEntries] });
      } else {
        replacedClaimIds = previousState.claims.map((claim) => claim.id);
        state = normalizeState({ ...state, claims: imported.data.claims, entries: [...state.entries.filter((entry) => !entry.claimId), ...imported.data.linkedEntries] });
      }
      if (!saveState()) return;
      if (replacesAllReceipts) await importReceipts(imported.attachments);
      else if (replacedClaimIds) await importReceipts(imported.attachments, replacedClaimIds);
      purgeExpiredTrash();
      refreshAccountSelects();
      resetEntryForm();
      resetClaimForm();
      resetPayeeForm();
      resetPersonForm();
      resetActivityForm();
      loadReconciliationForm();
      toast(`備份已匯入。${note}`);
    } catch (error) {
      state = previousState;
      saveState();
      toast(error?.message === "attachment import failed" ? "附件還原失敗，原有資料已保留。" : "備份還原失敗，原有資料已保留。");
    }
  }
  window.addEventListener("storage", (event) => {
    if (tauriStorageEnabled) return;
    if (event.key !== storageKey || !event.newValue) return;
    try {
      state = normalizeState(JSON.parse(event.newValue));
      refreshAccountSelects();
      loadReconciliationForm();
      render();
      toast("另一個分頁有新資料，已自動同步。");
    } catch {
      toast("另一個分頁的資料無法同步，請重新整理。");
    }
  });
  let listScrollResizeFrame;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(listScrollResizeFrame);
    listScrollResizeFrame = requestAnimationFrame(syncScrollableLists);
  });
}
