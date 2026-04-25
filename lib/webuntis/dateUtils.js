/**
 * Date utilities for WebUntis backend services.
 *
 * Provides a single place for formatting backend Date values.
 */

function toDatePartsFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
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

module.exports = {
  formatDateFromDate,
};
