// The new and edit claim form: categories, activities, receipts, date picker and saving.

// ---- New claim ----

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function setOptions(select, values) {
  select.replaceChildren(...values.map((value) => new Option(value, value)));
}

// The claim form lists expense categories; the ledger's entry form lists those of its type.
const categoryTree = (form) => (form === "entry" ? entryCategories() : categories);

function fillParentOptions(form = "claim") {
  setOptions($(`#${form}Parent`), [...Object.keys(categoryTree(form)), otherCategory]);
  fillChildOptions(form);
}

// Same rule as the desktop app, except 其他 turns the dropdown itself into a text field.
function fillChildOptions(form = "claim") {
  const parent = $(`#${form}Parent`).value;
  setOptions($(`#${form}Child`), parent === otherCategory ? [otherCategory] : [...(categoryTree(form)[parent] || []), otherCategory]);
  showOtherFields();
}

// Pickers whose last option swaps the dropdown for a text field: the value of that option,
// and how long the typed name may be.
const pickers = {
  claimParent: { custom: otherCategory, maxLength: () => limits.category },
  claimChild: { custom: otherCategory, maxLength: () => limits.category },
  claimActivity: { custom: "new", maxLength: () => 60 },
  entryParent: { custom: otherCategory, maxLength: () => limits.category },
  entryChild: { custom: otherCategory, maxLength: () => limits.category }
};

function showOtherFields(focusId) {
  Object.entries(pickers).forEach(([id, picker]) => {
    const custom = $(`#${id}`).value === picker.custom;
    const input = $(`#${id}Other`);
    $(`#${id}`).hidden = custom;
    input.hidden = !custom;
    input.maxLength = picker.maxLength();
    // A list holding only the custom option has nothing to go back to.
    $(`[data-picker="${id}"]`).hidden = !custom || $(`#${id}`).options.length < 2;
    if (!custom) input.value = "";
    else if (id === focusId) input.focus();
  });
  showActivityHint();
}

// ---- Activities ----
// The month's activity folders come from the backend; picking one files the receipts there.

let activityNames = new Set();

// When editing, the list is the claim's own month and starts on its current activity; an activity
// no longer in that list stays selectable as "keep".
let activityAtStart = "";

async function loadActivities(month = "", current = "") {
  const select = $("#claimActivity");
  select.replaceChildren(new Option("載入中…", ""));
  select.disabled = true;
  let activities = [];
  try {
    activities = await callBackend("listActivities", month ? { month } : {});
  } catch (error) {
    showMessage("讀不到活動清單，可以直接輸入活動名稱。", true);
  }
  activityNames = new Set(activities.map((activity) => activity.name));
  const options = activities.map((activity) => new Option(activity.label, activity.id));
  const match = activities.find((activity) => activity.label === current);
  if (current && !match) options.unshift(new Option(current, "keep"));
  select.replaceChildren(...options, new Option("其他（新活動）", pickers.claimActivity.custom));
  select.value = current ? (match ? match.id : "keep") : select.options[0].value;
  activityAtStart = current ? select.value : "";
  select.disabled = false;
  showOtherFields();
}

function chosenActivity() {
  const select = $("#claimActivity");
  if (select.value === pickers.claimActivity.custom) return { activityName: $("#claimActivityOther").value.trim() };
  if (editingClaim && select.value === activityAtStart) return {};
  return { activityId: select.value };
}

function showActivityHint() {
  const typed = $("#claimActivityOther").hidden ? "" : $("#claimActivityOther").value.trim();
  const hint = $("#activityHint");
  hint.hidden = !activityNames.has(typed);
  hint.textContent = `本月已有「${typed}」。送出會建立新的一堂；同一堂請改從選單選。`;
}

function leaveCustomCategory(id) {
  $(`#${id}`).selectedIndex = 0;
  if (id === "claimActivity") {
    showOtherFields();
    return $(`#${id}`).focus();
  }
  if (id.endsWith("Parent")) fillChildOptions(id.replace(/Parent$/, ""));
  else showOtherFields();
  $(`#${id}`).focus();
}

function categoryValue(select, input) {
  return $(select).value === otherCategory ? $(input).value.trim() : $(select).value;
}

// The claim being edited, or null when the form makes a new one.
let editingClaim = null;

