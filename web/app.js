const config = window.DASHBOARD_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const roleText = { treasurer: "總務", officer: "幹部" };
const statusClass = { "待審核": "pending", "已核准": "approved", "已付款": "paid", "退回": "rejected" };
const viewLabels = { overview: "OVERVIEW", myClaims: "MY CLAIMS", claimForm: "NEW CLAIM", review: "REVIEW", detail: "CLAIM" };
// Summary rows with these labels feed the hero; every other row is a spending category.
const balanceLabel = "帳面餘額";
const chipLabels = ["本月收入", "本月支出", "待處理報銷"];
// "dark" and "cake" are the dark and light looks. The system setting picks one
// unless the user has flipped the toggle, which is remembered under themeKey.
const themeNames = ["dark", "cake"];
const themeKey = "dashboard-theme-override";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const imageLongSide = 1600;
const otherCategory = "其他";

// Kept in memory only, so closing the tab signs the user out.
let idToken = "";
let categories = {};
let currentClaim = null;
let receiptUrls = [];
let glyphField = null;
let summaryItems = [];
let limits = { files: 5, fileBytes: 5 * 1024 * 1024, category: 30 };

// "signedOut" shows the landing page; any other view is shown inside the app shell.
function show(view) {
  const signedOut = view === "signedOut";
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

function showMessage(text, isError = false) {
  $("#message").textContent = text;
  $("#message").hidden = !text;
  $("#message").classList.toggle("error", isError);
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
  renderSummary(summaryItems);
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

function reportError(error) {
  if (error.code === "unauthenticated" || error.code === "unauthorized") {
    idToken = "";
    show("signedOut");
  }
  showMessage(error.message, true);
}

// ---- Sign-in ----

async function handleCredential(response) {
  idToken = response.credential;
  showMessage("登入中…");
  try {
    const user = await callBackend("whoami");
    categories = user.categories || {};
    limits = { ...limits, ...user.limits };
    $("#userLabel").textContent = roleText[user.role] || user.role;
    $("#navReview").hidden = user.role !== "treasurer";
    $("#heroReview").hidden = user.role !== "treasurer";
    fillParentOptions();
    show("overview");
    showMessage("");
    await loadOverview();
  } catch (error) {
    reportError(error);
  }
}

function signOut() {
  window.google?.accounts.id.disableAutoSelect();
  idToken = "";
  show("signedOut");
  showMessage("已登出。");
}

// Called when the Google Identity Services script finishes loading.
function startSignIn() {
  if (!config.oauthClientId || !config.backendUrl) {
    showMessage("尚未完成設定：請在 config.js 填入 oauthClientId 與 backendUrl。", true);
    return;
  }
  google.accounts.id.initialize({ client_id: config.oauthClientId, callback: handleCredential });
  renderSignInButton();
}

function renderSignInButton() {
  if (!window.google?.accounts?.id || !config.oauthClientId) return;
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
    summaryItems = (await callBackend("getSummary")).items || [];
    renderSummary(summaryItems, true);
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

function renderSummary(items, animate = false) {
  const balance = items.find((item) => item.label === balanceLabel);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!balance) $("#heroBalance").textContent = "—";
  else if (animate && !still) countUp($("#heroBalance"), balance.amount);
  else $("#heroBalance").textContent = money.format(balance.amount);

  $("#heroChips").replaceChildren(...chipLabels.map((label) => items.find((item) => item.label === label)).filter(Boolean).map((item) => {
    const chip = element("span", "chip");
    chip.append(element("span", "", item.label), money.format(item.amount));
    return chip;
  }));

  const spending = items.filter((item) => item.label !== balanceLabel && !chipLabels.includes(item.label));
  const theme = currentTheme();
  const layers = renderCake($("#cakeArt"), spending, theme);
  $("#cakeLegend").replaceChildren(...(spending.length ? layers.slice().reverse() : []).flatMap((layer) => {
    const term = element("dt");
    const swatch = theme === "cake"
      ? element("span", `swatch block layer-${layer.index % maxLayers}`)
      : element("span", "swatch", cakeGlyphs[layer.index % cakeGlyphs.length]);
    term.append(swatch, element("span", "", layer.label));
    return [term, element("dd", "", money.format(layer.amount))];
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
    const item = element("li");
    item.append(...claimLines(claim, [claim.date, claim.vendor, claim.activity, claim.description]));
    if (claim.reviewNote) item.append(element("div", "claim-note", `審核備註：${claim.reviewNote}`));
    if (claim.canWithdraw) {
      const button = element("button", "link danger", "撤銷這筆申請");
      button.type = "button";
      button.addEventListener("click", () => withdrawClaim(claim, button));
      item.append(button);
    }
    return item;
  }));
  $("#claimsEmpty").hidden = claims.length > 0;
}

async function withdrawClaim(claim, button, afterwards = loadMyClaims) {
  const summary = `${claim.parent} / ${claim.child}　${money.format(claim.amount)}`;
  if (!window.confirm(`確定要撤銷這筆申請嗎？\n${summary}\n撤銷後申請和收據都會刪除。`)) return;
  button.disabled = true;
  showMessage("撤銷中…");
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

function claimLines(claim, metaParts) {
  const top = element("div", "claim-line");
  top.append(element("span", "", `${claim.parent} / ${claim.child}`), element("strong", "", money.format(claim.amount)));
  const bottom = element("div", "claim-line");
  bottom.append(
    element("span", "claim-meta", metaParts.filter(Boolean).join("・")),
    element("span", `pill ${statusClass[claim.status] || ""}`, claim.status)
  );
  return [top, bottom];
}

async function openReview() {
  clearReceipts();
  show("review");
  showMessage("載入中…");
  try {
    const claims = await callBackend("listAllRequests", { status: $("#reviewStatus").value });
    $("#reviewList").replaceChildren(...claims.map((claim) => {
      const row = element("button", "row");
      row.type = "button";
      row.append(...claimLines(claim, [claim.applicantName || claim.applicantEmail, claim.date]));
      row.addEventListener("click", () => openDetail(claim));
      const item = element("li");
      item.append(row);
      return item;
    }));
    $("#reviewEmpty").hidden = claims.length > 0;
    showMessage("");
  } catch (error) {
    reportError(error);
  }
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
  $("#approveClaim").hidden = !claim.canApprove;
  $("#rejectClaim").hidden = !claim.canReject;
  $("#reviewControls").hidden = !claim.canApprove && !claim.canReject;
  $("#withdrawFromDetail").hidden = !claim.canWithdraw;
  $("#detailLocked").hidden = claim.canApprove || claim.canReject || claim.canWithdraw;
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
async function loadReceipts(claim) {
  const container = $("#detailAttachments");
  container.replaceChildren(element("p", "subtle", claim.attachmentCount ? "載入收據中…" : "沒有附件。"));
  for (let index = 0; index < claim.attachmentCount; index += 1) {
    let node;
    try {
      const file = await callBackend("getAttachment", { id: claim.id, index });
      const blob = await (await fetch(`data:${file.type};base64,${file.data}`)).blob();
      const url = URL.createObjectURL(blob);
      receiptUrls.push(url);
      node = element("a", "receipt");
      node.href = url;
      node.target = "_blank";
      node.rel = "noopener";
      if (file.type === "image/jpeg" || file.type === "image/png") {
        const image = element("img");
        image.src = url;
        image.alt = `收據 ${index + 1}`;
        node.append(image);
      } else {
        node.textContent = `開啟附件 ${index + 1}（${file.name}）`;
        node.download = file.name;
      }
    } catch (error) {
      node = element("p", "claim-note", `附件 ${index + 1} 載入失敗：${error.message}`);
    }
    if (currentClaim !== claim) return;
    if (index === 0) container.replaceChildren();
    container.append(node);
  }
}

async function reviewClaim(decision) {
  const claim = currentClaim;
  const note = $("#reviewNote").value.trim();
  if (!claim) return;
  if (decision === "reject" && !note) return showMessage("退回時請填寫審核備註，讓申請人知道原因。", true);
  const buttons = [$("#approveClaim"), $("#rejectClaim")];
  buttons.forEach((button) => { button.disabled = true; });
  showMessage("處理中…");
  try {
    const result = await callBackend("reviewRequest", { id: claim.id, decision, note });
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

function setOptions(select, values, placeholder) {
  const options = values.map((value) => new Option(value, value));
  select.replaceChildren(...(placeholder ? [new Option(placeholder, ""), ...options] : options));
}

function fillParentOptions() {
  setOptions($("#claimParent"), [...Object.keys(categories), otherCategory], "請選擇");
  fillChildOptions();
}

// Same rule as the desktop app: 其他 reveals a text field for a custom name.
function fillChildOptions() {
  const parent = $("#claimParent").value;
  if (parent === otherCategory) setOptions($("#claimChild"), [otherCategory]);
  else setOptions($("#claimChild"), parent ? [...(categories[parent] || []), otherCategory] : [], "請選擇");
  showOtherFields();
}

function showOtherFields() {
  [["#claimParent", "#claimParentOther"], ["#claimChild", "#claimChildOther"]].forEach(([select, input]) => {
    $(input).hidden = $(select).value !== otherCategory;
    $(input).maxLength = limits.category;
    if ($(input).hidden) $(input).value = "";
  });
}

function categoryValue(select, input) {
  return $(select).value === otherCategory ? $(input).value.trim() : $(select).value;
}

function openClaimForm() {
  $("#claimForm").reset();
  fillChildOptions();
  $("#claimDate").max = localToday();
  $("#claimDate").value = localToday();
  $("#claimFilesHint").textContent = `最多 ${limits.files} 個檔案，照片會自動縮小後上傳。`;
  showMessage("");
  show("claimForm");
}

function showSelectedFiles() {
  const count = $("#claimFiles").files.length;
  $("#claimFilesHint").textContent = count
    ? `已選 ${count} 個檔案。`
    : `最多 ${limits.files} 個檔案，照片會自動縮小後上傳。`;
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
  const files = Array.from($("#claimFiles").files);
  const amount = Number($("#claimAmount").value);
  if (!$("#claimDate").value) return showMessage("請填寫消費日期。", true);
  if (!Number.isInteger(amount) || amount < 1) return showMessage("金額請填正整數。", true);
  const parent = categoryValue("#claimParent", "#claimParentOther");
  const child = categoryValue("#claimChild", "#claimChildOther");
  if (!parent || !child || parent === otherCategory || child === otherCategory) return showMessage("請選擇主項目與副項目；選「其他」時請填寫名稱。", true);
  if (!files.length) return showMessage("請至少附上一張收據照片。", true);
  if (files.length > limits.files) return showMessage(`一次最多上傳 ${limits.files} 個附件。`, true);

  const button = $("#claimSubmit");
  button.disabled = true;
  button.textContent = "送出中…";
  showMessage("正在上傳，請不要關閉頁面。");
  try {
    await callBackend("submitRequest", {
      date: $("#claimDate").value,
      amount,
      parent,
      child,
      activity: $("#claimActivity").value,
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

$("#signOut").addEventListener("click", signOut);
$("#themeToggle").addEventListener("click", toggleTheme);
systemDark.addEventListener("change", () => applyTheme());
$("#menuButton").addEventListener("click", () => setDrawer(true));
$("#scrim").addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setDrawer(false); });
document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
$("#reviewStatus").addEventListener("change", openReview);
$("#detailBack").addEventListener("click", openReview);
$("#approveClaim").addEventListener("click", () => reviewClaim("approve"));
$("#rejectClaim").addEventListener("click", () => reviewClaim("reject"));
$("#withdrawFromDetail").addEventListener("click", (event) => currentClaim && withdrawClaim(currentClaim, event.currentTarget, openReview));
$("#claimParent").addEventListener("change", fillChildOptions);
$("#claimChild").addEventListener("change", showOtherFields);
$("#claimFiles").addEventListener("change", showSelectedFiles);
$("#claimCancel").addEventListener("click", () => navigate("overview"));
$("#claimForm").addEventListener("submit", submitClaim);

glyphField = startGlyphField($("#glyphField"));
renderMotes($("#landingMotes"));
applyTheme();
