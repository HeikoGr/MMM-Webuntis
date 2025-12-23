(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

  const util = root.util || {};
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => {};

  function renderExamsForStudent(ctx, table, studentCellTitle, studentConfig, exams) {
    let addedRows = 0;
    if (!Array.isArray(exams)) return 0;

    const now = new Date();
    const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const nowHm = now.getHours() * 100 + now.getMinutes();

    // Get exams options from nested config
    const rangeEnd = studentConfig?.exams_DaysAhead ?? 7;
    const showSubject = studentConfig?.exams?.showSubject ?? true;
    const showTeacher = studentConfig?.exams?.showTeacher ?? true;

    console.warn(`[exams] Input: ${exams.length} exams, rangeEnd=${rangeEnd}, nowYmd=${nowYmd}`);

    exams
      .slice()
      .sort((a, b) => (Number(a.examDate) || 0) - (Number(b.examDate) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
      .forEach((exam) => {
        const examYmd = Number(exam.examDate) || 0;
        const examHm = Number(exam.startTime) || 0;
        const examInPast = examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm);
        if (examInPast && ctx.config.logLevel !== 'debug') return;

        // Check if exam is within range
        // const daysDiff = Math.floor((examYmd - nowYmd) / 100) + ((examYmd % 100) - (nowYmd % 100));

        // if (daysDiff > rangeEnd) return;

        console.warn(`  [exams] Including exam ${examYmd} (${exam.subject}: ${exam.name})`);

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

        addTableRow(table, 'examRow', studentCellTitle, dateTimeCell, nameCell);
      });

    if (addedRows === 0) {
      addTableRow(table, 'examRowEmpty', studentCellTitle, ctx.translate('no_exams'));
    }

    return addedRows;
  }

  root.exams = {
    renderExamsForStudent,
  };
})();
