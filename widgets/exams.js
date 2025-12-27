(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

  const util = root.util || {};
  const log = typeof util.log === 'function' ? util.log : () => {};
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableHeader = typeof dom.addTableHeader === 'function' ? dom.addTableHeader : () => {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => {};

  function renderExamsForStudent(ctx, table, studentCellTitle, studentConfig, exams) {
    try {
      let addedRows = 0;
      if (!Array.isArray(exams)) {
        log('debug', `[exams] no data (not array)`);
        return 0;
      }

      const nowLocal = new Date();
      const nowYmd = ctx._currentTodayYmd ?? nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
      const nowHm = nowLocal.getHours() * 100 + nowLocal.getMinutes();

      // Determine mode (normalized from student config)
      const mode = studentConfig?.mode ?? 'compact';
      const studentCell = mode === 'verbose' ? '' : studentCellTitle;
      if (mode === 'verbose') addTableHeader(table, studentCellTitle);

      // Use student config only (backend normalization already applied)
      const rangeEnd = Number(studentConfig?.exams?.daysAhead ?? studentConfig?.daysAhead ?? studentConfig?.nextDays ?? 7);

      if (ctx._currentTodayYmd) log('debug', `[exams] using debugDate ${ctx._currentTodayYmd}`);
      const showSubject = studentConfig?.exams?.showSubject ?? studentConfig?.showExamSubject ?? true;
      const showTeacher = studentConfig?.exams?.showTeacher ?? studentConfig?.showExamTeacher ?? true;

      log(
        'debug',
        `[exams] render start | entries: ${exams.length} | range: ${rangeEnd}d | show: subject=${showSubject}, teacher=${showTeacher}`
      );

      exams
        .slice()
        .sort((a, b) => (Number(a.examDate) || 0) - (Number(b.examDate) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
        .forEach((exam) => {
          const examYmd = Number(exam.examDate) || 0;
          const examHm = Number(exam.startTime) || 0;
          const examInPast = examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm);
          if (examInPast && ctx.config.logLevel !== 'debug') {
            log('debug', `[exams] skip past: ${examYmd} ${exam.subject}`);
            return;
          }

          // Check if exam is within range
          // const daysDiff = Math.floor((examYmd - nowYmd) / 100) + ((examYmd % 100) - (nowYmd % 100));

          // if (daysDiff > rangeEnd) return;

          log('debug', `[exams] add: ${examYmd} ${exam.subject}`);

          addedRows++;

          const examDateFormat = studentConfig?.exams?.dateFormat ?? 'dd.MM.';
          const fallbackDay = String(examYmd % 100).padStart(2, '0');
          const fallbackMonth = String(Math.floor(examYmd / 100) % 100).padStart(2, '0');
          const formattedDate = util?.formatDate ? util.formatDate(examYmd, examDateFormat) : `${fallbackDay}.${fallbackMonth}.`;
          const dateTimeCell = formattedDate ? `${formattedDate}` : '';

          let nameCell = escapeHtml(exam.name);
          if (showSubject) {
            nameCell = `${escapeHtml(exam.subject)}: &nbsp;${escapeHtml(exam.name)}`;
          }

          if (showTeacher) {
            const teacher = Array.isArray(exam.teachers) && exam.teachers.length > 0 ? exam.teachers[0] : '';
            if (teacher) nameCell += '&nbsp;' + `(${escapeHtml(teacher)})`;
          }

          if (exam.text) {
            nameCell += `<br/><span class="xsmall dimmed">${escapeHtml(exam.text)}</span>`;
          }

          addTableRow(table, 'examRow', studentCell, dateTimeCell, nameCell);
        });

      if (addedRows === 0) {
        log('debug', `[exams] no entries to display`);
        addTableRow(table, 'examRowEmpty', studentCell, ctx.translate('no_exams'));
      } else {
        log('debug', `[exams] render complete | rows: ${addedRows}`);
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
