/**
 * Configuration Validator
 * Validates MMM-Webuntis config against schema with helpful error messages
 *
 * NOTE: The `default` values in CONFIG_SCHEMA below are for **documentation only**.
 * The actual defaults that are applied when config values are missing come from
 * the `defaults` object in MMM-Webuntis.js. This schema is used for:
 * - Validation logic (checking types, required fields, etc.)
 * - Documentation (getSchemaDocumentation() for CLI help)
 * - Legacy mapping (legacyNames array for backward compatibility)
 *
 * For the source of truth on defaults, see:
 * - MMM-Webuntis.js: defaults object
 * - node_helper.js: _normalizeLegacyConfig()
 * - cli/node_helper_wrapper.js: loadModuleDefaults()
 */

const REQUIRED_FIELDS = ['students'];

/**
 * Central mapping of all legacy configuration keys to their new equivalents
 * Each entry defines: oldKey, newKey, transform function, and context
 * This is the SINGLE SOURCE OF TRUTH for all legacy key mappings.
 */
const LEGACY_MAPPINGS = [
  // Top-level config mappings
  { old: 'fetchInterval', new: 'updateInterval', transform: (v) => Number(v), context: 'config' },
  { old: 'fetchIntervalMs', new: 'updateInterval', transform: (v) => Number(v), context: 'config' },
  { old: 'days', new: 'nextDays', transform: (v) => Number(v), context: 'config' },

  // displaymode -> displayMode (lowercase conversion)
  { old: 'displaymode', new: 'displayMode', transform: (v) => String(v).toLowerCase(), context: 'config' },

  // debug/enableDebug -> logLevel (global setting)
  { old: 'debug', new: 'logLevel', transform: (v) => (v ? 'debug' : 'none'), context: 'config', special: 'debug' },
  { old: 'enableDebug', new: 'logLevel', transform: (v) => (v ? 'debug' : 'none'), context: 'config', special: 'debug' },

  // Global legacy keys that apply to all widgets
  {
    old: 'daysToShow',
    new: 'nextDays',
    transform: (v) => Number(v),
    context: 'widget',
    widgets: ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'],
  },
  { old: 'pastDaysToShow', new: 'pastDays', transform: (v) => Number(v), context: 'widget', widgets: ['lessons', 'grid', 'absences'] },

  // Widget-specific legacy keys - Grid
  { old: 'mergeGapMin', new: 'mergeGap', transform: (v) => Number(v), context: 'widgetProp', widget: 'grid' },
  { old: 'mergeGapMinutes', new: 'mergeGap', transform: (v) => Number(v), context: 'widgetProp', widget: 'grid' },
  { old: 'maxGridLessons', new: 'maxLessons', transform: (v) => Number(v), context: 'widgetProp', widget: 'grid' },

  // Widget-specific legacy keys - Lessons
  { old: 'showRegularLessons', new: 'showRegular', context: 'widgetProp', widget: 'lessons' },
  { old: 'showSubstitutionText', new: 'showSubstitution', context: 'widgetProp', widget: 'lessons' },

  // Widget-specific legacy keys - Exams
  { old: 'examsDays', new: 'nextDays', context: 'widgetProp', widget: 'exams' },
  { old: 'examsDaysAhead', new: 'nextDays', context: 'widgetProp', widget: 'exams' },
  { old: 'daysAhead', new: 'nextDays', context: 'widgetProp', widget: 'exams' },
  { old: 'showExamSubject', new: 'showSubject', context: 'widgetProp', widget: 'exams' },
  { old: 'showExamTeacher', new: 'showTeacher', context: 'widgetProp', widget: 'exams' },
  { old: 'examDateFormat', new: 'dateFormat', context: 'widgetProp', widget: 'exams' },
  { old: 'examsDaysBehind', new: 'pastDays', context: 'widgetProp', widget: 'exams' },

  // Widget-specific legacy keys - Homework
  { old: 'homeworkDateFormat', new: 'dateFormat', context: 'widgetProp', widget: 'homework' },

  // Widget-specific legacy keys - Absences
  { old: 'absencesPastDays', new: 'pastDays', context: 'widgetProp', widget: 'absences' },
  { old: 'absencesFutureDays', new: 'futureDays', context: 'widgetProp', widget: 'absences' },

  // Global dateFormat -> widget-specific dateFormat (special handling in applyLegacyMappings)
  { old: 'dateFormat', new: 'dateFormat', context: 'dateFormat', special: 'dateFormat' },

  // Deprecated keys that should be tracked but not mapped (warnings only)
  { old: 'showAbsences', context: 'deprecated' },
  { old: 'showHomework', context: 'deprecated' },
  { old: 'showExams', context: 'deprecated' },
  { old: 'fetchHomeworks', context: 'deprecated' },
  { old: 'fetchAbsences', context: 'deprecated' },
];

