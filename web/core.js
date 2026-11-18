// Shared state, page switching, the backend call, theme and Google sign-in.

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
