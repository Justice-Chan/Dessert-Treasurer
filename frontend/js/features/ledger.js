function resetEntryForm() {
  $("#entryForm").reset();
  $("#entryId").value = "";
  $("#entryFormTitle").textContent = "新增收支";
  $("#entrySubmit").textContent = "儲存";
  $("#entryCancel").textContent = "重設";
  setDateValue("entryDate", today());
  $("#entryType").value = "income";
  setCategoryEditor("entry", "income", "", "");
  setAccountOptions($("#entryAccount"), state.accounts.find((account) => account.active)?.id);
}

function selectEntry(entry) {
  if (!entry) return;
  if (entry.claimId) {
    const claim = state.claims.find((item) => item.id === entry.claimId);
    if (!claim) return toast("找不到這筆支出所連動的報銷資料。");
    document.querySelector('[data-section="reimburse"]').click();
    selectClaim(claim);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (affectsLockedBalance(entry.date)) return toast("這筆資料會影響已鎖定月份的帳面，請先到「對帳」解鎖。");
  $("#entryId").value = entry.id;
  $("#entryFormTitle").textContent = "編輯收支";
  $("#entrySubmit").textContent = "更新";
  $("#entryCancel").textContent = "取消編輯";
  setDateValue("entryDate", entry.date);
  $("#entryType").value = entry.type;
  setCategoryEditor("entry", entry.type, entry.parent, entry.child);
  $("#entryAmount").value = entry.amount;
  $("#entryMethod").value = entry.method || "現金";
  setAccountOptions($("#entryAccount"), entry.accountId, true);
  $("#entryNote").value = entry.note || "";
  document.querySelector('[data-section="ledger"]').click();
  renderLedger();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetClaimForm() {
  $("#claimForm").reset();
  $("#claimId").value = "";
  $("#claimFormTitle").textContent = "新增報銷";
  $("#claimSubmit").textContent = "儲存";
  $("#claimSubmit").hidden = false;
  $("#claimCancel").textContent = "重設";
  $$("#claimForm input, #claimForm select, #claimForm textarea, #claimForm .date-picker-trigger").forEach((control) => { control.disabled = false; });
  $("#claimPaidOption").hidden = true;
  setDateValue("claimDate", today());
  setCategoryEditor("claim", "expense", "", "");
  $("#claimFiles").value = "";
  $("#claimFilesName").textContent = "尚未選取附件";
  $("#claimAttachmentList").innerHTML = "";
}

function selectClaim(claim) {
  if (!claim) return;
  const readOnly = isClaimLocked(claim);
  $$("#claimForm input, #claimForm select, #claimForm textarea, #claimForm .date-picker-trigger").forEach((control) => { control.disabled = false; });
  $("#claimId").value = claim.id;
  $("#claimFormTitle").textContent = readOnly ? "查看報銷" : "編輯報銷";
  $("#claimSubmit").textContent = "更新";
  $("#claimSubmit").hidden = readOnly;
  $("#claimCancel").textContent = readOnly ? "關閉" : "取消編輯";
  setDateValue("claimDate", claim.date);
  $("#claimPerson").value = claim.person;
  setCategoryEditor("claim", "expense", claim.parent, claim.child);
  $("#claimAmount").value = claim.amount;
  $("#claimPaidOption").hidden = claim.status !== "paid";
  $("#claimStatus").value = claim.status;
  $("#claimStatus").disabled = claim.status === "paid";
  $("#claimReceipt").value = claim.receipt;
  $("#claimNote").value = claim.note;
  renderClaimAttachmentList(claim);
  if (readOnly) {
    $$("#claimForm input:not([type=hidden]), #claimForm select, #claimForm textarea, #claimForm .date-picker-trigger").forEach((control) => { control.disabled = true; });
  }
  renderClaims();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderClaimAttachmentList(claim, pendingFiles = []) {
  const attachments = claim?.attachments || [];
  const readOnly = isClaimLocked(claim);
  const savedRows = attachments.map((attachment) => `
    <div class="attachment-item">
      <span>${escapeHtml(attachment.name)}</span>
      <div class="inline-actions">
        <button type="button" data-preview-attachment="${attachment.id}" data-attachment-name="${escapeHtml(attachment.name)}" data-attachment-type="${escapeHtml(attachment.type || "")}">預覽</button>
        <button type="button" data-download-attachment="${attachment.id}">下載</button>
        ${readOnly ? "" : `<button type="button" class="danger" data-remove-attachment="${attachment.id}" data-claim-id="${claim.id}">移除</button>`}
      </div>
    </div>
  `).join("");
  const pendingRows = pendingFiles.map((file, index) => `
    <div class="attachment-item">
      <span>準備上傳：${escapeHtml(file.name)}</span>
      <button type="button" data-preview-pending-claim="${index}">預覽</button>
    </div>
  `).join("");
  $("#claimAttachmentList").innerHTML = savedRows + pendingRows;
}

function upsertEntry(event) {
  event.preventDefault();
  const id = $("#entryId").value || uid();
  const existing = state.entries.find((entry) => entry.id === id);
  if (existing?.claimId) return toast("這筆支出由報銷付款產生，請至報銷頁管理。");
  const category = readCategory("entry");
  if (!category) return toast("請填寫自訂主項目與副項目。");
  const record = {
    id,
    date: $("#entryDate").value,
    type: $("#entryType").value,
    title: existing && existing.parent === category.parent && existing.child === category.child ? existing.title : category.child,
    parent: category.parent,
    child: category.child,
    amount: Number($("#entryAmount").value),
    method: $("#entryMethod").value,
    accountId: $("#entryAccount").value,
    note: $("#entryNote").value.trim()
  };
  if (!isValidDateValue(record.date) || !record.amount) return toast("請填寫有效日期與金額。");
  const account = state.accounts.find((item) => item.id === record.accountId);
  if (account?.openingDate && record.date < account.openingDate) return toast("記帳日期不能早於所選帳戶的期初日期。");
  if (affectsLockedBalance(record.date) || (existing && affectsLockedBalance(existing.date))) return toast("這筆資料會影響已鎖定月份的帳面，請先到「對帳」解鎖。");
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index >= 0) state.entries[index] = record;
  else state.entries.push(record);
  if (!saveState()) return;
  resetEntryForm();
  toast("收支紀錄已儲存。");
}

async function upsertClaim(event) {
  event.preventDefault();
  const id = $("#claimId").value || uid();
  const existing = state.claims.find((claim) => claim.id === id);
  const syncedEntry = state.entries.find((entry) => entry.claimId === id);
  const category = readCategory("claim");
  if (!category) return toast("請填寫自訂主項目與副項目。");
  const record = {
    id,
    date: $("#claimDate").value,
    person: $("#claimPerson").value.trim(),
    title: existing && existing.parent === category.parent && existing.child === category.child ? existing.title : category.child,
    parent: category.parent,
    child: category.child,
    amount: Number($("#claimAmount").value),
    status: existing?.status === "paid" ? "paid" : $("#claimStatus").value,
    paymentDate: existing?.status === "paid" ? existing.paymentDate : "",
    paymentAccountId: existing?.status === "paid" ? existing.paymentAccountId : "",
    receipt: $("#claimReceipt").value.trim(),
    attachments: existing?.attachments || [],
    note: $("#claimNote").value.trim()
  };
  if (!isValidDateValue(record.date) || !record.person || !record.amount) return toast("請填完整日期、申請人與金額。");
  if (isMonthLocked(record.date) || (existing && isMonthLocked(existing.date)) || (syncedEntry && affectsLockedBalance(syncedEntry.date))) return toast("這筆資料會影響已鎖定月份，請先到「對帳」解鎖。");
  let newAttachments = [];
  try {
    newAttachments = await storeReceiptFiles(record.id, Array.from($("#claimFiles").files || []));
    record.attachments = [...record.attachments, ...newAttachments];
  } catch (error) {
    return toast(error.message || "附件儲存失敗。");
  }
  const index = state.claims.findIndex((claim) => claim.id === id);
  if (index >= 0) state.claims[index] = record;
  else state.claims.push(record);

  if (syncedEntry && record.status === "paid") {
    const account = state.accounts.find((item) => item.id === record.paymentAccountId);
    Object.assign(syncedEntry, {
      title: `報銷：${record.title}`,
      date: record.paymentDate || syncedEntry.date,
      type: "expense",
      parent: record.parent,
      child: record.child,
      amount: record.amount,
      method: account?.type === "cash" ? "現金" : "轉帳",
      accountId: record.paymentAccountId || syncedEntry.accountId,
      note: `${record.person}｜${record.receipt || "無憑證註記"}`
    });
  }

  if (!saveState()) {
    await deleteReceipts(newAttachments.map((attachment) => attachment.id)).catch(() => {});
    return;
  }
  resetClaimForm();
  toast("報銷資料已儲存。");
}

function openClaimPayment(claim) {
  if (!claim || claim.status !== "approved") return toast("只有已核准的報銷可以付款。");
  const preferredAccount = state.accounts.find((account) => account.id === "club-bank" && account.active && !account.deletedAt)
    || state.accounts.find((account) => account.active && !account.deletedAt);
  if (!preferredAccount) return toast("請先新增可使用的付款帳戶。");
  $("#claimPaymentId").value = claim.id;
  $("#claimPaymentSummary").textContent = `${claim.person} · ${claim.title} · ${fmt.format(Number(claim.amount))}`;
  setDateValue("claimPaymentDate", today());
  setAccountOptions($("#claimPaymentAccount"), preferredAccount.id);
  $("#claimPaymentDialog").hidden = false;
}

function closeClaimPayment() {
  $("#claimPaymentDialog").hidden = true;
  $("#claimPaymentForm").reset();
  $("#claimPaymentId").value = "";
}

function payClaim(event) {
  event.preventDefault();
  const claim = state.claims.find((item) => item.id === $("#claimPaymentId").value);
  const paymentDate = $("#claimPaymentDate").value;
  const accountId = $("#claimPaymentAccount").value;
  const account = state.accounts.find((item) => item.id === accountId && item.active && !item.deletedAt);
  if (!claim || claim.status !== "approved") return toast("這筆報銷目前無法付款。");
  if (!isValidDateValue(paymentDate) || !account) return toast("請填寫有效付款日期與帳戶。");
  if (account.openingDate && paymentDate < account.openingDate) return toast("付款日期不能早於所選帳戶的期初日期。");
  if (affectsLockedBalance(paymentDate)) return toast("付款日期會影響已鎖定月份的帳面，請先到「對帳」解鎖。");

  const paymentEntry = state.entries.find((entry) => entry.claimId === claim.id) || { id: uid(), claimId: claim.id };
  Object.assign(paymentEntry, {
    date: paymentDate,
    type: "expense",
    title: `報銷：${claim.title}`,
    parent: claim.parent,
    child: claim.child,
    amount: Number(claim.amount),
    method: account.type === "cash" ? "現金" : "轉帳",
    accountId,
    note: `${claim.person}｜${claim.receipt || "無憑證註記"}`
  });
  if (!state.entries.some((entry) => entry.id === paymentEntry.id)) state.entries.push(paymentEntry);
  claim.status = "paid";
  claim.paymentDate = paymentDate;
  claim.paymentAccountId = accountId;
  if (!saveState()) return;
  closeClaimPayment();
  toast("付款已記錄，帳面餘額已同步更新。");
}

function revokeClaimPayment(claim) {
  if (!claim || claim.status !== "paid") return;
  const paymentEntry = state.entries.find((entry) => entry.claimId === claim.id);
  const paymentDate = claim.paymentDate || paymentEntry?.date;
  if (affectsLockedBalance(paymentDate)) return toast("這筆付款會影響已鎖定月份的帳面，請先到「對帳」解鎖。");
  requestAppActionConfirmation({
    title: "撤銷付款",
    message: `撤銷「${claim.title}」的付款後，帳本中的連動支出也會一併移除。`,
    confirmLabel: "確認撤銷",
    action: () => {
      state.entries = state.entries.filter((entry) => entry.claimId !== claim.id);
      claim.status = "approved";
      claim.paymentDate = "";
      claim.paymentAccountId = "";
      if (!saveState()) return;
      toast("付款已撤銷，報銷回到已核准。");
    }
  });
}

