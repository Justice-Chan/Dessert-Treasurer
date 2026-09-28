import { expect, test } from "@playwright/test";

const date = "2026-09-20";

async function openSection(page, name) {
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

async function addEntry(page, { type = "income", parent, child, amount, note = "" }) {
  await page.locator("#entryDate").fill(date);
  await page.locator("#entryType").selectOption(type);
  await page.locator("#entryParent").selectOption(parent);
  await page.locator("#entryChild").selectOption(child);
  await page.locator("#entryAmount").fill(String(amount));
  await page.locator("#entryNote").fill(note);
  await page.locator("#entrySubmit").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#entryDate")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
});

test("can create and select a ledger record", async ({ page }) => {
  await openSection(page, "記帳");
  await addEntry(page, { parent: "社費與會費", child: "單次活動費", amount: 500, note: "測試收款" });
  await expect(page.locator("#ledgerRows")).toContainText("單次活動費");
  await expect(page.locator("#ledgerRows")).toContainText("$500");

  await page.locator("[data-select-entry]").click();
  await expect(page.locator("#entryFormTitle")).toHaveText("編輯收支");
  await expect(page.locator("#entryAmount")).toHaveValue("500");
});

test("approved claim payment creates and can revoke its linked expense", async ({ page }) => {
  await openSection(page, "報銷");
  await page.locator("#claimDate").fill(date);
  await page.locator("#claimPerson").fill("測試社員");
  await page.locator("#claimParent").selectOption("活動與課程");
  await page.locator("#claimChild").selectOption("場地費");
  await page.locator("#claimAmount").fill("800");
  await page.locator("#claimStatus").selectOption("approved");
  await page.locator("#claimSubmit").click();

  await page.getByRole("button", { name: "付款" }).click();
  await expect(page.locator("#claimPaymentDialog")).toBeVisible();
  await page.locator("#claimPaymentDate").fill(date);
  await page.getByRole("button", { name: "確認付款" }).click();
  await expect(page.locator("#claimRows")).toContainText("已付款");

  await page.getByRole("button", { name: "撤銷" }).click();
  await expect(page.locator("#appActionConfirmDialog")).toBeVisible();
  await page.getByRole("button", { name: "確認撤銷" }).click();
  await expect(page.locator("#claimRows")).toContainText("已核准");

  await openSection(page, "記帳");
  await expect(page.locator("#ledgerRows")).not.toContainText("報銷：場地費");
});

test("trash restores selected records only after confirmation", async ({ page }) => {
  await openSection(page, "記帳");
  await addEntry(page, { parent: "社費與會費", child: "補繳", amount: 300 });
  await page.getByRole("button", { name: "刪除" }).click();
  await page.getByRole("button", { name: "確認刪除" }).click();

  await openSection(page, "垃圾桶");
  await page.locator("[data-select-trash-row]").click();
  await expect(page.locator("#restoreSelectedTrash")).toBeEnabled();
  await page.locator("#restoreSelectedTrash").click();
  await expect(page.locator("#appActionConfirmDialog")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.locator("[data-select-trash-row]")).toHaveCount(1);
  await page.locator("#restoreSelectedTrash").click();
  await page.getByRole("button", { name: "確認還原" }).click();
  await expect(page.locator("#trashRows")).toContainText("垃圾桶目前是空的");
});

test("monthly report uses the selected reconciliation month", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => { window.__monthlyReportText = document.querySelector("#monthlyReport")?.textContent || ""; };
  });
  await page.reload();
  await openSection(page, "對帳");
  await page.locator("#reconcileMonth").fill("2026-09");
  await page.locator("#printMonthlyReport").click();
  await expect.poll(() => page.evaluate(() => window.__monthlyReportText || "")).toContain("2026 年 9 月");
  await expect.poll(() => page.evaluate(() => window.__monthlyReportText || "")).toContain("帳戶月末與對帳");
});

test("activity roster drag order persists after reload", async ({ page }) => {
  await openSection(page, "人員");
  for (const [name, studentId] of [["王小明", "A001"], ["陳小華", "A002"]]) {
    await page.locator("#personName").fill(name);
    await page.locator("#personStudentId").fill(studentId);
    await page.locator("#personDepartment").fill("甜點系");
    await page.locator("#personSubmit").click();
  }

  await page.locator("#activityName").fill("拖曳排序測試");
  await page.locator("#activityDate").fill(date);
  await page.locator("#activityFee").fill("0");
  await page.locator("#activitySubmit").click();

  const rows = page.locator("#activityPersonRows [data-roster-person-id]");
  await expect(rows).toHaveCount(2);
  const first = rows.nth(0);
  const second = rows.nth(1);
  const originalFirst = await first.getAttribute("data-roster-person-id");
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  await page.mouse.move(firstBox.x + 24, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + 24, secondBox.y + secondBox.height - 3, { steps: 6 });
  await page.mouse.up();
  await expect(rows.nth(0)).not.toHaveAttribute("data-roster-person-id", originalFirst);

  await page.reload();
  await openSection(page, "人員");
  await page.locator("[data-select-activity]").filter({ hasText: "拖曳排序測試" }).click();
  const restoredOrder = await page.locator("#activityPersonRows [data-roster-person-id]").evaluateAll((items) => items.map((item) => item.dataset.rosterPersonId));
  expect(restoredOrder[0]).not.toBe(originalFirst);
});

test("import synonym settings require name and student ID headers", async ({ page }) => {
  await openSection(page, "設定");
  await page.locator("#synonymPersonName").fill("");
  await page.locator("#synonymPersonStudentId").fill("");
  await page.getByRole("button", { name: "儲存設定" }).click();
  await expect(page.locator("#toast")).toContainText("姓名與學號各至少保留一個");
});
