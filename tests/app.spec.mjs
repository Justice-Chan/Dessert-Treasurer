import { expect, test } from "@playwright/test";

// Keep records after each default account's opening date as time moves forward.
const date = "2099-09-20";

async function openSection(page, name) {
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

async function addEntry(page, { type = "income", parent, child, amount, note = "" }) {
  await page.locator("#newEntry").click();
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
  await expect(page.locator("#ledgerRows")).toContainText("+$500");
  // The list moved to the record's month.
  await expect(page.locator("#ledgerMonthLabel")).toHaveText("2099 年 9 月");
  await expect(page.locator("#entryDialog")).toBeHidden();

  await page.locator("[data-select-entry]").click();
  await expect(page.locator("#entryDialog")).toBeVisible();
  await expect(page.locator("#entryFormTitle")).toHaveText("編輯收支");
  await expect(page.locator("#entryAmount")).toHaveValue("500");
});

test("ledger search shows the net total of matching records", async ({ page }) => {
  await openSection(page, "記帳");
  await addEntry(page, { parent: "社費與會費", child: "單次活動費", amount: 300, note: "杜拜巧克力餅收入" });
  await addEntry(page, { type: "expense", parent: "食材與耗材", child: "糖與巧克力", amount: 100, note: "杜拜巧克力餅材料" });
  await expect(page.locator('[data-ledger-type="all"]')).toContainText("+$200");

  const total = page.locator("#ledgerSearchTotal");
  await expect(total).toBeHidden();
  await page.locator("#ledgerSearch").fill("杜拜巧克力餅");
  await expect(total).toHaveText("+$200");
  await expect(total).toHaveClass(/income/);

  await page.locator('[data-ledger-type="expense"]').click();
  await expect(total).toHaveText("-$100");
  await expect(total).toHaveClass(/expense/);
  await page.locator("#ledgerSearch").fill("");
  await expect(total).toBeHidden();

  // A date range replaces the month, in the list and in the figures.
  await page.locator('[data-ledger-type="all"]').click();
  await page.locator("#ledgerDateFrom").fill("2099-09-01");
  await page.locator("#ledgerDateTo").fill("2099-09-30");
  await expect(page.locator("#ledgerMonthSwitch")).toBeHidden();
  await expect(page.locator("#ledgerRangeLabel")).toHaveText("2099-09-01 – 2099-09-30");
  await expect(page.locator("[data-select-entry]")).toHaveCount(2);
  await page.locator("#ledgerDateTo").fill("2099-09-19");
  await expect(page.locator("#ledgerRows")).toContainText("這段期間沒有收支紀錄");
  await expect(page.locator('[data-ledger-type="all"]')).toContainText("$0");
});

test("approved claim payment creates and can revoke its linked expense", async ({ page }) => {
  await openSection(page, "報銷");
  await page.locator("#newClaim").click();
  await page.locator("#claimDate").fill(date);
  await page.locator("#claimPerson").fill("測試社員");
  await page.locator("#claimParent").selectOption("活動與課程");
  await page.locator("#claimChild").selectOption("場地費");
  await page.locator("#claimAmount").fill("800");
  await page.locator("#claimStatus").selectOption("approved");
  await page.locator("#claimSubmit").click();

  await page.getByRole("button", { name: "付款", exact: true }).click();
  await expect(page.locator("#claimPaymentDialog")).toBeVisible();
  await page.locator("#claimPaymentDate").fill(date);
  await page.getByRole("button", { name: "確認付款" }).click();
  await expect(page.locator("#claimRows")).toContainText("已付款");
  await openSection(page, "記帳");
  await page.locator("#ledgerSearch").fill("測試社員");
  await expect(page.locator("#ledgerRows")).toContainText("報銷付款 · 測試社員");

  await openSection(page, "報銷");
  await page.locator("#claimRows [data-row-menu]").click();
  await page.getByRole("menuitem", { name: "撤銷" }).click();
  await expect(page.locator("#appActionConfirmDialog")).toBeVisible();
  await page.getByRole("button", { name: "確認撤銷" }).click();
  await expect(page.locator("#claimRows")).toContainText("已核准");

  await openSection(page, "記帳");
  await expect(page.locator("#ledgerRows")).not.toContainText("報銷付款");
});

