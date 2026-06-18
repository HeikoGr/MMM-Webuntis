const { validateConfigObject, validateMinimumField, validateNonNegativeField } = require('../../lib/pluginValidationUtils');

const DEFAULT_CONFIG = Object.freeze({
  pastDays: 21,
  nextDays: 7,
  dateFormat: 'EEE dd.MM.',
  showDate: true,
  showExcused: true,
  showReason: true,
  maxItems: null,
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
