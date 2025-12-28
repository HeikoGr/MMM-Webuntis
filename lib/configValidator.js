/**
 * Configuration Validator
 * Validates MMM-Webuntis config against schema with helpful error messages
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
    default: 5 * 60 * 1000,
    description: 'Milliseconds between data refreshes (default: 5 minutes)',
  },

  daysToShow: {
    type: 'number',
    default: 14,
    description: 'Number of future days to display (default: 14)',
  },

  pastDaysToShow: {
    type: 'number',
    default: 0,
    description: 'Number of past days to display (default: 0)',
  },

  maxItems: {
    type: 'number',
    default: null,
    description: 'Maximum number of items to display per student (default: no limit)',
  },

  widgets: {
    type: 'array',
    description: 'Array of widget names to enable',
    items: {
      type: 'string',
      enum: ['grid', 'lessons', 'exams', 'homework', 'absences', 'messagesofday'],
    },
    default: ['grid', 'lessons', 'exams', 'homework', 'absences'],
  },

  grid: {
    type: 'object',
    description: 'Grid widget options',
    properties: {
      mergeGap: {
        type: 'number',
        default: 15,
        description: 'Merge lessons with gap <= N minutes (renamed from mergeGapMinutes)',
      },
      hideBreaks: {
        type: 'boolean',
        default: false,
        description: 'Hide break lessons in grid view',
      },
    },
  },

  absences: {
    type: 'object',
    description: 'Absences widget options',
    properties: {
      pastDays: {
        type: 'number',
        default: 7,
        description: 'Show absences from past N days',
      },
      futureDays: {
        type: 'number',
        default: 7,
        description: 'Show absences for future N days',
      },
    },
  },

  dumpBackendPayloads: {
    type: 'boolean',
    default: false,
    description: 'Write raw API responses to debug_dumps/ (debug only)',
  },

  debugLogging: {
    type: 'boolean',
    default: false,
    description: 'Enable verbose console logging',
  },

  // Legacy fields (deprecated but still supported via legacy-config-mapper)
  mergeGapMinutes: {
    type: 'number',
    deprecated: true,
    mappedTo: 'grid.mergeGap',
    description: 'DEPRECATED: Use grid.mergeGap instead',
  },

  showAbsences: {
    type: 'boolean',
    deprecated: true,
    mappedTo: 'widgets',
    description: 'DEPRECATED: Use widgets array instead',
  },

  showHomework: {
    type: 'boolean',
    deprecated: true,
    mappedTo: 'widgets',
    description: 'DEPRECATED: Use widgets array instead',
  },

  showExams: {
    type: 'boolean',
    deprecated: true,
    mappedTo: 'widgets',
    description: 'DEPRECATED: Use widgets array instead',
  },
};

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
      warnings.push(`Field "${field}" is deprecated. Use "${def.mappedTo}" instead (still supported, will be auto-converted)`);
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
};
