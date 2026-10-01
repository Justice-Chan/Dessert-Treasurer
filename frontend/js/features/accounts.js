function resetAccountForm() {
  $("#accountForm").reset();
  $("#accountId").value = "";
  $("#accountFormTitle").textContent = "新增帳戶";
  setDateValue("accountOpeningDate", today());
  $("#accountOpeningBalance").value = "0";
  $("#accountNumber").value = "";
  $("#accountQrFile").value = "";
  $("#accountQrFileName").textContent = "尚未選取圖片";
  $("#accountQrCurrent").innerHTML = "";
  $("#accountCancel").hidden = true;
  removeAccountQr = false;
  pendingAccountQrDataUrl = "";
  updateAccountBankFields();
}

function selectAccount(account) {
  if (!account) return;
  $("#accountId").value = account.id;
  $("#accountFormTitle").textContent = "編輯帳戶";
  $("#accountName").value = account.name;
  $("#accountType").value = account.type;
  setDateValue("accountOpeningDate", account.openingDate || today());
  $("#accountOpeningBalance").value = account.openingBalance;
  $("#accountNumber").value = account.accountNumber || "";
  $("#accountQrFile").value = "";
  $("#accountQrFileName").textContent = "尚未選取圖片";
  $("#accountCancel").hidden = false;
  removeAccountQr = false;
  pendingAccountQrDataUrl = "";
  updateAccountBankFields();
  renderCurrentAccountQr(account);
  renderAccounts();
}

function updateAccountBankFields() {
  const isBank = $("#accountType").value === "bank";
  $("#accountBankFields").hidden = !isBank;
  $("#accountQrFields").hidden = !isBank;
}

function renderCurrentAccountQr(account) {
  if (pendingAccountQrDataUrl) {
    $("#accountQrCurrent").innerHTML = `
      <div class="attachment-item">
        <span>準備上傳：${escapeHtml($("#accountQrFile").files[0]?.name || "QR Code")}</span>
        <div class="inline-actions"><button type="button" id="previewPendingAccountQr">預覽</button><button type="button" class="danger" id="removeAccountQr">移除</button></div>
      </div>
    `;
    return;
  }
  $("#accountQrCurrent").innerHTML = account?.qrCodeDataUrl && !removeAccountQr ? `
    <div class="attachment-item">
      <span>目前圖片：${escapeHtml(account.qrCodeName || "銀行 QR Code")}</span>
      <div class="inline-actions"><button type="button" data-view-account-qr="${account.id}">預覽</button><button type="button" class="danger" id="removeAccountQr">移除</button></div>
    </div>
  ` : "";
}

function resetPayeeForm() {
  $("#payeeForm").reset();
  $("#payeeId").value = "";
  $("#payeeQrFile").value = "";
  $("#payeeQrFileName").textContent = "尚未選取圖片";
  $("#payeeQrCurrent").innerHTML = "";
  $("#payeeCancel").hidden = true;
  removePayeeQr = false;
  pendingPayeeQrDataUrl = "";
}

function selectPayee(payee) {
  if (!payee) return;
  $("#payeeId").value = payee.id;
  $("#payeeName").value = payee.name;
  $("#payeeBank").value = payee.bank || "";
  $("#payeeNumber").value = payee.accountNumber;
  $("#payeeQrFile").value = "";
  $("#payeeQrFileName").textContent = "尚未選取圖片";
  $("#payeeCancel").hidden = false;
  removePayeeQr = false;
  pendingPayeeQrDataUrl = "";
  renderCurrentPayeeQr(payee);
  renderAccounts();
}

function renderCurrentPayeeQr(payee) {
  if (pendingPayeeQrDataUrl) {
    $("#payeeQrCurrent").innerHTML = `
      <div class="attachment-item">
        <span>準備上傳：${escapeHtml($("#payeeQrFile").files[0]?.name || "QR Code")}</span>
        <div class="inline-actions nowrap-actions"><button type="button" id="previewPendingPayeeQr">預覽</button><button type="button" class="danger" id="removePayeeQr">移除</button></div>
      </div>
    `;
    return;
  }
  $("#payeeQrCurrent").innerHTML = payee?.qrCodeDataUrl && !removePayeeQr ? `
    <div class="attachment-item">
      <span>目前圖片：${escapeHtml(payee.qrCodeName || "收款 QR Code")}</span>
      <div class="inline-actions nowrap-actions"><button type="button" data-view-payee-qr="${payee.id}">預覽</button><button type="button" class="danger" id="removePayeeQr">移除</button></div>
    </div>
  ` : "";
}

function openAccountQrPreview(dataUrl, title, details) {
  $("#accountQrTitle").textContent = title;
  $("#accountQrDetails").textContent = details || "掃描前請再次核對收款帳戶。";
  $("#accountQrImage").src = dataUrl;
  $("#accountQrDialog").hidden = false;
}

function closeAccountQrPreview() {
  $("#accountQrDialog").hidden = true;
  $("#accountQrImage").src = "";
}