test("claim search shows the total of matching reimbursements", async ({ page }) => {
  await openSection(page, "報銷");
  await page.evaluate(() => {
    state.claims = [
      { id: "claim-match-1", date: "2099-09-20", person: "甲", title: "杜拜巧克力餅材料", parent: "活動與課程", child: "材料費", amount: 300, status: "pending", paymentDate: "", paymentAccountId: "", receipt: "", attachments: [], note: "" },
      { id: "claim-match-2", date: "2099-09-20", person: "乙", title: "杜拜巧克力餅包材", parent: "活動與課程", child: "材料費", amount: 200, status: "approved", paymentDate: "", paymentAccountId: "", receipt: "", attachments: [], note: "" },
      { id: "claim-other", date: "2099-09-20", person: "丙", title: "其他採購", parent: "行政庶務", child: "文具", amount: 100, status: "pending", paymentDate: "", paymentAccountId: "", receipt: "", attachments: [], note: "" }
    ];
    renderClaims();
  });

  const total = page.locator("#claimSearchTotal");
  await expect(total).toBeHidden();
  await page.locator("#claimSearch").fill("杜拜巧克力餅");
  await expect(total).toHaveText("-$500");
  await expect(total).toHaveClass(/expense/);

  await expect(page.locator('[data-claim-status="pending"]')).toContainText("2 筆");
  await page.locator('[data-claim-status="approved"]').click();
  await expect(total).toHaveText("-$200");
  await page.locator("#claimSearch").fill("");
  await expect(total).toBeHidden();
});

test("trash restores selected records only after confirmation", async ({ page }) => {
  await openSection(page, "記帳");
  await addEntry(page, { parent: "社費與會費", child: "補繳", amount: 300 });
  await page.locator("#ledgerRows").getByRole("button", { name: "刪除" }).click();
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
  // Each month in the history prints its own report.
  await page.evaluate(() => {
    state.reconciliations.push({ id: "2026-09:cash", month: "2026-09", accountId: "cash", calculatedBalance: 0, actualBalance: 0, difference: 0, note: "", updatedAt: "" });
    saveState();
  });
  await openSection(page, "對帳");
  await page.locator('[data-print-month="2026-09"]').click();
  await expect.poll(() => page.evaluate(() => window.__monthlyReportText || "")).toContain("2026 年 9 月");
  await expect.poll(() => page.evaluate(() => window.__monthlyReportText || "")).toContain("帳戶月末與對帳");
  await expect(page.locator("#monthlyReport .report-table")).toHaveCount(3);
  await expect(page.locator("#monthlyReport .report-table thead th")).toHaveCount(17);
  await expect.poll(() => page.locator("#monthlyReport .report-table tbody tr").count()).toBeGreaterThanOrEqual(3);
  await page.emulateMedia({ media: "print" });
  const printLayout = await page.locator("#monthlyReport .report-table").evaluateAll((tables) => tables.map((table) => ({
    headerPosition: getComputedStyle(table.querySelector("th")).position,
    minWidth: getComputedStyle(table).minWidth,
    fitsReport: table.getBoundingClientRect().right <= document.querySelector("#monthlyReport").getBoundingClientRect().right,
    rowBreak: getComputedStyle(table.querySelector("tr")).breakInside,
    bottomBorder: getComputedStyle(table.querySelector("tbody tr:last-child td")).borderBottomWidth
  })));
  for (const layout of printLayout) {
    expect(layout).toEqual({ headerPosition: "static", minWidth: "0px", fitsReport: true, rowBreak: "avoid", bottomBorder: "1px" });
  }
});

test("long monthly reports keep every row and heading inside explicit pages", async ({ page }) => {
  const layout = await page.evaluate(async () => {
    state.accounts = [{ id: "test-cash", name: "測試現金", type: "cash", openingDate: "2099-01-01", openingBalance: 0, active: true }];
    state.entries = Array.from({ length: 130 }, (_, index) => ({
      id: `test-entry-${String(index).padStart(3, "0")}`, date: "2099-09-20", type: "income",
      title: `測試收款 ${index} ${"較長的用途說明".repeat(index % 4)}`, parent: "社費與會費", child: "單次活動費",
      amount: 100, accountId: "test-cash"
    }));
    state.claims = [];
    renderMonthlyReport("2099-09");
    document.body.classList.add("print-monthly-report");
    await document.fonts.ready;
    paginateMonthlyReport();
    const pages = Array.from(document.querySelectorAll(".report-page"));
    return {
      pageCount: pages.length,
      entryCount: document.querySelectorAll(".entry-report-table tbody tr").length,
      entryHeadingCount: Array.from(document.querySelectorAll(".report-section")).filter((section) => section.querySelector(".entry-report-table") && section.querySelector("h2")).length,
      entryHeadersRepeated: Array.from(document.querySelectorAll(".entry-report-table")).every((table) => table.querySelector("thead th")),
      rowsContained: pages.every((sheet) => Array.from(sheet.querySelectorAll("tr")).every((row) => row.getBoundingClientRect().bottom <= sheet.getBoundingClientRect().bottom)),
      headingsWithData: pages.every((sheet) => Array.from(sheet.querySelectorAll(".report-section")).every((section) => !section.querySelector("table") || section.querySelectorAll("tbody tr").length > 0))
    };
  });
  expect(layout.pageCount).toBeGreaterThan(1);
  expect(layout.entryCount).toBe(130);
  expect(layout.entryHeadingCount).toBe(1);
  expect(layout.entryHeadersRepeated).toBe(true);
  expect(layout.rowsContained).toBe(true);
  expect(layout.headingsWithData).toBe(true);
});

