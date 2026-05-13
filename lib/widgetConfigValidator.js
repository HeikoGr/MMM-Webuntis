/**
 * Widget Config Validator for MMM-Webuntis
 *
 * Provides validation functions for widget-specific configurations.
 * Each widget (grid, lessons, exams, homework, absences, messagesofday)
 * has its own validation rules and constraints.
 *
 * @module lib/widgetConfigValidator
 */

/**
 * Validate grid widget configuration
 *
 * @param {Object} gridConfig - Grid widget configuration
 * @returns {string[]} Array of warning messages
 *
 * @example
 * validateGridConfig({ nextDays: 5, mergeGap: 15, maxLessons: 10 })
 * // Returns: [] (no warnings)
 *
 * validateGridConfig({ nextDays: -1, mergeGap: -5 })
 * // Returns: ["grid.nextDays cannot be negative. Value: -1", "grid.mergeGap cannot be negative. Value: -5"]
 */
function buildFieldPath(scope, key) {
  return `${scope}.${key}`;
}

function validateNonNegativeField(warnings, scope, config, key, options = {}) {
  const value = config?.[key];
  if (!Number.isFinite(value)) return;

  const path = buildFieldPath(scope, key);
  if (value < 0) {
    warnings.push(`${path} cannot be negative. Value: ${value}`);
    return;
  }

  if (typeof options.upperCondition === 'function' && options.upperCondition(value)) {
    warnings.push(options.upperMessage(value, path));
  }
}

function validateMinimumField(warnings, scope, config, key, minimum, options = {}) {
  const value = config?.[key];
  if (!Number.isFinite(value)) return;

  const path = buildFieldPath(scope, key);
  if (value < minimum) {
    if (typeof options.lowerMessage === 'function') {
      warnings.push(options.lowerMessage(value, path, minimum));
    } else {
      warnings.push(`${path} must be at least ${minimum}. Value: ${value}`);
    }
    return;
  }

  if (typeof options.upperCondition === 'function' && options.upperCondition(value)) {
    warnings.push(options.upperMessage(value, path, minimum));
  }
}

function validatePositiveCoercedField(warnings, scope, config, key, options = {}) {
  const rawValue = config?.[key];
  if (rawValue === undefined || rawValue === null) return;

  const path = buildFieldPath(scope, key);
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    if (typeof options.invalidMessage === 'function') {
      warnings.push(options.invalidMessage(rawValue, path));
    } else {
      warnings.push(`${path} must be a positive number. Value: ${rawValue}`);
    }
    return;
  }

  if (typeof options.lowerCondition === 'function' && options.lowerCondition(value)) {
    warnings.push(options.lowerMessage(value, path));
    return;
  }

  if (typeof options.upperCondition === 'function' && options.upperCondition(value)) {
    warnings.push(options.upperMessage(value, path));
  }
}

function validateGridConfig(gridConfig) {
  const warnings = [];
  const scope = 'grid';

  if (!gridConfig || typeof gridConfig !== 'object') return warnings;

  validateNonNegativeField(warnings, scope, gridConfig, 'nextDays', {
    upperCondition: (value) => value > 30,
    upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing for better performance.`,
  });
  validateNonNegativeField(warnings, scope, gridConfig, 'pastDays', {
    upperCondition: (value) => value > 14,
    upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing.`,
  });
  validateNonNegativeField(warnings, scope, gridConfig, 'mergeGap', {
    upperCondition: (value) => value > 60,
    upperMessage: (value, path) => `${path} is very large (${value} minutes). Typical values: 0-30.`,
  });
  validateNonNegativeField(warnings, scope, gridConfig, 'maxLessons', {
    upperCondition: (value) => value > 20 && value !== 0,
    upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing for readability.`,
  });
  validatePositiveCoercedField(warnings, scope, gridConfig, 'pxPerMinute', {
    invalidMessage: (rawValue, path) => `${path} must be a positive number. Value: ${rawValue}`,
    lowerCondition: (value) => value < 0.2,
    lowerMessage: (value, path) => `${path} is very small (${value}). Grid may be too compact to read.`,
    upperCondition: (value) => value > 5,
    upperMessage: (value, path) => `${path} is very large (${value}). Grid may exceed screen height.`,
  });

  return warnings;
}

/**
 * Validate lessons widget configuration
 *
 * @param {Object} lessonsConfig - Lessons widget configuration
 * @returns {string[]} Array of warning messages
 */
function validateLessonsConfig(lessonsConfig) {
  const warnings = [];
  const scope = 'lessons';

  if (!lessonsConfig || typeof lessonsConfig !== 'object') return warnings;

  validateNonNegativeField(warnings, scope, lessonsConfig, 'nextDays', {
    upperCondition: (value) => value > 14,
    upperMessage: (value, path) => `${path} is very large (${value}). Typical values: 1-7.`,
  });
  validateNonNegativeField(warnings, scope, lessonsConfig, 'pastDays');

  return warnings;
}

/**
 * Validate exams widget configuration
 *
 * @param {Object} examsConfig - Exams widget configuration
 * @returns {string[]} Array of warning messages
 */
function validateExamsConfig(examsConfig) {
  const warnings = [];
  const scope = 'exams';

  if (!examsConfig || typeof examsConfig !== 'object') return warnings;

  validateNonNegativeField(warnings, scope, examsConfig, 'nextDays', {
    upperCondition: (value) => value > 365,
    upperMessage: (value, path) => `${path} is very large (${value}). Maximum recommended: 365.`,
  });
  validateNonNegativeField(warnings, scope, examsConfig, 'pastDays', {
    upperCondition: (value) => value > 90,
    upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing.`,
  });

  return warnings;
}

