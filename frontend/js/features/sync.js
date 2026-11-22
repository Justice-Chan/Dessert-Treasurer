// The shared ledger (backend/Ledger.js): entries, claims, accounts and reconciliations live in the
// cloud, where the web's ledger page reads and writes them too; people, activities and settings stay
// on this computer. Each change here is uploaded with the version it was based on, and the reply is
// the cloud copy with the claims sheet merged in. If the web changed the books first, the upload is
// refused and this app takes the cloud copy.
const ledgerKeys = ["entries", "claims", "trash", "accounts", "payees", "reconciliations", "lockedMonths"];
let ledgerSyncRunning = false;
let ledgerSyncAgain = false;
let ledgerSyncFailing = false;
let ledgerSyncedAt = 0;
let ledgerUploadTimer = 0;
// The ledger as last agreed with the cloud, or null when that is unknown (a change was left
// unsent last time). saveState compares against it to tell whether the books changed.
let agreedLedgerJson = null;

const ledgerJson = () => JSON.stringify(Object.fromEntries(ledgerKeys.map((key) => [key, state[key]])));
const webSyncReady = () => Boolean(state.webSync.url && state.webSync.secret);

function renderWebSyncSettings() {
  $("#webSyncUrl").value = state.webSync.url;
  $("#webSyncSecret").value = state.webSync.secret;
  const last = state.webSync.lastSyncedAt ? `上次同步：${new Date(state.webSync.lastSyncedAt).toLocaleString("zh-TW")}` : "尚未同步";
  $("#webSyncStatus").textContent = state.ledgerSync.dirty ? `${last}；有變更尚未上傳` : last;
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
  syncLedger({ quiet: true });
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
    throw new Error("無法連線到雲端，請檢查網路。");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("雲端沒有正確回應，請確認網址。");
  }
  if (!result?.ok) throw new Error(result?.error?.message || "同步失敗。");
  return result.data;
}

// Called from saveState, before the local write: a change to the books is marked for upload.
function noteLedgerChange() {
  if (state.ledgerSync.dirty || ledgerJson() === agreedLedgerJson) return;
  state.ledgerSync = { ...state.ledgerSync, dirty: true };
  if (!webSyncReady()) return;
  clearTimeout(ledgerUploadTimer);
  ledgerUploadTimer = setTimeout(() => syncLedger({ quiet: true }), 800);
}

// Started when the app opens, after each change, when the window comes back into focus and from
// the 同步雲端帳本 button. On start-up (quiet) it stays silent unless something needs attention.
async function syncLedger({ quiet = false } = {}) {
  if (!webSyncReady()) {
    if (!quiet) toast("請先到「設定」填寫雲端同步網址與金鑰。");
    return;
  }
  if (ledgerSyncRunning) {
    ledgerSyncAgain = true;
    return;
  }
  ledgerSyncRunning = true;
  $("#syncWebClaims").disabled = true;
  setLedgerSyncStatus("同步中…");
  let conflict = false;
  try {
    do {
      ledgerSyncAgain = false;
      const sent = ledgerJson();
      const upload = state.ledgerSync.dirty;
      let reply = await callWebSync("syncLedger", { baseVersion: state.ledgerSync.version, ...(upload ? { ledger: JSON.parse(sent) } : {}) });
      // The first sync with an empty cloud uploads this app's books.
      if (!reply.ledger) reply = await callWebSync("syncLedger", { baseVersion: 0, ledger: JSON.parse(sent) });
      conflict ||= reply.conflict;
      if (ledgerJson() !== sent && !reply.conflict) {
        // Changed while the request was out: keep the local books and send them next round.
        state.ledgerSync = { version: reply.version, dirty: true };
        ledgerSyncAgain = true;
        continue;
      }
      // Redraw as soon as the cloud copy arrives, before any further round.
      applyCloudLedger(reply);
      saveState();
    } while (ledgerSyncAgain);
    state.webSync.lastSyncedAt = new Date().toISOString();
    ledgerSyncedAt = Date.now();
    saveState();
    renderWebSyncSettings();
    ledgerSyncFailing = false;
    setLedgerSyncStatus("");
    if (conflict) toast("網頁上的帳本比較新，這台電腦剛才的變更沒有上傳，已改用雲端的帳本。請確認後重新輸入。", "error");
    else if (!quiet) toast("已同步雲端帳本。");
  } catch (error) {
    renderWebSyncSettings();
    if (!quiet || !ledgerSyncFailing) toast(`雲端帳本同步失敗：${error.message || "請稍後再試。"}變更會留在這台電腦，下次同步時上傳。`);
    ledgerSyncFailing = true;
    setLedgerSyncStatus("未同步", error.message);
  } finally {
    ledgerSyncRunning = false;
    $("#syncWebClaims").disabled = false;
  }
}

function applyCloudLedger(reply) {
  state = normalizeState({ ...state, ...Object.fromEntries(ledgerKeys.map((key) => [key, reply.ledger[key]])) });
  state.ledgerSync = { version: reply.version, dirty: false };
  agreedLedgerJson = ledgerJson();
  // The backend owns the expense categories; a change there redraws this app's category lists.
  const fresh = normalizeCategoryTree(reply.categories);
  if (fresh && JSON.stringify(fresh) !== JSON.stringify(state.expenseCategories)) {
    state.expenseCategories = fresh;
    applyExpenseCategories();
    setupCategorySelects();
  }
  refreshAccountSelects();
  loadReconciliationForm();
}

// A small note in the top bar while the books are on their way, and when the last sync failed.
function setLedgerSyncStatus(text, detail = "") {
  $("#ledgerSyncStatus").textContent = text;
  $("#ledgerSyncStatus").title = detail;
  $("#ledgerSyncStatus").hidden = !text;
}

function startLedgerSync() {
  syncLedger({ quiet: true });
  // Coming back to the app picks up what was done on the web meanwhile. The window also gains
  // focus as it opens, while the first sync is still out; that one is not repeated.
  window.addEventListener("focus", () => {
    if (!ledgerSyncRunning && !state.ledgerSync.dirty && Date.now() - ledgerSyncedAt > 30000) syncLedger({ quiet: true });
  });
}
