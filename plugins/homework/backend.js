const { validateConfigObject, validateNonNegativeField } = require('../../lib/pluginValidationUtils');

const DEFAULT_CONFIG = Object.freeze({
  nextDays: 28, // Future days to include in homework list.
  pastDays: 0, // Past days to keep visible.
  dateFormat: 'EEE dd.MM.', // Due-date display format.
  showSubject: true, // Show homework subject label.
  showText: true, // Show homework description text.
});

module.exports = {
  id: 'homework',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        const issues = validateConfigObject('homework', pluginConfig, 'homework');
        if (issues.length > 0) return issues;

        validateNonNegativeField(issues, 'homework', 'homework', pluginConfig, 'nextDays', {
          upperCondition: (value) => value > 90,
          upperMessage: (value, path) => `${path} is very large (${value}). Typical values: 7-30.`,
        });
        validateNonNegativeField(issues, 'homework', 'homework', pluginConfig, 'pastDays', {
          upperCondition: (value) => value > 30,
          upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing.`,
        });

        return issues;
      },

      getCapabilities() {
        return ['homework', 'studentContext'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
