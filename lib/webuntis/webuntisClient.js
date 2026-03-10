const webuntisApiService = require('./webuntisApiService');
const AuthService = require('./authService');
const CacheManager = require('./cacheManager');
const errorHandler = require('./errorHandler');
const { stripAllHtml, normalizeDateToInteger, normalizeTimeToHHMM } = require('./dataOrchestration');
const { orchestrateFetch } = require('./dataFetchOrchestrator');
const { mapBundleToMmmPayload } = require('../webuntis-client/mmmPayloadMapper');

class WebUntisClient {
  constructor(options = {}) {
    this.mmLog = options.mmLog;
    this.formatErr = options.formatErr || WebUntisClient.formatError;
    this.extractTimegridFromTimetable = options.extractTimegridFromTimetable;
    this.compactTimegrid = options.compactTimegrid;
    this.checkEmptyDataWarning = options.checkEmptyDataWarning || WebUntisClient.checkEmptyDataWarning;
    this.cleanupOldDebugDumps = options.cleanupOldDebugDumps;
    this.getApiStatus = options.getApiStatus;
    this.shouldSkipApi = options.shouldSkipApi;
    this.recordApiStatusFromError = options.recordApiStatusFromError;
    this.setApiStatus = options.setApiStatus;
    this.cacheManager =
      options.cacheManager ||
      new CacheManager((level, message) => {
        if (this.mmLog) {
          this.mmLog(level, null, message);
        }
      });
  }

  static createAuthService(options = {}) {
    return new AuthService(options);
  }

  static formatError(err) {
    return errorHandler.formatError(err);
  }

  static convertRestErrorToWarning(error, context = {}) {
    return errorHandler.convertRestErrorToWarning(error, context);
  }

  static checkEmptyDataWarning(dataArray, dataType, studentTitle, isExpectedData = true) {
    return errorHandler.checkEmptyDataWarning(dataArray, dataType, studentTitle, isExpectedData);
  }

  static stripAllHtml(text, preserveLineBreaks = true) {
    return stripAllHtml(text, preserveLineBreaks);
  }

  static normalizeDateToInteger(date) {
    return normalizeDateToInteger(date);
  }

  static normalizeTimeToHHMM(time) {
    return normalizeTimeToHHMM(time);
  }

  _getStandardAuthOptions(additionalOptions = {}) {
    return {
      ...additionalOptions,
      mmLog: this.mmLog,
      formatErr: this.formatErr,
    };
  }

  _callRest(fn, authCtx, sessionCtx, logCtx, flagsCtx, ...args) {
    return fn.call(this, authCtx, sessionCtx, logCtx, flagsCtx, ...args);
  }

  _shouldSkipApi(sessionKey, endpoint) {
    if (typeof this.shouldSkipApi === 'function') {
      return this.shouldSkipApi(sessionKey, endpoint);
    }
    return false;
  }

  _recordApiStatusFromError(sessionKey, endpoint, err) {
    if (typeof this.recordApiStatusFromError === 'function') {
      this.recordApiStatusFromError(sessionKey, endpoint, err);
    }
  }

  _setApiStatus(sessionKey, endpoint, status) {
    if (typeof this.setApiStatus === 'function') {
      this.setApiStatus(sessionKey, endpoint, status);
    }
  }

  _extractRestRequestContext(authCtx, sessionCtx, logCtx, flagsCtx) {
    const { sessionKey, authRefreshTracker } = sessionCtx || {};
    const { debugApi, dumpRawApiResponses } = flagsCtx || {};
    const { authService, qrCodeUrl, cacheKey, school, server, username, password } = authCtx || {};
    const effectiveCacheKey = cacheKey || `user:${username}@${server}/${school}`;
    const mmLog = logCtx?.mmLog || this.mmLog;
    const authOptions = this._getStandardAuthOptions({ cacheKey: effectiveCacheKey });

    return {
      sessionKey,
      authRefreshTracker,
      debugApi,
      dumpRawApiResponses,
      authService,
      qrCodeUrl,
      school,
      server,
      username,
      password,
      effectiveCacheKey,
      mmLog,
      authOptions,
    };
  }

