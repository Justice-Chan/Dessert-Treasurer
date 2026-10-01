function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
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
  setAccountOptions($("#reconcileAccount"), $("#reconcileAccount").value, true);
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

  wrap.classList.remove("list-scroll-active");
  wrap.style.maxHeight = "";
  if (!wrap.offsetParent) return;

  const rows = [...body.rows].filter((row) => row.cells.length && !row.querySelector("[colspan]"));
  if (rows.length <= visibleRows) return;

  const headerHeight = table.tHead?.getBoundingClientRect().height || 0;
  const rowsHeight = rows.slice(0, visibleRows)
    .reduce((total, row) => total + row.getBoundingClientRect().height, 0);
  wrap.style.maxHeight = `${Math.ceil(headerHeight + rowsHeight + 2)}px`;
  wrap.classList.add("list-scroll-active");
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
  else if (section === "categories") renderCategories();
  else if (section === "trash") renderTrash();
  else if (section === "backup") renderBackupHealth();
  else if (section === "settings") renderImportSynonymSettings();
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

function renderBackupHealth() {
  const node = $("#backupHealth");
  if (!node) return;
  if (!state.lastBackupAt) {
    node.textContent = "尚未建立完整備份";
    node.title = "建議在正式記帳前先建立一份 JSON 完整備份。";
    return;
  }
  const elapsedDays = Math.floor((Date.now() - new Date(state.lastBackupAt).getTime()) / dayMs);
  const date = new Date(state.lastBackupAt).toLocaleDateString("zh-TW");
  node.textContent = elapsedDays >= 30 ? `上次完整備份：${date}，建議更新` : `上次完整備份：${date}（${elapsedDays} 天前）`;
  node.title = elapsedDays >= 30 ? `距今 ${elapsedDays} 天，建議立即下載新的 JSON 完整備份。` : "JSON 完整備份可在需要時還原全部資料。";
}

function renderOverview() {
  renderMonthSelector();
  const [year, monthNumber] = selectedMonth.split("-").map(Number);
  const monthEnd = new Date(year, monthNumber, 0);
  const monthEndKey = dateKey(monthEnd);
  const balance = state.accounts
    .filter((account) => accountExistsAt(account, monthEndKey))
    .reduce((sum, account) => sum + accountBalance(account.id, monthEndKey), 0);
  const monthEntries = state.entries.filter((entry) => isActiveEntry(entry) && entry.date && entry.date.startsWith(selectedMonth));
  const monthClaims = state.claims.filter((claim) => claim.date && claim.date.startsWith(selectedMonth));
  const activeMonthClaims = monthClaims.filter((claim) => claim.status !== "rejected");
  const income = monthEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const claimsTotal = activeMonthClaims.reduce((sum, claim) => sum + Number(claim.amount), 0);
  const otherExpenseGroups = groupOtherExpenses(monthEntries);
  const otherExpense = otherExpenseGroups.reduce((sum, item) => sum + item.value, 0);
  const expense = claimsTotal + otherExpense;
  const pending = monthClaims.filter((claim) => claim.status === "pending" || claim.status === "approved").reduce((sum, claim) => sum + Number(claim.amount), 0);
  $("#balance").textContent = fmt.format(balance);
  $("#monthIncome").textContent = fmt.format(income);
  $("#monthExpense").textContent = fmt.format(expense);
  $("#pendingClaims").textContent = fmt.format(pending);
  $("#balanceLabel").textContent = `${monthNumber} 月底帳面餘額`;
  $("#claimsLabel").textContent = `${monthNumber} 月待處理報銷`;
  $("#incomeLabel").textContent = `${monthNumber} 月收入`;
  $("#expenseLabel").textContent = `${monthNumber} 月支出`;

  renderFinancialDistribution(income, expense, claimsTotal, otherExpense);
  renderExpenseDistribution(claimsTotal, otherExpenseGroups);

  const recentStart = new Date(monthEnd);
  recentStart.setDate(recentStart.getDate() - 29);
  const recentStartKey = dateKey(recentStart);
  $("#recentRange").textContent = `${dateFmt.format(recentStart)} - ${dateFmt.format(monthEnd)}`;
  const recent = state.entries
    .filter((entry) => isActiveEntry(entry) && entry.date && entry.date >= recentStartKey && entry.date <= monthEndKey)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  $("#recentRows").innerHTML = recent.length ? recent.map((entry) => `
    <tr>
      <td>${escapeHtml(entry.date)}</td>
      <td>${escapeHtml(entry.title || entry.child || "未命名紀錄")}</td>
      <td>${escapeHtml(entry.parent)} / ${escapeHtml(entry.child)}</td>
      <td class="num ${amountClass(entry.type)}">${entry.type === "income" ? "+" : "-"}${fmt.format(Number(entry.amount))}</td>
    </tr>
  `).join("") : `<tr><td colspan="4"><div class="empty">這 30 天沒有收支紀錄。</div></td></tr>`;
}