/**
 * Validate homework widget configuration
 *
 * @param {Object} homeworkConfig - Homework widget configuration
 * @returns {string[]} Array of warning messages
 */
function validateHomeworkConfig(homeworkConfig) {
  const warnings = [];
  const scope = 'homework';

  if (!homeworkConfig || typeof homeworkConfig !== 'object') return warnings;

  validateNonNegativeField(warnings, scope, homeworkConfig, 'nextDays', {
    upperCondition: (value) => value > 90,
    upperMessage: (value, path) => `${path} is very large (${value}). Typical values: 7-30.`,
  });
  validateNonNegativeField(warnings, scope, homeworkConfig, 'pastDays', {
    upperCondition: (value) => value > 30,
    upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing.`,
  });

  return warnings;
}

/**
 * Validate absences widget configuration
 *
 * @param {Object} absencesConfig - Absences widget configuration
 * @returns {string[]} Array of warning messages
 */
function validateAbsencesConfig(absencesConfig) {
  const warnings = [];
  const scope = 'absences';

  if (!absencesConfig || typeof absencesConfig !== 'object') return warnings;

  validateNonNegativeField(warnings, scope, absencesConfig, 'nextDays', {
    upperCondition: (value) => value > 90,
    upperMessage: (value, path) => `${path} is very large (${value}). Typical values: 7-30.`,
  });
  validateNonNegativeField(warnings, scope, absencesConfig, 'pastDays', {
    upperCondition: (value) => value > 90,
    upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing.`,
  });
  validateMinimumField(warnings, scope, absencesConfig, 'maxItems', 1, {
    upperCondition: (value) => value > 100,
    upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing for readability.`,
  });

  return warnings;
}

/**
 * Validate messagesofday widget configuration
 *
 * @param {Object} messagesConfig - Messages widget configuration
 * @returns {string[]} Array of warning messages
 */
function validateMessagesConfig(messagesConfig) {
  const warnings = [];

  if (!messagesConfig || typeof messagesConfig !== 'object') return warnings;

  // Currently no specific validations for messagesofday
  // Future: maxMessages, dateRange, etc.

  return warnings;
}

/**
 * Validate all widget configurations in module config
 *
 * @param {Object} config - Complete module configuration
 * @returns {string[]} Array of all warning messages from all widgets
 *
 * @example
 * validateAllWidgets({
 *   grid: { nextDays: 5, mergeGap: 15 },
 *   exams: { nextDays: 30 },
 *   homework: { nextDays: -5 }
 * })
 * // Returns: ["homework.nextDays cannot be negative. Value: -5"]
 */
function validateAllWidgets(config) {
  if (!config || typeof config !== 'object') return [];

  const warnings = [];

  // Validate each widget if configured
  if (config.grid) {
    warnings.push(...validateGridConfig(config.grid));
  }

  if (config.lessons) {
    warnings.push(...validateLessonsConfig(config.lessons));
  }

  if (config.exams) {
    warnings.push(...validateExamsConfig(config.exams));
  }

  if (config.homework) {
    warnings.push(...validateHomeworkConfig(config.homework));
  }

  if (config.absences) {
    warnings.push(...validateAbsencesConfig(config.absences));
  }

  if (config.messagesofday) {
    warnings.push(...validateMessagesConfig(config.messagesofday));
  }

  return warnings;
}

/**
 * Validate student credentials and basic configuration
 *
 * @param {Object} student - Student configuration
 * @returns {string[]} Array of warning messages
 */
function validateStudentCredentials(student) {
  const warnings = [];

  if (!student || typeof student !== 'object') {
    return ['Invalid student configuration: must be an object'];
  }

  // Check for missing credentials
  const hasQr = Boolean(student.qrcode);
  const hasDirectCreds = Boolean(student.username && student.password && student.school && student.server);
  const hasPartialDirectCreds = Boolean(student.username || student.password || student.school || student.server);
  const hasStudentId = Number.isFinite(Number(student.studentId));

  if (!hasQr && !hasDirectCreds && !hasStudentId) {
    warnings.push(
      `Student "${student.title || 'Unknown'}": No credentials configured. Provide either qrcode OR (username + password + school + server) OR studentId (for parent account).`
    );
  }

  if (!hasQr && hasPartialDirectCreds && !hasDirectCreds) {
    warnings.push(
      `Student "${student.title || 'Unknown'}": Incomplete direct credentials. Need username, password, school, and server together.`
    );
  }

  // Check for invalid QR code format
  if (hasQr && typeof student.qrcode === 'string' && !student.qrcode.startsWith('untis://')) {
    warnings.push(
      `Student "${student.title || 'Unknown'}": QR code malformed. Expected format: untis://setschool?url=...&school=...&user=...&key=...`
    );
  }

  // Check for missing title
  if (!student.title || typeof student.title !== 'string') {
    warnings.push('Student missing required "title" field');
  }

  return warnings;
}

module.exports = {
  validateAllWidgets,
  validateStudentCredentials,
};
