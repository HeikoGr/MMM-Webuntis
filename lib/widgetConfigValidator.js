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
function validateGridConfig(gridConfig) {
  const warnings = [];

  if (!gridConfig || typeof gridConfig !== 'object') return warnings;

  // nextDays validation
  if (Number.isFinite(gridConfig.nextDays)) {
    if (gridConfig.nextDays < 0) {
      warnings.push(`grid.nextDays cannot be negative. Value: ${gridConfig.nextDays}`);
    } else if (gridConfig.nextDays > 30) {
      warnings.push(`grid.nextDays is very large (${gridConfig.nextDays}). Consider reducing for better performance.`);
    }
  }

  // pastDays validation
  if (Number.isFinite(gridConfig.pastDays)) {
    if (gridConfig.pastDays < 0) {
      warnings.push(`grid.pastDays cannot be negative. Value: ${gridConfig.pastDays}`);
    } else if (gridConfig.pastDays > 14) {
      warnings.push(`grid.pastDays is very large (${gridConfig.pastDays}). Consider reducing.`);
    }
  }

  // mergeGap validation
  if (Number.isFinite(gridConfig.mergeGap)) {
    if (gridConfig.mergeGap < 0) {
      warnings.push(`grid.mergeGap cannot be negative. Value: ${gridConfig.mergeGap}`);
    } else if (gridConfig.mergeGap > 60) {
      warnings.push(`grid.mergeGap is very large (${gridConfig.mergeGap} minutes). Typical values: 0-30.`);
    }
  }

  // maxLessons validation (0 means no limit)
  if (Number.isFinite(gridConfig.maxLessons)) {
    if (gridConfig.maxLessons < 0) {
      warnings.push(`grid.maxLessons cannot be negative. Value: ${gridConfig.maxLessons}`);
    } else if (gridConfig.maxLessons > 20 && gridConfig.maxLessons !== 0) {
      warnings.push(`grid.maxLessons is very large (${gridConfig.maxLessons}). Consider reducing for readability.`);
    }
  }

  // pxPerMinute validation
  if (gridConfig.pxPerMinute !== undefined && gridConfig.pxPerMinute !== null) {
    const v = Number(gridConfig.pxPerMinute);
    if (!Number.isFinite(v) || v <= 0) {
      warnings.push(`grid.pxPerMinute must be a positive number. Value: ${gridConfig.pxPerMinute}`);
    } else if (v < 0.2) {
      warnings.push(`grid.pxPerMinute is very small (${v}). Grid may be too compact to read.`);
    } else if (v > 5) {
      warnings.push(`grid.pxPerMinute is very large (${v}). Grid may exceed screen height.`);
    }
  }

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

  if (!lessonsConfig || typeof lessonsConfig !== 'object') return warnings;

  // nextDays validation
  if (Number.isFinite(lessonsConfig.nextDays)) {
    if (lessonsConfig.nextDays < 0) {
      warnings.push(`lessons.nextDays cannot be negative. Value: ${lessonsConfig.nextDays}`);
    } else if (lessonsConfig.nextDays > 14) {
      warnings.push(`lessons.nextDays is very large (${lessonsConfig.nextDays}). Typical values: 1-7.`);
    }
  }

  // pastDays validation
  if (Number.isFinite(lessonsConfig.pastDays)) {
    if (lessonsConfig.pastDays < 0) {
      warnings.push(`lessons.pastDays cannot be negative. Value: ${lessonsConfig.pastDays}`);
    }
  }

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

  if (!examsConfig || typeof examsConfig !== 'object') return warnings;

  // nextDays validation
  if (Number.isFinite(examsConfig.nextDays)) {
    if (examsConfig.nextDays < 0) {
      warnings.push(`exams.nextDays cannot be negative. Value: ${examsConfig.nextDays}`);
    } else if (examsConfig.nextDays > 365) {
      warnings.push(`exams.nextDays is very large (${examsConfig.nextDays}). Maximum recommended: 365.`);
    }
  }

  // pastDays validation
  if (Number.isFinite(examsConfig.pastDays)) {
    if (examsConfig.pastDays < 0) {
      warnings.push(`exams.pastDays cannot be negative. Value: ${examsConfig.pastDays}`);
    } else if (examsConfig.pastDays > 90) {
      warnings.push(`exams.pastDays is very large (${examsConfig.pastDays}). Consider reducing.`);
    }
  }

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

  if (!homeworkConfig || typeof homeworkConfig !== 'object') return warnings;

  // nextDays validation
  if (Number.isFinite(homeworkConfig.nextDays)) {
    if (homeworkConfig.nextDays < 0) {
      warnings.push(`homework.nextDays cannot be negative. Value: ${homeworkConfig.nextDays}`);
    } else if (homeworkConfig.nextDays > 90) {
      warnings.push(`homework.nextDays is very large (${homeworkConfig.nextDays}). Typical values: 7-30.`);
    }
  }

  // pastDays validation
  if (Number.isFinite(homeworkConfig.pastDays)) {
    if (homeworkConfig.pastDays < 0) {
      warnings.push(`homework.pastDays cannot be negative. Value: ${homeworkConfig.pastDays}`);
    } else if (homeworkConfig.pastDays > 30) {
      warnings.push(`homework.pastDays is very large (${homeworkConfig.pastDays}). Consider reducing.`);
    }
  }

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

  if (!absencesConfig || typeof absencesConfig !== 'object') return warnings;

  // nextDays validation
  if (Number.isFinite(absencesConfig.nextDays)) {
    if (absencesConfig.nextDays < 0) {
      warnings.push(`absences.nextDays cannot be negative. Value: ${absencesConfig.nextDays}`);
    } else if (absencesConfig.nextDays > 90) {
      warnings.push(`absences.nextDays is very large (${absencesConfig.nextDays}). Typical values: 7-30.`);
    }
  }

  // pastDays validation
  if (Number.isFinite(absencesConfig.pastDays)) {
    if (absencesConfig.pastDays < 0) {
      warnings.push(`absences.pastDays cannot be negative. Value: ${absencesConfig.pastDays}`);
    } else if (absencesConfig.pastDays > 90) {
      warnings.push(`absences.pastDays is very large (${absencesConfig.pastDays}). Consider reducing.`);
    }
  }

  // maxItems validation
  if (Number.isFinite(absencesConfig.maxItems)) {
    if (absencesConfig.maxItems < 1) {
      warnings.push(`absences.maxItems must be at least 1. Value: ${absencesConfig.maxItems}`);
    } else if (absencesConfig.maxItems > 100) {
      warnings.push(`absences.maxItems is very large (${absencesConfig.maxItems}). Consider reducing for readability.`);
    }
  }

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
 * Validate student-level widget configurations
 * Student config can override module-level widget settings
 *
 * @param {Object} studentConfig - Student configuration object
 * @returns {string[]} Array of warning messages
 */
function validateStudentWidgets(studentConfig) {
  if (!studentConfig || typeof studentConfig !== 'object') return [];

  return validateAllWidgets(studentConfig);
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
  const hasDirectCreds = Boolean(student.username && student.password && student.school);
  const hasStudentId = Number.isFinite(Number(student.studentId));

  if (!hasQr && !hasDirectCreds && !hasStudentId) {
    warnings.push(
      `Student "${student.title || 'Unknown'}": No credentials configured. Provide either qrcode OR (username + password + school) OR studentId (for parent account).`
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
  validateGridConfig,
  validateLessonsConfig,
  validateExamsConfig,
  validateHomeworkConfig,
  validateAbsencesConfig,
  validateMessagesConfig,
  validateAllWidgets,
  validateStudentWidgets,
  validateStudentCredentials,
};
