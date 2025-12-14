(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

  function renderExamsForStudent(ctx, table, studentCellTitle, studentConfig, exams) {
    let addedRows = 0;
    if (!Array.isArray(exams)) return 0;

    const now = new Date();
    const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const nowHm = now.getHours() * 100 + now.getMinutes();

    exams
      .slice()
      .sort((a, b) => (Number(a.examDate) || 0) - (Number(b.examDate) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
      .forEach((exam) => {
        const examYmd = Number(exam.examDate) || 0;
        const examHm = Number(exam.startTime) || 0;
        const examInPast = examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm);
        if (examInPast && ctx.config.logLevel !== 'debug') return;

        addedRows++;

        const day = examYmd % 100;
        const month = Math.floor(examYmd / 100) % 100;
        const dateTimeCell = `${day}.${month}.&nbsp;`;

        let nameCell = exam.name;
        if (studentConfig.showExamSubject) {
          nameCell = `${exam.subject}: &nbsp;${exam.name}`;
        }

        if (studentConfig.showExamTeacher) {
          const teacher = Array.isArray(exam.teachers) && exam.teachers.length > 0 ? exam.teachers[0] : '';
          if (teacher) nameCell += '&nbsp;' + `(${teacher})`;
        }

        if (exam.text) {
          nameCell += `<br/><span class="xsmall dimmed">${exam.text}</span>`;
        }

        ctx._addTableRow(table, 'examRow', studentCellTitle, dateTimeCell, nameCell);
      });

    if (addedRows === 0) {
      ctx._addTableRow(table, 'examRowEmpty', studentCellTitle, ctx.translate('no_exams'));
    }

    return addedRows;
  }

  root.exams = {
    renderExamsForStudent,
  };
})();
