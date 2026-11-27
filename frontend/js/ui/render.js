function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
}

const renderedHtml = new WeakMap();

// Leaves the DOM alone when a re-render produces the same markup, so focus and scroll survive unrelated saves.
function setRenderedHtml(node, html) {
  if (renderedHtml.get(node) === html) {
    // Unchanged markup still has to discard values typed into its inputs, as a rebuild would.
    node.querySelectorAll("input").forEach((input) => {
      if (input.value !== input.defaultValue) input.value = input.defaultValue;
    });
    return;
  }
  renderedHtml.set(node, html);
  node.innerHTML = html;
}

function setSelectOptions(select, options, selected) {
  select.innerHTML = options.map((option) => `<option value="${escapeHtml(option)}"${option === selected ? " selected" : ""}>${escapeHtml(option)}</option>`).join("");
}

function parentOptions(type) {
  return [...Object.keys(categories[type]), "其他"];
}

function childOptions(type, parent) {
  return parent === "其他" ? ["其他"] : [...(categories[type][parent] || []), "其他"];
}

function syncOtherFields(prefix) {
  const parentIsOther = $("#" + prefix + "Parent").value === "其他";
  const childIsOther = $("#" + prefix + "Child").value === "其他";
  const parentInput = $("#" + prefix + "ParentOther");
  const childInput = $("#" + prefix + "ChildOther");
  $("#" + prefix + "ParentOtherField").hidden = !parentIsOther;
  $("#" + prefix + "ChildOtherField").hidden = !childIsOther;
  parentInput.required = parentIsOther;
  childInput.required = childIsOther;
}

function updateChildSelect(type, parentSelect, childSelect, selected) {
  const parent = parentSelect.value;
  const children = childOptions(type, parent);
  const requestedChild = selected ?? childSelect.value;
  const selectedChild = requestedChild && children.includes(requestedChild) ? requestedChild : parent === "其他" ? "" : children[0];
  setSelectOptions(childSelect, children, selectedChild);
  if (parent === "其他") {
    childSelect.insertAdjacentHTML("afterbegin", `<option value="" disabled${selectedChild ? "" : " selected"}>選擇副項目</option>`);
    childSelect.value = selectedChild;
  }
  syncOtherFields(parentSelect.id.startsWith("entry") ? "entry" : "claim");
}

function setCategoryEditor(prefix, type, parent, child) {
  const parentSelect = $("#" + prefix + "Parent");
  const childSelect = $("#" + prefix + "Child");
  const knownParent = Object.prototype.hasOwnProperty.call(categories[type], parent);
  setSelectOptions(parentSelect, parentOptions(type), knownParent ? parent : (parent ? "其他" : parentOptions(type)[0]));
  $("#" + prefix + "ParentOther").value = knownParent ? "" : parent || "";
  const knownChild = knownParent && (categories[type][parent] || []).includes(child);
  updateChildSelect(type, parentSelect, childSelect, knownChild ? child : (child ? "其他" : undefined));
  $("#" + prefix + "ChildOther").value = knownChild ? "" : child || "";
  syncOtherFields(prefix);
}

function readCategory(prefix) {
  const parentSelect = $("#" + prefix + "Parent");
  const childSelect = $("#" + prefix + "Child");
  const parent = parentSelect.value === "其他" ? $("#" + prefix + "ParentOther").value.trim() : parentSelect.value;
  const child = childSelect.value === "其他" ? $("#" + prefix + "ChildOther").value.trim() : childSelect.value;
  return parent && child ? { parent, child } : null;
}

function matchesParentFilter(record, type, filter) {
  if (filter === "all") return true;
  if (filter === "其他") return !Object.prototype.hasOwnProperty.call(categories[type], record.parent);
  return record.parent === filter;
}

function setupCategorySelects() {
  const incomeParents = Object.keys(categories.income);
  const expenseParents = Object.keys(categories.expense);
  setSelectOptions($("#entryParent"), parentOptions("income"));
  updateChildSelect("income", $("#entryParent"), $("#entryChild"));
  setSelectOptions($("#claimParent"), parentOptions("expense"));
  updateChildSelect("expense", $("#claimParent"), $("#claimChild"));
  updateLedgerParentFilter();
  $("#claimParentFilter").innerHTML = `<option value="all">全部主項目</option>` + [...expenseParents, "其他"].map((item) => `<option>${escapeHtml(item)}</option>`).join("");
}

function updateLedgerParentFilter() {
  const type = $("#ledgerType").value;
  const current = $("#ledgerParent").value;
  const parents = type === "all"
    ? [...new Set([...Object.keys(categories.income), ...Object.keys(categories.expense), "其他"])]
    : [...Object.keys(categories[type]), "其他"];
  const allLabel = type === "income"
    ? "全部收入主項目"
    : type === "expense"
      ? "全部支出主項目"
      : "全部主項目";

  $("#ledgerParent").innerHTML = `<option value="all">${allLabel}</option>` + parents
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join("");

  $("#ledgerParent").value = parents.includes(current) ? current : "all";
}

