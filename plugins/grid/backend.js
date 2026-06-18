const { validateConfigObject, validateNonNegativeField, validatePositiveNumberField } = require('../../lib/pluginValidationUtils');

const DEFAULT_CONFIG = Object.freeze({
  nextDays: 4,
  pastDays: 0,
  weekView: false,
  dateFormat: 'EEE dd.MM.',
  hideWeekends: false,
  showNowLine: true,
  mergeGap: 15,
  maxLessons: 0,
  naText: 'N/A',
  fields: {
    primary: 'subject',
    secondary: 'teacher',
    additional: ['room'],
    format: {
      subject: 'long',
      teacher: 'long',
      class: 'short',
      room: 'short',
      studentGroup: 'short',
    },
  },
});

module.exports = {
  id: 'grid',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        const issues = validateConfigObject('grid', pluginConfig, 'grid');
        if (issues.length > 0) return issues;

        validateNonNegativeField(issues, 'grid', 'grid', pluginConfig, 'nextDays', {
          upperCondition: (value) => value > 30,
          upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing for better performance.`,
          upperSeverity: 'error',
        });
        validateNonNegativeField(issues, 'grid', 'grid', pluginConfig, 'pastDays', {
          upperCondition: (value) => value > 14,
          upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing.`,
        });
        validateNonNegativeField(issues, 'grid', 'grid', pluginConfig, 'mergeGap', {
          upperCondition: (value) => value > 60,
          upperMessage: (value, path) => `${path} is very large (${value} minutes). Typical values: 0-30.`,
        });
        validateNonNegativeField(issues, 'grid', 'grid', pluginConfig, 'maxLessons', {
          upperCondition: (value) => value > 20 && value !== 0,
          upperMessage: (value, path) => `${path} is very large (${value}). Consider reducing for readability.`,
        });
        validatePositiveNumberField(issues, 'grid', 'grid', pluginConfig, 'pxPerMinute', {
          invalidMessage: (rawValue, path) => `${path} must be a positive number. Value: ${rawValue}`,
          lowerCondition: (value) => value < 0.2,
          lowerMessage: (value, path) => `${path} is very small (${value}). Grid may be too compact to read.`,
          upperCondition: (value) => value > 5,
          upperMessage: (value, path) => `${path} is very large (${value}). Grid may exceed screen height.`,
        });

        return issues;
      },

      getCapabilities() {
        return ['lessons', 'timeUnits', 'absences', 'holidays', 'dayNotices', 'studentContext'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
