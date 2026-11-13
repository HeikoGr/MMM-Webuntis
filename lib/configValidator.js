/**
 * Configuration Validator
 * Validates MMM-Webuntis config with helpful error messages
 *
 * NOTE: The actual defaults that are applied when config values are missing come from
 * the `defaults` object in MMM-Webuntis.js. This module is used for:
 * - Validation logic (checking types, required fields, etc.)
 * - Legacy mapping and its deprecation warnings (LEGACY_MAPPINGS)
 *
 * The legacy keys are mapped in lib/moduleConfig.js (normalizeModuleConfig), per module and per student.
 */

const { validateLessonAdjustments } = require("./mmm-adapter/lessonAdjustments");
const { normalizeServerHost } = require("./webuntis/serverHost");

// Demo mode (demoDataFile) renders fixtures and never logs in: students and credentials are optional.
// Same test as lib/demoData.js isDemoMode(), which cannot be required here (require cycle).
const isDemoConfig = (config) => typeof config?.demoDataFile === "string" && config.demoDataFile.trim() !== "";

// `students` is optional: with parent credentials (username, password, school) they are discovered.
const ALL_WIDGETS = Object.freeze(["lessons", "grid", "exams", "homework", "absences", "messagesofday"]);

function hasConfiguredValue(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Every legacy configuration key: how it is mapped (old -> new) and what its deprecation warning
 * names. applyLegacyMappings() and generateDeprecationWarnings() both read only this table.
 *
 * context:
 * - "config": top-level key -> top-level key
 * - "widget": top-level key -> the same option in each of `widgets`
 * - "widgetProp": top-level key -> option of one `widget`; applied before the others, so it wins
 * - "dateFormat": top-level dateFormat -> each widget's dateFormat
 * - "debug": debug/enableDebug (booleans) -> logLevel
 * - "deprecated": no longer mapped, only reported; `hint` says what replaces it
 */
const LEGACY_MAPPINGS = [
  { old: "fetchInterval", new: "updateInterval", transform: (v) => Number(v), context: "config" },
  { old: "days", new: "nextDays", transform: (v) => Number(v), context: "config" },
  { old: "displaymode", new: "displayMode", transform: (v) => String(v).toLowerCase(), context: "config" },

  // false -> "info": no debug output, but not silenced either (the global level still applies).
  { old: "debug", new: "logLevel", context: "debug" },
  { old: "enableDebug", new: "logLevel", context: "debug" },

  {
    old: "daysToShow",
    new: "nextDays",
    transform: (v) => Number(v),
    context: "widget",
    widgets: ALL_WIDGETS,
  },
  {
    old: "pastDaysToShow",
    new: "pastDays",
    transform: (v) => Number(v),
    context: "widget",
    widgets: ["lessons", "grid", "absences"],
  },

  { old: "mergeGapMin", new: "mergeGap", transform: (v) => Number(v), context: "widgetProp", widget: "grid" },
  { old: "mergeGapMinutes", new: "mergeGap", transform: (v) => Number(v), context: "widgetProp", widget: "grid" },
  { old: "maxGridLessons", new: "maxLessons", transform: (v) => Number(v), context: "widgetProp", widget: "grid" },
  { old: "showRegularLessons", new: "showRegular", context: "widgetProp", widget: "lessons" },
  { old: "showSubstitutionText", new: "showSubstitution", context: "widgetProp", widget: "lessons" },
  { old: "examsDays", new: "nextDays", context: "widgetProp", widget: "exams" },
  { old: "examsDaysAhead", new: "nextDays", context: "widgetProp", widget: "exams" },
  { old: "daysAhead", new: "nextDays", context: "widgetProp", widget: "exams" },
  { old: "showExamSubject", new: "showSubject", context: "widgetProp", widget: "exams" },
  { old: "showExamTeacher", new: "showTeacher", context: "widgetProp", widget: "exams" },
  { old: "examDateFormat", new: "dateFormat", context: "widgetProp", widget: "exams" },
  { old: "examsDaysBehind", new: "pastDays", context: "widgetProp", widget: "exams" },
  { old: "homeworkDateFormat", new: "dateFormat", context: "widgetProp", widget: "homework" },
  { old: "absencesPastDays", new: "pastDays", context: "widgetProp", widget: "absences" },
  { old: "absencesFutureDays", new: "nextDays", context: "widgetProp", widget: "absences" },

  { old: "dateFormat", new: "dateFormat", context: "dateFormat" },

  { old: "showAbsences", context: "deprecated", hint: "displayMode" },
  { old: "showHomework", context: "deprecated", hint: "displayMode" },
  { old: "showExams", context: "deprecated", hint: "displayMode" },
  { old: "fetchHomeworks", context: "deprecated", hint: 'displayMode (include "homework")' },
  { old: "fetchAbsences", context: "deprecated", hint: 'displayMode (include "absences")' },
];

/**
 * What a deprecation warning tells the user to use instead.
 * @param {Object} mapping - Entry of LEGACY_MAPPINGS
 * @returns {string} Replacement key(s)
 */
function replacementOf(mapping) {
  switch (mapping.context) {
    case "widget":
      return mapping.widgets.map((widget) => `${widget}.${mapping.new}`).join(" / ");
    case "widgetProp":
      return `${mapping.widget}.${mapping.new}`;
    // The global value is copied to every widget; the option exists per widget only.
    case "dateFormat":
      return ALL_WIDGETS.map((widget) => `${widget}.dateFormat`).join(" / ");
    case "deprecated":
      return mapping.hint;
    default:
      return mapping.new;
  }
}

/**
 * Apply one legacy mapping to `out` (in place), without overwriting a value the new key already has.
 * @param {Object} out - Config being normalized; the widget namespaces exist
 * @param {Object} mapping - Entry of LEGACY_MAPPINGS whose key is set in `out`
 * @returns {boolean} False only for debug/enableDebug that did not map (no boolean, or logLevel set)
 */
function applyMapping(out, mapping) {
  const value = out[mapping.old];
  const converted = mapping.transform ? mapping.transform(value) : value;
  const setIfUnset = (target, key) => {
    if (target[key] === undefined) target[key] = converted;
  };

  switch (mapping.context) {
    case "debug":
      // Only a boolean maps, and only when no logLevel is set; the first of debug/enableDebug wins.
      if (typeof value !== "boolean" || out.logLevel) return false;
      out.logLevel = value ? "debug" : "info";
      return true;
    case "config":
      setIfUnset(out, mapping.new);
      return true;
    case "widget":
      for (const widget of mapping.widgets) setIfUnset(out[widget], mapping.new);
      return true;
    case "widgetProp":
      setIfUnset(out[mapping.widget], mapping.new);
      return true;
    case "dateFormat":
      for (const widget of ALL_WIDGETS) {
        if (!out[widget].dateFormat) out[widget].dateFormat = value;
      }
      return true;
    default:
      return true;
  }
}

/**
 * Map legacy keys onto the current structure. A key that is set is always reported in
 * `legacyUsed`; it is only mapped where the new key has no value yet.
 * @param {Object} config - Raw config object (may contain legacy keys)
 * @returns {Object} { normalizedConfig, legacyUsed }
 */
function applyLegacyMappings(config) {
  if (!config || typeof config !== "object") return { normalizedConfig: config, legacyUsed: [] };

  const out = { ...config };
  const legacyUsed = new Set();

  ALL_WIDGETS.forEach((w) => {
    if (!out[w]) out[w] = {};
  });

  // Widget-specific keys first: they win over a global key that maps to the same option.
  const ordered = [
    ...LEGACY_MAPPINGS.filter((m) => m.context === "widgetProp"),
    ...LEGACY_MAPPINGS.filter((m) => m.context !== "widgetProp"),
  ];
  for (const mapping of ordered) {
    if (hasConfiguredValue(out[mapping.old]) && applyMapping(out, mapping)) {
      legacyUsed.add(mapping.old);
    }
  }

  // Warnings are built by the caller (generateDeprecationWarnings), with the replacement keys.
  out.__legacyUsed = Array.from(legacyUsed);
  return { normalizedConfig: out, legacyUsed: out.__legacyUsed };
}

/**
 * Check `server` of the module config and of every student, in place: a leading scheme or a
 * trailing slash is removed with a warning, anything else that is no host name is an error.
 */
function validateServerHosts(config) {
  const errors = [];
  const warnings = [];
  const entries = [
    ["", config],
    ...(Array.isArray(config.students) ? config.students : []).map((s, i) => [`students[${i}].`, s]),
  ];
  for (const [prefix, entry] of entries) {
    if (!entry || typeof entry !== "object" || entry.server === undefined || entry.server === null) continue;
    const { host, cleaned, error } = normalizeServerHost(entry.server);
    if (error) {
      errors.push(`Field "${prefix}server" ${error}`);
    } else {
      if (cleaned)
        warnings.push(`Field "${prefix}server": using "${host}" (remove the "https://" or "/" in config.js)`);
      entry.server = host;
    }
  }
  return { errors, warnings };
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

  // Validate students array
  // Note: Empty students[] is allowed for auto-discovery when parent credentials are provided
  const hasParentCreds = (config.username && config.password && config.school) || config.qrcode;
  const demoMode = isDemoConfig(config);

  if (config.students) {
    if (!Array.isArray(config.students)) {
      errors.push('Field "students" must be an array');
    } else if (config.students.length === 0) {
      // Empty array is valid IF parent credentials are provided (triggers auto-discovery)
      if (!hasParentCreds && !demoMode) {
        errors.push(
          'Field "students" is empty and no parent credentials (username, password, school) provided. Either configure students[] or provide parent credentials for auto-discovery.',
        );
      } else {
        // Empty students with parent creds = auto-discovery mode (valid)
        logger.log("debug", "Empty students[] with parent credentials: auto-discovery will be attempted");
      }
    } else {
      config.students.forEach((student, idx) => {
        const studentErrors = validateStudent(student, idx, config);
        errors.push(...studentErrors);
      });
    }
  } else if (!hasParentCreds && !demoMode) {
    // No students array AND no parent creds = error
    errors.push(
      'Missing "students" array and no parent credentials for auto-discovery. Either configure students[] or provide username, password, and school for auto-discovery.',
    );
  }

  const serverCheck = validateServerHosts(config);
  errors.push(...serverCheck.errors);
  warnings.push(...serverCheck.warnings);

  // excludeLessons/addLessons: module level and per-student overrides (invalid entries are skipped at runtime)
  warnings.push(...validateLessonAdjustments(config));
  if (Array.isArray(config.students)) {
    config.students.forEach((student, idx) => {
      warnings.push(...validateLessonAdjustments(student, `students[${idx}].`));
    });
  }

  // Validate numeric fields
  const numericFields = ["updateInterval", "daysToShow", "pastDaysToShow"];
  for (const field of numericFields) {
    if (field in config && typeof config[field] !== "number") {
      errors.push(`Field "${field}" must be a number, got ${typeof config[field]}`);
    }
  }

  // Validate grid.mergeGap
  if (config.grid && typeof config.grid.mergeGap !== "undefined") {
    if (typeof config.grid.mergeGap !== "number") {
      errors.push(`Field "grid.mergeGap" must be a number, got ${typeof config.grid.mergeGap}`);
    }
  }

  // Validate absences options
  if (config.absences) {
    if (typeof config.absences.pastDays !== "undefined" && typeof config.absences.pastDays !== "number") {
      errors.push(`Field "absences.pastDays" must be a number`);
    }
    if (typeof config.absences.nextDays !== "undefined" && typeof config.absences.nextDays !== "number") {
      errors.push(`Field "absences.nextDays" must be a number`);
    }
  }

  // Log results if logger provided
  if (logger.log) {
    if (errors.length === 0 && warnings.length === 0) {
      logger.log("debug", "Config validation passed");
    } else {
      if (errors.length > 0) logger.log("error", `Config validation failed: ${errors.join("; ")}`);
      if (warnings.length > 0) logger.log("warn", `Config warnings: ${warnings.join("; ")}`);
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
  if (!("title" in student)) {
    errors.push(`students[${index}]: Missing required field "title"`);
  } else if (typeof student.title !== "string") {
    errors.push(`students[${index}]: Field "title" must be a string`);
  }

  // If qrcode is provided, treat it as an alternative to username/password/school
  const hasQrcode = "qrcode" in student && student.qrcode !== undefined && student.qrcode !== null;
  // Check if parent has QR code (for LEGAL_GUARDIAN accounts)
  const hasParentQrcode = "qrcode" in parentConfig && parentConfig.qrcode !== undefined && parentConfig.qrcode !== null;

  if (hasQrcode) {
    if (typeof student.qrcode !== "string") {
      errors.push(`students[${index}]: Field "qrcode" must be a string`);
    }
  } else if (!hasParentQrcode && !isDemoConfig(parentConfig)) {
    // No qrcode in student or parent (and no demo mode) => check if credentials are provided (either in student or inherited from parent)
    const credFields = ["school", "username", "password", "server"];
    for (const field of credFields) {
      // Check student object first, then fall back to parent config
      const hasInStudent = field in student && typeof student[field] === "string";
      const hasInParent = field in parentConfig && typeof parentConfig[field] === "string";

      if (!hasInStudent && !hasInParent) {
        errors.push(`students[${index}]: Missing required field "${field}" (not found in student or parent config)`);
      }
    }
  }
  // If parent has QR code, student credentials are optional (auto-discovery will handle it)

  if ("studentId" in student && typeof student.studentId !== "number") {
    errors.push(`students[${index}]: Field "studentId" must be a number or undefined`);
  }

  return errors;
}

/**
 * Deprecation warnings with the replacement for each legacy key (from LEGACY_MAPPINGS).
 *
 * @param {string[]} legacyKeys - Legacy keys that were detected
 * @returns {string[]} One warning per key
 */
function generateDeprecationWarnings(legacyKeys) {
  return legacyKeys.map((key) => {
    const mapping = LEGACY_MAPPINGS.find((m) => m.old === key);
    return mapping
      ? `DEPRECATED: "${key}" → Use "${replacementOf(mapping)}" instead`
      : `DEPRECATED: "${key}" is no longer supported`;
  });
}

module.exports = {
  validateConfig,
  generateDeprecationWarnings,
  applyLegacyMappings,
};
