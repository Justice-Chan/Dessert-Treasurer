const config = window.DASHBOARD_CONFIG || {};
const roleText = { treasurer: "總務", officer: "幹部" };
const $ = (selector) => document.querySelector(selector);

// Kept in memory only, so closing the tab signs the user out.
let idToken = "";

function showMessage(text, isError = false) {
  $("#message").textContent = text;
  $("#message").classList.toggle("error", isError);
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

function showSignedOut() {
  idToken = "";
  $("#signedIn").hidden = true;
  $("#signedOut").hidden = false;
}

async function handleCredential(response) {
  idToken = response.credential;
  showMessage("登入中…");
  try {
    const user = await callBackend("whoami");
    $("#userEmail").textContent = user.email;
    $("#userName").textContent = user.name || "未填寫";
    $("#userRole").textContent = roleText[user.role] || user.role;
    $("#signedOut").hidden = true;
    $("#signedIn").hidden = false;
    showMessage("");
  } catch (error) {
    showSignedOut();
    showMessage(error.message, true);
  }
}

async function writeTest() {
  const button = $("#writeTest");
  button.disabled = true;
  showMessage("寫入中…");
  try {
    await callBackend("writeTest");
    showMessage("已寫入一列測試資料。");
  } catch (error) {
    if (error.code === "unauthenticated" || error.code === "unauthorized") showSignedOut();
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function signOut() {
  window.google?.accounts.id.disableAutoSelect();
  showSignedOut();
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

$("#writeTest").addEventListener("click", writeTest);
$("#signOut").addEventListener("click", signOut);
