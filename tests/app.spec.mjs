import { expect, test } from "@playwright/test";

// Keep records after each default account's opening date as time moves forward.
const date = "2099-09-20";

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

test("ledger search shows the net total of matching records", async ({ page }) => {
  await openSection(page, "記帳");
  await addEntry(page, { parent: "社費與會費", child: "單次活動費", amount: 300, note: "杜拜巧克力餅收入" });
  await page.locator("#entryCancel").click();
  await addEntry(page, { type: "expense", parent: "食材與耗材", child: "糖與巧克力", amount: 100, note: "杜拜巧克力餅材料" });

  const total = page.locator("#ledgerSearchTotal");
  await expect(total).toBeHidden();
  await page.locator("#ledgerSearch").fill("杜拜巧克力餅");
  await expect(total).toHaveText("+$200");
  await expect(total).toHaveClass(/income/);

  await page.locator("#ledgerType").selectOption("expense");
  await expect(total).toHaveText("-$100");
  await expect(total).toHaveClass(/expense/);
  await page.locator("#ledgerSearch").fill("");
  await expect(total).toBeHidden();
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

  await page.locator("#claimStatusFilter").selectOption("approved");
  await expect(total).toHaveText("-$200");
  await page.locator("#claimSearch").fill("");
  await expect(total).toBeHidden();
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

test("activity roster drag order persists after reload", async ({ page }) => {
  await openSection(page, "人員");
  const people = [["王小明", "A001"], ["陳小華", "A002"]];
  for (const [index, [name, studentId]] of people.entries()) {
    await page.locator("#personName").fill(name);
    await page.locator("#personStudentId").fill(studentId);
    await page.locator("#personDepartment").fill("甜點系");
    await page.locator("#personSubmit").click();
    if (index < people.length - 1) await page.locator("#personCancel").click();
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
  await suffix.fill("00123");
  await suffix.press("Tab");
  await expect(suffix).toHaveValue("00123");
  await suffix.fill("12");
  await suffix.press("Tab");
  await expect(page.locator("#toast")).toContainText("完整的五位數字");
  await expect(suffix).toHaveValue("00123");
  await page.locator('[data-set-payment="paid"][data-person-id="unpaid"]').click();
  const firstPaymentTime = await page.evaluate(() => activityRecord(state.activities[0], "unpaid").paidAt);
  expect(firstPaymentTime).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  await page.locator('[data-set-payment="paid"][data-person-id="unpaid"]').click();
  expect(await page.evaluate(() => activityRecord(state.activities[0], "unpaid").paidAt)).toBe(firstPaymentTime);
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
      attendance: state.people.map((person) => ({ personId: person.id, status: "attending", paid: false, paidAt: "", transferLastFive: "" }))
    }];
    saveState();
    selectActivity(state.activities[0], "attending");
    const firstRow = (id) => document.querySelector(`#${id} tr`);
    const before = { people: firstRow("personRows"), activities: firstRow("activityRows"), roster: firstRow("activityPersonRows") };
    before.people.focus();
    setActivityTransferLastFive("activity-1", "a", "12345");
    const afterSuffix = {
      peopleKept: firstRow("personRows") === before.people,
      activitiesKept: firstRow("activityRows") === before.activities,
      focusKept: document.activeElement === before.people,
      rosterValue: document.querySelector('[data-transfer-last-five][data-person-id="a"]').value
    };
    setActivityPayment("activity-1", "a", true);
    return {
      afterSuffix,
      peopleRebuilt: firstRow("personRows") !== before.people,
      paidCount: document.querySelector("#activityRows .income").textContent
    };
  });

  expect(result.afterSuffix).toEqual({ peopleKept: true, activitiesKept: true, focusKept: true, rosterValue: "12345" });
  expect(result.peopleRebuilt).toBe(true);
  expect(result.paidCount).toBe("1");
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
