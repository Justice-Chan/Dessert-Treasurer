// ---- People ----
// Adding or editing a person happens in a dialog; the list keeps the page.

function resetPersonForm() {
  $("#personForm").reset();
  $("#personId").value = "";
  $("#personFormTitle").textContent = "新增人員";
  $("#personDelete").hidden = true;
}

function openPersonDialog(person = null) {
  resetPersonForm();
  if (person) {
    $("#personId").value = person.id;
    $("#personFormTitle").textContent = "編輯人員";
    $("#personDelete").hidden = false;
    $("#personName").value = person.name;
    $("#personStudentId").value = person.studentId;
    $("#personDepartment").value = person.department;
    $("#personEmail").value = person.email || "";
  }
  $("#personDialog").hidden = false;
  $("#personName").focus();
}

function closePersonDialog() {
  $("#personDialog").hidden = true;
  resetPersonForm();
}

function selectPerson(person) {
  if (person) openPersonDialog(person);
}

function upsertPerson(event) {
  event.preventDefault();
  const id = $("#personId").value || uid();
  const person = {
    id,
    name: $("#personName").value.trim(),
    studentId: normalizeStudentId($("#personStudentId").value),
    department: $("#personDepartment").value.trim(),
    email: normalizeEmail($("#personEmail").value)
  };
  if (!person.name || !person.studentId) return toast("請填寫姓名與學號。");
  if (state.people.some((item) => item.id !== id && item.studentId.toLowerCase() === person.studentId.toLowerCase())) return toast("這個學號已經在人員名單中。");
  const index = state.people.findIndex((item) => item.id === id);
  if (index >= 0) state.people[index] = person;
  else state.people.push(person);
  $("#personSearch").value = "";
  if (!saveState()) return;
  closePersonDialog();
  toast("人員資料已儲存。");
}

function deletePerson(id) {
  const person = state.people.find((item) => item.id === id);
  if (!person) return;
  const relatedActivities = state.activities.filter((activity) => activity.attendance.some((item) => item.personId === id)).length;
  const note = relatedActivities ? `，並移除 ${relatedActivities} 個活動中的參加與繳費紀錄` : "";
  requestAppActionConfirmation({ title: "刪除人員", message: `確定刪除「${person.name}」${note}？此動作無法復原。`, confirmLabel: "確認刪除", action: () => {
    state.people = state.people.filter((item) => item.id !== id);
    state.activities.forEach((activity) => {
      activity.attendance = activity.attendance.filter((item) => item.personId !== id);
      activity.rosterOrder = (activity.rosterOrder || []).filter((personId) => personId !== id);
    });
    rosterSelection.delete(id);
    closePersonDialog();
    if (!saveState()) return;
    toast("人員已刪除。");
  }});
}

// ---- Activities ----
// A row opens the activity's roster below the list; adding, editing and deleting the activity
// itself happen in a dialog.

function resetActivityForm() {
  $("#activityForm").reset();
  $("#activityId").value = "";
  $("#activityFormTitle").textContent = "新增活動";
  $("#activityDelete").hidden = true;
  setDateValue("activityDate", today());
  $("#activityFee").value = "";
}

function openActivityDialog(activity = null) {
  resetActivityForm();
  if (activity) {
    $("#activityId").value = activity.id;
    $("#activityFormTitle").textContent = "編輯活動";
    $("#activityDelete").hidden = false;
    $("#activityName").value = activity.name;
    setDateValue("activityDate", activity.date);
    $("#activityFee").value = activity.fee || "";
    $("#activityNote").value = activity.note || "";
  }
  $("#activityDialog").hidden = false;
  $("#activityName").focus();
}

function closeActivityDialog() {
  $("#activityDialog").hidden = true;
  resetActivityForm();
}

function selectActivity(activity, initialFilter = "attending") {
  if (!activity) return;
  clearActivityImport();
  selectedActivityId = activity.id;
  rosterFilter = initialFilter;
  rosterSelection = new Set();
  $("#activityPersonSearch").value = "";
  renderPeople();
}

function upsertActivity(event) {
  event.preventDefault();
  const id = $("#activityId").value || uid();
  const name = $("#activityName").value.trim();
  const date = $("#activityDate").value;
  // Left empty, the activity is free.
  const fee = $("#activityFee").value === "" ? 0 : Number($("#activityFee").value);
  if (!name || !isValidDateValue(date) || !Number.isInteger(fee) || fee < 0) return toast("請填寫活動名稱、日期與有效應繳金額。");
  const existing = state.activities.find((item) => item.id === id);
  const activity = { id, name, date, fee, note: $("#activityNote").value.trim(), attendance: existing?.attendance || [], rosterOrder: existing?.rosterOrder || [], importLink: existing?.importLink || null };
  const index = state.activities.findIndex((item) => item.id === id);
  if (index >= 0) state.activities[index] = activity;
  else state.activities.push(activity);
  $("#activitySearch").value = "";
  if (!saveState()) return;
  closeActivityDialog();
  if (existing) renderPeople();
  else selectActivity(activity, "not_attending");
  toast(existing ? "活動已更新。" : "活動已建立，可以開始登記參加人員。");
}

