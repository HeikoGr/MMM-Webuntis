const NodeHelper = require("node_helper");
const Log = require("logger");
const shared = require("./lib/mmm-shared/mmm-shared");
const { createInstanceHub } = require("./lib/mmm-shared/backend-session");

const {
  AuthService,
  WebUntisClient,
  formatError,
  convertRestErrorToWarning,
  buildFetchPlan,
} = require("./lib/webuntisClient");
const { ApiStatusTracker, apiStatusKey } = require("./lib/apiStatusTracker");
const {
  buildEffectiveStudentConfig,
  buildFetchFlags,
  buildFrontendPluginRegistry,
  collectPluginValidationIssues,
  normalizeModuleConfig,
  validateNormalizedConfig,
} = require("./lib/moduleConfig");
const { createAuthSession, getCredentialKey } = require("./lib/authSession");
const { createResponseCache } = require("./lib/webuntis/responseCache");
const { ensureStudentsFromAppData } = require("./lib/studentDiscovery");
const { isDemoMode, buildDemoPayloads, loadFixturePayloads, prepareDemoStudents } = require("./lib/demoData");
const { extractHolidaysFromAppData } = require("./lib/webuntis/dataOrchestration");
const { buildStudentErrorPayload } = require("./lib/mmm-adapter/mmmPayloadMapper");
const {
  buildWarningMetaEntries,
  buildWarningMetaList,
  classifyWarningMetaFromError,
  collectValidationWarnings,
  createGroupWarningCollector,
  createWarningMetaMap,
  isNetworkError,
  mergeGroupWarningsIntoPayload,
  mergeUniqueWarnings,
} = require("./lib/warningUtils");
const { initializeBackendPluginHost } = require("./lib/pluginHostBackend");
const { validateStudentCredentials } = require("./lib/widgetConfigValidator");

const LOG_LEVEL_WEIGHTS = Object.freeze({ none: -1, error: 0, warn: 1, info: 2, debug: 3 });

// Students of one account fetched at the same time (see _processGroup).
const STUDENT_FETCH_CONCURRENCY = 3;

/**
 * map() with an async callback and at most `limit` calls in flight; results keep the input order.
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * MagicMirror adapter for MMM-Webuntis.
 *
 * The backend owns the fetch schedule: the frontend sends its config once (CONFIGURE) and reports
 * active/paused (SESSION_STATE); the mmm-shared instance hub keeps one lifecycle per instance,
 * calls fetchInstance() on schedule and pushes CONFIGURED, DATA, FETCH_FAILED, CONFIG_INVALID,
 * CONFIG_REJECTED and INIT_REQUIRED events. Several displays of one instance share one fetch cycle.
 *
 * This file adds the WebUntis parts: config preparation, the per-credential fetch loop and the
 * demo mode. Everything else lives in lib/: config normalization (moduleConfig), student discovery
 * (studentDiscovery), auth (authSession + webuntis/authService), endpoint status and circuit
 * breaker (apiStatusTracker), WebUntis fetching (webuntisClient) and payload building
 * (mmm-adapter/mmmPayloadMapper).
 */
