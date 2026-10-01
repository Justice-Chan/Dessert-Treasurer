function seedData() {
  if (state.entries.length || state.claims.length || state.people.length || state.activities.length) {
    requestAppActionConfirmation({
      title: "載入範例",
      message: "範例資料會加入目前資料中，不會清除既有紀錄。",
      confirmLabel: "確認載入",
      action: insertSeedData
    });
    return;
  }
  insertSeedData();
}

function insertSeedData() {
  state.entries.push(
    { id: uid(), date: today().slice(0, 8) + "02", type: "income", title: "期初社費", parent: "社費與會費", child: "期初社費", amount: 12000, method: "轉帳", accountId: "club-bank", note: "第一批社員" },
    { id: uid(), date: today().slice(0, 8) + "06", type: "expense", title: "布朗尼試做材料", parent: "食材與耗材", child: "糖與巧克力", amount: 1380, method: "代墊待報銷", accountId: "club-bank", note: "迎新菜單測試" },
    { id: uid(), date: today().slice(0, 8) + "09", type: "expense", title: "六吋蛋糕盒", parent: "食材與耗材", child: "包材", amount: 720, method: "現金", accountId: "cash", note: "市集備品" }
  );
  state.claims.push(
    { id: uid(), date: today(), person: "小林", title: "迎新試做材料代墊", parent: "食材與耗材", child: "乳品", amount: 640, status: "pending", receipt: "紙本收據 A-03", attachments: [], note: "待社長確認" }
  );
  if (!state.people.length) {
    const demoPeople = [
      { id: uid(), name: "小林", studentId: "B12345671", department: "食品科學系", email: "" },
      { id: uid(), name: "陳小美", studentId: "B12345672", department: "企業管理系", email: "" },
      { id: uid(), name: "王大安", studentId: "B12345673", department: "資訊工程系", email: "" },
      { id: uid(), name: "李佳穎", studentId: "B12345674", department: "外國語文系", email: "" }
    ];
    state.people.push(...demoPeople);
    state.activities.push(
      { id: uid(), name: "迎新甜點實作", date: today(), fee: 200, note: "含材料費", attendance: [
        { personId: demoPeople[0].id, status: "attending", paid: false },
        { personId: demoPeople[1].id, status: "attending", paid: true },
        { personId: demoPeople[2].id, status: "not_attending", paid: false }
      ] },
      { id: uid(), name: "布朗尼試作", date: today().slice(0, 8) + "06", fee: 120, note: "幹部試作", attendance: [
        { personId: demoPeople[0].id, status: "attending", paid: false },
        { personId: demoPeople[2].id, status: "attending", paid: true }
      ] }
    );
  }
  if (!saveState()) return;
  toast("範例資料已載入。");
}

function moveToTrash(kind, id) {
  const collection = kind === "entry" ? state.entries : state.claims;
  const record = collection.find((item) => item.id === id);
  if (!record) return;
  if (kind === "entry" && record.claimId) return toast("這筆支出由報銷付款產生，請至報銷頁管理。");
  const linkedEntry = kind === "claim" ? state.entries.find((entry) => entry.claimId === record.id) : null;
  const locked = kind === "entry" ? affectsLockedBalance(record.date) : isMonthLocked(record.date);
  if (locked || (linkedEntry && affectsLockedBalance(linkedEntry.date))) return toast("這筆資料會影響已鎖定月份，請先到「對帳」解鎖。");
  state.trash.push({ id: uid(), kind, deletedAt: new Date().toISOString(), record, ...(linkedEntry ? { linkedEntry } : {}) });
  if (kind === "entry") state.entries = state.entries.filter((item) => item.id !== id);
  else {
    state.claims = state.claims.filter((item) => item.id !== id);
    state.entries = state.entries.filter((entry) => entry.claimId !== id);
  }
  if (!saveState()) return;
  toast(`${kind === "entry" ? "收支紀錄" : "報銷申請"}已移至垃圾桶。`);
}

function restoreTrash(id) {
  restoreTrashItems([id]);
}

function restoreTrashItems(ids) {
  const wanted = new Set(ids);
  const items = state.trash
    .filter((item) => wanted.has(item.id))
    .sort((a, b) => (a.kind === "claim" ? -1 : 1) - (b.kind === "claim" ? -1 : 1));
  let restored = 0;
  let skipped = 0;

  items.forEach((item) => {
    const target = item.kind === "entry" ? state.entries : state.claims;
    const record = { ...item.record };
    const locked = item.kind === "entry" ? affectsLockedBalance(record.date) : isMonthLocked(record.date);
    if (locked || (item.linkedEntry && affectsLockedBalance(item.linkedEntry.date))) {
      skipped += 1;
      return;
    }
    if (item.kind === "entry" && record.claimId && !state.claims.some((claim) => claim.id === record.claimId)) {
      skipped += 1;
      return;
    }
    if (target.some((existing) => existing.id === record.id)) record.id = uid();
    target.push(record);
    if (item.kind === "claim" && item.linkedEntry) {
      const linkedEntry = { ...item.linkedEntry, claimId: record.id };
      if (state.entries.some((entry) => entry.id === linkedEntry.id)) linkedEntry.id = uid();
      state.entries.push(linkedEntry);
    }
    state.trash = state.trash.filter((trashItem) => trashItem.id !== item.id);
    restored += 1;
  });

  if (!restored) return toast("沒有可還原的項目；已鎖定月份需先到「對帳」解鎖。");
  selectedTrashIds.clear();
  if (!saveState()) return;
  toast(skipped ? `已還原 ${restored} 筆；${skipped} 筆因已鎖定或相依資料而保留。` : `已還原 ${restored} 筆項目。`);
}

async function permanentlyDeleteTrashItems(ids) {
  const wanted = new Set(ids);
  const items = state.trash.filter((item) => wanted.has(item.id));
  if (!items.length) return toast("找不到選取的垃圾桶資料。");
  state.trash = state.trash.filter((item) => !wanted.has(item.id));
  selectedTrashIds.clear();
  if (!saveState()) return;
  const claimIds = items.filter((item) => item.kind === "claim").map((item) => item.record?.id).filter(Boolean);
  if (claimIds.length) {
    try {
      await deleteReceiptsForClaims(claimIds);
    } catch {
      toast("項目已刪除，但附件清理失敗；不影響帳務資料。");
      return;
    }
  }
  toast(`已永久刪除 ${items.length} 筆項目。`);
}

function scheduleTrashPurge() {
  clearTimeout(trashPurgeTimer);
  const nextExpiry = Math.min(...state.trash
    .map((item) => new Date(item.deletedAt).getTime() + retentionDays * dayMs)
    .filter(Number.isFinite));
  if (!Number.isFinite(nextExpiry)) return;
  const delay = Math.max(1000, nextExpiry - Date.now() + 1000);
  trashPurgeTimer = setTimeout(() => {
    purgeExpiredTrash();
    render();
  }, Math.min(delay, 2147483647));
}

