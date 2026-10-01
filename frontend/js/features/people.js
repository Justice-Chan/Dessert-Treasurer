function resetPersonForm() {
  $("#personForm").reset();
  $("#personId").value = "";
  $("#personFormTitle").textContent = "新增人員";
  $("#personSubmit").textContent = "儲存人員";
  $("#personCancel").hidden = true;
  $("#personDelete").hidden = true;
}

function selectPerson(person) {
  if (!person) return;
  $("#personId").value = person.id;
  $("#personFormTitle").textContent = "編輯人員";
  $("#personSubmit").textContent = "更新人員";
  $("#personCancel").hidden = false;
  $("#personDelete").hidden = false;
  $("#personName").value = person.name;
  $("#personStudentId").value = person.studentId;
  $("#personDepartment").value = person.department;
  $("#personEmail").value = person.email || "";
  renderPeople();
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
  selectPerson(person);
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
    if ($("#personId").value === id) resetPersonForm();
    if (!saveState()) return;
    toast("人員已刪除。");
  }});
}

function resetActivityForm() {
  $("#activityForm").reset();
  $("#activityId").value = "";
  clearActivityImport();
  $("#activityFormTitle").textContent = "新增活動";
  $("#activitySubmit").textContent = "儲存活動";
  $("#activityCancel").hidden = true;
  setDateValue("activityDate", today());
  $("#activityFee").value = "0";
  $("#activityPersonSearch").value = "";
  $("#activityPersonFilter").value = "attending";
}

function selectActivity(activity, initialFilter = "attending") {
  if (!activity) return;
  clearActivityImport();
  $("#activityId").value = activity.id;
  $("#activityFormTitle").textContent = "編輯活動";
  $("#activitySubmit").textContent = "更新活動";
  $("#activityCancel").hidden = false;
  $("#activityName").value = activity.name;
  setDateValue("activityDate", activity.date);
  $("#activityFee").value = activity.fee;
  $("#activityNote").value = activity.note || "";
  $("#activityPersonSearch").value = "";
  $("#activityPersonFilter").value = initialFilter;
  renderPeople();
}

function upsertActivity(event) {
  event.preventDefault();
  const id = $("#activityId").value || uid();
  const name = $("#activityName").value.trim();
  const date = $("#activityDate").value;
  const fee = Number($("#activityFee").value);
  if (!name || !isValidDateValue(date) || !Number.isFinite(fee) || fee < 0) return toast("請填寫活動名稱、日期與有效應繳金額。");
  const existing = state.activities.find((item) => item.id === id);
  const activity = { id, name, date, fee, note: $("#activityNote").value.trim(), attendance: existing?.attendance || [], rosterOrder: existing?.rosterOrder || [], importLink: existing?.importLink || null };
  const index = state.activities.findIndex((item) => item.id === id);
  if (index >= 0) state.activities[index] = activity;
  else state.activities.push(activity);
  $("#activitySearch").value = "";
  if (!saveState()) return;
  selectActivity(activity, existing ? "attending" : "not_attending");
  toast("活動已儲存，可以開始登記人員狀態。");
}

function deleteActivity(id) {
  const activity = state.activities.find((item) => item.id === id);
  if (!activity) return;
  requestAppActionConfirmation({ title: "刪除活動", message: `確定刪除「${activity.name}」及其中所有參加、繳費紀錄？此動作無法復原。`, confirmLabel: "確認刪除", action: () => {
    state.activities = state.activities.filter((item) => item.id !== id);
    if ($("#activityId").value === id) resetActivityForm();
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
    activity.attendance.push({ personId, status, paid: false, paidAt: "" });
  }
  if (!saveState()) return;
  toast(status === "attending" ? "已登記參加，預設為未繳。" : "已登記未參加。");
}

function setActivityPayment(activityId, personId, paid) {
  const activity = state.activities.find((item) => item.id === activityId);
  const record = activityRecord(activity, personId);
  if (!record || record.status !== "attending") return;
  record.paid = paid;
  record.paidAt = paid ? normalizePaymentTime(record.paidAt) : "";
  if (!saveState()) return;
  toast(paid ? "已標記為已繳。" : "已標記為未繳。");
}

function setActivityPaymentTime(activityId, personId, paidAt) {
  const activity = state.activities.find((item) => item.id === activityId);
  const record = activityRecord(activity, personId);
  const normalized = normalizePaymentTime(paidAt);
  if (!record || record.status !== "attending" || !record.paid) return;
  if (paidAt && !normalized) return toast("繳款時間請輸入 MM-DD HH:mm，例如 09-20 14:35。");
  record.paidAt = normalized;
  if (!saveState()) return;
  renderPeople();
  toast("繳款時間已更新。");
}

function exportActivityUnpaid() {
  const activity = state.activities.find((item) => item.id === $("#activityId").value);
  if (!activity) return toast("請先選擇活動。");
  const unpaid = activityUnpaidPeople(activity);
  if (!unpaid.length) return toast("這個活動目前沒有未繳人員。");
  const rows = [
    ["活動名稱", "活動日期", "姓名", "學號", "系別", "電子郵件", "應繳金額", "備註"],
    ...unpaid.map(({ person }) => [activity.name, activity.date, person.name, person.studentId, person.department, person.email || "", activity.fee, activity.note || ""])
  ];
  download(`甜點社-${activity.name}-未繳名單-${activity.date}.csv`, "\ufeff" + csv(rows), "text/csv;charset=utf-8");
  toast(`未繳名單已開始下載，共 ${unpaid.length} 人。`);
}

