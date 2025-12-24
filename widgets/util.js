(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

  // Global log function - respects window.MMMWebuntisLogLevel set by main module
  function log(level, ...args) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const configured = window.MMMWebuntisLogLevel || 'info';
    const configuredLevel = levels[configured] !== undefined ? configured : 'info';
    const msgLevel = levels[level] !== undefined ? level : 'info';
    if (levels[msgLevel] <= levels[configuredLevel]) {
      const prefix = '[MMM-Webuntis]';
      const tag = `${prefix} [${String(level).toUpperCase()}]`;
      console.warn(tag, ...args);
    }
  }

  function formatYmd(ymd) {
    return formatDate(ymd, 'dd.MM.yyyy');
  }

  function formatDate(ymd, format = 'dd.MM.yyyy') {
    if (ymd === null || ymd === undefined || ymd === '') return '';
    // support numeric ymd (20251214) or ISO date strings (2025-12-14 / 2025-12-14T00:00:00Z)
    let day;
    let month;
    let year;
    const n = Number(ymd);
    if (Number.isFinite(n) && n > 0) {
      day = String(n % 100).padStart(2, '0');
      month = String(Math.floor(n / 100) % 100).padStart(2, '0');
      year = String(Math.floor(n / 10000));
    } else {
      const parsed = new Date(String(ymd));
      if (Number.isNaN(parsed.getTime())) return '';
      day = String(parsed.getDate()).padStart(2, '0');
      month = String(parsed.getMonth() + 1).padStart(2, '0');
      year = String(parsed.getFullYear());
    }
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

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    if (addClass) {
      thisRow.className = `${thisRow.className} ${addClass}`.trim();
    }

    if (studentTitle !== '') {
      const studentCell = createElement('td', 'align-left alignTop bold wu-col-student', studentTitle);
      thisRow.appendChild(studentCell);
    }

    const primaryClass = text2 === '' ? 'wu-col-data' : 'wu-col-meta';
    const cell1 = createElement('td', `align-left alignTop ${primaryClass}`, text1);
    if (text2 === '') cell1.colSpan = 2;
    thisRow.appendChild(cell1);

    if (text2 !== '') {
      const cell2 = createElement('td', `align-left alignTop wu-col-data ${addClass}`, text2);
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
    escapeHtml,
    log,
    _log: log, // backward compatibility alias
  };

  root.dom = {
    createElement,
    addTableHeader,
    addTableRow,
    createTable,
  };
})();
