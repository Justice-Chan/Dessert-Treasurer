const config = window.DASHBOARD_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const roleText = { treasurer: "總務", officer: "幹部" };
const statusClass = { "待審核": "pending", "已核准": "approved", "已付款": "paid", "退回": "rejected" };
const views = ["signedOut", "home", "claimForm"];
const imageLongSide = 1600;

// Kept in memory only, so closing the tab signs the user out.
let idToken = "";
let categories = {};
let limits = { files: 5, fileBytes: 5 * 1024 * 1024 };

function show(view) {
  views.forEach((id) => { $(`#${id}`).hidden = id !== view; });
  window.scrollTo(0, 0);
}

function showMessage(text, isError = false) {
  $("#message").textContent = text;
  $("#message").classList.toggle("error", isError);
  // The message sits below a long form, so bring errors into view.
  if (isError) $("#message").scrollIntoView({ block: "nearest" });
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
    limits = user.limits || limits;
    $("#userLabel").textContent = `${user.name || user.email}・${roleText[user.role] || user.role}`;
    fillParentOptions();
    show("home");
    showMessage("");
    await loadHome();
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
  google.accounts.id.renderButton($("#signInButton"), { theme: "outline", size: "large", locale: "zh_TW" });
}

// ---- Home ----

async function loadHome() {
  const [claims, summary] = await Promise.allSettled([callBackend("listMyRequests"), callBackend("getSummary")]);
  if (claims.status === "fulfilled") renderClaims(claims.value);
  if (summary.status === "fulfilled") renderSummary(summary.value.items || []);
  const failure = [claims, summary].find((result) => result.status === "rejected");
  if (failure) reportError(failure.reason);
}

function renderSummary(items) {
  const list = $("#summaryList");
  list.replaceChildren(...items.flatMap((item) => [element("dt", "", item.label), element("dd", "", money.format(item.amount))]));
  $("#summaryEmpty").hidden = items.length > 0;
}

function renderClaims(claims) {
  $("#claimList").replaceChildren(...claims.map((claim) => {
    const item = element("li");
    const top = element("div", "claim-line");
    top.append(element("span", "", `${claim.parent} / ${claim.child}`), element("strong", "", money.format(claim.amount)));
    const bottom = element("div", "claim-line");
    const details = [claim.date, claim.vendor, claim.activity, claim.description].filter(Boolean).join("・");
    bottom.append(element("span", "claim-meta", details), element("span", `pill ${statusClass[claim.status] || ""}`, claim.status));
    item.append(top, bottom);
    if (claim.reviewNote) item.append(element("div", "claim-note", `審核備註：${claim.reviewNote}`));
    return item;
  }));
  $("#claimsEmpty").hidden = claims.length > 0;
}

// ---- New claim ----

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function setOptions(select, values, placeholder) {
  select.replaceChildren(new Option(placeholder, ""), ...values.map((value) => new Option(value, value)));
}

function fillParentOptions() {
  setOptions($("#claimParent"), Object.keys(categories), "請選擇");
  fillChildOptions();
}

function fillChildOptions() {
  setOptions($("#claimChild"), categories[$("#claimParent").value] || [], "請選擇");
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
  if (!$("#claimParent").value || !$("#claimChild").value) return showMessage("請選擇主項目與副項目。", true);
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
      parent: $("#claimParent").value,
      child: $("#claimChild").value,
      activity: $("#claimActivity").value,
      vendor: $("#claimVendor").value,
      description: $("#claimDescription").value,
      attachments: await Promise.all(files.map(prepareAttachment))
    });
    show("home");
    showMessage("報帳已送出，等待總務審核。");
    await loadHome();
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = "送出";
  }
}

$("#signOut").addEventListener("click", signOut);
$("#newClaim").addEventListener("click", openClaimForm);
$("#claimParent").addEventListener("change", fillChildOptions);
$("#claimFiles").addEventListener("change", showSelectedFiles);
$("#claimCancel").addEventListener("click", () => { showMessage(""); show("home"); });
$("#claimForm").addEventListener("submit", submitClaim);
