const NodeHelper = require('node_helper');
const Log = require('logger');
const shared = require('./lib/mmm-shared/mmm-shared');

const { AuthService, WebUntisClient, formatError, convertRestErrorToWarning, buildFetchPlan } = require('./lib/webuntisClient');
const { ApiStatusTracker } = require('./lib/apiStatusTracker');
const { SessionRegistry, buildRouteMeta, parseSessionKey, DEFAULT_IDENTIFIER, DEFAULT_SESSION_ID } = require('./lib/sessionRegistry');
const {
  buildEffectiveStudentConfig,
  buildFetchFlags,
  buildFrontendPluginRegistry,
  collectPluginValidationIssues,
  normalizeModuleConfig,
  validateNormalizedConfig,
} = require('./lib/moduleConfig');
const { createAuthSession, getCredentialKey } = require('./lib/authSession');
const { ensureStudentsFromAppData } = require('./lib/studentDiscovery');
const { extractHolidaysFromAppData } = require('./lib/webuntis/dataOrchestration');
const { buildStudentErrorPayload } = require('./lib/mmm-adapter/mmmPayloadMapper');
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
} = require('./lib/warningUtils');
const { initializeBackendPluginHost } = require('./lib/pluginHostBackend');
const { validateStudentCredentials } = require('./lib/widgetConfigValidator');

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
    this._mmLog('debug', null, 'Node helper started');
  },

  /**
   * Lazily create runtime state so the CLI wrapper and unit tests can drive handlers without
   * going through start().
   */
  _ensureRuntime() {
    if (this._runtimeReady) return;
    this._runtimeReady = true;

    const log = this._mmLog.bind(this);
    this.notifications = shared.buildNotifications('MMM-Webuntis');
    this._authService = new AuthService({ logger: (level, message) => log(level, null, `[lib] ${message}`) });
    this._apiStatus = new ApiStatusTracker({ logger: log });
    this._sessions = new SessionRegistry({ logger: log, onRelease: (sessionKey) => this._apiStatus.release(sessionKey) });
    this._client = new WebUntisClient({ mmLog: log, formatErr: this._formatErr.bind(this), apiStatus: this._apiStatus });
    this._pendingFetchByCredKey = new Map(); // credKey -> in-flight processGroup() promise
    this._pluginHost = initializeBackendPluginHost({ moduleRoot: __dirname, logger: log });
    this._pluginWarnings = Array.isArray(this._pluginHost?.warnings) ? this._pluginHost.warnings.slice() : [];
    this._pluginWarnings.forEach((warning) => {
      log('warn', null, warning);
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
        this._mmLog('debug', null, `Logout on shutdown failed: ${this._formatErr(error)}`);
      });
    }
    this._sessions?.clear();
    this._apiStatus?.clear();
    this._pendingFetchByCredKey?.clear();
    this._runtimeReady = false;
    this._mmLog('debug', null, 'Node helper stopped');
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
      this._mmLog('error', null, `[${action}] Unhandled failure: ${this._formatErr(error)}`);
    }
  },

  _emitGotData(payload, route = {}) {
    this._emitSocketNotification('DATA_UPDATE', payload, route, { preserveExistingRoute: false });
  },

  _emitInitError(payload, route = {}) {
    this._emitSocketNotification('MODULE_INIT_FAILED', payload, route, { preserveExistingRoute: true });
  },

  _emitModuleInitialized(payload, route = {}) {
    this._emitSocketNotification('MODULE_READY', payload, route, { preserveExistingRoute: true });
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
    if (!payload || typeof payload !== 'object') return;
    this._ensureRuntime();

    const { preserveExistingRoute = false } = options;
    const nextPayload = { ...payload };

    if (route.identifier && (!preserveExistingRoute || !nextPayload.id)) {
      nextPayload.id = route.identifier;
    }
    if (route.sessionId && (!preserveExistingRoute || !nextPayload.sessionId)) {
      nextPayload.sessionId = route.sessionId;
    }

    const isFailure = String(notification).includes('FAILED');
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
      })
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
   *   2. Register the session, auto-discover students if parent credentials are present
   *   3. Send MODULE_READY
   *   4. Run the first fetch automatically (no separate REFRESH needed)
   */
  async _handleInitModule(payload) {
    this._ensureRuntime();
    return this._runInitModule(payload);
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

      this._mmLog(
        'info',
        null,
        `[CONFIGURE] Received (id=${identifier}, session=${sessionId}, reason=${payload?.reason || 'unspecified'})`
      );
      this._sessions.storeInitConfig(sessionKey, normalizedConfig);
      if (normalizedConfig.debugDate) {
        this._mmLog('debug', null, `[CONFIGURE] Session debugDate="${normalizedConfig.debugDate}" (session-specific, not global)`);
      }

      const validation = validateNormalizedConfig(normalizedConfig, configWarnings, this._pluginHost);
      if (!validation.valid) {
        this._mmLog('error', null, `[CONFIGURE] Config validation failed for ${identifier}`);
        this._emitInitError(
          {
            errors: validation.errors,
            warnings: validation.warnings,
            warningMeta: validation.warningMeta,
            severity: 'ERROR',
            message: 'Configuration validation failed',
          },
          { identifier, sessionId }
        );
        return;
      }

      this._sessions.configsByIdentifier.set(identifier, normalizedConfig);
      normalizedConfig._authService = this._authService;

      await ensureStudentsFromAppData(normalizedConfig, {
        authService: this._authService,
        logger: this._mmLog.bind(this),
        formatError: this._formatErr.bind(this),
      });

      this._emitInitSuccess(normalizedConfig, identifier, sessionId, validation.warnings, validation.warningMeta);
      await this._handleFetchData({ ...normalizedConfig, id: identifier, sessionId, reason: 'post-init-auto-fetch' });
    } catch (error) {
      this._mmLog('error', null, `[CONFIGURE] Initialization failed: ${this._formatErr(error)}`);
      this._emitInitError(
        {
          errors: [error.message || 'Unknown initialization error'],
          warnings: [],
          severity: 'ERROR',
          message: 'Module initialization failed',
        },
        { identifier: identifier || 'unknown', sessionId: payload?.sessionId }
      );
    }
  },

  _emitInitSuccess(normalizedConfig, identifier, sessionId, validationWarnings, validationWarningMeta = []) {
    const warnings = mergeUniqueWarnings(validationWarnings, this._pluginWarnings || []);
    const metaByMessage = createWarningMetaMap(validationWarningMeta);
    buildWarningMetaEntries(warnings, { kind: 'config', severity: 'warning' }).forEach((entry) => {
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
      { identifier, sessionId }
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
    const state = payload.state === 'active' ? 'active' : 'paused';

    // Counts as frontend contact, so a hidden-but-refreshing session does not age out.
    this._sessions.touch(sessionKey);
    this._sessions.setPaused(sessionKey, state === 'paused');
    this._mmLog(
      'debug',
      null,
      `[SESSION_STATE] ${state} (id=${identifier}, session=${sessionId}, reason=${payload.reason || 'unspecified'})`
    );
  },

  /**
   * Handle REFRESH - data refresh for an initialized session.
   * Self-healing: if the backend restarted and does not know the session, CONFIGURE is re-run
   * from the incoming payload.
   */
  async _handleFetchData(payload) {
    this._ensureRuntime();
    const { identifier, sessionId, sessionKey } = buildRouteMeta(payload);
    const fetchReason = payload?.reason || 'unspecified';

    this._mmLog('debug', null, `[REFRESH] Received (id=${identifier}, session=${sessionId}, reason=${fetchReason})`);
    this._sessions.touch(sessionKey);

    // A hidden session may still ask for data: the shared frontend lifecycle keeps
    // refreshing in the background so the view is warm when it becomes visible.
    // Only a frontend that explicitly opted out of background refresh is gated here.
    if (this._sessions.isPaused(sessionKey) && payload?.backgroundRefresh === false) {
      this._mmLog('debug', null, `[REFRESH] Ignored for paused session (id=${identifier}, session=${sessionId}, reason=${fetchReason})`);
      return;
    }

    let config = this._sessions.getOrCreateSessionConfig(sessionKey);
    if (!config) {
      this._mmLog(
        'warn',
        null,
        `[REFRESH] Module ${identifier} not initialized for session ${sessionId} - attempting re-init from incoming payload`
      );
      await this._handleInitModule(payload);
      return;
    }

    // Session-specific debugDate override (testing)
    if (payload.debugDate !== undefined) {
      config = { ...config, debugDate: payload.debugDate };
      this._sessions.setSessionConfig(sessionKey, config);
      if (payload.debugDate) this._mmLog('debug', null, `[REFRESH] Updated debugDate="${payload.debugDate}" (session=${sessionKey})`);
    }

    await this._executeFetchForSession(sessionKey);
  },

  /**
   * Group the session's students by credential key and process each group.
   * Groups sharing credentials with an in-flight fetch (other session or instance) wait for it:
   * they share one WebUntis session and would only race each other.
   */
  async _executeFetchForSession(sessionKey) {
    const config = this._sessions.getOrCreateSessionConfig(sessionKey);
    if (!config) {
      this._mmLog('warn', null, `Session ${sessionKey} not found, skipping fetch`);
      return;
    }
    config._authService = this._authService;

    try {
      const groups = new Map();
      (Array.isArray(config.students) ? config.students : []).forEach((student) => {
        const credKey = getCredentialKey(student, config);
        if (!groups.has(credKey)) groups.set(credKey, []);
        groups.get(credKey).push(student);
      });

      for (const [credKey, students] of groups.entries()) {
        const pendingFetch = this._pendingFetchByCredKey.get(credKey);
        if (pendingFetch) {
          this._mmLog('debug', null, `Session ${sessionKey}: Another fetch is in progress for credKey=${credKey}, waiting...`);
          await pendingFetch.catch(() => {});
        }

        const inFlightFetch = this._processGroup(credKey, students, sessionKey, config);
        this._pendingFetchByCredKey.set(credKey, inFlightFetch);
        try {
          await inFlightFetch;
        } finally {
          if (this._pendingFetchByCredKey.get(credKey) === inFlightFetch) this._pendingFetchByCredKey.delete(credKey);
        }
      }
    } catch (error) {
      this._mmLog('error', null, `Error loading Untis data for session ${sessionKey}: ${this._formatErr(error)}`);
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
      this._handleGroupAuthFailure({ err, credKey, identifier, sessionId, students, config, warningsState });
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
        payload = this._buildStudentFetchFailurePayload({ err, student, identifier, sessionId, sessionKey, config, warningsState });
      }
      if (payload) this._emitGotData(payload, { identifier, sessionId });
    }
  },

  _handleGroupAuthFailure({ err, credKey, identifier, sessionId, students, config, warningsState }) {
    const errorMsg = this._formatErr(err);
    const networkFailure = isNetworkError(err);
    const msg = networkFailure
      ? `Cannot reach WebUntis server for ${credKey}: ${errorMsg}`
      : `Authentication failed for ${credKey}: ${errorMsg}`;
    this._mmLog('error', null, msg);

    // Only the failing credentials are forced to re-login; other accounts keep their sessions.
    if (this._authService?.invalidateCache(credKey)) {
      this._mmLog('warn', null, `[REAUTH] Forcing re-authentication for ${credKey} on the next fetch`);
    }

    warningsState.addGroupWarning(msg, classifyWarningMetaFromError(err, { kind: networkFailure ? 'network' : 'auth' }));
    students.forEach((student) => {
      this._emitGotData(
        this._buildErrorPayload({
          identifier,
          sessionId,
          student,
          config,
          apiStatus: null,
          warnings: warningsState.groupWarnings,
          warningMetaByMessage: warningsState.groupWarningMetaByMessage,
          warningFallbackMeta: { kind: 'generic', severity: 'warning' },
        })
      );
    });
  },

  async _fetchStudentPayload({ student, authSession, identifier, credKey, compactHolidays, config, sessionKey, warningsState }) {
    const studentWarnings = collectValidationWarnings(
      validateStudentCredentials(student),
      collectPluginValidationIssues(student, this._pluginHost).warnings
    );
    studentWarnings.forEach((warning) => {
      this._mmLog('warn', student, warning);
      warningsState.addGroupWarning(warning, { kind: 'config', severity: 'warning' });
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
    });

    if (!payload) {
      this._mmLog('warn', student, `fetchStudentData returned empty payload for ${student.title}`);
      return null;
    }
    return {
      ...mergeGroupWarningsIntoPayload(payload, warningsState.groupWarnings, warningsState.groupWarningMetaByMessage),
      id: identifier,
    };
  },

  _buildStudentFetchFailurePayload({ err, student, identifier, sessionId, sessionKey, config, warningsState }) {
    this._mmLog('error', student, `Error fetching data for ${student.title}: ${this._formatErr(err)}`);

    const warningMsg = convertRestErrorToWarning(err, {
      studentTitle: student.title,
      school: student.school || config?.school,
      server: student.server || config?.server || 'webuntis.com',
    });
    if (warningMsg) {
      warningsState.addGroupWarning(warningMsg, classifyWarningMetaFromError(err));
      this._mmLog('warn', student, warningMsg);
    }

    return this._buildErrorPayload({
      identifier,
      sessionId,
      student,
      config,
      apiStatus: this._apiStatus.buildSnapshot(sessionKey),
      warnings: mergeUniqueWarnings(warningsState.groupWarnings, warningMsg),
      warningMetaByMessage: warningsState.groupWarningMetaByMessage,
      warningFallbackMeta: classifyWarningMetaFromError(err),
    });
  },

  _buildErrorPayload({ identifier, sessionId, student, config, apiStatus, warnings, warningMetaByMessage, warningFallbackMeta }) {
    return buildStudentErrorPayload({
      identifier,
      sessionId,
      student,
      config,
      fetchFlags: buildFetchFlags(buildEffectiveStudentConfig(student, config), this._pluginHost),
      apiStatus: apiStatus || {},
      warnings,
      warningMetaByMessage,
      warningFallbackMeta,
    });
  },

  // ---------------------------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------------------------

  /**
   * Forward to MagicMirror's Log with an optional [student] tag. MagicMirror decides which
   * levels are emitted; nothing is filtered here.
   */
  _mmLog(level, student, message) {
    const studentTag = student?.title ? `[${String(student.title).trim()}] ` : '';
    const formatted = `${studentTag}${message}`;
    if (level === 'debug') return Log.debug(formatted);
    if (level === 'error') return Log.error(formatted);
    if (level === 'warn') return Log.warn(formatted);
    return Log.info(formatted);
  },

  _formatErr(err) {
    return formatError(err);
  },
});
