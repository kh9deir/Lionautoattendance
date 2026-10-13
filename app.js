
(function () {
  'use strict';

  const STORAGE_KEY = 'dawami.local.v1';
  const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const DAY_SHORT = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];
  const pageNames = { dashboard: 'نظرة عامة', attendance: 'سجل الحضور', employees: 'الموظفون', payroll: 'الرواتب والسلف', settings: 'الإعدادات' };
  const now = new Date();
  const todayISO = toISODate(now);
  const currentMonth = todayISO.slice(0, 7);
  let selectedMonth = currentMonth;
  let activePage = 'dashboard';
  let attendanceSearch = '';
  let attendanceFilter = 'all';
  let attendanceView = 'daily';
  let employeesShowInactive = false;
  let importPreview = [];
  let importFileName = '';
  let importNewEmployees = new Map();
  let importInfo = {};
  let pdfUploadStatus = null;
  let toastTimer;

  function initialState() {
    return {
      employees: [], records: [], loans: [], absenceReviews: {}, dayReviews: {}, attendanceEmployeeIds: [], coverage: { start: '', end: '' },
      settings: { dateFormat: 'dmy', graceMinutes: 0, latePerMinute: 0, earlyPerMinute: 0, absenceDays: 1, salaryDays: 26, workHours: 8 }
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return initialState();
      const base = initialState();
      return {
        ...base, ...saved,
        employees: Array.isArray(saved.employees) ? saved.employees : [],
        records: Array.isArray(saved.records) ? saved.records : [],
        loans: Array.isArray(saved.loans) ? saved.loans : [],
        absenceReviews: saved.absenceReviews && typeof saved.absenceReviews === 'object' && !Array.isArray(saved.absenceReviews) ? saved.absenceReviews : {},
        dayReviews: saved.dayReviews && typeof saved.dayReviews === 'object' && !Array.isArray(saved.dayReviews) ? saved.dayReviews : {},
        attendanceEmployeeIds: Array.isArray(saved.attendanceEmployeeIds) && saved.attendanceEmployeeIds.length ? saved.attendanceEmployeeIds : Array.from(new Set((Array.isArray(saved.records) ? saved.records : []).map(r => r.employeeId).filter(Boolean))),
        coverage: { ...base.coverage, ...(saved.coverage || {}) },
        settings: { ...base.settings, ...(saved.settings || {}) }
      };
    } catch (_) { return initialState(); }
  }

  let state = loadState();
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      toast('تعذر الحفظ. قد تكون مساحة التخزين ممتلئة؛ نزّل نسخة احتياطية ثم احذف بيانات قديمة.', 'error');
      console.error(error);
      return false;
    }
  }

  function toISODate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }
  function normalizeText(s) { return String(s || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '').replace(/ـ/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function fmtMoney(n) { return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(n) || 0); }
  function fmtNumber(n) { return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Number(n) || 0); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  }
  function monthLabel(month) {
    if (!month) return '';
    const [y, m] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  }
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '؟').slice(0, 2)).toUpperCase();
  }
  function toast(message, type = 'success') {
    const region = $('#toastRegion');
    if (!region) return;
    region.innerHTML = `<div class="toast ${type}">${esc(message)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { region.innerHTML = ''; }, 4200);
  }
  function employeeById(id) { return state.employees.find(e => e.id === id); }
  function employeeLabel(e) { return `${e.name}${e.code ? ` — ${e.code}` : ''}`; }
  function activeEmployees() { return state.employees.filter(e => e.active !== false); }
  function recordsFor(employeeId, date) { return state.records.filter(r => r.employeeId === employeeId && r.date === date); }
  function uniqueKey(record) { return `${record.employeeId}|${record.date}|${record.type}`; }
  function openDialog(dialog, title, subtitle, body, buttons = '') {
    dialog.innerHTML = `<div class="dialog-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="close-dialog" type="button" aria-label="إغلاق">×</button></div><div class="dialog-body">${body}</div>${buttons ? `<div class="dialog-actions">${buttons}</div>` : ''}`;
    $('.close-dialog', dialog).addEventListener('click', () => dialog.close());
    dialog.showModal();
  }
  function monthInput(value = selectedMonth) { return `<input class="month-control" id="monthPicker" type="month" value="${esc(value)}" aria-label="اختر شهر التقرير">`; }
  function pageHeading(title, description, actions = '') {
    return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
  }
  function person(e) {
    return `<div class="person-cell"><span class="avatar">${esc(initials(e?.name || '؟'))}</span><span><span class="person-name">${esc(e?.name || 'موظف غير محدد')}</span><span class="person-meta">${esc(e?.code ? `كود ${e.code}` : 'بدون كود')}</span></span></div>`;
  }
  function badge(text, kind = 'gray') { return `<span class="badge badge-${kind}">${text}</span>`; }
  function localMonthStart(month) { return `${month}-01`; }
  function localMonthEnd(month) {
    const [y, m] = month.split('-').map(Number);
    return toISODate(new Date(y, m, 0));
  }

  function calcDaily(employee, date) {
    const dayRecords = recordsFor(employee.id, date);
    const ins = dayRecords.filter(r => r.type === 'in').map(r => r.time).sort();
    const outs = dayRecords.filter(r => r.type === 'out').map(r => r.time).sort();
    const firstIn = ins[0] || '';
    const lastOut = outs[outs.length - 1] || '';
    const shiftStart = employee.shiftStart || '09:00';
    const shiftEnd = employee.shiftEnd || '17:00';
    const start = timeMinutes(shiftStart);
    const end = timeMinutes(shiftEnd);
    const inMin = timeMinutes(firstIn);
    const outMin = timeMinutes(lastOut);
    const grace = Number(state.settings.graceMinutes) || 0;
    const late = firstIn ? Math.max(0, inMin - start - grace) : 0;
    const early = lastOut ? Math.max(0, end - outMin) : 0;
    const worked = firstIn && lastOut ? Math.max(0, outMin - inMin) : 0;
    const scheduled = (employee.workDays || [0, 1, 2, 3, 4, 6]).includes(new Date(`${date}T12:00:00`).getDay());
    return { records: dayRecords, firstIn, lastOut, late, early, worked, scheduled, absent: dayRecords.length === 0 };
  }
  function timeMinutes(time) {
    if (!time || !/^\d{1,2}:\d{2}/.test(time)) return 0;
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }
  function durationText(min) { return `${fmtNumber(Math.floor(min / 60))}س ${fmtNumber(min % 60)}د`; }
  function getCoverage() { return state.coverage || { start: '', end: '' }; }
  function withinCoverage(date) {
    const c = getCoverage();
    return !!c.start && !!c.end && date >= c.start && date <= c.end;
  }

  function calcPayroll(employee, month) {
    const start = localMonthStart(month);
    const end = localMonthEnd(month);
    const coverage = getCoverage();
    const scanStart = coverage.start && coverage.start > start ? coverage.start : start;
    const scanEndRaw = coverage.end && coverage.end < end ? coverage.end : end;
    const scanEnd = scanEndRaw > todayISO ? todayISO : scanEndRaw;
    const hasCoverage = !!coverage.start && !!coverage.end && scanStart <= scanEnd;
    let expected = 0, absent = 0, lateMinutes = 0, earlyMinutes = 0, workedMinutes = 0;
    if (hasCoverage) {
      let cursor = new Date(`${scanStart}T12:00:00`);
      const last = new Date(`${scanEnd}T12:00:00`);
      while (cursor <= last) {
        const date = toISODate(cursor);
        const day = calcDaily(employee, date);
        if (day.scheduled) {
          expected++;
          if (day.absent) absent++;
          lateMinutes += day.late;
          earlyMinutes += day.early;
          workedMinutes += day.worked;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const salary = Number(employee.salary) || 0;
    const allowance = Number(employee.allowance) || 0;
    const salaryDays = Number(state.settings.salaryDays) || 26;
    const workHours = Number(state.settings.workHours) || 8;
    const dailyRate = salary / salaryDays;
    const minuteRate = salary / salaryDays / (workHours * 60);
    const lateRate = Number(state.settings.latePerMinute) > 0 ? Number(state.settings.latePerMinute) : minuteRate;
    const earlyRate = Number(state.settings.earlyPerMinute) > 0 ? Number(state.settings.earlyPerMinute) : minuteRate;
    const lateDeduction = lateMinutes * lateRate;
    const earlyDeduction = earlyMinutes * earlyRate;
    const absenceDeduction = absent * dailyRate * (Number(state.settings.absenceDays) || 1);
    const periodDeductions = state.loans.filter(l => l.employeeId === employee.id).reduce((sum, loan) => sum + loanDeduction(loan, month), 0);
    const deductions = lateDeduction + earlyDeduction + absenceDeduction + periodDeductions;
    return { employee, expected, absent, lateMinutes, earlyMinutes, workedMinutes, salary, allowance, gross: salary + allowance, dailyRate, lateDeduction, earlyDeduction, absenceDeduction, loanDeduction: periodDeductions, deductions, net: salary + allowance - deductions, hasCoverage };
  }
  function loanDeduction(loan, month) {
    const recorded = loan.deductions && Object.prototype.hasOwnProperty.call(loan.deductions, month) ? Number(loan.deductions[month]) : null;
    return recorded === null ? Math.min(Number(loan.remaining) || 0, Number(loan.installment) || 0) : recorded;
  }

  function renderDashboard() {
    const staff = reportEmployees();
    const todayCovered = withinCoverage(todayISO);
    const todayRows = staff.map(e => ({ e, day: calcDaily(e, todayISO) }));
    const present = todayRows.filter(x => x.day.records.length > 0).length;
    const late = todayRows.filter(x => x.day.late > 0).length;
    const absent = todayCovered ? todayRows.filter(x => x.day.scheduled && x.day.absent).length : null;
    const presenceRate = staff.length ? Math.round(present / staff.length * 100) : 0;
    const periodPayroll = staff.reduce((sum, e) => sum + calcPayroll(e, selectedMonth).net, 0);
    const actions = `${monthInput()}<button class="primary-btn" data-action="import-pdf"><span class="button-icon">⇧</span> استيراد PDF</button>`;
    const stats = `<div class="stats-grid">
      <article class="stat-card" style="--stat-color:#2c7691;--stat-pale:#edf4f8"><div class="stat-label">إجمالي الموظفين <span class="stat-badge">♙</span></div><div class="stat-value">${fmtNumber(staff.length)}</div><div class="stat-foot">موظف مسجل ونشط</div></article>
      <article class="stat-card" style="--stat-color:#0b8b72;--stat-pale:#e7f5f1"><div class="stat-label">حضور اليوم <span class="stat-badge">✓</span></div><div class="stat-value">${todayCovered ? fmtNumber(present) : '—'}</div><div class="stat-foot">${todayCovered ? `من أصل ${fmtNumber(staff.length)} موظف` : 'استورد سجل اليوم لعرض الرقم'}</div></article>
      <article class="stat-card" style="--stat-color:#ba7b14;--stat-pale:#fff4df"><div class="stat-label">تأخير اليوم <span class="stat-badge">◷</span></div><div class="stat-value">${todayCovered ? fmtNumber(late) : '—'}</div><div class="stat-foot">موظفون تجاوزوا موعد الحضور</div></article>
      <article class="stat-card" style="--stat-color:#bb4c4c;--stat-pale:#fff0ef"><div class="stat-label">غياب اليوم <span class="stat-badge">−</span></div><div class="stat-value">${absent === null ? '—' : fmtNumber(absent)}</div><div class="stat-foot">${absent === null ? 'يتحدد ضمن نطاق السجل المستورد' : 'ضمن أيام العمل المحددة'}</div></article>
    </div>`;
    const coverage = getCoverage();
    let todayTable;
    if (!staff.length) todayTable = `<div class="empty-state"><div class="empty-mark">♙</div><h3>ابدأ بإضافة فريقك</h3><p>أضف الموظفين ومواعيد عملهم أولًا، ثم ارفع ملف البصمة لربط الحركات وحساب النتائج.</p><button class="primary-btn" data-action="add-employee">＋ إضافة أول موظف</button></div>`;
    else if (!todayCovered) todayTable = `<div class="empty-state"><div class="empty-mark">◷</div><h3>لا توجد بيانات تغطي اليوم بعد</h3><p>ارفع تقرير البصمة للفترة الحالية حتى تظهر حالة الحضور والغياب هنا. لن يُفترض الغياب خارج فترة الملف.</p><button class="secondary-btn" data-action="import-pdf">⇧ استيراد سجل PDF</button></div>`;
    else todayTable = `<div class="table-wrap"><table class="data-table"><thead><tr><th>الموظف</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>الحالة</th></tr></thead><tbody>${todayRows.map(({ e, day }) => `<tr><td>${person(e)}</td><td>${day.firstIn ? `<span class="num-ltr">${esc(day.firstIn)}</span>` : '—'}</td><td>${day.lastOut ? `<span class="num-ltr">${esc(day.lastOut)}</span>` : '—'}</td><td>${day.worked ? durationText(day.worked) : '—'}</td><td>${day.absent && day.scheduled ? badge('غائب', 'red') : day.late ? badge(`متأخر ${fmtNumber(day.late)} د`, 'amber') : day.records.length ? badge('حاضر', 'green') : badge('راحة', 'gray')}</td></tr>`).join('')}</tbody></table></div>`;
    const cText = coverage.start ? `${fmtDate(coverage.start)} — ${fmtDate(coverage.end)}` : 'لم يُستورد سجل بعد';
    return `${pageHeading('نظرة عامة', `ملخص العمل وحركة الموظفين — ${esc(monthLabel(selectedMonth))}`, actions)}${stats}
      <div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">حالة الحضور اليوم</div><div class="panel-subtitle">${esc(fmtDate(todayISO))}</div></div><button class="text-link" data-page-link="attendance">عرض السجل ←</button></div>${todayTable}</section>
      <div style="display:grid;gap:15px;align-content:start"><section class="panel"><div class="panel-header"><div><div class="panel-title">ملخص الأداء</div><div class="panel-subtitle">تغطية يوم العمل الحالي</div></div></div><div class="panel-body"><div class="progress-ring-wrap"><div class="progress-ring" style="--progress:${todayCovered ? presenceRate * 3.6 : 0}deg"><strong>${todayCovered ? `${fmtNumber(presenceRate)}٪` : '—'}</strong></div><div class="progress-copy"><strong>${todayCovered ? 'معدل الحضور اليوم' : 'بانتظار سجل الدوام'}</strong><span>${todayCovered ? `${fmtNumber(present)} من ${fmtNumber(staff.length)} موظف سجلوا حضورهم` : 'ارفع ملف PDF لتفعيل مؤشرات اليوم'}</span></div></div><div class="mini-list"><div class="mini-row"><span>التغطية المسجلة</span><strong style="font-size:10px">${esc(cText)}</strong></div><div class="mini-row"><span>صافي رواتب الفترة</span><strong>${fmtMoney(periodPayroll)} ج.م</strong></div></div></div></section>
      <section class="panel"><div class="panel-header"><div><div class="panel-title">إجراءات سريعة</div><div class="panel-subtitle">اختصارات لإدارة يومك</div></div></div><div class="panel-body"><div class="quick-actions"><button class="quick-action" data-action="import-pdf"><span class="quick-icon">⇧</span><span><strong>رفع ملف PDF</strong><small>استيراد سجل البصمة</small></span></button><button class="quick-action" data-action="add-employee"><span class="quick-icon">＋</span><span><strong>إضافة موظف</strong><small>بيانات وموعد العمل</small></span></button><button class="quick-action" data-page-link="payroll"><span class="quick-icon">▤</span><span><strong>كشف الرواتب</strong><small>حساب صافي المرتب</small></span></button><button class="quick-action" data-action="add-record"><span class="quick-icon">◷</span><span><strong>إدخال حركة</strong><small>إضافة يدويًا</small></span></button></div></div></section></div></div>`;
  }

  function renderAttendance() {
    const start = localMonthStart(selectedMonth), end = localMonthEnd(selectedMonth);
    let rows = state.records.filter(r => r.date >= start && r.date <= end);
    if (attendanceFilter !== 'all') rows = rows.filter(r => r.type === attendanceFilter);
    if (attendanceSearch.trim()) {
      const term = normalizeText(attendanceSearch);
      rows = rows.filter(r => { const e = employeeById(r.employeeId); return normalizeText(e?.name).includes(term) || normalizeText(e?.code).includes(term) || r.date.includes(term); });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    const coverage = getCoverage();
    const actions = `${monthInput()}<button class="secondary-btn" data-action="add-record">＋ حركة يدوية</button><button class="primary-btn" data-action="import-pdf"><span class="button-icon">⇧</span> استيراد PDF</button>`;
    let rowsHTML = '';
    let displayCount = 0;
    const dailyMode = attendanceView === 'daily';
    if (rows.length && dailyMode) {
      const groupedDays = new Map();
      rows.forEach(record => {
        if (!groupedDays.has(record.date)) groupedDays.set(record.date, new Map());
        const people = groupedDays.get(record.date);
        if (!people.has(record.employeeId)) people.set(record.employeeId, []);
        people.get(record.employeeId).push(record);
      });
      displayCount = Array.from(groupedDays.values()).reduce((sum, people) => sum + people.size, 0);
      rowsHTML = Array.from(groupedDays.entries()).map(([date, people]) => {
        const peopleRows = Array.from(people.entries()).map(([employeeId, events]) => {
          const employee = employeeById(employeeId);
          const allDayEvents = employee ? calcDaily(employee, date) : null;
          const inEvents = events.filter(r => r.type === 'in').sort((a, b) => a.time.localeCompare(b.time));
          const outEvents = events.filter(r => r.type === 'out').sort((a, b) => a.time.localeCompare(b.time));
          const firstIn = inEvents[0];
          const lastOut = outEvents[outEvents.length - 1];
          const deleteButtons = events.map(r => `<button class="icon-action" data-action="delete-record" data-id="${esc(r.id)}" title="حذف الحركة">حذف ${r.type === 'in' ? 'الحضور' : 'الانصراف'}</button>`).join(' ');
          const status = !allDayEvents || !allDayEvents.records.length
            ? '—'
            : allDayEvents.absent && allDayEvents.scheduled ? badge('غائب', 'red')
              : allDayEvents.late ? badge(`متأخر ${fmtNumber(allDayEvents.late)} د`, 'amber')
                : badge('حاضر', 'green');
          return `<tr><td>${person(employee)}</td><td>${firstIn ? `<span class="num-ltr">${esc(firstIn.time)}</span>${Number(firstIn.duplicates) > 1 ? `<div class="duplicate-note">${fmtNumber(firstIn.duplicates)} بصمات مدمجة</div>` : ''}` : '—'}</td><td>${lastOut ? `<span class="num-ltr">${esc(lastOut.time)}</span>${Number(lastOut.duplicates) > 1 ? `<div class="duplicate-note">${fmtNumber(lastOut.duplicates)} بصمات مدمجة</div>` : ''}` : '—'}</td><td>${allDayEvents?.worked ? durationText(allDayEvents.worked) : '—'}</td><td>${status}</td><td><div class="daily-actions">${deleteButtons || '—'}</div></td></tr>`;
        }).join('');
        return `<tr class="day-separator-row"><td colspan="6">${esc(fmtDate(date))} <span>· ${fmtNumber(people.size)} موظف</span></td></tr>${peopleRows}`;
      }).join('');
    } else if (rows.length) {
      displayCount = rows.length;
      rowsHTML = rows.map(r => {
        const e = employeeById(r.employeeId);
        const daily = e ? calcDaily(e, r.date) : null;
        const duplicateText = Number(r.duplicates) > 1 ? `<div class="duplicate-note">${fmtNumber(r.duplicates)} حركات مدمجة</div>` : '';
        return `<tr><td>${person(e)}</td><td><span class="num-ltr">${esc(fmtDate(r.date))}</span></td><td>${r.type === 'in' ? badge('حضور', 'green') : badge('انصراف', 'blue')}</td><td><span class="num-ltr">${esc(r.time)}</span>${duplicateText}</td><td>${r.type === 'in' && daily?.late ? badge(`تأخير ${fmtNumber(daily.late)} د`, 'amber') : '—'}</td><td>${esc(r.source === 'pdf' ? 'ملف PDF' : r.source === 'manual' ? 'إدخال يدوي' : 'سجل محفوظ')}</td><td><button class="icon-action" data-action="delete-record" data-id="${esc(r.id)}" title="حذف الحركة">حذف</button></td></tr>`;
      }).join('');
    } else {
      rowsHTML = `<tr><td colspan="${dailyMode ? 6 : 7}" class="no-data-row">لا توجد حركات في هذه الفترة. ارفع ملف PDF أو أضف حركة يدويًا.</td></tr>`;
    }
    const tableHead = dailyMode
      ? '<tr><th>الموظف</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>الحالة</th><th>إجراءات</th></tr>'
      : '<tr><th>الموظف</th><th>التاريخ</th><th>العملية</th><th>الوقت</th><th>ملاحظة</th><th>المصدر</th><th></th></tr>';
    return `${pageHeading('سجل الحضور', 'راجع حركات البصمة وساعات الموظفين، واستورد البيانات أو أضف حركة يدوية.', actions)}
      ${coverage.start ? `<div class="notice notice-info"><span class="notice-icon">ⓘ</span><span>نطاق تغطية السجلات المستورد: <strong>${esc(fmtDate(coverage.start))} — ${esc(fmtDate(coverage.end))}</strong>. تُحتسب أيام الغياب داخل هذا النطاق فقط.</span></div>` : ''}
      <section class="panel"><div class="table-toolbar"><div class="toolbar-group"><input class="search-control" id="attendanceSearch" type="search" placeholder="ابحث بالاسم أو الكود…" value="${esc(attendanceSearch)}"><select class="select-control" id="attendanceFilter"><option value="all" ${attendanceFilter === 'all' ? 'selected' : ''}>كل الحركات</option><option value="in" ${attendanceFilter === 'in' ? 'selected' : ''}>حضور</option><option value="out" ${attendanceFilter === 'out' ? 'selected' : ''}>انصراف</option></select></div><div class="toolbar-group"><button class="secondary-btn small-btn" data-action="toggle-attendance-view">${dailyMode ? 'عرض كل الحركات' : 'عرض حسب اليوم'}</button><button class="secondary-btn small-btn" data-action="export-attendance">تنزيل CSV</button><span class="cell-muted" style="font-size:10px">${fmtNumber(displayCount)} ${dailyMode ? 'موظف/يوم' : 'حركة'}</span></div></div><div class="table-wrap"><table class="data-table"><thead>${tableHead}</thead><tbody>${rowsHTML}</tbody></table></div></section>`;
  }

  function renderEmployees() {
    const list = employeesShowInactive ? state.employees : activeEmployees();
    const actions = `<button class="secondary-btn" data-action="toggle-inactive">${employeesShowInactive ? 'إخفاء غير النشطين' : 'عرض غير النشطين'}</button><button class="primary-btn" data-action="add-employee">＋ إضافة موظف</button>`;
    const cards = list.map(e => {
      const days = (e.workDays || []).map(d => DAY_SHORT[d]).join('، ') || '—';
      const pay = calcPayroll(e, selectedMonth);
      return `<article class="employee-card"><div class="employee-card-top"><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${esc(initials(e.name))}</span><div><h3>${esc(e.name)} ${e.active === false ? badge('غير نشط', 'gray') : ''}</h3><div class="code-line">${esc(e.code ? `كود ${e.code}` : 'بدون كود')}</div></div></div><div class="card-actions"><button class="icon-action" data-action="edit-employee" data-id="${esc(e.id)}">تعديل</button>${e.active === false ? `<button class="icon-action" data-action="activate-employee" data-id="${esc(e.id)}">تفعيل</button>` : `<button class="icon-action" data-action="deactivate-employee" data-id="${esc(e.id)}">إيقاف</button>`}</div></div><div class="employee-meta-grid"><div><span>الراتب الأساسي</span><strong>${fmtMoney(e.salary)} ج.م</strong></div><div><span>بدل شهري</span><strong>${fmtMoney(e.allowance)} ج.م</strong></div><div><span>خصومات ${esc(monthLabel(selectedMonth))}</span><strong>${fmtMoney(pay.deductions)} ج.م</strong></div><div><span>صافي المرتب بعد الخصم</span><strong class="salary-highlight">${fmtMoney(pay.net)} ج.م</strong></div><div><span>موعد الدوام</span><strong><span class="num-ltr">${esc(e.shiftStart || '09:00')} – ${esc(e.shiftEnd || '17:00')}</span></strong></div><div><span>أيام العمل</span><strong>${esc(days)}</strong></div></div></article>`;
    }).join('');
    return `${pageHeading('الموظفون', `أضف بيانات الموظفين والراتب. يظهر الخصم والصافي المحسوبان لفترة ${esc(monthLabel(selectedMonth))}.`, actions)}${list.length ? `<div class="employee-grid">${cards}</div>` : `<section class="panel"><div class="empty-state"><div class="empty-mark">♙</div><h3>${state.employees.length ? 'لا يوجد موظفون في هذا العرض' : 'لم تضف موظفين بعد'}</h3><p>أضف الموظفين وربط الكود الظاهر في تقرير البصمة باسم الموظف، حتى يمكن حساب الحضور والرواتب.</p><button class="primary-btn" data-action="add-employee">＋ إضافة موظف</button></div></section>`}`;
  }

  function renderPayroll() {
    const staff = activeEmployees();
    const calculations = staff.map(e => calcPayroll(e, selectedMonth));
    const sumSalary = calculations.reduce((s, x) => s + x.gross, 0);
    const sumDeduct = calculations.reduce((s, x) => s + x.deductions, 0);
    const sumNet = calculations.reduce((s, x) => s + x.net, 0);
    const sumLoans = calculations.reduce((s, x) => s + x.loanDeduction, 0);
    const period = selectedMonth;
    const allApplied = state.loans.every(l => (Number(l.remaining) || 0) <= 0 || (l.deductions && Object.prototype.hasOwnProperty.call(l.deductions, period)));
    const actions = `${monthInput()}<button class="secondary-btn" data-action="add-loan">＋ تسجيل سلفة</button><button class="secondary-btn" data-action="export-payroll">تنزيل كشف CSV</button><button class="primary-btn" data-action="print-payroll">طباعة الكشف</button>`;
    const coverage = getCoverage();
    const notice = coverage.start ? '' : `<div class="notice notice-warn"><span class="notice-icon">!</span><span>لم يُستورد سجل حضور بعد. ستظهر الخصومات الثابتة والسلف فقط، ولن يُفترض غياب أي موظف. استورد سجلًا يغطي فترة المرتب لاحتساب التأخير والغياب.</span></div>`;
    const tableRows = calculations.length ? calculations.map(x => `<tr><td>${person(x.employee)}</td><td><input class="salary-entry" type="number" min="0" step="0.01" data-salary-employee="${esc(x.employee.id)}" value="${esc(x.salary)}" aria-label="الراتب الأساسي للموظف ${esc(x.employee.name)}"><span class="salary-save-note">حفظ تلقائي</span></td><td>${fmtMoney(x.allowance)} ج.م</td><td>${x.hasCoverage ? fmtNumber(x.expected) : '—'}</td><td>${x.hasCoverage ? fmtNumber(x.absent) : '—'}</td><td>${x.hasCoverage ? fmtNumber(x.lateMinutes) : '—'}</td><td>${fmtMoney(x.lateDeduction + x.earlyDeduction)}</td><td>${fmtMoney(x.absenceDeduction)}</td><td>${fmtMoney(x.loanDeduction)}</td><td>${fmtMoney(x.deductions)} ج.م</td><td class="salary-highlight">${fmtMoney(x.net)} ج.م</td></tr>`).join('') : `<tr><td class="no-data-row" colspan="11">أضف الموظفين أولًا حتى تتمكن من تجهيز كشف الرواتب.</td></tr>`;
    const openLoans = state.loans.filter(l => (Number(l.remaining) || 0) > 0);
    const loanRows = openLoans.length ? openLoans.map(l => `<tr><td>${person(employeeById(l.employeeId))}</td><td>${fmtDate(l.date)}</td><td>${fmtMoney(l.amount)} ج.م</td><td>${fmtMoney(l.remaining)} ج.م</td><td>${fmtMoney(l.installment)} ج.م</td><td><button class="icon-action" data-action="delete-loan" data-id="${esc(l.id)}">حذف</button></td></tr>`).join('') : `<tr><td class="no-data-row" colspan="6">لا توجد سلف معلقة.</td></tr>`;
    return `${pageHeading('الرواتب والسلف', `كشف الفترة: ${esc(monthLabel(period))}. تُحتسب الخصومات وفق الإعدادات وفترة البيانات المسجلة.`, actions)}${notice}
      <div class="stats-grid"><article class="stat-card" style="--stat-color:#2c7691;--stat-pale:#edf4f8"><div class="stat-label">إجمالي الاستحقاقات <span class="stat-badge">＋</span></div><div class="stat-value" style="font-size:22px">${fmtMoney(sumSalary)}</div><div class="stat-foot">جنيه مصري · راتب وبدل</div></article><article class="stat-card" style="--stat-color:#ba7b14;--stat-pale:#fff4df"><div class="stat-label">إجمالي الخصومات <span class="stat-badge">−</span></div><div class="stat-value" style="font-size:22px">${fmtMoney(sumDeduct)}</div><div class="stat-foot">تأخير وغياب وسلف</div></article><article class="stat-card" style="--stat-color:#0b8b72;--stat-pale:#e7f5f1"><div class="stat-label">صافي الرواتب <span class="stat-badge">✓</span></div><div class="stat-value" style="font-size:22px">${fmtMoney(sumNet)}</div><div class="stat-foot">جنيه مصري · ${fmtNumber(staff.length)} موظف</div></article><article class="stat-card" style="--stat-color:#bb4c4c;--stat-pale:#fff0ef"><div class="stat-label">أقساط السلف <span class="stat-badge">▤</span></div><div class="stat-value" style="font-size:22px">${fmtMoney(sumLoans)}</div><div class="stat-foot">${allApplied ? 'مسجلة لهذه الفترة أو لا توجد سلف' : 'أقساط مقترحة — اعتمدها مرة واحدة'}</div></article></div>
      <section class="panel" style="margin-bottom:16px"><div class="panel-header"><div><div class="panel-title">كشف الرواتب التفصيلي</div><div class="panel-subtitle">أدخلي الراتب الأساسي مباشرة؛ يُحفظ تلقائيًا في ذاكرة المتصفح عند مغادرة الخانة، ثم يُعاد حساب الصافي.</div></div><button class="secondary-btn small-btn" data-action="apply-loans" ${allApplied || !openLoans.length ? 'disabled' : ''}>${allApplied ? 'تم اعتماد أقساط الفترة' : 'اعتماد خصم أقساط السلف'}</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الموظف</th><th>الراتب الأساسي</th><th>البدلات</th><th>أيام مغطاة</th><th>الغياب</th><th>دقائق التأخير</th><th>خصم الدقائق</th><th>خصم الغياب</th><th>السلفة</th><th>إجمالي الخصم</th><th>صافي الراتب بعد الخصم</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="summary-strip"><span>الراتب الأساسي + البدلات <strong>${fmtMoney(sumSalary)} ج.م</strong></span><span>الخصومات <strong>${fmtMoney(sumDeduct)} ج.م</strong></span><span>صافي المستحق <strong>${fmtMoney(sumNet)} ج.م</strong></span></div></section>
      <section class="panel"><div class="panel-header"><div><div class="panel-title">السلف المعلقة</div><div class="panel-subtitle">قسط الفترة الحالية: ${esc(monthLabel(period))}</div></div><button class="text-link" data-action="add-loan">＋ تسجيل سلفة جديدة</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الموظف</th><th>تاريخ السلفة</th><th>المبلغ الأصلي</th><th>المتبقي</th><th>القسط لكل فترة</th><th></th></tr></thead><tbody>${loanRows}</tbody></table></div></section>`;
  }

  function renderSettings() {
    const s = state.settings;
    const coverage = getCoverage();
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => `<label class="check-chip"><input type="checkbox" data-global-day="${i}" ${(state.defaultWorkDays || [0, 1, 2, 3, 4, 6]).includes(i) ? 'checked' : ''}>${DAY_NAMES[i]}</label>`).join('');
    return `${pageHeading('الإعدادات', 'حدد قواعد احتساب الرواتب، وتنسيق تاريخ الملف، واحتفظ بنسخة احتياطية من بياناتك.')}
      <div class="settings-layout"><section class="panel"><div class="panel-header"><div><div class="panel-title">قواعد الدوام والخصم</div><div class="panel-subtitle">تنطبق الإعدادات العامة عند إضافة موظف جديد</div></div></div>
        <div class="settings-section"><h3>أيام العمل الافتراضية</h3><p>يمكن تخصيص الأيام وموعد العمل لكل موظف من صفحة الموظفين.</p><div class="checkbox-grid">${days}</div></div>
        <div class="settings-section"><h3>طريقة احتساب الخصومات</h3><p>ضع قيمة الدقيقة يدويًا؛ اتركها صفرًا ليحسبها التطبيق من راتب الموظف وعدد ساعات العمل.</p><div class="field-grid"><div class="field"><label for="graceMinutes">فترة السماح (دقيقة)</label><input id="graceMinutes" type="number" min="0" max="300" value="${esc(s.graceMinutes)}"></div><div class="field"><label for="absenceDays">خصم الغياب (أجر يوم ×)</label><input id="absenceDays" type="number" min="0" max="5" step="0.25" value="${esc(s.absenceDays)}"></div><div class="field"><label for="latePerMinute">خصم دقيقة التأخير (ج.م)</label><input id="latePerMinute" type="number" min="0" step="0.01" value="${esc(s.latePerMinute)}"><span class="field-help">صفر = الراتب ÷ أيام الراتب ÷ ساعات العمل.</span></div><div class="field"><label for="earlyPerMinute">خصم دقيقة الانصراف المبكر (ج.م)</label><input id="earlyPerMinute" type="number" min="0" step="0.01" value="${esc(s.earlyPerMinute)}"><span class="field-help">صفر = احتساب تلقائي مثل خصم التأخير.</span></div><div class="field"><label for="salaryDays">أيام حساب الراتب في الشهر</label><input id="salaryDays" type="number" min="1" max="31" value="${esc(s.salaryDays)}"></div><div class="field"><label for="workHours">ساعات العمل اليومية</label><input id="workHours" type="number" min="1" max="24" step="0.5" value="${esc(s.workHours)}"></div></div><div style="margin-top:13px"><button class="primary-btn" data-action="save-settings">حفظ قواعد الحساب</button></div></div>
      </section><div style="display:grid;gap:16px;align-content:start"><section class="panel"><div class="panel-header"><div><div class="panel-title">استيراد PDF</div><div class="panel-subtitle">تنسيق التاريخ وفترة التغطية</div></div></div><div class="settings-section"><div class="field"><label for="dateFormat">ترتيب التاريخ في ملف PDF</label><select id="dateFormat"><option value="dmy" ${s.dateFormat === 'dmy' ? 'selected' : ''}>يوم / شهر / سنة (مثال 13/10/2026)</option><option value="mdy" ${s.dateFormat === 'mdy' ? 'selected' : ''}>شهر / يوم / سنة (مثال 10/13/2026)</option></select></div><p style="margin-top:11px">الافتراضي يوم/شهر/سنة. عند الاستيراد تُعرض الحركات للمراجعة قبل حفظها، ويُربط كل عمود بالاسم/الكود المكتوب فوقه، ويُحدَّد الحضور والانصراف من ترتيب بصمات اليوم لا من خانة الحركة في الملف. ملفات PDF المصورة التي لا تحتوي نصًا قابلًا للتحديد لا يمكن استخراجها دون OCR.</p><div class="coverage-line"><span class="status-dot"></span><span>فترة السجل: <strong>${coverage.start ? `${esc(fmtDate(coverage.start))} — ${esc(fmtDate(coverage.end))}` : 'لا توجد بيانات مستوردة'}</strong></span></div></div></section>
      <section class="panel"><div class="panel-header"><div><div class="panel-title">النسخ الاحتياطي والخصوصية</div><div class="panel-subtitle">استعد بياناتك عند تغيير الجهاز أو المتصفح</div></div></div><div class="settings-section"><p>تُحفظ بياناتك داخل هذا المتصفح فقط، ولا تُرسل إلى خادم. نزّل نسخة JSON للاحتفاظ بها، ويمكنك استعادتها لاحقًا.</p><div class="heading-actions"><button class="secondary-btn" data-action="backup">تنزيل نسخة احتياطية</button><button class="secondary-btn" data-action="restore">استعادة نسخة JSON</button></div><div style="margin-top:12px"><button class="danger-btn small-btn" data-action="clear-data">مسح كل البيانات المحلية</button></div></div></section></div></div>`;
  }

  function renderPage() {
    const root = $('#pageContent');
    const renderers = { dashboard: renderDashboard, attendance: renderAttendance, employees: renderEmployees, payroll: renderPayroll, settings: renderSettings };
    root.innerHTML = (renderers[activePage] || renderDashboard)();
    $('#breadcrumb').textContent = pageNames[activePage] || pageNames.dashboard;
    $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === activePage));
    renderMobileNav();
    bindPageEvents();
  }

  function renderMobileNav() {
    let nav = $('#mobileNav');
    if (!nav) { nav = document.createElement('nav'); nav.id = 'mobileNav'; nav.className = 'mobile-nav'; document.body.appendChild(nav); }
    const items = [['dashboard', '◫', 'الرئيسية'], ['attendance', '◷', 'الحضور'], ['employees', '♙', 'الموظفون'], ['payroll', '▤', 'الرواتب'], ['settings', '⚙', 'إعدادات']];
    nav.innerHTML = items.map(([p, icon, label]) => `<button data-page="${p}" class="${activePage === p ? 'active' : ''}"><span>${icon}</span><span>${label}</span></button>`).join('');
    $$('button', nav).forEach(b => b.addEventListener('click', () => { activePage = b.dataset.page; renderPage(); }));
  }

  function bindPageEvents() {
    $('#monthPicker')?.addEventListener('change', e => { if (e.target.value) { selectedMonth = e.target.value; renderPage(); } });
    $('#attendanceSearch')?.addEventListener('input', e => { attendanceSearch = e.target.value; const pos = e.target.selectionStart; renderPage(); const input = $('#attendanceSearch'); input.focus(); input.setSelectionRange(pos, pos); });
    $('#attendanceFilter')?.addEventListener('change', e => { attendanceFilter = e.target.value; renderPage(); });
    $$('[data-salary-employee]').forEach(input => input.addEventListener('change', saveEmployeeSalary));
    $$('.nav-item').forEach(el => el.addEventListener('click', () => { activePage = el.dataset.page; renderPage(); }));
    $$('[data-page-link]').forEach(el => el.addEventListener('click', () => { activePage = el.dataset.pageLink; renderPage(); }));
    $$('[data-action]').forEach(el => el.addEventListener('click', handleAction));
  }

  function saveEmployeeSalary(event) {
    const input = event.currentTarget;
    const employee = employeeById(input.dataset.salaryEmployee);
    const raw = String(input.value || '').trim();
    const salary = Number(raw);
    if (!employee || raw === '' || !Number.isFinite(salary) || salary < 0) {
      toast('أدخل راتبًا صحيحًا بقيمة صفر أو أكبر.', 'warning');
      if (employee) input.value = employee.salary ?? 0;
      return;
    }
    if (Number(employee.salary) === salary) return;
    const previousSalary = employee.salary;
    employee.salary = salary;
    if (!saveState()) { employee.salary = previousSalary; input.value = previousSalary ?? 0; return; }
    renderPage();
    toast('تم حفظ الراتب في ذاكرة المتصفح وإعادة حساب الخصومات والصافي.');
  }

  function handleAction(event) {
    const button = event.currentTarget;
    const action = button.dataset.action;
    if (action === 'import-pdf') { $('#pdfInput').click(); return; }
    if (action === 'add-employee') { showEmployeeDialog(); return; }
    if (action === 'edit-employee') { showEmployeeDialog(button.dataset.id); return; }
    if (action === 'deactivate-employee' || action === 'activate-employee') {
      const e = employeeById(button.dataset.id); if (!e) return;
      e.active = action === 'activate-employee'; saveState(); renderPage(); toast(e.active ? 'تم تفعيل الموظف.' : 'تم إيقاف الموظف مع الاحتفاظ بسجلاته.'); return;
    }
    if (action === 'toggle-inactive') { employeesShowInactive = !employeesShowInactive; renderPage(); return; }
    if (action === 'toggle-attendance-view') { attendanceView = attendanceView === 'daily' ? 'events' : 'daily'; renderPage(); return; }
    if (action === 'add-record') { showRecordDialog(); return; }
    if (action === 'delete-record') {
      const r = state.records.find(x => x.id === button.dataset.id); if (!r) return;
      if (confirm(`حذف حركة ${r.type === 'in' ? 'الحضور' : 'الانصراف'} بتاريخ ${r.date} الساعة ${r.time}؟`)) { state.records = state.records.filter(x => x.id !== r.id); saveState(); renderPage(); toast('تم حذف الحركة.'); } return;
    }
    if (action === 'add-loan') { showLoanDialog(); return; }
    if (action === 'delete-loan') {
      const loan = state.loans.find(l => l.id === button.dataset.id); if (!loan) return;
      if (confirm(`حذف سلفة ${fmtMoney(loan.remaining)} ج.م المتبقية؟`)) { state.loans = state.loans.filter(l => l.id !== loan.id); saveState(); renderPage(); toast('تم حذف السلفة.'); } return;
    }
    if (action === 'save-settings') { saveSettings(); return; }
    if (action === 'export-attendance') { exportAttendance(); return; }
    if (action === 'export-payroll') { exportPayroll(); return; }
    if (action === 'print-payroll') { window.print(); return; }
    if (action === 'apply-loans') { applyLoanDeductions(); return; }
    if (action === 'backup') { downloadBackup(); return; }
    if (action === 'restore') { $('#backupInput').click(); return; }
    if (action === 'clear-data') { clearData(); return; }
  }

  function showEmployeeDialog(id = '') {
    const dialog = $('#employeeDialog');
    const employee = id ? employeeById(id) : null;
    const defaultDays = employee?.workDays || state.defaultWorkDays || [0, 1, 2, 3, 4, 6];
    const dayChecks = DAY_NAMES.map((day, i) => `<label class="check-chip"><input type="checkbox" name="workDays" value="${i}" ${defaultDays.includes(i) ? 'checked' : ''}>${day}</label>`).join('');
    const body = `<form id="employeeForm"><input type="hidden" name="id" value="${esc(employee?.id || '')}"><div class="field-grid"><div class="field"><label for="employeeName">اسم الموظف *</label><input id="employeeName" name="name" required maxlength="80" value="${esc(employee?.name || '')}" placeholder="مثال: أحمد محمد"></div><div class="field"><label for="employeeCode">الكود في جهاز البصمة</label><input id="employeeCode" name="code" maxlength="40" value="${esc(employee?.code || '')}" placeholder="مثال: 31"></div><div class="field"><label for="employeeSalary">الراتب الأساسي (ج.م) *</label><input id="employeeSalary" name="salary" type="number" min="0" step="0.01" required value="${esc(employee?.salary ?? '')}"></div><div class="field"><label for="employeeAllowance">بدل شهري إضافي (ج.م)</label><input id="employeeAllowance" name="allowance" type="number" min="0" step="0.01" value="${esc(employee?.allowance ?? 0)}"></div><div class="field"><label for="employeeStart">موعد الحضور</label><input id="employeeStart" name="shiftStart" type="time" value="${esc(employee?.shiftStart || '09:00')}"></div><div class="field"><label for="employeeEnd">موعد الانصراف</label><input id="employeeEnd" name="shiftEnd" type="time" value="${esc(employee?.shiftEnd || '17:00')}"></div></div><div style="margin-top:14px"><div class="field"><label>أيام العمل</label><div class="checkbox-grid">${dayChecks}</div><span class="field-help">الإعداد الافتراضي: السبت إلى الخميس، والجمعة راحة.</span></div></div><div class="dialog-actions" style="padding:15px 0 0;border:0"><button class="primary-btn" type="submit">${employee ? 'حفظ التعديلات' : 'إضافة الموظف'}</button><button class="secondary-btn" type="button" data-close>إلغاء</button></div></form>`;
    openDialog(dialog, employee ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد', 'أدخل بيانات الراتب والكود وجدول العمل.', body);
    $('[data-close]', dialog).addEventListener('click', () => dialog.close());
    $('#employeeForm', dialog).addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const name = String(fd.get('name') || '').trim();
      const code = String(fd.get('code') || '').trim();
      const salary = Number(fd.get('salary'));
      if (!name || !Number.isFinite(salary) || salary < 0) { toast('أكمل الاسم والراتب بقيمة صحيحة.', 'warning'); return; }
      const normalizedName = normalizeText(name);
      const normalizedCode = normalizeText(code);
      const clash = state.employees.find(x => x.id !== id && ((normalizedCode && normalizeText(x.code) === normalizedCode) || (normalizedName && normalizeText(x.name) === normalizedName)));
      if (clash) {
        const sameName = normalizeText(clash.name) === normalizedName;
        toast(sameName ? 'هذا الموظف مسجل بالفعل بنفس الاسم. افتح سجله للتعديل بدل إضافته مرة أخرى.' : 'هذا الكود مرتبط بموظف آخر. استخدم كودًا مختلفًا.', 'error');
        return;
      }
      const workDays = $$('input[name="workDays"]:checked', e.currentTarget).map(el => Number(el.value));
      if (!workDays.length) { toast('اختر يوم عمل واحدًا على الأقل.', 'warning'); return; }
      const data = { id: employee?.id || uid(), name, code, salary, allowance: Number(fd.get('allowance')) || 0, shiftStart: fd.get('shiftStart') || '09:00', shiftEnd: fd.get('shiftEnd') || '17:00', workDays, active: employee?.active !== false };
      if (employee) Object.assign(employee, data); else state.employees.push(data);
      saveState(); dialog.close(); renderPage(); toast(employee ? 'تم حفظ تعديلات الموظف.' : 'تمت إضافة الموظف.');
    });
  }

  function employeeOptions(selected = '') {
    return `<option value="">— اختر الموظف —</option>${activeEmployees().map(e => `<option value="${esc(e.id)}" ${e.id === selected ? 'selected' : ''}>${esc(employeeLabel(e))}</option>`).join('')}`;
  }

  function showRecordDialog(defaults = {}) {
    if (!activeEmployees().length) { toast('أضف موظفًا أولًا لتسجيل الحضور.', 'warning'); showEmployeeDialog(); return; }
    const dialog = $('#recordDialog');
    const body = `<form id="recordForm"><div class="field-grid"><div class="field"><label for="recordEmployee">الموظف *</label><select id="recordEmployee" name="employeeId" required>${employeeOptions(defaults.employeeId || '')}</select></div><div class="field"><label for="recordType">نوع الحركة *</label><select id="recordType" name="type" required><option value="in" ${defaults.type === 'in' ? 'selected' : ''}>حضور</option><option value="out" ${defaults.type === 'out' ? 'selected' : ''}>انصراف</option></select></div><div class="field"><label for="recordDate">التاريخ *</label><input id="recordDate" name="date" type="date" required value="${esc(defaults.date || todayISO)}"></div><div class="field"><label for="recordTime">الوقت *</label><input id="recordTime" name="time" type="time" required value="${esc(defaults.time || '09:00')}"></div></div><div class="dialog-actions" style="padding:15px 0 0;border:0"><button class="primary-btn" type="submit">حفظ الحركة</button><button class="secondary-btn" type="button" data-close>إلغاء</button></div></form>`;
    openDialog(dialog, 'إضافة حركة حضور أو انصراف', 'لا يمكن تكرار العملية نفسها للموظف في التاريخ نفسه.', body);
    $('[data-close]', dialog).addEventListener('click', () => dialog.close());
    $('#recordForm', dialog).addEventListener('submit', e => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      const duplicateCandidate = state.records.some(r => r.employeeId === fd.get('employeeId') && r.date === fd.get('date') && r.type === fd.get('type'));
      const rec = { id: uid(), employeeId: fd.get('employeeId'), date: fd.get('date'), time: fd.get('time'), type: fd.get('type'), source: 'manual', duplicates: 1, duplicateCandidate };
      state.records.push(rec);
      state.attendanceEmployeeIds = Array.from(new Set([...(state.attendanceEmployeeIds || []), rec.employeeId]));
      expandCoverage(rec.date);
      if (!saveState()) { state.records = state.records.filter(item => item.id !== rec.id); return; }
      dialog.close(); renderPage(); toast('تم حفظ الحركة اليدوية.');
    });
  }

  function showLoanDialog() {
    if (!activeEmployees().length) { toast('أضف موظفًا قبل تسجيل السلفة.', 'warning'); showEmployeeDialog(); return; }
    const dialog = $('#loanDialog');
    const body = `<form id="loanForm"><div class="field-grid"><div class="field"><label for="loanEmployee">الموظف *</label><select id="loanEmployee" name="employeeId" required>${employeeOptions()}</select></div><div class="field"><label for="loanDate">تاريخ السلفة *</label><input id="loanDate" name="date" type="date" required value="${todayISO}"></div><div class="field"><label for="loanAmount">قيمة السلفة (ج.م) *</label><input id="loanAmount" name="amount" type="number" required min="0.01" step="0.01"></div><div class="field"><label for="loanInstallment">الخصم في كل فترة راتب *</label><input id="loanInstallment" name="installment" type="number" required min="0.01" step="0.01"></div></div><div class="field" style="margin-top:12px"><label for="loanNote">ملاحظة (اختياري)</label><input id="loanNote" name="note" maxlength="120" placeholder="مثال: سلفة طارئة"></div><div class="dialog-actions" style="padding:15px 0 0;border:0"><button class="primary-btn" type="submit">حفظ السلفة</button><button class="secondary-btn" type="button" data-close>إلغاء</button></div></form>`;
    openDialog(dialog, 'تسجيل سلفة جديدة', 'حدد مبلغ السلفة والقسط المراد خصمه من كل فترة راتب.', body);
    $('[data-close]', dialog).addEventListener('click', () => dialog.close());
    $('#loanForm', dialog).addEventListener('submit', e => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      const amount = Number(fd.get('amount')), installment = Number(fd.get('installment'));
      if (!(amount > 0) || !(installment > 0)) { toast('أدخل مبلغ السلفة وقيمة القسط بشكل صحيح.', 'warning'); return; }
      state.loans.push({ id: uid(), employeeId: fd.get('employeeId'), date: fd.get('date'), amount, remaining: amount, installment, note: String(fd.get('note') || '').trim(), deductions: {} });
      saveState(); dialog.close(); renderPage(); toast('تم تسجيل السلفة.');
    });
  }

  function saveSettings() {
    const values = {
      graceMinutes: Number($('#graceMinutes')?.value) || 0,
      absenceDays: Number($('#absenceDays')?.value) || 0,
      latePerMinute: Number($('#latePerMinute')?.value) || 0,
      earlyPerMinute: Number($('#earlyPerMinute')?.value) || 0,
      salaryDays: Math.max(1, Number($('#salaryDays')?.value) || 26),
      workHours: Math.max(1, Number($('#workHours')?.value) || 8),
      dateFormat: $('#dateFormat')?.value || state.settings.dateFormat
    };
    state.settings = { ...state.settings, ...values };
    state.defaultWorkDays = $$('[data-global-day]:checked').map(el => Number(el.dataset.globalDay));
    if (!state.defaultWorkDays.length) { toast('اختر يوم عمل افتراضيًا واحدًا على الأقل.', 'warning'); return; }
    saveState(); renderPage(); toast('تم حفظ قواعد الحساب.');
  }

  function applyLoanDeductions() {
    let applied = 0;
    state.loans.forEach(loan => {
      loan.deductions ||= {};
      if (Object.prototype.hasOwnProperty.call(loan.deductions, selectedMonth)) return;
      const amount = Math.min(Number(loan.remaining) || 0, Number(loan.installment) || 0);
      if (amount > 0) { loan.remaining = Math.max(0, Number(loan.remaining) - amount); loan.deductions[selectedMonth] = amount; applied += amount; }
    });
    if (!applied) { toast('تم اعتماد الخصم سابقًا أو لا توجد أقساط مستحقة.', 'warning'); return; }
    saveState(); renderPage(); toast(`تم اعتماد خصم ${fmtMoney(applied)} ج.م لهذه الفترة. لن يتكرر الخصم عند فتح الكشف مجددًا.`);
  }

  function expandCoverage(date) {
    if (!state.coverage.start || date < state.coverage.start) state.coverage.start = date;
    if (!state.coverage.end || date > state.coverage.end) state.coverage.end = date;
  }

  function dateFromParts(a, b, y) {
    let day, month;
    if (state.settings.dateFormat === 'mdy') { month = Number(a); day = Number(b); }
    else { day = Number(a); month = Number(b); }
    const year = Number(y);
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return toISODate(d);
  }
  // ───────────── استيراد تقرير البصمة (PDF) ─────────────
  // القواعد:
  //  1) الموظف يُحدَّد من الاسم/الكود المكتوب فوق كل عمود، مثل: Mas3ood(31).
  //  2) خانة «حضور/انصراف» في الملف لا تُستخدم إطلاقًا؛ أول حركة في اليوم = حضور، وآخر حركة = انصراف.
  //  3) التقرير يعرض الوقت بنظام 12 ساعة بدون ص/م، فيُقدَّر الصباح/المساء من ترتيب الحركات وموعد دوام الموظف.
  const DUP_SECONDS = 60; // بصمتان خلال هذه المدة تُعدّان بصمة مكررة واحدة
  const TIMESTAMP_RE = /(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{4})\s+(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?(?:\s*(صباحًا|صباحا|مساءً|مساءا|مساء|A\.M\.|P\.M\.|AM|PM|ص|م)(?![\u0600-\u06FF]))?/gi;
  function ampmOf(token) {
    if (!token) return null;
    const t = token.replace(/\./g, '').toLowerCase();
    return t === 'am' || t.startsWith('ص') ? 'AM' : 'PM';
  }
  function timestampsIn(text) {
    const found = []; TIMESTAMP_RE.lastIndex = 0; let match;
    while ((match = TIMESTAMP_RE.exec(text)) !== null) {
      const date = dateFromParts(match[1], match[2], match[3]);
      const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6] || 0);
      if (date && hour <= 23 && minute <= 59 && second <= 59) found.push({ date, hour, minute, second, ampm: ampmOf(match[7]), index: match.index });
    }
    return found;
  }
  function matchEmployee(text) {
    const t = normalizeText(text);
    return state.employees.find(e => {
      const name = normalizeText(e.name);
      const code = normalizeText(e.code);
      return (code && code.length >= 2 && (t.includes(`(${code})`) || t.includes(`[${code}]`) || new RegExp(`(?:^|\\s)${escapeRegex(code)}(?:$|\\s)`).test(t))) || (name && name.length > 2 && t.includes(name));
    }) || null;
  }
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // عنوان العمود: «الاسم(الكود)»
  function headerFromText(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || timestampsIn(t).length) return null;
    let name, code, m = t.match(/^(.{1,60}?)\s*\(\s*(\d{1,10})\s*\)$/);
    if (m) { name = m[1]; code = m[2]; }
    else if ((m = t.match(/^\(\s*(\d{1,10})\s*\)\s*(.{1,60})$/))) { code = m[1]; name = m[2]; }
    else return null;
    name = name.trim();
    if (!name) return null;
    return { name, code, key: code ? `c:${normalizeText(code)}` : `n:${normalizeText(name)}` };
  }
  function matchHeaderEmployee(name, code) {
    const c = normalizeText(code), n = normalizeText(name);
    return (c && state.employees.find(e => normalizeText(e.code) === c))
      || (n && state.employees.find(e => normalizeText(e.name) === n))
      || (n.length > 2 && state.employees.find(e => { const en = normalizeText(e.name); return en.length > 2 && (en.includes(n) || n.includes(en)); }))
      || null;
  }

  async function readPdf(file) {
    if (!window.pdfjsLib) { toast('تعذر تحميل قارئ PDF من الإنترنت. تحقق من الاتصال وأعد المحاولة.', 'error'); return; }
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = window.DAWAMI_PDF_WORKER_URL;
      toast('جارٍ قراءة صفحات ملف PDF…', 'success');
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const punches = []; let carry = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const items = content.items.filter(x => x.str && x.str.trim()).map(x => ({ text: x.str.trim(), x: x.transform[4], y: x.transform[5], width: x.width || 0 }));
        const res = parsePdfPage(items, pageNum, carry);
        punches.push(...res.punches);
        if (res.headers.length) carry = res.headers.map(h => ({ ...h, y: Infinity }));
      }
      if (!punches.length) { toast('لم أجد تواريخ وأوقات قابلة للقراءة. قد يكون PDF صورة ممسوحة أو يحتاج صيغة أخرى.', 'warning'); return; }
      const built = buildImportRows(punches);
      importFileName = file.name;
      importPreview = built.rows; importNewEmployees = built.newEmployees; importInfo = built.info;
      showImportPreview();
    } catch (error) {
      console.error(error);
      toast('تعذر قراءة الملف. تأكد أنه PDF سليم وغير محمي بكلمة مرور.', 'error');
    }
  }

  // دمج الخلايا التي قسّمها PDF إلى أجزاء (التاريخ + الوقت + ص/م، أو الاسم + (الكود))
  function mergeSplitItems(list) {
    const out = [];
    list.forEach(item => {
      const prev = out[out.length - 1];
      const gap = prev ? item.x - (prev.x + (prev.width || 0)) : 999;
      const prevIsDate = prev && /^\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{4}$/.test(prev.text);
      const isTime = /^\d{1,2}\s*:\s*\d{2}(\s*:\s*\d{2})?(\s*(AM|PM|ص|م))?$/i.test(item.text);
      const isMark = /^(AM|PM|ص|م)$/i.test(item.text) && prev && /\d:\d{2}/.test(prev.text);
      const isCode = /^\(\s*\d{1,10}\s*\)$/.test(item.text) && prev && !/\d[\/.-]\d/.test(prev.text);
      if (prev && gap < 14 && ((prevIsDate && isTime) || isMark)) { prev.text += ` ${item.text}`; prev.width = (prev.width || 0) + gap + (item.width || 0); }
      else if (prev && gap < 8 && isCode) { prev.text += item.text; prev.width = (prev.width || 0) + gap + (item.width || 0); }
      else out.push({ ...item });
    });
    return out;
  }

  function parsePdfPage(items, pageNum, carryHeaders = []) {
    const rows = [];
    items.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(item => {
      let row = rows.find(r => Math.abs(r.y - item.y) <= 3.2);
      if (!row) { row = { y: item.y, items: [] }; rows.push(row); }
      row.items.push(item);
    });
    rows.forEach(row => { row.items.sort((a, b) => a.x - b.x); row.items = mergeSplitItems(row.items); });
    rows.sort((a, b) => b.y - a.y);

    const headers = [];
    rows.forEach(row => row.items.forEach(item => { const h = headerFromText(item.text); if (h) headers.push({ ...h, x: item.x, y: row.y }); }));
    const activeHeaders = headers.length ? headers : carryHeaders;

    // أقرب عنوان فوق البصمة في نفس العمود
    function headerFor(stamp) {
      if (!activeHeaders.length) return null;
      const above = activeHeaders.filter(h => h.y >= stamp.y - 1);
      const pool = above.length ? above : activeHeaders;
      const minDx = Math.min(...pool.map(h => Math.abs(h.x - stamp.x)));
      return pool.filter(h => Math.abs(h.x - stamp.x) <= minDx + 40).sort((a, b) => (a.y - stamp.y) - (b.y - stamp.y))[0] || null;
    }

    const punches = [];
    rows.forEach(row => {
      const lineText = row.items.map(x => x.text).join(' ');
      row.items.forEach(item => {
        timestampsIn(item.text).forEach(stamp => {
          const header = headerFor({ x: item.x, y: row.y });
          let employeeId = '', headerKey = '', headerName = '', headerCode = '';
          if (header) {
            headerKey = header.key; headerName = header.name; headerCode = header.code;
            employeeId = matchHeaderEmployee(header.name, header.code)?.id || '';
          } else {
            employeeId = (matchEmployee(lineText) || matchEmployee(item.text))?.id || '';
          }
          punches.push({ employeeId, headerKey, headerName, headerCode, date: stamp.date, hour: stamp.hour, minute: stamp.minute, second: stamp.second, ampm: stamp.ampm, page: pageNum });
        });
      });
    });
    return { punches, headers };
  }

  // الاحتمالات الممكنة للوقت (بالثواني) — الملف قد يعرض 12 ساعة بدون ص/م
  function timeCandidates(p, is24h) {
    const base = p.minute * 60 + p.second;
    if (p.hour === 0 || p.hour > 12 || is24h) return [p.hour * 3600 + base];
    if (p.ampm) return [((p.hour % 12) + (p.ampm === 'PM' ? 12 : 0)) * 3600 + base];
    const am = (p.hour % 12) * 3600 + base;
    return [am, am + 43200];
  }
  const nearest = (list, target) => list.reduce((best, v) => best === null || Math.abs(v - target) < Math.abs(best - target) ? v : best, null);
  function clockText(sec) { return `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`; }

  // يحوّل بصمات يوم واحد (بترتيب ظهورها في التقرير) إلى حضور + انصراف
  function resolveDay(list, employee, is24h) {
    const shiftStart = timeMinutes(employee?.shiftStart || '09:00') * 60;
    const shiftEnd = timeMinutes(employee?.shiftEnd || '17:00') * 60;
    const allCertain = list.every(p => timeCandidates(p, is24h).length === 1);
    const ordered = allCertain ? list.slice().sort((a, b) => timeCandidates(a, is24h)[0] - timeCandidates(b, is24h)[0]) : list;
    let inferred = false;
    const secs = [];
    ordered.forEach((p, idx) => {
      const cands = timeCandidates(p, is24h);
      if (cands.length === 1) { secs.push(cands[0]); return; }
      inferred = true;
      if (!secs.length) { secs.push(nearest(cands, shiftStart)); return; } // أول بصمة: الأقرب لموعد بداية الدوام
      const prev = secs[secs.length - 1];
      const valid = cands.filter(c => c >= prev);
      if (!valid.length) { secs.push(Math.max(...cands)); return; }
      if (idx === ordered.length - 1) {
        const dup = valid.find(c => c - prev <= DUP_SECONDS);   // بصمة مكررة بعد ثوانٍ
        secs.push(dup !== undefined ? dup : nearest(valid, shiftEnd)); // آخر بصمة: الأقرب لموعد نهاية الدوام
      } else secs.push(Math.min(...valid));
    });
    // دمج البصمات المتقاربة جدًا (ضغط مكرر على الجهاز)
    const clusters = [];
    secs.forEach(sec => {
      const last = clusters[clusters.length - 1];
      if (last && sec - last.last <= DUP_SECONDS) { last.last = sec; last.count += 1; } else clusters.push({ first: sec, last: sec, count: 1 });
    });
    if (clusters.length === 1) {
      const c = clusters[0];
      const type = c.first < (shiftStart + shiftEnd) / 2 ? 'in' : 'out';
      return { inferred, single: true, items: [{ type, time: clockText(c.first), duplicates: c.count, ignored: 0 }] };
    }
    const first = clusters[0], last = clusters[clusters.length - 1];
    return {
      inferred, single: false,
      items: [
        { type: 'in', time: clockText(first.first), duplicates: first.count, ignored: 0 },
        { type: 'out', time: clockText(last.last), duplicates: last.count, ignored: clusters.length - 2 }
      ]
    };
  }

  function buildImportRows(punches) {
    const is24h = punches.some(p => p.hour === 0 || p.hour > 12);
    const groups = new Map(), newEmployees = new Map();
    punches.forEach(p => {
      let ref = p.employeeId || '';
      if (!ref && p.headerKey) { ref = `new:${p.headerKey}`; if (!newEmployees.has(ref)) newEmployees.set(ref, { name: p.headerName, code: p.headerCode }); }
      const key = `${ref || `?${p.page}`}|${p.date}`;
      if (!groups.has(key)) groups.set(key, { ref, date: p.date, page: p.page, list: [] });
      groups.get(key).list.push(p);
    });
    const rows = []; const info = { inferred: false, singles: 0, ignored: 0, is24h };
    groups.forEach(g => {
      const res = resolveDay(g.list, employeeById(g.ref), is24h);
      if (res.inferred) info.inferred = true;
      if (res.single) info.singles += 1;
      res.items.forEach(it => {
        info.ignored += it.ignored;
        rows.push({ employeeId: g.ref, date: g.date, time: it.time, type: it.type, page: g.page, source: 'pdf', selected: true, duplicates: it.duplicates, ignored: it.ignored, guessed: res.inferred, single: res.single });
      });
    });
    const nameOf = r => normalizeText(employeeById(r.employeeId)?.name || newEmployees.get(r.employeeId)?.name || '~');
    rows.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    return { rows, newEmployees, info };
  }

  function importEmployeeOptions(selected = '') {
    const existing = state.employees.filter(e => e.active !== false || e.id === selected);
    const news = Array.from(importNewEmployees.entries());
    return `<option value="">— اختر الموظف —</option>${existing.map(e => `<option value="${esc(e.id)}" ${e.id === selected ? 'selected' : ''}>${esc(employeeLabel(e))}</option>`).join('')}${news.map(([ref, e]) => `<option value="${esc(ref)}" ${ref === selected ? 'selected' : ''}>＋ موظف جديد: ${esc(e.name)}${e.code ? ` — ${esc(e.code)}` : ''}</option>`).join('')}`;
  }

  function showImportPreview() {
    const dialog = $('#importDialog');
    const duplicates = importPreview.reduce((sum, r) => sum + Math.max(0, r.duplicates - 1), 0);
    const recognized = importPreview.filter(r => r.employeeId).length;
    const unmatched = importPreview.length - recognized;
    const people = new Set(importPreview.map(r => r.employeeId).filter(Boolean)).size;
    const rows = importPreview.map((r, i) => {
      const notes = [
        r.duplicates > 1 ? badge(`دمج ${fmtNumber(r.duplicates)} بصمات`, 'amber') : '',
        r.ignored > 0 ? badge(`تجاهل ${fmtNumber(r.ignored)} بصمة وسطى`, 'gray') : '',
        r.single ? badge('بصمة واحدة فقط', 'amber') : '',
        r.guessed ? badge('ص/م مُقدَّر', 'blue') : ''
      ].join(' ') || badge('جديدة', 'green');
      return `<tr><td><span class="num-ltr">${esc(fmtDate(r.date))}</span><div class="person-meta">صفحة ${fmtNumber(r.page)}</div></td><td><span class="num-ltr">${esc(r.time)}</span></td><td><select class="import-select" data-preview-employee="${i}">${importEmployeeOptions(r.employeeId)}</select></td><td><select class="import-select" data-preview-type="${i}"><option value="" ${!r.type ? 'selected' : ''}>— اختر —</option><option value="in" ${r.type === 'in' ? 'selected' : ''}>حضور</option><option value="out" ${r.type === 'out' ? 'selected' : ''}>انصراف</option></select></td><td>${notes}</td></tr>`;
    }).join('');
    const newList = Array.from(importNewEmployees.values()).map(e => `${esc(e.name)}${e.code ? ` (${esc(e.code)})` : ''}`).join('، ');
    const body = `<div class="import-summary"><strong>الملف:</strong> ${esc(importFileName)} · ${fmtNumber(importPreview.length)} حركة لـ ${fmtNumber(people)} موظف · ${fmtNumber(recognized)} مرتبطة بموظف${unmatched ? ` · ${fmtNumber(unmatched)} تحتاج تعيينًا` : ''}${duplicates ? ` · تم دمج ${fmtNumber(duplicates)} بصمة مكررة` : ''}<br>• الموظف يُؤخذ من الاسم المكتوب فوق كل عمود، وأول بصمة في اليوم = حضور وآخر بصمة = انصراف (لا تُستخدم خانة الحركة في الملف).${importInfo.inferred ? '<br>• الملف يعرض الوقت بنظام 12 ساعة بدون ص/م، فتم تقدير الصباح/المساء من موعد دوام كل موظف — راجع الصفوف المعلّمة «ص/م مُقدَّر».' : ''}${importInfo.singles ? `<br>• ${fmtNumber(importInfo.singles)} يوم فيه بصمة واحدة فقط (غالبًا يوم لم ينتهِ بعد أو نُسيت بصمته).` : ''}${newList ? `<br>• موظفون غير مسجلين سيُنشؤون عند الاعتماد: ${newList} — اضبط راتبهم ومواعيد دوامهم من صفحة الموظفين.` : ''}<br>إذا كان التاريخ ملتبسًا، ألغِ الاستيراد واضبط ترتيبه من الإعدادات ثم أعد قراءة الملف.</div><div class="table-wrap"><table class="data-table import-table"><thead><tr><th>التاريخ</th><th>الوقت</th><th>الموظف</th><th>العملية</th><th>المراجعة</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    openDialog(dialog, 'مراجعة حركات ملف البصمة', `${fmtNumber(importPreview.length)} حركة مقروءة قبل اعتمادها`, body, `<button class="primary-btn" id="confirmImport">اعتماد الحركات</button><button class="secondary-btn" id="cancelImport">إلغاء</button>`);
    $$('[data-preview-employee]', dialog).forEach(select => select.addEventListener('change', e => { importPreview[Number(e.target.dataset.previewEmployee)].employeeId = e.target.value; }));
    $$('[data-preview-type]', dialog).forEach(select => select.addEventListener('change', e => { importPreview[Number(e.target.dataset.previewType)].type = e.target.value; }));
    $('#cancelImport', dialog).addEventListener('click', () => dialog.close());
    $('#confirmImport', dialog).addEventListener('click', commitImportPreview);
  }

  function commitImportPreview() {
    const known = r => employeeById(r.employeeId) || importNewEmployees.has(r.employeeId);
    const valid = importPreview.filter(r => r.selected && known(r) && (r.type === 'in' || r.type === 'out') && r.date && r.time);
    const skipped = importPreview.length - valid.length;
    if (!valid.length) { toast('لا توجد حركات مكتملة للاعتماد. اربط الموظف وحدد نوع الحركة أولًا.', 'warning'); return; }
    const createdIds = new Map();
    function realEmployeeId(ref) {
      if (employeeById(ref)) return ref;
      if (createdIds.has(ref)) return createdIds.get(ref);
      const info = importNewEmployees.get(ref);
      const normalizedName = normalizeText(info?.name);
      const normalizedCode = normalizeText(info?.code);
      const existing = state.employees.find(e => (normalizedCode && normalizeText(e.code) === normalizedCode) || (normalizedName && normalizeText(e.name) === normalizedName));
      if (existing) { createdIds.set(ref, existing.id); return existing.id; }
      const emp = { id: uid(), name: info.name, code: info.code || '', salary: 0, allowance: 0, shiftStart: '09:00', shiftEnd: '17:00', workDays: state.defaultWorkDays || [0, 1, 2, 3, 4, 6], active: true };
      state.employees.push(emp); createdIds.set(ref, emp.id);
      return emp.id;
    }
    let added = 0, duplicates = 0;
    valid.forEach(row => {
      const rec = { id: uid(), employeeId: realEmployeeId(row.employeeId), date: row.date, time: row.time, type: row.type, source: 'pdf', duplicates: row.duplicates || 1 };
      const existing = state.records.find(r => uniqueKey(r) === uniqueKey(rec));
      if (existing) {
        duplicates += 1;
        existing.duplicates = (Number(existing.duplicates) || 1) + (Number(row.duplicates) || 1);
        if (rec.type === 'in' && rec.time < existing.time) existing.time = rec.time;
        if (rec.type === 'out' && rec.time > existing.time) existing.time = rec.time;
      } else { state.records.push(rec); added++; }
      expandCoverage(rec.date);
    });
    saveState(); $('#importDialog').close(); importPreview = []; importNewEmployees = new Map(); activePage = 'attendance'; renderPage();
    toast(`تم استيراد ${fmtNumber(added)} حركة جديدة ودمج ${fmtNumber(duplicates)} تكرار${createdIds.size ? `، وإضافة ${fmtNumber(createdIds.size)} موظف جديد (اضبط راتبهم من صفحة الموظفين)` : ''}${skipped ? `، وتخطي ${fmtNumber(skipped)} حركة غير مكتملة` : ''}.`);
  }

  function csvCell(value) { return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`; }
  function downloadText(name, text, type = 'text/plain;charset=utf-8') {
    const blob = new Blob(['\ufeff', text], { type });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportAttendance() {
    const rows = state.records.filter(r => r.date.startsWith(selectedMonth)).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const lines = [['الموظف', 'الكود', 'التاريخ', 'العملية', 'الوقت', 'المصدر', 'عدد الحركات المدمجة'], ...rows.map(r => { const e = employeeById(r.employeeId); return [e?.name || '', e?.code || '', r.date, r.type === 'in' ? 'حضور' : 'انصراف', r.time, r.source === 'pdf' ? 'PDF' : 'يدوي', r.duplicates || 1]; })];
    downloadText(`دوامي-الحضور-${selectedMonth}.csv`, lines.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function exportPayroll() {
    const calcs = activeEmployees().map(e => calcPayroll(e, selectedMonth));
    const lines = [['الموظف', 'الكود', 'الراتب الأساسي', 'البدلات', 'أيام مغطاة', 'الغياب', 'دقائق التأخير', 'خصم التأخير والانصراف', 'خصم الغياب', 'خصم السلفة', 'إجمالي الخصم', 'صافي المرتب'], ...calcs.map(x => [x.employee.name, x.employee.code, x.salary, x.allowance, x.hasCoverage ? x.expected : '', x.hasCoverage ? x.absent : '', x.hasCoverage ? x.lateMinutes : '', x.lateDeduction + x.earlyDeduction, x.absenceDeduction, x.loanDeduction, x.deductions, x.net])];
    downloadText(`دوامي-الرواتب-${selectedMonth}.csv`, lines.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function downloadBackup() {
    const backup = { app: 'dawami', version: 1, exportedAt: new Date().toISOString(), data: state };
    downloadText(`نسخة-دوامي-${todayISO}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
    toast('تم تنزيل نسخة البيانات الاحتياطية.');
  }
  function clearData() {
    const ok = confirm('سيتم مسح كل الموظفين والحركات والسلف المحفوظة على هذا المتصفح. لا يمكن التراجع عن المسح. هل نزّلت نسخة احتياطية وتريد المتابعة؟');
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY); state = initialState(); selectedMonth = currentMonth; renderPage(); toast('تم مسح البيانات المحلية.');
  }

  function handleRestore(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const restored = parsed?.data || parsed;
        if (!restored || !Array.isArray(restored.employees) || !Array.isArray(restored.records) || !Array.isArray(restored.loans)) throw new Error('صيغة غير صالحة');
        if (!confirm(`سيتم استبدال البيانات الحالية بـ ${restored.employees.length} موظف و${restored.records.length} حركة. هل تريد المتابعة؟`)) return;
        state = { ...initialState(), ...restored, settings: { ...initialState().settings, ...(restored.settings || {}) }, coverage: { ...initialState().coverage, ...(restored.coverage || {}) }, attendanceEmployeeIds: Array.isArray(restored.attendanceEmployeeIds) && restored.attendanceEmployeeIds.length ? restored.attendanceEmployeeIds : Array.from(new Set(restored.records.map(r => r.employeeId).filter(Boolean))) };
        saveState(); renderPage(); toast('تمت استعادة النسخة الاحتياطية.');
      } catch (error) { console.error(error); toast('ملف النسخة الاحتياطية غير صالح أو تالف.', 'error'); }
    };
    reader.readAsText(file);
  }

  function updateHeader() {
    $('#todayLabel').textContent = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  }

  // Safer PDF import overrides: keep every stamp and require an explicit review before saving.
  function setPdfUploadStatus(kind, fileName, message) {
    pdfUploadStatus = { kind, fileName: fileName || '', message: message || '' };
    const live = $('#pdfUploadStatus');
    if (live) {
      live.hidden = false;
      live.className = 'notice ' + (kind === 'error' ? 'notice-warn' : kind === 'ready' ? 'notice-info' : 'notice-info');
      live.innerHTML = '<span class="notice-icon">' + (kind === 'error' ? '!' : kind === 'loading' ? '…' : 'ⓘ') + '</span><span><strong>' + esc(fileName || '') + '</strong> ' + esc(message || '') + '</span>';
    } else if (activePage === 'attendance') {
      renderPage();
    }
  }

  function clockText(sec) {
    const hh = String(Math.floor(sec / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return Number(ss) ? hh + ':' + mm + ':' + ss : hh + ':' + mm;
  }

  function timeCandidates(p, is24h) {
    const base = p.minute * 60 + p.second;
    if (p.ampm) return [((p.hour % 12) + (p.ampm === 'PM' ? 12 : 0)) * 3600 + base];
    if (p.hour === 0 || p.hour > 12 || is24h) return [p.hour * 3600 + base];
    const am = (p.hour % 12) * 3600 + base;
    return [am, am + 43200];
  }

  async function readPdf(file) {
    const maxBytes = 20 * 1024 * 1024;
    if (!file) return;
    if (!/\.pdf$/i.test(file.name || '') || (file.type && !['application/pdf', 'application/x-pdf'].includes(file.type))) {
      setPdfUploadStatus('error', file.name, 'الملف غير مقبول. اختر ملف PDF صالحًا.');
      toast('الملف غير مقبول. اختر ملف PDF صالحًا.', 'error');
      return;
    }
    if (!file.size || file.size > maxBytes) {
      setPdfUploadStatus('error', file.name, file.size > maxBytes ? 'حجم الملف أكبر من 20 ميجابايت.' : 'الملف فارغ ولا يمكن قراءته.');
      toast(file.size > maxBytes ? 'حجم الملف أكبر من 20 ميجابايت.' : 'الملف فارغ ولا يمكن قراءته.', 'error');
      return;
    }
    if (!window.pdfjsLib) {
      setPdfUploadStatus('error', file.name, 'قارئ PDF غير جاهز. أعد فتح الصفحة وحاول مرة أخرى.');
      toast('قارئ PDF غير جاهز. أعد فتح الصفحة وحاول مرة أخرى.', 'error');
      return;
    }
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = window.DAWAMI_PDF_WORKER_URL;
      setPdfUploadStatus('loading', file.name, 'جارٍ فحص الملف وقراءة صفحاته…');
      toast('تم اختيار «' + file.name + '»؛ جارٍ فحص الملف وقراءة صفحاته…', 'success');
      const data = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') {
        setPdfUploadStatus('error', file.name, 'محتوى الملف لا يطابق ملف PDF صالحًا.');
        toast('محتوى الملف لا يطابق ملف PDF صالحًا.', 'error');
        return;
      }
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const punches = [];
      const pageTexts = [];
      let carry = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const items = content.items.filter(x => x.str && x.str.trim()).map(x => ({ text: x.str.trim(), x: x.transform[4], y: x.transform[5], width: x.width || 0 }));
        pageTexts.push({ page: pageNum, text: items.map(x => x.text).join(' | ') });
        const result = parsePdfPage(items, pageNum, carry);
        punches.push(...result.punches);
        if (result.headers.length) carry = result.headers.map(h => ({ ...h, y: Infinity }));
        if (pageNum === 1 || pageNum % 5 === 0 || pageNum === pdf.numPages) {
          const message = 'جارٍ قراءة صفحة ' + fmtNumber(pageNum) + ' من ' + fmtNumber(pdf.numPages) + '…';
          setPdfUploadStatus('loading', file.name, message);
          toast('جارٍ قراءة «' + file.name + '» — ' + message, 'success');
        }
      }
      const built = buildImportRows(punches);
      importFileName = file.name;
      importPreview = built.rows;
      importNewEmployees = built.newEmployees;
      importInfo = Object.assign({}, built.info, { pageTexts, pageCount: pdf.numPages });
      setPdfUploadStatus('ready', file.name, 'اكتملت المعاينة. راجع الصفوف قبل الحفظ.');
      showImportPreview();
      if (!punches.length) toast('لم أجد حركات بصمة قابلة للقراءة. راجع النص المستخرج؛ ملفات الصور تحتاج OCR.', 'warning');
    } catch (error) {
      console.error(error);
      setPdfUploadStatus('error', file.name, 'تعذر قراءة الملف. تأكد أنه PDF سليم وغير محمي بكلمة مرور.');
      toast('تعذر قراءة «' + file.name + '». تأكد أنه PDF سليم وغير محمي بكلمة مرور.', 'error');
    }
  }

  function buildImportRows(punches) {
    const is24h = punches.some(p => p.hour === 0 || p.hour > 12);
    const newEmployees = new Map();
    const byEmployeeDay = new Map();
    const rows = [];
    punches.forEach(p => {
      let ref = p.employeeId || '';
      if (!ref && p.headerKey) {
        ref = 'new:' + p.headerKey;
        if (!newEmployees.has(ref)) newEmployees.set(ref, { name: p.headerName, code: p.headerCode });
      }
      const timeOptions = timeCandidates(p, is24h).map(clockText);
      const rawTime = String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0') + (p.second ? ':' + String(p.second).padStart(2, '0') : '') + (p.ampm ? ' ' + p.ampm : '');
      const duplicateKey = ref ? ref + '|' + p.date : '';
      const priorRows = duplicateKey ? (byEmployeeDay.get(duplicateKey) || []) : [];
      const possibleSeconds = timeCandidates(p, is24h);
      const near = priorRows.filter(prior => prior.seconds.some(a => possibleSeconds.some(b => Math.abs(a - b) <= 60)));
      const row = {
        employeeId: ref,
        date: p.date,
        time: timeOptions.length === 1 ? timeOptions[0] : '',
        timeOptions,
        secondOptions: possibleSeconds,
        rawTime,
        type: '',
        page: p.page,
        source: 'pdf',
        selected: true,
        duplicateCandidate: near.length > 0,
        timeNeedsReview: timeOptions.length > 1,
        autoDraft: true
      };
      near.forEach(prior => { prior.row.duplicateCandidate = true; });
      rows.push(row);
      if (duplicateKey) {
        priorRows.push({ seconds: possibleSeconds, row });
        byEmployeeDay.set(duplicateKey, priorRows);
      }
    });
    const nameOf = r => normalizeText(employeeById(r.employeeId)?.name || newEmployees.get(r.employeeId)?.name || '~');
    rows.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.date.localeCompare(b.date) || a.page - b.page || a.rawTime.localeCompare(b.rawTime));
    applySmartImportDraft(rows, newEmployees);
    return {
      rows,
      newEmployees,
      info: {
        is24h,
        punchCount: rows.length,
        duplicates: rows.filter(r => r.duplicateCandidate).length,
        ambiguousTimes: rows.filter(r => r.timeNeedsReview).length,
        selectedRows: rows.filter(r => r.selected).length,
        completeDays: countImportGroups(rows, group => group.filter(r => r.selected && r.type && r.time).length >= 2),
        singleDays: countImportGroups(rows, group => group.filter(r => r.selected && r.type && r.time).length === 1),
        autoExcluded: rows.filter(r => !r.selected).length
      }
    };
  }

  function countImportGroups(rows, predicate) {
    const groups = new Map();
    rows.forEach(row => {
      if (!row.employeeId || !row.date) return;
      const key = row.employeeId + '|' + row.date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    let count = 0;
    groups.forEach(group => { if (predicate(group)) count++; });
    return count;
  }

  function importEmployee(ref, newEmployees) {
    return employeeById(ref) || newEmployees.get(ref) || null;
  }

  function importShiftWindow(employee) {
    const start = employee?.shiftStart ? clockSeconds(employee.shiftStart) : 9 * 3600;
    let end = employee?.shiftEnd ? clockSeconds(employee.shiftEnd) : start + (Number(state.settings.workHours) || 8) * 3600;
    if (end <= start) end += 86400;
    return { start, end, known: !!(employee?.shiftStart && employee?.shiftEnd) };
  }

  function clockSeconds(time) {
    const parts = String(time || '').split(':').map(Number);
    return ((parts[0] || 0) * 3600) + ((parts[1] || 0) * 60) + (parts[2] || 0);
  }

  function normalizedCandidates(row, shift) {
    const options = row.secondOptions && row.secondOptions.length ? row.secondOptions : (row.timeOptions || []).map(clockSeconds);
    return Array.from(new Set(options.flatMap(sec => {
      const values = [sec];
      if (shift.end > 86400 && sec < shift.start) values.push(sec + 86400);
      return values;
    }))).sort((a, b) => a - b);
  }

  function bestGroupSeconds(group, shift) {
    const candidates = group.map(row => normalizedCandidates(row, shift));
    if (!candidates.length || candidates.some(list => !list.length)) return new Map();
    let best = null;
    let bestScore = Infinity;
    const maxChoices = candidates.reduce((total, list) => total * Math.max(1, list.length), 1);
    const scoreChoice = choice => {
      const ordered = choice.slice().sort((a, b) => a - b);
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const expectedSpan = Math.max(0, shift.end - shift.start);
      const actualSpan = Math.max(0, last - first);
      let score = Math.abs(first - shift.start) * (shift.known ? 1.4 : 0.45);
      score += Math.abs(last - shift.end) * (shift.known ? 1.15 : 0.45);
      if (ordered.length > 1) score += Math.abs(actualSpan - expectedSpan) * (shift.known ? 0.18 : 0.08);
      ordered.forEach(sec => {
        if (sec < shift.start - 6 * 3600) score += (shift.start - 6 * 3600 - sec) * 2;
        if (sec > shift.end + 6 * 3600) score += (sec - shift.end - 6 * 3600) * 2;
      });
      return score;
    };
    const visit = (index, choice) => {
      if (index === candidates.length) {
        const score = scoreChoice(choice);
        if (score < bestScore) { bestScore = score; best = choice.slice(); }
        return;
      }
      candidates[index].forEach(sec => {
        choice.push(sec);
        visit(index + 1, choice);
        choice.pop();
      });
    };
    if (maxChoices <= 512) visit(0, []);
    else {
      best = candidates.map(list => list.reduce((a, b) => (
        Math.min(Math.abs(a - shift.start), Math.abs(a - shift.end)) <= Math.min(Math.abs(b - shift.start), Math.abs(b - shift.end)) ? a : b
      )));
    }
    const result = new Map();
    (best || []).forEach((sec, index) => result.set(group[index], sec));
    return result;
  }

  function groupImportRows(rows) {
    const groups = new Map();
    rows.forEach(row => {
      if (!row.employeeId || !row.date) return;
      const key = row.employeeId + '|' + row.date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  function applySmartImportDraft(rows, newEmployees) {
    rows.forEach(row => {
      row.selected = true;
      row.type = '';
      row.autoExcludedReason = '';
      row.singleCandidate = false;
      row.autoTypeChoice = false;
      row.duplicateCandidate = false;
      row.duplicateCount = 1;
    });
    groupImportRows(rows).forEach(group => {
      const employee = importEmployee(group[0].employeeId, newEmployees);
      const shift = importShiftWindow(employee);
      const secondMap = bestGroupSeconds(group, shift);
      group.forEach(row => {
        const picked = secondMap.get(row);
        if (Number.isFinite(picked)) {
          row.time = clockText(((picked % 86400) + 86400) % 86400);
          row.autoTimeChoice = row.timeNeedsReview;
        }
      });
      const clusters = [];
      group.filter(row => row.time).sort((a, b) => clockSeconds(a.time) - clockSeconds(b.time) || a.page - b.page || a.rawTime.localeCompare(b.rawTime)).forEach(row => {
        const sec = clockSeconds(row.time);
        const cluster = clusters.find(item => item.rows.some(existing => Math.abs(clockSeconds(existing.time) - sec) <= 60));
        if (cluster) cluster.rows.push(row);
        else clusters.push({ rows: [row] });
      });
      const representatives = clusters.map(cluster => {
        cluster.rows.sort((a, b) => a.page - b.page || a.rawTime.localeCompare(b.rawTime));
        cluster.rows.forEach((row, index) => {
          row.duplicateCandidate = row.duplicateCandidate || cluster.rows.length > 1;
          row.selected = index === 0;
          row.duplicateCount = cluster.rows.length;
          if (index > 0) row.autoExcludedReason = 'تكرار قريب';
        });
        return cluster.rows[0];
      }).filter(Boolean);
      representatives.sort((a, b) => clockSeconds(a.time) - clockSeconds(b.time));
      if (representatives.length === 1) {
        const row = representatives[0];
        const sec = clockSeconds(row.time);
        row.type = Math.abs(sec - shift.end) < Math.abs(sec - shift.start) ? 'out' : 'in';
        row.singleCandidate = true;
        row.autoTypeChoice = true;
        return;
      }
      if (representatives.length >= 2) {
        representatives.forEach((row, index) => {
          row.selected = index === 0 || index === representatives.length - 1;
          row.type = index === 0 ? 'in' : index === representatives.length - 1 ? 'out' : '';
          row.autoTypeChoice = row.selected;
          if (!row.selected) row.autoExcludedReason = 'بصمة وسط اليوم';
        });
      }
    });
    rows.forEach(row => {
      if (!row.employeeId) {
        row.selected = false;
        row.autoExcludedReason = 'موظف غير معروف';
      }
      if (!row.time) {
        row.selected = false;
        row.autoExcludedReason = 'وقت غير واضح';
      }
    });
  }

  function showImportPreview() {
    const dialog = $('#importDialog');
    const recognized = importPreview.filter(r => r.employeeId).length;
    const unmatched = importPreview.length - recognized;
    const people = new Set(importPreview.map(r => r.employeeId).filter(Boolean)).size;
    const selectedReady = importPreview.filter(r => r.selected && r.employeeId && r.time && r.type).length;
    const excluded = importPreview.filter(r => !r.selected).length;
    const tableRows = importPreview.map((r, i) => {
      const notes = [
        r.autoExcludedReason ? badge('مستبعد تلقائيًا: ' + r.autoExcludedReason, 'gray') : '',
        r.duplicateCandidate ? badge('تكرار قريب', 'amber') : '',
        r.singleCandidate ? badge('بصمة واحدة — راجع الناقص', 'amber') : '',
        r.timeNeedsReview ? badge('ص/م مقدّر', 'blue') : '',
        r.autoTypeChoice && r.selected ? badge('عملية مقترحة', 'green') : '',
        !r.employeeId ? badge('اربط الموظف', 'red') : ''
      ].filter(Boolean).join(' ') || badge('جاهزة للمراجعة', 'green');
      const options = (r.timeOptions || []).map(time => {
        const hour = Number(time.slice(0, 2));
        const suffix = r.timeNeedsReview ? (hour === 0 || (hour > 0 && hour < 12) ? ' ص' : ' م') : '';
        return '<option value="' + esc(time) + '" ' + (r.time === time ? 'selected' : '') + '>' + esc(time + suffix) + '</option>';
      }).join('');
      return '<tr>' +
        '<td><input type="checkbox" data-preview-selected="' + i + '" ' + (r.selected ? 'checked' : '') + ' aria-label="تضمين البصمة ' + fmtNumber(i + 1) + '"></td>' +
        '<td><span class="num-ltr">' + esc(fmtDate(r.date)) + '</span><div class="person-meta">صفحة ' + fmtNumber(r.page) + '</div></td>' +
        '<td><span class="num-ltr raw-time">' + esc(r.rawTime) + '</span><select class="import-select" data-preview-time="' + i + '"><option value="">' + (r.timeNeedsReview ? 'حدد الوقت' : '—') + '</option>' + options + '</select></td>' +
        '<td><select class="import-select" data-preview-employee="' + i + '">' + importEmployeeOptions(r.employeeId) + '</select></td>' +
        '<td><select class="import-select" data-preview-type="' + i + '"><option value="">— اختر العملية —</option><option value="in" ' + (r.type === 'in' ? 'selected' : '') + '>حضور</option><option value="out" ' + (r.type === 'out' ? 'selected' : '') + '>انصراف</option></select></td>' +
        '<td>' + notes + '</td></tr>';
    }).join('');
    const pages = (importInfo.pageTexts || []).map(p =>
      '<details class="pdf-page-review"><summary>النص المستخرج من صفحة ' + fmtNumber(p.page) + '</summary><div class="pdf-page-text" dir="auto">' + esc(p.text || 'لم يُستخرج نص من هذه الصفحة.') + '</div></details>'
    ).join('');
     const summary = '<div class="import-summary"><strong>الملف المختار:</strong> ' + esc(importFileName) +
      ' · ' + fmtNumber(importPreview.length) + ' بصمة منفصلة · ' + fmtNumber(recognized) + ' مرتبطة بموظف من ' + fmtNumber(people) + ' موظف' +
      ' · ' + fmtNumber(selectedReady) + ' حركة جاهزة للحفظ' +
      (unmatched ? ' · ' + fmtNumber(unmatched) + ' تحتاج تعيينًا' : '') +
      (importInfo.duplicates ? ' · ' + fmtNumber(importInfo.duplicates) + ' تكرار محتمل' : '') +
      (importInfo.ambiguousTimes ? ' · ' + fmtNumber(importInfo.ambiguousTimes) + ' وقتًا يحتاج تحديد ص/م' : '') +
      (excluded ? ' · ' + fmtNumber(excluded) + ' مستبعد تلقائيًا من المسودة' : '') +
        '<br>بنيت لك مسودة تلقائية: أول بصمة في اليوم حضور، وآخر بصمة انصراف، والأوقات 12 ساعة تُقدّر حسب وردية الموظف إن وجدت. بعد الحفظ تظهر الحضور والانصراف والتأخير ومسودة الرواتب فورًا، وتبقى الصفوف المعلمة واضحة للمراجعة والتعديل.</div>';
    const suggestion = '<button class="secondary-btn small-btn" id="suggestImportTypes">إعادة بناء المسودة تلقائيًا</button>';
    const table = importPreview.length ?
      '<div class="table-wrap"><table class="data-table import-table"><thead><tr><th>تضمين</th><th>التاريخ / الصفحة</th><th>الوقت في الملف / الوقت المحوّل</th><th>الموظف</th><th>العملية</th><th>المراجعة</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' :
      '<div class="notice notice-warn">لم تُستخرج حركات بصمة. النص الموجود في الصفحات أدناه متاح للمراجعة.</div>';
    const reviewed = '<label class="review-confirm"><input type="checkbox" id="importReviewed"> راجعت المسودة وأوافق على حفظ الصفوف المحددة، مع بقاء العلامات المعلمة ظاهرة للمراجعة.</label>';
    const body = summary + (importPreview.length ? suggestion + table : table) + reviewed + pages;
    openDialog(dialog, 'مراجعة حركات ملف البصمة', fmtNumber(importPreview.length) + ' بصمة من ' + fmtNumber(importInfo.pageCount || 0) + ' صفحة', body,
      '<button class="primary-btn" id="confirmImport">حفظ المسودة وفتح النتائج</button><button class="secondary-btn" id="cancelImport">إلغاء</button>');
    $$('[data-preview-selected]', dialog).forEach(input => input.addEventListener('change', e => { importPreview[Number(e.target.dataset.previewSelected)].selected = e.target.checked; }));
    $$('[data-preview-employee]', dialog).forEach(select => select.addEventListener('change', e => { importPreview[Number(e.target.dataset.previewEmployee)].employeeId = e.target.value; }));
    $$('[data-preview-time]', dialog).forEach(select => select.addEventListener('change', e => { importPreview[Number(e.target.dataset.previewTime)].time = e.target.value; }));
    $$('[data-preview-type]', dialog).forEach(select => select.addEventListener('change', e => { importPreview[Number(e.target.dataset.previewType)].type = e.target.value; }));
    $('#suggestImportTypes', dialog)?.addEventListener('click', () => {
      applySmartImportDraft(importPreview, importNewEmployees);
      if (dialog.open) dialog.close();
      showImportPreview();
      toast('تمت إعادة بناء المسودة تلقائيًا من بيانات الملف والورديات الحالية.');
    });
    $('#cancelImport', dialog).addEventListener('click', () => dialog.close());
    $('#confirmImport', dialog).addEventListener('click', commitImportPreview);
  }

  function commitImportPreview() {
    const dialog = $('#importDialog');
    if (!$('#importReviewed', dialog)?.checked) {
      toast('أكد مراجعة الصفوف المحددة قبل حفظها.', 'warning');
      return;
    }
    const known = r => employeeById(r.employeeId) || importNewEmployees.has(r.employeeId);
    const selected = importPreview.filter(r => r.selected);
    const incomplete = selected.filter(r => !known(r) || !['in', 'out'].includes(r.type) || !r.date || !r.time);
    if (incomplete.length) {
      toast('هناك ' + fmtNumber(incomplete.length) + ' صفوف محددة تحتاج موظفًا ووقتًا وعملية، أو أزل علامة التضمين عنها.', 'warning');
      return;
    }
    if (!selected.length) { toast('حدد بصمة مكتملة واحدة على الأقل بعد مراجعتها.', 'warning'); return; }
     const previous = JSON.parse(JSON.stringify(state));
     state.records = [];
     state.absenceReviews = {};
     state.dayReviews = {};
     state.attendanceEmployeeIds = [];
     state.coverage = { start: '', end: '' };
    const createdIds = new Map();
    function realEmployeeId(ref) {
      if (employeeById(ref)) return ref;
      if (createdIds.has(ref)) return createdIds.get(ref);
      const info = importNewEmployees.get(ref);
      const normalizedName = normalizeText(info?.name);
      const normalizedCode = normalizeText(info?.code);
      const existing = state.employees.find(e =>
        (normalizedCode && normalizeText(e.code) === normalizedCode) ||
        (normalizedName && normalizeText(e.name) === normalizedName)
      );
      if (existing) { createdIds.set(ref, existing.id); return existing.id; }
      const employee = { id: uid(), name: info.name, code: info.code || '', salary: 0, dailyRate: 0, hourlyRate: 0, allowance: 0, payModel: '', site: '', shiftStart: '', shiftEnd: '', workDays: [], active: true, setupRequired: true };
      state.employees.push(employee);
      createdIds.set(ref, employee.id);
      return employee.id;
    }
    let duplicateCount = 0;
    let reviewCount = 0;
    selected.forEach(row => {
      const employeeId = realEmployeeId(row.employeeId);
      const needsManualReview = !!(row.duplicateCandidate || row.timeNeedsReview || row.singleCandidate);
      if (needsManualReview) reviewCount++;
      state.records.push({
        id: uid(), employeeId, date: row.date, time: row.time, type: row.type, source: 'pdf',
        sourcePage: row.page, sourceFile: importFileName, rawTime: row.rawTime,
        duplicateCandidate: !!row.duplicateCandidate,
        duplicateCount: row.duplicateCount || 1,
        timeNeedsReview: !!row.timeNeedsReview,
        singleCandidate: !!row.singleCandidate,
        autoDraft: true,
        reviewed: !needsManualReview
      });
      if (row.duplicateCandidate) duplicateCount++;
      state.absenceReviews = state.absenceReviews || {};
      delete state.absenceReviews[employeeId + '|' + row.date];
      state.dayReviews = state.dayReviews || {};
      delete state.dayReviews[employeeId + '|' + row.date];
      expandCoverage(row.date);
    });
    state.attendanceEmployeeIds = Array.from(new Set(state.records.map(record => record.employeeId).filter(Boolean)));
    const monthCounts = new Map();
    selected.forEach(row => { const month = row.date.slice(0, 7); monthCounts.set(month, (monthCounts.get(month) || 0) + 1); });
    selectedMonth = Array.from(monthCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    if (!saveState()) { state = previous; return; }
    dialog.close();
    importPreview = [];
    importNewEmployees = new Map();
    activePage = 'attendance';
    attendanceView = 'events';
    renderPage();
    toast('تم حفظ ' + fmtNumber(selected.length) + ' حركة منفصلة من «' + importFileName + '» في ' + monthLabel(selectedMonth) +
      (duplicateCount ? ' — يوجد ' + fmtNumber(duplicateCount) + ' تكرار محتمل راجعه في السجل.' : '') +
      (reviewCount ? ' — يوجد ' + fmtNumber(reviewCount) + ' حركة معلمة للمراجعة.' : '') +
      (createdIds.size ? ' — بيانات وردية/موقع/أجر الموظفين الجدد تحتاج إعدادًا.' : ''));
  }

  let attendanceSiteFilter = 'all';

  function hasActiveAttendanceScope() {
    return (Array.isArray(state.attendanceEmployeeIds) && state.attendanceEmployeeIds.length > 0) || state.records.length > 0;
  }
  function isInCurrentAttendance(employee) {
    if (Array.isArray(state.attendanceEmployeeIds) && state.attendanceEmployeeIds.length) return state.attendanceEmployeeIds.includes(employee.id);
    return state.records.some(record => record.employeeId === employee.id);
  }
  function reportEmployees() {
    const employees = activeEmployees();
    return hasActiveAttendanceScope() ? employees.filter(isInCurrentAttendance) : employees;
  }

  function dayReviewKey(employeeId, date) { return employeeId + '|' + date; }
  function payModelLabel(employee) {
    const model = employee.payModel || (employee.setupRequired ? '' : 'monthly');
    return model === 'monthly' ? 'راتب شهري' : model === 'daily' ? 'أجر يومي' : model === 'hourly' ? 'أجر بالساعة' : 'نظام الأجر غير محدد';
  }
  function payRateLabel(employee) {
    const model = employee.payModel || (employee.setupRequired ? '' : 'monthly');
    if (model === 'daily') return fmtMoney(employee.dailyRate) + ' ج.م / يوم';
    if (model === 'hourly') return fmtMoney(employee.hourlyRate) + ' ج.م / ساعة';
    if (model === 'monthly') return fmtMoney(employee.salary) + ' ج.م / شهر';
    return 'غير محدد';
  }

  function calcDaily(employee, date) {
    const dayRecords = recordsFor(employee.id, date);
    const ins = dayRecords.filter(r => r.type === 'in').map(r => r.time).sort();
    const outs = dayRecords.filter(r => r.type === 'out').map(r => r.time).sort();
    const firstIn = ins[0] || '';
    const lastOut = outs[outs.length - 1] || '';
    const hasShiftStart = !!employee.shiftStart;
    const hasShiftEnd = !!employee.shiftEnd;
    const start = hasShiftStart ? timeMinutes(employee.shiftStart) : null;
    let end = hasShiftEnd ? timeMinutes(employee.shiftEnd) : null;
    let inMin = firstIn ? timeMinutes(firstIn) : null;
    let outMin = lastOut ? timeMinutes(lastOut) : null;
    if (start !== null && end !== null && end <= start) end += 1440;
    if (start !== null && inMin !== null && inMin < start && end !== null && end > 1440) inMin += 1440;
    if (start !== null && outMin !== null && outMin < start && end !== null && end > 1440) outMin += 1440;
    if (inMin !== null && outMin !== null && outMin < inMin) outMin += 1440;
    const grace = Number(state.settings.graceMinutes) || 0;
    const late = firstIn && start !== null ? Math.max(0, inMin - start - grace) : 0;
    const early = lastOut && end !== null ? Math.max(0, end - outMin) : 0;
    const worked = firstIn && lastOut ? Math.max(0, outMin - inMin) : 0;
    const workDays = Array.isArray(employee.workDays) ? employee.workDays : [];
    const scheduledKnown = workDays.length > 0;
    const scheduled = scheduledKnown ? workDays.includes(new Date(date + 'T12:00:00').getDay()) : null;
    const key = dayReviewKey(employee.id, date);
    const decision = (state.absenceReviews || {})[key] || '';
    const absenceCandidate = scheduled === true && withinCoverage(date) && dayRecords.length === 0;
    const dayReviewed = !!(state.dayReviews || {})[key] || (dayRecords.length > 0 && dayRecords.every(r => r.reviewed));
    const riskyPunch = dayRecords.some(r => r.duplicateCandidate || r.timeNeedsReview || r.singleCandidate);
    const completePair = ins.length === 1 && outs.length === 1 && dayRecords.length === 2;
    const needsPunchReview = dayRecords.length > 0 && (!completePair || riskyPunch) && !dayReviewed;
    return {
      records: dayRecords, firstIn, lastOut, late, early, worked, scheduled, scheduledKnown,
      absenceCandidate, absenceDecision: decision, absent: absenceCandidate && decision === 'absent',
      completePair, needsPunchReview, riskyPunch, dayReviewed
    };
  }

  function calcPayroll(employee, month) {
    const start = localMonthStart(month);
    const end = localMonthEnd(month);
    const coverage = getCoverage();
    const scanStart = coverage.start && coverage.start > start ? coverage.start : start;
    const scanEndRaw = coverage.end && coverage.end < end ? coverage.end : end;
    const scanEnd = scanEndRaw > todayISO ? todayISO : scanEndRaw;
    const hasCoverage = isInCurrentAttendance(employee) && !!coverage.start && !!coverage.end && scanStart <= scanEnd;
    let expected = 0, absent = 0, pendingAbsences = 0, pendingPunches = 0, lateMinutes = 0, earlyMinutes = 0, workedMinutes = 0, attendedDays = 0;
    if (hasCoverage) {
      let cursor = new Date(scanStart + 'T12:00:00');
      const last = new Date(scanEnd + 'T12:00:00');
      while (cursor <= last) {
        const date = toISODate(cursor);
        const day = calcDaily(employee, date);
        if (day.scheduled === true) {
          expected++;
          if (day.absenceCandidate) {
            if (day.absenceDecision === 'absent') absent++;
            else if (day.absenceDecision !== 'not-absent') pendingAbsences++;
          } else if (day.records.length) {
            if (day.needsPunchReview) pendingPunches++;
            if (day.firstIn && day.lastOut) attendedDays++;
            lateMinutes += day.late;
            earlyMinutes += day.early;
            workedMinutes += day.worked;
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const model = employee.payModel || (employee.setupRequired ? '' : 'monthly');
    const salary = Number(employee.salary) || 0;
    const dailyRate = Number(employee.dailyRate) || 0;
    const hourlyRate = Number(employee.hourlyRate) || 0;
    const allowance = Number(employee.allowance) || 0;
    const salaryDays = Number(state.settings.salaryDays) || 26;
    const workHours = Number(state.settings.workHours) || 8;
    const selectedRate = model === 'daily' ? dailyRate : model === 'hourly' ? hourlyRate : salary;
    const rateValid = ['monthly', 'daily', 'hourly'].includes(model) && Number.isFinite(selectedRate) && selectedRate >= 0;
    const scheduleValid = Array.isArray(employee.workDays) && employee.workDays.length > 0 && !!employee.shiftStart && !!employee.shiftEnd;
    const siteValid = !!String(employee.site || '').trim();
    const setupIssues = [];
    if (!model) setupIssues.push('نظام الأجر');
    if (!rateValid) setupIssues.push('قيمة الأجر');
    if (!scheduleValid) setupIssues.push('الموقع/الوردية/أيام العمل');
    if (!siteValid) setupIssues.push('الموقع');
    let gross = 0, lateDeduction = 0, earlyDeduction = 0, absenceDeduction = 0;
    const minuteRate = model === 'daily' ? dailyRate / (workHours * 60) : salary / salaryDays / (workHours * 60);
    const lateRate = Number(state.settings.latePerMinute) > 0 ? Number(state.settings.latePerMinute) : minuteRate;
    const earlyRate = Number(state.settings.earlyPerMinute) > 0 ? Number(state.settings.earlyPerMinute) : minuteRate;
    if (model === 'monthly') {
      gross = salary + allowance;
      lateDeduction = lateMinutes * lateRate;
      earlyDeduction = earlyMinutes * earlyRate;
      absenceDeduction = absent * (salary / salaryDays) * (Number(state.settings.absenceDays) || 1);
    } else if (model === 'daily') {
      gross = attendedDays * dailyRate + allowance;
      lateDeduction = lateMinutes * lateRate;
      earlyDeduction = earlyMinutes * earlyRate;
    } else if (model === 'hourly') {
      gross = (workedMinutes / 60) * hourlyRate + allowance;
    }
    const periodDeductions = state.loans.filter(l => l.employeeId === employee.id).reduce((sum, loan) => sum + loanDeduction(loan, month), 0);
    const deductions = lateDeduction + earlyDeduction + absenceDeduction + periodDeductions;
    const pending = pendingAbsences + pendingPunches;
    const ready = hasCoverage && pending === 0 && setupIssues.length === 0;
    return {
      employee, expected, absent, pendingAbsences, pendingPunches, pending, attendedDays, lateMinutes, earlyMinutes,
      workedMinutes, salary, dailyRate, hourlyRate, allowance, gross, lateDeduction, earlyDeduction,
      absenceDeduction, loanDeduction: periodDeductions, deductions, net: gross - deductions, hasCoverage,
      payModel: model, rateValid, setupIssues, ready
    };
  }

  function showEmployeeDialog(id = '') {
    const dialog = $('#employeeDialog');
    const employee = id ? employeeById(id) : null;
    const defaultDays = employee ? (Array.isArray(employee.workDays) ? employee.workDays : []) : (state.defaultWorkDays || [0, 1, 2, 3, 4, 6]);
    const dayChecks = DAY_NAMES.map((day, i) => '<label class="check-chip"><input type="checkbox" name="workDays" value="' + i + '" ' + (defaultDays.includes(i) ? 'checked' : '') + '>' + day + '</label>').join('');
    const model = employee ? (employee.setupRequired ? (employee.payModel || '') : (employee.payModel || 'monthly')) : 'monthly';
    const siteNames = Array.from(new Set(state.employees.map(e => String(e.site || '').trim()).filter(Boolean))).sort();
    const siteOptions = siteNames.map(site => '<option value="' + esc(site) + '"></option>').join('');
    const body = '<form id="employeeForm"><input type="hidden" name="id" value="' + esc(employee?.id || '') + '">' +
      '<div class="field-grid">' +
      '<div class="field"><label for="employeeName">اسم الموظف *</label><input id="employeeName" name="name" required maxlength="80" value="' + esc(employee?.name || '') + '" placeholder="مثال: أحمد محمد"></div>' +
      '<div class="field"><label for="employeeCode">الكود في جهاز البصمة</label><input id="employeeCode" name="code" maxlength="40" value="' + esc(employee?.code || '') + '" placeholder="مثال: 31"></div>' +
      '<div class="field"><label for="employeeSite">الموقع</label><input id="employeeSite" name="site" maxlength="80" list="employeeSiteOptions" value="' + esc(employee?.site || '') + '" placeholder="مثال: فرع المعرض"><datalist id="employeeSiteOptions">' + siteOptions + '</datalist></div>' +
      '<div class="field"><label for="employeePayModel">نظام الأجر *</label><select id="employeePayModel" name="payModel" required><option value="" ' + (!model ? 'selected' : '') + '>— اختر النظام —</option><option value="monthly" ' + (model === 'monthly' ? 'selected' : '') + '>راتب شهري</option><option value="daily" ' + (model === 'daily' ? 'selected' : '') + '>أجر يومي</option><option value="hourly" ' + (model === 'hourly' ? 'selected' : '') + '>أجر بالساعة</option></select></div>' +
      '<div class="field"><label for="employeeSalary">الراتب الشهري الأساسي (ج.م)</label><input id="employeeSalary" name="salary" type="number" min="0" step="0.01" value="' + esc(employee?.salary ?? '') + '"></div>' +
      '<div class="field"><label for="employeeDailyRate">الأجر لكل يوم (ج.م)</label><input id="employeeDailyRate" name="dailyRate" type="number" min="0" step="0.01" value="' + esc(employee?.dailyRate ?? '') + '"></div>' +
      '<div class="field"><label for="employeeHourlyRate">الأجر لكل ساعة (ج.م)</label><input id="employeeHourlyRate" name="hourlyRate" type="number" min="0" step="0.01" value="' + esc(employee?.hourlyRate ?? '') + '"></div>' +
      '<div class="field"><label for="employeeAllowance">بدل شهري إضافي (ج.م)</label><input id="employeeAllowance" name="allowance" type="number" min="0" step="0.01" value="' + esc(employee?.allowance ?? 0) + '"></div>' +
      '<div class="field"><label for="employeeStart">موعد الحضور</label><input id="employeeStart" name="shiftStart" type="time" value="' + esc(employee?.shiftStart || '') + '"></div>' +
      '<div class="field"><label for="employeeEnd">موعد الانصراف</label><input id="employeeEnd" name="shiftEnd" type="time" value="' + esc(employee?.shiftEnd || '') + '"></div>' +
      '</div><div style="margin-top:14px"><div class="field"><label>أيام العمل</label><div class="checkbox-grid">' + dayChecks + '</div><span class="field-help">الأيام والوردية لكل موظف. البيانات غير المحددة تظل ناقصة ولا تُستنتج من ملف البصمة.</span></div></div>' +
      '<div class="field-help">الأجر اليومي يُحسب عن أيام الحضور المكتملة، والأجر بالساعة عن الوقت بين الحضور والانصراف. كشوف المرتبات تظل مسودة للمراجعة.</div>' +
      '<div class="dialog-actions" style="padding:15px 0 0;border:0"><button class="primary-btn" type="submit">' + (employee ? 'حفظ التعديلات' : 'إضافة الموظف') + '</button><button class="secondary-btn" type="button" data-close>إلغاء</button></div></form>';
    openDialog(dialog, employee ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد', 'الموقع والوردية ونظام الأجر بيانات مستقلة لكل موظف.', body);
    $('[data-close]', dialog).addEventListener('click', () => dialog.close());
    $('#employeeForm', dialog).addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const name = String(fd.get('name') || '').trim();
      const code = String(fd.get('code') || '').trim();
      const site = String(fd.get('site') || '').trim();
      const payModel = String(fd.get('payModel') || '');
      const salaryRaw = String(fd.get('salary') || '').trim();
      const dailyRaw = String(fd.get('dailyRate') || '').trim();
      const hourlyRaw = String(fd.get('hourlyRate') || '').trim();
      const salary = Number(salaryRaw);
      const dailyRate = Number(dailyRaw);
      const hourlyRate = Number(hourlyRaw);
      const rateRaw = payModel === 'daily' ? dailyRaw : payModel === 'hourly' ? hourlyRaw : salaryRaw;
      const rate = payModel === 'daily' ? dailyRate : payModel === 'hourly' ? hourlyRate : salary;
      if (!name || !['monthly', 'daily', 'hourly'].includes(payModel) || !rateRaw || !Number.isFinite(rate) || rate < 0) {
        toast('أكمل الاسم ونظام الأجر وقيمة الأجر المناسبة له.', 'warning');
        return;
      }
      const normalizedName = normalizeText(name);
      const normalizedCode = normalizeText(code);
      const clash = state.employees.find(x => x.id !== (employee?.id || '') && ((normalizedCode && normalizeText(x.code) === normalizedCode) || (normalizedName && normalizeText(x.name) === normalizedName)));
      if (clash) { toast(normalizeText(clash.name) === normalizedName ? 'هذا الموظف مسجل بالفعل. افتح سجله للتعديل.' : 'هذا الكود مرتبط بموظف آخر.', 'error'); return; }
      const workDays = $$('input[name="workDays"]:checked', e.currentTarget).map(el => Number(el.value));
      const shiftStart = String(fd.get('shiftStart') || '');
      const shiftEnd = String(fd.get('shiftEnd') || '');
      const setupRequired = !site || !workDays.length || !shiftStart || !shiftEnd;
      const data = {
        id: employee?.id || uid(), name, code, site, payModel,
        salary: Number.isFinite(salary) ? salary : 0,
        dailyRate: Number.isFinite(dailyRate) ? dailyRate : 0,
        hourlyRate: Number.isFinite(hourlyRate) ? hourlyRate : 0,
        allowance: Number(fd.get('allowance')) || 0,
        shiftStart, shiftEnd, workDays, setupRequired, active: employee?.active !== false
      };
      if (employee) Object.assign(employee, data); else state.employees.push(data);
      if (!saveState()) return;
      dialog.close(); renderPage();
      toast(employee ? 'تم حفظ تعديلات الموظف.' : 'تمت إضافة الموظف.');
    });
  }

  function renderEmployees() {
    const list = employeesShowInactive ? state.employees : activeEmployees();
    const actions = '<button class="secondary-btn" data-action="toggle-inactive">' + (employeesShowInactive ? 'إخفاء غير النشطين' : 'عرض غير النشطين') + '</button><button class="primary-btn" data-action="add-employee">＋ إضافة موظف</button>';
    const cards = list.map(e => {
      const days = (e.workDays || []).map(d => DAY_SHORT[d]).join('، ') || 'غير محددة';
      const pay = calcPayroll(e, selectedMonth);
      const reportValue = isInCurrentAttendance(e) ? fmtMoney(pay.net) + ' ج.م' : '—';
      const shift = e.shiftStart && e.shiftEnd ? e.shiftStart + ' – ' + e.shiftEnd : 'غير محددة';
      return '<article class="employee-card"><div class="employee-card-top"><div style="display:flex;align-items:center;gap:10px"><span class="avatar">' + esc(initials(e.name)) + '</span><div><h3>' + esc(e.name) + ' ' + (e.active === false ? badge('غير نشط', 'gray') : '') + '</h3><div class="code-line">' + esc(e.code ? 'كود ' + e.code : 'بدون كود') + ' · ' + esc(e.site || 'الموقع غير محدد') + '</div></div></div><div class="card-actions"><button class="icon-action" data-action="edit-employee" data-id="' + esc(e.id) + '">تعديل</button>' + (e.active === false ? '<button class="icon-action" data-action="activate-employee" data-id="' + esc(e.id) + '">تفعيل</button>' : '<button class="icon-action" data-action="deactivate-employee" data-id="' + esc(e.id) + '">إيقاف</button>') + '</div></div>' +
        '<div class="employee-meta-grid"><div><span>نظام الأجر</span><strong>' + esc(payModelLabel(e)) + '</strong></div><div><span>قيمة الأجر</span><strong>' + esc(payRateLabel(e)) + '</strong></div><div><span>بدل شهري</span><strong>' + fmtMoney(e.allowance) + ' ج.م</strong></div><div><span>صافي مسودة ' + esc(monthLabel(selectedMonth)) + '</span><strong class="salary-highlight">' + reportValue + '</strong></div><div><span>موعد الدوام</span><strong><span class="num-ltr">' + esc(shift) + '</span></strong></div><div><span>أيام العمل</span><strong>' + esc(days) + '</strong></div></div>' +
        (pay.ready ? '<div class="field-help">المعلومات مكتملة للحساب المبدئي؛ كشف المرتب يظل مسودة للمراجعة.</div>' : !isInCurrentAttendance(e) ? '<div class="field-help">لا توجد بصمات لهذا الموظف في ملف الحضور الحالي.</div>' : '<div class="field-help">' + badge('بيانات ناقصة للمراجعة', 'amber') + ' ' + esc(pay.setupIssues.join('، ') || 'راجع الحركات أو الغياب المحتمل') + '</div>') +
        '</article>';
    }).join('');
    const heading = pageHeading('الموظفون', 'الموقع والوردية ونظام الأجر لكل موظف. نتائج المرتب مسودات للمراجعة.', actions);
    return heading + (list.length ? '<div class="employee-grid">' + cards + '</div>' : '<section class="panel"><div class="empty-state"><div class="empty-mark">♙</div><h3>' + (state.employees.length ? 'لا يوجد موظفون في هذا العرض' : 'لم تضف موظفين بعد') + '</h3><p>ارفع ملف البصمة لمطابقة الموظفين، أو أضف موظفًا يدويًا.</p><button class="primary-btn" data-action="add-employee">＋ إضافة موظف</button></div></section>');
  }

  function getAttendanceReviewRows() {
    const coverage = getCoverage();
    if (!coverage.start || !coverage.end) return [];
    const monthStart = localMonthStart(selectedMonth);
    const monthEnd = localMonthEnd(selectedMonth);
    const from = coverage.start > monthStart ? coverage.start : monthStart;
    let to = coverage.end < monthEnd ? coverage.end : monthEnd;
    if (to > todayISO) to = todayISO;
    if (from > to) return [];
    const result = [];
    reportEmployees().forEach(employee => {
      if (!Array.isArray(employee.workDays) || !employee.workDays.length) return;
      let cursor = new Date(from + 'T12:00:00');
      const last = new Date(to + 'T12:00:00');
      while (cursor <= last) {
        const date = toISODate(cursor);
        const day = calcDaily(employee, date);
        if (day.absenceCandidate && !['absent', 'not-absent'].includes(day.absenceDecision)) {
          result.push({ employee, date, day, kind: 'absence' });
        } else if (day.needsPunchReview) {
          result.push({ employee, date, day, kind: 'punch' });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return result;
  }

  function renderAttendance() {
    const monthStart = localMonthStart(selectedMonth);
    const monthEnd = localMonthEnd(selectedMonth);
    let rows = state.records.filter(r => r.date >= monthStart && r.date <= monthEnd);
    if (attendanceFilter !== 'all') rows = rows.filter(r => r.type === attendanceFilter);
    if (attendanceSiteFilter !== 'all') rows = rows.filter(r => employeeById(r.employeeId)?.site === attendanceSiteFilter);
    if (attendanceSearch.trim()) {
      const term = normalizeText(attendanceSearch);
      rows = rows.filter(r => { const e = employeeById(r.employeeId); return normalizeText(e?.name).includes(term) || normalizeText(e?.code).includes(term) || r.date.includes(term); });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    const coverage = getCoverage();
    const siteNames = Array.from(new Set(activeEmployees().map(e => String(e.site || '').trim()).filter(Boolean))).sort();
    const actions = monthInput() + '<button class="secondary-btn" data-action="add-record">＋ حركة يدوية</button><button class="primary-btn" data-action="import-pdf"><span class="button-icon">⇧</span> استيراد PDF</button>';
    const dailyMode = attendanceView === 'daily';
    let rowsHTML = '';
    let displayCount = 0;
    if (rows.length && dailyMode) {
      const grouped = new Map();
      rows.forEach(record => {
        if (!grouped.has(record.date)) grouped.set(record.date, new Map());
        const people = grouped.get(record.date);
        if (!people.has(record.employeeId)) people.set(record.employeeId, []);
        people.get(record.employeeId).push(record);
      });
      displayCount = Array.from(grouped.values()).reduce((sum, people) => sum + people.size, 0);
      rowsHTML = Array.from(grouped.entries()).map(([date, people]) => {
        const personRows = Array.from(people.entries()).map(([employeeId, events]) => {
          const employee = employeeById(employeeId);
          const day = employee ? calcDaily(employee, date) : null;
          const ins = events.filter(r => r.type === 'in').sort((a, b) => a.time.localeCompare(b.time));
          const outs = events.filter(r => r.type === 'out').sort((a, b) => a.time.localeCompare(b.time));
          const status = day?.absent ? badge('غياب تمت مراجعته', 'red') : day?.needsPunchReview ? badge('بصمة تحتاج مراجعة', 'amber') : day?.late ? badge('متأخر ' + fmtNumber(day.late) + ' د', 'amber') : badge('حاضر', 'green');
          return '<tr><td>' + person(employee) + '</td><td>' + esc(employee?.site || 'غير محدد') + '</td><td><span class="num-ltr">' + (ins.length ? esc(ins[0].time) : '—') + '</span></td><td><span class="num-ltr">' + (outs.length ? esc(outs[outs.length - 1].time) : '—') + '</span></td><td>' + (day?.worked ? durationText(day.worked) : '—') + '</td><td>' + status + '</td></tr>';
        }).join('');
        return '<tr class="day-separator-row"><td colspan="6">' + esc(fmtDate(date)) + ' · ' + fmtNumber(people.size) + ' موظف</td></tr>' + personRows;
      }).join('');
    } else if (rows.length) {
      displayCount = rows.length;
      rowsHTML = rows.map(r => {
        const employee = employeeById(r.employeeId);
        const day = employee ? calcDaily(employee, r.date) : null;
        const review = [
          r.duplicateCandidate ? badge('تكرار قريب', 'amber') : '',
          r.timeNeedsReview ? badge('ص/م مقدّر', 'blue') : '',
          r.singleCandidate ? badge('بصمة وحيدة', 'amber') : '',
          r.reviewed ? badge('مراجع', 'green') : ''
        ].filter(Boolean).join(' ');
        const origin = r.source === 'pdf' ? 'PDF · صفحة ' + fmtNumber(r.sourcePage || '—') : r.source === 'manual' ? 'إدخال يدوي' : 'سجل محفوظ';
        const status = ((r.type === 'in' && day?.late) ? badge('تأخير ' + fmtNumber(day.late) + ' د', 'amber') + ' ' : '') + (review || '—');
        return '<tr><td>' + person(employee) + '</td><td>' + esc(employee?.site || 'غير محدد') + '</td><td><span class="num-ltr">' + esc(fmtDate(r.date)) + '</span></td><td>' + (r.type === 'in' ? badge('حضور', 'green') : badge('انصراف', 'blue')) + '</td><td><span class="num-ltr">' + esc(r.time) + '</span><div class="duplicate-note">' + esc(r.rawTime || '') + '</div></td><td>' + status + '</td><td>' + esc(origin) + '</td><td><button class="icon-action" data-action="delete-record" data-id="' + esc(r.id) + '" title="حذف الحركة">حذف</button></td></tr>';
      }).join('');
    } else {
      rowsHTML = '<tr><td colspan="' + (dailyMode ? '6' : '8') + '" class="no-data-row">لا توجد حركات في ' + esc(monthLabel(selectedMonth)) + '. ارفع ملف PDF لبدء المراجعة.</td></tr>';
    }
    const siteOptions = '<option value="all">كل المواقع</option>' + siteNames.map(site => '<option value="' + esc(site) + '" ' + (attendanceSiteFilter === site ? 'selected' : '') + '>' + esc(site) + '</option>').join('');
    const filters = '<div class="table-toolbar"><div class="toolbar-group"><input class="search-control" id="attendanceSearch" type="search" placeholder="ابحث بالاسم أو الكود…" value="' + esc(attendanceSearch) + '">' +
      '<select class="select-control" id="attendanceFilter"><option value="all" ' + (attendanceFilter === 'all' ? 'selected' : '') + '>كل الحركات</option><option value="in" ' + (attendanceFilter === 'in' ? 'selected' : '') + '>حضور</option><option value="out" ' + (attendanceFilter === 'out' ? 'selected' : '') + '>انصراف</option></select>' +
      '<select class="select-control" id="attendanceSite">' + siteOptions + '</select></div><div class="toolbar-group"><button class="secondary-btn small-btn" data-action="toggle-attendance-view">' + (dailyMode ? 'عرض كل الحركات' : 'عرض حسب اليوم') + '</button><button class="secondary-btn small-btn" data-action="export-attendance">تنزيل CSV</button><span class="cell-muted" style="font-size:10px">' + fmtNumber(displayCount) + (dailyMode ? ' موظف/يوم' : ' حركة') + '</span></div></div>';
    const head = dailyMode ? '<tr><th>الموظف</th><th>الموقع</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>الحالة</th></tr>' : '<tr><th>الموظف</th><th>الموقع</th><th>التاريخ</th><th>العملية</th><th>الوقت المسجل</th><th>المراجعة</th><th>المصدر</th><th></th></tr>';
    const reviewRows = getAttendanceReviewRows().filter(x => attendanceSiteFilter === 'all' || x.employee.site === attendanceSiteFilter);
    const reviewHTML = reviewRows.length ? reviewRows.map(item => {
      const keyData = ' data-employee-id="' + esc(item.employee.id) + '" data-date="' + esc(item.date) + '"';
      if (item.kind === 'absence') {
        return '<tr><td>' + person(item.employee) + '</td><td>' + esc(item.employee.site || 'غير محدد') + '</td><td>' + esc(fmtDate(item.date)) + '</td><td>لا توجد بصمة — غياب محتمل فقط</td><td><button class="danger-btn small-btn" data-review-action="absence" data-decision="absent"' + keyData + '>تسجيل غياب</button> <button class="secondary-btn small-btn" data-review-action="absence" data-decision="not-absent"' + keyData + '>ليس غيابًا</button></td></tr>';
      }
      const missingType = !item.day.firstIn ? 'in' : 'out';
      const missingLabel = missingType === 'in' ? 'حضور غير موجود' : 'انصراف غير موجود';
      return '<tr><td>' + person(item.employee) + '</td><td>' + esc(item.employee.site || 'غير محدد') + '</td><td>' + esc(fmtDate(item.date)) + '</td><td>' + missingLabel + ' أو حركات إضافية/مكررة</td><td><button class="secondary-btn small-btn" data-review-action="add-punch" data-type="' + missingType + '"' + keyData + '>إضافة بصمة ' + (missingType === 'in' ? 'حضور' : 'انصراف') + '</button> <button class="secondary-btn small-btn" data-review-action="review-day"' + keyData + '>تأكيد مراجعة اليوم</button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="no-data-row">لا توجد أيام ناقصة أو غياب محتمل ضمن بيانات الموظفين وإعدادات العمل الحالية.</td></tr>';
    const notice = coverage.start ? '<div class="notice notice-info"><span class="notice-icon">ⓘ</span><span>السجل المحفوظ يغطي ' + esc(fmtDate(coverage.start)) + ' — ' + esc(fmtDate(coverage.end)) + '. الغياب يظل مقترحًا ولا يخصم قبل قرار يدوي.</span></div>' : '';
    const reviewPanel = '<section class="panel" style="margin-top:16px"><div class="panel-header"><div><div class="panel-title">غياب وبصمات تحتاج مراجعة</div><div class="panel-subtitle">لا يُعتمد الغياب ولا تُخصم أيامه تلقائيًا.</div></div><span class="badge badge-amber">' + fmtNumber(reviewRows.length) + ' للمراجعة</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الموظف</th><th>الموقع</th><th>التاريخ</th><th>الملاحظة</th><th>الإجراء اليدوي</th></tr></thead><tbody>' + reviewHTML + '</tbody></table></div></section>';
     const uploadStatus = pdfUploadStatus ? '<div id="pdfUploadStatus" class="notice ' + (pdfUploadStatus.kind === 'error' ? 'notice-warn' : 'notice-info') + '"><span class="notice-icon">' + (pdfUploadStatus.kind === 'error' ? '!' : pdfUploadStatus.kind === 'loading' ? '…' : 'ⓘ') + '</span><span><strong>' + esc(pdfUploadStatus.fileName) + '</strong> ' + esc(pdfUploadStatus.message) + '</span></div>' : '<div id="pdfUploadStatus" hidden></div>';
     return pageHeading('سجل الحضور', 'راجع حركات البصمة لكل موقع، وصنّف الأيام الناقصة قبل احتساب الخصومات.', actions) + uploadStatus + notice +
      '<section class="panel">' + filters + '<div class="table-wrap"><table class="data-table"><thead>' + head + '</thead><tbody>' + rowsHTML + '</tbody></table></div></section>' + reviewPanel;
  }

  function renderPayroll() {
    const calculations = reportEmployees().map(e => calcPayroll(e, selectedMonth));
    const sumGross = calculations.reduce((s, x) => s + x.gross, 0);
    const sumDeductions = calculations.reduce((s, x) => s + x.deductions, 0);
    const sumNet = calculations.reduce((s, x) => s + x.net, 0);
    const sumPending = calculations.reduce((s, x) => s + x.pending + x.setupIssues.length, 0);
    const sumLoans = calculations.reduce((s, x) => s + x.loanDeduction, 0);
    const allReady = calculations.length > 0 && calculations.every(x => x.ready);
    const allApplied = state.loans.every(l => (Number(l.remaining) || 0) <= 0 || (l.deductions && Object.prototype.hasOwnProperty.call(l.deductions, selectedMonth)));
    const actions = monthInput() + '<button class="secondary-btn" data-action="add-loan">＋ تسجيل سلفة</button><button class="secondary-btn" data-action="export-payroll">تصدير مسودة CSV</button><button class="primary-btn" data-action="print-payroll">طباعة المسودة</button>';
    const notice = '<div class="notice notice-warn"><span class="notice-icon">!</span><span>هذا كشف مسودة للمراجعة، وليس اعتمادًا نهائيًا. الغياب لا يخصم إلا بعد تحديده يدويًا، وأي أيام ناقصة أو نظام أجر/وردية غير محدد تظهر كبيانات تحتاج استكمالًا. العناصر المفتوحة: ' + fmtNumber(sumPending) + '.</span></div>';
    const tableRows = calculations.length ? calculations.map(x => {
      const rate = x.payModel === 'daily' ? payRateLabel(x.employee) : x.payModel === 'hourly' ? payRateLabel(x.employee) : payRateLabel(x.employee);
      return '<tr><td>' + person(x.employee) + '</td><td>' + esc(x.employee.site || 'غير محدد') + '</td><td>' + esc(payModelLabel(x.employee)) + '</td><td>' + esc(rate) + '</td><td>' + (x.hasCoverage ? fmtNumber(x.expected) : '—') + '</td><td>' + (x.hasCoverage ? fmtNumber(x.attendedDays) : '—') + '</td><td>' + (x.hasCoverage ? fmtNumber(x.absent) : '—') + '</td><td>' + (x.pending ? badge(fmtNumber(x.pending) + ' معلقة', 'amber') : '—') + '</td><td>' + fmtNumber(x.lateMinutes) + '</td><td>' + fmtMoney(x.deductions) + ' ج.م</td><td class="salary-highlight">' + fmtMoney(x.net) + ' ج.م</td><td>' + badge(x.ready ? 'مسودة — راجعها' : 'بيانات ناقصة', x.ready ? 'blue' : 'amber') + ' <button class="icon-action" data-action="edit-employee" data-id="' + esc(x.employee.id) + '">تعديل</button></td></tr>';
    }).join('') : '<tr><td class="no-data-row" colspan="12">ارفع ملف البصمة أو أضف موظفًا لإعداد المسودة.</td></tr>';
    const openLoans = state.loans.filter(l => (Number(l.remaining) || 0) > 0);
    const loanRows = openLoans.length ? openLoans.map(l => '<tr><td>' + person(employeeById(l.employeeId)) + '</td><td>' + esc(fmtDate(l.date)) + '</td><td>' + fmtMoney(l.amount) + ' ج.م</td><td>' + fmtMoney(l.remaining) + ' ج.م</td><td>' + fmtMoney(l.installment) + ' ج.م</td><td><button class="icon-action" data-action="delete-loan" data-id="' + esc(l.id) + '">حذف</button></td></tr>').join('') : '<tr><td class="no-data-row" colspan="6">لا توجد سلف معلقة.</td></tr>';
    return pageHeading('الرواتب والسلف', 'مسودة ' + esc(monthLabel(selectedMonth)) + ' — راجع الموقع ونظام الأجر والوردية قبل التصدير.', actions) + notice +
      '<div class="stats-grid"><article class="stat-card"><div class="stat-label">الاستحقاق المبدئي</div><div class="stat-value">' + fmtMoney(sumGross) + '</div><div class="stat-foot">ج.م · حسب نظام كل موظف</div></article><article class="stat-card"><div class="stat-label">الخصومات المبدئية</div><div class="stat-value">' + fmtMoney(sumDeductions) + '</div><div class="stat-foot">غياب معتمد وتأخير وسلف</div></article><article class="stat-card"><div class="stat-label">صافي المسودة</div><div class="stat-value">' + fmtMoney(sumNet) + '</div><div class="stat-foot">غير معتمد نهائيًا</div></article><article class="stat-card"><div class="stat-label">خصم السلف</div><div class="stat-value">' + fmtMoney(sumLoans) + '</div><div class="stat-foot">' + (allApplied ? 'مسجل لهذه الفترة' : 'اقتراح قسط — لا يعتمد قبل اكتمال المراجعة') + '</div></article></div>' +
      '<section class="panel" style="margin-bottom:16px"><div class="panel-header"><div><div class="panel-title">كشف الرواتب التفصيلي — مسودة</div><div class="panel-subtitle">الأجر الشهري ثابت، واليومي حسب أيام الحضور المكتملة، والساعي حسب ساعات الحضور المسجلة.</div></div><button class="secondary-btn small-btn" data-action="apply-loans" ' + (allApplied || !openLoans.length || !allReady ? 'disabled' : '') + '>' + (allApplied ? 'تم تسجيل أقساط الفترة' : 'تسجيل أقساط السلف في المسودة') + '</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الموظف</th><th>الموقع</th><th>نظام الأجر</th><th>قيمة الأجر</th><th>أيام مجدولة</th><th>أيام بحضور وانصراف</th><th>غياب معتمد</th><th>مراجعة معلقة</th><th>دقائق تأخير</th><th>إجمالي خصم مبدئي</th><th>صافي مبدئي</th><th>الحالة</th></tr></thead><tbody>' + tableRows + '</tbody></table></div><div class="summary-strip"><span>استحقاق مبدئي <strong>' + fmtMoney(sumGross) + ' ج.م</strong></span><span>خصومات مبدئية <strong>' + fmtMoney(sumDeductions) + ' ج.م</strong></span><span>صافي مسودة <strong>' + fmtMoney(sumNet) + ' ج.م</strong></span></div></section>' +
      '<section class="panel"><div class="panel-header"><div><div class="panel-title">السلف المعلقة</div><div class="panel-subtitle">قسط الفترة الحالية: ' + esc(monthLabel(selectedMonth)) + '</div></div><button class="text-link" data-action="add-loan">＋ تسجيل سلفة جديدة</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الموظف</th><th>تاريخ السلفة</th><th>المبلغ الأصلي</th><th>المتبقي</th><th>القسط لكل فترة</th><th></th></tr></thead><tbody>' + loanRows + '</tbody></table></div></section>';
  }

  function exportPayroll() {
    const calculations = reportEmployees().map(e => calcPayroll(e, selectedMonth));
    const lines = [
      ['الموظف', 'الكود', 'الموقع', 'نظام الأجر', 'قيمة الأجر', 'أيام مجدولة', 'أيام مكتملة', 'غياب معتمد', 'مراجعة معلقة', 'دقائق التأخير', 'خصومات مبدئية', 'السلف', 'صافي مسودة', 'الحالة']
    ];
    calculations.forEach(x => lines.push([
      x.employee.name, x.employee.code, x.employee.site || '', payModelLabel(x.employee), payRateLabel(x.employee),
      x.expected, x.attendedDays, x.absent, x.pending + x.setupIssues.length, x.lateMinutes, x.deductions,
      x.loanDeduction, x.net, x.ready ? 'مسودة - راجعها' : 'بيانات ناقصة'
    ]));
    downloadText('Lion-Auto-payroll-draft-' + selectedMonth + '.csv', lines.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  $('#pageContent').addEventListener('click', event => {
    const button = event.target.closest('[data-review-action]');
    if (!button) return;
    const employeeId = button.dataset.employeeId;
    const date = button.dataset.date;
    const key = dayReviewKey(employeeId, date);
    if (button.dataset.reviewAction === 'absence') {
      state.absenceReviews = state.absenceReviews || {};
      state.absenceReviews[key] = button.dataset.decision;
      if (saveState()) { renderPage(); toast(button.dataset.decision === 'absent' ? 'تم تسجيل الغياب يدويًا وسيظهر في مسودة الخصومات.' : 'تمت مراجعة اليوم ولن يُحسب غيابًا.'); }
      return;
    }
    if (button.dataset.reviewAction === 'review-day') {
      state.dayReviews = state.dayReviews || {};
      state.dayReviews[key] = true;
      if (saveState()) { renderPage(); toast('تم تسجيل مراجعة الحركات لهذا اليوم.'); }
      return;
    }
    if (button.dataset.reviewAction === 'add-punch') {
      showRecordDialog({ employeeId, date, type: button.dataset.type });
    }
  });
  $('#pageContent').addEventListener('change', event => {
    if (event.target.id === 'attendanceSite') {
      attendanceSiteFilter = event.target.value || 'all';
      renderPage();
    }
  });

  $('#pdfInput').addEventListener('change', event => {
    const file = event.target.files?.[0]; if (file) readPdf(file); event.target.value = '';
  });
  $('#backupInput')?.addEventListener('change', event => {
    const file = event.target.files?.[0]; if (file) handleRestore(file); event.target.value = '';
  });
  $('#topAddEmployee').addEventListener('click', () => showEmployeeDialog());
  updateHeader(); renderPage();
})();