test("import synonym settings require name and student ID headers", async ({ page }) => {
  await openSection(page, "設定");
  await page.locator("#synonymPersonName").fill("");
  await page.locator("#synonymPersonStudentId").fill("");
  await page.getByRole("button", { name: "儲存設定" }).click();
  await expect(page.locator("#toast")).toContainText("姓名與學號各至少保留一個");
});

test("older import synonym saves migrate to added and removed aliases", async ({ page }) => {
  await openSection(page, "設定");
  const result = await page.evaluate(() => {
    const legacy = normalizeState({ importSynonyms: { mode: "legacy", people: { name: ["社員姓名"] }, activity: {} } }).importSynonyms;
    const editable = normalizeState({ importSynonyms: { mode: "editable", people: { name: ["姓名", "社員姓名"], studentId: ["學號"] }, activity: { payment: [] } } }).importSynonyms;
    state.importSynonyms = editable;
    const headers = importHeaders("activity");
    return {
      legacyName: legacy.people.name,
      editableName: editable.people.name,
      editableEmail: editable.people.email,
      names: headers.name,
      studentIds: headers.studentId,
      payment: headers.payment,
      transferLastFive: headers.transferLastFive
    };
  });

  expect(result.legacyName).toEqual({ added: ["社員姓名"], removed: [] });
  expect(result.editableName.added).toEqual(["社員姓名"]);
  expect(result.editableName.removed).toContain("名字");
  expect(result.editableName.removed).not.toContain("姓名");
  expect(result.editableEmail).toEqual({ added: [], removed: [] });
  expect(result.names).toEqual(["姓名", "社員姓名"]);
  expect(result.studentIds).toEqual(["學號"]);
  expect(result.payment).toEqual([]);
  expect(result.transferLastFive).toContain("匯款後五碼");
});

test("empty form links can be connected before the first response", async ({ page }) => {
  await openSection(page, "人員");
  const previews = await page.evaluate(() => {
    const activity = { id: "empty-form-activity", attendance: [] };
    const people = personImportPreview([], { allowEmptyLink: true });
    const activityImport = activityImportPreview([], activity, { allowEmptyLink: true });
    return {
      peopleAwaiting: people.awaitingResponses,
      peopleCandidates: people.candidates.length,
      activityAwaiting: activityImport.awaitingResponses,
      activityAttendance: activityImport.attendance.length
    };
  });

  expect(previews).toEqual({
    peopleAwaiting: true,
    peopleCandidates: 0,
    activityAwaiting: true,
    activityAttendance: 0
  });
});

test("imports can match registered people by either name or student ID", async ({ page }) => {
  await openSection(page, "人員");
  const result = await page.evaluate(() => {
    state.people = [{ id: "person-1", name: "王小明", studentId: "B12345678", department: "甜點系", email: "" }];
    const nameOnly = personImportPreview([["姓名"], ["王小明"]]);
    const idOnlyActivity = activityImportPreview(
      [["學號", "繳費狀態"], ["b12345678", "已繳"]],
      { id: "activity-1", attendance: [] }
    );
    return {
      nameOnlyInvalid: nameOnly.invalid,
      nameOnlyDuplicates: nameOnly.duplicates,
      attendance: idOnlyActivity.attendance
    };
  });

  expect(result.nameOnlyInvalid).toBe(0);
  expect(result.nameOnlyDuplicates).toBe(1);
  expect(result.attendance).toEqual([{ personId: "person-1", candidateStudentId: "", status: "attending", paid: true, paidAt: "" }]);
});

test("imports match names that include department and grade labels", async ({ page }) => {
  await openSection(page, "人員");
  const result = await page.evaluate(() => {
    state.people = [
      { id: "person-1", name: "黃小明", studentId: "B11111111", department: "", email: "" },
      { id: "person-2", name: "李大華", studentId: "B22222222", department: "化學系", email: "" },
      { id: "person-3", name: "陳小美", studentId: "B33333333", department: "醫技系", email: "" }
    ];
    const people = personImportPreview([["系級姓名", "學號"], ["外文119 黃小明", ""], ["資訊116 張小強", "B44444444"]]);
    const activity = activityImportPreview(
      [["姓名", "繳費狀態"], ["外文119 黃小明", "已繳"], ["化學119李大華", "已繳"], ["陳小美 / 醫技118", "未繳"], ["林小雨", "已繳"]],
      { id: "activity-1", attendance: [] }
    );
    return {
      parsed: ["外文119 黃小明", "化學119李大華", "陳小美 / 醫技118", "吳小天", "資工二 黃小明", "外文系碩一 李大華", "丁一 陳小美"].map(parseImportedName),
      supplements: people.supplements,
      candidates: people.candidates,
      attendance: activity.attendance.map((record) => [record.personId, record.paid]),
      invalidRows: activity.invalidRows
    };
  });

  expect(result.parsed).toEqual([
    { name: "黃小明", department: "外文119" },
    { name: "李大華", department: "化學119" },
    { name: "陳小美", department: "醫技118" },
    { name: "吳小天", department: "" },
    { name: "黃小明", department: "資工二" },
    { name: "李大華", department: "外文系碩一" },
    { name: "丁一 陳小美", department: "" }
  ]);
  expect(result.supplements).toEqual([{ id: "person-1", department: "外文119", email: "" }]);
  expect(result.candidates).toEqual([{ name: "張小強", studentId: "B44444444", department: "資訊116", email: "" }]);
  expect(result.attendance).toEqual([["person-1", true], ["person-2", true], ["person-3", false]]);
  expect(result.invalidRows).toBe(1);
});