const CONFIG_SCHEMA = {
  students: {
    type: 'array',
    required: true,
    description: 'Array of student objects to track',
    items: {
      type: 'object',
      required: true,
      properties: {
        title: { type: 'string', required: true, description: 'Student display title' },
        school: { type: 'string', required: false, description: 'School identifier (server) — required unless qrcode is provided' },
        username: { type: 'string', required: false, description: 'WebUntis username — required unless qrcode is provided' },
        password: { type: 'string', required: false, description: 'WebUntis password — required unless qrcode is provided' },
        qrcode: { type: 'string', required: false, description: 'QRCode URL for WebUntis (alternative to username/password/school)' },
        studentId: {
          type: 'number',
          description: 'Student ID (optional, will be looked up if not provided)',
        },
      },
    },
  },

  updateInterval: {
    type: 'number',
    description: 'Milliseconds between data refreshes',
  },

  debugDate: {
    type: 'string',
    description: 'Fixed date for testing (YYYY-MM-DD format, null = disabled)',
  },

  daysToShow: {
    type: 'number',
    description: 'Number of future days to display',
  },

  pastDaysToShow: {
    type: 'number',
    description: 'Number of past days to display',
  },

  maxItems: {
    type: 'number',
    description: 'Maximum number of items to display per student',
  },

  widgets: {
    type: 'array',
    description: 'Array of widget names to enable',
    items: {
      type: 'string',
      enum: ['grid', 'lessons', 'exams', 'homework', 'absences', 'messagesofday'],
    },
  },

  grid: {
    type: 'object',
    description: 'Grid widget options',
    properties: {
      mergeGap: {
        type: 'number',
        description: 'Merge lessons with gap <= N minutes',
      },
      hideBreaks: {
        type: 'boolean',
        description: 'Hide break lessons in grid view',
      },
      maxLessons: {
        type: 'number',
        description: 'Maximum lessons to display in grid',
      },
      showNowLine: {
        type: 'boolean',
        description: 'Show current time line in grid',
      },
    },
  },

  lessons: {
    type: 'object',
    description: 'Lessons widget options',
    properties: {
      showStartTime: {
        type: 'boolean',
      },
      showRegular: {
        type: 'boolean',
      },
      useShortSubject: {
        type: 'boolean',
      },
      showTeacherMode: {
        type: 'boolean',
      },
      showSubstitution: {
        type: 'boolean',
      },
      dateFormat: {
        type: 'string',
        description: 'Date format for lessons display',
      },
    },
  },

  exams: {
    type: 'object',
    description: 'Exams widget options',
    properties: {
      nextDays: {
        type: 'number',
        description: 'Number of future days to fetch exams for',
      },
      pastDays: {
        type: 'number',
        description: 'Number of past days to fetch exams for',
      },
      showSubject: {
        type: 'boolean',
      },
      showTeacher: {
        type: 'boolean',
      },
      dateFormat: {
        type: 'string',
        description: 'Date format for exams display',
      },
    },
  },

  homework: {
    type: 'object',
    description: 'Homework widget options',
    properties: {
      dateFormat: {
        type: 'string',
        description: 'Date format for homework display',
      },
    },
  },

  absences: {
    type: 'object',
    description: 'Absences widget options',
    properties: {
      pastDays: {
        type: 'number',
        description: 'Show absences from past N days',
      },
      futureDays: {
        type: 'number',
        description: 'Show absences for future N days',
      },
      dateFormat: {
        type: 'string',
        description: 'Date format for absences display',
      },
    },
  },

  messagesofday: {
    type: 'object',
    description: 'Messages of the day widget options',
    properties: {
      dateFormat: {
        type: 'string',
        description: 'Date format for messages display',
      },
    },
  },

  dumpBackendPayloads: {
    type: 'boolean',
    description: 'Write raw API responses to debug_dumps/ (debug only)',
  },

  debugLogging: {
    type: 'boolean',
    description: 'Enable verbose console logging',
  },

  fetchIntervalMs: {
    type: 'number',
    deprecated: true,
    description: 'Use updateInterval instead',
  },

  dateFormat: {
    type: 'string',
    deprecated: true,
    description: 'Use widget-specific dateFormat instead',
  },

  examDateFormat: {
    type: 'string',
    deprecated: true,
    description: 'Use exams.dateFormat instead',
  },

  homeworkDateFormat: {
    type: 'string',
    deprecated: true,
    description: 'Use homework.dateFormat instead',
  },
};