function renderMonthSelector() {
  $("#monthYearLabel").textContent = `${displayedYear} 年`;
  $("#monthList").innerHTML = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const value = `${displayedYear}-${month}`;
    return `<button type="button" class="month-button" data-month="${value}" aria-pressed="${value === selectedMonth}">${index + 1}月</button>`;
  }).join("");
}

function piePath(startRatio, endRatio) {
  const center = 60;
  const radius = 50;
  const startAngle = startRatio * Math.PI * 2 - Math.PI / 2;
  const endAngle = endRatio * Math.PI * 2 - Math.PI / 2;
  const startX = center + radius * Math.cos(startAngle);
  const startY = center + radius * Math.sin(startAngle);
  const endX = center + radius * Math.cos(endAngle);
  const endY = center + radius * Math.sin(endAngle);
  const largeArc = endRatio - startRatio > 0.5 ? 1 : 0;
  return `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
}

function percentage(value, total) {
  return total > 0 ? `${(value / total * 100).toFixed(1)}%` : "0.0%";
}

function groupOtherExpenses(monthEntries) {
  const grouped = {};
  const activeClaimIds = new Set(state.claims.map((claim) => claim.id));
  monthEntries
    .filter((entry) => entry.type === "expense" && (!entry.claimId || !activeClaimIds.has(entry.claimId)))
    .forEach((entry) => {
      const label = entry.parent || "未分類";
      grouped[label] = (grouped[label] || 0) + Number(entry.amount);
    });

  return Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
}

function renderFinancialDistribution(income, expense, claims, otherExpense) {
  const values = [
    { label: "收入", detail: "已記帳收入", value: income, color: "#2f6e4f", className: "" },
    { label: "支出", detail: "報銷與其他支出合計", value: expense, color: "#c7644b", className: "" }
  ];
  const total = values.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const slices = total ? values.filter((item) => item.value > 0).map((item) => {
    const start = cursor;
    cursor += item.value / total;
    if (item.value === total) return `<circle cx="60" cy="60" r="50" fill="${item.color}"></circle>`;
    return `<path d="${piePath(start, cursor)}" fill="${item.color}"></path>`;
  }).join("") : `<circle cx="60" cy="60" r="50" fill="#f6f4ee" stroke="#dedbd2"></circle>`;
  const legend = values.map((item) => `
    <div class="legend-row ${item.className}">
      <span class="legend-swatch" style="background:${item.color}"></span>
      <span>${item.label}<small>${item.detail} · ${percentage(item.value, total)}</small></span>
      <strong>${fmt.format(item.value)}</strong>
    </div>
  `).join("") + `
    <div class="legend-row claim-flow">
      <span class="legend-swatch" style="background:#b78736"></span>
      <span>報銷<small>不含退回 · 占支出 ${percentage(claims, expense)}</small></span>
      <strong>${fmt.format(claims)}</strong>
    </div>
    <div class="legend-row claim-flow">
      <span class="legend-swatch" style="background:#58796a"></span>
      <span>其他<small>非報銷支出 · 占支出 ${percentage(otherExpense, expense)}</small></span>
      <strong>${fmt.format(otherExpense)}</strong>
    </div>
  `;
  $("#financialDistribution").innerHTML = `
    <div class="donut-wrap" role="img" aria-label="收入 ${fmt.format(income)}，支出 ${fmt.format(expense)}；支出包含未退回報銷 ${fmt.format(claims)}與其他 ${fmt.format(otherExpense)}">
      <svg viewBox="0 0 120 120" aria-hidden="true">${slices}</svg>
    </div>
    <div class="legend">${legend}</div>
  `;
}

function renderExpenseDistribution(claims, otherExpenseGroups) {
  const palette = ["#58796a", "#5d6e8a", "#8a665d", "#7c7152", "#4f7f86"];
  const otherValues = otherExpenseGroups.map((item, index) => ({
    ...item,
    color: palette[index % palette.length]
  }));
  const otherExpense = otherValues.reduce((sum, item) => sum + item.value, 0);
  const values = [
    { label: "報銷", detail: "不含退回", value: claims, color: "#b78736" },
    ...otherValues
  ];
  const total = values.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const slices = total ? values.filter((item) => item.value > 0).map((item) => {
    const start = cursor;
    cursor += item.value / total;
    if (item.value === total) return `<circle cx="60" cy="60" r="50" fill="${item.color}"></circle>`;
    return `<path d="${piePath(start, cursor)}" fill="${item.color}"></path>`;
  }).join("") : `<circle cx="60" cy="60" r="50" fill="#f6f4ee" stroke="#dedbd2"></circle>`;
  const reimbursementRow = `
    <div class="legend-row">
      <span class="legend-swatch" style="background:#b78736"></span>
      <span>報銷<small>不含退回 · ${percentage(claims, total)}</small></span>
      <strong>${fmt.format(claims)}</strong>
    </div>
  `;
  const otherSummaryRow = `
    <div class="legend-row other-summary">
      <span class="legend-swatch"></span>
      <span>其他<small>依支出主項目細分 · ${percentage(otherExpense, total)}</small></span>
      <strong>${fmt.format(otherExpense)}</strong>
    </div>
  `;
  const otherRows = otherValues.map((item) => `
    <div class="legend-row expense-branch">
      <span class="legend-swatch" style="background:${item.color}"></span>
      <span>${escapeHtml(item.label)}<small>占支出 ${percentage(item.value, total)}</small></span>
      <strong>${fmt.format(item.value)}</strong>
    </div>
  `).join("");
  const legend = total ? reimbursementRow + otherSummaryRow + otherRows : `<div class="empty">本月還沒有支出紀錄。</div>`;
  const categoryLabel = otherValues.map((item) => `${item.label} ${percentage(item.value, total)}`).join("，");
  $("#expenseDistribution").innerHTML = `
    <div class="donut-wrap" role="img" aria-label="${escapeHtml(`本月支出中，報銷 ${percentage(claims, total)}，其他 ${percentage(otherExpense, total)}${categoryLabel ? `；其他包含 ${categoryLabel}` : ""}`)}">
      <svg viewBox="0 0 120 120" aria-hidden="true">${slices}</svg>
    </div>
    <div class="legend">${legend}</div>
  `;
}

function renderLedger() {
  const query = $("#ledgerSearch").value.trim().toLowerCase();
  const type = $("#ledgerType").value;
  const parent = $("#ledgerParent").value;
  const dateFrom = isValidDateValue($("#ledgerDateFrom").value) ? $("#ledgerDateFrom").value : "";
  const dateTo = isValidDateValue($("#ledgerDateTo").value) ? $("#ledgerDateTo").value : "";
  if (dateFrom && dateTo && dateFrom > dateTo) {
    $("#ledgerRows").innerHTML = `<tr><td colspan="6"><div class="empty">起始日期不能晚於結束日期。</div></td></tr>`;
    requestAnimationFrame(() => syncScrollableList("ledgerList", 8));
    return;
  }
  const entries = state.entries
    .filter(isActiveEntry)
    .filter((entry) => type === "all" || entry.type === type)
    .filter((entry) => parent === "all" || (type === "all"
      ? matchesParentFilter(entry, entry.type, parent)
      : matchesParentFilter(entry, type, parent)))
    .filter((entry) => !dateFrom || entry.date >= dateFrom)
    .filter((entry) => !dateTo || entry.date <= dateTo)
    .filter((entry) => !query || [entry.title, entry.note, entry.parent, entry.child, entry.method, accountName(entry.accountId)].join(" ").toLowerCase().includes(query))
    .sort((a, b) => b.date.localeCompare(a.date));

  $("#ledgerRows").innerHTML = entries.length ? entries.map((entry) => `
    <tr class="selectable-row" data-select-entry="${entry.id}" tabindex="0" aria-label="選取 ${escapeHtml(entry.title || entry.child || "未命名紀錄")}" aria-selected="${$("#entryId").value === entry.id}">
      <td>${escapeHtml(entry.date)}</td>
      <td>${entry.type === "income" ? "收入" : "支出"}</td>
      <td>${escapeHtml(entry.title || entry.child || "未命名紀錄")}<br><span class="subtle">${escapeHtml(accountName(entry.accountId))} · ${escapeHtml(entry.method || "")}</span></td>
      <td>${escapeHtml(entry.parent)} / ${escapeHtml(entry.child)}</td>
      <td class="num ${amountClass(entry.type)}">${fmt.format(Number(entry.amount))}</td>
      <td>${entry.claimId
        ? `<span class="managed-entry-note">請至報銷頁管理</span>`
        : `<div class="inline-actions"><button class="danger" data-delete-entry="${entry.id}">刪除</button></div>`}
    </tr>
  `).join("") : `<tr><td colspan="6"><div class="empty">${state.entries.length ? "沒有符合條件的收支紀錄。" : "尚未新增收支紀錄。"}</div></td></tr>`;
  requestAnimationFrame(() => syncScrollableList("ledgerList", 8));
}

function claimActionButtons(claim) {
  const buttons = [];
  if (claim.status === "approved") buttons.push(`<button class="primary" data-pay-claim="${claim.id}">付款</button>`);
  if (claim.status === "paid" && !affectsLockedBalance(claim.paymentDate)) buttons.push(`<button data-revoke-payment="${claim.id}" aria-label="撤銷付款" title="撤銷付款">撤銷</button>`);
  if (!isClaimLocked(claim)) buttons.push(`<button class="danger" data-delete-claim="${claim.id}">刪除</button>`);
  return buttons.length ? `<div class="inline-actions nowrap-actions claim-row-actions">${buttons.join("")}</div>` : "";
}

function renderClaims() {
  const query = $("#claimSearch").value.trim().toLowerCase();
  const status = $("#claimStatusFilter").value;
  const parent = $("#claimParentFilter").value;
  const dateFrom = isValidDateValue($("#claimDateFrom").value) ? $("#claimDateFrom").value : "";
  const dateTo = isValidDateValue($("#claimDateTo").value) ? $("#claimDateTo").value : "";
  if (dateFrom && dateTo && dateFrom > dateTo) {
    $("#claimRows").innerHTML = `<tr class="claim-empty-row"><td colspan="6"><div class="empty">起始日期不能晚於結束日期。</div></td></tr>`;
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

  $("#claimRows").innerHTML = claims.length ? claims.map((claim) => `
    <tr class="selectable-row" data-select-claim="${claim.id}" tabindex="0" aria-label="選取 ${escapeHtml(claim.person)}的報銷申請" aria-selected="${$("#claimId").value === claim.id}">
      <td data-label="日期">${escapeHtml(claim.date)}</td>
      <td data-label="申請人">${escapeHtml(claim.person)}</td>
      <td data-label="用途">${escapeHtml(claim.title)}<br><span class="subtle">${claimReceiptMarkup(claim.receipt)}${claim.attachments?.length ? ` · ${claim.attachments.length} 個附件` : ""}</span></td>
      <td data-label="分類">${escapeHtml(claim.parent)} / ${escapeHtml(claim.child)}</td>
      <td class="num" data-label="金額">${fmt.format(Number(claim.amount))}</td>
      <td class="claim-status-cell" data-label="狀態"><div class="claim-status-line"><span class="pill ${claim.status}">${statusText[claim.status]}</span>${claimActionButtons(claim)}</div>${claim.status === "paid" ? `<span class="subtle claim-payment-meta">${escapeHtml(claim.paymentDate || "")} · ${escapeHtml(accountName(claim.paymentAccountId))}</span>` : ""}</td>
    </tr>
  `).join("") : `<tr class="claim-empty-row"><td colspan="6"><div class="empty">${state.claims.length ? "沒有符合條件的報銷申請。" : "尚未新增報銷申請。"}</div></td></tr>`;
  requestAnimationFrame(() => syncScrollableList("claimList", 8));
}

function renderAccounts() {
  $("#accountRows").innerHTML = state.accounts.filter((account) => !account.deletedAt).map((account) => `
    <tr class="selectable-row" data-select-account="${account.id}" tabindex="0" aria-label="選取 ${escapeHtml(account.name)}" aria-selected="${$("#accountId").value === account.id}">
      <td>${escapeHtml(account.name)}</td>
      <td>${accountTypeText[account.type] || "其他"}</td>
      <td>${account.accountNumber ? `<div class="account-number-cell"><span title="${escapeHtml(account.accountNumber)}">${escapeHtml(account.accountNumber)}</span><button type="button" data-copy-account-number="${escapeHtml(account.accountNumber)}">複製</button></div>` : "-"}</td>
      <td class="num">${fmt.format(Number(account.openingBalance))}</td>
      <td class="num">${fmt.format(accountBalance(account.id, today()))}</td>
      <td class="account-qr-column">${account.qrCodeDataUrl ? `<div class="inline-actions nowrap-actions"><button data-view-account-qr="${account.id}">預覽</button><button class="danger" data-revoke-account-qr="${account.id}">撤銷</button></div>` : "-"}</td>
      <td class="row-delete-cell"><button class="danger" data-delete-account="${account.id}" aria-label="刪除 ${escapeHtml(account.name)}">刪除</button></td>
    </tr>
  `).join("");

  $("#payeeRows").innerHTML = state.payees.length ? state.payees.map((payee) => `
    <tr class="selectable-row" data-select-payee="${payee.id}" tabindex="0" aria-label="選取 ${escapeHtml(payee.name)}" aria-selected="${$("#payeeId").value === payee.id}">
      <td>${escapeHtml(payee.name)}</td>
      <td>${escapeHtml(payee.bank || "-")}</td>
      <td><div class="account-number-cell"><span title="${escapeHtml(payee.accountNumber)}">${escapeHtml(payee.accountNumber)}</span><button type="button" data-copy-payee-number="${escapeHtml(payee.accountNumber)}">複製</button></div></td>
      <td class="account-qr-column">${payee.qrCodeDataUrl ? `<div class="inline-actions nowrap-actions"><button data-view-payee-qr="${payee.id}">預覽</button><button class="danger" data-revoke-payee-qr="${payee.id}">撤銷</button></div>` : "-"}</td>
      <td class="row-delete-cell"><button class="danger" data-delete-payee="${payee.id}" aria-label="刪除 ${escapeHtml(payee.name)}">刪除</button></td>
    </tr>
  `).join("") : `<tr><td colspan="5"><div class="empty">尚未新增收款帳戶。</div></td></tr>`;
  requestAnimationFrame(() => syncScrollableList("payeeList", 5));

  $("#reconciliationRows").innerHTML = state.reconciliations.length ? [...state.reconciliations]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((item) => {
      const current = currentReconciliationValues(item);
      return `
        <tr>
          <td>${escapeHtml(item.month)}${isMonthLocked(item.month) ? ` <span class="locked-badge">已鎖定</span>` : ""}${current.stale ? ` <span class="stale-badge">需重新核對</span>` : ""}</td>
          <td>${escapeHtml(accountName(item.accountId))}</td>
          <td class="num">${fmt.format(current.calculatedBalance)}${current.stale ? `<br><span class="subtle">月結時 ${fmt.format(Number(item.calculatedBalance))}</span>` : ""}</td>
          <td class="num">${fmt.format(Number(item.actualBalance))}</td>
          <td class="num ${current.difference === 0 ? "income" : "expense"}">${fmt.format(current.difference)}</td>
          <td>${escapeHtml(item.note || "")}</td>
        </tr>
      `;
    }).join("") : `<tr><td colspan="6"><div class="empty">尚未建立月結紀錄。</div></td></tr>`;

  renderReconciliationSummary();
}

function renderReconciliationSummary() {
  const month = $("#reconcileMonth").value || selectedMonth;
  const accountId = $("#reconcileAccount").value;
  if (!month || !accountId) return;
  const calculated = accountBalance(accountId, monthEndKey(month));
  const actualValue = $("#reconcileActual").value;
  const actual = actualValue === "" ? null : Number(actualValue);
  $("#reconcileCalculated").textContent = fmt.format(calculated);
  $("#reconcileDifference").textContent = actual === null ? fmt.format(0) : fmt.format(actual - calculated);
  const locked = isMonthLocked(month);
  const saved = state.reconciliations.find((item) => item.month === month && item.accountId === accountId);
  const stale = Boolean(saved && calculated !== Number(saved.calculatedBalance));
  $("#lockMonthLabel").textContent = `${month} ${locked ? "已鎖定" : "尚未鎖定"}`;
  $("#lockMonthDescription").textContent = stale
    ? "月結後帳務曾變更，請解鎖並重新儲存月結。"
    : locked ? "解鎖後才可修改這個月的帳務。" : "鎖定後，該月的記帳與報銷不可修改。";
  $("#toggleMonthLock").textContent = locked ? "解鎖月份" : "鎖定月份";
  $("#toggleMonthLock").classList.toggle("danger", !locked);
  $("#saveReconciliation").textContent = saved ? "更新月結" : "儲存月結";
  $("#saveReconciliation").disabled = locked;
}

function activityRecord(activity, personId) {
  return activity?.attendance.find((item) => item.personId === personId);
}

function defaultActivityRosterOrder(activity) {
  return state.people
    .map((person) => ({ person, record: activityRecord(activity, person.id), stats: personActivityStats(person.id) }))
    .sort((a, b) => {
      const rank = ({ record }) => record?.status !== "attending" ? 2 : record.paid ? 1 : 0;
      return rank(a) - rank(b) || b.stats.unpaid - a.stats.unpaid || a.person.name.localeCompare(b.person.name, "zh-Hant");
    })
    .map(({ person }) => person.id);
}

function activityRosterOrder(activity) {
  const personIds = new Set(state.people.map((person) => person.id));
  const savedOrder = Array.isArray(activity.rosterOrder) ? activity.rosterOrder.filter((personId) => personIds.has(personId)) : [];
  const fallback = defaultActivityRosterOrder(activity);
  return [...savedOrder, ...fallback.filter((personId) => !savedOrder.includes(personId))];
}

function reorderActivityRoster(activityId, personId, targetPersonId, placeAfter = false) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity || personId === targetPersonId) return;
  const order = activityRosterOrder(activity);
  const sourceIndex = order.indexOf(personId);
  if (sourceIndex < 0) return;
  order.splice(sourceIndex, 1);
  const targetIndex = order.indexOf(targetPersonId);
  if (targetIndex < 0) return;
  order.splice(targetIndex + Number(placeAfter), 0, personId);
  activity.rosterOrder = order;
  if (!saveState()) return;
  renderPeople();
  toast("活動人員排序已儲存。");
}

function personActivityStats(personId) {
  return state.activities.reduce((stats, activity) => {
    const record = activityRecord(activity, personId);
    if (record?.status !== "attending") return stats;
    stats.attending += 1;
    if (record.paid) stats.paid += 1;
    else stats.unpaid += 1;
    return stats;
  }, { attending: 0, paid: 0, unpaid: 0 });
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
  return state.people
    .map((person) => ({ person, record: activityRecord(activity, person.id), stats: personActivityStats(person.id) }))
    .filter(({ record }) => record?.status === "attending" && !record.paid)
    .sort((a, b) => b.stats.unpaid - a.stats.unpaid || a.person.name.localeCompare(b.person.name, "zh-Hant"));
}

function renderMemberImportLink() {
  const link = state.memberImportLink;
  $("#personLinkStatus").hidden = !link;
  if (!link) return;
  const syncedAt = new Date(link.lastSyncedAt).getTime();
  $("#personLinkStatusText").textContent = Number.isFinite(syncedAt)
    ? `上次同步：${new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(syncedAt)}`
    : "尚未同步";
  $("#personLinkStatusText").title = link.url;
  $("#syncPersonLink").disabled = memberImportSyncing;
  $("#syncPersonLink").textContent = memberImportSyncing ? "同步中" : "立即同步";
}

function renderActivityImportLink(activity) {
  const link = activity?.importLink;
  $("#activityLinkStatus").hidden = !link;
  if (!link) return;
  const syncedAt = new Date(link.lastSyncedAt).getTime();
  $("#activityLinkStatusText").textContent = Number.isFinite(syncedAt)
    ? `上次同步：${new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(syncedAt)}`
    : "尚未同步";
  $("#activityLinkStatusText").title = link.url;
  const syncing = activityImportSyncing.has(activity.id);
  $("#syncActivityLink").disabled = syncing;
  $("#syncActivityLink").textContent = syncing ? "同步中" : "立即同步";
}

function renderPeople() {
  renderMemberImportLink();
  const personQuery = $("#personSearch").value;
  const visiblePeople = state.people
    .filter((person) => matchesSearch([person.name, person.studentId, person.department, person.email], personQuery))
    .map((person) => ({ person, stats: personActivityStats(person.id) }))
    .sort((a, b) => b.stats.unpaid - a.stats.unpaid || Number(b.stats.attending > 0) - Number(a.stats.attending > 0) || a.person.name.localeCompare(b.person.name, "zh-Hant"));
  $("#personCount").textContent = `(${visiblePeople.length}/${state.people.length})`;
  $("#personRows").innerHTML = visiblePeople.length ? visiblePeople.map(({ person, stats }) => `
    <tr class="selectable-row" data-select-person="${person.id}" tabindex="0" aria-label="選取 ${escapeHtml(person.name)}" aria-selected="${$("#personId").value === person.id}">
      <td>${escapeHtml(person.name)}</td>
      <td>${escapeHtml(person.studentId)}</td>
      <td>${escapeHtml(person.department || "-")}</td>
      <td>${stats.unpaid ? `<span class="unpaid-count">未繳 ${stats.unpaid} 次</span>` : stats.attending ? `<span class="pill paid">已繳</span>` : `<span class="subtle">尚無參加</span>`}</td>
      <td><button type="button" data-copy-person-email="${escapeHtml(person.email || "")}" ${person.email ? "" : "disabled"} aria-label="複製 ${escapeHtml(person.name)} 的電子郵件">複製</button></td>
    </tr>
  `).join("") : `<tr><td colspan="5"><div class="empty">${state.people.length ? "沒有符合條件的人員。" : "尚未新增人員。"}</div></td></tr>`;
  requestAnimationFrame(() => syncScrollableList("personList", 8));

  const activityQuery = $("#activitySearch").value.trim().toLowerCase();
  const visibleActivities = state.activities
    .filter((activity) => !activityQuery || [activity.name, activity.date, activity.note].join(" ").toLowerCase().includes(activityQuery))
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "zh-Hant"));
  $("#activityCount").textContent = `(${visibleActivities.length}/${state.activities.length})`;
  $("#activityRows").innerHTML = visibleActivities.length ? visibleActivities.map((activity) => {
    const stats = activityStats(activity);
    return `
      <tr class="selectable-row" data-select-activity="${activity.id}" tabindex="0" aria-label="選取 ${escapeHtml(activity.name)}" aria-selected="${$("#activityId").value === activity.id}">
        <td>${escapeHtml(activity.date)}</td>
        <td>${escapeHtml(activity.name)}</td>
        <td class="num">${fmt.format(activity.fee)}</td>
        <td class="num">${stats.attending}</td>
        <td class="num income">${stats.paid}</td>
        <td class="num ${stats.unpaid ? "expense" : ""}">${stats.unpaid}</td>
        <td class="row-delete-cell"><button type="button" class="danger" data-delete-activity="${activity.id}" aria-label="刪除 ${escapeHtml(activity.name)}">刪除</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="7"><div class="empty">${state.activities.length ? "沒有符合條件的活動。" : "尚未新增活動。"}</div></td></tr>`;

  const activity = state.activities.find((item) => item.id === $("#activityId").value);
  $("#activityRoster").hidden = !activity;
  renderActivityImportLink(activity);
  if (!activity) {
    requestAnimationFrame(() => syncScrollableList("activityPersonList", 8));
    return;
  }
  const stats = activityStats(activity);
  $("#activityRosterTitle").textContent = activity.name;
  $("#activityRosterDetails").textContent = [activity.date, `每人 ${fmt.format(activity.fee)}`, activity.note].filter(Boolean).join(" · ");
  $("#activityRosterDetails").hidden = false;
  $("#activityStatusSummary").innerHTML = `
    <span class="pill">參加 ${stats.attending}</span>
    <span class="pill paid">已繳 ${stats.paid}</span>
    <span class="pill pending">未繳 ${stats.unpaid}</span>
    <span class="pill pending">待收 ${fmt.format(activity.fee * stats.unpaid)}</span>
    <span class="pill">未參加 ${stats.notAttending}</span>
  `;
  $("#exportActivityUnpaid").disabled = stats.unpaid === 0;

  const rosterQuery = $("#activityPersonSearch").value;
  const rosterFilter = $("#activityPersonFilter").value;
  const rosterOrder = new Map(activityRosterOrder(activity).map((personId, index) => [personId, index]));
  const roster = state.people
    .map((person) => ({ person, record: activityRecord(activity, person.id), globalStats: personActivityStats(person.id) }))
    .filter(({ person }) => matchesSearch([person.name, person.studentId, person.department, person.email], rosterQuery))
    .filter(({ record }) => {
      if (rosterFilter === "unpaid") return record?.status === "attending" && !record.paid;
      if (rosterFilter === "paid") return record?.status === "attending" && record.paid;
      if (rosterFilter === "attending") return record?.status === "attending";
      return record?.status !== "attending";
    })
    .sort((a, b) => {
      const aPaidAt = a.record?.status === "attending" && a.record.paid ? a.record.paidAt : "";
      const bPaidAt = b.record?.status === "attending" && b.record.paid ? b.record.paidAt : "";
      if (aPaidAt && bPaidAt) return aPaidAt.localeCompare(bPaidAt) || rosterOrder.get(a.person.id) - rosterOrder.get(b.person.id);
      if (aPaidAt) return -1;
      if (bPaidAt) return 1;
      return rosterOrder.get(a.person.id) - rosterOrder.get(b.person.id);
    });
  $("#activityPersonRows").innerHTML = roster.length ? roster.map(({ person, record }) => `
    <tr class="activity-roster-row" data-roster-activity-id="${activity.id}" data-roster-person-id="${person.id}" tabindex="0" aria-label="拖曳排序 ${escapeHtml(person.name)}">
      <td><span class="drag-handle" title="拖曳排序" aria-hidden="true">::</span>${escapeHtml(person.name)}</td>
      <td>${escapeHtml(person.studentId)}</td>
      <td>${escapeHtml(person.department || "-")}</td>
      <td><div class="status-control" role="group" aria-label="${escapeHtml(person.name)}參加狀態"><button type="button" data-set-attendance="attending" data-activity-id="${activity.id}" data-person-id="${person.id}" aria-pressed="${record?.status === "attending"}">參加</button><button type="button" data-set-attendance="not_attending" data-activity-id="${activity.id}" data-person-id="${person.id}" aria-pressed="${record?.status !== "attending"}">未參加</button></div></td>
      <td>${record?.status === "attending" && record.paid ? `<input type="text" inputmode="numeric" maxlength="11" placeholder="MM-DD HH:mm" value="${escapeHtml(record.paidAt || "")}" data-payment-time data-activity-id="${activity.id}" data-person-id="${person.id}" aria-label="${escapeHtml(person.name)}繳款時間">` : `<span class="subtle">-</span>`}</td>
      <td>${record?.status === "attending" ? `<div class="status-control payment" role="group" aria-label="${escapeHtml(person.name)}繳費狀態"><button type="button" data-set-payment="unpaid" data-activity-id="${activity.id}" data-person-id="${person.id}" aria-pressed="${!record.paid}">未繳</button><button type="button" data-set-payment="paid" data-activity-id="${activity.id}" data-person-id="${person.id}" aria-pressed="${record.paid}">已繳</button></div>` : `<span class="subtle">-</span>`}</td>
    </tr>
  `).join("") : `<tr><td colspan="6"><div class="empty">${state.people.length ? "沒有符合條件的人員。" : "請先在左側新增人員。"}</div></td></tr>`;
  requestAnimationFrame(() => syncScrollableList("activityPersonList", 8));
}

function renderCategories() {
  $("#incomeCategories").innerHTML = categoryCards(categories.income);
  $("#expenseCategories").innerHTML = categoryCards(categories.expense);
}

function renderTrash() {
  const now = Date.now();
  const items = [...state.trash].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  selectedTrashIds = new Set([...selectedTrashIds].filter((id) => items.some((item) => item.id === id)));
  const selectedCount = selectedTrashIds.size;
  $("#restoreSelectedTrash").disabled = !selectedCount;
  $("#purgeSelectedTrash").disabled = !selectedCount;
  $("#trashRows").innerHTML = items.length ? items.map((item) => {
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
  }).join("") : `<tr><td colspan="5"><div class="empty">垃圾桶目前是空的。</div></td></tr>`;
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

