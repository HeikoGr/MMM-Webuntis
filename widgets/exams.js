/**
 * Exams Widget
 * Renders upcoming exams with configurable display options:
 * - Date format customization
 * - Subject/teacher display toggle
 * - Past exam filtering (debug mode exception)
 * - Sorted by date and time
 */
(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { log, escapeHtml, addRow, addHeader, formatDate, createWidgetContext, buildWidgetHeaderTitle } =
    root.util?.initWidget?.(root) || {};

  /**
   * Render exams widget for a single student
   * Displays exams sorted by date and time
   * Filters past exams unless debug mode is active
   *
   * @param {Object} ctx - Main module context (provides translate, config, debug support)
   * @param {HTMLElement} container - DOM element to append exam rows
   * @param {string} studentCellTitle - Student name for compact mode student column
   * @param {Object} studentConfig - Student-specific configuration
   * @param {Array} exams - Array of exam objects from backend (examDate, startTime, name, subject, teachers, text)
   * @returns {number} Number of rows added to container
   */
  function renderExamsForStudent(ctx, container, studentCellTitle, studentConfig, exams) {
    try {
      let addedRows = 0;
      if (!Array.isArray(exams)) {
        return 0;
      }

      const nowLocal = new Date();
      const nowYmd = ctx._currentTodayYmd ?? nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
      const nowHm = nowLocal.getHours() * 100 + nowLocal.getMinutes();

      // Use widget context helper to reduce config duplication
      const widgetCtx = createWidgetContext('exams', studentConfig, root.util || {}, ctx);
      const studentCell = widgetCtx.isVerbose ? '' : studentCellTitle;
      // Header is already added by main module if studentCellTitle is empty
      if (widgetCtx.isVerbose && studentCellTitle !== '') {
        addHeader(container, buildWidgetHeaderTitle(ctx, 'exams', widgetCtx, studentCellTitle));
      }

      const showSubject = Boolean(widgetCtx.getConfig('showSubject', false));
      const showTeacher = Boolean(widgetCtx.getConfig('showTeacher', false));

      exams
        .slice()
        .sort((a, b) => (Number(a.examDate) || 0) - (Number(b.examDate) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
        .forEach((exam) => {
          const examYmd = Number(exam.examDate) || 0;
          const examHm = Number(exam.startTime) || 0;
          const examInPast = examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm);
          if (examInPast && ctx.config.logLevel !== 'debug') {
            return;
          }

          // Check if exam is within range
          // const daysDiff = Math.floor((examYmd - nowYmd) / 100) + ((examYmd % 100) - (nowYmd % 100));

          // if (daysDiff > rangeEnd) return;

          addedRows++;

          const examDateFormat = widgetCtx.getConfig('dateFormat');
          const fallbackDay = String(examYmd % 100).padStart(2, '0');
          const fallbackMonth = String(Math.floor(examYmd / 100) % 100).padStart(2, '0');
          const formattedDate = formatDate ? formatDate(examYmd, examDateFormat) : `${fallbackDay}.${fallbackMonth}.`;
          const dateTimeCell = formattedDate ? `${formattedDate}` : '';

          let nameCell = escapeHtml(exam.name);
          if (showSubject) {
            nameCell = `${escapeHtml(exam.subject)}: &nbsp;${escapeHtml(exam.name)}`;
          }

          if (showTeacher) {
            const teacher = Array.isArray(exam.teachers) && exam.teachers.length > 0 ? exam.teachers[0] : '';
            if (teacher) nameCell += '&nbsp;' + `<span class="teacher-name">(${escapeHtml(teacher)})</span>`;
          }

          if (exam.text) {
            nameCell += `<br/><span class="exam-description">${escapeHtml(exam.text)}</span>`;
          }

          addRow(container, 'examRow', studentCell, dateTimeCell, nameCell);
        });

      if (addedRows === 0) {
        addRow(container, 'examRowEmpty', studentCell, ctx.translate('no_exams'));
      }

      return addedRows;
    } catch (err) {
      log('error', `[exams] rendering failed: ${err.message}`);
      return 0;
    }
  }

  root.exams = {
    renderExamsForStudent,
  };
})();