module.exports = NodeHelper.create({
  start() {
    this._ensureRuntime();
    this._hub.attach(this.io);
    this._mmLog("debug", null, "Node helper started");
  },

  /**
   * Lazily create runtime state so the CLI wrapper and unit tests can drive the helper without
   * going through start().
   */
  _ensureRuntime() {
    if (this._runtimeReady) return;
    this._runtimeReady = true;

    // Each instance's own logLevel (from its CONFIGURE), keyed by identifier.
    this._logLevels = new Map();
    const log = this._mmLog.bind(this);
    this.notifications = shared.buildNotifications("MMM-Webuntis");
    this._authService = new AuthService({ logger: (level, message) => log(level, null, `[lib] ${message}`) });
    this._apiStatus = new ApiStatusTracker({ logger: log });
    this._client = new WebUntisClient({
      mmLog: log,
      formatErr: formatError,
      apiStatus: this._apiStatus,
      // Instances with the same account reuse each other's responses instead of fetching again.
      responseCache: createResponseCache(),
    });
    this._pendingFetchByCredKey = new Map(); // credKey -> in-flight processGroup() promise
    this._configWarnings = new WeakMap(); // prepared config -> { warnings, warningMeta }
    this._pluginHost = initializeBackendPluginHost({ moduleRoot: __dirname, logger: log });
    this._pluginWarnings = Array.isArray(this._pluginHost?.warnings) ? this._pluginHost.warnings.slice() : [];
    this._pluginWarnings.forEach((warning) => {
      log("warn", null, warning);
    });
    this._hub = this._createHub();
  },

  _createHub() {
    // The hub logs (message, context); the instance's own logLevel narrows its lines.
    const hubLog = (level) => (message, context) => {
      const suffix = context === undefined ? "" : ` ${JSON.stringify(context)}`;
      const identifier = context?.identifier;
      const line = `[hub] ${message}${suffix}`;
      if (identifier) this._loggerFor(identifier)(level, null, line);
      else this._mmLog(level, null, line);
    };

    return createInstanceHub({
      moduleName: "MMM-Webuntis",
      sendSocketNotification: (notification, payload) => this.sendSocketNotification(notification, payload),
      logger: { debug: hubLog("debug"), info: hubLog("info"), warn: hubLog("warn"), error: hubLog("error") },
      // The instance's lifecycle lines follow that instance's logLevel and name it.
      loggerFor: (identifier) => {
        const log = this._loggerFor(identifier);
        const line = (level) => (message, context) =>
          log(
            level,
            null,
            `[hub] ${identifier}: ${message}${context === undefined ? "" : ` ${JSON.stringify(context)}`}`,
          );
        return { debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error") };
      },
      // Two displays of one instance must agree on these (the raw frontend config is compared).
      criticalKeys: ["username", "password", "school", "server", "qrcode", "students"],
      prepareConfig: (config) => this.prepareConfig(config),
      lifecycleOptions: (config) => ({
        updateInterval: config.updateInterval,
        minUpdateInterval: 30 * 1000,
        backgroundRefresh: config.backgroundRefresh !== false,
        quietHours: config.quietHours,
        // A wrong password must not log in every minute: retries start after 2 minutes.
        retryInterval: 2 * 60 * 1000,
        maxRetryInterval: 30 * 60 * 1000,
      }),
      isFailure: (data) => data?.allFailed === true,
      onConfigured: (identifier, config) => this._logLevels.set(identifier, config.logLevel),
      onReleased: (identifier) => {
        this._apiStatus?.release(identifier);
        this._logLevels?.delete(identifier);
      },
      describe: (_identifier, config) => ({
        ...(this._configWarnings.get(config) || { warnings: [], warningMeta: [] }),
        plugins: buildFrontendPluginRegistry(config, this._pluginHost, __dirname),
      }),
      fetch: ({ identifier, config, reason }) => this.fetchInstance({ identifier, config, reason }),
    });
  },

  /**
   * Called when the MagicMirror backend shuts the helper down.
   * Logs every cached WebUntis session out (best effort, fire-and-forget) and drops cached auth
   * state and instance state so nothing sensitive lingers in memory past shutdown.
   */
  stop() {
    this._hub?.stop();
    this._hub = null;
    const authService = this._authService;
    this._authService = null;
    if (authService) {
      authService.logoutAll().catch((error) => {
        this._mmLog("debug", null, `Logout on shutdown failed: ${formatError(error)}`);
      });
    }
    this._apiStatus?.clear();
    this._client?.responseCache?.clear();
    this._pendingFetchByCredKey?.clear();
    this._runtimeReady = false;
    this._mmLog("debug", null, "Node helper stopped");
  },

  // ---------------------------------------------------------------------------------------------
  // Socket protocol
  // ---------------------------------------------------------------------------------------------

  /**
   * Every frontend request goes through the hub, which needs to see all notifications (it keeps
   * the copy of CONFIGURE with the secrets MagicMirror resolved).
   */
  socketNotificationReceived(notification, payload) {
    this._ensureRuntime();
    this._hub.socketNotificationReceived(notification, payload);
  },

  // ---------------------------------------------------------------------------------------------
  // CONFIGURE
  // ---------------------------------------------------------------------------------------------

  /**
   * Turn the frontend config into the effective instance config: normalize (legacy mappings,
   * canonical plugins), validate, and in demo mode check the fixtures. Warnings are kept for
   * describe() (sent as CONFIGURED).
   *
   * @param {Object} rawConfig - Config as sent by the frontend (includes `id`)
   * @returns {Object} Normalized config
   * @throws {Error} code CONFIG_INVALID, details { errors, warnings, warningMeta }
   */
  prepareConfig(rawConfig) {
    this._ensureRuntime();
    const { normalizedConfig, configWarnings } = normalizeModuleConfig(JSON.parse(JSON.stringify(rawConfig)), {
      pluginHost: this._pluginHost,
      logger: this._mmLog.bind(this),
    });
    const validation = validateNormalizedConfig(normalizedConfig, configWarnings, this._pluginHost);
    if (isDemoMode(normalizedConfig)) {
      try {
        loadFixturePayloads(normalizedConfig.demoDataFile, __dirname);
      } catch (error) {
        validation.valid = false;
        validation.errors.push(`demoDataFile: ${formatError(error)}`);
      }
    }

    if (!validation.valid) {
      const error = new Error(validation.errors.join("\n"));
      error.code = "CONFIG_INVALID";
      error.details = { errors: validation.errors, warnings: validation.warnings, warningMeta: validation.warningMeta };
      throw error;
    }

    const warnings = mergeUniqueWarnings(validation.warnings, this._pluginWarnings || []);
    const metaByMessage = createWarningMetaMap(validation.warningMeta);
    buildWarningMetaEntries(warnings, { kind: "config", severity: "warning" }).forEach((entry) => {
      if (!metaByMessage.has(entry.message)) metaByMessage.set(entry.message, entry);
    });
    this._configWarnings.set(normalizedConfig, {
      warnings,
      warningMeta: buildWarningMetaList(warnings, metaByMessage),
    });
    return normalizedConfig;
  },

  // ---------------------------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------------------------

  /**
   * One fetch cycle of an instance, called by the hub on the backend's schedule.
   *
   * Groups the students by credential key and processes each group. Groups sharing credentials
   * with an in-flight fetch (another instance) wait for it: they share one WebUntis session and
   * would only race each other. Failures become warning-bearing payloads, so the frontend always
   * learns about them.
   *
   * @param {Object} params
   * @param {string} params.identifier - Module instance
   * @param {Object} params.config - Prepared config (prepareConfig); student discovery updates it
   * @param {string} [params.reason] - Why the fetch runs (diagnostics)
   * @returns {Promise<{students: Object[], allFailed: boolean, warnings: string[]}>} One payload per
   *   student; `allFailed` when none of them carries data, `warnings` are module-level
   */
  async fetchInstance({ identifier, config, reason = "unspecified" }) {
    this._ensureRuntime();
    const log = this._loggerFor(identifier);
    log("debug", null, `[FETCH] Start (id=${identifier}, reason=${reason})`);

    if (isDemoMode(config)) {
      // Fixtures are read on every fetch, so edits show up without a restart.
      if (!config._moduleDefaultsMerged) prepareDemoStudents(config);
      const students = buildDemoPayloads(config, __dirname).map((payload) => ({ ...payload, id: identifier }));
      log("debug", null, `[DEMO] Serving ${students.length} demo payload(s) for ${identifier}`);
      return { students, allFailed: false, warnings: [] };
    }

    // Retried on every fetch until it worked (idempotent through _moduleDefaultsMerged).
    const warnings = await ensureStudentsFromAppData(config, {
      authService: this._authService,
      logger: log,
      formatError,
    });

    const groups = new Map();
    (Array.isArray(config.students) ? config.students : []).forEach((student) => {
      const credKey = getCredentialKey(student, config);
      if (!groups.has(credKey)) groups.set(credKey, []);
      groups.get(credKey).push(student);
    });

    const students = [];
    let failed = 0;
    for (const [credKey, groupStudents] of groups.entries()) {
      // Queue behind whatever runs for this account. Chaining (instead of awaiting the running
      // fetch once) keeps two waiting instances from starting at the same time.
      const previous = this._pendingFetchByCredKey.get(credKey);
      if (previous) {
        log("debug", null, `Instance ${identifier}: waiting for running fetch of credKey=${credKey}`);
      }
      const run = (previous || Promise.resolve())
        .catch(() => {})
        .then(() => this._processGroup(credKey, groupStudents, identifier, config));
      this._pendingFetchByCredKey.set(credKey, run);
      try {
        const result = await run;
        students.push(...result.payloads);
        failed += result.failed;
      } finally {
        if (this._pendingFetchByCredKey.get(credKey) === run) this._pendingFetchByCredKey.delete(credKey);
      }
    }

    return { students, allFailed: students.length === 0 || failed === students.length, warnings };
  },

  // ---------------------------------------------------------------------------------------------
  // Fetch per credential group
  // ---------------------------------------------------------------------------------------------

  /**
   * Authenticate once per credential group and fetch every student of the group. Failures are
   * converted into warning-bearing payloads.
   *
   * @returns {Promise<{payloads: Object[], failed: number}>} Payloads in configuration order and
   *   how many of them come from a failure
   */
  async _processGroup(credKey, students, identifier, config) {
    const warningsState = createGroupWarningCollector();
    const sample = students[0];

    let authSession;
    try {
      authSession = await createAuthSession(this._authService, sample, config, credKey);
    } catch (err) {
      const payloads = this._handleGroupAuthFailure({ err, credKey, identifier, students, config, warningsState });
      return { payloads, failed: payloads.length };
    }

    const { fetchTimegrid: wantsHolidays } = buildFetchFlags(config, this._pluginHost);
    const compactHolidays = wantsHolidays ? extractHolidaysFromAppData(authSession.appData) : [];

    const fetchOne = async (student) => {
      try {
        const payload = await this._fetchStudentPayload({
          student,
          authSession,
          identifier,
          credKey,
          compactHolidays,
          config,
          warningsState,
        });
        return { payload, failed: 0 };
      } catch (err) {
        const payload = this._buildStudentFetchFailurePayload({ err, student, identifier, config, warningsState });
        return { payload, failed: 1 };
      }
    };

    // The students share the authenticated session and fetch side by side. Each one still checks
    // the token with its timetable before its other endpoints (dataFetchOrchestrator), and a token
    // that turns out dead costs one login for all of them (AuthService joins parallel logins and
    // keeps a session that replaced the failed one). Payloads stay in configuration order.
    const results = await mapWithConcurrency(students, STUDENT_FETCH_CONCURRENCY, fetchOne);
    const payloads = results.map((result) => result.payload).filter(Boolean);
    const failed = results.reduce((sum, result) => sum + result.failed, 0);
    return { payloads, failed };
  },

  _handleGroupAuthFailure({ err, credKey, identifier, students, config, warningsState }) {
    const errorMsg = formatError(err);
    const networkFailure = isNetworkError(err);
    const msg = networkFailure
      ? `Cannot reach WebUntis server for ${credKey}: ${errorMsg}`
      : `Authentication failed for ${credKey}: ${errorMsg}`;
    const log = this._loggerFor(identifier);
    log("error", null, msg);

    // Only the failing credentials are forced to re-login; other accounts keep their sessions.
    if (this._authService?.invalidateCache(credKey)) {
      log("warn", null, `[REAUTH] Forcing re-authentication for ${credKey} on the next fetch`);
    }

    warningsState.addGroupWarning(
      msg,
      classifyWarningMetaFromError(err, { kind: networkFailure ? "network" : "auth" }),
    );
    return students.map((student) =>
      this._buildErrorPayload({
        identifier,
        student,
        config,
        apiStatus: null,
        apiRecords: this._apiStatus.getRecords(apiStatusKey(identifier, student)),
        warnings: warningsState.groupWarnings,
        warningMetaByMessage: warningsState.groupWarningMetaByMessage,
        warningFallbackMeta: { kind: "generic", severity: "warning" },
      }),
    );
  },

  async _fetchStudentPayload({ student, authSession, identifier, credKey, compactHolidays, config, warningsState }) {
    const studentWarnings = collectValidationWarnings(
      validateStudentCredentials(student),
      collectPluginValidationIssues(student, this._pluginHost).warnings,
    );
    const log = this._loggerFor(identifier);
    studentWarnings.forEach((warning) => {
      log("warn", student, warning);
      warningsState.addGroupWarning(warning, { kind: "config", severity: "warning" });
    });

    const fetchFlags = buildFetchFlags(buildEffectiveStudentConfig(student, config), this._pluginHost);
    const payload = await this._client.fetchStudentData({
      authSession,
      student,
      identifier,
      credKey,
      compactHolidays,
      config,
      plan: buildFetchPlan({ student, config, fetchFlags, authService: this._authService }),
      statusKey: apiStatusKey(identifier, student),
      currentFetchWarnings: new Set(),
      mmLog: log,
    });

    if (!payload) {
      log("warn", student, `fetchStudentData returned empty payload for ${student.title}`);
      return null;
    }
    return {
      ...mergeGroupWarningsIntoPayload(payload, warningsState.groupWarnings, warningsState.groupWarningMetaByMessage),
      id: identifier,
    };
  },

  _buildStudentFetchFailurePayload({ err, student, identifier, config, warningsState }) {
    const log = this._loggerFor(identifier);
    log("error", student, `Error fetching data for ${student.title}: ${formatError(err)}`);

    const warningMsg = convertRestErrorToWarning(err, {
      studentTitle: student.title,
      school: student.school || config?.school,
      server: student.server || config?.server || "webuntis.com",
    });
    if (warningMsg) {
      warningsState.addGroupWarning(warningMsg, classifyWarningMetaFromError(err));
      log("warn", student, warningMsg);
    }

    return this._buildErrorPayload({
      identifier,
      student,
      config,
      apiStatus: this._apiStatus.buildSnapshot(apiStatusKey(identifier, student)),
      apiRecords: this._apiStatus.getRecords(apiStatusKey(identifier, student)),
      warnings: mergeUniqueWarnings(warningsState.groupWarnings, warningMsg),
      warningMetaByMessage: warningsState.groupWarningMetaByMessage,
      warningFallbackMeta: classifyWarningMetaFromError(err),
    });
  },

  _buildErrorPayload({
    identifier,
    student,
    config,
    apiStatus,
    apiRecords,
    warnings,
    warningMetaByMessage,
    warningFallbackMeta,
  }) {
    return buildStudentErrorPayload({
      identifier,
      student,
      config,
      fetchFlags: buildFetchFlags(buildEffectiveStudentConfig(student, config), this._pluginHost),
      apiStatus: apiStatus || {},
      apiRecords: apiRecords || {},
      warnings,
      warningMetaByMessage,
      warningFallbackMeta,
    });
  },

  // ---------------------------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------------------------

  /**
   * Log for the shared services (auth, API status, HTTP client, plugin host) and for paths without
   * an instance. They serve every instance, so the widest instance logLevel applies: one instance
   * at "debug" keeps their debug lines, and a single instance behaves exactly as before.
   */
  _mmLog(level, student, message) {
    this._writeLog(level, student, message, this._sharedLogLevel());
  },

  /**
   * Logger of one instance: (level, student, message), narrowed by that instance's own logLevel.
   * @param {string} identifier - Module instance
   * @returns {Function} Logger
   */
  _loggerFor(identifier) {
    return (level, student, message) => this._writeLog(level, student, message, this._logLevels?.get(identifier));
  },

  /** @returns {string|undefined} The least restrictive configured logLevel, undefined = no narrowing */
  _sharedLogLevel() {
    let widest;
    for (const level of this._logLevels?.values() || []) {
      const weight = LOG_LEVEL_WEIGHTS[String(level || "").toLowerCase()];
      if (weight === undefined) return undefined;
      if (widest === undefined || weight > LOG_LEVEL_WEIGHTS[widest]) widest = String(level).toLowerCase();
    }
    return widest;
  },

  /**
   * Forward to MagicMirror's Log with an optional [student] tag. MagicMirror's global logLevel
   * decides; the given own logLevel can only narrow it.
   */
  _writeLog(level, student, message, ownLevel) {
    const own = LOG_LEVEL_WEIGHTS[String(ownLevel || "").toLowerCase()];
    if (own !== undefined && (LOG_LEVEL_WEIGHTS[level] ?? LOG_LEVEL_WEIGHTS.info) > own) return;
    const studentTag = student?.title ? `[${String(student.title).trim()}] ` : "";
    const formatted = `${studentTag}${message}`;
    if (level === "debug") return Log.debug(formatted);
    if (level === "error") return Log.error(formatted);
    if (level === "warn") return Log.warn(formatted);
    return Log.info(formatted);
  },
});