function setAccountOptions(select, selected, includeInactive = false) {
  const accounts = state.accounts.filter((account) =>
    (!account.deletedAt && account.active) || (includeInactive && account.id === selected)
  );
  select.innerHTML = accounts.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === selected ? " selected" : ""}>${escapeHtml(account.name)}</option>`).join("");
  if (!select.value && accounts[0]) select.value = accounts[0].id;
}

function refreshAccountSelects() {
  setAccountOptions($("#entryAccount"), $("#entryAccount").value);
  setAccountOptions($("#claimPaymentAccount"), $("#claimPaymentAccount").value);
}

function amountClass(type) {
  return type === "income" ? "income" : "expense";
}

function signedAmount(entry) {
  return entry.type === "income" ? Number(entry.amount) : -Number(entry.amount);
}

function syncScrollableList(wrapId, visibleRows) {
  const wrap = $(`#${wrapId}`);
  const table = wrap?.querySelector("table");
  const body = table?.tBodies[0];
  if (!wrap || !table || !body) return;

  const rows = [...body.rows].filter((row) => row.cells.length && !row.querySelector("[colspan]"));
  if (!wrap.offsetParent || rows.length <= visibleRows) {
    wrap.classList.remove("list-scroll-active");
    wrap.style.maxHeight = "";
    return;
  }

  // Measure without lifting the height limit so re-renders keep the list's scroll position.
  const scrollTop = wrap.scrollTop;
  const headerHeight = table.tHead?.getBoundingClientRect().height || 0;
  const rowsHeight = rows.slice(0, visibleRows)
    .reduce((total, row) => total + row.getBoundingClientRect().height, 0);
  wrap.style.maxHeight = `${Math.ceil(headerHeight + rowsHeight + 2)}px`;
  wrap.classList.add("list-scroll-active");
  wrap.scrollTop = scrollTop;
}

function syncScrollableLists() {
  syncScrollableList("ledgerList", 8);
  syncScrollableList("claimList", 8);
  syncScrollableList("payeeList", 5);
  syncScrollableList("trashList", 8);
  syncScrollableList("personList", 8);
  syncScrollableList("activityPersonList", 8);
}

function currentSection() {
  return $(".nav-button[aria-current='page']")?.dataset.section || "overview";
}

function renderCurrentSection(section = currentSection()) {
  if (section === "overview") renderOverview();
  else if (section === "ledger") renderLedger();
  else if (section === "reimburse") renderClaims();
  else if (section === "accounts") renderAccounts();
  else if (section === "people") renderPeople();
  else if (section === "trash") renderTrash();
  else if (section === "backup") renderBackupPage();
  else if (section === "settings") {
    renderImportSynonymSettings();
    renderWebSyncSettings();
    renderCategories();
  }
}

function render() {
  renderCurrentSection();
  requestAnimationFrame(syncScrollableLists);
}

function scheduleMemberImportSync() {
  const synchronize = () => setTimeout(() => {
    void syncMemberImportLink({ quiet: true });
    void syncActivityImportLinks({ quiet: true });
  }, 250);
  if ("requestIdleCallback" in window) window.requestIdleCallback(synchronize, { timeout: 1600 });
  else requestAnimationFrame(synchronize);
}

// 總覽: what each account holds now, what is waiting for the treasurer, the month's income and
// expense (counted as 記帳 counts them), and the latest records.
function renderOverview() {
  const accounts = state.accounts.filter((account) => !account.deletedAt);
  const balances = accounts.map((account) => ({ account, balance: accountBalance(account.id, today()) }));
  const tile = (label, amount, extra = "") => `<div class="balance-tile${extra}"><span>${label}</span><strong>${fmt.format(amount)}</strong></div>`;
  setRenderedHtml($("#overviewBalances"), accounts.length
    ? tile("合計", balances.reduce((sum, item) => sum + item.balance, 0), " total") + balances.map(({ account, balance }) => tile(escapeHtml(account.name), balance)).join("")
    : `<div class="empty">尚未新增帳戶。</div>`);

  setRenderedHtml($("#overviewTodos"), overviewTodos().map((todo) => `
    <button type="button" class="figure-row waiting" ${todo.target}>
      <span>${todo.label}<small>${todo.detail}</small></span><strong>${todo.amount === undefined ? "" : fmt.format(todo.amount)} ›</strong>
    </button>`).join("") || `<p class="subtle">目前沒有待辦事項。</p>`);

  const [year, number] = selectedMonth.split("-").map(Number);
  $("#overviewMonthLabel").textContent = `${year} 年 ${number} 月`;
  const entries = state.entries.filter((entry) => isActiveEntry(entry) && entry.date.startsWith(selectedMonth));
  const sum = (items) => items.reduce((total, entry) => total + Number(entry.amount), 0);
  const income = sum(entries.filter((entry) => entry.type === "income"));
  const expenses = entries.filter((entry) => entry.type === "expense");
  const expense = sum(expenses);
  const net = income - expense;
  setRenderedHtml($("#overviewFigures"), `
    <span>收入<strong class="income">${fmt.format(income)}</strong></span>
    <span>支出<strong class="expense">${fmt.format(expense)}</strong></span>
    <span>淨額<strong class="${net > 0 ? "income" : net < 0 ? "expense" : ""}">${net > 0 ? "+" : net < 0 ? "-" : ""}${fmt.format(Math.abs(net))}</strong></span>`);
  const byParent = new Map();
  expenses.forEach((entry) => byParent.set(entry.parent || "未分類", (byParent.get(entry.parent || "未分類") || 0) + Number(entry.amount)));
  const parents = [...byParent].sort((a, b) => b[1] - a[1]);
  setRenderedHtml($("#overviewCategories"), parents.length ? parents.map(([label, value]) => `
    <div class="category-bar">
      <span><span>${escapeHtml(label)}</span><span>${fmt.format(value)} · ${Math.round(value / expense * 100)}%</span></span>
      <span class="bar-track"><i style="width: ${(value / parents[0][1] * 100).toFixed(1)}%"></i></span>
    </div>`).join("") : `<p class="subtle">這個月沒有支出。</p>`);

  const claimPeople = new Map(state.claims.map((claim) => [claim.id, claim.person]));
  const recent = state.entries.filter(isActiveEntry).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  setRenderedHtml($("#recentRows"), recent.length ? recent.map((entry) => `
    <tr class="selectable-row" data-select-entry="${entry.id}" tabindex="0" aria-label="開啟 ${escapeHtml(entry.title || entry.child || "未命名紀錄")}">
      <td title="${escapeHtml(entry.date)}">${dateCell(entry.date)}</td>
      <td>${escapeHtml(entry.parent)} / ${escapeHtml(entry.child)}${entryDetail(entry, claimPeople)}</td>
      <td class="num ${amountClass(entry.type)}">${entry.type === "income" ? "+" : "-"}${fmt.format(Number(entry.amount))}</td>
    </tr>`).join("") : `<tr><td colspan="3"><div class="empty">尚未新增收支紀錄。</div></td></tr>`);
}

