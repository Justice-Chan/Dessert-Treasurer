// Tests for the web dashboard (web/), served at /dashboard/ with a stand-in for the Apps Script
// backend. Sign-in is skipped by starting with a stored token, as a reload in the same tab does.
import { expect, test } from "@playwright/test";

const pad = (number) => String(number).padStart(2, "0");
const now = new Date();
const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const today = `${month}-${pad(now.getDate())}`;
const monthEnd = `${month}-${pad(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`;

const treasurer = { email: "t@example.com", role: "treasurer", position: "總務", name: "總務" };
const officer = { email: "o@example.com", role: "officer", position: "活動", name: "幹部" };
const expense = { "食材與耗材": ["乳品", "粉類"], "行政庶務": ["雜支"] };
const income = { "社費與會費": ["補繳"] };

const claim = (id, status, applicantEmail, extra = {}) => ({
  id, status, applicantEmail, applicantName: applicantEmail.split("@")[0], applicantPosition: "活動", date: `${month}-01`,
  amount: 380, parent: "食材與耗材", child: "粉類", activity: "社課", vendor: "", description: "", attachmentCount: 0,
  createdAt: `${month}-01T00:00:00Z`, editable: "full", month, canWithdraw: status === "待審核" || status === "退回", reviewNote: "", ...extra
});

// Answers the dashboard's calls from memory, as backend/*.js would, and records each call.
function mockBackend(user) {
  const backend = {
    user,
    calls: [],
    claims: [claim("c1", "已核准", "o@example.com"), claim("c2", "待審核", "t@example.com", { amount: 120, child: "乳品" }), claim("c3", "待審核", "o@example.com", { amount: 60 })],
    ledger: {
      version: 1,
      entries: [
        { id: "e1", date: `${month}-01`, type: "income", parent: "社費與會費", child: "補繳", amount: 300, accountId: "cash", note: "林同學", claimId: "" },
        { id: "e2", date: `${month}-01`, type: "expense", parent: "行政庶務", child: "雜支", amount: 50, accountId: "cash", note: "膠帶", claimId: "" }
      ],
      accounts: [
        { id: "cash", name: "現金", type: "cash", openingDate: "2026-01-01", openingBalance: 1000, deletedAt: "" },
        { id: "bank", name: "社團帳戶", type: "bank", openingDate: "2026-01-01", openingBalance: 5000, deletedAt: "" }
      ],
      payments: [],
      months: { [month]: { balance: 6250, accounts: [{ name: "現金", amount: 1250 }, { name: "社團帳戶", amount: 5000 }], income: 300, expense: 50 } },
      lockedUntil: "",
      categories: { income, expense }
    },
    handle(action, payload) {
      const ledger = backend.ledger;
      switch (action) {
        case "whoami": return { ...backend.user, categories: expense, limits: { files: 5, fileBytes: 5242880, category: 30 } };
        case "getSummary": return { items: [], syncedAt: "" };
        case "getLedger": return ledger;
        case "listActivities": return [{ id: "a1", name: "社課", label: "社課" }];
        case "listMyRequests": return backend.claims.filter((item) => item.applicantEmail === backend.user.email);
        case "listAllRequests": return backend.claims.filter((item) => !payload.status || item.status === payload.status);
        case "saveEntry": {
          const entry = { ...payload.entry, id: payload.entry.id || "e-new", claimId: "" };
          ledger.entries = [...ledger.entries.filter((item) => item.id !== entry.id), entry];
          return ledger;
        }
        case "trashEntry":
          ledger.entries = ledger.entries.filter((item) => item.id !== payload.id);
          return ledger;
        case "payClaim":
          backend.claims.find((item) => item.id === payload.id).status = "已付款";
          ledger.payments.push({ id: payload.id, date: payload.date, accountId: payload.accountId });
          return ledger;
        default: throw new Error(`not in the stand-in: ${action}`);
      }
    }
  };
  return backend;
}

