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
 * Returns a new Date object without mutating the original
 *
 * @param {Date} date - Base date
 * @param {number} days - Number of days to add (can be negative for subtraction)
 * @returns {Date} New date object with days added/subtracted
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

module.exports = {
  toMinutes,
  formatTime,
  addDays,
  formatDateYYYYMMDD,
};
