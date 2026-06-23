const { validateConfigObject, validateNonNegativeField } = require('../../lib/pluginValidationUtils');

const DEFAULT_CONFIG = Object.freeze({
  nextDays: 21, // Future days to include in exam list.
  dateFormat: 'EEE dd.MM.', // Exam date display format.
  showSubject: true, // Show subject label before exam name.
  showTeacher: true, // Show primary teacher in exam row.
});

module.exports = {
  id: 'exams',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        const issues = validateConfigObject('exams', pluginConfig, 'exams');
        if (issues.length > 0) return issues;

        validateNonNegativeField(issues, 'exams', 'exams', pluginConfig, 'nextDays', {
          upperCondition: (value) => value > 365,
          upperMessage: (value, path) => `${path} is very large (${value}). Maximum recommended: 365.`,
        });
        validateNonNegativeField(issues, 'exams', 'exams', pluginConfig, 'pastDays', {
          upperCondition: (value) => value > 90,
          upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing.`,
        });

        return issues;
      },

      getCapabilities() {
        return ['exams', 'studentContext'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
