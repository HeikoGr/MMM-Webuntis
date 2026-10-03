const {
  createConfigIssue,
  validateConfigObject,
  validateNonNegativeField,
} = require("../../lib/pluginValidationUtils");

const DEFAULT_CONFIG = Object.freeze({
  nextDays: 2, // Future days to show in lessons list.
  pastDays: 0, // Past days to keep visible.
  previewNext: false, // Roll over to the next school day once today has nothing left to show.
  previewFrom: "", // Earliest time ("HH:MM") for that rollover on a school day; empty = right away.
  dateFormat: "EEE", // Date label format per day.
  hideWeekends: false, // Skip weekend rows when possible.
  showStartTime: false, // Show clock time instead of period labels.
  showRegular: false, // Include regular lessons (not only irregular).
  useShortSubject: false, // Prefer short subject names.
  showTeacherMode: "full", // Teacher display mode: off/initial/full.
  showRoom: false, // Show room information.
  showSubstitution: false, // Show substitution text/details.
  naText: "N/A", // Fallback text for missing values.
});

/** "H:MM" or "HH:MM" within a day. */
function isClockTime(value) {
  const match = typeof value === "string" ? value.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
  return Boolean(match) && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

module.exports = {
  id: "lessons",
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        const issues = validateConfigObject("lessons", pluginConfig, "lessons");
        if (issues.length > 0) return issues;

        validateNonNegativeField(issues, "lessons", "lessons", pluginConfig, "nextDays", {
          upperCondition: (value) => value > 14,
          upperMessage: (value, path) => `${path} is very large (${value}). Typical values: 1-7.`,
        });
        validateNonNegativeField(issues, "lessons", "lessons", pluginConfig, "pastDays");

        const { previewNext, previewFrom } = pluginConfig || {};
        if (previewNext !== undefined && previewNext !== null && typeof previewNext !== "boolean") {
          issues.push(createConfigIssue("lessons", `lessons.previewNext must be true or false. Value: ${previewNext}`));
        }
        if (previewFrom !== undefined && previewFrom !== null && previewFrom !== "" && !isClockTime(previewFrom)) {
          issues.push(
            createConfigIssue("lessons", `lessons.previewFrom must be a time like "14:00". Value: ${previewFrom}`),
          );
        }

        return issues;
      },
    };
  },
};