test("imports name unmatched rows and refuse to guess between people who share a name", async ({ page }) => {
  await openSection(page, "人員");
  const result = await page.evaluate(() => {
    state.people = [
      { id: "twin-1", name: "王小明", studentId: "B11111111", department: "外文系", email: "" },
      { id: "twin-2", name: "王小明", studentId: "B22222222", department: "化學119", email: "" },
      { id: "solo", name: "李大華", studentId: "B33333333", department: "", email: "" }
    ];
    const activity = { id: "activity-1", name: "Test", date: "2099-09-20", fee: 100, note: "", attendance: [] };
    state.activities = [activity];
    const preview = activityImportPreview([
      ["姓名", "學號", "繳費狀態"],
      ["外文119 王小明", "", "已繳"],
      ["王小明", "B22222222", "已繳"],
      ["王小明", "", "已繳"],
      ["李大華", "", "未繳"],
      ["林小雨", "", "已繳"]
    ], activity);
    showActivityImportPreview(preview);
    const people = personImportPreview([["姓名", "系別"], ["王小明", "化學系"], ["王小明", "資工系"]]);
    return {
      matched: preview.attendance.map((record) => record.personId),
      invalidRows: preview.invalidRows,
      unmatched: preview.unmatched,
      listed: [...document.querySelectorAll("#activityImportUnmatched li")].map((item) => item.textContent),
      peopleInvalid: people.invalid,
      peopleUnmatched: people.unmatched.map((row) => row.reason)
    };
  });

  expect(result.matched).toEqual(["twin-1", "twin-2", "solo"]);
  expect(result.invalidRows).toBe(2);
  expect(result.unmatched).toEqual([
    { label: "王小明", reason: "有多位同名人員，請加上學號或系別" },
    { label: "林小雨", reason: "尚未登記，且缺少學號" }
  ]);
  expect(result.listed).toEqual(["王小明 — 有多位同名人員，請加上學號或系別", "林小雨 — 尚未登記，且缺少學號"]);
  expect(result.peopleInvalid).toBe(1);
  expect(result.peopleUnmatched).toEqual(["有多位同名人員，請加上學號或系別"]);
});

