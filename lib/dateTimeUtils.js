/**
 * Date and Time Utility Functions for MMM-Webuntis
 *
 * This module provides utilities for date and time calculations, conversions,
 * and formatting that are used across the module.
 *
 * @module lib/dateTimeUtils
 */

/**
 * Convert time to minutes since midnight
 * Handles both "HH:MM" string format and HHMM integer format
 *
 * @param {string|number} time - Time in "HH:MM" format or HHMM integer (e.g., 750, 1455)
 * @returns {number} Minutes since midnight (0-1439)
 *
 * @example
 * toMinutes("07:50") // 470
 * toMinutes(750)     // 470
 * toMinutes("14:55") // 895
 * toMinutes(1455)    // 895
 */
function toMinutes(time) {
  if (time === null || time === undefined) return NaN;

  const s = String(time).trim();

  // Handle "HH:MM" format
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => p.replace(/\D/g, ''));
    const hh = parseInt(parts[0], 10) || 0;
    const mm = parseInt(parts[1] || '0', 10) || 0;
    return hh * 60 + mm;
  }

  // Handle HHMM integer format (e.g., 750 -> 7:50 -> 470 minutes)
  const digits = s.replace(/\D/g, '').padStart(4, '0');
  const hh = parseInt(digits.slice(0, 2), 10) || 0;
  const mm = parseInt(digits.slice(2), 10) || 0;
  return hh * 60 + mm;
}

/**
 * Format time as "HH:MM" string
 * Handles both string and integer input
 *
 * @param {string|number} time - Time in "HH:MM" format or HHMM integer
 * @returns {string} Formatted time string "HH:MM"
 *
 * @example
 * formatTime(750)     // "07:50"
 * formatTime("750")   // "07:50"
 * formatTime("7:50")  // "7:50"
 * formatTime(1455)    // "14:55"
 */
function formatTime(time) {
  if (time === null || time === undefined) return '';

  const s = String(time).trim();

  // Already in HH:MM format
  if (s.includes(':')) return s;

  // Convert HHMM to HH:MM
  const digits = s.replace(/\D/g, '').padStart(4, '0');
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

/**
 * Add days to a date
 *
 * @param {Date} date - Base date
 * @param {number} days - Number of days to add (can be negative)
 * @returns {Date} New date object
 *
 * @example
 * addDays(new Date('2025-12-17'), 3)  // 2025-12-20
 * addDays(new Date('2025-12-17'), -2) // 2025-12-15
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Format date as YYYY-MM-DD string
 *
 * @param {Date} date - Date to format
 * @returns {string} Date string in YYYY-MM-DD format
 *
 * @example
 * formatDateYYYYMMDD(new Date('2025-12-17')) // "2025-12-17"
 */
function formatDateYYYYMMDD(date) {
  if (!date || !(date instanceof Date)) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Parse date string or integer to Date object
 * Handles multiple formats: YYYYMMDD integer, "YYYY-MM-DD" string, Date object
 *
 * @param {Date|string|number} input - Date in various formats
 * @returns {Date|null} Date object or null if invalid
 *
 * @example
 * parseDate(20251217)         // Date(2025-12-17)
 * parseDate("2025-12-17")     // Date(2025-12-17)
 * parseDate(new Date())       // Date object (same instance)
 */
function parseDate(input) {
  if (!input) return null;

  // Already a Date object
  if (input instanceof Date) return input;

  // YYYYMMDD integer (e.g., 20251217)
  if (typeof input === 'number') {
    const str = String(input);
    if (str.length === 8) {
      const year = parseInt(str.slice(0, 4), 10);
      const month = parseInt(str.slice(4, 6), 10) - 1; // Month is 0-based
      const day = parseInt(str.slice(6, 8), 10);
      return new Date(year, month, day);
    }
  }

  // String format (YYYY-MM-DD or other ISO format)
  if (typeof input === 'string') {
    const date = new Date(input);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/**
 * Get the difference in days between two dates
 *
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {number} Number of days between dates (can be negative)
 *
 * @example
 * daysBetween(new Date('2025-12-17'), new Date('2025-12-20')) // 3
 * daysBetween(new Date('2025-12-20'), new Date('2025-12-17')) // -3
 */
function daysBetween(date1, date2) {
  const oneDay = 24 * 60 * 60 * 1000; // milliseconds in a day
  const diffMs = date2.getTime() - date1.getTime();
  return Math.round(diffMs / oneDay);
}

/**
 * Check if a date is today
 *
 * @param {Date} date - Date to check
 * @param {Date} [referenceDate=new Date()] - Reference date (defaults to current date)
 * @returns {boolean} True if date is today
 *
 * @example
 * isToday(new Date()) // true
 * isToday(new Date('2025-12-17'), new Date('2025-12-17')) // true
 */
function isToday(date, referenceDate = new Date()) {
  if (!date || !(date instanceof Date)) return false;

  return (
    date.getFullYear() === referenceDate.getFullYear() &&
    date.getMonth() === referenceDate.getMonth() &&
    date.getDate() === referenceDate.getDate()
  );
}

/**
 * Check if date1 is before date2 (ignoring time)
 *
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {boolean} True if date1 is before date2
 */
function isBefore(date1, date2) {
  if (!date1 || !date2) return false;

  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());

  return d1 < d2;
}

/**
 * Check if date1 is after date2 (ignoring time)
 *
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {boolean} True if date1 is after date2
 */
function isAfter(date1, date2) {
  if (!date1 || !date2) return false;

  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());

  return d1 > d2;
}

/**
 * Get start of day (00:00:00.000)
 *
 * @param {Date} date - Date to normalize
 * @returns {Date} New date at start of day
 */
function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of day (23:59:59.999)
 *
 * @param {Date} date - Date to normalize
 * @returns {Date} New date at end of day
 */
function endOfDay(date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

module.exports = {
  toMinutes,
  formatTime,
  addDays,
  formatDateYYYYMMDD,
  parseDate,
  daysBetween,
  isToday,
  isBefore,
  isAfter,
  startOfDay,
  endOfDay,
};
