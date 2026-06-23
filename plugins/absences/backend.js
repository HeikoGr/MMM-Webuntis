const { validateConfigObject, validateMinimumField, validateNonNegativeField } = require('../../lib/pluginValidationUtils');

const DEFAULT_CONFIG = Object.freeze({
  pastDays: 21, // Past days to include in absence list.
  nextDays: 7, // Future days to include in absence list.
  dateFormat: 'EEE dd.MM.', // Absence date display format.
  showDate: true, // Show date column.
  showExcused: true, // Show excused/unexcused state.
  showReason: true, // Show absence reason text.
  maxItems: null, // Optional row limit (null = no limit).
});

module.exports = {
  id: 'absences',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        const issues = validateConfigObject('absences', pluginConfig, 'absences');
        if (issues.length > 0) return issues;

        validateNonNegativeField(issues, 'absences', 'absences', pluginConfig, 'nextDays', {
          upperCondition: (value) => value > 90,
          upperMessage: (value, path) => `${path} is very large (${value}). Typical values: 7-30.`,
        });
        validateNonNegativeField(issues, 'absences', 'absences', pluginConfig, 'pastDays', {
          upperCondition: (value) => value > 90,
          upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing.`,
        });
        validateMinimumField(issues, 'absences', 'absences', pluginConfig, 'maxItems', 1, {
          upperCondition: (value) => value > 100,
          upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing for readability.`,
        });

        return issues;
      },

      getCapabilities() {
        return ['absences', 'studentContext', 'runtimeState'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
