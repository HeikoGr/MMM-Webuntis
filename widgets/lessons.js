(function () {
    const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

    function renderLessonsForStudent(ctx, table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap) {
        let addedRows = 0;

        if (!(studentConfig && studentConfig.daysToShow > 0)) return 0;

        const now = new Date();
        const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
        const nowHm = now.getHours() * 100 + now.getMinutes();

        const lessonsSorted = (Array.isArray(timetable) ? timetable : []).slice().sort((a, b) => {
            const da = Number(a.date) || 0;
            const db = Number(b.date) || 0;
            return da - db || (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
        });

        for (let i = 0; i < lessonsSorted.length; i++) {
            const entry = lessonsSorted[i];
            const dateStr = String(entry.date);
            const year = parseInt(dateStr.substring(0, 4), 10);
            const month = parseInt(dateStr.substring(4, 6), 10);
            const day = parseInt(dateStr.substring(6, 8), 10);
            const stNum = Number(entry.startTime) || 0;
            const stHour = Math.floor(stNum / 100);
            const stMin = stNum % 100;
            const timeForDay = new Date(year, month - 1, day);

            const isPast = Number(entry.date) < nowYmd || (Number(entry.date) === nowYmd && stNum < nowHm);
            if (
                (!studentConfig.showRegularLessons && (entry.code || '') === '') ||
                (isPast && (entry.code || '') !== 'error' && ctx.config.logLevel !== 'debug')
            ) {
                continue;
            }

            addedRows++;

            let timeStr = `${timeForDay.toLocaleDateString(ctx.config.language, { weekday: 'short' }).toUpperCase()}&nbsp;`;
            if (studentConfig.showStartTime || startTimesMap[entry.startTime] === undefined) {
                const hh = String(stHour).padStart(2, '0');
                const mm = String(stMin).padStart(2, '0');
                timeStr += `${hh}:${mm}`;
            } else {
                timeStr += `${startTimesMap[entry.startTime]}.`;
            }

            const subjLong = entry.su?.[0]?.longname || entry.su?.[0]?.name || 'N/A';
            const subjShort = entry.su?.[0]?.name || entry.su?.[0]?.longname || 'N/A';
            let subjectStr = studentConfig.useShortSubject ? subjShort : subjLong;

            if (studentConfig.showTeacherMode === 'initial') {
                const teacherInitial = entry.te?.[0]?.name || entry.te?.[0]?.longname || '';
                if (teacherInitial !== '') subjectStr += '&nbsp;' + `(${teacherInitial})`;
            } else if (studentConfig.showTeacherMode === 'full') {
                const teacherFull = entry.te?.[0]?.longname || entry.te?.[0]?.name || '';
                if (teacherFull !== '') subjectStr += '&nbsp;' + `(${teacherFull})`;
            }

            if (studentConfig.showSubstitutionText && (entry.substText || '') !== '') {
                subjectStr += `<br/><span class='xsmall dimmed'>${entry.substText}</span>`;
            }

            if ((entry.lstext || '') !== '') {
                if (subjectStr.trim() !== '') subjectStr += '<br/>';
                subjectStr += `<span class='xsmall dimmed'>${entry.lstext}</span>`;
            }

            let addClass = '';
            if (entry.code == 'cancelled' || entry.code == 'error' || entry.code == 'info') {
                addClass = entry.code;
            }

            ctx._addTableRow(table, 'lessonRow', studentCellTitle, timeStr, subjectStr, addClass);
        }

        if (addedRows === 0) {
            ctx._addTableRow(table, 'lessonRowEmpty', studentCellTitle, ctx.translate('nothing'));
            return 1;
        }

        return addedRows;
    }

    root.lessons = {
        renderLessonsForStudent,
    };
})();