function setFormMode(claim) {
  editingClaim = claim;
  const fixedAmount = Boolean(claim) && claim.editable !== "full";
  $("#claimFormTitle").textContent = claim ? "修改報帳" : "新增報帳";
  $("#claimSubmit").textContent = claim ? "儲存修改" : "送出";
  $("#editNote").hidden = !claim;
  const note = fixedAmount ? "這筆申請已付款，金額不能修改。" : claim?.status === "退回" || claim?.status === "已核准" ? "儲存後會重新送審。" : "";
  $("#editNote").textContent = note;
  $("#editNote").hidden = !note;
  $("#claimAmount").disabled = fixedAmount;
}

function openClaimForm() {
  $("#claimForm").reset();
  selectedFiles = [];
  setFormMode(null);
  fillParentOptions();
  setDateField("claim", localToday());
  closeCalendar();
  showSelectedFiles();
  showMessage("");
  show("claimForm");
  loadActivities();
}

// Picks a list value, or 其他 with the text filled in when the value is not in the list.
function setCategory(id, value) {
  const listed = [...$(`#${id}`).options].some((option) => option.value === value);
  $(`#${id}`).value = listed ? value : otherCategory;
  $(`#${id}Other`).value = listed ? "" : value;
}

// Saved receipts join the file list as entries with existingIndex; removing one drops it on save.
async function loadSavedReceipts(claim) {
  showSelectedFiles();
  if (!claim.attachmentCount) return;
  $("#claimFilesHint").textContent = "載入收據中…";
  const results = await Promise.all(fetchAllAttachments(claim));
  const saved = results.map(({ file, error }, index) => {
    if (!error) return { ...file, size: file.blob.size, lastModified: -1 - index, existingIndex: index };
    showMessage(`收據 ${index + 1} 載入失敗；儲存時會保留原檔。`, true);
    return { name: `收據 ${index + 1}`, type: "", size: 0, lastModified: -1 - index, existingIndex: index, blob: new Blob() };
  });
  if (editingClaim !== claim) return;
  selectedFiles = [...saved, ...selectedFiles];
  showSelectedFiles();
}