test("activity payments hide times, keep account suffixes and sort unpaid people first", async ({ page }, testInfo) => {
  await openSection(page, "人員");
  await page.evaluate(() => {
    state.people = ["late", "early", "unknown", "unpaid"].map((id) => ({ id, name: id, studentId: id.toUpperCase(), department: "", email: "" }));
    state.activities = [{
      id: "payment-activity", name: "Payment ordering", date: "2099-09-20", fee: 100, note: "",
      rosterOrder: ["unpaid", "late", "unknown", "early"],
      attendance: [
        { personId: "late", status: "attending", paid: true, paidAt: "09-20 15:00", transferLastFive: "01234" },
        { personId: "early", status: "attending", paid: true, paidAt: "09-20 09:30", transferLastFive: "00001" },
        { personId: "unknown", status: "attending", paid: true, paidAt: "", transferLastFive: "" },
        { personId: "unpaid", status: "attending", paid: false, paidAt: "", transferLastFive: "" }
      ]
    }];
    saveState();
    selectActivity(state.activities[0], "attending");
  });
  const rows = page.locator("#activityPersonRows [data-roster-person-id]");
  const order = () => rows.evaluateAll((items) => items.map((item) => item.dataset.rosterPersonId));
  expect(await order()).toEqual(["unpaid", "early", "late", "unknown"]);
  await expect(page.locator("[data-payment-time]")).toHaveCount(0);
  await expect(page.locator(".activity-people-table thead")).toContainText("匯款後五碼");
  const suffix = page.locator('[data-transfer-last-five][data-person-id="unpaid"]');
  // Five digits mark the person paid as well.
  await suffix.fill("00123");
  await expect(page.locator('[data-toggle-payment][data-person-id="unpaid"]')).toHaveText("已繳");
  expect(await page.evaluate(() => activityRecord(state.activities[0], "unpaid").paidAt)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  await suffix.fill("12");
  await suffix.press("Tab");
  await expect(page.locator("#toast")).toContainText("完整的五位數字");
  await expect(suffix).toHaveValue("00123");
  // The tag toggles paid and unpaid.
  await page.locator('[data-toggle-payment][data-person-id="unpaid"]').click();
  await expect(page.locator('[data-toggle-payment][data-person-id="unpaid"]')).toHaveText("未繳");
  expect(await page.evaluate(() => activityRecord(state.activities[0], "unpaid").paidAt)).toBe("");
  await page.reload();
  await openSection(page, "人員");
  await page.locator('[data-select-activity="payment-activity"]').click();
  await expect(suffix).toHaveValue("00123");
  await expect(page.locator('[data-transfer-last-five][data-person-id="late"]')).toHaveValue("01234");
  expect(await page.evaluate(() => activityRecord(state.activities[0], "early").paidAt)).toBe("09-20 09:30");
  await page.locator("#activityRoster").screenshot({ path: testInfo.outputPath("activity-payments-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#activityRoster").screenshot({ path: testInfo.outputPath("activity-payments-mobile.png") });
});

test("re-renders leave unchanged tables in place", async ({ page }) => {
  await openSection(page, "人員");
  const result = await page.evaluate(() => {
    state.people = ["a", "b"].map((id) => ({ id, name: id, studentId: id.toUpperCase(), department: "", email: "" }));
    state.activities = [{
      id: "activity-1", name: "Stable rows", date: "2099-09-20", fee: 100, note: "", rosterOrder: [],
      attendance: [
        { personId: "a", status: "attending", paid: true, paidAt: "09-20 10:00", transferLastFive: "" },
        { personId: "b", status: "attending", paid: false, paidAt: "", transferLastFive: "" }
      ]
    }];
    saveState();
    selectActivity(state.activities[0], "attending");
    const firstRow = (id) => document.querySelector(`#${id} tr`);
    const before = { people: firstRow("personRows"), activities: firstRow("activityRows") };
    before.people.focus();
    // A suffix for someone already paid changes nothing the lists show.
    setActivityTransferLastFive("activity-1", "a", "12345");
    const afterSuffix = {
      peopleKept: firstRow("personRows") === before.people,
      activitiesKept: firstRow("activityRows") === before.activities,
      focusKept: document.activeElement === before.people,
      rosterValue: document.querySelector('[data-transfer-last-five][data-person-id="a"]').value
    };
    setActivityPayment("activity-1", "b", true);
    return {
      afterSuffix,
      peopleRebuilt: firstRow("personRows") !== before.people,
      paid: document.querySelector("#activityRows .paid-progress span").textContent
    };
  });

  expect(result.afterSuffix).toEqual({ peopleKept: true, activitiesKept: true, focusKept: true, rosterValue: "12345" });
  expect(result.peopleRebuilt).toBe(true);
  expect(result.paid).toBe("2 / 2 已繳");
});

test("people and activities are added in dialogs, and the roster takes batch changes", async ({ page }) => {
  await openSection(page, "人員");
  await expect(page.locator("#personForm")).toBeHidden();
  // 新增人員 is a menu: add by hand, or import a sheet.
  await page.locator("#people .heading-actions .action-menu-trigger").click();
  await expect(page.locator("#syncPersonLink")).toBeHidden();
  await page.locator("#newPerson").click();
  await page.locator("#personName").fill("王小明");
  await page.locator("#personStudentId").fill("h54136249");
  await page.locator("#personDepartment").fill("工資117");
  await page.locator("#personSubmit").click();
  await expect(page.locator("#personDialog")).toBeHidden();
  await expect(page.locator("#personCount")).toHaveText("1 人");
  await expect(page.locator("#personRows")).toContainText("H54136249");
  await page.evaluate(() => {
    state.people.push(...["b", "c"].map((id) => ({ id, name: id, studentId: id.toUpperCase(), department: "", email: "" })));
    saveState();
  });
  await page.locator("#personSearch").fill("王");
  await expect(page.locator("#personCount")).toHaveText("1 / 3");
  await page.locator("#personSearch").fill("");

  await page.locator("#newActivity").click();
  await page.locator("#activityName").fill("布朗尼實作課");
  await page.locator("#activityFee").fill("200");
  await page.locator("#activitySubmit").click();
  await expect(page.locator("#activityDialog")).toBeHidden();
  // A new activity opens on the people not yet attending.
  await expect(page.locator("#activityRoster")).toBeVisible();
  await expect(page.locator('[data-roster-filter="not_attending"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#rosterSelectAll").check();
  await expect(page.locator("#rosterBatchCount")).toHaveText("3");
  await page.locator("#rosterBatch .action-menu-trigger").click();
  await page.locator("#rosterBatchAttend").click();
  await page.locator('[data-roster-filter="attending"]').click();
  await expect(page.locator('[data-roster-filter="unpaid"]')).toHaveText("未繳 3 人 · $600");
  await expect(page.locator('[data-roster-filter="unpaid"]')).toHaveClass(/pending/);
  await page.locator('[data-roster-select="b"]').check();
  await page.locator('[data-roster-select="c"]').check();
  await page.locator("#rosterBatch .action-menu-trigger").click();
  await page.locator("#rosterBatchPaid").click();
  await expect(page.locator('[data-roster-filter="unpaid"]')).toHaveText("未繳 1 人 · $200");
  await expect(page.locator("#activityRows")).toContainText("2 / 3 已繳");
  // Turning attending off hides that person's payment controls.
  await page.locator('[data-roster-filter="unpaid"]').click();
  const row = page.locator("#activityPersonRows [data-roster-person-id]").first();
  // The row leaves the unpaid list once switched off, so a plain click rather than uncheck().
  await row.locator("[data-toggle-attendance]").click();
  await expect(page.locator('[data-roster-filter="not_attending"]')).toHaveText("未參加 1");
  await page.locator('[data-roster-filter="not_attending"]').click();
  await expect(page.locator("#activityPersonRows [data-toggle-payment]")).toHaveCount(0);
  await expect(page.locator('[data-roster-filter="unpaid"]')).not.toHaveClass(/pending/);

  await page.locator("#editActivity").click();
  await expect(page.locator("#activityFee")).toHaveValue("200");
  await page.locator("#activityDelete").click();
  await page.locator("#confirmAppAction").click();
  await expect(page.locator("#activityRoster")).toBeHidden();
  await expect(page.locator("#activityCount")).toHaveText("0 個");
});

test("activity suffix aliases migrate, import and survive incomplete spreadsheets", async ({ page }) => {
  await openSection(page, "設定");
  const field = page.locator("#synonymActivityTransferLastFive");
  await expect(field).toHaveValue(/匯款後五碼/);
  await field.fill("付款辨識碼");
  await page.getByRole("button", { name: "儲存設定" }).click();
  await page.reload();
  await openSection(page, "設定");
  await expect(field).toHaveValue("付款辨識碼");
  const result = await page.evaluate(() => {
    state.people = [{ id: "person-1", name: "Test", studentId: "A001", department: "", email: "" }];
    const activity = { id: "activity-1", name: "Test", date: "2099-09-20", fee: 100, note: "", attendance: [] };
    state.activities = [activity];
    applyActivityImport(activity, activityImportPreview([
      ["學號", "繳費狀態", "繳費日期", "付款辨識碼"], ["a001", "已繳", "2099-09-20 12:45", "00123"]
    ], activity));
    const original = { ...activity.attendance[0] };
    applyActivityImport(activity, activityImportPreview([["學號", "繳費狀態"], ["a001", "已繳"]], activity));
    const preserved = { ...activity.attendance[0] };
    applyActivityImport(activity, activityImportPreview([["學號", "繳費狀態", "付款辨識碼"], ["a001", "已繳", 12]], activity));
    const numericSuffix = activity.attendance[0].transferLastFive;
    applyActivityImport(activity, activityImportPreview([["學號", "繳費狀態", "付款辨識碼"], ["a001", "已繳", "123456"]], activity));
    const invalidSuffixPreserved = activity.attendance[0].transferLastFive;
    applyActivityImport(activity, activityImportPreview([["學號", "繳費狀態", "付款辨識碼"], ["a001", "已繳", 0]], activity));
    const zeroSuffix = activity.attendance[0].transferLastFive;
    const backup = JSON.parse(JSON.stringify(state));
    validateImportedState(backup);
    const restoredSuffix = normalizeState(backup).activities[0].attendance[0].transferLastFive;
    backup.activities[0].attendance[0].transferLastFive = "123456";
    let invalidBackupRejected = false;
    try { validateImportedState(backup); } catch { invalidBackupRejected = true; }
    const oldSynonyms = JSON.parse(JSON.stringify(state.importSynonyms));
    delete oldSynonyms.activity.transferLastFive;
    state = normalizeState({ ...state, importSynonyms: oldSynonyms });
    const migratedAliases = importHeaders("activity").transferLastFive;
    state.importSynonyms.activity.transferLastFive = { added: [], removed: [...importHeaderDefaults.activity.transferLastFive] };
    return { original, preserved, numericSuffix, invalidSuffixPreserved, zeroSuffix, restoredSuffix, invalidBackupRejected, migratedAliases, clearedAliases: importHeaders("activity").transferLastFive };
  });
  expect(result.original.transferLastFive).toBe("00123");
  expect(result.original.paidAt).toBe("09-20 12:45");
  expect(result.preserved).toEqual(result.original);
  expect(result.numericSuffix).toBe("00012");
  expect(result.invalidSuffixPreserved).toBe("00012");
  expect(result.zeroSuffix).toBe("00000");
  expect(result.restoredSuffix).toBe("00000");
  expect(result.invalidBackupRejected).toBe(true);
  expect(result.migratedAliases).toContain("匯款後五碼");
  expect(result.clearedAliases).toEqual([]);
});

// The backend merges the claims sheet in and keeps the version; these stand-ins answer as it would.
const backend = "https://script.google.com/macros/s/test-deployment/exec";
const webClaim = (n, person) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, source: "web", date, person, title: "雜支", parent: "行政庶務", child: "雜支",
  amount: 60, status: "approved", paymentDate: "", paymentAccountId: "", receipt: "https://drive.google.com/file/d/a/view", attachments: [], note: ""
});

async function openWithSync(page, ledgerSync) {
  await page.evaluate(({ url, ledgerSync }) => localStorage.setItem("dessertTreasurer.v1", JSON.stringify({ webSync: { url, secret: "s".repeat(32) }, ledgerSync })), { url: backend, ledgerSync });
  await page.reload();
}

test("the first sync uploads the app's books, then takes the cloud copy with web claims", async ({ page }) => {
  const calls = [];
  await page.route(backend, async (route) => {
    const request = JSON.parse(route.request().postData());
    expect(request.secret).toBe("s".repeat(32));
    calls.push(request.payload);
    const data = request.payload.ledger
      ? { version: 1, conflict: false, ledger: { ...request.payload.ledger, claims: [webClaim(1, "網頁幹部")] }, categories: { "行政庶務": ["雜支"], "新分類": ["新副項"] } }
      : { version: 0, conflict: false, ledger: null };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  await openWithSync(page);
  await openSection(page, "報銷");
  await expect(page.locator("#claimRows")).toContainText("網頁幹部");
  expect(calls.map((payload) => [payload.baseVersion, Boolean(payload.ledger)])).toEqual([[0, false], [0, true]]);
  expect(Object.keys(calls[1].ledger)).toEqual(["entries", "claims", "trash", "accounts", "payees", "reconciliations", "lockedMonths"]);
  // Categories come from the backend and survive a reload.
  await expect(page.locator("#claimParent option")).toContainText(["行政庶務", "新分類", "其他"]);
  expect(await page.evaluate(() => state.ledgerSync)).toEqual({ version: 1, dirty: false });
});

test("changes upload record by record, and the web's edits to the same record win", async ({ page }) => {
  let cloud = { version: 3, ledger: { entries: [], claims: [webClaim(2, "雲端")], trash: [], accounts: [], payees: [], reconciliations: [], lockedMonths: [] } };
  const patches = [];
  let calls = 0;
  await page.route(backend, async (route) => {
    calls += 1;
    const { payload } = JSON.parse(route.request().postData());
    let skipped = 0;
    if (payload.patch) {
      patches.push(payload);
      // Stand-in for the backend: records the web changed meanwhile keep the web's version.
      const entries = [...cloud.ledger.entries];
      (payload.patch.records.entries || []).forEach((change) => {
        const index = entries.findIndex((entry) => entry.id === change.id);
        const current = index >= 0 ? entries[index] : null;
        if (JSON.stringify(current) !== JSON.stringify(change.base)) return void (skipped += 1);
        if (index >= 0) entries[index] = change.next;
        else entries.push(change.next);
      });
      cloud = { version: cloud.version + 1, ledger: { ...cloud.ledger, entries } };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { ...cloud, conflict: false, skipped } }) });
  });
  await openWithSync(page, { version: 3, dirty: false });
  await openSection(page, "報銷");
  await expect(page.locator("#claimRows")).toContainText("雲端");
  // The window gaining focus as it opens does not start a second sync.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(calls).toBe(1);
  await expect(page.locator("#ledgerSyncStatus")).toBeHidden();

  await openSection(page, "記帳");
  await addEntry(page, { parent: "社費與會費", child: "補繳", amount: 80 });
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].baseVersion).toBe(3);
  expect(patches[0].patch.records.entries.map((change) => [change.base, change.next.amount])).toEqual([[null, 80]]);
  await expect.poll(() => page.evaluate(() => state.ledgerSync)).toEqual({ version: 4, dirty: false });

  // The web edits that entry and so does this computer: the web's version stays.
  const id = await page.evaluate(() => state.entries[0].id);
  cloud = { version: 6, ledger: { ...cloud.ledger, entries: [{ ...cloud.ledger.entries[0], amount: 95 }] } };
  await page.evaluate((entryId) => {
    state.entries.find((entry) => entry.id === entryId).amount = 70;
    saveState();
  }, id);
  await expect.poll(() => patches.length).toBe(2);
  await expect(page.locator("#toast")).toContainText("有 1 筆紀錄網頁也改過");
  await expect.poll(() => page.evaluate(() => state.entries.map((entry) => entry.amount))).toEqual([95]);
});

