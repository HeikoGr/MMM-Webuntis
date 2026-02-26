/**
 * Absences Widget
 * Renders absence records with configurable display and filtering:
 * - Date range filtering (past/future days)
 * - Date format customization
 * - Excused/unexcused status display
 * - Reason text display
 * - Time range display (startTime-endTime)
 * - Subject information
 * - Maximum item limit
 */
(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { escapeHtml, addRow, addHeader, getWidgetConfig, formatDate, formatTime, createWidgetContext } =
    root.util?.initWidget?.(root) || {};

  /**
   * Render absences widget for a single student
   * Displays absences sorted by date and time
   * Filters by date range (pastDays/futureDays) and respects maxItems limit
   *
   * @param {Object} ctx - Main module context (provides translate, config)
   * @param {HTMLElement} container - DOM element to append absence rows
   * @param {string} studentCellTitle - Student name for compact mode student column
   * @param {Object} studentConfig - Student-specific configuration
   * @param {Array} absences - Array of absence objects (date, startTime, endTime, su, reason, excused)
   * @returns {number} Number of rows added to container
   */
  function renderAbsencesForStudent(ctx, container, studentCellTitle, studentConfig, absences) {
    let addedRows = 0;

    // Determine mode and handle header using helper
    const widgetCtx = createWidgetContext('absences', studentConfig, root.util || {});
    const studentCell = widgetCtx.isVerbose ? '' : studentCellTitle;
    if (widgetCtx.isVerbose && studentCellTitle !== '') addHeader(container, studentCellTitle);

    if (!Array.isArray(absences) || absences.length === 0) {
      addRow(container, 'absenceRowEmpty', studentCell, ctx.translate('no_absences'));
      return 1;
    }

    // Read widget-specific config (defaults already applied by MMM-Webuntis.js)
    const maxItems = getWidgetConfig(studentConfig, 'absences', 'maxItems') ?? null;
    const showDate = getWidgetConfig(studentConfig, 'absences', 'showDate') ?? true;
    const showExcused = getWidgetConfig(studentConfig, 'absences', 'showExcused') ?? true;
    const showReason = getWidgetConfig(studentConfig, 'absences', 'showReason') ?? true;
    const now = new Date();
    const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

    // Absence range options
    const rangeStart = getWidgetConfig(studentConfig, 'absences', 'pastDays') ?? 30;
    const rangeEnd = getWidgetConfig(studentConfig, 'absences', 'futureDays') ?? 7;
    const dateFormat = getWidgetConfig(studentConfig, 'absences', 'dateFormat') ?? 'dd.MM.';

    const sorted = absences
      .slice()
      .filter((ab) => {
        const absenceYmd = Number(ab?.date) || 0;
        if (absenceYmd === 0) return false;

        // Calculate days difference from YYYYMMDD format
        const absYear = Math.floor(absenceYmd / 10000);
        const absMonth = Math.floor((absenceYmd % 10000) / 100);
        const absDay = absenceYmd % 100;
        const nowYear = Math.floor(nowYmd / 10000);
        const nowMonth = Math.floor((nowYmd % 10000) / 100);
        const nowDay = nowYmd % 100;

        const absUtcMs = Date.UTC(absYear, absMonth - 1, absDay);
        const nowUtcMs = Date.UTC(nowYear, nowMonth - 1, nowDay);
        const daysDiff = Math.floor((nowUtcMs - absUtcMs) / (1000 * 60 * 60 * 24));

        // daysDiff > 0 = past, daysDiff < 0 = future
        // rangeStart: show up to N days in the past
        // rangeEnd: show up to N days in the future
        if (rangeStart !== null && daysDiff > rangeStart) {
          return false;
        }
        if (rangeEnd !== null && daysDiff < -rangeEnd) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

    let visibleCount = 0;
    for (const ab of sorted) {
      if (maxItems > 0 && visibleCount >= maxItems) break;

      const dateRaw = ab?.date;
      const dateStr = dateRaw ? (formatDate ? formatDate(dateRaw, dateFormat) : '') : '';
      const st = formatTime(ab?.startTime);
      const et = formatTime(ab?.endTime);
      const time = st && et ? `${st}-${et}` : st || et || '';

      const subj = ab?.su?.[0]?.longname || ab?.su?.[0]?.name || '';
      const reason = String(ab?.reason || '').trim();
      const isExcused = ab?.excused === true;
      const isUnexcused = ab?.excused === false;

      // Meta column: date (matches exams/homework layout)
      const meta = showDate && dateStr ? dateStr : '';

      // Build status label (if any) and its class
      let statusLabel = '';
      let statusClass = '';
      if (showExcused) {
        if (isExcused) {
          statusLabel = ctx.translate('excused');
          statusClass = 'absence-excused';
        } else if (isUnexcused) {
          statusLabel = ctx.translate('unexcused');
          statusClass = 'absence-unexcused';
        }
      }

      // Data column: time first, then subject (+status) and reason
      const dataParts = [];
      if (time) dataParts.push(`<b>${escapeHtml(time)}</b>`);

      if (subj) {
        const subjEsc = escapeHtml(subj);
        const note = statusLabel ? ` <span class='${statusClass} small dimmed'>(${escapeHtml(statusLabel)})</span>` : '';
        dataParts.push(`${subjEsc}${note}`);
      } else if (statusLabel) {
        dataParts.push(`<span class='${statusClass} small dimmed'>${escapeHtml(statusLabel)}</span>`);
      }

      if (showReason && reason) {
        dataParts.push(`<br><span class='xsmall dimmed'>${escapeHtml(reason).replace(/\n/g, '<br>')}</span>`);
      }

      const data = dataParts.length > 0 ? dataParts.join(' ') : escapeHtml(ctx.translate('absences'));

      addRow(container, 'absenceRow', studentCell, meta || ctx.translate('absences'), data);
      addedRows++;
      visibleCount++;
    }

    return addedRows;
  }

  root.absences = {
    renderAbsencesForStudent,
  };
})();