// Each to-do opens the page that settles it: claims to review or pay, activity fees still owed
// (the three largest), and last month when it is not yet locked.
function overviewTodos() {
  const todos = [];
  [["pending", "待審核報銷", "筆"], ["approved", "待付款報銷", "筆已核准"]].forEach(([status, label, unit]) => {
    const claims = state.claims.filter((claim) => claim.status === status);
    if (claims.length) todos.push({ target: `data-todo-claims="${status}"`, label, detail: `${claims.length} ${unit}`, amount: claims.reduce((sum, claim) => sum + Number(claim.amount), 0) });
  });
  const owed = state.activities
    .filter((activity) => Number(activity.fee) > 0)
    .map((activity) => ({ activity, count: activityStats(activity).unpaid }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count * b.activity.fee - a.count * a.activity.fee);
  owed.slice(0, 3).forEach(({ activity, count }) => todos.push({
    target: `data-todo-activity="${activity.id}"`, label: `${escapeHtml(activity.name)}未繳`, detail: `${count} 人`, amount: count * Number(activity.fee)
  }));
  if (owed.length > 3) todos.push({ target: `data-go-section="people"`, label: `另有 ${owed.length - 3} 個活動未繳`, detail: "到人員查看" });
  const [year, number] = today().split("-").map(Number);
  const lastMonth = dateKey(new Date(year, number - 2, 1)).slice(0, 7);
  const open = state.accounts.some((account) => account.active && !account.deletedAt && accountExistsAt(account, monthEndKey(lastMonth)));
  if (open && !isMonthLocked(lastMonth)) todos.push({ target: `data-todo-month="${lastMonth}"`, label: `${Number(lastMonth.slice(5))} 月尚未月結`, detail: "對帳後鎖定" });
  return todos;
}

// The small line under a record's category: a claim payment's claimant, or the record's own
// name (when it differs from the subcategory) and note.
function entryDetail(entry, claimPeople) {
  const parts = entry.claimId
    ? ["報銷付款", claimPeople.get(entry.claimId)]
    : [entry.title && entry.title !== entry.child ? entry.title : "", entry.note];
  const line = parts.filter(Boolean).map(escapeHtml).join(" · ");
  return line ? `<br><span class="subtle ledger-detail">${line}</span>` : "";
}

// The period's income, expense and net beside the list. The period is the date range when one is
// set, otherwise the month; without a range a search looks through every month.
function renderLedger() {
  const query = $("#ledgerSearch").value.trim().toLowerCase();
  const type = $("#ledgerType").value;
  const parent = $("#ledgerParent").value;
  const dateFrom = isValidDateValue($("#ledgerDateFrom").value) ? $("#ledgerDateFrom").value : "";
  const dateTo = isValidDateValue($("#ledgerDateTo").value) ? $("#ledgerDateTo").value : "";
  const ranged = Boolean(dateFrom || dateTo);
  const [year, number] = ledgerMonth.split("-").map(Number);
  $("#ledgerMonthLabel").textContent = `${year} 年 ${number} 月`;
  $("#ledgerMonthSwitch").hidden = ranged;
  $("#ledgerRangeLabel").hidden = !ranged;
  $("#ledgerRangeLabel").textContent = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom ? `${dateFrom} 起` : `至 ${dateTo}`;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    setRenderedHtml($("#ledgerFigures"), "");
    $("#ledgerSearchTotal").hidden = true;
    setRenderedHtml($("#ledgerRows"), `<tr><td colspan="5"><div class="empty">起始日期不能晚於結束日期。</div></td></tr>`);
    requestAnimationFrame(() => syncScrollableList("ledgerList", 8));
    return;
  }
  const active = state.entries.filter(isActiveEntry);
  const monthEntries = active.filter(ranged
    ? (entry) => (!dateFrom || entry.date >= dateFrom) && (!dateTo || entry.date <= dateTo)
    : (entry) => entry.date.startsWith(ledgerMonth));
  const sum = (items) => items.reduce((total, entry) => total + Number(entry.amount), 0);
  const income = monthEntries.filter((entry) => entry.type === "income");
  const expense = monthEntries.filter((entry) => entry.type === "expense");
  const net = sum(income) - sum(expense);
  const signed = (value) => `${value > 0 ? "+" : value < 0 ? "-" : ""}${fmt.format(Math.abs(value))}`;
  const figure = (value, label, items, amount, tone) => `
    <button type="button" class="figure-row" data-ledger-type="${value}" aria-pressed="${type === value}">
      <span>${label}<small>${items.length} 筆</small></span><strong class="${tone}">${amount}</strong>
    </button>`;
  setRenderedHtml($("#ledgerFigures"), [
    figure("income", "收入", income, fmt.format(sum(income)), "income"),
    figure("expense", "支出", expense, fmt.format(sum(expense)), "expense"),
    figure("all", "淨額", monthEntries, signed(net), net > 0 ? "income" : net < 0 ? "expense" : "")
  ].join(""));

  const entries = (query && !ranged ? active : monthEntries)
    .filter((entry) => type === "all" || entry.type === type)
    .filter((entry) => parent === "all" || (type === "all"
      ? matchesParentFilter(entry, entry.type, parent)
      : matchesParentFilter(entry, type, parent)))
    .filter((entry) => !query || [entry.title, entry.note, entry.parent, entry.child, entry.method, accountName(entry.accountId)].join(" ").toLowerCase().includes(query))
    .sort((a, b) => b.date.localeCompare(a.date));

  const searchTotal = $("#ledgerSearchTotal");
  if (query) {
    const total = entries.reduce((sum, entry) => sum + signedAmount(entry), 0);
    searchTotal.hidden = false;
    searchTotal.className = `ledger-search-total ${total > 0 ? "income" : total < 0 ? "expense" : ""}`;
    searchTotal.textContent = signed(total);
  } else {
    searchTotal.hidden = true;
    searchTotal.textContent = "";
  }

  const claimPeople = new Map(state.claims.map((claim) => [claim.id, claim.person]));
  const empty = !state.entries.length ? "尚未新增收支紀錄。"
    : !query && !monthEntries.length ? (ranged ? "這段期間沒有收支紀錄。" : `${year} 年 ${number} 月沒有收支紀錄。`)
    : "沒有符合條件的收支紀錄。";
  setRenderedHtml($("#ledgerRows"), entries.length ? entries.map((entry) => `
    <tr class="selectable-row" data-select-entry="${entry.id}" tabindex="0" aria-label="開啟 ${escapeHtml(entry.title || entry.child || "未命名紀錄")}">
      <td title="${escapeHtml(entry.date)}">${dateCell(entry.date)}</td>
      <td>${escapeHtml(entry.parent)} / ${escapeHtml(entry.child)}${entryDetail(entry, claimPeople)}</td>
      <td>${escapeHtml(accountName(entry.accountId))}<br><span class="subtle ledger-detail">${escapeHtml(entry.method || "")}</span></td>
      <td class="num ${amountClass(entry.type)}">${entry.type === "income" ? "+" : "-"}${fmt.format(Number(entry.amount))}</td>
      <td class="ledger-actions-cell">${entry.claimId ? "" : `<button type="button" class="danger" data-delete-entry="${entry.id}">刪除</button>`}</td>
    </tr>
  `).join("") : `<tr><td colspan="5"><div class="empty">${empty}</div></td></tr>`);
  requestAnimationFrame(() => syncScrollableList("ledgerList", 8));
}

