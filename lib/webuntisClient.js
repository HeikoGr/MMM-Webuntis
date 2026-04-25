const CoreWebUntisClient = require('./webuntis/webuntisClient');
const AuthService = require('./webuntis/authService');
const errorHandler = require('./webuntis/errorHandler');
const { normalizeDateToInteger, normalizeTimeToHHMM } = require('./webuntis/dataOrchestration');
const { mapBundleToMmmPayload } = require('./mmm-adapter/mmmPayloadMapper');

class WebUntisClient extends CoreWebUntisClient {
  /**
   * Public MMM-Webuntis facade.
   * The core client returns normalized bundle data; this facade maps it to GOT_DATA.
   */
  async fetchStudentData(params) {
    const { identifier, student, sessionKey, config, compactHolidays = [], currentFetchWarnings } = params;
    const coreData = await this.fetchBundle(params);

    try {
      return mapBundleToMmmPayload(
        {
          identifier,
          sessionKey,
          student,
          config,
          compactHolidays,
          currentFetchWarnings,
          coreData,
        },
        {
          compactTimegrid: this.compactTimegrid,
          checkEmptyDataWarning: this.checkEmptyDataWarning,
          mmLog: this.mmLog,
          cleanupOldDebugDumps: this.cleanupOldDebugDumps,
        }
      );
    } catch (err) {
      this.mmLog('error', student, `Failed to prepare payload for ${identifier}: ${this.formatErr(err)}`);
      return null;
    }
  }
}

module.exports = {
  AuthService,
  formatError: errorHandler.formatError,
  convertRestErrorToWarning: errorHandler.convertRestErrorToWarning,
  normalizeDateToInteger,
  normalizeTimeToHHMM,
  WebUntisClient,
};
