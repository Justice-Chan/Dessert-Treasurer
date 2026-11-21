// The monthly report: the app's 月結報表, built from the shared ledger and saved as a PDF in the
// ledger folder at noon on the 1st for the month just ended.

const REPORT_STATUS = { pending: "待審核", approved: "已核准", paid: "已付款", rejected: "退回" };

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function reportMoney(amount) {
  const value = Math.round(Number(amount) || 0);
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

// The same figures and tables as renderMonthlyReport in the app (frontend/js/features/reports.js).
// The PDF converter knows little CSS, so the layout uses tables only, and every cell names its font
// size: tables do not inherit one from the body there.
function monthlyReportHtml(ledger, month, generatedAt) {
  const end = monthEnd(month);
  const [year, number] = month.split("-").map(Number);
  const active = activeEntries(ledger);
  const entries = active.filter((entry) => String(entry.date || "").startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const sum = (type) => entries.filter((entry) => entry.type === type).reduce((total, entry) => total + Number(entry.amount), 0);
  const income = sum("income");
  const expense = sum("expense");
  const claims = ledger.claims
    .filter((claim) => String(claim.date || "").startsWith(month) || String(claim.paymentDate || "").startsWith(month))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  const pending = claims.filter((claim) => claim.status === "pending" || claim.status === "approved").reduce((total, claim) => total + Number(claim.amount), 0);
  const accounts = ledger.accounts.filter((account) => accountExistsAt(account, end));
  const accountName = (id) => (ledger.accounts.find((account) => account.id === id) || {}).name || "未指定帳戶";
  const records = new Map(ledger.reconciliations.filter((item) => item.month === month).map((item) => [item.accountId, item]));
  const checks = accounts.map((account) => {
    const record = records.get(account.id);
    const balance = accountBalance(account, active, end);
    return { account, record, balance, stale: Boolean(record) && balance !== Number(record.calculatedBalance) };
  });
  const complete = checks.length > 0 && checks.every((check) => check.record && !check.stale);

  const num = (text) => `<td class="num">${text}</td>`;
  const table = (headers, widths, rows, empty) => `<table class="grid"><tr>${headers.map((header, index) => `<th style="width:${widths[index]}%">${header}</th>`).join("")}</tr>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}">${empty}</td></tr>`}</table>`;
  const accountRows = checks.map(({ account, record, balance, stale }) => `<tr><td>${escapeHtml(account.name)}</td>${num(reportMoney(balance))}${num(record ? reportMoney(record.actualBalance) : "-")}${num(record ? reportMoney(Number(record.actualBalance) - balance) : "-")}<td>${!record ? "尚未對帳" : stale ? "帳務已變更，需重新核對" : "已核對"}${record && record.note ? `<br><span class="note">${escapeHtml(record.note)}</span>` : ""}</td></tr>`);
  const entryRows = entries.map((entry) => `<tr><td>${escapeHtml(entry.date)}</td><td>${entry.type === "income" ? "收入" : "支出"}</td><td>${escapeHtml(entry.title || entry.child || "未命名紀錄")}</td><td>${escapeHtml(entry.parent || "-")} / ${escapeHtml(entry.child || "-")}</td><td>${escapeHtml(accountName(entry.accountId))}</td>${num(`${entry.type === "income" ? "+" : "-"}${reportMoney(entry.amount)}`)}</tr>`);
  const claimRows = claims.map((claim) => `<tr><td>${escapeHtml(claim.date)}</td><td>${escapeHtml(claim.person)}</td><td>${escapeHtml(claim.title || claim.child || "未填用途")}</td><td>${REPORT_STATUS[claim.status] || ""}</td><td>${escapeHtml(claim.paymentDate || "-")}</td>${num(reportMoney(claim.amount))}</tr>`);
  const box = (label, amount) => `<td class="box"><span>${label}</span><br><strong>${reportMoney(amount)}</strong></td>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body, table, th, td { color: #20211f; font-family: "Noto Sans TC", sans-serif; font-size: 13px; line-height: 1.5; }
    h1 { margin: 0; font-size: 26px; }
    h2 { margin: 22px 0 8px; font-size: 18px; }
    p { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; }
    .head td { vertical-align: top; padding: 0 0 14px; border-bottom: 2px solid #2f4f3e; }
    .meta, .meta p { color: #686a64; font-size: 14px; text-align: right; }
    .head h1 { font-size: 26px; }
    .month { font-size: 17px; }
    .summary { margin-top: 16px; border-collapse: separate; border-spacing: 8px 0; }
    .box { width: 25%; padding: 10px; border: 1px solid #dedbd2; }
    .box span { color: #686a64; font-size: 13px; }
    .box strong { font-size: 18px; }
    .grid { margin-top: 8px; table-layout: fixed; }
    .grid th, .grid td { padding: 7px 6px; border: 1px solid #dedbd2; text-align: left; vertical-align: top; font-size: 13px; }
    .grid th { background: #f6f4ee; font-weight: 700; }
    .grid td.num { text-align: right; white-space: nowrap; }
    .note { color: #686a64; font-size: 13px; }
  </style></head><body>
    <table class="head"><tr>
      <td><h1>甜點社總務月結報表</h1><p class="month">${year} 年 ${number} 月</p></td>
      <td class="meta"><p>${complete ? "月結已核對" : "月結尚未完整核對"}</p><p>產生時間：${escapeHtml(generatedAt)}</p></td>
    </tr></table>
    <table class="summary"><tr>${box("本月已入帳收入", income)}${box("本月已入帳支出", expense)}${box("本月收支差額", income - expense)}${box("待付款報銷", pending)}</tr></table>
    <p class="note">已入帳支出包含已付款報銷；待付款報銷尚未扣除帳面。</p>
    <h2>帳戶月末與對帳</h2>${table(["帳戶", "系統帳面", "實際餘額", "差額", "對帳狀態與備註"], [18, 18, 18, 16, 30], accountRows, "本月沒有可列入的帳戶。")}
    <h2>已入帳收支明細</h2>${table(["日期", "類型", "項目", "分類", "帳戶", "金額"], [12, 9, 19, 25, 17, 18], entryRows, "本月沒有已入帳收支。")}
    <h2>報銷紀錄</h2>${table(["申請日期", "申請人", "用途", "狀態", "付款日期", "金額"], [14, 14, 25, 14, 15, 18], claimRows, "本月沒有報銷申請或付款紀錄。")}
  </body></html>`;
}

// Saves 甜點社N月月結報表.pdf for the month before today (or the given YYYY-MM) in the ledger folder.
// Running it again for the same month replaces the report it made before. A same-named file from an
// earlier year, or one someone else saved there (Drive lets only its owner trash it), is kept.
function monthlyReport(month) {
  const doc = readLedger();
  if (!doc) throw new Error("雲端帳本還沒建立，請先打開記帳 app 同步一次。");
  mergeSheetClaims(doc.ledger);
  const target = typeof month === "string" && /^\d{4}-\d{2}$/.test(month) ? month : previousMonth();
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, TIME_ZONE, "H"));
  const generatedAt = `${Utilities.formatDate(now, TIME_ZONE, "yyyy年M月d日")} ${hour < 12 ? "上午" : "下午"}${hour % 12 || 12}:${Utilities.formatDate(now, TIME_ZONE, "mm")}`;
  const html = monthlyReportHtml(doc.ledger, target, generatedAt);
  const name = `甜點社${Number(target.slice(5))}月月結報表.pdf`;
  const folder = ledgerFolder();
  const closed = new Date(`${monthEnd(target)}T23:59:59+08:00`);
  const same = folder.getFilesByName(name);
  while (same.hasNext()) {
    const file = same.next();
    if (file.getDateCreated() <= closed) continue;
    try {
      file.setTrashed(true);
    } catch (error) {
      console.log(`保留別人存的「${name}」，另存一份新的。`);
    }
  }
  const pdf = Utilities.newBlob(html, "text/html", name).getAs("application/pdf").setName(name);
  folder.createFile(pdf);
  console.log(`已產生 ${name}`);
}

function previousMonth() {
  const [year, number] = currentMonth().split("-").map(Number);
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}

// Run once from the Apps Script editor. Schedules the report for noon on the 1st, replacing any
// earlier schedule, and makes last month's report now so its look can be checked.
function setupMonthlyReport() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "monthlyReport")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("monthlyReport").timeBased().onMonthDay(1).atHour(12).inTimezone(TIME_ZONE).create();
  monthlyReport();
  console.log("已排程：每月 1 日中午 12 點產生上個月的月結報表，並已先產生一份。");
}