function claimActionButtons(claim) {
  const pay = claim.status === "approved" ? `<button class="primary" data-pay-claim="${claim.id}">付款</button>` : "";
  const items = [];
  if (claim.status === "paid" && !affectsLockedBalance(claim.paymentDate)) items.push(`<button type="button" role="menuitem" data-revoke-payment="${claim.id}">撤銷</button>`);
  if (!isClaimLocked(claim)) items.push(`<button type="button" role="menuitem" class="danger" data-delete-claim="${claim.id}">刪除</button>`);
  const menu = items.length ? `<div class="action-menu row-menu" data-action-menu><button type="button" class="action-menu-trigger" data-row-menu aria-haspopup="menu" aria-expanded="false">操作 <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="action-menu-list" role="menu" hidden>${items.join("")}</div></div>` : "";
  return pay || menu ? `<div class="inline-actions nowrap-actions claim-row-actions">${pay}${menu}</div>` : "";
}

// "11/22" within this year, the full date otherwise.
function shortDate(date) {
  if (!isValidDateValue(date)) return date || "";
  return date.slice(0, 4) === today().slice(0, 4) ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` : date;
}

// The date column: "11/22", with the year underneath when it is not this year.
function dateCell(date) {
  if (!isValidDateValue(date) || date.slice(0, 4) === today().slice(0, 4)) return escapeHtml(shortDate(date));
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}<br><span class="subtle date-year">${date.slice(0, 4)}</span>`;
}

// A small second line under the category: the receipt links (or note) and attachments.
function claimReceiptLine(claim) {
  const parts = [claim.receipt ? claimReceiptMarkup(claim.receipt) : "", claim.attachments?.length ? `${claim.attachments.length} 個附件` : ""].filter(Boolean);
  return parts.length ? `<br><span class="subtle claim-receipt">${parts.join(" · ")}</span>` : "";
}

// Every claim counted by status beside the list; the counts double as the status filter.
function renderClaims() {
  const query = $("#claimSearch").value.trim().toLowerCase();
  const status = $("#claimStatusFilter").value;
  const parent = $("#claimParentFilter").value;
  const dateFrom = isValidDateValue($("#claimDateFrom").value) ? $("#claimDateFrom").value : "";
  const dateTo = isValidDateValue($("#claimDateTo").value) ? $("#claimDateTo").value : "";
  setRenderedHtml($("#claimFigures"), ["all", "pending", "approved", "paid", "rejected"].map((value) => {
    const items = value === "all" ? state.claims : state.claims.filter((claim) => claim.status === value);
    const waiting = (value === "pending" || value === "approved") && items.length > 0;
    return `
    <button type="button" class="figure-row${waiting ? " waiting" : ""}" data-claim-status="${value}" aria-pressed="${status === value}">
      <span>${value === "all" ? "全部" : statusText[value]}<small>${items.length} 筆</small></span><strong>${fmt.format(items.reduce((total, claim) => total + Number(claim.amount), 0))}</strong>
    </button>`;
  }).join(""));
  if (dateFrom && dateTo && dateFrom > dateTo) {
    setRenderedHtml($("#claimRows"), `<tr class="claim-empty-row"><td colspan="6"><div class="empty">起始日期不能晚於結束日期。</div></td></tr>`);
    requestAnimationFrame(() => syncScrollableList("claimList", 8));
    return;
  }
  const claims = state.claims
    .filter((claim) => status === "all" || claim.status === status)
    .filter((claim) => matchesParentFilter(claim, "expense", parent))
    .filter((claim) => !dateFrom || claim.date >= dateFrom)
    .filter((claim) => !dateTo || claim.date <= dateTo)
    .filter((claim) => !query || [claim.person, claim.title, claim.receipt, claim.note, claim.parent, claim.child].join(" ").toLowerCase().includes(query))
    .sort((a, b) => b.date.localeCompare(a.date));

  const searchTotal = $("#claimSearchTotal");
  if (query) {
    const total = claims.reduce((sum, claim) => sum + Number(claim.amount), 0);
    searchTotal.hidden = false;
    searchTotal.textContent = `-${fmt.format(total)}`;
  } else {
    searchTotal.hidden = true;
    searchTotal.textContent = "";
  }

  setRenderedHtml($("#claimRows"), claims.length ? claims.map((claim) => `
    <tr class="selectable-row" data-select-claim="${claim.id}" tabindex="0" aria-label="開啟 ${escapeHtml(claim.person)}的報銷申請">
      <td data-label="日期" title="${escapeHtml(claim.date)}">${dateCell(claim.date)}</td>
      <td data-label="申請人">${escapeHtml(claim.person)}</td>
      <td data-label="分類">${escapeHtml(claim.parent)} / ${escapeHtml(claim.child)}${claimReceiptLine(claim)}</td>
      <td class="num" data-label="金額">${fmt.format(Number(claim.amount))}</td>
      <td class="claim-status-cell" data-label="狀態"><span class="pill ${claim.status}">${statusText[claim.status]}</span>${claim.webPaid && claim.status !== "paid" ? `<span class="subtle claim-payment-meta">網頁已標記付款，請記錄付款</span>` : ""}${claim.status === "paid" ? `<span class="subtle claim-payment-meta">${escapeHtml(shortDate(claim.paymentDate || ""))} · ${escapeHtml(accountName(claim.paymentAccountId))}</span>` : ""}</td>
      <td class="claim-actions-cell">${claimActionButtons(claim)}</td>
    </tr>
  `).join("") : `<tr class="claim-empty-row"><td colspan="6"><div class="empty">${state.claims.length ? "沒有符合條件的報銷申請。" : "尚未新增報銷申請。"}</div></td></tr>`);
  requestAnimationFrame(() => syncScrollableList("claimList", 8));
}

