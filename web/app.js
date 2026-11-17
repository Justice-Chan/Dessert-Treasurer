const config = window.DASHBOARD_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const roleText = { treasurer: "總務", officer: "幹部" };
const reviewStatuses = ["待審核", "已核准", "退回", "已付款"];
const nextStatuses = {
  "待審核": ["已核准", "已付款", "退回"],
  "已核准": ["已付款", "退回", "待審核"],
  "退回": ["已核准", "待審核", "已付款"],
  "已付款": ["已核准", "待審核", "退回"]
};
const statusClass = { "待審核": "pending", "已核准": "approved", "已付款": "paid", "退回": "rejected" };
const viewLabels = { overview: "Overview", myClaims: "My claims", claimForm: "New claim", review: "Review", detail: "Claim" };
// Summary rows with these labels feed the hero; every other row is a spending category.
const balanceLabel = "帳面餘額";
const expenseLabel = "本月支出";
const totalLabels = [balanceLabel, "本月收入", expenseLabel, "待處理報銷"];
const syncedFormat = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", timeZone: "Asia/Taipei" });
// "dark" and "cake" are the dark and light looks. The system setting picks one
// unless the user has flipped the toggle, which is remembered under themeKey.
const themeNames = ["dark", "cake"];
const themeKey = "dashboard-theme-override";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const imageLongSide = 1600;
const otherCategory = "其他";

// Kept for this tab only (sessionStorage), so a reload stays signed in and closing the tab signs out.
// Google's token expires after an hour; then auto sign-in fetches a fresh one.
const tokenKey = "dashboard-id-token";
// The page a reload returns to.
const viewKey = "dashboard-view";
// Role and name, so a reload draws the drawer at once; the backend still checks the role on every call.
const userKey = "dashboard-user";
let idToken = "";
let categories = {};
let currentClaim = null;
// The last review list from the backend; the position filter narrows it without a new request.
let reviewClaims = [];
let reviewRequestCount = 0;
let receiptUrls = [];
let glyphField = null;
let summary = { items: [] };
let messageTimer = 0;
let limits = { files: 5, fileBytes: 5 * 1024 * 1024, category: 30 };

// "signedOut" shows the landing page; any other view is shown inside the app shell.
function show(view) {
  const signedOut = view === "signedOut";
  delete document.documentElement.dataset.restoring;
  if (!signedOut) {
    try { sessionStorage.setItem(viewKey, view === "detail" ? "review" : view); } catch (error) { /* reload opens the overview */ }
  }
  $("#signedOut").hidden = !signedOut;
  $("#app").hidden = signedOut;
  $("#glyphField").hidden = signedOut;
  Object.keys(viewLabels).forEach((id) => { $(`#${id}`).hidden = id !== view; });
  const section = view === "detail" ? "review" : view;
  document.querySelectorAll("#drawer [data-nav]").forEach((button) => {
    if (button.dataset.nav === section) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#viewLabel").textContent = viewLabels[view] || "";
  setDrawer(false);
  window.scrollTo(0, 0);
  if (signedOut) renderSignInButton();
}

function setDrawer(open) {
  $("#drawer").classList.toggle("open", open);
  $("#scrim").hidden = !open;
  $("#menuButton").setAttribute("aria-expanded", String(open));
}

function navigate(view) {
  showMessage("");
  if (view === "claimForm") return openClaimForm();
  if (view === "review") return openReview();
  clearReceipts();
  show(view);
  return view === "myClaims" ? loadMyClaims() : loadOverview();
}

// Messages fade after three seconds; progress messages stay until replaced.
function showMessage(text, isError = false, sticky = false) {
  clearTimeout(messageTimer);
  $("#message").textContent = text;
  $("#message").hidden = !text;
  $("#message").classList.toggle("error", isError);
  if (text && !sticky) messageTimer = setTimeout(() => { $("#message").hidden = true; }, 3000);
}

// ---- Theme ----

function currentTheme() {
  return document.documentElement.dataset.theme;
}

function storedTheme() {
  try {
    const stored = localStorage.getItem(themeKey);
    return themeNames.includes(stored) ? stored : null;
  } catch (error) {
    return null;
  }
}

function applyTheme(theme = storedTheme() || (systemDark.matches ? "dark" : "cake")) {
  document.documentElement.dataset.theme = theme;
  $("#themeToggle").setAttribute("aria-checked", String(theme === "dark"));
  glyphField?.recolor();
  renderLandingArt($("#landingArt"), theme);
  renderSummary(summary);
  renderSignInButton();
}

function toggleTheme() {
  const theme = currentTheme() === "dark" ? "cake" : "dark";
  try { localStorage.setItem(themeKey, theme); } catch (error) { /* private mode: lasts for this visit only */ }
  applyTheme(theme);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// text/plain keeps this a simple CORS request; Apps Script cannot answer a preflight.
async function callBackend(action, payload = {}) {
  let response;
  try {
    response = await fetch(config.backendUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, idToken, payload })
    });
  } catch (error) {
    throw new Error("無法連線，請檢查網路後再試。");
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error("系統暫時無法回應，請稍後再試或聯絡總務。");
  }
  if (!result.ok) {
    const failure = new Error(result.error?.message || "系統發生錯誤，請稍後再試。");
    failure.code = result.error?.code;
    throw failure;
  }
  return result.data;
}