async function openDashboard(page, user, view = "overview", setup = () => {}) {
  const backend = mockBackend(user);
  setup(backend);
  await page.route("https://accounts.google.com/**", (route) => route.fulfill({
    contentType: "text/javascript",
    body: "window.google = { accounts: { id: { initialize() {}, renderButton() {}, prompt() {}, disableAutoSelect() {} } } };"
  }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route("https://script.google.com/**", async (route) => {
    const { action, payload } = JSON.parse(route.request().postData());
    backend.calls.push([action, payload]);
    let body;
    try {
      body = { ok: true, data: backend.handle(action, payload) };
    } catch (error) {
      body = { ok: false, error: { code: "invalid", message: error.message } };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  await page.addInitScript(({ token, view, user }) => {
    sessionStorage.setItem("dashboard-id-token", token);
    sessionStorage.setItem("dashboard-view", view);
    sessionStorage.setItem("dashboard-user", JSON.stringify(user));
  }, { token: `x.${payload}.y`, view, user });
  await page.goto("/dashboard/");
  return backend;
}

const drawerItems = (page) => page.locator("#drawer li:not([hidden]) button").evaluateAll((buttons) => buttons.map((button) => button.firstChild.textContent.trim()));

test("the treasurer's drawer has the ledger and no My claims; an officer's has the reverse", async ({ page, browser }) => {
  await openDashboard(page, treasurer);
  await expect(page.locator("#overview")).toBeVisible();
  expect(await drawerItems(page)).toEqual(["總覽", "記帳", "新增報帳", "審核報帳"]);
  const other = await browser.newPage();
  await openDashboard(other, officer);
  await expect(other.locator("#overview")).toBeVisible();
  expect(await drawerItems(other)).toEqual(["總覽", "我的申請", "新增報帳"]);
  await other.close();
});

test("the ledger page shows the backend's figures, groups by day and filters", async ({ page }) => {
  await openDashboard(page, treasurer, "ledger");
  await expect(page.locator("#ledgerBalance")).toHaveText("$6,250");
  await expect(page.locator("#ledgerAccounts")).toHaveText("現金 $1,250 · 社團帳戶 $5,000");
  await expect(page.locator("#ledgerNet")).toHaveText("+$250");
  await expect(page.locator(".ledger-day")).toHaveCount(1);
  await expect(page.locator(".ledger-day")).toContainText("+$250");
  await expect(page.locator("#ledgerCount")).toHaveText("2 筆");
  await page.locator('[data-ledger-filter="expense"]').click();
  await expect(page.locator("#ledgerCount")).toHaveText("1 筆");
  await expect(page.locator("#ledgerList")).toContainText("雜支");
  await expect(page.locator("#ledgerList")).not.toContainText("補繳");
  // No month after this one, and none before the first the backend sent.
  await expect(page.locator("#ledgerNext")).toBeDisabled();
  await expect(page.locator("#ledgerPrev")).toBeDisabled();
});

test("adding and deleting an entry goes through the backend", async ({ page }) => {
  const backend = await openDashboard(page, treasurer, "ledger");
  await expect(page.locator("#ledgerBalance")).toHaveText("$6,250");
  await page.locator("#newEntry").click();
  await expect(page.locator("#entryFormTitle")).toHaveText("新增收支");
  await expect(page.locator("#entryDelete")).toBeHidden();
  await page.locator("#entryAmount").fill("80");
  await page.locator("#entryAccount").selectOption("bank");
  await page.locator("#entryNote").fill("海報");
  await page.locator("#entrySubmit").click();
  await expect(page.locator("#message")).toHaveText("已新增這筆紀錄。");
  const saved = backend.calls.find(([action]) => action === "saveEntry")[1].entry;
  expect(saved).toMatchObject({ id: "", type: "expense", date: today, parent: "食材與耗材", child: "乳品", amount: 80, accountId: "bank", note: "海報" });

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#ledgerList button", { hasText: "海報" }).click();
  await expect(page.locator("#entryFormTitle")).toHaveText("編輯收支");
  await page.locator("#entryDelete").click();
  await expect(page.locator("#message")).toHaveText("已刪除這筆紀錄。");
  expect(backend.calls.find(([action]) => action === "trashEntry")[1]).toEqual({ id: "e-new" });
  await expect(page.locator("#ledgerList")).not.toContainText("海報");
});

test("entries in a locked month cannot be opened", async ({ page }) => {
  await openDashboard(page, treasurer, "ledger", (backend) => { backend.ledger.lockedUntil = monthEnd; });
  await expect(page.locator("#ledgerLocked")).toBeVisible();
  await page.locator("#ledgerList button", { hasText: "膠帶" }).click();
  await expect(page.locator("#message")).toContainText("已鎖定");
  await expect(page.locator("#entryForm")).toBeHidden();
});

test("paying a claim asks for a date and an account", async ({ page }) => {
  const backend = await openDashboard(page, treasurer, "review");
  await page.locator("#reviewStatus").selectOption("已核准");
  await page.locator("#reviewList button").first().click();
  await expect(page.locator("#detail")).toBeVisible();
  // For an approved claim, paying is the first choice, so its fields show at once.
  await expect(page.locator("#reviewNextStatus")).toHaveValue("已付款");
  await expect(page.locator("#payFields")).toBeVisible();
  await page.locator("#reviewNextStatus").selectOption("退回");
  await expect(page.locator("#payFields")).toBeHidden();
  await page.locator("#reviewNextStatus").selectOption("已付款");
  await expect(page.locator("#applyStatus")).toHaveText("記錄付款");
  // Claims are usually paid from the club's bank account.
  await expect(page.locator("#payAccount")).toHaveValue("bank");
  await page.locator("#applyStatus").click();
  await expect(page.locator("#message")).toHaveText("已記錄付款，帳本已扣款。");
  expect(backend.calls.find(([action]) => action === "payClaim")[1]).toEqual({ id: "c1", date: today, accountId: "bank", note: "" });
});

test("the treasurer edits their own claim from its detail page and returns there", async ({ page }) => {
  await openDashboard(page, treasurer, "review");
  await expect(page.locator("#reviewList")).toContainText("本人");
  await page.locator("#reviewList button", { hasText: "本人" }).click();
  await expect(page.locator("#detailEdit")).toBeVisible();
  await page.locator("#detailEdit button").click();
  await expect(page.locator("#claimFormTitle")).toHaveText("修改報帳");
  await expect(page.locator("#claimAmount")).toHaveValue("120");
  await page.locator("#claimCancel").click();
  await expect(page.locator("#detail")).toBeVisible();
  // Someone else's claim has no edit button.
  await page.locator("#detailBack").click();
  await page.locator("#reviewList button", { hasNotText: "本人" }).first().click();
  await expect(page.locator("#detailEdit")).toBeHidden();
});

test("an officer's claim opens for editing, where a pending one can be withdrawn", async ({ page }) => {
  const backend = await openDashboard(page, officer, "myClaims");
  await expect(page.locator("#claimList button")).toHaveCount(2);
  await page.locator("#claimList button", { hasText: "已核准" }).click();
  await expect(page.locator("#claimFormTitle")).toHaveText("修改報帳");
  await expect(page.locator("#claimWithdraw")).toBeHidden();
  await page.locator("#claimCancel").click();
  await page.locator("#claimList button", { hasText: "待審核" }).click();
  await expect(page.locator("#claimWithdraw")).toBeVisible();
  backend.handle = ((handle) => (action, payload) => (action === "withdrawRequest" ? { id: payload.id } : handle(action, payload)))(backend.handle);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#claimWithdraw").click();
  await expect(page.locator("#message")).toHaveText("已撤銷這筆申請。");
  expect(backend.calls.find(([action]) => action === "withdrawRequest")[1]).toEqual({ id: "c3" });
  await expect(page.locator("#myClaims")).toBeVisible();
});