// Accounts as cards with the current balance large; payees as a short table. Account numbers show in
// full in both and copy on a click.
function renderAccounts() {
  const accounts = state.accounts.filter((account) => !account.deletedAt);
  setRenderedHtml($("#accountRows"), accounts.map((account) => `
    <div class="account-card" data-select-account="${account.id}" tabindex="0" role="button" aria-label="編輯 ${escapeHtml(account.name)}">
      <span class="account-card-head">${escapeHtml(account.name)}<span class="subtle"> · ${accountTypeText[account.type] || "其他"}</span></span>
      <strong class="account-card-balance">${fmt.format(accountBalance(account.id, today()))}</strong>
      <span class="account-card-meta">期初 ${fmt.format(Number(account.openingBalance))}${account.accountNumber ? ` · <button type="button" class="copy-number" data-copy-account-number="${escapeHtml(account.accountNumber)}" title="點一下複製">${escapeHtml(account.accountNumber)}</button>` : ""}</span>
    </div>
  `).join("") || `<div class="empty">尚未新增帳戶。</div>`);

  setRenderedHtml($("#payeeRows"), state.payees.length ? state.payees.map((payee) => `
    <tr class="selectable-row" data-select-payee="${payee.id}" tabindex="0" aria-label="編輯 ${escapeHtml(payee.name)}">
      <td>${escapeHtml(payee.name)}</td>
      <td>${escapeHtml(payee.bank || "-")}</td>
      <td><button type="button" class="copy-number" data-copy-payee-number="${escapeHtml(payee.accountNumber)}" title="點一下複製">${escapeHtml(payee.accountNumber)}</button></td>
      <td class="account-qr-column">${payee.qrCodeDataUrl ? `<button type="button" class="text-link" data-view-payee-qr="${payee.id}">預覽</button>` : `<span class="subtle">-</span>`}</td>
    </tr>
  `).join("") : `<tr><td colspan="4"><div class="empty">尚未新增收款帳戶。</div></td></tr>`);
  requestAnimationFrame(() => syncScrollableList("payeeList", 5));

  renderReconciliation();
  renderReconciliationHistory();
}

