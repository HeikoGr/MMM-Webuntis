(function () {
    const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

    function formatYmd(ymd) {
        return formatDate(ymd, 'dd.MM.yyyy');
    }

    function formatDate(ymd, format = 'dd.MM.yyyy') {
        const n = Number(ymd);
        if (!Number.isFinite(n) || n <= 0) return '';
        const day = String(n % 100).padStart(2, '0');
        const month = String(Math.floor(n / 100) % 100).padStart(2, '0');
        const year = String(Math.floor(n / 10000));
        const replacements = {
            dd: day,
            mm: month,
            yyyy: year,
            yy: year.slice(-2),
        };
        return String(format).replace(/(yyyy|yy|dd|mm)/gi, (match) => replacements[match.toLowerCase()] || match);
    }

    function formatTime(v) {
        if (v === null || v === undefined) return '';
        const s = String(v).trim();
        if (s.includes(':')) return s;
        const digits = s.replace(/\D/g, '').padStart(4, '0');
        return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
    }

    function toMinutes(t) {
        if (t === null || t === undefined) return NaN;
        const s = String(t).trim();
        if (s.includes(':')) {
            const parts = s.split(':').map((p) => p.replace(/\D/g, ''));
            const hh = parseInt(parts[0], 10) || 0;
            const mm = parseInt(parts[1] || '0', 10) || 0;
            return hh * 60 + mm;
        }
        const digits = s.replace(/\D/g, '').padStart(4, '0');
        const hh = parseInt(digits.slice(0, 2), 10) || 0;
        const mm = parseInt(digits.slice(2), 10) || 0;
        return hh * 60 + mm;
    }

    function createElement(tag, className = '', innerHTML = '') {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (innerHTML !== undefined && innerHTML !== null) el.innerHTML = innerHTML;
        return el;
    }

    function addTableHeader(table, studentTitle = '') {
        const thisRow = createElement('tr');
        const studentCell = createElement('th', 'align-left alignTop', studentTitle);
        studentCell.colSpan = 3;
        thisRow.appendChild(studentCell);
        table.appendChild(thisRow);
    }

    function addTableRow(table, type, studentTitle = '', text1 = '', text2 = '', addClass = '') {
        const thisRow = createElement('tr');
        thisRow.className = type;

        if (studentTitle !== '') {
            const studentCell = createElement('td', 'align-left alignTop bold', studentTitle);
            thisRow.appendChild(studentCell);
        }

        const cell1 = createElement('td', 'align-left alignTop', text1);
        if (text2 === '') cell1.colSpan = 2;
        thisRow.appendChild(cell1);

        if (text2 !== '') {
            const cell2 = createElement('td', `align-left alignTop ${addClass}`, text2);
            thisRow.appendChild(cell2);
        }

        table.appendChild(thisRow);
    }

    function createTable() {
        const t = createElement('table');
        t.className = 'bright small light';
        return t;
    }

    root.util = {
        formatYmd,
        formatTime,
        toMinutes,
        formatDate,
    };

    root.dom = {
        createElement,
        addTableHeader,
        addTableRow,
        createTable,
    };
})();
