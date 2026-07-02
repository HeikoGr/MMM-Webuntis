const { validateConfigObject, validateNonNegativeField } = require('../../lib/pluginValidationUtils');

const DEFAULT_CONFIG = Object.freeze({
  nextDays: 2, // Future days to show in lessons list.
  pastDays: 0, // Past days to keep visible.
  dateFormat: 'EEE', // Date label format per day.
  hideWeekends: false, // Skip weekend rows when possible.
  showStartTime: false, // Show clock time instead of period labels.
  showRegular: false, // Include regular lessons (not only irregular).
  useShortSubject: false, // Prefer short subject names.
  showTeacherMode: 'full', // Teacher display mode: off/initial/full.
  showRoom: false, // Show room information.
  showSubstitution: false, // Show substitution text/details.
  naText: 'N/A', // Fallback text for missing values.
});

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
        return ['lessons', 'timeUnits', 'holidays', 'dayNotices', 'studentContext'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
