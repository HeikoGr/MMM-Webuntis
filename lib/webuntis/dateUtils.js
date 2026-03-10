/**
 * Date utilities for WebUntis backend services.
 *
 * Provides a single place for converting Date and YYYYMMDD values
 * into API and display-ready string formats.
 */

function toDatePartsFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function toDatePartsFromYmd(ymd) {
  const num = Number(ymd);
  if (!Number.isFinite(num)) return null;

  const year = Math.floor(num / 10000);
  const month = Math.floor((num % 10000) / 100);
  const day = num % 100;

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

function formatDateParts(parts, format = 'YYYY-MM-DD') {
  if (!parts) return '';

  const { year, month, day } = parts;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');

  if (format === 'YYYYMMDD') {
    return `${year}${mm}${dd}`;
  }

  if (format === 'DD.MM.YYYY') {
    return `${dd}.${mm}.${year}`;
  }

  return `${year}-${mm}-${dd}`;
}

function formatDateFromDate(date, format = 'YYYY-MM-DD') {
  return formatDateParts(toDatePartsFromDate(date), format);
}

function formatDateFromYmd(ymd, format = 'YYYY-MM-DD') {
  return formatDateParts(toDatePartsFromYmd(ymd), format);
}

module.exports = {
  formatDateFromDate,
  formatDateFromYmd,
};
