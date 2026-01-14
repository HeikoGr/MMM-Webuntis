(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { log, escapeHtml, addRow, addHeader, formatDate, createWidgetContext } = root.util?.initWidget?.(root) || {};

  function renderHomeworksForStudent(ctx, container, studentCellTitle, studentConfig, homeworks) {
    let addedRows = 0;

    // Use widget context helper to reduce config duplication
    const widgetCtx = createWidgetContext('homework', studentConfig, root.util || {});
    const studentCell = widgetCtx.isVerbose ? '' : studentCellTitle;
    // Header is already added by main module if studentCellTitle is empty
    if (widgetCtx.isVerbose && studentCellTitle !== '') addHeader(container, studentCellTitle);

    if (!Array.isArray(homeworks) || homeworks.length === 0) {
      log('debug', `[homework] no data`);
      addRow(container, 'homeworkRowEmpty', studentCell, ctx.translate('no_homework'));
      return 1;
    }

    log('debug', `[homework] render start | entries: ${homeworks.length}`);

    const dateFormat = widgetCtx.getConfig('dateFormat', 'dd.MM.');
    const showSubject = widgetCtx.getConfig('showSubject', true);
    const showText = widgetCtx.getConfig('showText', true);

    const sorted = homeworks
      .slice()
      .sort(
        (a, b) => (Number(a.dueDate) || 0) - (Number(b.dueDate) || 0) || String(a.su?.name || '').localeCompare(String(b.su?.name || ''))
      );

    for (const hw of sorted) {
      const due = hw?.dueDate ? formatDate(hw.dueDate, dateFormat) : '';
      const subj = showSubject ? hw?.su?.longname || hw?.su?.name || '' : '';
      const text = showText ? String(hw?.text || hw?.remark || '').trim() : '';

      const left = due ? `${due}` : ctx.translate('homework');
      const rightParts = [];
      if (subj) rightParts.push(`<b>${escapeHtml(subj)}</b>`);
      if (text) rightParts.push(`<span>${escapeHtml(text).replace(/\n/g, '<br>')}</span>`);
      const right = rightParts.length > 0 ? rightParts.join(': ') : ctx.translate('homework');

      addRow(container, 'homeworkRow', studentCell, left, right);
      addedRows++;
    }

    log('debug', `[homework] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.homework = {
    renderHomeworksForStudent,
  };
})();