function rememberToken(token) {
  try {
    if (token) sessionStorage.setItem(tokenKey, token);
    else {
      sessionStorage.removeItem(tokenKey);
      sessionStorage.removeItem(userKey);
    }
  } catch (error) { /* storage blocked: sign-in lasts until reload */ }
}

function showUser(user) {
  $("#userRole").textContent = user.position || roleText[user.role] || "";
  $("#userName").textContent = user.name || (user.email || "").split("@")[0];
  $("#navReview").hidden = user.role !== "treasurer";
}

// The stored token if it has more than a minute left; the expiry is read from its payload.
function storedToken() {
  try {
    const token = sessionStorage.getItem(tokenKey) || "";
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Number(payload.exp) * 1000 > Date.now() + 60000 ? token : "";
  } catch (error) {
    return "";
  }
}

function reportError(error) {
  if (error.code === "unauthenticated" || error.code === "unauthorized") {
    idToken = "";
    rememberToken("");
    show("signedOut");
  }
  showMessage(error.message, true);
}

// ---- Sign-in ----

async function handleCredential(response, view = "overview") {
  idToken = response.credential;
  rememberToken(idToken);
  showMessage("登入中…", false, true);
  try {
    const user = await callBackend("whoami");
    categories = user.categories || {};
    limits = { ...limits, ...user.limits };
    showUser(user);
    try { sessionStorage.setItem(userKey, JSON.stringify({ role: user.role, position: user.position, name: user.name, email: user.email })); } catch (error) { /* drawn after whoami instead */ }
    fillParentOptions();
    showMessage("");
    await navigate(view === "review" && user.role !== "treasurer" ? "overview" : view);
  } catch (error) {
    reportError(error);
  }
}

function signOut() {
  window.google?.accounts.id.disableAutoSelect();
  idToken = "";
  rememberToken("");
  show("signedOut");
  showMessage("已登出。");
}

// Called when the Google Identity Services script finishes loading.
function startSignIn() {
  if (!config.oauthClientId || !config.backendUrl) {
    showMessage("尚未完成設定：請在 config.js 填入 oauthClientId 與 backendUrl。", true, true);
    return;
  }
  // auto_select signs a returning user straight back in; signing out turns it off until the next manual sign-in.
  google.accounts.id.initialize({ client_id: config.oauthClientId, callback: handleCredential, auto_select: true, use_fedcm_for_prompt: true });
  renderSignInButton();
  if (!idToken) google.accounts.id.prompt();
}

function renderSignInButton() {
  if (!window.google?.accounts?.id || !config.oauthClientId) return;
  // A used or once-hidden Google button stops responding, so always draw a fresh one.
  $("#signInButton").replaceChildren();
  google.accounts.id.renderButton($("#signInButton"), {
    theme: currentTheme() === "dark" ? "filled_black" : "outline",
    size: "large",
    shape: "pill",
    locale: "zh_TW"
  });
}

// ---- Overview ----

async function loadOverview() {
  try {
    summary = await callBackend("getSummary");
    renderSummary(summary, true);
  } catch (error) {
    reportError(error);
  }
}