// One row per account for the month: month-end balance − actual = difference, filled in together.
function renderReconciliation() {
  const month = $("#reconcileMonth").value || selectedMonth;
  const [year, number] = month.split("-").map(Number);
  const endDate = monthEndKey(month);
  const locked = isMonthLocked(month);
  $("#reconcileMonthLabel").textContent = `${year} 年 ${number} 月`;
  const accounts = state.accounts.filter((account) => account.active && !account.deletedAt && accountExistsAt(account, endDate));
  setRenderedHtml($("#reconcileRows"), accounts.length ? accounts.map((account) => {
    const record = state.reconciliations.find((item) => item.month === month && item.accountId === account.id);
    const expected = accountBalance(account.id, endDate);
    return `
      <tr data-reconcile-account="${account.id}" data-expected="${expected}">
        <td>${escapeHtml(account.name)}</td>
        <td class="num">${fmt.format(expected)}</td>
        <td><div class="money-input"><span aria-hidden="true">NT$</span><input type="number" inputmode="numeric" step="1" data-reconcile-actual value="${record ? record.actualBalance : ""}" ${locked ? "disabled" : ""} aria-label="${escapeHtml(account.name)}實際餘額"></div></td>
        <td class="num" data-reconcile-difference>${differenceMarkup(record ? Number(record.actualBalance) - expected : null)}</td>
        <td><input data-reconcile-note maxlength="200" value="${escapeHtml(record?.note || "")}" placeholder="例：已核對月結單" ${locked ? "disabled" : ""} aria-label="${escapeHtml(account.name)}備註"></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="5"><div class="empty">這個月沒有可對帳的帳戶。</div></td></tr>`);

  const ready = monthReadyToLock(month);
  $("#saveReconciliation").disabled = locked || !accounts.length;
  $("#toggleMonthLock").textContent = locked ? "解鎖月份" : "鎖定月份";
  $("#toggleMonthLock").disabled = !locked && !ready;
  $("#lockMonthDescription").textContent = locked
    ? "這個月已鎖定，記帳與報銷不能修改；要修改請先解鎖。"
    : ready ? "所有帳戶都已相符，可以鎖定這個月。" : "所有帳戶都儲存、差額都是 0 後，才能鎖定這個月。";
}

// A difference: a green check at zero, the amount in red otherwise, a dash before anything is typed.
function differenceMarkup(difference) {
  if (difference === null || !Number.isFinite(difference)) return `<span class="subtle">—</span>`;
  return difference === 0 ? `<span class="income">✓ ${fmt.format(0)}</span>` : `<span class="mismatch">${fmt.format(difference)}</span>`;
}

// One row per month: whether every account matched, whether it is locked, and its report.
function renderReconciliationHistory() {
  const months = [...new Set(state.reconciliations.map((item) => item.month))].sort((a, b) => b.localeCompare(a));
  setRenderedHtml($("#reconciliationRows"), months.length ? months.map((month) => {
    const records = state.reconciliations.filter((item) => item.month === month);
    const checks = records.map((item) => ({ item, current: currentReconciliationValues(item) }));
    const stale = checks.some(({ current }) => current.stale);
    const off = checks.filter(({ current }) => current.difference !== 0);
    const result = stale
      ? `<span class="stale-badge">需重新核對</span>`
      : off.length
        ? `<span class="mismatch">${off.map(({ item, current }) => `${escapeHtml(accountName(item.accountId))}差 ${fmt.format(current.difference)}`).join("、")}</span>`
        : `<span class="income">帳戶皆相符 ✓</span>`;
    const [year, number] = month.split("-").map(Number);
    return `
      <tr class="selectable-row" data-load-reconcile-month="${month}" tabindex="0" aria-label="載入 ${year} 年 ${number} 月" aria-selected="${$("#reconcileMonth").value === month}">
        <td>${year} 年 ${number} 月</td>
        <td>${result}</td>
        <td>${isMonthLocked(month) ? `<span class="locked-badge">已鎖定</span>` : `<span class="saved-badge">已儲存</span>`}</td>
        <td class="row-delete-cell"><button type="button" data-print-month="${month}">列印 / PDF</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="4"><div class="empty">尚未建立月結紀錄。</div></td></tr>`);
}

function activityRecord(activity, personId) {
  return activity?.attendance.find((item) => item.personId === personId);
}

const personNameCollator = new Intl.Collator("zh-Hant");

// One pass over every activity, so roster renders look records and totals up instead of rescanning attendance per person.
function buildAttendanceIndex() {
  const recordsByActivity = new Map();
  const statsByPerson = new Map();
  state.activities.forEach((activity) => {
    const records = new Map();
    activity.attendance.forEach((record) => {
      if (!records.has(record.personId)) records.set(record.personId, record);
    });
    recordsByActivity.set(activity, records);
    records.forEach((record, personId) => {
      if (record.status !== "attending") return;
      const stats = statsByPerson.get(personId) || { attending: 0, paid: 0, unpaid: 0 };
      stats.attending += 1;
      if (record.paid) stats.paid += 1;
      else stats.unpaid += 1;
      statsByPerson.set(personId, stats);
    });
  });
  return {
    record: (activity, personId) => recordsByActivity.has(activity) ? recordsByActivity.get(activity).get(personId) : activityRecord(activity, personId),
    stats: (personId) => statsByPerson.get(personId) || { attending: 0, paid: 0, unpaid: 0 }
  };
}

function defaultActivityRosterOrder(activity, index = buildAttendanceIndex()) {
  return state.people
    .map((person) => ({ person, record: index.record(activity, person.id), stats: index.stats(person.id) }))
    .sort((a, b) => {
      const rank = ({ record }) => record?.status !== "attending" ? 2 : record.paid ? 1 : 0;
      return rank(a) - rank(b) || b.stats.unpaid - a.stats.unpaid || personNameCollator.compare(a.person.name, b.person.name);
    })
    .map(({ person }) => person.id);
}

function activityRosterOrder(activity, index) {
  const personIds = new Set(state.people.map((person) => person.id));
  const savedOrder = Array.isArray(activity.rosterOrder) ? activity.rosterOrder.filter((personId) => personIds.has(personId)) : [];
  const saved = new Set(savedOrder);
  const fallback = defaultActivityRosterOrder(activity, index);
  return [...savedOrder, ...fallback.filter((personId) => !saved.has(personId))];
}

function activityStats(activity) {
  const stats = activity.attendance.reduce((stats, record) => {
    if (record.status === "attending") {
      stats.attending += 1;
      if (record.paid) stats.paid += 1;
      else stats.unpaid += 1;
    }
    return stats;
  }, { attending: 0, paid: 0, unpaid: 0, notAttending: 0 });
  stats.notAttending = Math.max(0, state.people.length - stats.attending);
  return stats;
}

function activityUnpaidPeople(activity) {
  const index = buildAttendanceIndex();
  return state.people
    .map((person) => ({ person, record: index.record(activity, person.id), stats: index.stats(person.id) }))
    .filter(({ record }) => record?.status === "attending" && !record.paid)
    .sort((a, b) => b.stats.unpaid - a.stats.unpaid || personNameCollator.compare(a.person.name, b.person.name));
}

// A linked sheet turns the menu's two import choices into its sync and disconnect actions, and
// shows when it last synced under the heading.
function renderImportLinkStatus(prefix, link, syncing) {
  const capitalized = prefix[0].toUpperCase() + prefix.slice(1);
  $(`#choose${capitalized}Import`).hidden = Boolean(link);
  $(`#open${capitalized}ImportLink`).hidden = Boolean(link);
  $(`#sync${capitalized}Link`).hidden = !link;
  $(`#disconnect${capitalized}Link`).hidden = !link;
  $(`#${prefix}LinkStatusText`).hidden = !link;
  if (!link) return;
  const syncedAt = new Date(link.lastSyncedAt).getTime();
  $(`#${prefix}LinkStatusText`).textContent = Number.isFinite(syncedAt)
    ? `上次同步：${new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(syncedAt)}`
    : "尚未同步";
  $(`#${prefix}LinkStatusText`).title = link.url;
  $(`#sync${capitalized}Link`).disabled = syncing;
  $(`#sync${capitalized}Link`).textContent = syncing ? "同步中" : "立即同步";
}

function renderMemberImportLink() {
  renderImportLinkStatus("person", state.memberImportLink, memberImportSyncing);
}

function renderActivityImportLink(activity) {
  renderImportLinkStatus("activity", activity?.importLink, Boolean(activity) && activityImportSyncing.has(activity.id));
}

const copyIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>`;

function renderPeople() {
  renderMemberImportLink();
  const attendanceIndex = buildAttendanceIndex();
  const personQuery = $("#personSearch").value;
  const visiblePeople = state.people
    .filter((person) => matchesSearch([person.name, person.studentId, person.department, person.email], personQuery))
    .map((person) => ({ person, stats: attendanceIndex.stats(person.id) }))
    .sort((a, b) => b.stats.unpaid - a.stats.unpaid || Number(b.stats.attending > 0) - Number(a.stats.attending > 0) || personNameCollator.compare(a.person.name, b.person.name));
  // The total alone, or "12 / 80" while a search narrows the list.
  $("#personCount").textContent = personQuery.trim() ? `${visiblePeople.length} / ${state.people.length}` : `${state.people.length} 人`;
  // The department sits under the name; a click on the email copies it.
  setRenderedHtml($("#personRows"), visiblePeople.length ? visiblePeople.map(({ person, stats }) => `
    <tr class="selectable-row" data-select-person="${person.id}" tabindex="0" aria-label="編輯 ${escapeHtml(person.name)}">
      <td><div class="person-name">${escapeHtml(person.name)}</div>${person.department ? `<div class="person-sub">${escapeHtml(person.department)}</div>` : ""}</td>
      <td class="student-id">${escapeHtml(person.studentId)}</td>
      <td>${stats.unpaid ? `<span class="unpaid-count">未繳 ${stats.unpaid} 次</span>` : stats.attending ? `<span class="pill paid">已繳</span>` : `<span class="subtle">尚無參加</span>`}</td>
      <td>${person.email ? `<button type="button" class="copy-text" data-copy-person-email="${escapeHtml(person.email)}" title="點一下複製">${escapeHtml(person.email)}${copyIcon}</button>` : `<span class="subtle">-</span>`}</td>
    </tr>
  `).join("") : `<tr><td colspan="4"><div class="empty">${state.people.length ? "沒有符合條件的人員。" : "尚未新增人員。"}</div></td></tr>`);
  requestAnimationFrame(() => syncScrollableList("personList", 8));

  const activityQuery = $("#activitySearch").value.trim().toLowerCase();
  const visibleActivities = state.activities
    .filter((activity) => !activityQuery || [activity.name, activity.date, activity.note].join(" ").toLowerCase().includes(activityQuery))
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "zh-Hant"));
  $("#activityCount").textContent = activityQuery ? `${visibleActivities.length} / ${state.activities.length}` : `${state.activities.length} 個`;
  // Payment as one figure with a bar; only an activity still owed money stands out.
  setRenderedHtml($("#activityRows"), visibleActivities.length ? visibleActivities.map((activity) => {
    const stats = activityStats(activity);
    const share = stats.attending ? Math.round((stats.paid / stats.attending) * 100) : 0;
    return `
      <tr class="selectable-row" data-select-activity="${activity.id}" tabindex="0" aria-label="開啟 ${escapeHtml(activity.name)}" aria-selected="${selectedActivityId === activity.id}">
        <td>${escapeHtml(activity.date)}</td>
        <td>${escapeHtml(activity.name)}</td>
        <td class="num">${fmt.format(activity.fee)}</td>
        <td>${stats.attending ? `<div class="paid-progress${stats.unpaid ? " has-unpaid" : ""}"><span>${stats.paid} / ${stats.attending} 已繳</span><span class="paid-bar"><span style="width:${share}%"></span></span></div>` : `<span class="subtle">尚無參加</span>`}</td>
        <td class="chevron-cell" aria-hidden="true">›</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="5"><div class="empty">${state.activities.length ? "沒有符合條件的活動。" : "尚未新增活動。"}</div></td></tr>`);

  const activity = state.activities.find((item) => item.id === selectedActivityId);
  $("#activityRoster").hidden = !activity;
  renderActivityImportLink(activity);
  if (!activity) {
    requestAnimationFrame(() => syncScrollableList("activityPersonList", 8));
    return;
  }
  const stats = activityStats(activity);
  $("#activityRosterTitle").textContent = activity.name;
  // The figures double as the filter; only an unpaid count above zero is coloured.
  const chip = (filter, label, warn = false) => `<button type="button" class="pill filter-pill${warn ? " pending" : ""}" data-roster-filter="${filter}" aria-pressed="${rosterFilter === filter}">${label}</button>`;
  setRenderedHtml($("#activityStatusSummary"), [
    chip("attending", `參加 ${stats.attending}`),
    chip("paid", `已繳 ${stats.paid}`),
    chip("unpaid", `未繳 ${stats.unpaid} 人 · ${fmt.format(activity.fee * stats.unpaid)}`, stats.unpaid > 0),
    chip("not_attending", `未參加 ${stats.notAttending}`)
  ].join(""));
  $("#exportActivityUnpaid").disabled = stats.unpaid === 0;

  const rosterQuery = $("#activityPersonSearch").value;
  const rosterOrder = new Map(activityRosterOrder(activity, attendanceIndex).map((personId, index) => [personId, index]));
  const roster = state.people
    .map((person) => ({ person, record: attendanceIndex.record(activity, person.id) }))
    .filter(({ person }) => matchesSearch([person.name, person.studentId, person.department, person.email], rosterQuery))
    .filter(({ record }) => {
      if (rosterFilter === "unpaid") return record?.status === "attending" && !record.paid;
      if (rosterFilter === "paid") return record?.status === "attending" && record.paid;
      if (rosterFilter === "attending") return record?.status === "attending";
      return record?.status !== "attending";
    })
    .sort((a, b) => {
      const aPaid = a.record?.status === "attending" && a.record.paid;
      const bPaid = b.record?.status === "attending" && b.record.paid;
      if (Boolean(aPaid) !== Boolean(bPaid)) return aPaid ? 1 : -1;
      const aPaidAt = aPaid ? a.record.paidAt : "";
      const bPaidAt = bPaid ? b.record.paidAt : "";
      if (aPaidAt && bPaidAt) return aPaidAt.localeCompare(bPaidAt) || rosterOrder.get(a.person.id) - rosterOrder.get(b.person.id);
      if (aPaidAt) return -1;
      if (bPaidAt) return 1;
      return rosterOrder.get(a.person.id) - rosterOrder.get(b.person.id);
    });
  rosterVisibleIds = roster.map(({ person }) => person.id);
  rosterSelection = new Set([...rosterSelection].filter((personId) => rosterVisibleIds.includes(personId)));
  // A switch for attending; for those attending, the transfer suffix and a tag that toggles paid.
  setRenderedHtml($("#activityPersonRows"), roster.length ? roster.map(({ person, record }) => {
    const attending = record?.status === "attending";
    return `
    <tr class="activity-roster-row${rosterSelection.has(person.id) ? " is-selected" : ""}" data-roster-activity-id="${activity.id}" data-roster-person-id="${person.id}">
      <td class="select-cell"><input type="checkbox" data-roster-select="${person.id}" ${rosterSelection.has(person.id) ? "checked" : ""} aria-label="選取 ${escapeHtml(person.name)}"></td>
      <td><div class="person-name">${escapeHtml(person.name)}</div>${person.department ? `<div class="person-sub">${escapeHtml(person.department)}</div>` : ""}</td>
      <td class="student-id">${escapeHtml(person.studentId)}</td>
      <td><label class="switch"><input type="checkbox" role="switch" data-toggle-attendance data-activity-id="${activity.id}" data-person-id="${person.id}" ${attending ? "checked" : ""} aria-label="${escapeHtml(person.name)}參加"><span aria-hidden="true"></span></label></td>
      <td>${attending ? `<input type="text" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" placeholder="五位數字" value="${escapeHtml(record.transferLastFive || "")}" data-transfer-last-five data-activity-id="${activity.id}" data-person-id="${person.id}" aria-label="${escapeHtml(person.name)}匯款後五碼">` : ""}</td>
      <td>${attending ? `<button type="button" class="pay-tag ${record.paid ? "paid" : "unpaid"}" data-toggle-payment data-activity-id="${activity.id}" data-person-id="${person.id}" aria-pressed="${record.paid}" aria-label="${escapeHtml(person.name)}${record.paid ? "已繳，點一下改為未繳" : "未繳，點一下改為已繳"}">${record.paid ? "已繳" : "未繳"}</button>` : ""}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6"><div class="empty">${state.people.length ? "沒有符合條件的人員。" : "請先新增人員。"}</div></td></tr>`);
  renderRosterBatch();
  requestAnimationFrame(() => syncScrollableList("activityPersonList", 8));
}

function renderRosterBatch() {
  $("#rosterBatch").hidden = !rosterSelection.size;
  $("#rosterBatchCount").textContent = rosterSelection.size;
  $("#rosterSelectAll").checked = rosterVisibleIds.length > 0 && rosterVisibleIds.every((personId) => rosterSelection.has(personId));
  $("#rosterSelectAll").indeterminate = rosterSelection.size > 0 && !$("#rosterSelectAll").checked;
  $$("#activityPersonRows [data-roster-person-id]").forEach((row) => row.classList.toggle("is-selected", rosterSelection.has(row.dataset.rosterPersonId)));
}

function renderCategories() {
  setRenderedHtml($("#incomeCategories"), categoryCards(categories.income));
  setRenderedHtml($("#expenseCategories"), categoryCards(categories.expense));
}

function renderTrash() {
  const now = Date.now();
  const items = [...state.trash].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  selectedTrashIds = new Set([...selectedTrashIds].filter((id) => items.some((item) => item.id === id)));
  const selectedCount = selectedTrashIds.size;
  $("#restoreSelectedTrash").disabled = !selectedCount;
  $("#purgeSelectedTrash").disabled = !selectedCount;
  setRenderedHtml($("#trashRows"), items.length ? items.map((item) => {
    const record = item.record || {};
    const expiresAt = new Date(item.deletedAt).getTime() + retentionDays * dayMs;
    const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / dayMs));
    const content = item.kind === "entry"
      ? (record.title || record.child || "未命名收支")
      : `${record.person || "未填申請人"} / ${record.title || "未填用途"}`;
    return `
      <tr data-select-trash-row="${item.id}" class="${selectedTrashIds.has(item.id) ? "is-selected" : ""}">
        <td>${escapeHtml(dateKey(new Date(item.deletedAt)))}</td>
        <td>${item.kind === "entry" ? "記帳" : "報銷"}</td>
        <td>${escapeHtml(content)}<br><span class="trash-meta">${escapeHtml(record.parent || "")} / ${escapeHtml(record.child || "")}</span></td>
        <td>${escapeHtml(record.date || "-")}</td>
        <td>${daysLeft} 天</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="5"><div class="empty">垃圾桶目前是空的。</div></td></tr>`);
  scheduleTrashPurge();
}

function categoryCards(group) {
  return [...Object.entries(group), ["其他", ["其他"]]].map(([parent, children]) => `
    <div class="category-card">
      <strong>${escapeHtml(parent)}</strong>
      <div class="chips">${[...children, ...(parent === "其他" ? [] : ["其他"])].map((child) => `<span class="pill">${escapeHtml(child)}</span>`).join("")}</div>
    </div>
  `).join("");
}
