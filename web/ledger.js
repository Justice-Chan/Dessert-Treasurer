// The treasurer's ledger page: one month of income and expense from the shared cloud ledger
// (backend/Ledger.js), its balances, and the form that adds or edits an entry. Claim payments are
// recorded from a claim's review page; the desktop app reads and writes the same ledger.

// The backend's ledger view, or null until it is first loaded.
let ledger = null;
let ledgerMonth = localToday().slice(0, 7);
let editingEntry = null;

async function loadLedger() {
  ledger = await callBackend("getLedger");
  return ledger;
}

// Shows what was loaded last at once, then the fresh copy.
async function openLedger() {
  show("ledger");
  if (ledger) renderLedger();
  else showMessage("載入中…", false, true);
  try {
    await loadLedger();
    renderLedger();
    showMessage("");
  } catch (error) {
    reportError(error);
  }
}

function monthEndOf(month) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

// The same rules as the desktop app: an account counts from its opening date until it was deleted.
function accountExistsAt(account, end) {
  const deleted = account.deletedAt ? account.deletedAt.slice(0, 10) : "";
  return (account.openingDate || "0001-01-01") <= end && (!deleted || end < deleted);
}

function accountBalanceAt(account, end) {
  const opening = account.openingDate || "0001-01-01";
  if (end < opening) return 0;
  return account.openingBalance + ledger.entries
    .filter((entry) => entry.accountId === account.id && entry.date >= opening && entry.date <= end)
    .reduce((sum, entry) => sum + (entry.type === "income" ? entry.amount : -entry.amount), 0);
}

// A locked month freezes every balance up to its end, so nothing dated before then may change.
function isLockedDate(date) {
  return ledger.lockedMonths.some((month) => date <= monthEndOf(month));
}

function accountName(id) {
  return ledger.accounts.find((account) => account.id === id)?.name || "未指定帳戶";
}

function renderLedger() {
  const end = monthEndOf(ledgerMonth);
  const [year, number] = ledgerMonth.split("-").map(Number);
  $("#ledgerMonth").textContent = `${year} 年 ${number} 月`;
  $("#ledgerNext").disabled = ledgerMonth >= localToday().slice(0, 7);
  $("#ledgerBalanceLabel").textContent = `${number} 月底帳面餘額`;
  const balances = ledger.accounts.filter((account) => accountExistsAt(account, end))
    .map((account) => ({ name: account.name, amount: accountBalanceAt(account, end) }));
  $("#ledgerBalance").textContent = money.format(balances.reduce((sum, item) => sum + item.amount, 0));
  $("#ledgerAccounts").textContent = balances.map((item) => `${item.name} ${money.format(item.amount)}`).join(" · ");

  const entries = ledger.entries.filter((entry) => entry.date.startsWith(ledgerMonth))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = (type) => entries.filter((entry) => entry.type === type).reduce((sum, entry) => sum + entry.amount, 0);
  $("#ledgerIncome").textContent = money.format(total("income"));
  $("#ledgerExpense").textContent = money.format(total("expense"));
  $("#ledgerLocked").hidden = !isLockedDate(end);

  $("#ledgerList").replaceChildren(...entries.map((entry) => {
    const row = element("button", "row review-row");
    row.type = "button";
    const top = element("div", "claim-line");
    const sign = entry.type === "income" ? "+" : "−";
    top.append(element("span", "", `${entry.parent} / ${entry.child}`), element("strong", `claim-amount ${entry.type}`, `${sign}${money.format(entry.amount)}`));
    const meta = element("div", "claim-meta", [entry.claimId ? "報銷付款" : "", entry.date, accountName(entry.accountId), entry.note].filter(Boolean).join(" · "));
    const body = element("div", "review-row-body");
    body.append(top, meta);
    row.append(body, element("span", "chevron", "›"));
    row.addEventListener("click", () => openEntry(entry));
    const item = element("li");
    item.append(row);
    return item;
  }));
  $("#ledgerEmpty").hidden = entries.length > 0;
}

function stepLedgerMonth(direction) {
  ledgerMonth = shiftMonth(ledgerMonth, direction);
  renderLedger();
}

function openEntry(entry) {
  if (entry.claimId) return showMessage("這筆是報銷付款，請到「審核報帳」打開那筆申請修改。");
  if (isLockedDate(entry.date)) return showMessage("這筆紀錄所在的月份已鎖定，要修改請先在記帳 app 的「對帳」解鎖。", true);
  openEntryForm(entry);
}

