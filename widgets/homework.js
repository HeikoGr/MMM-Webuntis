(function () {
    const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
    const util = root.util;

    function renderHomeworksForStudent(ctx, table, studentCellTitle, studentConfig, homeworks) {
        let addedRows = 0;

        if (!Array.isArray(homeworks) || homeworks.length === 0) {
            ctx._addTableRow(table, 'lessonRowEmpty', studentCellTitle, ctx.translate('no_homework'));
            return 1;
        }

        const sorted = homeworks
            .slice()
            .sort(
                (a, b) => (Number(a.dueDate) || 0) - (Number(b.dueDate) || 0) || String(a.su?.name || '').localeCompare(String(b.su?.name || ''))
            );

        for (const hw of sorted) {
            const due = hw?.dueDate ? util.formatYmd(hw.dueDate) : '';
            const subj = hw?.su?.longname || hw?.su?.name || '';
            const text = String(hw?.text || hw?.remark || '').trim();

            const left = due ? `${due}` : ctx.translate('homework');
            const rightParts = [];
            if (subj) rightParts.push(`<b>${subj}</b>`);
            if (text) rightParts.push(`<span class='xsmall dimmed'>${text.replace(/\n/g, '<br>')}</span>`);
            const right = rightParts.length > 0 ? rightParts.join('<br>') : ctx.translate('homework');

            ctx._addTableRow(table, 'lessonRow', studentCellTitle, left, right);
            addedRows++;
        }

        return addedRows;
    }

    root.homework = {
        renderHomeworksForStudent,
    };
})();
