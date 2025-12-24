(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const util = root.util || {};
  const log = typeof util.log === 'function' ? util.log : () => { };
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => { };

  function renderHomeworksForStudent(ctx, table, studentCellTitle, studentConfig, homeworks) {
    let addedRows = 0;

    if (!Array.isArray(homeworks) || homeworks.length === 0) {
      log('debug', `[homework] no data`);
      addTableRow(table, 'homeworkRowEmpty', studentCellTitle, ctx.translate('no_homework'));
      return 1;
    }

    log('debug', `[homework] render start | entries: ${homeworks.length}`);

    const dateFormat = studentConfig.homeworkDateFormat ?? ctx.config.homeworkDateFormat ?? ctx.config.dateFormat ?? 'dd.MM.yyyy';

    const sorted = homeworks
      .slice()
      .sort(
        (a, b) => (Number(a.dueDate) || 0) - (Number(b.dueDate) || 0) || String(a.su?.name || '').localeCompare(String(b.su?.name || ''))
      );

    for (const hw of sorted) {
      const due = hw?.dueDate ? util.formatDate(hw.dueDate, dateFormat) : '';
      const subj = hw?.su?.longname || hw?.su?.name || '';
      const text = String(hw?.text || hw?.remark || '').trim();

      log('debug', `[homework] add: due="${due}" subj="${subj}" text_len=${text.length}`);

      const left = due ? `${due}` : ctx.translate('homework');
      const rightParts = [];
      if (subj) rightParts.push(`<b>${escapeHtml(subj)}</b>`);
      if (text) rightParts.push(`<span>${escapeHtml(text).replace(/\n/g, '<br>')}</span>`);
      const right = rightParts.length > 0 ? rightParts.join(': ') : ctx.translate('homework');

      addTableRow(table, 'homeworkRow', studentCellTitle, left, right);
      addedRows++;
    }

    log('debug', `[homework] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.homework = {
    renderHomeworksForStudent,
  };
})();