test("restoring shows what the file holds and saves the current books first", async ({ page }) => {
  await openSection(page, "記帳");
  await addEntry(page, { parent: "社費與會費", child: "補繳", amount: 80, note: "目前的資料" });
  const backup = { backupVersion: 3, entries: [{ id: "r1", date, type: "income", title: "補繳", parent: "社費與會費", child: "補繳", amount: 500, method: "現金", accountId: "cash", note: "備份裡的資料" }], claims: [], people: [], activities: [], trash: [] };
  await page.locator('[data-section="backup"]').click();
  await expect(page.locator("#pageTitle")).toHaveText("資料管理");
  await page.locator("#importFile").setInputFiles({ name: "甜點社總務完整備份.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator("#appActionConfirmMessage")).toContainText("收支 1 筆、報銷 0 筆");
  await expect(page.locator("#appActionConfirmMessage")).toContainText("還原前會先自動備份目前資料");
  const download = page.waitForEvent("download");
  await page.locator("#confirmAppAction").click();
  // In the browser the current books are saved as a download before they are replaced.
  expect((await download).suggestedFilename()).toMatch(/^甜點社總務完整備份-/);
  await expect(page.locator("#toast")).toContainText("還原前的資料已另存一份");
  expect(await page.evaluate(() => state.entries.map((entry) => entry.note))).toEqual(["備份裡的資料"]);
});

test("month-end reconciliation fills every account at once and locks only when all match", async ({ page }) => {
  await openSection(page, "對帳");
  await expect(page.locator(".account-card")).toHaveCount(2);
  const month = await page.locator("#reconcileMonth").inputValue();
  const rows = page.locator("#reconcileRows [data-reconcile-account]");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("#toggleMonthLock")).toBeDisabled();
  await rows.nth(0).locator("[data-reconcile-actual]").fill("50");
  await expect(rows.nth(0).locator("[data-reconcile-difference]")).toContainText("$50");
  await rows.nth(0).locator("[data-reconcile-actual]").fill("0");
  await expect(rows.nth(0).locator("[data-reconcile-difference]")).toContainText("✓");
  await rows.nth(1).locator("[data-reconcile-actual]").fill("0");
  await page.locator("#saveReconciliation").click();
  await expect(page.locator("#reconciliationRows")).toContainText("帳戶皆相符 ✓");
  await expect(page.locator("#reconciliationRows")).toContainText("已儲存");
  await expect(page.locator("#toggleMonthLock")).toBeEnabled();
  await page.locator("#toggleMonthLock").click();
  await page.locator("#confirmAppAction").click();
  await expect(page.locator("#reconciliationRows")).toContainText("已鎖定");
  expect(await page.evaluate(() => state.lockedMonths)).toEqual([month]);
  await expect(rows.nth(0).locator("[data-reconcile-actual]")).toBeDisabled();

  // Accounts are added in a dialog and shown as cards.
  await page.locator("#newAccount").click();
  await expect(page.locator("#accountDialog")).toBeVisible();
  await page.locator("#accountCancel").click();
  await expect(page.locator("#accountDialog")).toBeHidden();
});

test("a native save describes only the records and values that changed", async ({ page }) => {
  const result = await page.evaluate(() => {
    const before = stateSnapshot({ entries: [{ id: "a", amount: 1 }, { id: "b", amount: 2 }], lockedMonths: [], autoBackup: { folder: "" } });
    const unchanged = stateChanges(before, stateSnapshot({ entries: [{ id: "a", amount: 1 }, { id: "b", amount: 2 }], lockedMonths: [], autoBackup: { folder: "" } }));
    const changes = stateChanges(before, stateSnapshot({
      entries: [{ id: "c", amount: 3 }, { id: "b", amount: 5 }],
      lockedMonths: ["2026-09"],
      exportFolder: "/tmp"
    }));
    return { unchanged, changes };
  });
  expect(result.unchanged).toBeNull();
  expect(result.changes.records).toEqual([
    { collection: "entries", id: "c", payload: '{"id":"c","amount":3}' },
    { collection: "entries", id: "b", payload: '{"id":"b","amount":5}' },
    { collection: "entries", id: "a", payload: null }
  ]);
  expect(result.changes.order).toEqual({ entries: ["c", "b"] });
  // An empty list counts as records; with plain strings in it, it becomes a value.
  expect(result.changes.dropped).toEqual(["lockedMonths"]);
  expect(result.changes.values).toEqual({ lockedMonths: '["2026-09"]', exportFolder: '"/tmp"' });
  expect(result.changes.removedValues).toEqual(["autoBackup"]);
});

test("when the saved data cannot be read, nothing is saved or synced", async ({ page }) => {
  await page.evaluate(() => enterReadOnlyMode());
  await expect(page.locator("#readOnlyBanner")).toBeVisible();
  await expect(page.locator("#syncWebClaims")).toBeDisabled();
  const before = await page.evaluate(() => localStorage.getItem("dessertTreasurer.v1"));
  await openSection(page, "記帳");
  await addEntry(page, { parent: "社費與會費", child: "補繳", amount: 80 });
  await expect(page.locator("#toast")).toContainText("唯讀模式");
  expect(await page.evaluate(() => localStorage.getItem("dessertTreasurer.v1"))).toBe(before);
});

test("categories are shown in Settings", async ({ page }) => {
  await expect(page.locator('[data-section="categories"]')).toHaveCount(0);
  await openSection(page, "設定");
  await expect(page.locator("#expenseCategories")).toContainText("食材與耗材");
  await expect(page.locator("#incomeCategories")).toContainText("社費與會費");
});