/**
 * Apply legacy config mappings using centralized LEGACY_MAPPINGS array
 * Transforms old keys into new structure for backward compatibility
 * @param {Object} config - Raw config object (may contain legacy keys)
 * @returns {Object} { normalizedConfig, legacyUsed }
 */
function applyLegacyMappings(config) {
  if (!config || typeof config !== 'object') return { normalizedConfig: config, legacyUsed: [] };

  const out = { ...config };
  const legacyUsed = [];

  // Initialize widget namespaces
  ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'].forEach((w) => {
    if (!out[w]) out[w] = {};
  });

  // Process mappings in two passes:
  // 1. First pass: widget-specific mappings (higher priority, should override global mappings)
  // 2. Second pass: all other mappings (global, config-level)
  const widgetPropMappings = LEGACY_MAPPINGS.filter((m) => m.context === 'widgetProp');
  const otherMappings = LEGACY_MAPPINGS.filter((m) => m.context !== 'widgetProp');

  // Apply widget-specific mappings first (higher priority)
  widgetPropMappings.concat(otherMappings).forEach((mapping) => {
    const hasLegacy = out[mapping.old] !== undefined && out[mapping.old] !== null && out[mapping.old] !== '';
    if (!hasLegacy) return;

    // Special handling for debug/enableDebug (they map to the same target)
    if (mapping.special === 'debug') {
      const dbg = out.debug ?? out.enableDebug;
      if (typeof dbg === 'boolean' && !out.logLevel) {
        out.logLevel = mapping.transform(dbg);
        const usedKey = out.debug !== undefined ? 'debug' : 'enableDebug';
        if (!legacyUsed.includes(usedKey)) legacyUsed.push(usedKey);
      }
      return;
    }

    // Top-level config mappings
    if (mapping.context === 'config') {
      if (out[mapping.old] !== undefined) {
        // Always track legacy usage
        if (!legacyUsed.includes(mapping.old)) legacyUsed.push(mapping.old);

        // Only map if target doesn't already have a value
        if (out[mapping.new] === undefined) {
          const transformed = mapping.transform ? mapping.transform(out[mapping.old]) : out[mapping.old];
          out[mapping.new] = transformed;
        }
      }
    }

    // Widget-specific mappings (global keys that apply to multiple widgets)
    if (mapping.context === 'widget' && mapping.widgets) {
      if (out[mapping.old] !== undefined) {
        // Always track legacy usage
        if (!legacyUsed.includes(mapping.old)) legacyUsed.push(mapping.old);

        // Map to each widget if widget doesn't already have the value
        mapping.widgets.forEach((widget) => {
          if (out[widget][mapping.new] === undefined) {
            const transformed = mapping.transform ? mapping.transform(out[mapping.old]) : out[mapping.old];
            out[widget][mapping.new] = transformed;
          }
        });
      }
    }

    // Widget property mappings (widget.oldKey -> widget.newKey)
    if (mapping.context === 'widgetProp' && mapping.widget) {
      const widget = mapping.widget;
      if (out[mapping.old] !== undefined) {
        // Always track legacy usage, even if we don't map it (because target already has a value)
        if (!legacyUsed.includes(mapping.old)) legacyUsed.push(mapping.old);

        // Only map if target doesn't already have a value
        if (out[widget][mapping.new] === undefined) {
          const transformed = mapping.transform ? mapping.transform(out[mapping.old]) : out[mapping.old];
          out[widget][mapping.new] = transformed;
        }
      }
    }

    // Special handling for global dateFormat (applies to all widgets)
    if (mapping.context === 'dateFormat' && out.dateFormat) {
      const widgetNames = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
      widgetNames.forEach((widget) => {
        if (!out[widget].dateFormat) {
          out[widget].dateFormat = out.dateFormat;
        }
      });
      if (!legacyUsed.includes('dateFormat')) legacyUsed.push('dateFormat');
    }

    // Deprecated keys (warnings only, no mapping)
    if (mapping.context === 'deprecated') {
      if (out[mapping.old] !== undefined && out[mapping.old] !== null && out[mapping.old] !== '') {
        if (!legacyUsed.includes(mapping.old)) legacyUsed.push(mapping.old);
      }
    }
  });

  // Do not emit generic warnings here - detailed warnings are generated separately
  // by generateDeprecationWarnings() which provides migration instructions

  out.__legacyUsed = Array.from(new Set(legacyUsed));
  return { normalizedConfig: out, legacyUsed: out.__legacyUsed };
}

