/**
 * Payload Compaction Utilities
 * Unified functions for transforming raw API responses into compact frontend-friendly formats
 */

/**
 * Compact a single item using a schema that defines field mappings and transformations
 * @param {Object} raw - Raw API response item
 * @param {Object} schema - Schema defining how to transform the item
 * @returns {Object} Compacted item
 */
function compactItem(raw, schema) {
  if (!raw || typeof raw !== 'object') return {};

  const result = {};
  for (const [outputKey, fieldDef] of Object.entries(schema)) {
    const inputKey = fieldDef.from || outputKey;
    const fallbacks = fieldDef.fallbacks || [];
    const transform = fieldDef.transform || ((v) => v);
    const defaultValue = fieldDef.default ?? null;

    // Try primary field, then fallbacks
    let value = raw[inputKey];
    if (value === null || value === undefined) {
      for (const fb of fallbacks) {
        if (raw[fb] !== null && raw[fb] !== undefined) {
          value = raw[fb];
          break;
        }
      }
    }

    // Apply transform or use default
    result[outputKey] = value !== null && value !== undefined ? transform(value) : defaultValue;
  }

  return result;
}

/**
 * Compact array of items using schema
 */
function compactArray(rawArray, schema) {
  if (!Array.isArray(rawArray)) return [];
  return rawArray.map((item) => compactItem(item, schema));
}

/**
 * Schemas for different data types
 */
