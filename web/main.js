// Event wiring and start-up; loaded last, after every function it uses.

$("#signOut").addEventListener("click", signOut);
$("#themeToggle").addEventListener("click", toggleTheme);
systemDark.addEventListener("change", () => applyTheme());
$("#menuButton").addEventListener("click", () => setDrawer(true));
$("#scrim").addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setDrawer(false); });
document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
$("#reviewStatus").addEventListener("change", openReview);
$("#reviewPosition").addEventListener("change", renderReview);
$("#detailBack").addEventListener("click", openReview);
$("#applyStatus").addEventListener("click", reviewClaim);
$("#reviewNextStatus").addEventListener("change", showStatusHint);
$("#claimParent").addEventListener("change", () => fillChildOptions("claim"));
$("#claimParent").addEventListener("change", () => showOtherFields("claimParent"));
$("#claimChild").addEventListener("change", () => showOtherFields("claimChild"));
$("#claimActivity").addEventListener("change", () => showOtherFields("claimActivity"));
$("#claimActivityOther").addEventListener("input", showActivityHint);
document.querySelectorAll("[data-picker]").forEach((button) => button.addEventListener("click", () => leaveCustomCategory(button.dataset.picker)));
document.querySelectorAll(".date-button").forEach((button) => button.addEventListener("click", () => {
  const name = button.id.replace(/DateButton$/, "");
  if ($("#calendar").hidden || calendarTarget !== name) openCalendar(name);
  else closeCalendar(true);
}));
// A year step can land past today; clamp to the newest month that may be picked.
function stepCalendar(direction) {
  const step = calendarView === "months" ? 12 : 1;
  calendarMonth = shiftMonth(calendarMonth, direction * step);
  if (calendarMonth > localToday().slice(0, 7)) calendarMonth = localToday().slice(0, 7);
  renderCalendar();
}

$("#calendarPrev").addEventListener("click", () => stepCalendar(-1));
$("#calendarNext").addEventListener("click", () => stepCalendar(1));
$("#calendarMonth").addEventListener("click", () => {
  calendarView = calendarView === "days" ? "months" : "days";
  renderCalendar();
});
$("#calendarMonths").addEventListener("click", (event) => {
  const month = event.target.closest("[data-month]");
  if (!month || month.disabled) return;
  calendarMonth = month.dataset.month;
  calendarView = "days";
  renderCalendar();
});
$("#calendarToday").addEventListener("click", () => pickDate(localToday()));
$("#calendarDays").addEventListener("click", (event) => {
  const day = event.target.closest("[data-date]");
  if (day && !day.disabled) pickDate(day.dataset.date);
});
$("#calendar").addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.stopPropagation(); closeCalendar(true); }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".date-field")) closeCalendar();
});
$("#claimFiles").addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});
// On a computer, files can also be dropped onto the upload area.
$("#claimDropzone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("#claimDropzone").classList.add("dragging");
});
$("#claimDropzone").addEventListener("dragleave", () => $("#claimDropzone").classList.remove("dragging"));
$("#claimDropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("#claimDropzone").classList.remove("dragging");
  addFiles(event.dataTransfer.files);
});
// Cancel clears the form and stays on it.
$("#claimCancel").addEventListener("click", () => (editingClaim ? (setFormMode(null), navigate("myClaims")) : openClaimForm()));
$("#filePreviewClose").addEventListener("click", () => $("#filePreview").close());
$("#filePreview").addEventListener("click", (event) => {
  if (event.target === $("#filePreview")) $("#filePreview").close();
});
$("#claimForm").addEventListener("submit", submitClaim);
$("#ledgerPrev").addEventListener("click", () => stepLedgerMonth(-1));
$("#ledgerNext").addEventListener("click", () => stepLedgerMonth(1));
$("#newEntry").addEventListener("click", () => openEntryForm());
document.querySelectorAll('input[name="entryType"]').forEach((input) => input.addEventListener("change", changeEntryType));
$("#entryParent").addEventListener("change", () => fillChildOptions("entry"));
$("#entryParent").addEventListener("change", () => showOtherFields("entryParent"));
$("#entryChild").addEventListener("change", () => showOtherFields("entryChild"));
$("#entryForm").addEventListener("submit", submitEntry);
$("#entryCancel").addEventListener("click", () => { show("ledger"); renderLedger(); });
$("#entryDelete").addEventListener("click", deleteEntry);

glyphField = startGlyphField($("#glyphField"));
renderMotes($("#landingMotes"));
applyTheme();
// A reload in the same tab goes straight back to the page it was on, without the landing page.
function restoreSession() {
  const token = storedToken();
  if (!token) return show("signedOut");
  let view = "overview";
  try { view = sessionStorage.getItem(viewKey) || view; } catch (error) { /* keep the overview */ }
  if (!Object.hasOwn(viewLabels, view) || sectionOf[view]) view = "overview";
  try { showUser(JSON.parse(sessionStorage.getItem(userKey)) || {}); } catch (error) { /* drawn after whoami */ }
  show(view);
  handleCredential({ credential: token }, view);
}
restoreSession();
