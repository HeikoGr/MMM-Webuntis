(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

  const util = root.util || {};
  const log = typeof util.log === 'function' ? util.log : () => { };
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableHeader = typeof dom.addTableHeader === 'function' ? dom.addTableHeader : () => { };
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => { };

  function renderExamsForStudent(ctx, table, studentCellTitle, studentConfig, exams) {
    try {
      let addedRows = 0;
      if (!Array.isArray(exams)) {
        log('debug', `[exams] no data (not array)`);
        return 0;
      }

      const now = new Date();
      const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
      const nowHm = now.getHours() * 100 + now.getMinutes();

      // Determine mode (module-level only) and student cell handling
      const mode = studentConfig?.mode ?? ctx.config?.mode ?? 'compact';
      const studentCell = mode === 'verbose' ? '' : studentCellTitle;
      if (mode === 'verbose') addTableHeader(table, studentCellTitle);

      // Use module-level config only (node_helper applies per-student normalization)
      const rangeEnd = studentConfig?.examsDaysAhead ?? studentConfig?.exams_DaysAhead ?? ctx.config?.examsDaysAhead ?? 7;
      const showSubject = studentConfig?.exams?.showSubject ?? studentConfig?.showExamSubject ?? ctx.config?.showExamSubject ?? true;
      const showTeacher = studentConfig?.exams?.showTeacher ?? studentConfig?.showExamTeacher ?? ctx.config?.showExamTeacher ?? true;

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

          const examDateFormat =
            studentConfig?.dateFormats?.exams ?? ctx.config?.dateFormats?.exams ?? ctx.config?.dateFormats?.default ?? 'dd.MM.';
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