const schemas = {
  lesson: {
    date: { from: 'date', transform: (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0 },
    // Lessons come from timetable REST API (HHMM integers) or timegrid (HH:MM strings)
    startTime: {
      from: 'startTime',
      transform: (v) => parseTimegridTimeString(v) || v,
      default: null,
    },
    endTime: {
      from: 'endTime',
      transform: (v) => parseTimegridTimeString(v) || v,
      default: null,
    },
    su: {
      from: 'su',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    te: {
      from: 'te',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    ro: {
      from: 'ro',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    cl: {
      from: 'cl',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    sg: {
      from: 'sg',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    info: {
      from: 'info',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    substText: { from: 'substText', default: '' },
    lstext: { from: 'lstext', default: '' },
    activityType: { from: 'activityType', default: 'NORMAL_TEACHING_PERIOD' },
    status: { from: 'status', default: 'REGULAR' },
    id: { from: 'id', default: null },
    // NOTE: 'lessonId' not immer von webuntisApiService.getTimetable() befüllt, aber für Kompatibilität mit Zeitraster/Legacy belassen.
    lessonId: { from: 'lessonId', default: null },
  },

  exam: {
    examDate: {
      from: 'examDate',
      transform: (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0,
    },
    // Exams come from REST API with HHMM integer format (e.g., 1350 = 13:50)
    startTime: { from: 'startTime', default: null },
    endTime: { from: 'endTime', default: null },
    name: { from: 'name', transform: (v) => sanitizeHtml(v, false), default: '' },
    subject: { from: 'subject', transform: (v) => sanitizeHtml(v, false), default: '' },
    teachers: { from: 'teachers', transform: (v) => (Array.isArray(v) ? v.slice(0, 2) : []), default: [] },
    text: { from: 'text', transform: (v) => sanitizeHtml(v, true), default: '' },
  },

  homework: {
    id: { from: 'id', default: null },
    // NOTE: 'lid' not populated by webuntisApiService.getHomework(), defined for compatibility
    lid: { from: 'lid', default: null },
    lessonId: { from: 'lessonId', default: null },
    studentId: { from: 'studentId', default: null },
    elementIds: { from: 'elementIds', transform: (v) => (Array.isArray(v) ? v.slice() : []), default: [] },
    dueDate: { from: 'dueDate', fallbacks: ['date'], default: null },
    completed: { from: 'completed', default: null },
    text: {
      from: 'text',
      fallbacks: ['description', 'remark'],
      transform: (v) => sanitizeHtml(v, true),
      default: '',
    },
    remark: { from: 'remark', transform: (v) => sanitizeHtml(v, false), default: '' },
    su: {
      from: 'su',
      transform: (v) => formatSubject(v),
      default: null,
    },
  },

  absence: {
    date: {
      from: 'date',
      fallbacks: ['startDate', 'absenceDate', 'day'],
      transform: (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0,
    },
    // Absences come from REST API with HHMM integer format (e.g., 1350 = 13:50)
    startTime: { from: 'startTime', fallbacks: ['start'], default: null },
    endTime: { from: 'endTime', fallbacks: ['end'], default: null },
    reason: {
      from: 'reason',
      fallbacks: ['reasonText', 'text'],
      transform: (v) => sanitizeHtml(v, false),
      default: '',
    },
    excused: { from: 'isExcused', fallbacks: ['excused'], default: null },
    student: { from: 'student', default: null },
    su: {
      from: 'su',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    te: {
      from: 'te',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    lessonId: { from: 'lessonId', fallbacks: ['lid', 'id'], default: null },
  },

  message: {
    id: { from: 'id', default: null },
    subject: {
      from: 'subject',
      fallbacks: ['title'],
      transform: (v) => sanitizeHtml(v, true),
      default: '',
    },
    text: {
      from: 'text',
      fallbacks: ['content'],
      transform: (v) => sanitizeHtml(v, true),
      default: '',
    },
    isExpanded: { from: 'isExpanded', default: false },
  },
};

/**
 * Helper: Parse HH:MM time string (from timegrid) to HHMM integer
 * Timegrid returns times as "07:50", "13:50", etc.
 * REST API already returns HHMM integers, so no parsing needed there.
 *
 * @param {string|number} value - HH:MM format string (e.g., "13:50") or HHMM integer (e.g., 1350)
 * @returns {number|null} HHMM integer if input is HH:MM string, null otherwise (letting original value pass through)
 */
function parseTimegridTimeString(value) {
  // Only parse if it's a string with ':'
  if (typeof value !== 'string') return null;

  const s = value.trim();
  if (!s.includes(':')) return null;

  const [hhRaw, mmRaw] = s.split(':');
  const hh = parseInt(hhRaw.replace(/\D/g, ''), 10);
  const mm = parseInt((mmRaw || '').replace(/\D/g, ''), 10);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (mm < 0 || mm > 59 || hh < 0 || hh > 23) return null;

  return hh * 100 + mm;
}

/**
 * Helper: sanitize HTML (basic strip tags)
 * Preserves line breaks from <br>, </p>, </div> tags by converting to \n
 * Allows safe formatting tags like <b>, <i>, <u>, <strong>, <em>
 */
function sanitizeHtml(text, allowMarkdown = false) {
  if (!text) return '';
  let result = String(text);

  // Safe HTML tags that are allowed for formatting (whitelist)
  const allowedTags = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'small'];

  // Convert common HTML line break elements to newlines BEFORE stripping tags
  result = result
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');

  // Strip all HTML tags EXCEPT allowed formatting tags
  // Remove attributes from allowed tags (keep only the tag itself)
  result = result.replace(/<([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tagName) => {
    const tag = tagName.toLowerCase();
    if (allowedTags.includes(tag)) {
      return `<${tag}>`; // Keep tag but remove attributes
    }
    return ''; // Remove tag
  });

  // Keep closing tags for allowed tags
  result = result.replace(/<\/([a-z][a-z0-9]*)>/gi, (match, tagName) => {
    const tag = tagName.toLowerCase();
    if (allowedTags.includes(tag)) {
      return `</${tag}>`;
    }
    return '';
  });

  // Decode common HTML entities
  result = result
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean up: remove markdown formatting chars if not allowed
  if (!allowMarkdown) result = result.replace(/[_*]/g, '');

  // Clean up multiple consecutive newlines and whitespace
  result = result.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ');

  return result.trim();
}

/**
 * Helper: format subject object/array
 */
function formatSubject(su) {
  if (!su) return null;
  if (typeof su === 'object' && !Array.isArray(su)) {
    return { name: su.name || '', longname: su.longname || '' };
  }
  if (Array.isArray(su) && su[0]) {
    return { name: su[0].name || '', longname: su[0].longname || '' };
  }
  return null;
}

module.exports = {
  compactItem,
  compactArray,
  schemas,
  sanitizeHtml,
  formatSubject,
};
