/**
 * Absences Widget
 * Renders absence records with configurable display and filtering:
 * - Date range filtering (past/next days)
 * - Date format customization
 * - Excused/unexcused status display
 * - Reason text display
 * - Time range display (startTime-endTime)
 * - Subject information
 * - Maximum item limit
 */
(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { escapeHtml, addRow, initializeWidgetContextAndHeader } = root.util?.resolveWidgetHelpers?.(root) || {};

  /**
   * Render absences widget for a single student
   * Displays absences sorted by date and time
   * Filters by date range (pastDays/nextDays) and respects maxItems limit
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

    // Initialize widget context and add header if needed
    const { widgetCtx, studentLabelText } = initializeWidgetContextAndHeader('absences', ctx, container, studentCellTitle, studentConfig);

    if (!Array.isArray(absences) || absences.length === 0) {
      addRow(container, 'absenceRowEmpty', studentLabelText, ctx.translate('no_absences'));
      return 1;
    }

    const { formatDisplayDate, formatDisplayTime } = root.util || {};
    const maxItems = widgetCtx.getConfig('maxItems');
    const showDate = Boolean(widgetCtx.getConfig('showDate'));
    const showExcused = Boolean(widgetCtx.getConfig('showExcused'));
    const showReason = Boolean(widgetCtx.getConfig('showReason'));
    const nowLocal = new Date();
    const nowYmd = ctx._currentTodayYmd ?? nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();

    const rangeStart = widgetCtx.getConfig('pastDays');
    const rangeEnd = widgetCtx.getConfig('nextDays');
    const dateFormat = widgetCtx.getConfig('dateFormat');

    const sorted = absences
      .slice()
      .filter((ab) => {
        const absenceYmd = Number(ab?.date) || 0;
        if (absenceYmd === 0) return false;

        const absYear = Math.floor(absenceYmd / 10000);
        const absMonth = Math.floor((absenceYmd % 10000) / 100);
        const absDay = absenceYmd % 100;
        const nowYear = Math.floor(nowYmd / 10000);
        const nowMonth = Math.floor((nowYmd % 10000) / 100);
        const nowDay = nowYmd % 100;

        const absUtcMs = Date.UTC(absYear, absMonth - 1, absDay);
        const nowUtcMs = Date.UTC(nowYear, nowMonth - 1, nowDay);
        const daysDiff = Math.floor((nowUtcMs - absUtcMs) / (1000 * 60 * 60 * 24));

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
      const dateStr = dateRaw ? (formatDisplayDate ? formatDisplayDate(dateRaw, dateFormat) : '') : '';
      const st = formatDisplayTime(ab?.startTime);
      const et = formatDisplayTime(ab?.endTime);
      const time = st && et ? `${st}-${et}` : st || et || '';

      const subj = ab?.su?.[0]?.longname || ab?.su?.[0]?.name || '';
      const reason = String(ab?.reason || '').trim();
      const isExcused = ab?.excused === true;
      const isUnexcused = ab?.excused === false;

      const meta = showDate && dateStr ? dateStr : '';

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

      addRow(container, 'absenceRow', studentLabelText, meta || ctx.translate('absences'), data);
      addedRows++;
      visibleCount++;
    }

    return addedRows;
  }

  root.absences = {
    renderAbsencesForStudent,
  };
})();