// ---- Entry form ----

const entryType = () => document.querySelector('input[name="entryType"]:checked').value;
const entryCategories = () => ledger?.categories[entryType()] || {};

function openEntryForm(entry = null) {
  if (!ledger) return navigate("ledger");
  editingEntry = entry;
  $("#entryForm").reset();
  $("#entryFormTitle").textContent = entry ? "編輯收支" : "新增收支";
  $("#entrySubmit").textContent = "儲存";
  $("#entryDelete").hidden = !entry;
  document.querySelector(`input[name="entryType"][value="${entry ? entry.type : "expense"}"]`).checked = true;
  fillParentOptions("entry");
  if (entry) {
    setCategory("entryParent", entry.parent);
    fillChildOptions("entry");
    setCategory("entryChild", entry.child);
    showOtherFields();
    setCategory("entryParent", entry.parent);
    setCategory("entryChild", entry.child);
  }
  // A new entry defaults to today, or to the last day of an earlier month being viewed.
  const today = localToday();
  setDateField("entry", entry ? entry.date : (monthEndOf(ledgerMonth) < today ? monthEndOf(ledgerMonth) : today));
  closeCalendar();
  const accounts = ledger.accounts.filter((account) => !account.deletedAt || account.id === entry?.accountId);
  $("#entryAccount").replaceChildren(...accounts.map((account) => new Option(account.name, account.id)));
  if (entry) {
    $("#entryAccount").value = entry.accountId;
    $("#entryAmount").value = entry.amount;
    $("#entryNote").value = entry.note;
  }
  showMessage("");
  show("entryForm");
}

function changeEntryType() {
  fillParentOptions("entry");
}

function setEntryButtons(disabled) {
  ["#entrySubmit", "#entryDelete", "#entryCancel"].forEach((selector) => { $(selector).disabled = disabled; });
}

async function submitEntry(event) {
  event.preventDefault();
  const amount = Number($("#entryAmount").value);
  const parent = categoryValue("#entryParent", "#entryParentOther");
  const child = categoryValue("#entryChild", "#entryChildOther");
  if (!$("#entryDate").value) return showMessage("請填寫日期。", true);
  if (!Number.isInteger(amount) || amount < 1) return showMessage("金額請填正整數。", true);
  if (!parent || !child || parent === otherCategory || child === otherCategory) return showMessage("請選擇主項目與副項目；選「其他」時請填寫名稱。", true);
  if (!$("#entryAccount").value) return showMessage("請選擇帳戶。", true);
  if (isLockedDate($("#entryDate").value)) return showMessage("這個日期所在的月份已鎖定，要記帳請先在記帳 app 的「對帳」解鎖。", true);
  const entry = {
    id: editingEntry?.id || "",
    type: entryType(),
    date: $("#entryDate").value,
    parent,
    child,
    amount,
    accountId: $("#entryAccount").value,
    note: $("#entryNote").value.trim()
  };
  setEntryButtons(true);
  $("#entrySubmit").textContent = "儲存中…";
  showMessage("儲存中…", false, true);
  try {
    ledger = await callBackend("saveEntry", { entry });
    ledgerMonth = entry.date.slice(0, 7);
    show("ledger");
    renderLedger();
    showMessage(editingEntry ? "已更新這筆紀錄。" : "已新增這筆紀錄。");
  } catch (error) {
    reportError(error);
  } finally {
    setEntryButtons(false);
    $("#entrySubmit").textContent = "儲存";
  }
}

async function deleteEntry() {
  const entry = editingEntry;
  if (!entry) return;
  const summary = `${entry.date}　${entry.parent} / ${entry.child}　${money.format(entry.amount)}`;
  if (!window.confirm(`確定要刪除這筆紀錄嗎？\n${summary}\n刪除後會移到記帳 app 的垃圾桶，30 天內可以還原。`)) return;
  setEntryButtons(true);
  showMessage("刪除中…", false, true);
  try {
    ledger = await callBackend("trashEntry", { id: entry.id });
    show("ledger");
    renderLedger();
    showMessage("已刪除這筆紀錄。");
  } catch (error) {
    reportError(error);
  } finally {
    setEntryButtons(false);
  }
}