function openEditForm(claim) {
  $("#claimForm").reset();
  selectedFiles = [];
  fillParentOptions();
  setCategory("claimParent", claim.parent);
  fillChildOptions();
  setCategory("claimChild", claim.child);
  showOtherFields();
  setCategory("claimParent", claim.parent);
  setCategory("claimChild", claim.child);
  setDateField("claim", claim.date);
  closeCalendar();
  $("#claimAmount").value = claim.amount;
  $("#claimVendor").value = claim.vendor;
  $("#claimDescription").value = claim.description;
  setFormMode(claim);
  showMessage("");
  show("claimForm");
  loadActivities(claim.month, claim.activity);
  loadSavedReceipts(claim);
  // Editing belongs to My claims, so the drawer and top bar say so.
  document.querySelectorAll("#drawer [data-nav]").forEach((button) => {
    if (button.dataset.nav === "myClaims") button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#viewLabel").textContent = "Edit claim";
}

// ---- Receipt files ----
// Picked files are kept here rather than in the file input, so each can be removed on its own
// and later picks add to the list instead of replacing it.

let selectedFiles = [];
let fileUrls = [];

function addFiles(files) {
  const known = new Set(selectedFiles.map((file) => `${file.name}|${file.size}|${file.lastModified}`));
  const fresh = Array.from(files).filter((file) => !known.has(`${file.name}|${file.size}|${file.lastModified}`));
  const room = limits.files - selectedFiles.length;
  if (fresh.length > room) showMessage(`一次最多上傳 ${limits.files} 個附件。`, true);
  selectedFiles = [...selectedFiles, ...fresh.slice(0, Math.max(room, 0))];
  showSelectedFiles();
}

// A plain page outline; static markup, no user data.
const fileIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

// Photos and PDFs open in a layer over the page with a close button.
function openFilePreview(url, type = "image/jpeg") {
  const photo = isPhoto(type) || !type;
  $("#filePreviewImage").hidden = !photo;
  $("#filePreviewFrame").hidden = photo;
  if (photo) $("#filePreviewImage").src = url;
  else $("#filePreviewFrame").src = url;
  $("#filePreview").classList.toggle("document", !photo);
  $("#filePreview").showModal();
}

function removeFile(index) {
  selectedFiles = selectedFiles.filter((_, position) => position !== index);
  showSelectedFiles();
}

function showSelectedFiles() {
  fileUrls.forEach((url) => URL.revokeObjectURL(url));
  fileUrls = [];
  const megabytes = Math.round(limits.fileBytes / 1024 / 1024);
  // At the limit the upload area greys out and stops taking files, instead of refusing after a pick.
  const full = selectedFiles.length >= limits.files;
  $("#claimDropzone").classList.toggle("full", full);
  $("#claimFiles").disabled = full;
  $("#claimDropzoneTitle").textContent = full ? `已達 ${limits.files} 個上限` : "拍照或選擇檔案";
  $("#claimFilesHint").textContent = full
    ? "移除其中一個才能再加"
    : selectedFiles.length
      ? `已選 ${selectedFiles.length} / ${limits.files} 個`
      : `JPG、PNG、HEIC 或 PDF，最多 ${limits.files} 個，每個 ${megabytes} MB 內`;
  $("#claimFileList").replaceChildren(...selectedFiles.map((file, index) => {
    const item = element("li");
    const url = URL.createObjectURL(file.blob || file);
    fileUrls.push(url);
    // The thumbnail opens a larger view over the page.
    const preview = element("button", "file-thumb");
    preview.type = "button";
    preview.setAttribute("aria-label", `預覽 ${file.name}`);
    if (isPhoto(file.type)) {
      const image = element("img");
      image.src = url;
      image.alt = "";
      preview.append(image);
      preview.addEventListener("click", () => openFilePreview(url, file.type));
    } else {
      preview.classList.add("file-icon");
      preview.innerHTML = fileIcon;
      preview.append(element("span", "", file.type === "application/pdf" ? "PDF" : "HEIC"));
      preview.addEventListener("click", () => openFilePreview(url, file.type));
    }
    const remove = element("button", "file-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `移除 ${file.name}`);
    remove.addEventListener("click", () => removeFile(index));
    const name = element("span", "file-name", file.name);
    name.title = file.name;
    item.append(preview, name, remove);
    return item;
  }));
}

// ---- Date picker ----
// A small calendar drawn with the page's own colours; the browser's picker ignores the theme.
// One calendar serves every date field (claim, entry, pay): each is a hidden #<name>Date input
// with a #<name>DateButton, and the calendar moves next to the field it opens for.

const earliestClaimDate = "2020-01-01";
let calendarMonth = "";
// "days" shows one month; "months" shows the twelve months of calendarMonth's year.
let calendarView = "days";
let calendarTarget = "claim";
const dateInput = () => $(`#${calendarTarget}Date`);
const dateButton = () => $(`#${calendarTarget}DateButton`);

function setDateField(name, value) {
  $(`#${name}Date`).value = value;
  $(`#${name}DateButton`).textContent = value.replaceAll("-", "/");
}

function shiftMonth(month, delta) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function renderCalendar() {
  const [year, number] = calendarMonth.split("-").map(Number);
  const today = localToday();
  const months = calendarView === "months";
  $("#calendarDays").hidden = months;
  $(".calendar-weekdays").hidden = months;
  $("#calendarMonths").hidden = !months;
  $("#calendarMonth").setAttribute("aria-label", months ? "回到日期" : "選擇月份");
  if (months) {
    $("#calendarMonth").textContent = `${year} 年`;
    $("#calendarPrev").setAttribute("aria-label", "上一年");
    $("#calendarNext").setAttribute("aria-label", "下一年");
    $("#calendarPrev").disabled = year - 1 < Number(earliestClaimDate.slice(0, 4));
    $("#calendarNext").disabled = year + 1 > Number(today.slice(0, 4));
    $("#calendarMonths").replaceChildren(...Array.from({ length: 12 }, (_, index) => {
      const value = `${year}-${String(index + 1).padStart(2, "0")}`;
      const button = element("button", "", `${index + 1} 月`);
      button.type = "button";
      button.dataset.month = value;
      button.disabled = value > today.slice(0, 7) || value < earliestClaimDate.slice(0, 7);
      if (value === (dateInput().value || today).slice(0, 7)) button.setAttribute("aria-pressed", "true");
      return button;
    }));
    return;
  }
  $("#calendarPrev").setAttribute("aria-label", "上個月");
  $("#calendarNext").setAttribute("aria-label", "下個月");
  const firstWeekday = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, number, 0)).getUTCDate();
  $("#calendarMonth").textContent = `${year} 年 ${number} 月`;
  $("#calendarPrev").disabled = shiftMonth(calendarMonth, -1) < earliestClaimDate.slice(0, 7);
  $("#calendarNext").disabled = shiftMonth(calendarMonth, 1) > today.slice(0, 7);
  const cells = Array.from({ length: firstWeekday }, () => element("span"));
  for (let day = 1; day <= dayCount; day += 1) {
    const value = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const button = element("button", "calendar-day", String(day));
    button.type = "button";
    button.dataset.date = value;
    button.disabled = value > today || value < earliestClaimDate;
    if (value === today) button.classList.add("today");
    if (value === dateInput().value) button.setAttribute("aria-pressed", "true");
    cells.push(button);
  }
  $("#calendarDays").replaceChildren(...cells);
}

function openCalendar(name) {
  closeCalendar();
  calendarTarget = name;
  dateButton().after($("#calendar"));
  $("#calendar").setAttribute("aria-label", `選擇${dateButton().dataset.label || "日期"}`);
  calendarMonth = (dateInput().value || localToday()).slice(0, 7);
  calendarView = "days";
  renderCalendar();
  $("#calendar").hidden = false;
  dateButton().setAttribute("aria-expanded", "true");
  ($("#calendarDays [aria-pressed='true']") || $("#calendarDays button:not(:disabled)"))?.focus();
}

function closeCalendar(returnFocus) {
  if ($("#calendar").hidden) return;
  $("#calendar").hidden = true;
  dateButton().setAttribute("aria-expanded", "false");
  if (returnFocus) dateButton().focus();
}

function pickDate(value) {
  setDateField(calendarTarget, value);
  closeCalendar(true);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Photos are redrawn as JPEG with the long side capped, which keeps uploads small and
// drops location metadata. Files the browser cannot decode are sent unchanged.
async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    return file;
  }
  const scale = Math.min(1, imageLongSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  return blob || file;
}

async function prepareAttachment(file) {
  const blob = file.type.startsWith("image/") ? await shrinkImage(file) : file;
  if (blob.size > limits.fileBytes) throw new Error(`「${file.name}」太大，請壓縮後再上傳。`);
  return { type: blob.type, data: await blobToBase64(blob) };
}

async function submitClaim(event) {
  event.preventDefault();
  const files = selectedFiles;
  const amount = Number($("#claimAmount").value);
  if (!$("#claimDate").value) return showMessage("請填寫消費日期。", true);
  if (!Number.isInteger(amount) || amount < 1) return showMessage("金額請填正整數。", true);
  const parent = categoryValue("#claimParent", "#claimParentOther");
  const child = categoryValue("#claimChild", "#claimChildOther");
  if (!parent || !child || parent === otherCategory || child === otherCategory) return showMessage("請選擇主項目與副項目；選「其他」時請填寫名稱。", true);
  const activity = chosenActivity();
  const activityMissing = $("#claimActivity").value === pickers.claimActivity.custom ? !activity.activityName : !$("#claimActivity").value;
  if (activityMissing) return showMessage("請選擇活動／社課；新活動請填寫名稱。", true);
  if (editingClaim) return saveEdit({ date: $("#claimDate").value, amount, parent, child, ...activity });
  if (files.length > limits.files) return showMessage(`一次最多上傳 ${limits.files} 個附件。`, true);

  const button = $("#claimSubmit");
  button.disabled = true;
  button.textContent = "送出中…";
  showMessage("正在上傳，請不要關閉頁面。", false, true);
  try {
    await callBackend("submitRequest", {
      date: $("#claimDate").value,
      amount,
      parent,
      child,
      ...activity,
      vendor: $("#claimVendor").value,
      description: $("#claimDescription").value,
      attachments: await Promise.all(files.map(prepareAttachment))
    });
    show("myClaims");
    showMessage("報帳已送出，等待總務審核。");
    await loadMyClaims();
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = "送出";
  }
}

async function saveEdit(fields) {
  const button = $("#claimSubmit");
  button.disabled = true;
  button.textContent = "儲存中…";
  showMessage("正在儲存，請不要關閉頁面。", false, true);
  try {
    const fresh = selectedFiles.filter((file) => file.existingIndex === undefined);
    await callBackend("editRequest", {
      id: editingClaim.id,
      ...fields,
      vendor: $("#claimVendor").value,
      description: $("#claimDescription").value,
      keep: selectedFiles.filter((file) => file.existingIndex !== undefined).map((file) => file.existingIndex),
      attachments: await Promise.all(fresh.map(prepareAttachment))
    });
    setFormMode(null);
    show("myClaims");
    showMessage("已儲存修改。");
    await loadMyClaims();
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = editingClaim ? "儲存修改" : "送出";
  }
}