function closeAttachmentPreview() {
  $("#attachmentPreviewDialog").hidden = true;
  $("#attachmentPreviewImage").src = "";
  $("#attachmentPreviewFrame").src = "about:blank";
  if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
  attachmentPreviewUrl = "";
}

function openBlobPreview(blob, name, type) {
  if (!type.startsWith("image/") && type !== "application/pdf") return toast("這個檔案無法直接預覽，請使用下載。");
  closeAttachmentPreview();
  attachmentPreviewUrl = URL.createObjectURL(blob);
  $("#attachmentPreviewTitle").textContent = name || "附件預覽";
  $("#attachmentPreviewDetails").textContent = type === "application/pdf" ? "PDF 文件" : "收據圖片";
  const isImage = type.startsWith("image/");
  $("#attachmentPreviewImage").hidden = !isImage;
  $("#attachmentPreviewFrame").hidden = isImage;
  if (isImage) $("#attachmentPreviewImage").src = attachmentPreviewUrl;
  else $("#attachmentPreviewFrame").src = attachmentPreviewUrl;
  $("#attachmentPreviewDialog").hidden = false;
}

async function openAttachmentPreview(id, name) {
  try {
    const receipt = await getReceipt(id);
    if (!receipt) return toast("找不到這個附件。");
    const type = receipt.type || receipt.blob?.type || "";
    openBlobPreview(receipt.blob, name || receipt.name, type);
  } catch {
    toast("附件預覽失敗。");
  }
}

function readQrImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    if (file.size > 1024 * 1024) return reject(new Error("QR 圖片請小於 1 MB。"));
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) return reject(new Error("QR Code 支援 PNG、JPG、WebP 或 GIF 圖片。"));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("無法讀取 QR 圖片。"));
    reader.readAsDataURL(file);
  });
}

async function copyAccountNumber(value) {
  if (!value) return toast("這筆資料尚未設定帳號。");
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    if (!copied) return toast("無法自動複製，請手動選取帳號。");
  }
  toast("帳號已複製。");
}

async function copyPersonEmail(value) {
  if (!value) return toast("這位人員尚未設定電子郵件。");
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    if (!copied) return toast("無法自動複製，請手動選取電子郵件。");
  }
  toast("電子郵件已複製。");
}

async function upsertPayee(event) {
  event.preventDefault();
  const id = $("#payeeId").value || uid();
  const name = $("#payeeName").value.trim();
  const bank = $("#payeeBank").value.trim();
  const accountNumber = accountDigits($("#payeeNumber").value);
  if (!name || !accountNumber) return toast("請填寫收款人與帳號。");
  if (state.payees.some((payee) => payee.id !== id && payee.accountNumber === accountNumber)) return toast("已經有相同的收款帳戶。");
  const existing = state.payees.find((payee) => payee.id === id);
  const qrFile = $("#payeeQrFile").files[0];
  let qrCodeDataUrl = removePayeeQr ? "" : existing?.qrCodeDataUrl || "";
  let qrCodeName = removePayeeQr ? "" : existing?.qrCodeName || "";
  try {
    if (qrFile) {
      qrCodeDataUrl = pendingPayeeQrDataUrl || await readQrImage(qrFile);
      qrCodeName = qrFile.name;
    }
  } catch (error) {
    return toast(error.message);
  }
  const payee = { id, name, bank, accountNumber, qrCodeDataUrl, qrCodeName };
  const index = state.payees.findIndex((item) => item.id === id);
  if (index >= 0) state.payees[index] = payee;
  else state.payees.push(payee);
  if (!saveState()) return;
  selectPayee(payee);
  toast("收款帳戶已儲存。");
}

function deleteSelectedPayee(id = $("#payeeId").value) {
  const payee = state.payees.find((item) => item.id === id);
  if (!payee) return toast("請先選擇要刪除的收款帳戶。");
  requestAppActionConfirmation({
    title: "刪除收款帳戶",
    message: `確定刪除「${payee.name}」？此動作無法復原。`,
    confirmLabel: "確認刪除",
    action: () => {
      state.payees = state.payees.filter((item) => item.id !== id);
      if (!saveState()) return;
      if ($("#payeeId").value === id) resetPayeeForm();
      renderAccounts();
      toast("收款帳戶已刪除。");
    }
  });
}