/**
 * Validate a complete config object
 * @param {Object} config - Config to validate
 * @param {Object} logger - Logger object with log/warn methods
 * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
 */
function validateConfig(config, logger = {}) {
  const errors = [];
  const warnings = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in config)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate students array
  if (config.students) {
    if (!Array.isArray(config.students)) {
      errors.push('Field "students" must be an array');
    } else if (config.students.length === 0) {
      errors.push('Field "students" must contain at least one student');
    } else {
      config.students.forEach((student, idx) => {
        const studentErrors = validateStudent(student, idx);
        errors.push(...studentErrors);
      });
    }
  }

  // Validate numeric fields
  const numericFields = ['updateInterval', 'daysToShow', 'pastDaysToShow', 'maxItems'];
  for (const field of numericFields) {
    if (field in config && typeof config[field] !== 'number') {
      errors.push(`Field "${field}" must be a number, got ${typeof config[field]}`);
    }
  }

  // Validate grid.mergeGap
  if (config.grid && typeof config.grid.mergeGap !== 'undefined') {
    if (typeof config.grid.mergeGap !== 'number') {
      errors.push(`Field "grid.mergeGap" must be a number, got ${typeof config.grid.mergeGap}`);
    }
  }

  // Validate absences options
  if (config.absences) {
    if (typeof config.absences.pastDays !== 'undefined' && typeof config.absences.pastDays !== 'number') {
      errors.push(`Field "absences.pastDays" must be a number`);
    }
    if (typeof config.absences.futureDays !== 'undefined' && typeof config.absences.futureDays !== 'number') {
      errors.push(`Field "absences.futureDays" must be a number`);
    }
  }

  // Validate widgets array
  if (config.widgets) {
    if (!Array.isArray(config.widgets)) {
      errors.push('Field "widgets" must be an array');
    } else {
      const validWidgets = ['grid', 'lessons', 'exams', 'homework', 'absences', 'messagesofday'];
      config.widgets.forEach((widget, idx) => {
        if (!validWidgets.includes(widget)) {
          errors.push(`Invalid widget "${widget}" at widgets[${idx}]`);
        }
      });
    }
  }

  // Note: Deprecated field warnings are now handled exclusively by generateDeprecationWarnings()
  // which is called separately and provides more detailed migration instructions

  // Log results if logger provided
  if (logger.log) {
    if (errors.length === 0 && warnings.length === 0) {
      logger.log('info', 'Config validation passed');
    } else {
      if (errors.length > 0) logger.log('error', `Config validation failed: ${errors.join('; ')}`);
      if (warnings.length > 0) logger.log('warn', `Config warnings: ${warnings.join('; ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a single student object
 * @returns {string[]} Array of error messages
 */
function validateStudent(student, index) {
  const errors = [];

  // title is always required
  if (!('title' in student)) {
    errors.push(`students[${index}]: Missing required field "title"`);
  } else if (typeof student.title !== 'string') {
    errors.push(`students[${index}]: Field "title" must be a string`);
  }

  // If qrcode is provided, treat it as an alternative to username/password/school
  const hasQrcode = 'qrcode' in student && student.qrcode !== undefined && student.qrcode !== null;
  if (hasQrcode) {
    if (typeof student.qrcode !== 'string') {
      errors.push(`students[${index}]: Field "qrcode" must be a string`);
    }
  } else {
    // qrcode not present => require username, password and school
    const credFields = ['school', 'username', 'password'];
    for (const field of credFields) {
      if (!(field in student)) {
        errors.push(`students[${index}]: Missing required field "${field}"`);
      } else if (typeof student[field] !== 'string') {
        errors.push(`students[${index}]: Field "${field}" must be a string`);
      }
    }
  }

  if ('studentId' in student && typeof student.studentId !== 'number') {
    errors.push(`students[${index}]: Field "studentId" must be a number or undefined`);
  }

  return errors;
}

/**
 * Get schema documentation as a string for display
 */
function getSchemaDocumentation() {
  let doc = 'MMM-Webuntis Configuration Schema\n';
  doc += '====================================\n\n';

  for (const [field, def] of Object.entries(CONFIG_SCHEMA)) {
    const req = def.required ? ' [REQUIRED]' : '';
    const defaultVal = 'default' in def ? ` (default: ${JSON.stringify(def.default)})` : '';
    const deprecated = def.deprecated ? ' [DEPRECATED]' : '';
    doc += `${field}${req}${deprecated}\n`;
    doc += `  Type: ${def.type}\n`;
    doc += `  ${def.description}${defaultVal}\n`;
    if (def.mappedTo) {
      doc += `  → Maps to: ${def.mappedTo}\n`;
    }
    doc += '\n';
  }

  return doc;
}

/**
 * Generate detailed deprecation warnings for legacy config keys
 * Returns user-friendly messages explaining the migration path
 *
 * @param {string[]} legacyKeys - Array of legacy key names that were detected
 * @returns {string[]} Array of warning messages with migration instructions
 */
function generateDeprecationWarnings(legacyKeys) {
  const warnings = [];

  // Map of legacy keys to migration targets (new key names)
  const deprecationInfo = {
    // Top-level legacy keys
    days: 'grid.nextDays / lessons.nextDays',
    daysToShow: 'grid.nextDays / lessons.nextDays',
    pastDays: 'grid.pastDays / homework.pastDays / absences.pastDays',
    examsDays: 'exams.nextDays',
    examsDaysAhead: 'exams.nextDays',
    mergeGapMin: 'grid.mergeGap',
    mergeGapMinutes: 'grid.mergeGap',
    displaymode: 'displayMode',
    debug: 'logLevel',
    enableDebug: 'logLevel',
    fetchInterval: 'updateInterval',
    fetchIntervalMs: 'updateInterval',
    showAbsences: 'displayMode',
    showHomework: 'displayMode',
    showExams: 'displayMode',
    fetchHomeworks: 'displayMode (include "homework")',
    fetchAbsences: 'displayMode (include "absences")',
    // Widget-specific deprecated keys
    daysAhead: 'exams.nextDays',
    examsDaysBehind: 'exams.pastDays',
    showExamSubject: 'exams.showSubject',
    showExamTeacher: 'exams.showTeacher',
    examDateFormat: 'exams.dateFormat',
    homeworkDateFormat: 'homework.dateFormat',
    showRegularLessons: 'lessons.showRegular',
    showSubstitutionText: 'lessons.showSubstitution',
    maxGridLessons: 'grid.maxLessons',
    absencesPastDays: 'absences.pastDays',
    absencesFutureDays: 'absences.futureDays',
    pastDaysToShow: 'pastDays (widget-specific)',
  };

  for (const key of legacyKeys) {
    const newKey = deprecationInfo[key];
    if (newKey) {
      warnings.push(`DEPRECATED: "${key}" → Use "${newKey}" instead`);
    } else {
      // Generic fallback for unmapped legacy keys
      const mapping = LEGACY_MAPPINGS.find((m) => m.old === key);
      if (mapping && mapping.new) {
        const target = mapping.widget ? `${mapping.widget}.${mapping.new}` : mapping.new;
        warnings.push(`DEPRECATED: "${key}" → Use "${target}" instead`);
      } else {
        warnings.push(`DEPRECATED: "${key}" is no longer supported`);
      }
    }
  }

  return warnings;
}

module.exports = {
  validateConfig,
  validateStudent,
  getSchemaDocumentation,
  generateDeprecationWarnings,
  CONFIG_SCHEMA,
  LEGACY_MAPPINGS,
  applyLegacyMappings,
};
