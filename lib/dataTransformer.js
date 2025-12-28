/**
 * Data Transformer Service
 * Handles data transformation and normalization for WebUntis API responses
 */

/**
 * Maps REST API lesson status codes to legacy status codes for frontend rendering
 *
 * @param {string} status - REST API status code (e.g., 'CANCELLED', 'SUBSTITUTION')
 * @param {string} [substitutionText] - Optional substitution text
 * @returns {string} Legacy status code ('cancelled', 'irregular', or '')
 *
 * Status mapping:
 * - 'CANCELLED'/'CANCEL' → 'cancelled' (displayed with cancelled styling)
 * - 'ADDITIONAL'/'CHANGED'/'SUBSTITUTION'/'SUBSTITUTE' → 'irregular' (replacement lesson)
 * - 'REGULAR'/'NORMAL' → '' (or 'irregular' if substitution text present)
 * - Any other → '' (or 'irregular' if substitution text present)
 */
function mapRestStatusToLegacyCode(status, substitutionText) {
  if (!status) return '';

  const statusUpper = String(status).toUpperCase();
  const hasSubstitutionText = substitutionText && String(substitutionText).trim() !== '';

  switch (statusUpper) {
    case 'CANCELLED':
    case 'CANCEL':
      return 'cancelled';
    case 'ADDITIONAL':
    case 'CHANGED':
    case 'SUBSTITUTION':
    case 'SUBSTITUTE':
      return 'irregular';
    case 'REGULAR':
    case 'NORMAL':
    case 'NORMAL_TEACHING_PERIOD':
      return hasSubstitutionText ? 'irregular' : '';
    default:
      return hasSubstitutionText ? 'irregular' : '';
  }
}

/**
 * Sanitizes HTML text by removing tags and decoding entities
 *
 * @param {string} text - HTML text to sanitize
 * @param {boolean} [preserveLineBreaks=true] - Whether to preserve <br> tags as newlines
 * @returns {string} Sanitized text
 *
 * Process:
 * 1. Convert <br> tags to newlines (if preserveLineBreaks is true)
 * 2. Remove all HTML tags
 * 3. Decode HTML entities (&lt;, &gt;, &quot;, &apos;, &nbsp;, &amp;)
 * 4. Clean up extra whitespace
 */
function sanitizeHtmlText(text, preserveLineBreaks = true) {
  if (!text) return '';
  let result = String(text);

  // Step 1: Preserve intentional line breaks by converting <br> tags to newlines
  if (preserveLineBreaks) {
    result = result.replace(/<br\s*\/?>/gi, '\n');
  }

  // Step 2: Remove all remaining HTML tags
  result = result.replace(/<[^>]*>/g, '');

  // Step 3: Decode HTML entities
  result = result
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // Must be last

  // Step 4: Clean up extra whitespace (but preserve intentional newlines)
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Normalizes date from various formats to YYYYMMDD integer
 *
 * @param {string|number} date - Date in various formats
 * @returns {number|null} Date as YYYYMMDD integer, or null if invalid
 *
 * Accepts:
 * - ISO string: "2025-12-17" → 20251217
 * - Integer: 20251217 → 20251217
 * - Numeric string: "20251217" → 20251217
 */
function normalizeDateToInteger(date) {
  if (!date) return null;

  // If already an integer in YYYYMMDD format, return as-is
  if (typeof date === 'number' && date > 10000000 && date < 99991231) {
    return date;
  }

  // Parse ISO string format "YYYY-MM-DD" → YYYYMMDD
  const dateStr = String(date);
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parts[0].padStart(4, '0');
      const m = parts[1].padStart(2, '0');
      const d = parts[2].padStart(2, '0');
      return parseInt(`${y}${m}${d}`, 10);
    }
  }

  // Try to parse as plain number
  const num = parseInt(String(date).replace(/\D/g, ''), 10);
  return num > 10000000 && num < 99991231 ? num : null;
}

/**
 * Normalizes time from various formats to HHMM integer
 *
 * @param {string|number} time - Time in various formats
 * @returns {number|null} Time as HHMM integer (e.g., 750 for 07:50), or null if invalid
 *
 * Accepts:
 * - HH:MM string: "07:50" → 750, "08:45" → 845
 * - Integer: 750 → 750
 * - Numeric string: "0750" → 750
 */
function normalizeTimeToMinutes(time) {
  if (!time && time !== 0) return null;

  // If already an integer in HHMM format, return as-is
  if (typeof time === 'number' && time >= 0 && time < 2400) {
    return time;
  }

  // Parse HH:MM string format
  const timeStr = String(time).trim();
  if (timeStr.includes(':')) {
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const hh = parseInt(parts[0], 10) || 0;
      const mm = parseInt(parts[1], 10) || 0;
      return hh * 100 + mm;
    }
  }

  // Try to parse as plain number
  const num = parseInt(String(time).replace(/\D/g, ''), 10);
  return num >= 0 && num < 2400 ? num : null;
}

/**
 * Compacts holiday data by removing unnecessary fields
 *
 * @param {Array} rawHolidays - Raw holiday data from WebUntis API
 * @returns {Array} Compacted holiday data with only essential fields
 */
function compactHolidays(rawHolidays) {
  if (!Array.isArray(rawHolidays)) return [];

  return rawHolidays.map((holiday) => ({
    id: holiday?.id,
    name: holiday?.name || holiday?.shortName,
    longName: holiday?.longName || holiday?.name,
    startDate: holiday?.startDate,
    endDate: holiday?.endDate,
  }));
}

/**
 * Formats date from YYYYMMDD integer to various output formats
 *
 * @param {number} ymd - Date as YYYYMMDD integer (e.g., 20251217)
 * @param {string} [format='YYYY-MM-DD'] - Output format
 * @returns {string} Formatted date string
 */
function formatDate(ymd, format = 'YYYY-MM-DD') {
  if (!ymd) return '';

  const num = Number(ymd);
  if (!Number.isFinite(num)) return '';

  const year = Math.floor(num / 10000);
  const month = Math.floor((num % 10000) / 100);
  const day = num % 100;

  if (format === 'YYYY-MM-DD') {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (format === 'DD.MM.YYYY') {
    return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
  }
  if (format === 'YYYYMMDD') {
    return String(ymd);
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

module.exports = {
  mapRestStatusToLegacyCode,
  sanitizeHtmlText,
  normalizeDateToInteger,
  normalizeTimeToMinutes,
  compactHolidays,
  formatDate,
};
