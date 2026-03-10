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
  const { log, escapeHtml, addRow, initializeWidgetContextAndHeader, currentTimeAsHHMM } = root.util?.resolveWidgetHelpers?.(root) || {};

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
      const nowHm = currentTimeAsHHMM(nowLocal);

      // Initialize widget context and add header if needed
      const { widgetCtx, studentLabelText } = initializeWidgetContextAndHeader('exams', ctx, container, studentCellTitle, studentConfig);

      const { formatDisplayDate, compareByDateAndStartTime } = root.util || {};
      const showSubject = Boolean(widgetCtx.getConfig('showSubject', false));
      const showTeacher = Boolean(widgetCtx.getConfig('showTeacher', false));

      exams
        .slice()
        .sort((a, b) => compareByDateAndStartTime(a, b, { dateKey: 'examDate', timeKey: 'startTime' }))
        .forEach((exam) => {
          const examYmd = Number(exam.examDate) || 0;
          const examHm = Number(exam.startTime) || 0;
          const examInPast = examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm);
          if (examInPast && ctx.config.logLevel !== 'debug') {
            return;
          }

          addedRows++;

          const examDateFormat = widgetCtx.getConfig('dateFormat');
          const fallbackDay = String(examYmd % 100).padStart(2, '0');
          const fallbackMonth = String(Math.floor(examYmd / 100) % 100).padStart(2, '0');
          const formattedDate = formatDisplayDate ? formatDisplayDate(examYmd, examDateFormat) : `${fallbackDay}.${fallbackMonth}.`;
          const dateTimeCell = formattedDate ? `<span class="wu-exam__date">${escapeHtml(formattedDate)}</span>` : '';

          let nameCell = `<span class="wu-exam__name">${escapeHtml(exam.name)}</span>`;
          if (showSubject) {
            nameCell = `<span class="wu-exam__subject">${escapeHtml(exam.subject)}</span>: &nbsp;<span class="wu-exam__name">${escapeHtml(exam.name)}</span>`;
          }

          if (showTeacher) {
            const teacher = Array.isArray(exam.teachers) && exam.teachers.length > 0 ? exam.teachers[0] : '';
            if (teacher) nameCell += '&nbsp;' + `<span class="teacher-name wu-exam__teacher">(${escapeHtml(teacher)})</span>`;
          }

          if (exam.text) {
            nameCell += `<br/><span class="exam-description wu-exam__description">${escapeHtml(exam.text)}</span>`;
          }

          addRow(container, 'examRow', studentLabelText, dateTimeCell, nameCell);
        });

      if (addedRows === 0) {
        addRow(container, 'examRowEmpty', studentLabelText, ctx.translate('no_exams'));
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
