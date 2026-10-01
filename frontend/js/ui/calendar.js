function formatDateValue(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length < 4) return digits;
  let result = digits.slice(0, 4) + "-";
  if (digits.length > 4) result += digits.slice(4, 6);
  if (digits.length >= 6) result += "-";
  if (digits.length > 6) result += digits.slice(6, 8);
  return result;
}

function formatPaymentTimeValue(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  let result = `${digits.slice(0, 2)}-${digits.slice(2, 4)}`;
  if (digits.length > 4) result += ` ${digits.slice(4, 6)}`;
  if (digits.length > 6) result += `:${digits.slice(6, 8)}`;
  return result;
}

function isValidDateValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return year >= 1 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function normalizePaymentTime(value) {
  const legacyMatch = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})$/);
  const paymentTime = legacyMatch ? `${legacyMatch[1]}-${legacyMatch[2]} ${legacyMatch[3]}` : String(value || "");
  if (!/^(0[1-9]|1[0-2])-([0-2]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d$/.test(paymentTime)) return "";
  const [monthDay, time] = paymentTime.split(" ");
  const [month, day] = monthDay.split("-").map(Number);
  const check = new Date(2024, month - 1, day);
  return check.getMonth() === month - 1 && check.getDate() === day && time ? paymentTime : "";
}

function setDateValue(id, value) {
  const input = $("#" + id);
  if (!input) return;
  input.value = value || "";
  input.setCustomValidity("");
  const picker = input.closest("[data-date-control]")?.querySelector(".native-date-picker");
  if (picker) picker.value = isValidDateValue(input.value) ? input.value : "";
}

function validateDateInput(input) {
  const invalid = input.value && !isValidDateValue(input.value);
  input.setCustomValidity(invalid ? "請輸入四位數年份的有效日期，例如 2026-09-11。" : "");
  return !invalid;
}

function renderCalendar() {
  const popover = $("#calendarPopover");
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const selected = calendarTarget?.value || "";
  if (calendarMode === "months") {
    popover.innerHTML = `<div class="calendar-head"><button type="button" data-calendar-year-prev>&lsaquo;</button><button type="button" class="calendar-title" data-calendar-years>${year} 年</button><button type="button" data-calendar-year-next>&rsaquo;</button></div><div class="calendar-choices">${Array.from({ length: 12 }, (_, i) => `<button type="button" data-calendar-month="${i}" ${i === month ? 'aria-selected="true"' : ""}>${i + 1}月</button>`).join("")}</div>`;
    return;
  }
  if (calendarMode === "years") {
    const start = year - 5;
    popover.innerHTML = `<div class="calendar-head"><button type="button" data-calendar-years-prev>&lsaquo;</button><button type="button" class="calendar-title" data-calendar-months>選擇年份</button><button type="button" data-calendar-years-next>&rsaquo;</button></div><div class="calendar-choices">${Array.from({ length: 12 }, (_, i) => `<button type="button" data-calendar-year="${start + i}">${start + i}</button>`).join("")}</div>`;
    return;
  }
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstDay }, () => "<span></span>").concat(Array.from({ length: days }, (_, i) => {
    const day = i + 1; const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return `<button type="button" data-calendar-date="${value}" ${value === selected ? 'aria-selected="true"' : ""}>${day}</button>`;
  })).join("");
  popover.innerHTML = `<div class="calendar-head"><button type="button" data-calendar-prev>&lsaquo;</button><button type="button" class="calendar-title" data-calendar-months>${year} 年 ${month + 1} 月</button><button type="button" data-calendar-next>&rsaquo;</button></div><div class="calendar-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="calendar-days">${cells}</div>`;
}

function openCalendar(input, trigger) {
  calendarTarget = input; calendarMode = "days";
  const initial = isValidDateValue(input.value) ? new Date(`${input.value}T00:00:00`) : new Date();
  calendarMonth = new Date(initial.getFullYear(), initial.getMonth(), 1);
  const popover = $("#calendarPopover"); popover.hidden = false; renderCalendar();
  const rect = trigger.getBoundingClientRect();
  popover.style.top = `${Math.min(window.innerHeight - 340, rect.bottom + 6)}px`;
  popover.style.left = `${Math.max(8, Math.min(window.innerWidth - 300, rect.right - 292))}px`;
}

function closeCalendar() { $("#calendarPopover").hidden = true; calendarTarget = null; }

function setupDateControls() {
  $$('[data-date-control]').forEach((control) => {
    const input = control.querySelector('input:not(.native-date-picker)');
    const picker = control.querySelector('.native-date-picker');
    const trigger = control.querySelector('.date-picker-trigger');
    const clear = control.querySelector('.clear-date');

    input.addEventListener('input', () => {
      const formatted = formatDateValue(input.value);
      if (input.value !== formatted) input.value = formatted;
      validateDateInput(input);
      picker.value = isValidDateValue(input.value) ? input.value : "";
    });

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Backspace' || input.selectionStart !== input.selectionEnd) return;
      const cursor = input.selectionStart;
      if ((cursor === 5 || cursor === 8) && input.value[cursor - 1] === '-') {
        event.preventDefault();
        input.value = input.value.slice(0, cursor - 2) + input.value.slice(cursor);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    input.addEventListener('blur', () => validateDateInput(input));
    const commitPickerDate = () => {
      if (!picker.value) return;
      setDateValue(input.id, picker.value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => {
        picker.blur();
        picker.style.display = "none";
        trigger.focus({ preventScroll: true });
        requestAnimationFrame(() => { picker.style.display = ""; });
      }, 0);
    };
    picker.addEventListener('input', commitPickerDate);
    picker.addEventListener('change', commitPickerDate);
    trigger.addEventListener('click', () => openCalendar(input, trigger));
    if (clear) clear.addEventListener('click', () => {
      setDateValue(input.id, "");
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
  });
}