  _buildRestAuthHandlers(restCtx) {
    const { authService, qrCodeUrl, effectiveCacheKey, school, server, username, password, authOptions, authRefreshTracker } = restCtx;

    return {
      getAuth: () =>
        qrCodeUrl
          ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: effectiveCacheKey })
          : authService.getAuth({
              school,
              username,
              password,
              server,
              options: authOptions,
            }),
      onAuthError: () => {
        if (authRefreshTracker) authRefreshTracker.refreshed = true;
        return authService.invalidateCache(effectiveCacheKey);
      },
    };
  }

  async _executeRestEndpoint(endpoint, restCtx, executeRequest) {
    const { sessionKey, mmLog, authService } = restCtx;

    if (sessionKey && this._shouldSkipApi(sessionKey, endpoint)) {
      const record = this.getApiStatus?.(sessionKey)?.[endpoint];
      const prevStatus = typeof record === 'object' ? record.status : record;
      mmLog('debug', null, `[${endpoint}] Skipping API call due to previous status ${prevStatus} (permanent error)`);
      return [];
    }

    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }

    let response;
    try {
      response = await executeRequest();
    } catch (err) {
      if (sessionKey) this._recordApiStatusFromError(sessionKey, endpoint, err);

      // 403 Forbidden: endpoint not available (school hasn't licensed this feature)
      // Handle gracefully instead of throwing — return empty array and let skip logic handle future calls
      const httpStatus = err?.status || err?.response?.status;
      if (httpStatus === 403) {
        mmLog(
          'info',
          null,
          `[${endpoint}] HTTP 403 — endpoint not available (school may not have licensed this feature). Skipping in future cycles.`
        );
        return [];
      }

      throw err;
    }

    if (sessionKey && response.status) {
      this._setApiStatus(sessionKey, endpoint, response.status);
    }

    return response.data;
  }

  async _invokeRestEndpoint(endpoint, authCtx, sessionCtx, logCtx, flagsCtx, requestBuilder) {
    const restCtx = this._extractRestRequestContext(authCtx, sessionCtx, logCtx, flagsCtx);
    const { debugApi, dumpRawApiResponses, server } = restCtx;
    const authContext = this._buildRestAuthHandlers(restCtx);

    return this._executeRestEndpoint(endpoint, restCtx, () =>
      requestBuilder({
        server,
        authContext,
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      })
    );
  }

  _collectClassCandidates(data) {
    const candidates = new Map();

    const addCandidate = (classObj) => {
      if (!classObj || typeof classObj !== 'object') return;
      if (!classObj.id) return;

      const name = classObj.shortName || classObj.displayName || classObj.name || classObj.longName;
      if (!name) return;

      if (!candidates.has(classObj.id)) {
        candidates.set(classObj.id, {
          id: classObj.id,
          name,
          shortName: classObj.shortName || classObj.displayName || name,
          longName: classObj.longName || name,
        });
      }
    };

    if (data?.classes && Array.isArray(data.classes)) {
      data.classes.forEach((item) => {
        if (item.class) {
          addCandidate(item.class);
        }
      });
    }

    const classArray = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : null;
    if (classArray) {
      classArray.forEach((item) => {
        const type = (item.resourceType || item.elementType || item.type || '').toString().toUpperCase();
        if (!type || type === 'CLASS') {
          addCandidate(item);
        }
      });
    }

    if (data?.id && (data.shortName || data.longName || data.displayName)) {
      addCandidate(data);
    }

    return Array.from(candidates.values());
  }

  _formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _formatDateInt(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  _buildClassCacheKey(cacheKeyBase, role, studentId, desiredName) {
    const roleKey = String(role || 'unknown').toLowerCase();
    const studentKey = studentId ? `student${studentId}` : 'nostudent';
    const nameKey = (desiredName || 'auto').toLowerCase();
    return `${cacheKeyBase}::class::${roleKey}::${studentKey}::${nameKey}`;
  }

  _buildAuthResolver(authCtx, cacheKeyBase) {
    const { school, username, password, server, qrCodeUrl, authService } = authCtx;
    const authOptions = this._getStandardAuthOptions({ cacheKey: cacheKeyBase });
    return () =>
      qrCodeUrl
        ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: cacheKeyBase })
        : authService.getAuth({
            school,
            username,
            password,
            server,
            options: authOptions,
          });
  }

  async _fetchParentClassCandidates(authCtx, getAuth, rangeStart, rangeEnd, studentId, role) {
    const { server } = authCtx;
    this.mmLog(
      'debug',
      null,
      `[REST] Parent account detected (role=${role}): fetching class information via classservices (studentId=${studentId})`
    );

    try {
      const startDate = this._formatDateInt(rangeStart);
      const endDate = this._formatDateInt(rangeEnd);
      this.mmLog(
        'debug',
        null,
        `[REST] classservices API: https://${server}/WebUntis/api/classreg/classservices?startDate=${startDate}&endDate=${endDate}&elementId=${studentId}`
      );

      const data = await webuntisApiService.getClassServices({
        getAuth,
        server,
        startDate,
        endDate,
        studentId,
        logger: this.mmLog,
      });

      if (!data) {
        return { candidates: [], preSelectedClassId: null };
      }

      const candidates = this._collectClassCandidates(data);
      let preSelectedClassId = null;
      const map = data?.personKlasseMap || data?.data?.personKlasseMap;

      if (map && typeof map === 'object') {
        const mapSummary = Object.entries(map)
          .map(([k, v]) => `${k}→${v}`)
          .join(', ');
        this.mmLog('debug', null, `[REST] personKlasseMap: ${mapSummary}`);
        const mappedClassId = map[String(studentId)];
        if (mappedClassId) {
          preSelectedClassId = Number(mappedClassId);
          this.mmLog('info', null, `[REST] personKlasseMap: studentId ${studentId} → classId ${preSelectedClassId}`);
        } else {
          this.mmLog('warn', null, `[REST] personKlasseMap: studentId ${studentId} not found in map`);
        }
      }

      this.mmLog('debug', null, `[REST] classservices returned ${candidates.length} class candidates`);
      return { candidates, preSelectedClassId };
    } catch (err) {
      this.mmLog('debug', null, `[REST] classservices error: ${this.formatErr(err)}`);
      return { candidates: [], preSelectedClassId: null };
    }
  }

  async _fetchStandardClassCandidates(authCtx, getAuth, rangeStart, rangeEnd, role) {
    const { server } = authCtx;
    this.mmLog(
      'debug',
      null,
      `[REST] Student/Teacher account (role=${role || 'unknown'}): fetching class information via timetable/filter`
    );

    try {
      const start = this._formatDateISO(rangeStart);
      const end = this._formatDateISO(rangeEnd);
      this.mmLog(
        'debug',
        null,
        `[REST] timetable/filter API: https://${server}/WebUntis/api/rest/view/v1/timetable/filter?resourceType=CLASS&timetableType=STANDARD&start=${start}&end=${end}`
      );

      const data = await webuntisApiService.getTimetableFilterClasses({
        getAuth,
        server,
        start,
        end,
        logger: this.mmLog,
      });

      if (!data) {
        return { candidates: [], preSelectedClassId: null };
      }

      const candidates = this._collectClassCandidates(data);
      let preSelectedClassId = null;
      const preSelected = data?.preSelected || data?.data?.preSelected;
      if (preSelected && preSelected.id) {
        preSelectedClassId = Number(preSelected.id);
        this.mmLog(
          'info',
          null,
          `[REST] preSelected class detected: ${preSelected.displayName || preSelected.shortName || preSelected.longName} (id=${preSelectedClassId})`
        );
      }

      this.mmLog('debug', null, `[REST] timetable/filter returned ${candidates.length} class candidates`);
      return { candidates, preSelectedClassId };
    } catch (err) {
      this.mmLog('debug', null, `[REST] timetable/filter error: ${this.formatErr(err)}`);
      return { candidates: [], preSelectedClassId: null };
    }
  }

  _selectClassCandidate(candidates, preSelectedClassId, desiredName, isParentAccount) {
    let chosen = null;

    if (preSelectedClassId) {
      if (candidates.some((c) => Number(c.id) === Number(preSelectedClassId))) {
        chosen = candidates.find((c) => Number(c.id) === Number(preSelectedClassId));
        const source = isParentAccount ? 'personKlasseMap' : 'preSelected';
        this.mmLog('info', null, `[REST] ✓ ${source} class: ${chosen.name} (classId=${preSelectedClassId})`);
      } else {
        this.mmLog('warn', null, `[REST] preSelected/mapped classId=${preSelectedClassId} not found in candidates`);
      }
    }

    if (!chosen && desiredName) {
      const desiredLower = desiredName.toLowerCase();
      chosen = candidates.find((c) =>
        [c.name, c.shortName, c.longName].filter(Boolean).some((n) => String(n).toLowerCase() === desiredLower)
      );
      if (chosen) {
        this.mmLog('info', null, `[REST] ✓ Matched className="${desiredName}" to classId=${chosen.id} (${chosen.name})`);
      } else {
        this.mmLog('warn', null, `[REST] className="${desiredName}" not found in candidates`);
      }
    }

    if (!chosen && !desiredName && candidates.length === 1) {
      chosen = candidates[0];
      this.mmLog('info', null, `[REST] ✓ Auto-selected sole available class ${chosen.name} (classId=${chosen.id})`);
    }

    if (!chosen) {
      const available = candidates
        .map((c) => `${c.name || c.shortName || c.longName || c.id}`)
        .filter(Boolean)
        .join(', ');
      const hint = desiredName ? `Class "${desiredName}" not found. Available: ${available}` : `Multiple classes available: ${available}`;
      throw new Error(hint);
    }

    return chosen;
  }

  async _resolveClassIdViaRest(authCtx, sessionCtx, rangeStart, rangeEnd, className, role, options = {}) {
    const { cacheKey, authService, username, server, school } = authCtx || {};
    const desiredName = className && String(className).trim();
    const studentId = options?.studentId;
    const cacheKeyBase = cacheKey || `user:${username || 'session'}@${server || school || 'default'}`;
    const classCacheKey = this._buildClassCacheKey(cacheKeyBase, role, studentId, desiredName);
    if (this.cacheManager.has('classId', classCacheKey)) {
      return this.cacheManager.get('classId', classCacheKey);
    }

    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }
    const getAuth = this._buildAuthResolver(authCtx, cacheKeyBase);

    let candidates;
    let preSelectedClassId;

    const normalizedRole = role
      ? String(role)
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, '_')
      : '';
    const parentRoles = new Set(['LEGAL_GUARDIAN', 'ROLE_LEGAL_GUARDIAN', 'GUARDIAN', 'PARENT', 'ELTERN']);
    const isParentAccount = parentRoles.has(normalizedRole);

    if (isParentAccount && studentId) {
      ({ candidates, preSelectedClassId } = await this._fetchParentClassCandidates(
        authCtx,
        getAuth,
        rangeStart,
        rangeEnd,
        studentId,
        role
      ));
    } else {
      ({ candidates, preSelectedClassId } = await this._fetchStandardClassCandidates(authCtx, getAuth, rangeStart, rangeEnd, role));
    }

    if (!candidates || candidates.length === 0) {
      throw new Error('No accessible classes returned by REST API');
    }

    const chosen = this._selectClassCandidate(candidates, preSelectedClassId, desiredName, isParentAccount);

    this.cacheManager.set('classId', classCacheKey, chosen.id, 24 * 60 * 60 * 1000);
    return chosen.id;
  }

  async _getTimetableViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId, options = {}) {
    const wantsClass = Boolean(options.useClassTimetable);
    let classId = options.classId;
    const role = options.role || sessionCtx?.authSession?.role || null;
    const className = options.className || null;
    const resourceType = options.resourceType || null;
    if (wantsClass && !classId) {
      classId = await this._resolveClassIdViaRest(authCtx, sessionCtx, rangeStart, rangeEnd, className, role, {
        ...options,
        personId,
        studentId: options.studentId || personId,
      });
    }

    return this._invokeRestEndpoint('timetable', authCtx, sessionCtx, logCtx, flagsCtx, ({ server, authContext, debugApi, dumpRaw }) =>
      webuntisApiService.getTimetable({
        authContext,
        server,
        rangeStart,
        rangeEnd,
        personId,
        useClassTimetable: wantsClass,
        classId,
        resourceType,
        logger: this.mmLog,
        debugApi,
        dumpRaw,
      })
    );
  }

  async _getExamsViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    return this._invokeRestEndpoint('exams', authCtx, sessionCtx, logCtx, flagsCtx, ({ server, authContext, debugApi, dumpRaw }) =>
      webuntisApiService.getExams({
        authContext,
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this.mmLog,
        normalizeDate: WebUntisClient.normalizeDateToInteger,
        normalizeTime: WebUntisClient.normalizeTimeToHHMM,
        sanitizeHtml: WebUntisClient.stripAllHtml,
        debugApi,
        dumpRaw,
      })
    );
  }

  async _getHomeworkViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    return this._invokeRestEndpoint('homework', authCtx, sessionCtx, logCtx, flagsCtx, ({ server, authContext, debugApi, dumpRaw }) =>
      webuntisApiService.getHomework({
        authContext,
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this.mmLog,
        debugApi,
        dumpRaw,
      })
    );
  }

  async _getAbsencesViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    return this._invokeRestEndpoint('absences', authCtx, sessionCtx, logCtx, flagsCtx, ({ server, authContext, debugApi, dumpRaw }) =>
      webuntisApiService.getAbsences({
        authContext,
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this.mmLog,
        debugApi,
        dumpRaw,
      })
    );
  }

  async _getMessagesOfDayViaRest(authCtx, sessionCtx, logCtx, flagsCtx, date) {
    return this._invokeRestEndpoint('messagesOfDay', authCtx, sessionCtx, logCtx, flagsCtx, ({ server, authContext, debugApi, dumpRaw }) =>
      webuntisApiService.getMessagesOfDay({
        authContext,
        server,
        date,
        logger: this.mmLog,
        debugApi,
        dumpRaw,
      })
    );
  }

  _createLogger(student) {
    return (...args) => {
      if (args.length >= 3 && typeof args[0] === 'string' && typeof args[2] === 'string') {
        const [level, studentCtx, message] = args;
        this.mmLog(level || 'debug', studentCtx || student, message);
        return;
      }

      if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
        const [level, message] = args;
        this.mmLog(level || 'debug', student, message);
        return;
      }

      const [msg] = args;
      this.mmLog('debug', student, typeof msg === 'string' ? msg : JSON.stringify(msg));
    };
  }

  _logEmptyTargets(student, config, appData) {
    const hasQrCode = Boolean(student.qrcode);
    const hasStudentCreds = Boolean(student.username && student.password && student.school && student.server);
    const hasPartialStudentCreds = Boolean(student.username || student.password || student.school || student.server);
    const hasParentCreds = Boolean(config?.username && config?.password);
    const hasStudentId = Boolean(student.studentId && Number.isFinite(Number(student.studentId)));
    const linkedChildren = Array.isArray(appData?.user?.students) ? appData.user.students : [];
    const emptyStringCreds = student.username === '' || student.password === '';

    let hint = 'Check authentication and credentials.';
    if (emptyStringCreds) {
      hint = 'Student credentials are empty strings - remove username/password fields or provide valid credentials.';
    } else if (hasPartialStudentCreds && !hasStudentCreds) {
      hint = 'Student credentials are incomplete. Need username, password, school, and server together for direct student login.';
    } else if (!hasQrCode && !hasStudentCreds && !hasParentCreds) {
      hint =
        'No credentials configured. Need either: (1) student.qrcode, (2) student username/password/school/server, or (3) config-level username/password with student.studentId.';
    } else if (hasParentCreds && !hasStudentId && linkedChildren.length > 1) {
      hint =
        'Parent credentials configured, but multiple linked children were found. Configure student.studentId or set student.title to the exact child display name.';
    } else if (hasParentCreds && !hasStudentId) {
      hint = 'Parent credentials configured but student.studentId is missing (required for parent mode).';
    } else if (hasParentCreds && hasStudentId && (!appData || !appData.user || !appData.user.students)) {
      hint =
        'Parent credentials configured but appData.user.students is empty/missing (check if parent account has linked children in WebUntis).';
    }

    this.mmLog('warn', student, `No REST targets built - cannot fetch data! ${hint}`);
  }

  /**
   * Core fetch pipeline that returns neutral fetched data.
   * No MMM adapter context (module id, config, warnings set) is returned here.
   */
  async fetchBundle(request) {
    const { authSession, student, credKey, compactHolidays = [], config, sessionKey, currentFetchWarnings, plan } = request;

    const requestPlan = plan || {};
    const {
      authService: requestAuthService,
      baseNow: requestBaseNow,
      dateRanges: requestDateRanges,
      fetchFlags: requestFetchFlags,
      homeworkFilter: requestHomeworkFilter,
      flagsCtx: requestFlagsCtx,
    } = requestPlan;

    const logger = this._createLogger(student);
    const logCtx = {
      logger,
      mmLog: this.mmLog,
      formatErr: this.formatErr,
    };

    const authRefreshTracker = { refreshed: false };
    const authService = requestAuthService;
    if (!authService) {
      throw new Error('AuthService not provided');
    }
    if (!requestFetchFlags || typeof requestFetchFlags !== 'object') {
      throw new Error('fetchFlags must be provided by caller');
    }
    if (!requestDateRanges || typeof requestDateRanges !== 'object') {
      throw new Error('dateRanges must be provided by caller');
    }
    if (!(requestBaseNow instanceof Date) || Number.isNaN(requestBaseNow.getTime())) {
      throw new Error('baseNow must be a valid Date provided by caller');
    }
    if (!requestFlagsCtx || typeof requestFlagsCtx !== 'object') {
      throw new Error('flagsCtx must be provided by caller');
    }

    const homeworkFilter = {
      pastDays: Number(requestHomeworkFilter?.pastDays ?? 0),
      nextDays: Number(requestHomeworkFilter?.nextDays ?? 999),
    };

    const authCtx = {
      authService,
      cacheKey: credKey,
      qrCodeUrl: authSession.qrCodeUrl || null,
      school: authSession.school,
      server: authSession.server,
      username: authSession.username || null,
      password: authSession.password || null,
    };

    const sessionCtx = {
      sessionKey,
      authRefreshTracker,
      authSession,
    };

    const flagsCtx = requestFlagsCtx;

    const { school, server } = authSession;
    const ownPersonId = authSession.personId;
    const bearerToken = authSession.token;
    const appData = authSession.appData;
    const role = authSession.role || null;
    const restTargets = authService.buildRestTargets(student, config, school, server, ownPersonId, bearerToken, appData, role);

    if (restTargets && restTargets.length > 0) {
      const targetSummaries = restTargets.map((target) => {
        const roleLabel = target.role || 'unknown';
        const personIdLabel = target.personId ? `personId=${target.personId}` : 'personId=null';
        const serverLabel = target.server || 'unknown-server';
        return `${roleLabel} (${personIdLabel}, ${serverLabel})`;
      });
      this.mmLog('debug', student, `REST targets: ${targetSummaries.join(', ')}`);
    }

    if (!restTargets || restTargets.length === 0) {
      this._logEmptyTargets(student, config, appData);
    }

    const fetchFlags = requestFetchFlags;
    const baseNow = requestBaseNow;
    const todayYmd = baseNow.getFullYear() * 10000 + (baseNow.getMonth() + 1) * 100 + baseNow.getDate();
    const dateRanges = requestDateRanges;

    const fetchTimegrid = Boolean(fetchFlags.fetchTimegrid);
    const fetchTimetable = Boolean(fetchFlags.fetchTimetable);
    const fetchExams = Boolean(fetchFlags.fetchExams);
    const fetchHomeworks = Boolean(fetchFlags.fetchHomeworks);
    const fetchAbsences = Boolean(fetchFlags.fetchAbsences);
    const fetchMessagesOfDay = Boolean(fetchFlags.fetchMessagesOfDay);

    let grid = [];
    if (authSession?.appData?.currentSchoolYear?.timeGrid?.units) {
      const units = authSession.appData.currentSchoolYear.timeGrid.units;
      if (Array.isArray(units) && units.length > 0) {
        grid = units.map((unit) => ({
          name: String(unit.unitOfDay || unit.period || ''),
          startTime: unit.startTime || 0,
          endTime: unit.endTime || 0,
        }));
      }
    }

    const fetchResults = await orchestrateFetch({
      student,
      dateRanges,
      baseNow,
      homeworkFilter,
      restTargets,
      contexts: {
        authCtx,
        sessionCtx,
        logCtx,
        flagsCtx,
      },
      fetchFlags: {
        fetchTimetable,
        fetchExams,
        fetchHomeworks,
        fetchAbsences,
        fetchMessagesOfDay,
      },
      restFns: {
        callRest: this._callRest.bind(this),
        getTimetableViaRest: this._getTimetableViaRest.bind(this),
        getExamsViaRest: this._getExamsViaRest.bind(this),
        getHomeworkViaRest: this._getHomeworkViaRest.bind(this),
        getAbsencesViaRest: this._getAbsencesViaRest.bind(this),
        getMessagesOfDayViaRest: this._getMessagesOfDayViaRest.bind(this),
      },
      logger: logCtx.logger,
      currentFetchWarnings,
    });

    const timetable = fetchResults.timetable;
    const rawExams = fetchResults.exams;
    const hwResult = fetchResults.homeworks;
    const rawAbsences = fetchResults.absences;
    const rawMessagesOfDay = fetchResults.messagesOfDay;

    if (fetchTimegrid && grid.length === 0 && timetable.length > 0) {
      grid = this.extractTimegridFromTimetable(timetable);
    }

    const findHolidayForDate = (ymd, holidays) => {
      if (!Array.isArray(holidays) || holidays.length === 0) return null;
      const dateNum = Number(ymd);
      return holidays.find((holiday) => Number(holiday.startDate) <= dateNum && dateNum <= Number(holiday.endDate)) || null;
    };

    const activeHoliday = findHolidayForDate(todayYmd, compactHolidays);

    return {
      dateRanges,
      todayYmd,
      activeHoliday,
      fetchFlags,
      apiStatus: this.getApiStatus(sessionKey),
      data: {
        grid,
        timetable,
        rawExams,
        hwResult,
        rawAbsences,
        rawMessagesOfDay,
      },
    };
  }

  /**
   * Compatibility adapter for MMM-Webuntis.
   * Keeps existing external behavior while delegating core work to fetchBundle.
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
  WebUntisClient,
};
