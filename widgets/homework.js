/**
 * Homework Widget
 * Renders homework assignments with configurable display options:
 * - Date format customization
 * - Subject display toggle
 * - Text/remark display toggle
 * - Sorted by due date and subject
 */
(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { escapeHtml, addRow, addHeader, formatDate, createWidgetContext } = root.util?.initWidget?.(root) || {};

  /**
   * Render homework widget for a single student
   * Displays homework sorted by due date, then by subject
   * Supports multi-line text with HTML formatting
   *
   * @param {Object} ctx - Main module context (provides translate, config)
   * @param {HTMLElement} container - DOM element to append homework rows
   * @param {string} studentCellTitle - Student name for compact mode student column
   * @param {Object} studentConfig - Student-specific configuration
   * @param {Array} homeworks - Array of homework objects (dueDate, su{name, longname}, text, remark)
   * @returns {number} Number of rows added to container
   */
  function renderHomeworksForStudent(ctx, container, studentCellTitle, studentConfig, homeworks) {
    let addedRows = 0;

    // Use widget context helper to reduce config duplication
    const widgetCtx = createWidgetContext('homework', studentConfig, root.util || {});
    const studentCell = widgetCtx.isVerbose ? '' : studentCellTitle;
    // Header is already added by main module if studentCellTitle is empty
    if (widgetCtx.isVerbose && studentCellTitle !== '') addHeader(container, studentCellTitle);

    if (!Array.isArray(homeworks) || homeworks.length === 0) {
      addRow(container, 'homeworkRowEmpty', studentCell, ctx.translate('no_homework'));
      return 1;
    }

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

    return addedRows;
  }

  root.homework = {
    renderHomeworksForStudent,
  };
})();
