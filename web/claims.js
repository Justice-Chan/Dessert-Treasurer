// My claims, the treasurer's review list and a claim's detail page.

// ---- My claims ----

// The treasurer edits their own claim from its detail page, and saving or cancelling returns there,
// where its status can then be changed. This holds that claim's id while its form is open.
let editReturnId = "";

async function leaveEdit(message, saved) {
  const id = editReturnId;
  editReturnId = "";
  if (!id) return showOwnClaims(message);
  if (!saved) return show("detail");
  showMessage("載入中…", false, true);
  try {
    // Saving may have sent it back to 待審核, so it is looked up whatever the list filter shows.
    const claim = (await callBackend("listAllRequests", {})).find((item) => item.id === id);
    if (!claim) return showOwnClaims(message);
    clearReceipts();
    openDetail(claim);
    showMessage(message);
  } catch (error) {
    reportError(error);
  }
}

// Where your own claims are listed: My claims for an officer, the review list for the treasurer.
async function showOwnClaims(message) {
  if (currentUser.role === "treasurer") await openReview();
  else {
    show("myClaims");
    await loadMyClaims();
  }
  showMessage(message);
}

async function loadMyClaims() {
  try {
    renderClaims(await callBackend("listMyRequests"));
  } catch (error) {
    reportError(error);
  }
}

// Each row opens the claim for editing, where it can also be withdrawn; the chevron says it opens.
function renderClaims(claims) {
  $("#claimList").replaceChildren(...claims.map((claim) => {
    const row = element("button", "row review-row");
    row.type = "button";
    const top = element("div", "claim-line");
    top.append(element("span", "", `${claim.parent} / ${claim.child}`), element("strong", "claim-amount", `NT$ ${claim.amount.toLocaleString("zh-TW")}`));
    const meta = element("div", "claim-meta");
    meta.append(element("span", `status-dot ${statusClass[claim.status] || ""}`, claim.status), ` · ${[claim.date, claim.vendor, claim.activity, claim.description].filter(Boolean).join(" · ")}`);
    const body = element("div", "review-row-body");
    body.append(top, meta);
    if (claim.reviewNote) body.append(element("div", "claim-note", `審核備註：${claim.reviewNote}`));
    row.append(body, element("span", "chevron", "›"));
    row.addEventListener("click", () => openEditForm(claim));
    const item = element("li");
    item.append(row);
    return item;
  }));
  $("#claimsCount").textContent = `${claims.length} 筆`;
  $("#claimsEmpty").hidden = claims.length > 0;
}

async function withdrawClaim(claim, button, afterwards = loadMyClaims) {
  const summary = `${claim.parent} / ${claim.child}　${money.format(claim.amount)}`;
  if (!window.confirm(`確定要撤銷這筆申請嗎？\n${summary}\n撤銷後申請和收據都會刪除。`)) return;
  button.disabled = true;
  showMessage("撤銷中…", false, true);
  let failure = null;
  try {
    await callBackend("withdrawRequest", { id: claim.id });
  } catch (error) {
    failure = error;
  }
  button.disabled = false;
  await afterwards();
  if (failure) reportError(failure);
  else showMessage("已撤銷這筆申請。");
}

// ---- Treasurer review ----

async function openReview() {
  clearReceipts();
  show("review");
  showMessage("載入中…", false, true);
  // Switching the status filter quickly can return answers out of order; only the latest one draws.
  const request = ++reviewRequestCount;
  try {
    const claims = await callBackend("listAllRequests", { status: $("#reviewStatus").value });
    if (request !== reviewRequestCount) return;
    reviewClaims = claims;
    fillPositionOptions();
    renderReview();
    showMessage("");
  } catch (error) {
    reportError(error);
  }
}