function countUp(node, target) {
  const duration = 700;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    node.textContent = money.format(Math.round(target * (1 - Math.pow(1 - progress, 3))));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderSummary({ items = [], syncedAt = "", pendingReview }, animate = false) {
  const find = (label) => items.find((item) => item.label === label);
  const balance = find(balanceLabel);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!balance) $("#heroBalance").textContent = "—";
  else if (animate && !still) countUp($("#heroBalance"), balance.amount);
  else $("#heroBalance").textContent = money.format(balance.amount);
  const synced = syncedAt ? new Date(syncedAt) : null;
  $("#heroSynced").textContent = synced && !Number.isNaN(synced.getTime()) ? ` · ${syncedFormat.format(synced)} 同步` : "";

  document.querySelectorAll(".stat[data-label]").forEach((stat) => {
    const item = find(stat.dataset.label);
    stat.hidden = !item;
    if (item) stat.querySelector("strong").textContent = money.format(item.amount);
  });
  // Only the treasurer receives a count; it opens the review list.
  $("#heroReview").hidden = typeof pendingReview !== "number";
  $("#heroReview button").textContent = pendingReview > 0 ? `${pendingReview} 筆 →` : "0 筆";

  const spending = items.filter((item) => !totalLabels.includes(item.label));
  const expense = find(expenseLabel);
  const total = expense ? expense.amount : spending.reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const layers = renderCake($("#cakeArt"), spending);
  // Legend rows follow the cake from the top layer down.
  $("#cakeLegend").replaceChildren(...(spending.length ? layers : []).flatMap((layer) => {
    const term = element("dt");
    term.append(element("span", `swatch block layer-${layer.index % maxLayers}`), element("span", "", layer.label));
    const share = total > 0 ? `${Math.round((layer.amount / total) * 100)}%` : "";
    return [term, element("dd", "share", share), element("dd", "", money.format(layer.amount))];
  }));
  $("#summaryEmpty").hidden = items.length > 0;
}

// ---- My claims ----

async function loadMyClaims() {
  try {
    renderClaims(await callBackend("listMyRequests"));
  } catch (error) {
    reportError(error);
  }
}

