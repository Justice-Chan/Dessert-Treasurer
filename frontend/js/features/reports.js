function reportMonthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year} 年 ${monthNumber} 月`;
}

function renderMonthlyReport(month) {
  const monthEnd = monthEndKey(month);
  const entries = state.entries
    .filter((entry) => isActiveEntry(entry) && entry.date?.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const income = entries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const expense = entries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const claims = state.claims
    .filter((claim) => claim.date?.startsWith(month) || claim.paymentDate?.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const pendingClaims = claims.filter((claim) => claim.status === "pending" || claim.status === "approved").reduce((sum, claim) => sum + Number(claim.amount), 0);
  const accounts = state.accounts.filter((account) => accountExistsAt(account, monthEnd));
  const reconciliations = new Map(state.reconciliations.filter((item) => item.month === month).map((item) => [item.accountId, item]));
  const reconciliationComplete = accounts.length > 0 && accounts.every((account) => {
    const record = reconciliations.get(account.id);
    return record && !currentReconciliationValues(record).stale;
  });
  const generatedAt = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const reportTable = (headers, widths, rows, className) => `<table class="report-table ${className}"><colgroup>${widths.map((width) => `<col style="width:${width}%">`).join("")}</colgroup><thead><tr>${headers.map((header) => `<th scope="col">${header}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  const reportTableRow = (cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
  const reportEmptyRow = (message, columnCount) => `<tr><td colspan="${columnCount}">${message}</td></tr>`;
  const entryRows = entries.length ? entries.map((entry) => reportTableRow([
    escapeHtml(entry.date), entry.type === "income" ? "收入" : "支出", escapeHtml(entry.title || entry.child || "未命名紀錄"),
    `${escapeHtml(entry.parent || "-")} / ${escapeHtml(entry.child || "-")}`, escapeHtml(accountName(entry.accountId)),
    `<span class="num">${entry.type === "income" ? "+" : "-"}${fmt.format(Number(entry.amount))}</span>`
  ])).join("") : reportEmptyRow("本月沒有已入帳收支。", 6);
  const claimRows = claims.length ? claims.map((claim) => reportTableRow([
    escapeHtml(claim.date), escapeHtml(claim.person), escapeHtml(claim.title || claim.child || "未填用途"),
    escapeHtml(statusText[claim.status]), escapeHtml(claim.paymentDate || "-"), `<span class="num">${fmt.format(Number(claim.amount))}</span>`
  ])).join("") : reportEmptyRow("本月沒有報銷申請或付款紀錄。", 6);
  const accountRows = accounts.length ? accounts.map((account) => {
    const record = reconciliations.get(account.id);
    const current = record ? currentReconciliationValues(record) : null;
    const reconciliationStatus = !record ? "尚未對帳" : current.stale ? "帳務已變更，需重新核對" : "已核對";
    return reportTableRow([escapeHtml(account.name), `<span class="num">${fmt.format(accountBalance(account.id, monthEnd))}</span>`, `<span class="num">${record ? fmt.format(Number(record.actualBalance)) : "-"}</span>`, `<span class="num">${record ? fmt.format(current.difference) : "-"}</span>`, `${escapeHtml(reconciliationStatus)}${record?.note ? `<br><span class="report-note">${escapeHtml(record.note)}</span>` : ""}`]);
  }).join("") : reportEmptyRow("本月沒有可列入的帳戶。", 5);

  $("#monthlyReport").innerHTML = `
    <header class="monthly-report-header">
      <div><h1>甜點社總務月結報表</h1><p>${escapeHtml(reportMonthLabel(month))}</p></div>
      <div class="monthly-report-meta"><p>${reconciliationComplete ? "月結已核對" : "月結尚未完整核對"}</p><p>產生時間：${escapeHtml(generatedAt)}</p></div>
    </header>
    <section class="report-section"><div class="monthly-report-summary">
      <div><span>本月已入帳收入</span><strong>${fmt.format(income)}</strong></div>
      <div><span>本月已入帳支出</span><strong>${fmt.format(expense)}</strong></div>
      <div><span>本月收支差額</span><strong>${fmt.format(income - expense)}</strong></div>
      <div><span>待付款報銷</span><strong>${fmt.format(pendingClaims)}</strong></div>
    </div><p class="report-note">已入帳支出包含已付款報銷；待付款報銷尚未扣除帳面。</p></section>
    <section class="report-section"><h2>帳戶月末與對帳</h2>${reportTable(["帳戶", "系統帳面", "實際餘額", "差額", "對帳狀態與備註"], [18, 18, 18, 16, 30], accountRows, "account-report-table")}</section>
    <section class="report-section"><h2>已入帳收支明細</h2>${reportTable(["日期", "類型", "項目", "分類", "帳戶", "金額"], [12, 9, 19, 25, 17, 18], entryRows, "entry-report-table")}</section>
    <section class="report-section"><h2>報銷紀錄</h2>${reportTable(["申請日期", "申請人", "用途", "狀態", "付款日期", "金額"], [14, 14, 25, 14, 15, 18], claimRows, "claim-report-table")}</section>
  `;
}

function paginateMonthlyReport() {
  const report = $("#monthlyReport");
  const source = Array.from(report.children);
  report.replaceChildren();
  let page;
  const nextPage = () => {
    page = document.createElement("div");
    page.className = "report-page";
    report.appendChild(page);
  };
  // Measure at the same physical width and font size used for printing.
  const fits = () => {
    const bottom = page.lastElementChild?.getBoundingClientRect().bottom || 0;
    return bottom <= page.getBoundingClientRect().bottom - 2;
  };
  nextPage();
  for (const block of source) {
    const originalTable = block.querySelector(".report-table");
    if (!originalTable) {
      page.appendChild(block);
      if (!fits()) {
        block.remove();
        if (page.children.length) nextPage();
        page.appendChild(block);
        if (!fits()) throw new Error("報表內容超過單頁可列印範圍。");
      }
      continue;
    }
    const rows = Array.from(originalTable.tBodies[0].rows);
    let section;
    let body;
    const startTable = (continued = false) => {
      section = block.cloneNode(true);
      if (continued) section.querySelector("h2")?.remove();
      body = section.querySelector("tbody");
      body.replaceChildren();
      page.appendChild(section);
    };
    startTable();
    for (const row of rows) {
      body.appendChild(row);
      if (fits()) continue;
      row.remove();
      const continued = body.children.length > 0;
      if (!body.children.length) section.remove();
      if (page.children.length) nextPage();
      startTable(continued);
      body.appendChild(row);
      if (!fits()) throw new Error("報表有一筆資料超過單頁高度，請縮短用途或備註後再列印。");
    }
  }
}

async function printMonthlyReport() {
  const month = $("#reconcileMonth").value;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) return toast("請先選擇要列印的月份。");
  renderMonthlyReport(month);
  document.body.classList.add("print-monthly-report");
  monthlyReportPrintActive = true;
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    paginateMonthlyReport();
  } catch (error) {
    finishMonthlyReportPrint();
    return toast(error.message, "error");
  }
  if (tauriStorageEnabled) {
    try {
      await nativeStorageCall("printMonthlyReport");
      return;
    } catch {
      // The browser fallback keeps web development usable when no native print bridge exists.
    }
  }
  window.print();
}

function finishMonthlyReportPrint() {
  if (!monthlyReportPrintActive) return;
  monthlyReportPrintActive = false;
  document.body.classList.remove("print-monthly-report");
}