function deleteActivity(id) {
  const activity = state.activities.find((item) => item.id === id);
  if (!activity) return;
  requestAppActionConfirmation({ title: "刪除活動", message: `確定刪除「${activity.name}」及其中所有參加、繳費紀錄？此動作無法復原。`, confirmLabel: "確認刪除", action: () => {
    state.activities = state.activities.filter((item) => item.id !== id);
    if (selectedActivityId === id) selectedActivityId = "";
    closeActivityDialog();
    if (!saveState()) return;
    toast("活動已刪除。");
  }});
}

function setActivityAttendance(activityId, personId, status) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity || !state.people.some((person) => person.id === personId) || !["attending", "not_attending"].includes(status)) return;
  const record = activityRecord(activity, personId);
  if (record) {
    record.status = status;
    record.paid = status === "attending" ? Boolean(record.paid) : false;
    record.paidAt = status === "attending" && record.paid ? normalizePaymentTime(record.paidAt) : "";
  } else {
    activity.attendance.push({ personId, status, paid: false, paidAt: "", transferLastFive: "" });
  }
  if (!saveState()) return;
  toast(status === "attending" ? "已登記參加，預設為未繳。" : "已登記未參加。");
}

function setActivityPayment(activityId, personId, paid) {
  const activity = state.activities.find((item) => item.id === activityId);
  const record = activityRecord(activity, personId);
  if (!record || record.status !== "attending") return;
  if (record.paid === paid) return;
  record.paid = paid;
  record.paidAt = paid ? normalizePaymentTime(record.paidAt) || paymentTimeNow() : "";
  if (!saveState()) return;
  // Unpaid people sort first, so the next person to follow up is back at the top.
  requestAnimationFrame(() => { $("#activityPersonList").scrollTop = 0; });
  toast(paid ? "已標記為已繳。" : "已標記為未繳。");
}

function setActivityTransferLastFive(activityId, personId, value) {
  const activity = state.activities.find((item) => item.id === activityId);
  const record = activityRecord(activity, personId);
  if (!record || record.status !== "attending") return;
  const normalized = normalizeTransferLastFive(value);
  if (normalized && normalized === record.transferLastFive) return;
  if (value && !normalized) {
    renderPeople();
    return toast("匯款後五碼請輸入完整的五位數字。", "error");
  }
  record.transferLastFive = normalized;
  // Five digits mean the transfer arrived, so the person is marked paid as well.
  const markedPaid = Boolean(normalized) && !record.paid;
  if (markedPaid) {
    record.paid = true;
    record.paidAt = paymentTimeNow();
  }
  if (!saveState()) return;
  toast(markedPaid ? "已記錄後五碼並標為已繳。" : "匯款後五碼已更新。");
}

function paymentTimeNow() {
  const now = new Date();
  return `${dateKey(now).slice(5)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// Marks every ticked person at once: paid, unpaid, or attending (with payment left as it was).
function batchUpdateRoster(change) {
  const activity = state.activities.find((item) => item.id === selectedActivityId);
  if (!activity || !rosterSelection.size) return;
  let changed = 0;
  rosterSelection.forEach((personId) => {
    let record = activityRecord(activity, personId);
    if (change === "attending") {
      if (record?.status === "attending") return;
      if (record) Object.assign(record, { status: "attending" });
      else activity.attendance.push({ personId, status: "attending", paid: false, paidAt: "", transferLastFive: "" });
      changed += 1;
      return;
    }
    if (record?.status !== "attending" || record.paid === (change === "paid")) return;
    record.paid = change === "paid";
    record.paidAt = record.paid ? normalizePaymentTime(record.paidAt) || paymentTimeNow() : "";
    changed += 1;
  });
  rosterSelection = new Set();
  if (!changed) {
    renderPeople();
    return toast(change === "attending" ? "選取的人都已經是參加。" : "選取的人沒有需要變更的參加者。");
  }
  if (!saveState()) return;
  toast(`已將 ${changed} 人${change === "paid" ? "標為已繳" : change === "unpaid" ? "標為未繳" : "登記為參加"}。`);
}

function exportActivityUnpaid() {
  const activity = state.activities.find((item) => item.id === selectedActivityId);
  if (!activity) return toast("請先選擇活動。");
  const unpaid = activityUnpaidPeople(activity);
  if (!unpaid.length) return toast("這個活動目前沒有未繳人員。");
  const rows = [
    ["活動名稱", "活動日期", "姓名", "學號", "系別", "電子郵件", "應繳金額", "備註"],
    ...unpaid.map(({ person }) => [activity.name, activity.date, person.name, person.studentId, person.department, person.email || "", activity.fee, activity.note || ""])
  ];
  exportWithMessage(`甜點社-${activity.name}-未繳名單-${activity.date}.csv`, "\ufeff" + csv(rows), "text/csv;charset=utf-8", `未繳名單（${unpaid.length} 人）`);
}