function renderClaims(claims) {
  $("#claimList").replaceChildren(...claims.map((claim) => {
    // The amount alone holds the right edge; status joins the date as a coloured dot, and
    // withdraw is a muted outline button that only turns red when aimed at.
    const top = element("div", "claim-line");
    top.append(element("span", "", `${claim.parent} / ${claim.child}`), element("strong", "claim-amount", `NT$ ${claim.amount.toLocaleString("zh-TW")}`));
    const bottom = element("div", "claim-line centered");
    const meta = element("span", "claim-meta");
    meta.append(element("span", `status-dot ${statusClass[claim.status] || ""}`, claim.status), ` · ${[claim.date, claim.vendor, claim.activity, claim.description].filter(Boolean).join(" · ")}`);
    bottom.append(meta);
    const actions = element("span", "row-actions");
    const change = element("button", "row-action", "修改");
    change.type = "button";
    change.addEventListener("click", () => openEditForm(claim));
    actions.append(change);
    if (claim.canWithdraw) {
      const button = element("button", "row-action danger", "撤銷");
      button.type = "button";
      button.addEventListener("click", () => withdrawClaim(claim, button));
      actions.append(button);
    }
    bottom.append(actions);
    const item = element("li");
    item.append(top, bottom);
    if (claim.reviewNote) item.append(element("div", "claim-note", `審核備註：${claim.reviewNote}`));
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
    const who = claim.applicantName || claim.applicantEmail;
    const top = element("div", "claim-line");
    top.append(element("span", "", `${claim.parent} / ${claim.child}`), element("strong", "claim-amount", money.format(claim.amount)));
    const meta = element("div", "claim-meta");
    meta.append(element("span", `status-dot ${statusClass[claim.status] || ""}`, claim.status), ` · ${claim.applicantPosition ? `${who}（${claim.applicantPosition}）` : who} · ${claim.date}`);
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

function openDetail(claim) {
  currentClaim = claim;
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
  // Every other status, the usual next step first.
  const order = nextStatuses[claim.status] || reviewStatuses;
  $("#reviewNextStatus").replaceChildren(...order.filter((status) => status !== claim.status).map((status) => new Option(status, status)));
  // Withdrawing deletes the claim, so it sits last in the list rather than as a separate link.
  if (claim.canWithdraw) $("#reviewNextStatus").append(new Option("撤銷申請", withdrawChoice));
  showStatusHint();
  showMessage("");
  show("detail");
  loadReceipts(claim);
}

function clearReceipts() {
  receiptUrls.forEach((url) => URL.revokeObjectURL(url));
  receiptUrls = [];
  currentClaim = null;
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

async function loadReceipts(claim) {
  const container = $("#detailAttachments");
  container.replaceChildren(element("p", "subtle", claim.attachmentCount ? "載入收據中…" : "沒有附件。"));
  for (let index = 0; index < claim.attachmentCount; index += 1) {
    let node;
    try {
      const file = await fetchAttachment(claim.id, index);
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
  "已付款": "標記已付款後，記得在記帳 app 同步並記錄付款，帳面才會扣款。",
  [withdrawChoice]: "撤銷會刪除這筆申請，收據移到雲端硬碟的垃圾桶。"
};

function showStatusHint() {
  const choice = $("#reviewNextStatus").value;
  $("#statusHint").textContent = statusHints[choice] || "";
  $("#statusHint").hidden = !statusHints[choice];
  $("#applyStatus").classList.toggle("danger-fill", choice === withdrawChoice);
  $("#applyStatus").textContent = choice === withdrawChoice ? "撤銷申請" : "更新狀態";
}

async function reviewClaim() {
  const claim = currentClaim;
  const note = $("#reviewNote").value.trim();
  const status = $("#reviewNextStatus").value;
  if (!claim || !status) return;
  if (status === withdrawChoice) return withdrawClaim(claim, $("#applyStatus"), openReview);
  if (status === "退回" && !note) return showMessage("退回時請填寫審核備註，讓申請人知道原因。", true);
  const buttons = [$("#applyStatus")];
  buttons.forEach((button) => { button.disabled = true; });
  showMessage("處理中…", false, true);
  try {
    const result = await callBackend("reviewRequest", { id: claim.id, status, note });
    await openReview();
    showMessage(`已將申請改為「${result.status}」。`);
  } catch (error) {
    reportError(error);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

// ---- New claim ----

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function setOptions(select, values) {
  select.replaceChildren(...values.map((value) => new Option(value, value)));
}

function fillParentOptions() {
  setOptions($("#claimParent"), [...Object.keys(categories), otherCategory]);
  fillChildOptions();
}

// Same rule as the desktop app, except 其他 turns the dropdown itself into a text field.
function fillChildOptions() {
  const parent = $("#claimParent").value;
  setOptions($("#claimChild"), parent === otherCategory ? [otherCategory] : [...(categories[parent] || []), otherCategory]);
  showOtherFields();
}

// Pickers whose last option swaps the dropdown for a text field: the value of that option,
// and how long the typed name may be.
const pickers = {
  claimParent: { custom: otherCategory, maxLength: () => limits.category },
  claimChild: { custom: otherCategory, maxLength: () => limits.category },
  claimActivity: { custom: "new", maxLength: () => 60 }
};

function showOtherFields(focusId) {
  Object.entries(pickers).forEach(([id, picker]) => {
    const custom = $(`#${id}`).value === picker.custom;
    const input = $(`#${id}Other`);
    $(`#${id}`).hidden = custom;
    input.hidden = !custom;
    input.maxLength = picker.maxLength();
    // A list holding only the custom option has nothing to go back to.
    $(`[data-picker="${id}"]`).hidden = !custom || $(`#${id}`).options.length < 2;
    if (!custom) input.value = "";
    else if (id === focusId) input.focus();
  });
  showActivityHint();
}

// ---- Activities ----
// The month's activity folders come from the backend; picking one files the receipts there.

let activityNames = new Set();

// When editing, the list is the claim's own month and starts on its current activity; an activity
// no longer in that list stays selectable as "keep".
let activityAtStart = "";

async function loadActivities(month = "", current = "") {
  const select = $("#claimActivity");
  select.replaceChildren(new Option("載入中…", ""));
  select.disabled = true;
  let activities = [];
  try {
    activities = await callBackend("listActivities", month ? { month } : {});
  } catch (error) {
    showMessage("讀不到活動清單，可以直接輸入活動名稱。", true);
  }
  activityNames = new Set(activities.map((activity) => activity.name));
  const options = activities.map((activity) => new Option(activity.label, activity.id));
  const match = activities.find((activity) => activity.label === current);
  if (current && !match) options.unshift(new Option(current, "keep"));
  select.replaceChildren(...options, new Option("其他（新活動）", pickers.claimActivity.custom));
  select.value = current ? (match ? match.id : "keep") : select.options[0].value;
  activityAtStart = current ? select.value : "";
  select.disabled = false;
  showOtherFields();
}

function chosenActivity() {
  const select = $("#claimActivity");
  if (select.value === pickers.claimActivity.custom) return { activityName: $("#claimActivityOther").value.trim() };
  if (editingClaim && select.value === activityAtStart) return {};
  return { activityId: select.value };
}

function showActivityHint() {
  const typed = $("#claimActivityOther").hidden ? "" : $("#claimActivityOther").value.trim();
  const hint = $("#activityHint");
  hint.hidden = !activityNames.has(typed);
  hint.textContent = `本月已有「${typed}」。送出會建立新的一堂；同一堂請改從選單選。`;
}

function leaveCustomCategory(id) {
  $(`#${id}`).selectedIndex = 0;
  if (id === "claimActivity") {
    showOtherFields();
    return $(`#${id}`).focus();
  }
  if (id === "claimParent") fillChildOptions();
  else showOtherFields();
  $(`#${id}`).focus();
}

function categoryValue(select, input) {
  return $(select).value === otherCategory ? $(input).value.trim() : $(select).value;
}

// The claim being edited, or null when the form makes a new one.
let editingClaim = null;

function setFormMode(claim) {
  editingClaim = claim;
  const fixedAmount = Boolean(claim) && claim.editable !== "full";
  $("#claimFormTitle").textContent = claim ? "修改報帳" : "新增報帳";
  $("#claimSubmit").textContent = claim ? "儲存修改" : "送出";
  $("#editNote").hidden = !claim;
  const note = fixedAmount ? "這筆申請已付款，金額不能修改。" : claim?.status === "退回" || claim?.status === "已核准" ? "儲存後會重新送審。" : "";
  $("#editNote").textContent = note;
  $("#editNote").hidden = !note;
  $("#claimAmount").disabled = fixedAmount;
}

function openClaimForm() {
  $("#claimForm").reset();
  selectedFiles = [];
  setFormMode(null);
  fillParentOptions();
  setClaimDate(localToday());
  closeCalendar();
  showSelectedFiles();
  showMessage("");
  show("claimForm");
  loadActivities();
}

// Picks a list value, or 其他 with the text filled in when the value is not in the list.
function setCategory(id, value) {
  const listed = [...$(`#${id}`).options].some((option) => option.value === value);
  $(`#${id}`).value = listed ? value : otherCategory;
  $(`#${id}Other`).value = listed ? "" : value;
}

// Saved receipts join the file list as entries with existingIndex; removing one drops it on save.
async function loadSavedReceipts(claim) {
  showSelectedFiles();
  if (!claim.attachmentCount) return;
  $("#claimFilesHint").textContent = "載入收據中…";
  const saved = [];
  for (let index = 0; index < claim.attachmentCount; index += 1) {
    try {
      const file = await fetchAttachment(claim.id, index);
      saved.push({ ...file, size: file.blob.size, lastModified: -1 - index, existingIndex: index });
    } catch (error) {
      showMessage(`收據 ${index + 1} 載入失敗；儲存時會保留原檔。`, true);
      saved.push({ name: `收據 ${index + 1}`, type: "", size: 0, lastModified: -1 - index, existingIndex: index, blob: new Blob() });
    }
  }
  if (editingClaim !== claim) return;
  selectedFiles = [...saved, ...selectedFiles];
  showSelectedFiles();
}

function openEditForm(claim) {
  $("#claimForm").reset();
  selectedFiles = [];
  fillParentOptions();
  setCategory("claimParent", claim.parent);
  fillChildOptions();
  setCategory("claimChild", claim.child);
  showOtherFields();
  setCategory("claimParent", claim.parent);
  setCategory("claimChild", claim.child);
  setClaimDate(claim.date);
  closeCalendar();
  $("#claimAmount").value = claim.amount;
  $("#claimVendor").value = claim.vendor;
  $("#claimDescription").value = claim.description;
  setFormMode(claim);
  showMessage("");
  show("claimForm");
  loadActivities(claim.month, claim.activity);
  loadSavedReceipts(claim);
  // Editing belongs to My claims, so the drawer and top bar say so.
  document.querySelectorAll("#drawer [data-nav]").forEach((button) => {
    if (button.dataset.nav === "myClaims") button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#viewLabel").textContent = "Edit claim";
}

// ---- Receipt files ----
// Picked files are kept here rather than in the file input, so each can be removed on its own
// and later picks add to the list instead of replacing it.

let selectedFiles = [];
let fileUrls = [];

function addFiles(files) {
  const known = new Set(selectedFiles.map((file) => `${file.name}|${file.size}|${file.lastModified}`));
  const fresh = Array.from(files).filter((file) => !known.has(`${file.name}|${file.size}|${file.lastModified}`));
  const room = limits.files - selectedFiles.length;
  if (fresh.length > room) showMessage(`一次最多上傳 ${limits.files} 個附件。`, true);
  selectedFiles = [...selectedFiles, ...fresh.slice(0, Math.max(room, 0))];
  showSelectedFiles();
}

// A plain page outline; static markup, no user data.
const fileIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

// Photos and PDFs open in a layer over the page with a close button.
function openFilePreview(url, type = "image/jpeg") {
  const photo = isPhoto(type) || !type;
  $("#filePreviewImage").hidden = !photo;
  $("#filePreviewFrame").hidden = photo;
  if (photo) $("#filePreviewImage").src = url;
  else $("#filePreviewFrame").src = url;
  $("#filePreview").classList.toggle("document", !photo);
  $("#filePreview").showModal();
}

function removeFile(index) {
  selectedFiles = selectedFiles.filter((_, position) => position !== index);
  showSelectedFiles();
}

function showSelectedFiles() {
  fileUrls.forEach((url) => URL.revokeObjectURL(url));
  fileUrls = [];
  const megabytes = Math.round(limits.fileBytes / 1024 / 1024);
  // At the limit the upload area greys out and stops taking files, instead of refusing after a pick.
  const full = selectedFiles.length >= limits.files;
  $("#claimDropzone").classList.toggle("full", full);
  $("#claimFiles").disabled = full;
  $("#claimDropzoneTitle").textContent = full ? `已達 ${limits.files} 個上限` : "拍照或選擇檔案";
  $("#claimFilesHint").textContent = full
    ? "移除其中一個才能再加"
    : selectedFiles.length
      ? `已選 ${selectedFiles.length} / ${limits.files} 個`
      : `JPG、PNG、HEIC 或 PDF，最多 ${limits.files} 個，每個 ${megabytes} MB 內`;
  $("#claimFileList").replaceChildren(...selectedFiles.map((file, index) => {
    const item = element("li");
    const url = URL.createObjectURL(file.blob || file);
    fileUrls.push(url);
    // The thumbnail opens a larger view over the page.
    const preview = element("button", "file-thumb");
    preview.type = "button";
    preview.setAttribute("aria-label", `預覽 ${file.name}`);
    if (isPhoto(file.type)) {
      const image = element("img");
      image.src = url;
      image.alt = "";
      preview.append(image);
      preview.addEventListener("click", () => openFilePreview(url, file.type));
    } else {
      preview.classList.add("file-icon");
      preview.innerHTML = fileIcon;
      preview.append(element("span", "", file.type === "application/pdf" ? "PDF" : "HEIC"));
      preview.addEventListener("click", () => openFilePreview(url, file.type));
    }
    const remove = element("button", "file-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `移除 ${file.name}`);
    remove.addEventListener("click", () => removeFile(index));
    const name = element("span", "file-name", file.name);
    name.title = file.name;
    item.append(preview, name, remove);
    return item;
  }));
}

// ---- Date picker ----
// A small calendar drawn with the page's own colours; the browser's picker ignores the theme.

const earliestClaimDate = "2020-01-01";
let calendarMonth = "";
// "days" shows one month; "months" shows the twelve months of calendarMonth's year.
let calendarView = "days";

function setClaimDate(value) {
  $("#claimDate").value = value;
  $("#claimDateButton").textContent = value.replaceAll("-", "/");
}

function shiftMonth(month, delta) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function renderCalendar() {
  const [year, number] = calendarMonth.split("-").map(Number);
  const today = localToday();
  const months = calendarView === "months";
  $("#calendarDays").hidden = months;
  $(".calendar-weekdays").hidden = months;
  $("#calendarMonths").hidden = !months;
  $("#calendarMonth").setAttribute("aria-label", months ? "回到日期" : "選擇月份");
  if (months) {
    $("#calendarMonth").textContent = `${year} 年`;
    $("#calendarPrev").setAttribute("aria-label", "上一年");
    $("#calendarNext").setAttribute("aria-label", "下一年");
    $("#calendarPrev").disabled = year - 1 < Number(earliestClaimDate.slice(0, 4));
    $("#calendarNext").disabled = year + 1 > Number(today.slice(0, 4));
    $("#calendarMonths").replaceChildren(...Array.from({ length: 12 }, (_, index) => {
      const value = `${year}-${String(index + 1).padStart(2, "0")}`;
      const button = element("button", "", `${index + 1} 月`);
      button.type = "button";
      button.dataset.month = value;
      button.disabled = value > today.slice(0, 7) || value < earliestClaimDate.slice(0, 7);
      if (value === ($("#claimDate").value || today).slice(0, 7)) button.setAttribute("aria-pressed", "true");
      return button;
    }));
    return;
  }
  $("#calendarPrev").setAttribute("aria-label", "上個月");
  $("#calendarNext").setAttribute("aria-label", "下個月");
  const firstWeekday = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, number, 0)).getUTCDate();
  $("#calendarMonth").textContent = `${year} 年 ${number} 月`;
  $("#calendarPrev").disabled = shiftMonth(calendarMonth, -1) < earliestClaimDate.slice(0, 7);
  $("#calendarNext").disabled = shiftMonth(calendarMonth, 1) > today.slice(0, 7);
  const cells = Array.from({ length: firstWeekday }, () => element("span"));
  for (let day = 1; day <= dayCount; day += 1) {
    const value = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const button = element("button", "calendar-day", String(day));
    button.type = "button";
    button.dataset.date = value;
    button.disabled = value > today || value < earliestClaimDate;
    if (value === today) button.classList.add("today");
    if (value === $("#claimDate").value) button.setAttribute("aria-pressed", "true");
    cells.push(button);
  }
  $("#calendarDays").replaceChildren(...cells);
}

function openCalendar() {
  calendarMonth = ($("#claimDate").value || localToday()).slice(0, 7);
  calendarView = "days";
  renderCalendar();
  $("#claimCalendar").hidden = false;
  $("#claimDateButton").setAttribute("aria-expanded", "true");
  ($("#calendarDays [aria-pressed='true']") || $("#calendarDays button:not(:disabled)"))?.focus();
}

function closeCalendar(returnFocus) {
  if ($("#claimCalendar").hidden) return;
  $("#claimCalendar").hidden = true;
  $("#claimDateButton").setAttribute("aria-expanded", "false");
  if (returnFocus) $("#claimDateButton").focus();
}

function pickDate(value) {
  setClaimDate(value);
  closeCalendar(true);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Photos are redrawn as JPEG with the long side capped, which keeps uploads small and
// drops location metadata. Files the browser cannot decode are sent unchanged.
async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    return file;
  }
  const scale = Math.min(1, imageLongSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  return blob || file;
}

async function prepareAttachment(file) {
  const blob = file.type.startsWith("image/") ? await shrinkImage(file) : file;
  if (blob.size > limits.fileBytes) throw new Error(`「${file.name}」太大，請壓縮後再上傳。`);
  return { type: blob.type, data: await blobToBase64(blob) };
}

async function submitClaim(event) {
  event.preventDefault();
  const files = selectedFiles;
  const amount = Number($("#claimAmount").value);
  if (!$("#claimDate").value) return showMessage("請填寫消費日期。", true);
  if (!Number.isInteger(amount) || amount < 1) return showMessage("金額請填正整數。", true);
  const parent = categoryValue("#claimParent", "#claimParentOther");
  const child = categoryValue("#claimChild", "#claimChildOther");
  if (!parent || !child || parent === otherCategory || child === otherCategory) return showMessage("請選擇主項目與副項目；選「其他」時請填寫名稱。", true);
  const activity = chosenActivity();
  const activityMissing = $("#claimActivity").value === pickers.claimActivity.custom ? !activity.activityName : !$("#claimActivity").value;
  if (activityMissing) return showMessage("請選擇活動／社課；新活動請填寫名稱。", true);
  if (editingClaim) return saveEdit({ date: $("#claimDate").value, amount, parent, child, ...activity });
  if (files.length > limits.files) return showMessage(`一次最多上傳 ${limits.files} 個附件。`, true);

  const button = $("#claimSubmit");
  button.disabled = true;
  button.textContent = "送出中…";
  showMessage("正在上傳，請不要關閉頁面。", false, true);
  try {
    await callBackend("submitRequest", {
      date: $("#claimDate").value,
      amount,
      parent,
      child,
      ...activity,
      vendor: $("#claimVendor").value,
      description: $("#claimDescription").value,
      attachments: await Promise.all(files.map(prepareAttachment))
    });
    show("myClaims");
    showMessage("報帳已送出，等待總務審核。");
    await loadMyClaims();
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = "送出";
  }
}

async function saveEdit(fields) {
  const button = $("#claimSubmit");
  button.disabled = true;
  button.textContent = "儲存中…";
  showMessage("正在儲存，請不要關閉頁面。", false, true);
  try {
    const fresh = selectedFiles.filter((file) => file.existingIndex === undefined);
    await callBackend("editRequest", {
      id: editingClaim.id,
      ...fields,
      vendor: $("#claimVendor").value,
      description: $("#claimDescription").value,
      keep: selectedFiles.filter((file) => file.existingIndex !== undefined).map((file) => file.existingIndex),
      attachments: await Promise.all(fresh.map(prepareAttachment))
    });
    setFormMode(null);
    show("myClaims");
    showMessage("已儲存修改。");
    await loadMyClaims();
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = editingClaim ? "儲存修改" : "送出";
  }
}

$("#signOut").addEventListener("click", signOut);
$("#themeToggle").addEventListener("click", toggleTheme);
systemDark.addEventListener("change", () => applyTheme());
$("#menuButton").addEventListener("click", () => setDrawer(true));
$("#scrim").addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setDrawer(false); });
document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
$("#reviewStatus").addEventListener("change", openReview);
$("#reviewPosition").addEventListener("change", renderReview);
$("#detailBack").addEventListener("click", openReview);
$("#applyStatus").addEventListener("click", reviewClaim);
$("#reviewNextStatus").addEventListener("change", showStatusHint);
$("#claimParent").addEventListener("change", fillChildOptions);
$("#claimParent").addEventListener("change", () => showOtherFields("claimParent"));
$("#claimChild").addEventListener("change", () => showOtherFields("claimChild"));
$("#claimActivity").addEventListener("change", () => showOtherFields("claimActivity"));
$("#claimActivityOther").addEventListener("input", showActivityHint);
document.querySelectorAll("[data-picker]").forEach((button) => button.addEventListener("click", () => leaveCustomCategory(button.dataset.picker)));
$("#claimDateButton").addEventListener("click", () => ($("#claimCalendar").hidden ? openCalendar() : closeCalendar(true)));
// A year step can land past today; clamp to the newest month that may be picked.
function stepCalendar(direction) {
  const step = calendarView === "months" ? 12 : 1;
  calendarMonth = shiftMonth(calendarMonth, direction * step);
  if (calendarMonth > localToday().slice(0, 7)) calendarMonth = localToday().slice(0, 7);
  renderCalendar();
}

$("#calendarPrev").addEventListener("click", () => stepCalendar(-1));
$("#calendarNext").addEventListener("click", () => stepCalendar(1));
$("#calendarMonth").addEventListener("click", () => {
  calendarView = calendarView === "days" ? "months" : "days";
  renderCalendar();
});
$("#calendarMonths").addEventListener("click", (event) => {
  const month = event.target.closest("[data-month]");
  if (!month || month.disabled) return;
  calendarMonth = month.dataset.month;
  calendarView = "days";
  renderCalendar();
});
$("#calendarToday").addEventListener("click", () => pickDate(localToday()));
$("#calendarDays").addEventListener("click", (event) => {
  const day = event.target.closest("[data-date]");
  if (day && !day.disabled) pickDate(day.dataset.date);
});
$("#claimCalendar").addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.stopPropagation(); closeCalendar(true); }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".date-field")) closeCalendar();
});
$("#claimFiles").addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});
// On a computer, files can also be dropped onto the upload area.
$("#claimDropzone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("#claimDropzone").classList.add("dragging");
});
$("#claimDropzone").addEventListener("dragleave", () => $("#claimDropzone").classList.remove("dragging"));
$("#claimDropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("#claimDropzone").classList.remove("dragging");
  addFiles(event.dataTransfer.files);
});
// Cancel clears the form and stays on it.
$("#claimCancel").addEventListener("click", () => (editingClaim ? (setFormMode(null), navigate("myClaims")) : openClaimForm()));
$("#filePreviewClose").addEventListener("click", () => $("#filePreview").close());
$("#filePreview").addEventListener("click", (event) => {
  if (event.target === $("#filePreview")) $("#filePreview").close();
});
$("#claimForm").addEventListener("submit", submitClaim);

glyphField = startGlyphField($("#glyphField"));
renderMotes($("#landingMotes"));
applyTheme();
// A reload in the same tab goes straight back to the page it was on, without the landing page.
function restoreSession() {
  const token = storedToken();
  if (!token) return show("signedOut");
  let view = "overview";
  try { view = sessionStorage.getItem(viewKey) || view; } catch (error) { /* keep the overview */ }
  if (!Object.hasOwn(viewLabels, view) || view === "detail") view = "overview";
  try { showUser(JSON.parse(sessionStorage.getItem(userKey)) || {}); } catch (error) { /* drawn after whoami */ }
  show(view);
  handleCredential({ credential: token }, view);
}
restoreSession();
