const NodeHelper = require("node_helper");
const Log = require("logger");
const shared = require("./lib/mmm-shared/mmm-shared");

const {
  AuthService,
  WebUntisClient,
  formatError,
  convertRestErrorToWarning,
  buildFetchPlan,
} = require("./lib/webuntisClient");
const { ApiStatusTracker } = require("./lib/apiStatusTracker");
const {
  SessionRegistry,
  buildRouteMeta,
  parseSessionKey,
  DEFAULT_IDENTIFIER,
  DEFAULT_SESSION_ID,
} = require("./lib/sessionRegistry");
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

/**
 * MagicMirror adapter for MMM-Webuntis.
 *
 * Owns the socket protocol (CONFIGURE / REFRESH / SESSION_STATE in, MODULE_READY /
 * MODULE_INIT_FAILED / DATA_UPDATE out), frontend session bookkeeping and the per-credential
 * fetch loop. Everything else lives in lib/: config normalization (moduleConfig), student
 * discovery (studentDiscovery), auth (authSession + webuntis/authService), endpoint status and
 * circuit breaker (apiStatusTracker), WebUntis fetching (webuntisClient) and payload building
 * (mmm-adapter/mmmPayloadMapper).
 */
module.exports = NodeHelper.create({
  start() {
    this._ensureRuntime();
    this._mmLog("debug", null, "Node helper started");
  },

  /**
   * Lazily create runtime state so the CLI wrapper and unit tests can drive handlers without
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
    this._sessions = new SessionRegistry({
      logger: log,
      onRelease: (sessionKey) => this._apiStatus.release(sessionKey),
    });
    this._client = new WebUntisClient({
      mmLog: log,
      formatErr: formatError,
      apiStatus: this._apiStatus,
      // Instances with the same account reuse each other's responses instead of fetching again.
      responseCache: createResponseCache(),
    });
    this._pendingFetchByCredKey = new Map(); // credKey -> in-flight processGroup() promise
    this._initInFlightBySession = new Map(); // sessionKey -> in-flight _handleInitModule() promise
    this._pluginHost = initializeBackendPluginHost({ moduleRoot: __dirname, logger: log });
    this._pluginWarnings = Array.isArray(this._pluginHost?.warnings) ? this._pluginHost.warnings.slice() : [];
    this._pluginWarnings.forEach((warning) => {
      log("warn", null, warning);
    });
  },

  /**
   * Called when the MagicMirror backend shuts the helper down.
   * Logs every cached WebUntis session out (best effort, fire-and-forget) and drops cached auth
   * state and per-session config so nothing sensitive lingers in memory past shutdown.
   */
  stop() {
    const authService = this._authService;
    this._authService = null;
    if (authService) {
      authService.logoutAll().catch((error) => {
        this._mmLog("debug", null, `Logout on shutdown failed: ${formatError(error)}`);
      });
    }
    this._sessions?.clear();
    this._apiStatus?.clear();
    this._client?.responseCache?.clear();
    this._pendingFetchByCredKey?.clear();
    this._initInFlightBySession?.clear();
    this._runtimeReady = false;
    this._mmLog("debug", null, "Node helper stopped");
  },

  // ---------------------------------------------------------------------------------------------
  // Socket protocol
  // ---------------------------------------------------------------------------------------------

  /**
   * Main entry point for all frontend-to-backend communication.
   *   - CONFIGURE: first-time module initialization (config validation, student discovery)
   *   - REFRESH: data refresh request (periodic updates, manual refresh)
   *   - SESSION_STATE: per-session lifecycle state updates (paused/active)
   */
  async socketNotificationReceived(notification, payload) {
    this._ensureRuntime();
    if (notification !== this.notifications.REQUEST) return;

    const action = payload?.action;
    const requestData = {
      ...(payload?.data || {}),
      id: payload?.identifier || payload?.data?.id || DEFAULT_IDENTIFIER,
      sessionId: payload?.data?.sessionId || DEFAULT_SESSION_ID,
    };

    const handlers = {
      CONFIGURE: () => this._handleInitModule(requestData),
      REFRESH: () => this._handleFetchData(requestData),
      SESSION_STATE: () => this._handleSessionState(requestData),
    };

    const handler = handlers[action];
    if (!handler) return;
    try {
      await handler();
    } catch (error) {
      this._mmLog("error", null, `[${action}] Unhandled failure: ${formatError(error)}`);
    }
  },

  _emitGotData(payload, route = {}) {
    this._emitSocketNotification("DATA_UPDATE", payload, route, { preserveExistingRoute: false });
  },

  _emitInitError(payload, route = {}) {
    this._emitSocketNotification("MODULE_INIT_FAILED", payload, route, { preserveExistingRoute: true });
  },

  _emitModuleInitialized(payload, route = {}) {
    this._emitSocketNotification("MODULE_READY", payload, route, { preserveExistingRoute: true });
  },

  /**
   * Ask a frontend session to re-run the CONFIGURE handshake. Sent when a REFRESH arrives for a
   * session this helper knows nothing about (helper restarted under a live frontend).
   */
  _emitInitRequired(payload, route = {}) {
    this._emitSocketNotification("INIT_REQUIRED", payload, route, { preserveExistingRoute: true });
  },

  /**
   * Send an EVENT envelope with consistent id/session routing metadata.
   *
   * @param {string} notification - Action name
   * @param {Object} payload - Event payload
   * @param {Object} [route] - { identifier, sessionId } override
   * @param {Object} [options]
   * @param {boolean} [options.preserveExistingRoute=false] - Keep id/sessionId already set on the payload
   */
  _emitSocketNotification(notification, payload, route = {}, options = {}) {
    if (!payload || typeof payload !== "object") return;
    this._ensureRuntime();

    const { preserveExistingRoute = false } = options;
    const nextPayload = { ...payload };

    if (route.identifier && (!preserveExistingRoute || !nextPayload.id)) {
      nextPayload.id = route.identifier;
    }
    if (route.sessionId && (!preserveExistingRoute || !nextPayload.sessionId)) {
      nextPayload.sessionId = route.sessionId;
    }

    const isFailure = String(notification).includes("FAILED");
    this.sendSocketNotification(
      this.notifications.EVENT,
      shared.createEnvelope({
        identifier: nextPayload.id || route.identifier || DEFAULT_IDENTIFIER,
        instanceId: nextPayload.id || route.identifier || DEFAULT_IDENTIFIER,
        action: notification,
        ok: !isFailure,
        data: nextPayload,
        error: isFailure ? nextPayload : null,
        meta: {},
      }),
    );
  },

  // ---------------------------------------------------------------------------------------------
  // CONFIGURE
  // ---------------------------------------------------------------------------------------------

  /**
   * Handle CONFIGURE - one-time module initialization for a frontend session.
   *
   * Flow:
   *   1. Normalize (legacy mappings, canonical plugins) and validate the config
   *   2. Register the session and send MODULE_READY right away, so the frontend's init watchdog
   *      is not coupled to WebUntis response times
   *   3. Auto-discover students if parent credentials are present (may log in)
   *   4. Run the first fetch automatically (no separate REFRESH needed)
   *
   * A CONFIGURE that arrives for a session whose init is still running is ignored.
   */
  async _handleInitModule(payload) {
    this._ensureRuntime();
    const { identifier, sessionKey } = buildRouteMeta(payload);
    const inFlight = this._initInFlightBySession.get(sessionKey);
    if (inFlight) {
      this._loggerFor(identifier)(
        "debug",
        null,
        `[CONFIGURE] Ignored duplicate for session ${sessionKey} (init still running)`,
      );
      return inFlight;
    }

    const run = this._runInitModule(payload).finally(() => {
      if (this._initInFlightBySession.get(sessionKey) === run) this._initInFlightBySession.delete(sessionKey);
    });
    this._initInFlightBySession.set(sessionKey, run);
    return run;
  },

  async _runInitModule(payload) {
    let identifier;
    try {
      const payloadCopy = JSON.parse(JSON.stringify(payload));
      const { normalizedConfig, configWarnings } = normalizeModuleConfig(payloadCopy, {
        pluginHost: this._pluginHost,
        logger: this._mmLog.bind(this),
      });
      const route = buildRouteMeta({ id: normalizedConfig.id, sessionId: payload.sessionId });
      identifier = route.identifier;
      const { sessionId, sessionKey } = route;
      // Each instance logs at its own logLevel; the shared services follow the widest one.
      this._logLevels.set(identifier, normalizedConfig.logLevel);
      const log = this._loggerFor(identifier);

      log(
        "debug",
        null,
        `[CONFIGURE] Received (id=${identifier}, session=${sessionId}, reason=${payload?.reason || "unspecified"})`,
      );
      this._sessions.storeInitConfig(sessionKey, normalizedConfig);
      if (normalizedConfig.debugDate) {
        log(
          "debug",
          null,
          `[CONFIGURE] Session debugDate="${normalizedConfig.debugDate}" (session-specific, not global)`,
        );
      }

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
        log("error", null, `[CONFIGURE] Config validation failed for ${identifier}`);
        this._emitInitError(
          {
            errors: validation.errors,
            warnings: validation.warnings,
            warningMeta: validation.warningMeta,
            severity: "ERROR",
            message: "Configuration validation failed",
          },
          { identifier, sessionId },
        );
        return;
      }

      this._sessions.configsByIdentifier.set(identifier, normalizedConfig);
      this._emitInitSuccess(normalizedConfig, identifier, sessionId, validation.warnings, validation.warningMeta);

      if (isDemoMode(normalizedConfig)) {
        prepareDemoStudents(normalizedConfig);
      } else {
        await ensureStudentsFromAppData(normalizedConfig, {
          authService: this._authService,
          logger: log,
          formatError: formatError,
        });
      }

      // Same shape as a REFRESH from the frontend - the handler reads nothing else from it, and
      // the session config it needs was just registered above.
      await this._handleFetchData({
        id: identifier,
        sessionId,
        reason: "post-init-auto-fetch",
        backgroundRefresh: normalizedConfig.backgroundRefresh,
      });
    } catch (error) {
      this._loggerFor(identifier)("error", null, `[CONFIGURE] Initialization failed: ${formatError(error)}`);
      this._emitInitError(
        {
          errors: [error.message || "Unknown initialization error"],
          warnings: [],
          severity: "ERROR",
          message: "Module initialization failed",
        },
        { identifier: identifier || "unknown", sessionId: payload?.sessionId },
      );
    }
  },

  _emitInitSuccess(normalizedConfig, identifier, sessionId, validationWarnings, validationWarningMeta = []) {
    const warnings = mergeUniqueWarnings(validationWarnings, this._pluginWarnings || []);
    const metaByMessage = createWarningMetaMap(validationWarningMeta);
    buildWarningMetaEntries(warnings, { kind: "config", severity: "warning" }).forEach((entry) => {
      if (!metaByMessage.has(entry.message)) metaByMessage.set(entry.message, entry);
    });

    this._emitModuleInitialized(
      {
        config: normalizedConfig,
        warnings,
        warningMeta: buildWarningMetaList(warnings, metaByMessage),
        students: normalizedConfig.students || [],
        plugins: buildFrontendPluginRegistry(normalizedConfig, this._pluginHost, __dirname),
      },
      { identifier, sessionId },
    );
  },

  // ---------------------------------------------------------------------------------------------
  // Demo mode
  // ---------------------------------------------------------------------------------------------

  /**
   * Demo mode replaces the WebUntis fetch: emit the fixtures as regular DATA_UPDATEs, each with
   * the per-student config a live payload carries (see lib/demoData.js).
   */
  _emitDemoData(config, route) {
    // The fixtures were checked at CONFIGURE; failing now means one was changed or removed since.
    let payloads;
    try {
      payloads = buildDemoPayloads(config, __dirname);
    } catch (error) {
      this._loggerFor(route.identifier)("error", null, `[DEMO] Cannot read the demo fixtures: ${formatError(error)}`);
      return;
    }
    payloads.forEach((payload) => {
      this._emitGotData({ ...payload, id: route.identifier }, route);
    });
    this._loggerFor(route.identifier)(
      "debug",
      null,
      `[DEMO] Emitted ${payloads.length} demo payload(s) for ${route.identifier}`,
    );
  },

  // ---------------------------------------------------------------------------------------------
  // SESSION_STATE / REFRESH
  // ---------------------------------------------------------------------------------------------

  /**
   * Track frontend visibility per session (suspend/resume). The flag is bookkeeping plus a
   * fetch gate for frontends that disabled background refresh.
   */
  _handleSessionState(payload = {}) {
    this._ensureRuntime();
    const { identifier, sessionId, sessionKey } = buildRouteMeta(payload);
    const state = payload.state === "active" ? "active" : "paused";

    // Counts as frontend contact, so a hidden-but-refreshing session does not age out.
    this._sessions.touch(sessionKey);
    this._sessions.setPaused(sessionKey, state === "paused");
    this._loggerFor(identifier)(
      "debug",
      null,
      `[SESSION_STATE] ${state} (id=${identifier}, session=${sessionId}, reason=${payload.reason || "unspecified"})`,
    );
  },

  /**
   * Handle REFRESH - data refresh for an initialized session.
   * Self-healing: if the backend restarted and does not know the session, CONFIGURE is re-run
   * via an INIT_REQUIRED event. A REFRESH that overlaps a running init waits for it.
   */
  async _handleFetchData(payload) {
    this._ensureRuntime();
    const { identifier, sessionId, sessionKey } = buildRouteMeta(payload);
    const fetchReason = payload?.reason || "unspecified";
    const log = this._loggerFor(identifier);

    log("debug", null, `[REFRESH] Received (id=${identifier}, session=${sessionId}, reason=${fetchReason})`);
    this._sessions.touch(sessionKey);

    // A hidden session may still ask for data: the shared frontend lifecycle keeps
    // refreshing in the background so the view is warm when it becomes visible.
    // Only a frontend that explicitly opted out of background refresh is gated here.
    if (this._sessions.isPaused(sessionKey) && payload?.backgroundRefresh === false) {
      log(
        "debug",
        null,
        `[REFRESH] Ignored for paused session (id=${identifier}, session=${sessionId}, reason=${fetchReason})`,
      );
      return;
    }

    const inFlightInit = this._initInFlightBySession.get(sessionKey);
    if (inFlightInit && fetchReason !== "post-init-auto-fetch") {
      log("debug", null, `[REFRESH] Waiting for running init of session ${sessionKey}`);
      await inFlightInit.catch(() => {});
    }

    let config = this._sessions.getOrCreateSessionConfig(sessionKey);
    if (!config) {
      // The helper has no config for this session - it was restarted while the frontend kept
      // running. REFRESH no longer carries the full config, so ask the frontend to redo the
      // CONFIGURE handshake instead of re-initializing from this payload.
      log("warn", null, `[REFRESH] ${identifier} not initialized for session ${sessionId}; requesting CONFIGURE`);
      this._emitInitRequired(
        { id: identifier, sessionId, reason: "session-config-missing" },
        { identifier, sessionId },
      );
      return;
    }

    // Session-specific debugDate override (testing)
    if (payload.debugDate !== undefined) {
      config = { ...config, debugDate: payload.debugDate };
      this._sessions.setSessionConfig(sessionKey, config);
      if (payload.debugDate)
        log("debug", null, `[REFRESH] Updated debugDate="${payload.debugDate}" (session=${sessionKey})`);
    }

    if (isDemoMode(config)) {
      this._emitDemoData(config, { identifier, sessionId });
      return;
    }

    await this._executeFetchForSession(sessionKey);
  },

  /**
   * Group the session's students by credential key and process each group.
   * Groups sharing credentials with an in-flight fetch (other session or instance) wait for it:
   * they share one WebUntis session and would only race each other.
   */
  async _executeFetchForSession(sessionKey) {
    const log = this._loggerFor(parseSessionKey(sessionKey).identifier);
    const config = this._sessions.getOrCreateSessionConfig(sessionKey);
    if (!config) {
      log("warn", null, `Session ${sessionKey} not found, skipping fetch`);
      return;
    }

    try {
      const groups = new Map();
      (Array.isArray(config.students) ? config.students : []).forEach((student) => {
        const credKey = getCredentialKey(student, config);
        if (!groups.has(credKey)) groups.set(credKey, []);
        groups.get(credKey).push(student);
      });

      for (const [credKey, students] of groups.entries()) {
        // Queue behind whatever runs for this account. Chaining (instead of awaiting the running
        // fetch once) keeps two waiting sessions from starting at the same time.
        const previous = this._pendingFetchByCredKey.get(credKey);
        if (previous) {
          log("debug", null, `Session ${sessionKey}: waiting for running fetch of credKey=${credKey}`);
        }
        const run = (previous || Promise.resolve())
          .catch(() => {})
          .then(() => this._processGroup(credKey, students, sessionKey, config));
        this._pendingFetchByCredKey.set(credKey, run);
        try {
          await run;
        } finally {
          if (this._pendingFetchByCredKey.get(credKey) === run) this._pendingFetchByCredKey.delete(credKey);
        }
      }
    } catch (error) {
      log("error", null, `Error loading Untis data for session ${sessionKey}: ${formatError(error)}`);
    }
  },

  // ---------------------------------------------------------------------------------------------
  // Fetch per credential group
  // ---------------------------------------------------------------------------------------------

  /**
   * Authenticate once per credential group, fetch every student of the group and emit one
   * DATA_UPDATE per student. Failures are converted into warning-bearing payloads so the
   * frontend always learns about them.
   */
  async _processGroup(credKey, students, sessionKey, config) {
    const { identifier, sessionId } = parseSessionKey(sessionKey);
    const warningsState = createGroupWarningCollector();
    const sample = students[0];

    let authSession;
    try {
      authSession = await createAuthSession(this._authService, sample, config, credKey);
    } catch (err) {
      this._handleGroupAuthFailure({
        err,
        credKey,
        identifier,
        sessionKey,
        sessionId,
        students,
        config,
        warningsState,
      });
      return;
    }

    const { fetchTimegrid: wantsHolidays } = buildFetchFlags(config, this._pluginHost);
    const compactHolidays = wantsHolidays ? extractHolidaysFromAppData(authSession.appData) : [];

    for (const student of students) {
      let payload;
      try {
        payload = await this._fetchStudentPayload({
          student,
          authSession,
          identifier,
          credKey,
          compactHolidays,
          config,
          sessionKey,
          warningsState,
        });
      } catch (err) {
        payload = this._buildStudentFetchFailurePayload({
          err,
          student,
          identifier,
          sessionId,
          sessionKey,
          config,
          warningsState,
        });
      }
      if (payload) this._emitGotData(payload, { identifier, sessionId });
    }
  },

  _handleGroupAuthFailure({ err, credKey, identifier, sessionKey, sessionId, students, config, warningsState }) {
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
    students.forEach((student) => {
      this._emitGotData(
        this._buildErrorPayload({
          identifier,
          sessionId,
          student,
          config,
          apiStatus: null,
          apiRecords: this._apiStatus.getRecords(sessionKey),
          warnings: warningsState.groupWarnings,
          warningMetaByMessage: warningsState.groupWarningMetaByMessage,
          warningFallbackMeta: { kind: "generic", severity: "warning" },
        }),
      );
    });
  },

  async _fetchStudentPayload({
    student,
    authSession,
    identifier,
    credKey,
    compactHolidays,
    config,
    sessionKey,
    warningsState,
  }) {
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
      sessionKey,
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

  _buildStudentFetchFailurePayload({ err, student, identifier, sessionId, sessionKey, config, warningsState }) {
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
      sessionId,
      student,
      config,
      apiStatus: this._apiStatus.buildSnapshot(sessionKey),
      apiRecords: this._apiStatus.getRecords(sessionKey),
      warnings: mergeUniqueWarnings(warningsState.groupWarnings, warningMsg),
      warningMetaByMessage: warningsState.groupWarningMetaByMessage,
      warningFallbackMeta: classifyWarningMetaFromError(err),
    });
  },

  _buildErrorPayload({
    identifier,
    sessionId,
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
      sessionId,
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
