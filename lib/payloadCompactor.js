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
    // Keep times as HHMM numeric (e.g. 0750 -> 750) so frontend `_toMinutes()` parses them.
    startTime: { from: 'startTime', transform: (v) => normalizeToHHMM(v), default: null },
    endTime: { from: 'endTime', transform: (v) => normalizeToHHMM(v), default: null },
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
    code: { from: 'code', default: '' },
    substText: { from: 'substText', default: '' },
    lstext: { from: 'lstext', default: '' },
    type: { from: 'type', default: null },
    id: { from: 'id', default: null },
    lid: { from: 'lid', default: null },
    lessonId: { from: 'lessonId', default: null },
  },

  exam: {
    examDate: {
      from: 'examDate',
      transform: (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0,
    },
    startTime: { from: 'startTime', transform: (v) => normalizeToHHMM(v), default: null },
    endTime: { from: 'endTime', transform: (v) => normalizeToHHMM(v), default: null },
    name: { from: 'name', transform: (v) => sanitizeHtml(v, false), default: '' },
    subject: { from: 'subject', transform: (v) => sanitizeHtml(v, false), default: '' },
    teachers: { from: 'teachers', transform: (v) => (Array.isArray(v) ? v.slice(0, 2) : []), default: [] },
    text: { from: 'text', transform: (v) => sanitizeHtml(v, true), default: '' },
  },

  homework: {
    id: { from: 'id', default: null },
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
    startTime: { from: 'startTime', fallbacks: ['start'], transform: (v) => normalizeToHHMM(v), default: null },
    endTime: { from: 'endTime', fallbacks: ['end'], transform: (v) => normalizeToHHMM(v), default: null },
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
 * Helper: convert time string HH:MM or HHMM to minutes
 */
function timeToMinutes(v) {
  if (v === null || v === undefined) return 0;

  // If already a finite number, decide whether it's minutes or HHMM numeric
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.floor(v);
    const hh = Math.floor(n / 100);
    const mm = n % 100;
    // If last two digits look like minutes (0-59) and hours in 0-23, treat as HHMM
    if (mm >= 0 && mm <= 59 && hh >= 0 && hh <= 23) return hh * 60 + mm;
    // Otherwise treat as minutes-since-midnight
    if (n >= 0 && n < 24 * 60) return n;
    // Fallback: return as-is
    return n;
  }

  const s = String(v).trim();
  if (s.includes(':')) {
    const [hh, mm] = s.split(':').map((p) => parseInt(p, 10) || 0);
    return hh * 60 + mm;
  }

  const digits = s.replace(/\D/g, '');
  if (digits.length === 0) return 0;
  const n = parseInt(digits, 10) || 0;
  const hh = Math.floor(n / 100);
  const mm = n % 100;
  if (mm >= 0 && mm <= 59 && hh >= 0 && hh <= 23) return hh * 60 + mm;
  if (n >= 0 && n < 24 * 60) return n;
  return n;
}

/**
 * Normalize various time representations to HHMM integer (e.g. '07:50'|'0750'|470(minutes) -> 750)
 */
function normalizeToHHMM(v) {
  if (v === null || v === undefined) return null;
  // If already a number
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.floor(v);
    // If looks like minutes (0..1439), convert to HHMM
    if (n >= 0 && n < 24 * 60) {
      const hh = Math.floor(n / 60);
      const mm = n % 60;
      return hh * 100 + mm;
    }
    // Otherwise assume it's already HHMM-like
    return n;
  }

  const s = String(v).trim();
  if (s.includes(':')) {
    const [hhRaw, mmRaw] = s.split(':');
    const hh = parseInt(hhRaw.replace(/\D/g, ''), 10) || 0;
    const mm = parseInt((mmRaw || '').replace(/\D/g, ''), 10) || 0;
    return hh * 100 + mm;
  }

  const digits = s.replace(/\D/g, '');
  if (digits.length === 0) return null;
  const n = parseInt(digits, 10) || 0;
  // If digits length <=3, could be minutes -> convert
  if (n >= 0 && n < 24 * 60) {
    const hh = Math.floor(n / 60);
    const mm = n % 60;
    return hh * 100 + mm;
  }
  return n;
}

/**
 * Helper: sanitize HTML (basic strip tags)
 */
function sanitizeHtml(text, allowMarkdown = false) {
  if (!text) return '';
  let result = String(text);
  result = result.replace(/<[^>]*>/g, '');
  if (!allowMarkdown) result = result.replace(/[_*]/g, '');
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
  timeToMinutes,
  sanitizeHtml,
  formatSubject,
};
