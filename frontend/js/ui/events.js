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

function bindEvents() {
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
  const closePersonImportDialog = () => { $("#personImportDialog").hidden = true; };
  const closePersonImportLinkDialog = () => { $("#personImportLinkDialog").hidden = true; };
  $("#openPersonImportDialog").addEventListener("click", () => { $("#personImportDialog").hidden = false; });
  $("#cancelPersonImportDialog").addEventListener("click", closePersonImportDialog);
  $("#personImportDialog").addEventListener("click", (event) => {
    if (event.target === $("#personImportDialog")) closePersonImportDialog();
  });
  $("#cancelPersonImportLink").addEventListener("click", closePersonImportLinkDialog);
  $("#personImportLinkDialog").addEventListener("click", (event) => {
    if (event.target === $("#personImportLinkDialog")) closePersonImportLinkDialog();
  });
  $("#choosePersonImport").addEventListener("click", () => {
    closePersonImportDialog();
    $("#personImportFile").click();
  });
  $("#personImportFile").addEventListener("change", () => readPersonImportFile($("#personImportFile").files[0]));
  $("#openPersonImportLink").addEventListener("click", () => {
    closePersonImportDialog();
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
  $("#resetImportSynonyms").addEventListener("click", () => {
    requestAppActionConfirmation({
      title: "還原預設同義詞",
      message: "將放棄目前的自訂名稱，恢復 App 原本的可辨識欄位名稱。",
      confirmLabel: "確認還原",
      action: () => {
        state.importSynonyms = { mode: "legacy", people: { name: [], studentId: [], department: [], email: [] }, activity: { attendance: [], payment: [], paidAt: [] } };
        if (!saveState()) return;
        renderImportSynonymSettings();
        toast("匯入同義詞已還原預設。");
      }
    });
  });
  $("#activityForm").addEventListener("submit", upsertActivity);
  $("#openActivityImport").addEventListener("click", () => {
    if (!$("#activityId").value) return toast("請先選擇一個活動。", "error");
    $("#activityImportDialog").hidden = false;
  });
  const closeActivityImportDialog = () => { $("#activityImportDialog").hidden = true; };
  const closeActivityImportLinkDialog = () => { $("#activityImportLinkDialog").hidden = true; };
  $("#cancelActivityImportDialog").addEventListener("click", closeActivityImportDialog);
  $("#activityImportDialog").addEventListener("click", (event) => { if (event.target === $("#activityImportDialog")) closeActivityImportDialog(); });
  $("#chooseActivityImport").addEventListener("click", () => {
    closeActivityImportDialog();
    $("#activityImportFile").click();
  });
  $("#openActivityImportLink").addEventListener("click", () => {
    closeActivityImportDialog();
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
  $("#syncActivityLink").addEventListener("click", () => syncActivityImportLink($("#activityId").value));
  $("#disconnectActivityLink").addEventListener("click", () => {
    const activity = state.activities.find((item) => item.id === $("#activityId").value);
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
  $("#claimCancel").addEventListener("click", () => {
    resetClaimForm();
    renderClaims();
  });
  $("#accountCancel").addEventListener("click", () => {
    const wasEditing = Boolean($("#accountId").value);
    resetAccountForm();
    renderAccounts();
    $("#accountName").focus();
    toast(wasEditing ? "已取消編輯。" : "帳戶表單已重設。");
  });
  $("#payeeCancel").addEventListener("click", () => {
    const wasEditing = Boolean($("#payeeId").value);
    resetPayeeForm();
    renderAccounts();
    $("#payeeName").focus();
    toast(wasEditing ? "已取消編輯。" : "收款帳戶表單已重設。");
  });
  $("#personCancel").addEventListener("click", () => {
    const wasEditing = Boolean($("#personId").value);
    resetPersonForm();
    renderPeople();
    $("#personName").focus();
    if (wasEditing) toast("已取消編輯。");
  });
  $("#personDelete").addEventListener("click", () => deletePerson($("#personId").value));
  $("#activityCancel").addEventListener("click", () => {
    const wasEditing = Boolean($("#activityId").value);
    resetActivityForm();
    renderPeople();
    $("#activityName").focus();
    if (wasEditing) toast("已取消編輯，回到新增活動。");
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
  $("#reconcileMonth").addEventListener("change", loadReconciliationForm);
  $("#reconcileAccount").addEventListener("change", loadReconciliationForm);
  $("#printMonthlyReport").addEventListener("click", printMonthlyReport);
  window.addEventListener("afterprint", finishMonthlyReportPrint);
  window.addEventListener("focus", () => {
    if (monthlyReportPrintActive) setTimeout(finishMonthlyReportPrint, 100);
  });
  $("#reconcileActual").addEventListener("input", renderReconciliationSummary);
  $("#toggleMonthLock").addEventListener("click", () => {
    const month = $("#reconcileMonth").value;
    if (!month) return toast("請先選擇月份。");
    const locked = isMonthLocked(month);
    if (!locked) {
      const incomplete = incompleteReconciliationAccounts(month);
      if (incomplete.length) {
        const names = incomplete.slice(0, 3).map((account) => account.name).join("、");
        const more = incomplete.length > 3 ? `等 ${incomplete.length} 個帳戶` : "";
        return toast(`請先完成${names}${more}的月結對帳，再鎖定月份。`);
      }
    }
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
  $("#activityPersonFilter").addEventListener("change", renderPeople);
  $("#activityPersonRows").addEventListener("input", (event) => {
    const paymentTime = event.target.closest("[data-payment-time]");
    if (paymentTime) paymentTime.value = formatPaymentTimeValue(paymentTime.value);
  });
  $("#activityPersonRows").addEventListener("change", (event) => {
    const paymentTime = event.target.closest("[data-payment-time]");
    if (paymentTime) setActivityPaymentTime(paymentTime.dataset.activityId, paymentTime.dataset.personId, paymentTime.value);
  });
  const clearRosterPointerDrag = () => {
    rosterPointerDrag = null;
    $$("#activityPersonRows .is-dragging, #activityPersonRows .is-drop-target, #activityPersonRows .is-drop-after").forEach((item) => item.classList.remove("is-dragging", "is-drop-target", "is-drop-after"));
  };
  $("#activityPersonRows").addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button, input")) return;
    const row = event.target.closest("[data-roster-person-id]");
    if (!row) return;
    event.preventDefault();
    row.setPointerCapture?.(event.pointerId);
    rosterPointerDrag = {
      activityId: row.dataset.rosterActivityId,
      personId: row.dataset.rosterPersonId,
      row,
      startX: event.clientX,
      startY: event.clientY,
      active: true,
      targetRow: null,
      placeAfter: false
    };
    row.classList.add("is-dragging");
  });
  document.addEventListener("pointermove", (event) => {
    if (!rosterPointerDrag) return;
    const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-roster-person-id]");
    if (!targetRow || targetRow === rosterPointerDrag.row || targetRow.dataset.rosterActivityId !== rosterPointerDrag.activityId) return;
    const bounds = targetRow.getBoundingClientRect();
    const placeAfter = event.clientY > bounds.top + bounds.height / 2;
    $$("#activityPersonRows .is-drop-target, #activityPersonRows .is-drop-after").forEach((item) => item.classList.remove("is-drop-target", "is-drop-after"));
    targetRow.classList.add(placeAfter ? "is-drop-after" : "is-drop-target");
    rosterPointerDrag.targetRow = targetRow;
    rosterPointerDrag.placeAfter = placeAfter;
    event.preventDefault();
  });
  document.addEventListener("pointerup", () => {
    if (!rosterPointerDrag) return;
    const { active, activityId, personId, targetRow, placeAfter } = rosterPointerDrag;
    clearRosterPointerDrag();
    if (active && targetRow) reorderActivityRoster(activityId, personId, targetRow.dataset.rosterPersonId, placeAfter);
  });
  document.addEventListener("pointercancel", clearRosterPointerDrag);
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
  $$('[data-export-format]').forEach((button) => button.addEventListener('click', () => {
    selectedExportFormat = button.dataset.exportFormat;
    $$('[data-export-format]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    updateExportUi();
  }));
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
    const deleteAccountRow = event.target.closest("[data-delete-account]");
    const deletePayeeRow = event.target.closest("[data-delete-payee]");
    const deleteActivityRow = event.target.closest("[data-delete-activity]");
    const attendanceButton = event.target.closest("[data-set-attendance]");
    const paymentButton = event.target.closest("[data-set-payment]");
    const copyAccount = event.target.closest("[data-copy-account-number]");
    const copyPayee = event.target.closest("[data-copy-payee-number]");
    const copyPersonEmailButton = event.target.closest("[data-copy-person-email]");
    const viewAccountQr = event.target.closest("[data-view-account-qr]");
    const revokeAccountQr = event.target.closest("[data-revoke-account-qr]");
    const viewPayeeQr = event.target.closest("[data-view-payee-qr]");
    const revokePayeeQr = event.target.closest("[data-revoke-payee-qr]");
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

    if (deleteAccountRow) deleteSelectedAccount(deleteAccountRow.dataset.deleteAccount);
    if (deletePayeeRow) deleteSelectedPayee(deletePayeeRow.dataset.deletePayee);
    if (deleteActivityRow) deleteActivity(deleteActivityRow.dataset.deleteActivity);
    if (attendanceButton) setActivityAttendance(attendanceButton.dataset.activityId, attendanceButton.dataset.personId, attendanceButton.dataset.setAttendance);
    if (paymentButton) setActivityPayment(paymentButton.dataset.activityId, paymentButton.dataset.personId, paymentButton.dataset.setPayment === "paid");

    if (copyAccount) await copyAccountNumber(copyAccount.dataset.copyAccountNumber);
    if (copyPayee) await copyAccountNumber(copyPayee.dataset.copyPayeeNumber);
    if (copyPersonEmailButton) await copyPersonEmail(copyPersonEmailButton.dataset.copyPersonEmail);

    if (viewAccountQr) {
      const account = state.accounts.find((item) => item.id === viewAccountQr.dataset.viewAccountQr);
      if (!account?.qrCodeDataUrl) return toast("這個帳戶尚未設定 QR Code。");
      openAccountQrPreview(account.qrCodeDataUrl, account.name, account.accountNumber ? `帳號：${account.accountNumber}` : "掃描前請再次核對收款帳戶。");
    }

    if (revokeAccountQr) {
      const account = state.accounts.find((item) => item.id === revokeAccountQr.dataset.revokeAccountQr);
      if (!account?.qrCodeDataUrl) return;
      requestAppActionConfirmation({
        title: "撤銷 QR Code",
        message: `撤銷「${account.name}」的 QR Code 圖片？帳戶與帳務資料會保留。`,
        confirmLabel: "確認撤銷",
        action: () => {
          account.qrCodeDataUrl = "";
          account.qrCodeName = "";
          if ($("#accountId").value === account.id) {
            removeAccountQr = false;
            renderCurrentAccountQr(account);
          }
          if (!saveState()) return;
          toast("QR Code 已撤銷。");
        }
      });
    }

    if (viewPayeeQr) {
      const payee = state.payees.find((item) => item.id === viewPayeeQr.dataset.viewPayeeQr);
      if (!payee?.qrCodeDataUrl) return toast("這筆收款資料尚未設定 QR Code。");
      openAccountQrPreview(payee.qrCodeDataUrl, payee.name, `${payee.bank ? `${payee.bank} · ` : ""}帳號：${payee.accountNumber}`);
    }

    if (revokePayeeQr) {
      const payee = state.payees.find((item) => item.id === revokePayeeQr.dataset.revokePayeeQr);
      if (!payee?.qrCodeDataUrl) return;
      requestAppActionConfirmation({
        title: "撤銷收款 QR Code",
        message: `撤銷「${payee.name}」的 QR Code 圖片？收款人與帳號會保留。`,
        confirmLabel: "確認撤銷",
        action: () => {
          payee.qrCodeDataUrl = "";
          payee.qrCodeName = "";
          if ($("#payeeId").value === payee.id) {
            removePayeeQr = false;
            renderCurrentPayeeQr(payee);
          }
          if (!saveState()) return;
          toast("收款 QR Code 已撤銷。");
        }
      });
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

  $("#seedBtn").addEventListener("click", seedData);
  $("#clearBtn").addEventListener("click", () => requestAppActionConfirmation({
    title: "清空資料",
    message: "確定清空全部帳務、人員與活動資料？此動作無法復原。",
    confirmLabel: "確認清空",
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
  $("#exportActivityUnpaid").addEventListener("click", exportActivityUnpaid);
  $("#importFile").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("#importFileName").textContent = file.name;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = parseImportedContent(file.name, reader.result);
        const messages = {
          complete: "還原會取代目前全部帳務資料。要繼續嗎？",
          entries: "這份明細會取代目前的收支紀錄，報銷與垃圾桶資料會保留。要繼續嗎？",
          claims: "這份明細會取代目前的報銷紀錄，收支與垃圾桶資料會保留。要繼續嗎？"
        };
        requestAppActionConfirmation({
          title: "還原備份",
          message: messages[imported.scope],
          confirmLabel: "確認還原",
          action: () => applyImportedBackup(imported)
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

  async function applyImportedBackup(imported) {
    const previousState = state;
    let replacesAllReceipts = false;
    let replacedClaimIds = null;
    try {
      if (imported.scope === "complete") {
        state = normalizeState(imported.data);
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
      toast("備份已匯入。");
    } catch (error) {
      state = previousState;
      saveState();
      toast(error?.message === "attachment import failed" ? "附件還原失敗，原有資料已保留。" : "備份還原失敗，原有資料已保留。");
    }
  }
  window.addEventListener("storage", (event) => {
    if (nativeStorageEnabled) return;
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

