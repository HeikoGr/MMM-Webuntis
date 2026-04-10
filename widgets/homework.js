/**
 * Homework Widget
 * Renders homework assignments with configurable display options:
 * - Date format customization
 * - Subject display toggle
 * - Text/remark display toggle
 * - Sorted by due date and subject
 */
(() => {
  const root = window.MMMWebuntisWidgets || {};
  window.MMMWebuntisWidgets = root;
  const { escapeHtml, addRow, initializeWidgetContextAndHeader } = root.util?.resolveWidgetHelpers?.(root) || {};

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

    // Initialize widget context and add header if needed
    const { widgetCtx, studentLabelText } = initializeWidgetContextAndHeader('homework', ctx, container, studentCellTitle, studentConfig);

    if (!Array.isArray(homeworks) || homeworks.length === 0) {
      addRow(container, 'homeworkRowEmpty', studentLabelText, ctx.translate('no_homework'));
      return 1;
    }

    const { formatDisplayDate } = root.util || {};
    const dateFormat = widgetCtx.getConfig('dateFormat');
    const showSubject = Boolean(widgetCtx.getConfig('showSubject'));
    const showText = Boolean(widgetCtx.getConfig('showText'));

    const sorted = homeworks
      .slice()
      .sort(
        (a, b) => (Number(a.dueDate) || 0) - (Number(b.dueDate) || 0) || String(a.su?.name || '').localeCompare(String(b.su?.name || ''))
      );

    for (const hw of sorted) {
      const due = hw?.dueDate ? formatDisplayDate(hw.dueDate, dateFormat) : '';
      const subj = showSubject ? hw?.su?.longname || hw?.su?.name || '' : '';
      const text = showText ? String(hw?.text || hw?.remark || '').trim() : '';

      const left = due
        ? `<span class="wu-homework__date">${escapeHtml(due)}</span>`
        : `<span class="wu-homework__label">${escapeHtml(ctx.translate('homework'))}</span>`;
      const rightParts = [];
      if (subj) rightParts.push(`<b class="wu-homework__subject">${escapeHtml(subj)}</b>`);
      if (text) rightParts.push(`<span class="wu-homework__text">${escapeHtml(text).replace(/\n/g, '<br>')}</span>`);
      const right =
        rightParts.length > 0 ? rightParts.join(': ') : `<span class="wu-homework__label">${escapeHtml(ctx.translate('homework'))}</span>`;

      addRow(container, 'homeworkRow', studentLabelText, left, right);
      addedRows++;
    }

    return addedRows;
  }

  root.homework = {
    renderHomeworksForStudent,
  };
})();