function fillPositionOptions() {
  const select = $("#reviewPosition");
  const chosen = select.value;
  const positions = [...new Set(reviewClaims.map((claim) => claim.applicantPosition).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  select.replaceChildren(new Option("全部職位", ""), ...positions.map((position) => new Option(position, position)));
  select.value = positions.includes(chosen) ? chosen : "";
}

function renderReview() {
  const position = $("#reviewPosition").value;
  $("#reviewPosition").classList.toggle("active", Boolean(position));
  const claims = reviewClaims.filter((claim) => !position || claim.applicantPosition === position);
  // Pending claims are worked oldest first, so nobody waiting long gets buried; the rest stay newest first.
  if ($("#reviewStatus").value === "待審核") claims.reverse();
  $("#reviewList").replaceChildren(...claims.map((claim) => {
    const row = element("button", "row review-row");
    row.type = "button";
    const who = isOwnClaim(claim) ? "本人" : claim.applicantName || claim.applicantEmail;
    const top = element("div", "claim-line");
    top.append(element("span", "", `${claim.parent} / ${claim.child}`), element("strong", "claim-amount", money.format(claim.amount)));
    const meta = element("div", "claim-meta");
    meta.append(element("span", `status-dot ${statusClass[claim.status] || ""}`, claim.status), ` · ${claim.applicantPosition && !isOwnClaim(claim) ? `${who}（${claim.applicantPosition}）` : who} · ${claim.date}`);
    const body = element("div", "review-row-body");
    body.append(top, meta);
    row.append(body, element("span", "chevron", "›"));
    row.addEventListener("click", () => openDetail(claim));
    const item = element("li");
    item.append(row);
    return item;
  }));
  // The total covers exactly the rows shown, so it follows both filters.
  const total = claims.reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
  $("#reviewSummary").textContent = claims.length ? `共 ${claims.length} 筆 · NT$ ${total.toLocaleString("zh-TW")}` : "沒有符合的申請。";
}

function isOwnClaim(claim) {
  return claim.applicantEmail.toLowerCase() === currentUser.email;
}

function openDetail(claim) {
  currentClaim = claim;
  // The treasurer edits their own claims from here.
  $("#detailEdit").hidden = !isOwnClaim(claim);
  const applicant = claim.applicantName ? `${claim.applicantName}（${claim.applicantEmail}）` : claim.applicantEmail;
  const fields = [
    ["申請人", applicant],
    ["消費日期", claim.date],
    ["金額", money.format(claim.amount)],
    ["分類", `${claim.parent} / ${claim.child}`],
    ["活動／社課", claim.activity],
    ["店家", claim.vendor],
    ["說明", claim.description],
    ["狀態", claim.status],
    ["審核人", claim.reviewer],
    ["審核備註", claim.reviewNote]
  ].filter(([, value]) => value);
  $("#detailFields").replaceChildren(...fields.flatMap(([label, value]) => [element("dt", "", label), element("dd", "", value)]));
  $("#reviewNote").value = "";
  setDateField("pay", localToday());
  // Every other status, the usual next step first.
  const order = nextStatuses[claim.status] || reviewStatuses;
  $("#reviewNextStatus").replaceChildren(...order.filter((status) => status !== claim.status).map((status) => new Option(status, status)));
  // Withdrawing deletes the claim, so it sits last in the list rather than as a separate link.
  if (claim.canWithdraw) $("#reviewNextStatus").append(new Option("撤銷申請", withdrawChoice));
  showStatusHint();
  showMessage("");
  show("detail");
  loadReceipts(claim);
  showPayment(claim);
}

// The payment as the ledger recorded it, from the web or from the desktop app.
async function showPayment(claim) {
  try {
    if (!ledger) await loadLedger();
  } catch (error) {
    return;
  }
  const payment = ledger.payments.find((item) => item.id === claim.id);
  if (currentClaim !== claim || !payment) return;
  $("#detailFields").append(element("dt", "", "付款"), element("dd", "", `${payment.date} · ${accountName(payment.accountId)}`));
}

function fillPayAccounts() {
  const accounts = (ledger?.accounts || []).filter((account) => !account.deletedAt);
  $("#payAccount").replaceChildren(...accounts.map((account) => new Option(account.name, account.id)));
  // Claims are usually paid by transfer from the club account.
  const bank = accounts.find((account) => account.type === "bank");
  if (bank) $("#payAccount").value = bank.id;
}

function clearReceipts() {
  receiptUrls.forEach((url) => URL.revokeObjectURL(url));
  receiptUrls = [];
  currentClaim = null;
  $("#payAccount").replaceChildren();
  $("#detailAttachments").replaceChildren();
}

// Receipts come through the backend one at a time; a slow one does not block the others.
// One saved receipt as a Blob, through the backend.
async function fetchAttachment(claimId, index) {
  const file = await callBackend("getAttachment", { id: claimId, index });
  const blob = await (await fetch(`data:${file.type};base64,${file.data}`)).blob();
  return { name: file.name, type: file.type, blob };
}

const isPhoto = (type) => type === "image/jpeg" || type === "image/png";

// Every receipt of a claim is requested at once; each request settles to a file or an error.
function fetchAllAttachments(claim) {
  return Array.from({ length: claim.attachmentCount }, (_, index) =>
    fetchAttachment(claim.id, index).then((file) => ({ file }), (error) => ({ error })));
}

async function loadReceipts(claim) {
  const container = $("#detailAttachments");
  container.replaceChildren(element("p", "subtle", claim.attachmentCount ? "載入收據中…" : "沒有附件。"));
  const requests = fetchAllAttachments(claim);
  // Shown in order as they arrive: a slow first receipt holds back only the ones after it.
  for (let index = 0; index < requests.length; index += 1) {
    let node;
    const { file, error } = await requests[index];
    try {
      if (error) throw error;
      const url = URL.createObjectURL(file.blob);
      receiptUrls.push(url);
      // Receipts open over the page, not in a new tab.
      node = element("button", "receipt");
      node.type = "button";
      if (isPhoto(file.type)) {
        const image = element("img");
        image.src = url;
        image.alt = `收據 ${index + 1}`;
        node.append(image);
      } else {
        node.classList.add("receipt-file");
        node.textContent = `開啟附件 ${index + 1}（${file.name}）`;
      }
      node.addEventListener("click", () => openFilePreview(url, file.type));
    } catch (error) {
      node = element("p", "claim-note", `附件 ${index + 1} 載入失敗：${error.message}`);
    }
    if (currentClaim !== claim) return;
    if (index === 0) container.replaceChildren();
    container.append(node);
  }
}

const withdrawChoice = "withdraw";
const statusHints = {
  "已付款": "會在帳本記一筆支出，從所選帳戶扣款。",
  [withdrawChoice]: "撤銷會刪除這筆申請，收據移到雲端硬碟的垃圾桶。"
};

async function showStatusHint() {
  const choice = $("#reviewNextStatus").value;
  const paying = choice === "已付款";
  const hint = currentClaim?.status === "已付款" && choice !== withdrawChoice ? "帳本裡的這筆付款也會一併刪除。" : statusHints[choice];
  $("#statusHint").textContent = hint || "";
  $("#statusHint").hidden = !hint;
  $("#payFields").hidden = !paying;
  $("#applyStatus").classList.toggle("danger-fill", choice === withdrawChoice);
  $("#applyStatus").textContent = choice === withdrawChoice ? "撤銷申請" : paying ? "記錄付款" : "更新狀態";
  if (!paying) return;
  if (!ledger) {
    try {
      await loadLedger();
    } catch (error) {
      return reportError(error);
    }
  }
  if (!$("#payAccount").options.length) fillPayAccounts();
}

async function reviewClaim() {
  const claim = currentClaim;
  const note = $("#reviewNote").value.trim();
  const status = $("#reviewNextStatus").value;
  if (!claim || !status) return;
  if (status === withdrawChoice) return withdrawClaim(claim, $("#applyStatus"), openReview);
  if (status === "退回" && !note) return showMessage("退回時請填寫審核備註，讓申請人知道原因。", true);
  const paying = status === "已付款";
  if (paying && (!$("#payDate").value || !$("#payAccount").value)) return showMessage("請選擇付款日期與帳戶。", true);
  const buttons = [$("#applyStatus")];
  buttons.forEach((button) => { button.disabled = true; });
  showMessage("處理中…", false, true);
  try {
    if (paying) {
      ledger = await callBackend("payClaim", { id: claim.id, date: $("#payDate").value, accountId: $("#payAccount").value, note });
      await openReview();
      showMessage("已記錄付款，帳本已扣款。");
      return;
    }
    const result = await callBackend("reviewRequest", { id: claim.id, status, note });
    // Leaving 已付款 changed the ledger; it is read again when next needed.
    if (claim.status === "已付款") ledger = null;
    await openReview();
    showMessage(`已將申請改為「${result.status}」。`);
  } catch (error) {
    reportError(error);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}
