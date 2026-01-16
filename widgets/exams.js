(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { log, escapeHtml, addRow, addHeader, formatDate, createWidgetContext } = root.util?.initWidget?.(root) || {};

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
      const widgetCtx = createWidgetContext('exams', studentConfig, root.util || {});
      const studentCell = widgetCtx.isVerbose ? '' : studentCellTitle;
      // Header is already added by main module if studentCellTitle is empty
      if (widgetCtx.isVerbose && studentCellTitle !== '') addHeader(container, studentCellTitle);

      const showSubject = studentConfig?.exams?.showSubject ?? studentConfig?.showExamSubject ?? true;
      const showTeacher = studentConfig?.exams?.showTeacher ?? studentConfig?.showExamTeacher ?? true;

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

          const examDateFormat = studentConfig?.exams?.dateFormat ?? 'dd.MM.';
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
