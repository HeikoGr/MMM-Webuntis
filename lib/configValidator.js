/**
 * Configuration Validator
 * Validates MMM-Webuntis config with helpful error messages
 *
 * NOTE: The actual defaults that are applied when config values are missing come from
 * the `defaults` object in MMM-Webuntis.js. This module is used for:
 * - Validation logic (checking types, required fields, etc.)
 * - Legacy mapping (centralized in LEGACY_MAPPINGS array for backward compatibility)
 *
 * For the source of truth on defaults, see:
 * - MMM-Webuntis.js: defaults object
 * - node_helper.js: _normalizeLegacyConfig()
 * - cli/node_helper_wrapper.js: loadModuleDefaults()
 */

// Note: 'students' is NOT in REQUIRED_FIELDS because auto-discovery is supported
// when parent credentials (username, password, school) are provided
const REQUIRED_FIELDS = [];

/**
 * Central mapping of all legacy configuration keys to their new equivalents
 * Each entry defines: oldKey, newKey, transform function, and context
 * This is the SINGLE SOURCE OF TRUTH for all legacy key mappings.
 */
const LEGACY_MAPPINGS = [
  // Top-level config mappings
  { old: 'fetchInterval', new: 'updateInterval', transform: (v) => Number(v), context: 'config' },
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
  { old: 'absencesFutureDays', new: 'nextDays', context: 'widgetProp', widget: 'absences' },

  // Global dateFormat -> widget-specific dateFormat (special handling in applyLegacyMappings)
  { old: 'dateFormat', new: 'dateFormat', context: 'dateFormat', special: 'dateFormat' },

  // Deprecated keys that should be tracked but not mapped (warnings only)
  { old: 'showAbsences', context: 'deprecated' },
  { old: 'showHomework', context: 'deprecated' },
  { old: 'showExams', context: 'deprecated' },
  { old: 'fetchHomeworks', context: 'deprecated' },
  { old: 'fetchAbsences', context: 'deprecated' },
];

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
  // Note: Empty students[] is allowed for auto-discovery when parent credentials are provided
  const hasParentCreds = (config.username && config.password && config.school) || config.qrcode;

  if (config.students) {
    if (!Array.isArray(config.students)) {
      errors.push('Field "students" must be an array');
    } else if (config.students.length === 0) {
      // Empty array is valid IF parent credentials are provided (triggers auto-discovery)
      if (!hasParentCreds) {
        errors.push(
          'Field "students" is empty and no parent credentials (username, password, school) provided. Either configure students[] or provide parent credentials for auto-discovery.'
        );
      } else {
        // Empty students with parent creds = auto-discovery mode (valid)
        logger.log('debug', 'Empty students[] with parent credentials: auto-discovery will be attempted');
      }
    } else {
      config.students.forEach((student, idx) => {
        const studentErrors = validateStudent(student, idx, config);
        errors.push(...studentErrors);
      });
    }
  } else if (!hasParentCreds) {
    // No students array AND no parent creds = error
    errors.push(
      'Missing "students" array and no parent credentials for auto-discovery. Either configure students[] or provide username, password, and school for auto-discovery.'
    );
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
    if (typeof config.absences.nextDays !== 'undefined' && typeof config.absences.nextDays !== 'number') {
      errors.push(`Field "absences.nextDays" must be a number`);
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
      logger.log('debug', 'Config validation passed');
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
 * @param {Object} student - Student config to validate
 * @param {number} index - Student array index (for error messages)
 * @param {Object} parentConfig - Parent config object (for credential inheritance)
 * @returns {string[]} Array of error messages
 */
function validateStudent(student, index, parentConfig = {}) {
  const errors = [];

  // title is always required
  if (!('title' in student)) {
    errors.push(`students[${index}]: Missing required field "title"`);
  } else if (typeof student.title !== 'string') {
    errors.push(`students[${index}]: Field "title" must be a string`);
  }

  // If qrcode is provided, treat it as an alternative to username/password/school
  const hasQrcode = 'qrcode' in student && student.qrcode !== undefined && student.qrcode !== null;
  // Check if parent has QR code (for LEGAL_GUARDIAN accounts)
  const hasParentQrcode = 'qrcode' in parentConfig && parentConfig.qrcode !== undefined && parentConfig.qrcode !== null;

  if (hasQrcode) {
    if (typeof student.qrcode !== 'string') {
      errors.push(`students[${index}]: Field "qrcode" must be a string`);
    }
  } else if (!hasParentQrcode) {
    // No qrcode in student or parent => check if credentials are provided (either in student or inherited from parent)
    const credFields = ['school', 'username', 'password'];
    for (const field of credFields) {
      // Check student object first, then fall back to parent config
      const hasInStudent = field in student && typeof student[field] === 'string';
      const hasInParent = field in parentConfig && typeof parentConfig[field] === 'string';

      if (!hasInStudent && !hasInParent) {
        errors.push(`students[${index}]: Missing required field "${field}" (not found in student or parent config)`);
      } else if (hasInStudent && typeof student[field] !== 'string') {
        errors.push(`students[${index}]: Field "${field}" must be a string`);
      }
    }
  }
  // If parent has QR code, student credentials are optional (auto-discovery will handle it)

  if ('studentId' in student && typeof student.studentId !== 'number') {
    errors.push(`students[${index}]: Field "studentId" must be a number or undefined`);
  }

  return errors;
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
    absencesFutureDays: 'absences.nextDays',
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
  generateDeprecationWarnings,
  applyLegacyMappings,
};
