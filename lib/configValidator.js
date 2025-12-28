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
    legacyNames: ['fetchIntervalMs'],
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
        legacyNames: ['mergeGapMinutes', 'mergeGap'],
      },
      hideBreaks: {
        type: 'boolean',
        description: 'Hide break lessons in grid view',
      },
      maxLessons: {
        type: 'number',
        description: 'Maximum lessons to display in grid',
        legacyNames: ['maxGridLessons', 'maxLessons'],
      },
      showNowLine: {
        type: 'boolean',
        description: 'Show current time line in grid',
        legacyNames: ['showNowLine'],
      },
    },
  },

  lessons: {
    type: 'object',
    description: 'Lessons widget options',
    properties: {
      showStartTime: {
        type: 'boolean',
        legacyNames: ['showStartTime'],
      },
      showRegular: {
        type: 'boolean',
        legacyNames: ['showRegularLessons', 'showRegular'],
      },
      useShortSubject: {
        type: 'boolean',
        legacyNames: ['useShortSubject'],
      },
      showTeacherMode: {
        type: 'boolean',
        legacyNames: ['showTeacherMode'],
      },
      showSubstitution: {
        type: 'boolean',
        legacyNames: ['showSubstitutionText', 'showSubstitution'],
      },
      dateFormat: {
        type: 'string',
        description: 'Date format for lessons display',
        legacyNames: [],
      },
    },
  },

  exams: {
    type: 'object',
    description: 'Exams widget options',
    properties: {
      daysAhead: {
        type: 'number',
        legacyNames: ['examsDaysAhead', 'daysAhead'],
      },
      showSubject: {
        type: 'boolean',
        legacyNames: ['showExamSubject', 'showSubject'],
      },
      showTeacher: {
        type: 'boolean',
        legacyNames: ['showExamTeacher', 'showTeacher'],
      },
      dateFormat: {
        type: 'string',
        description: 'Date format for exams display',
        legacyNames: [],
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
        legacyNames: ['homeworkDateFormat'],
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
        legacyNames: ['absencesPastDays', 'pastDays'],
      },
      futureDays: {
        type: 'number',
        description: 'Show absences for future N days',
        legacyNames: ['absencesFutureDays', 'futureDays'],
      },
      dateFormat: {
        type: 'string',
        description: 'Date format for absences display',
        legacyNames: [],
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
        legacyNames: [],
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

  // Top-level legacy date format keys
  dateFormats: {
    type: 'object',
    deprecated: true,
    description: 'DEPRECATED: Use widget-specific dateFormat instead',
    legacyNames: ['dateFormats'],
    properties: {
      lessons: { type: 'string' },
      grid: { type: 'string' },
      exams: { type: 'string' },
      homework: { type: 'string' },
      absences: { type: 'string' },
      default: { type: 'string' },
    },
  },

  fetchIntervalMs: {
    type: 'number',
    deprecated: true,
    description: 'DEPRECATED: Use updateInterval instead',
    legacyNames: ['fetchIntervalMs'],
  },

  dateFormat: {
    type: 'string',
    deprecated: true,
    description: 'DEPRECATED: Use widget-specific dateFormat instead',
    legacyNames: ['dateFormat'],
  },

  examDateFormat: {
    type: 'string',
    deprecated: true,
    description: 'DEPRECATED: Use exams.dateFormat instead',
    legacyNames: ['examDateFormat'],
  },

  homeworkDateFormat: {
    type: 'string',
    deprecated: true,
    description: 'DEPRECATED: Use homework.dateFormat instead',
    legacyNames: ['homeworkDateFormat'],
  },
};

/**
 * Apply legacy config mappings based on CONFIG_SCHEMA
 * Transforms old keys into new structure defined by legacyNames
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

  // Build reverse mapping: legacyName -> { targetPath, fieldDef }
  const legacyMap = {};

  // Scan widget properties
  const widgetNames = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
  widgetNames.forEach((widgetName) => {
    const widgetDef = CONFIG_SCHEMA[widgetName];
    if (widgetDef && widgetDef.properties) {
      Object.entries(widgetDef.properties).forEach(([propName, propDef]) => {
        if (propDef.legacyNames && Array.isArray(propDef.legacyNames)) {
          propDef.legacyNames.forEach((legacyName) => {
            legacyMap[legacyName] = {
              targetPath: `${widgetName}.${propName}`,
              widgetName,
              propName,
            };
          });
        }
      });
    }
  });

  // Handle special cases: dateFormats, dateFormat, etc.
  // dateFormats.* and dateFormat (global) -> distribute to widgets
  const handleDateFormats = () => {
    const df = out.dateFormats || {};
    const globalDateFormat = out.dateFormat;

    const dateFormatWidgetProps = {
      lessons: 'dateFormat',
      grid: 'dateFormat',
      exams: 'dateFormat',
      homework: 'dateFormat',
      absences: 'dateFormat',
      messagesofday: 'dateFormat',
    };

    // Apply dateFormats.* -> widget.dateFormat
    Object.entries(dateFormatWidgetProps).forEach(([widget, prop]) => {
      if (df[widget] && !out[widget][prop]) {
        out[widget][prop] = df[widget];
        if (!legacyUsed.includes('dateFormats')) legacyUsed.push('dateFormats');
      }
    });

    // Apply dateFormats.default -> all widgets
    if (df.default) {
      Object.entries(dateFormatWidgetProps).forEach(([widget, prop]) => {
        if (!out[widget][prop]) {
          out[widget][prop] = df.default;
        }
      });
      if (!legacyUsed.includes('dateFormats')) legacyUsed.push('dateFormats');
    }

    // Apply global dateFormat to all widgets if not already set
    if (globalDateFormat) {
      Object.entries(dateFormatWidgetProps).forEach(([widget, prop]) => {
        if (!out[widget][prop]) {
          out[widget][prop] = globalDateFormat;
        }
      });
      if (!legacyUsed.includes('dateFormat')) legacyUsed.push('dateFormat');
    }

    // examDateFormat -> exams.dateFormat
    if (out.examDateFormat && !out.exams.dateFormat) {
      out.exams.dateFormat = out.examDateFormat;
      if (!legacyUsed.includes('examDateFormat')) legacyUsed.push('examDateFormat');
    }

    // homeworkDateFormat -> homework.dateFormat (covered by legacyNames, but explicit here)
    if (out.homeworkDateFormat && !out.homework.dateFormat) {
      out.homework.dateFormat = out.homeworkDateFormat;
      if (!legacyUsed.includes('homeworkDateFormat')) legacyUsed.push('homeworkDateFormat');
    }
  };

  handleDateFormats();

  // Apply schema-based legacy mappings
  Object.entries(legacyMap).forEach(([legacyName, mapping]) => {
    if (out[legacyName] !== undefined && out[mapping.widgetName][mapping.propName] === undefined) {
      out[mapping.widgetName][mapping.propName] = out[legacyName];
      if (!legacyUsed.includes(legacyName)) legacyUsed.push(legacyName);
    }
  });

  // Note any other known legacy top-level keys
  const otherLegacyKeys = [
    'fetchInterval',
    'days',
    'examsDays',
    'mergeGapMin',
    'debug',
    'enableDebug',
    'displaymode',
    'showAbsences',
    'showHomework',
    'showExams',
  ];
  otherLegacyKeys.forEach((k) => {
    if (out[k] !== undefined && out[k] !== null && out[k] !== '') {
      if (!legacyUsed.includes(k)) legacyUsed.push(k);
    }
  });

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

  // Check for deprecated fields
  for (const field of Object.keys(config)) {
    const def = CONFIG_SCHEMA[field];
    if (def && def.deprecated) {
      warnings.push(`Field "${field}" is deprecated. ${def.description}`);
    }
  }

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

module.exports = {
  validateConfig,
  validateStudent,
  getSchemaDocumentation,
  CONFIG_SCHEMA,
  applyLegacyMappings,
};
