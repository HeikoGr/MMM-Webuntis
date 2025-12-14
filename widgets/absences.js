(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const util = root.util;

  function renderAbsencesForStudent(ctx, table, studentCellTitle, studentConfig, absences) {
    let addedRows = 0;

    if (!Array.isArray(absences) || absences.length === 0) {
      ctx._addTableRow(table, 'lessonRowEmpty', studentCellTitle, ctx.translate('no_absences'));
      return 1;
    }

    const sorted = absences
      .slice()
      .sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

    for (const ab of sorted) {
      const date = ab?.date ? util.formatYmd(ab.date) : '';
      const st = util.formatTime(ab?.startTime);
      const et = util.formatTime(ab?.endTime);
      const time = st && et ? `${st}-${et}` : st || et || '';

      const subj = ab?.su?.[0]?.longname || ab?.su?.[0]?.name || '';
      const reason = String(ab?.reason || '').trim();
      const excused =
        ab?.excused === true ? ` (${ctx.translate('excused')})` : ab?.excused === false ? ` (${ctx.translate('unexcused')})` : '';

      const left = [date, time].filter(Boolean).join(' ');
      const rightParts = [];
      if (subj) rightParts.push(`<b>${subj}</b>${excused}`);
      else if (excused) rightParts.push(excused.trim());
      if (reason) rightParts.push(`<span class='xsmall dimmed'>${reason.replace(/\n/g, '<br>')}</span>`);
      const right = rightParts.length > 0 ? rightParts.join('<br>') : ctx.translate('absences');

      ctx._addTableRow(table, 'lessonRow', studentCellTitle, left || ctx.translate('absences'), right);
      addedRows++;
    }

    return addedRows;
  }

  root.absences = {
    renderAbsencesForStudent,
  };
})();
