(function () {
    const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

    function formatYmd(ymd) {
        const n = Number(ymd);
        if (!Number.isFinite(n) || n <= 0) return '';
        const day = n % 100;
        const month = Math.floor(n / 100) % 100;
        const year = Math.floor(n / 10000);
        return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
    }

    function formatTime(v) {
        if (v === null || v === undefined) return '';
        const s = String(v).trim();
        if (s.includes(':')) return s;
        const digits = s.replace(/\D/g, '').padStart(4, '0');
        return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
    }

    root.util = {
        formatYmd,
        formatTime,
    };
})();
