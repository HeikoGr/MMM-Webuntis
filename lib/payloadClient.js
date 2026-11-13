/*
 * The MMM side of a fetch: which date ranges a student needs (buildFetchPlan) and the WebUntis
 * client that turns the normalized bundle into one DATA payload (PayloadClient).
 */
const WebUntisClient = require("./webuntis/webuntisClient");
const { calculateFetchRanges } = require("./webuntis/dataOrchestration");
const { getCurrentDateContext } = require("./runtime-utils");
const { mapBundleToMmmPayload } = require("./mmm-adapter/mmmPayloadMapper");

/**
 * Current base date in the configured timezone (honours debugDate).
 *
 * @param {Object} config - Module config
 * @returns {Date} Timezone-aware base date
 */
function calculateBaseNow(config) {
  return getCurrentDateContext(config, { defaultTimezone: "Europe/Berlin" }).date;
}

/**
 * Build the fetch plan for one student: date ranges per data type, homework window and flags.
 *
 * @param {Object} params
 * @param {Object} params.student - Student config (canonical, with `plugins`)
 * @param {Object} params.config - Module config
 * @param {Object} params.fetchFlags - Flags from moduleConfig.buildFetchFlags()
 * @param {import('./webuntis/authService')} params.authService - Shared auth service
 * @param {Array} [params.compactHolidays] - Holidays, for the lessons preview's next school day
 * @returns {Object} plan consumed by PayloadClient.fetchStudentData()
 */
function buildFetchPlan({ student, config, fetchFlags, authService, compactHolidays = [] }) {
  const pluginConfigMap =
    student?.plugins && typeof student.plugins === "object" && !Array.isArray(student.plugins) ? student.plugins : {};
  const pluginConfig = (id) => pluginConfigMap[id]?.config || student[id] || {};
  const gridConfig = pluginConfig("grid");
  const lessonsConfig = pluginConfig("lessons");
  const examsConfig = pluginConfig("exams");
  const absencesConfig = pluginConfig("absences");
  const homeworkConfig = pluginConfig("homework");
  const baseNow = calculateBaseNow(config);

  const dateRanges = calculateFetchRanges({
    baseNow,
    fetchPlan: {
      wantsGridWidget: Boolean(fetchFlags.wantsGridWidget),
      wantsLessonsWidget: Boolean(fetchFlags.wantsLessonsWidget),
      fetchExams: Boolean(fetchFlags.fetchExams),
      fetchAbsences: Boolean(fetchFlags.fetchAbsences),
    },
    days: {
      globalPastDays: student.pastDays,
      globalNextDays: student.nextDays,
      gridPastDays: gridConfig.pastDays,
      gridNextDays: gridConfig.nextDays,
      lessonsPastDays: lessonsConfig.pastDays,
      lessonsNextDays: lessonsConfig.nextDays,
      examsPastDays: examsConfig.pastDays ?? student.pastDays,
      examsNextDays: examsConfig.nextDays,
      absencesPastDays: absencesConfig.pastDays,
      absencesNextDays: absencesConfig.nextDays,
      homeworkPastDays: homeworkConfig.pastDays,
      homeworkNextDays: homeworkConfig.nextDays,
    },
    options: {
      gridWeekView: gridConfig.weekView,
      gridHideWeekends: gridConfig.hideWeekends,
      lessonsHideWeekends: lessonsConfig.hideWeekends,
      lessonsPreviewNext: lessonsConfig.previewNext === true,
      holidays: compactHolidays,
      debugDateEnabled: Boolean(config && typeof config.debugDate === "string" && config.debugDate),
    },
  });

  return {
    authService,
    homeworkFilter: {
      pastDays: homeworkConfig.pastDays,
      nextDays: homeworkConfig.nextDays,
    },
    fetchFlags: {
      fetchTimegrid: Boolean(fetchFlags.fetchTimegrid),
      fetchTimetable: Boolean(fetchFlags.fetchTimetable),
      fetchExams: Boolean(fetchFlags.fetchExams),
      fetchHomeworks: Boolean(fetchFlags.fetchHomeworks),
      fetchAbsences: Boolean(fetchFlags.fetchAbsences),
      fetchMessagesOfDay: Boolean(fetchFlags.fetchMessagesOfDay),
    },
    baseNow,
    dateRanges,
    flagsCtx: {
      debugApi: Boolean(config.debugApi),
      dumpRawApiResponses: Boolean(config.dumpRawApiResponses),
    },
  };
}

class PayloadClient extends WebUntisClient {
  /**
   * The core client returns the normalized bundle; this maps it to one student's DATA payload.
   */
  async fetchStudentData(params) {
    const { identifier, student, config, compactHolidays = [], currentFetchWarnings } = params;
    // The caller's logger carries its instance's logLevel; the client's own is the shared one.
    const mmLog = params.mmLog || this.mmLog;
    const coreData = await this.fetchBundle(params);

    try {
      return mapBundleToMmmPayload(
        {
          identifier,
          student,
          config,
          compactHolidays,
          currentFetchWarnings,
          coreData,
        },
        { mmLog },
      );
    } catch (err) {
      mmLog("error", student, `Failed to prepare payload for ${identifier}: ${this.formatErr(err)}`);
      return null;
    }
  }
}

module.exports = {
  PayloadClient,
  buildFetchPlan,
  calculateBaseNow,
};
