(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const util = root.util || {};
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => { };

  function renderAbsencesForStudent(ctx, table, studentCellTitle, studentConfig, absences) {
    let addedRows = 0;

    if (!Array.isArray(absences) || absences.length === 0) {
      addTableRow(table, 'absenceRowEmpty', studentCellTitle, ctx.translate('no_absences'));
      return 1;
    }

    const sorted = absences
      .slice()
      .sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

    for (const ab of sorted) {
      const dateRaw = ab?.date;
      const dateFormat = (studentConfig && studentConfig.dateFormat) || ctx.config.dateFormat || 'dd.MM.yyyy';
      const dateStr = dateRaw ? (util?.formatDate ? util.formatDate(dateRaw, dateFormat) : util.formatYmd(dateRaw)) : '';
      const st = util.formatTime(ab?.startTime);
      const et = util.formatTime(ab?.endTime);
      const time = st && et ? `${st}-${et}` : st || et || '';

      const subj = ab?.su?.[0]?.longname || ab?.su?.[0]?.name || '';
      const reason = String(ab?.reason || '').trim();
      const isExcused = ab?.excused === true;
      const isUnexcused = ab?.excused === false;

      // Meta column: date (matches exams/homework layout)
      const meta = dateStr || '';

      // Build status label (if any) and its class
      let statusLabel = '';
      let statusClass = '';
      if (isExcused) {
        statusLabel = ctx.translate('excused');
        statusClass = 'absence-excused';
      } else if (isUnexcused) {
        statusLabel = ctx.translate('unexcused');
        statusClass = 'absence-unexcused';
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

      if (reason) dataParts.push(`<br><span class='xsmall dimmed'>${escapeHtml(reason).replace(/\n/g, '<br>')}</span>`);

      const data = dataParts.length > 0 ? dataParts.join(' ') : escapeHtml(ctx.translate('absences'));

      addTableRow(table, 'absenceRow', studentCellTitle, meta || ctx.translate('absences'), data);
      addedRows++;
    }

    return addedRows;
  }

  root.absences = {
    renderAbsencesForStudent,
  };
})();
