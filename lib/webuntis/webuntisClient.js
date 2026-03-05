const webuntisApiService = require('./webuntisApiService');
const AuthService = require('./authService');
const CacheManager = require('./cacheManager');
const errorHandler = require('./errorHandler');
const { calculateFetchRanges, stripAllHtml, normalizeDateToInteger, normalizeTimeToHHMM } = require('./dataOrchestration');
const { orchestrateFetch } = require('./dataFetchOrchestrator');
const { mapBundleToMmmPayload } = require('./mmmPayloadMapper');

class WebUntisClient {
  constructor(options = {}) {
    this.mmLog = options.mmLog;
    this.formatErr = options.formatErr || WebUntisClient.formatError;
    this.wantsWidget = options.wantsWidget;
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
      const prevStatus = this.getApiStatus?.(sessionKey)?.[endpoint];
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
      throw err;
    }

    if (sessionKey && response.status) {
      this._setApiStatus(sessionKey, endpoint, response.status);
    }

    return response.data;
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

  async _resolveClassIdViaRest(authCtx, sessionCtx, rangeStart, rangeEnd, className, role, options = {}) {
    const { school, username, password, server, qrCodeUrl, cacheKey, authService } = authCtx || {};
    const desiredName = className && String(className).trim();
    const studentId = options?.studentId;
    const cacheKeyBase = cacheKey || `user:${username || 'session'}@${server || school || 'default'}`;
    const roleKey = String(role || 'unknown').toLowerCase();
    const studentKey = studentId ? `student${studentId}` : 'nostudent';
    const classCacheKey = `${cacheKeyBase}::class::${roleKey}::${studentKey}::${(desiredName || 'auto').toLowerCase()}`;
    if (this.cacheManager.has('classId', classCacheKey)) {
      return this.cacheManager.get('classId', classCacheKey);
    }

    const formatDateISO = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const formatDateInt = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    };

    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }
    const authOptions = this._getStandardAuthOptions({ cacheKey: cacheKeyBase });

    let candidates = [];
    let preSelectedClassId = null;

    const normalizedRole = role ? String(role).toUpperCase() : '';
    const isParentAccount =
      normalizedRole.includes('LEGAL_GUARDIAN') ||
      normalizedRole.includes('GUARDIAN') ||
      normalizedRole.includes('PARENT') ||
      normalizedRole.includes('ELTERN');

    if (isParentAccount && studentId) {
      this.mmLog(
        'debug',
        null,
        `[REST] Parent account detected (role=${role}): fetching class information via classservices (studentId=${studentId})`
      );
      try {
        const startDate = formatDateInt(rangeStart);
        const endDate = formatDateInt(rangeEnd);
        this.mmLog(
          'debug',
          null,
          `[REST] classservices API: https://${server}/WebUntis/api/classreg/classservices?startDate=${startDate}&endDate=${endDate}&elementId=${studentId}`
        );

        const data = await webuntisApiService.getClassServices({
          getAuth: () =>
            qrCodeUrl
              ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: cacheKeyBase })
              : authService.getAuth({
                  school,
                  username,
                  password,
                  server,
                  options: authOptions,
                }),
          server,
          startDate,
          endDate,
          studentId,
          logger: this.mmLog,
        });

        if (data) {
          candidates = this._collectClassCandidates(data);
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
        }
      } catch (err) {
        this.mmLog('debug', null, `[REST] classservices error: ${this.formatErr(err)}`);
      }
    } else {
      this.mmLog(
        'debug',
        null,
        `[REST] Student/Teacher account (role=${role || 'unknown'}): fetching class information via timetable/filter`
      );
      try {
        const start = formatDateISO(rangeStart);
        const end = formatDateISO(rangeEnd);
        this.mmLog(
          'debug',
          null,
          `[REST] timetable/filter API: https://${server}/WebUntis/api/rest/view/v1/timetable/filter?resourceType=CLASS&timetableType=STANDARD&start=${start}&end=${end}`
        );

        const data = await webuntisApiService.getTimetableFilterClasses({
          getAuth: () =>
            qrCodeUrl
              ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: cacheKeyBase })
              : authService.getAuth({
                  school,
                  username,
                  password,
                  server,
                  options: authOptions,
                }),
          server,
          start,
          end,
          logger: this.mmLog,
        });

        if (data) {
          candidates = this._collectClassCandidates(data);
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
        }
      } catch (err) {
        this.mmLog('debug', null, `[REST] timetable/filter error: ${this.formatErr(err)}`);
      }
    }

    if (!candidates || candidates.length === 0) {
      throw new Error('No accessible classes returned by REST API');
    }

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

    this.cacheManager.set('classId', classCacheKey, chosen.id, 24 * 60 * 60 * 1000);
    return chosen.id;
  }

  async _getTimetableViaRest(
    authCtx,
    sessionCtx,
    logCtx,
    flagsCtx,
    rangeStart,
    rangeEnd,
    personId,
    options = {},
    useClassTimetable = false,
    className = null,
    resourceType = null
  ) {
    const restCtx = this._extractRestRequestContext(authCtx, sessionCtx, logCtx, flagsCtx);
    const { debugApi, dumpRawApiResponses, server } = restCtx;

    const wantsClass = Boolean(useClassTimetable || options.useClassTimetable);
    let classId = options.classId;
    const role = options.role || sessionCtx?.authSession?.role || null;
    if (wantsClass && !classId) {
      classId = await this._resolveClassIdViaRest(authCtx, sessionCtx, rangeStart, rangeEnd, className || options.className || null, role, {
        ...options,
        personId,
        studentId: options.studentId || personId,
      });
    }

    const authHandlers = this._buildRestAuthHandlers(restCtx);
    return this._executeRestEndpoint('timetable', restCtx, () =>
      webuntisApiService.getTimetable({
        ...authHandlers,
        server,
        rangeStart,
        rangeEnd,
        personId,
        useClassTimetable: wantsClass,
        classId,
        resourceType: resourceType || null,
        logger: this.mmLog,
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      })
    );
  }

  async _getExamsViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    const restCtx = this._extractRestRequestContext(authCtx, sessionCtx, logCtx, flagsCtx);
    const { debugApi, dumpRawApiResponses, server } = restCtx;
    const authHandlers = this._buildRestAuthHandlers(restCtx);

    return this._executeRestEndpoint('exams', restCtx, () =>
      webuntisApiService.getExams({
        ...authHandlers,
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this.mmLog,
        normalizeDate: WebUntisClient.normalizeDateToInteger,
        normalizeTime: WebUntisClient.normalizeTimeToHHMM,
        sanitizeHtml: WebUntisClient.stripAllHtml,
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      })
    );
  }

  async _getHomeworkViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    const restCtx = this._extractRestRequestContext(authCtx, sessionCtx, logCtx, flagsCtx);
    const { debugApi, dumpRawApiResponses, server } = restCtx;
    const authHandlers = this._buildRestAuthHandlers(restCtx);

    return this._executeRestEndpoint('homework', restCtx, () =>
      webuntisApiService.getHomework({
        ...authHandlers,
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this.mmLog,
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      })
    );
  }

  async _getAbsencesViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    const restCtx = this._extractRestRequestContext(authCtx, sessionCtx, logCtx, flagsCtx);
    const { debugApi, dumpRawApiResponses, server } = restCtx;
    const authHandlers = this._buildRestAuthHandlers(restCtx);

    return this._executeRestEndpoint('absences', restCtx, () =>
      webuntisApiService.getAbsences({
        ...authHandlers,
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this.mmLog,
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      })
    );
  }

  async _getMessagesOfDayViaRest(authCtx, sessionCtx, logCtx, flagsCtx, date) {
    const restCtx = this._extractRestRequestContext(authCtx, sessionCtx, logCtx, flagsCtx);
    const { debugApi, dumpRawApiResponses, server } = restCtx;
    const authHandlers = this._buildRestAuthHandlers(restCtx);

    return this._executeRestEndpoint('messagesOfDay', restCtx, () =>
      webuntisApiService.getMessagesOfDay({
        ...authHandlers,
        server,
        date,
        logger: this.mmLog,
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
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

  _calculateBaseNow(config) {
    try {
      const dbg = (typeof config?.debugDate === 'string' && config.debugDate) || null;
      if (dbg) {
        const s = String(dbg).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
        if (/^\d{8}$/.test(s)) {
          return new Date(`${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T00:00:00`);
        }
      }
    } catch {
      void 0;
    }

    const now = new Date(Date.now());
    return new Date(now.toLocaleString('en-US', { timeZone: config.timezone || 'Europe/Berlin' }));
  }

  _logEmptyTargets(student, config, appData) {
    const hasQrCode = Boolean(student.qrcode);
    const hasStudentCreds = Boolean(student.username && student.password && student.school && student.server);
    const hasParentCreds = Boolean(config?.username && config?.password);
    const hasStudentId = Boolean(student.studentId && Number.isFinite(Number(student.studentId)));
    const emptyStringCreds = student.username === '' || student.password === '';

    let hint = 'Check authentication and credentials.';
    if (emptyStringCreds) {
      hint = 'Student credentials are empty strings - remove username/password fields or provide valid credentials.';
    } else if (!hasQrCode && !hasStudentCreds && !hasParentCreds) {
      hint =
        'No credentials configured. Need either: (1) student.qrcode, (2) student username/password/school/server, or (3) config-level username/password with student.studentId.';
    } else if (hasParentCreds && !hasStudentId) {
      hint = 'Parent credentials configured but student.studentId is missing (required for parent mode).';
    } else if (hasParentCreds && hasStudentId && (!appData || !appData.user || !appData.user.students)) {
      hint =
        'Parent credentials configured but appData.user.students is empty/missing (check if parent account has linked children in WebUntis).';
    }

    this.mmLog('warn', student, `No REST targets built - cannot fetch data! ${hint}`);
  }

  /**
   * Core fetch pipeline that returns a neutral data bundle.
   * No MMM payload shape is produced here.
   */
  async fetchBundle(request) {
    const { authSession, student, identifier, credKey, compactHolidays = [], config, sessionKey, currentFetchWarnings } = request;

    const logger = this._createLogger(student);
    const logCtx = {
      logger,
      mmLog: this.mmLog,
      formatErr: this.formatErr,
    };

    const authRefreshTracker = { refreshed: false };
    const authCtx = {
      authService: config._authService,
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

    const flagsCtx = {
      debugApi: Boolean(config.debugApi),
      dumpRawApiResponses: Boolean(config.dumpRawApiResponses),
    };

    const { school, server } = authSession;
    const ownPersonId = authSession.personId;
    const bearerToken = authSession.token;
    const appData = authSession.appData;
    const role = authSession.role || null;
    const authService = config._authService;

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

    const describeTarget = (target) => {
      const roleLabel = target.role || 'unknown';
      if (target.role === 'LEGAL_GUARDIAN') {
        return `${roleLabel} (parentId=${ownPersonId}, childId=${target.personId})`;
      }
      return `${roleLabel}${target.personId ? ` (id=${target.personId})` : ''}`;
    };

    const className = student.class || student.className || null;
    const effectiveDisplayMode = student.displayMode || config.displayMode;

    const wantsGridWidget = this.wantsWidget('grid', effectiveDisplayMode);
    const wantsLessonsWidget = this.wantsWidget('lessons', effectiveDisplayMode);
    const wantsExamsWidget = this.wantsWidget('exams', effectiveDisplayMode);
    const wantsHomeworkWidget = this.wantsWidget('homework', effectiveDisplayMode);
    const wantsAbsencesWidget = this.wantsWidget('absences', effectiveDisplayMode);
    const wantsMessagesOfDayWidget = this.wantsWidget('messagesofday', effectiveDisplayMode);

    const fetchTimegrid = Boolean(wantsGridWidget || wantsLessonsWidget);
    const fetchTimetable = Boolean(wantsGridWidget || wantsLessonsWidget);
    const fetchExams = Boolean(wantsGridWidget || wantsExamsWidget);
    const fetchHomeworks = Boolean(wantsGridWidget || wantsHomeworkWidget);
    const fetchAbsences = Boolean(wantsGridWidget || wantsAbsencesWidget);
    const fetchMessagesOfDay = Boolean(wantsMessagesOfDayWidget);

    const fetchFlags = {
      fetchTimegrid,
      fetchTimetable,
      fetchExams,
      fetchHomeworks,
      fetchAbsences,
      fetchMessagesOfDay,
    };

    const baseNow = this._calculateBaseNow(config);
    const todayYmd = baseNow.getFullYear() * 10000 + (baseNow.getMonth() + 1) * 100 + baseNow.getDate();

    const dateRanges = calculateFetchRanges(student, config, baseNow, wantsGridWidget, wantsLessonsWidget, fetchExams, fetchAbsences);

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
      restTargets,
      authCtx,
      sessionCtx,
      logCtx,
      flagsCtx,
      fetchFlags: {
        fetchTimetable,
        fetchExams,
        fetchHomeworks,
        fetchAbsences,
        fetchMessagesOfDay,
      },
      callRest: this._callRest.bind(this),
      getTimetableViaRest: this._getTimetableViaRest.bind(this),
      getExamsViaRest: this._getExamsViaRest.bind(this),
      getHomeworkViaRest: this._getHomeworkViaRest.bind(this),
      getAbsencesViaRest: this._getAbsencesViaRest.bind(this),
      getMessagesOfDayViaRest: this._getMessagesOfDayViaRest.bind(this),
      logger: logCtx.logger,
      describeTarget,
      className,
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
      identifier,
      sessionKey,
      student,
      config,
      compactHolidays,
      dateRanges,
      todayYmd,
      activeHoliday,
      fetchTimetable,
      fetchFlags,
      fetchHomeworks,
      fetchAbsences,
      fetchMessagesOfDay,
      currentFetchWarnings,
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
    const { identifier, student } = params;
    const bundle = await this.fetchBundle(params);

    try {
      return mapBundleToMmmPayload(bundle, {
        compactTimegrid: this.compactTimegrid,
        checkEmptyDataWarning: this.checkEmptyDataWarning,
        mmLog: this.mmLog,
        cleanupOldDebugDumps: this.cleanupOldDebugDumps,
      });
    } catch (err) {
      this.mmLog('error', student, `Failed to prepare payload for ${identifier}: ${this.formatErr(err)}`);
      return null;
    }
  }
}

module.exports = {
  WebUntisClient,
};
