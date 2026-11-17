// Sync with the web dashboard backend (backend/Code.js syncPull and syncPush).
// The web holds review decisions; this app holds payments and every balance. Payments stay here.
const webStatusToApp = { "待審核": "pending", "已核准": "approved", "已付款": "paid", "退回": "rejected" };
let webSyncRunning = false;

function renderWebSyncSettings() {
  $("#webSyncUrl").value = state.webSync.url;
  $("#webSyncSecret").value = state.webSync.secret;
  $("#webSyncStatus").textContent = state.webSync.lastSyncedAt
    ? `上次同步：${new Date(state.webSync.lastSyncedAt).toLocaleString("zh-TW")}`
    : "尚未同步";
}

function saveWebSyncSettings(event) {
  event.preventDefault();
  const url = $("#webSyncUrl").value.trim();
  const secret = $("#webSyncSecret").value.trim();
  if (url && !webSyncUrlPattern.test(url)) return toast("網址需為 Apps Script 網頁應用程式網址，結尾是 /exec。");
  if (secret && secret.length < 32) return toast("同步金鑰至少 32 個字元。");
  state.webSync = { ...state.webSync, url, secret };
  if (!saveState()) return;
  renderWebSyncSettings();
  toast("同步設定已儲存。");
}

// text/plain keeps this a simple CORS request; Apps Script cannot answer a preflight.
async function callWebSync(action, payload = {}) {
  let response;
  try {
    response = await fetch(state.webSync.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, secret: state.webSync.secret, payload })
    });
  } catch {
    throw new Error("無法連線到網頁報帳後端，請檢查網路。");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("網頁報帳後端沒有正確回應，請確認網址。");
  }
  if (!result?.ok) throw new Error(result?.error?.message || "同步失敗。");
  return result.data;
}

function webClaimNote(remote) {
  return [
    remote.activity && `活動／社課：${remote.activity}`,
    remote.vendor && `店家：${remote.vendor}`,
    remote.description,
    remote.reviewNote && `審核備註：${remote.reviewNote}`,
    `網頁申請：${remote.applicantEmail}`
  ].filter(Boolean).join("\n");
}

function appClaimFromWeb(remote) {
  const status = webStatusToApp[remote.status];
  return {
    id: remote.id,
    source: "web",
    date: remote.date,
    person: remote.applicantName || remote.applicantEmail,
    title: remote.child,
    parent: remote.parent,
    child: remote.child,
    amount: Number(remote.amount),
    // A claim the app never paid cannot be paid here; normalizeState would demote it anyway.
    status: status === "paid" ? "approved" : status,
    paymentDate: "",
    paymentAccountId: "",
    receipt: (remote.receiptLinks || []).join(" "),
    attachments: [],
    note: webClaimNote(remote)
  };
}

// The backend issues ids with Utilities.getUuid(); anything else in the Sheet was edited by hand.
const webClaimIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidWebClaim(remote) {
  return remote && typeof remote.id === "string" && webClaimIdPattern.test(remote.id)
    && webStatusToApp[remote.status] && isValidDateValue(remote.date)
    && Number(remote.amount) > 0 && remote.parent && remote.child;
}

// Adds new web claims, follows review decisions on unpaid ones and drops withdrawn ones.
// A claim marked 已付款 on the web becomes approved here with webPaid set: the payment still
// has to be recorded in this app, with its date and account. Returns the counts for the toast.
function mergeWebClaims(pulled) {
  const remoteClaims = (pulled.claims || []).filter(isValidWebClaim);
  const withdrawn = new Set(pulled.withdrawnIds || []);
  const trashedIds = new Set(state.trash.filter((item) => item.kind === "claim").map((item) => item.record?.id));
  const counts = { added: 0, updated: 0, removed: 0, toRecord: 0 };

  const before = state.claims.length;
  state.claims = state.claims.filter((claim) => !(claim.source === "web" && withdrawn.has(claim.id) && claim.status !== "paid"));
  counts.removed = before - state.claims.length;

  remoteClaims.forEach((remote) => {
    const local = state.claims.find((claim) => claim.id === remote.id);
    const status = webStatusToApp[remote.status];
    let claim = local;
    if (!claim) {
      if (trashedIds.has(remote.id)) return;
      claim = appClaimFromWeb(remote);
      state.claims.push(claim);
      counts.added += 1;
    } else {
      // Applicants may edit on the web: an unpaid claim takes every field from there; a paid one
      // keeps its amount and status, which this app recorded with the payment.
      const fresh = appClaimFromWeb(remote);
      const fields = claim.status === "paid" ? ["date", "parent", "child", "title", "note", "receipt"] : ["date", "amount", "parent", "child", "title", "note", "receipt", "status"];
      const changed = fields.filter((field) => claim[field] !== fresh[field]);
      changed.forEach((field) => { claim[field] = fresh[field]; });
      if (changed.length) counts.updated += 1;
      // A paid claim's ledger expense carries its category, so keep the two in step.
      const entry = claim.status === "paid" && state.entries.find((item) => item.claimId === claim.id);
      if (entry) Object.assign(entry, { parent: claim.parent, child: claim.child, title: `報銷：${claim.title}` });
    }
    claim.webPaid = status === "paid" && claim.status !== "paid";
    if (claim.webPaid) counts.toRecord += 1;
  });
  return counts;
}

function webSummaryRows() {
  const totals = monthTotals(today().slice(0, 7));
  return [
    { label: "帳面餘額", amount: totals.balance },
    { label: "本月收入", amount: totals.income },
    { label: "本月支出", amount: totals.expense },
    { label: "待處理報銷", amount: totals.pending },
    ...totals.expenseByParent.map((item) => ({ label: item.label.slice(0, 30), amount: item.value }))
  ].slice(0, 50);
}

async function syncWebClaims() {
  if (webSyncRunning) return;
  if (!state.webSync.url || !state.webSync.secret) {
    toast("請先到「設定」填寫網頁報帳同步網址與金鑰。");
    return;
  }
  webSyncRunning = true;
  $("#syncWebClaims").disabled = true;
  try {
    const counts = mergeWebClaims(await callWebSync("syncPull"));
    if (!saveState()) return;
    await callWebSync("syncPush", { summary: webSummaryRows() });
    state.webSync.lastSyncedAt = new Date().toISOString();
    saveState();
    renderWebSyncSettings();
    const reminder = counts.toRecord ? `有 ${counts.toRecord} 筆網頁已標記付款，請記錄付款。` : "財務彙總已更新。";
    toast(`同步完成：新增 ${counts.added} 筆、更新 ${counts.updated} 筆、移除撤銷 ${counts.removed} 筆。${reminder}`);
  } catch (error) {
    toast(error.message || "同步失敗。");
  } finally {
    webSyncRunning = false;
    $("#syncWebClaims").disabled = false;
  }
}