async function upsertAccount(event) {
  event.preventDefault();
  const id = $("#accountId").value || uid();
  const name = $("#accountName").value.trim();
  const openingDate = $("#accountOpeningDate").value;
  const openingBalance = Number($("#accountOpeningBalance").value);
  const existing = state.accounts.find((account) => account.id === id);
  if (!name || !isValidDateValue(openingDate) || !Number.isFinite(openingBalance)) return toast("請填寫帳戶名稱、期初日期與有效期初餘額。");
  if (state.accounts.some((account) => !account.deletedAt && account.id !== id && account.name === name)) return toast("已經有相同名稱的帳戶。");
  if (state.entries.some((entry) => entry.accountId === id && entry.date < openingDate)) return toast("期初日期不能晚於這個帳戶已有的收支日期。");
  const openingChanged = existing
    ? existing.openingDate !== openingDate || Number(existing.openingBalance) !== openingBalance
    : state.lockedMonths.some((month) => openingDate <= monthEndKey(month));
  const affectsLockedMonth = existing && openingChanged && state.lockedMonths.some((month) => {
    const endDate = monthEndKey(month);
    return (existing.openingDate || "0001-01-01") <= endDate || openingDate <= endDate;
  });
  if (affectsLockedMonth || (!existing && openingChanged)) return toast("期初資料會影響已鎖定月份，請先解鎖後再修改。");
  const qrFile = $("#accountQrFile").files[0];
  let qrCodeDataUrl = removeAccountQr ? "" : existing?.qrCodeDataUrl || "";
  let qrCodeName = removeAccountQr ? "" : existing?.qrCodeName || "";
  try {
    if (qrFile) {
      qrCodeDataUrl = pendingAccountQrDataUrl || await readQrImage(qrFile);
      qrCodeName = qrFile.name;
    }
  } catch (error) {
    return toast(error.message);
  }
  const type = $("#accountType").value;
  const account = {
    id,
    name,
    type,
    accountNumber: type === "bank" ? accountDigits($("#accountNumber").value) : "",
    qrCodeDataUrl: type === "bank" ? qrCodeDataUrl : "",
    qrCodeName: type === "bank" ? qrCodeName : "",
    openingDate,
    openingBalance,
    active: true
  };
  const index = state.accounts.findIndex((item) => item.id === id);
  if (index >= 0) state.accounts[index] = account;
  else state.accounts.push(account);
  selectAccount(account);
  refreshAccountSelects();
  if (!saveState()) return;
  toast("帳戶已儲存。");
}

function deleteSelectedAccount(id = $("#accountId").value) {
  const account = state.accounts.find((item) => item.id === id && !item.deletedAt);
  if (!account) return toast("請先從右側選擇要刪除的帳戶。");
  if (state.accounts.filter((item) => !item.deletedAt).length <= 1) return toast("至少需要保留一個帳戶。");
  if (accountBalance(id, today()) !== 0) return toast("帳戶仍有餘額，請先完成轉入、轉出或帳務調整後再刪除。");
  if (state.entries.some((entry) => entry.accountId === id && entry.date > today())) return toast("帳戶仍有未來日期的收支，請先調整後再刪除。");

  const linkedEntries = state.entries.filter((entry) => entry.accountId === id).length;
  const linkedReconciliations = state.reconciliations.filter((item) => item.accountId === id).length;
  const historyNote = linkedEntries || linkedReconciliations
    ? `\n\n相關的 ${linkedEntries} 筆收支與 ${linkedReconciliations} 筆月結仍會保留原帳戶名稱。`
    : "";
  requestAppActionConfirmation({ title: "刪除帳戶", message: `確定刪除「${account.name}」？刪除後不再提供新增記帳或對帳，QR Code 也會一併撤銷。${historyNote}`, confirmLabel: "確認刪除", action: () => {
    account.active = false; account.deletedAt = new Date().toISOString(); account.qrCodeDataUrl = ""; account.qrCodeName = "";
    if ($("#accountId").value === id) resetAccountForm();
    $("#entryAccount").value = ""; $("#reconcileAccount").value = "";
    refreshAccountSelects(); loadReconciliationForm();
    if (!saveState()) return;
    toast("帳戶已刪除，歷史帳務仍完整保留。");
  }});
}

function saveReconciliation(event) {
  event.preventDefault();
  const month = $("#reconcileMonth").value;
  const accountId = $("#reconcileAccount").value;
  const actualBalance = Number($("#reconcileActual").value);
  if (!month || !accountId || !Number.isFinite(actualBalance)) return toast("請選擇月份、帳戶並輸入實際餘額。");
  if (isMonthLocked(month)) return toast("這個月份已鎖定，請先解鎖。");
  const [year, monthNumber] = month.split("-").map(Number);
  const calculatedBalance = accountBalance(accountId, dateKey(new Date(year, monthNumber, 0)));
  const record = {
    id: `${month}:${accountId}`,
    month,
    accountId,
    calculatedBalance,
    actualBalance,
    difference: actualBalance - calculatedBalance,
    note: $("#reconcileNote").value.trim(),
    updatedAt: new Date().toISOString()
  };
  const index = state.reconciliations.findIndex((item) => item.id === record.id);
  if (index >= 0) state.reconciliations[index] = record;
  else state.reconciliations.push(record);
  if (!saveState()) return;
  toast("月結紀錄已儲存。");
}

function loadReconciliationForm() {
  const month = $("#reconcileMonth").value;
  const accountId = $("#reconcileAccount").value;
  const existing = state.reconciliations.find((item) => item.month === month && item.accountId === accountId);
  $("#reconcileActual").value = existing ? existing.actualBalance : "";
  $("#reconcileNote").value = existing?.note || "";
  renderReconciliationSummary();
}

