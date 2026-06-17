const { validateConfigObject, validateNonNegativeField } = require('../../lib/pluginValidationUtils');

const DEFAULT_CONFIG = Object.freeze({});

module.exports = {
  id: 'lessons',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        const issues = validateConfigObject('lessons', pluginConfig, 'lessons');
        if (issues.length > 0) return issues;

        validateNonNegativeField(issues, 'lessons', 'lessons', pluginConfig, 'nextDays', {
          upperCondition: (value) => value > 14,
          upperMessage: (value, path) => `${path} is very large (${value}). Typical values: 1-7.`,
        });
        validateNonNegativeField(issues, 'lessons', 'lessons', pluginConfig, 'pastDays');

        return issues;
      },

      getCapabilities() {
        return ['lessons', 'holidays', 'dayNotices', 'studentContext'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
