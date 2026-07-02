Module.register('MMM-Webuntis', {
  _cacheVersion: '2.0.2',

  /**
   * Frontend logger factory for widget logging.
   * Uses the runtime utility loaded via getScripts(); _log provides the console fallback.
   *
   * @param {string} moduleName - Module name for log prefixes (default: 'MMM-Webuntis')
   * @returns {Object|null} Logger object with log(level, msg) method, or null if unavailable
   */
  _createFrontendLogger(moduleName = 'MMM-Webuntis') {
    if (!globalThis.MMModuleRuntimeUtils?.createLevelLogger) {
      return null;
    }

    return globalThis.MMModuleRuntimeUtils.createLevelLogger({
      prefix: `[${moduleName}]`,
      getLevel: () => window.MMMWebuntisLogLevel || 'info',
    });
  },

  /**
   * Central frontend clock access for widgets and module lifecycle logic.
   * Keeps debugDate semantics in one place on the module instance.
   *
   * @param {Object|null} configOverride - Optional config to evaluate instead of this.config
   * @returns {{date: Date, ymd: number, isoDate: string, isDebug: boolean, timezone: string}}
   */
  getCurrentDateContext(configOverride = null) {
    if (globalThis.MMModuleRuntimeUtils?.getCurrentDateContext) {
      return globalThis.MMModuleRuntimeUtils.getCurrentDateContext(configOverride || this.config || {}, {
        defaultTimezone: this.defaults?.timezone || 'Europe/Berlin',
      });
    }

    // Fallback: Simple date context without debugDate/timezone support
    // This should never execute in practice since runtime-utils.js is loaded via getScripts()
    // If this fallback runs, it means the script failed to load - module will work but
    // debugDate and timezone-aware date handling will not be available
    const now = new Date();
    return {
      date: now,
      ymd: now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate(),
      isoDate: `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
      isDebug: false,
      timezone: configOverride?.timezone || this.config?.timezone || this.defaults?.timezone || 'Europe/Berlin',
    };
  },

  _usesLiveClock(nowContext = this.getCurrentDateContext()) {
    return nowContext?.isDebug !== true;
  },

  /**
   * Generate a random session identifier.
   * Uses a cryptographically secure random number generator when available.
   *
   * @param {number} length - Length of the identifier to generate.
   * @returns {string} Random session identifier consisting of [0-9a-z].
   * @private
   */
  _generateSessionId(length = 9) {
    if (globalThis.MMModuleRuntimeUtils?.generateScopedId) {
      const scopedId = globalThis.MMModuleRuntimeUtils.generateScopedId('wu', length);
      return scopedId.startsWith('wu_') ? scopedId.slice(3) : scopedId;
    }

    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

    const cryptoObj =
      (typeof window !== 'undefined' && window.crypto) ||
      (typeof self !== 'undefined' && self.crypto) ||
      (typeof crypto !== 'undefined' && crypto);

    let result = '';

    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const array = new Uint8Array(length);
      cryptoObj.getRandomValues(array);
      for (let i = 0; i < length; i += 1) {
        const idx = array[i] % alphabet.length;
        result += alphabet.charAt(idx);
      }
      return result;
    }

    for (let i = 0; i < length; i += 1) {
      const idx = Math.floor(Math.random() * alphabet.length);
      result += alphabet.charAt(idx);
    }
    return result;
  },

  defaults: {
    // === GLOBAL OPTIONS ===
    header: 'MMM-Webuntis', // displayed as module title in MagicMirror
    updateInterval: 5 * 60 * 1000, // fetch interval in milliseconds (default: 5 minutes)
    timezone: 'Europe/Berlin', // timezone for date calculations

    // === DEBUG OPTIONS ===
    logLevel: 'none', // Logging level: none, error, warn, info, debug.
    debugDate: null, // set to 'YYYY-MM-DD' to freeze the calendar day for debugging (null = disabled)
    demoDataFile: null, // optional relative JSON fixture path for frontend demo mode (skips backend/API)
    initRetryTimeout: 5000, // timeout for INIT_MODULE -> MODULE_INITIALIZED watchdog (milliseconds)
    initRetryMaxAttempts: 4, // max INIT_MODULE attempts before reopening init gate
    dumpBackendPayloads: false, // dump raw payloads from backend in ./debug_dumps/ folder
    dumpRawApiResponses: false, // save raw REST API responses to ./debug_dumps/raw_api_*.json

    // === DISPLAY OPTIONS ===
    // Comma-separated list of widgets to render (top-to-bottom).
    // Supported widgets: grid, lessons, exams, homework, absences, messagesofday
    displayMode: 'lessons, exams', // Legacy widget activation string.
    mode: 'verbose', // 'verbose' (per-student sections) or 'compact' (combined view)
    useClassTimetable: false, // Prefer class timetable endpoints when available.

    // === AUTHENTICATION ===
    // username: 'your username', // WebUntis username (leave empty if using studentId/qrcode)
    // password: 'your password', // WebUntis password (leave empty if using studentId/qrcode)
    // school: 'your school',     // WebUntis school name (most likely subdomain)
    // server: 'schoolserver.webuntis.com',  // WebUntis server URL (usually subdomain.webuntis.com)

    // === STUDENTS ===
    // students: [
    //   {
    //     title: 'kids name', // Display name for the student
    //     studentId: 1234, // replace with student ID for individual title
    //     qrcode: null, // optional: untis:// URL from WebUntis QR code
    //   },
    // ],

    // === WIDGET NAMESPACED CONFIG OVERRIDES (legacy-compatible) ===
    // These namespaces are still accepted from config.js.
    // Canonical runtime config should use plugins.<pluginId>.config.
    lessons: {}, // Legacy overrides for lessons plugin.
    grid: {}, // Legacy overrides for grid plugin.
    exams: {}, // Legacy overrides for exams plugin.
    homework: {}, // Legacy overrides for homework plugin.
    absences: {}, // Legacy overrides for absences plugin.
    messagesofday: {}, // Legacy overrides for messagesofday plugin.

    // === CANONICAL PLUGIN CONFIG ===
    // Plugin-local defaults live in backend plugin implementations.
    // User configuration should be provided via plugins.<pluginId>.config and
    // optional students[].plugins.<pluginId>.config overrides.
    plugins: {}, // Canonical plugin config map by plugin id.
  },

  /**
   * Return array of CSS files to load for this module
   * Called by MagicMirror during module initialization
   *
   * @returns {string[]} Array of CSS file paths
   */
  getStyles() {
    return [this.file('MMM-Webuntis.css')];
  },

  /**
   * Called by MagicMirror during module initialization
   * Return array of JavaScript files to load for this module
   *
   * @returns {string[]} Array of JavaScript file paths
   */
  getScripts() {
    window.MMMWebuntisLogLevel = this.config?.logLevel || this.defaults.logLevel || 'info';

    const scripts = [this.file('lib/runtime-utils.js'), this.file('lib/pluginHostFrontend.js'), this.file('lib/frontendShared.js')];

    return scripts;
  },

  /**
   * Return translation files for supported languages
   * Called by MagicMirror's i18n system
   *
   * @returns {Object} Map of language codes to translation file paths
   */
  getTranslations() {
    return {
      en: 'translations/en.json',
      de: 'translations/de.json',
    };
  },

  _getPluginTranslationEntry(pluginId, key) {
    const translations = this._pluginTranslationsById?.get(String(pluginId || '').trim());
    if (!translations || typeof translations !== 'object') return undefined;
    return Object.hasOwn(translations, key) ? translations[key] : undefined;
  },

  _applyTranslationReplacements(template, replacements) {
    const source = String(template ?? '');
    if (!replacements || typeof replacements !== 'object' || Array.isArray(replacements)) {
      return source;
    }

    return source.replace(/\{([^}]+)\}/g, (match, key) => {
      return Object.hasOwn(replacements, key) ? String(replacements[key]) : match;
    });
  },

  _translatePluginKey(pluginId, key, fallback, replacements) {
    const pluginValue = this._getPluginTranslationEntry(pluginId, key);
    if (pluginValue !== undefined) {
      return this._applyTranslationReplacements(pluginValue, replacements);
    }

    const translated = replacements ? this.translate(key, replacements) : this.translate(key);
    return translated && translated !== key ? translated : fallback || key;
  },

  _getPluginTranslationLoadOrder() {
    const configuredLanguage = String(globalThis.config?.language || this.config?.language || navigator?.language || 'en').trim();
    const normalizedLanguage = configuredLanguage || 'en';
    const baseLanguage = normalizedLanguage.split('-')[0];
    return Array.from(new Set(['en', baseLanguage, normalizedLanguage].filter(Boolean)));
  },

  async _loadPluginTranslations(pluginEntry) {
    const pluginId = String(pluginEntry?.id || '').trim();
    if (!pluginId) return;

    if (!this._pluginTranslationsById) {
      this._pluginTranslationsById = new Map();
    }
    if (this._pluginTranslationsById.has(pluginId)) return;

    const frontendEntry = String(pluginEntry?.entry?.frontend || '').trim();
    const lastSlash = frontendEntry.lastIndexOf('/');
    const pluginRoot = lastSlash === -1 ? '' : frontendEntry.slice(0, lastSlash);
    if (!pluginRoot) {
      this._pluginTranslationsById.set(pluginId, {});
      return;
    }

    const mergedTranslations = {};
    const languages = this._getPluginTranslationLoadOrder();
    for (const language of languages) {
      const relativePath = `${pluginRoot}/translations/${language}.json`;
      const url = this.file(relativePath);

      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.status === 404) continue;
        if (!response.ok) {
          this._log('warn', `[plugins] ${pluginId}: failed to load translations from ${relativePath} (${response.status})`);
          continue;
        }

        const json = await response.json();
        if (!json || typeof json !== 'object' || Array.isArray(json)) {
          this._log('warn', `[plugins] ${pluginId}: ignoring non-object translations in ${relativePath}`);
          continue;
        }

        Object.assign(mergedTranslations, json);
      } catch (error) {
        this._log('warn', `[plugins] ${pluginId}: failed to load translations from ${relativePath}: ${error?.message || error}`);
      }
    }

    this._pluginTranslationsById.set(pluginId, mergedTranslations);
  },

  /**
   * Get the shared frontend helper API.
   *
   * Provides access to rendering helpers used by both the host and frontend plugins.
   *
   * @returns {Object|null} Shared frontend helper API or null if not available
   */
  _getWidgetApi() {
    try {
      return window.MMMWebuntisFrontendShared || null;
    } catch {
      return null;
    }
  },

  _getPluginHost() {
    try {
      return globalThis.MMMWebuntisPluginHost || null;
    } catch {
      return null;
    }
  },

  _setPluginRegistry(pluginEntries = []) {
    this._pluginRegistryById = new Map();
    const entries = Array.isArray(pluginEntries) ? pluginEntries : [];
    entries.forEach((entry) => {
      const pluginId = String(entry?.id || '').trim();
      if (!pluginId) return;
      this._pluginRegistryById.set(pluginId, entry);
    });
  },

  _getPluginRegistryEntry(pluginId) {
    return this._pluginRegistryById?.get(String(pluginId || '').trim()) || null;
  },

  _getLegacyDisplayTokens(configSource = this.config || {}) {
    const parseDisplayModeTokens = globalThis.MMModuleRuntimeUtils?.parseDisplayModeTokens;
    if (typeof parseDisplayModeTokens === 'function') {
      return parseDisplayModeTokens(configSource?.displayMode);
    }

    const raw = configSource?.displayMode;
    const displayMode = raw === undefined || raw === null ? '' : String(raw).toLowerCase().trim();
    if (displayMode === 'grid') return ['grid'];
    if (displayMode === 'list') return ['list', 'lessons', 'exams'];
    return displayMode
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  },

  _isPluginActive(pluginId) {
    return this._getPluginRegistryEntry(pluginId)?.active === true;
  },

  _ensurePluginAssetState(pluginId) {
    if (!this._pluginAssetStateById) {
      this._pluginAssetStateById = new Map();
    }
    const normalizedPluginId = String(pluginId || '').trim();
    if (!this._pluginAssetStateById.has(normalizedPluginId)) {
      this._pluginAssetStateById.set(normalizedPluginId, {
        loaded: false,
        failed: false,
        promise: null,
        errorMessage: '',
      });
    }
    return this._pluginAssetStateById.get(normalizedPluginId);
  },

  _loadPluginStyles(pluginEntry) {
    const styles = Array.isArray(pluginEntry?.entry?.styles) ? pluginEntry.entry.styles : [];
    styles.forEach((stylePath) => {
      const href = this.file(stylePath);
      if (document.querySelector(`link[data-wu-plugin-style="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.wuPluginStyle = href;
      document.head.appendChild(link);
    });
  },

  _loadPluginScript(pluginEntry) {
    return new Promise((resolve, reject) => {
      const scriptPath = pluginEntry?.entry?.frontend;
      if (!scriptPath) {
        reject(new Error(`Plugin ${pluginEntry?.id || 'unknown'} is missing a frontend entry.`));
        return;
      }

      const src = this.file(scriptPath);
      const existing = document.querySelector(`script[data-wu-plugin-script="${src}"]`);
      if (existing) {
        if (existing.dataset.wuPluginLoaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load plugin script ${scriptPath}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.wuPluginScript = src;
      script.addEventListener(
        'load',
        () => {
          script.dataset.wuPluginLoaded = 'true';
          resolve();
        },
        { once: true }
      );
      script.addEventListener('error', () => reject(new Error(`Failed to load plugin script ${scriptPath}`)), { once: true });
      document.head.appendChild(script);
    });
  },

  _initializeActivePlugins(pluginEntries = []) {
    const entries = Array.isArray(pluginEntries) ? pluginEntries.filter((entry) => entry?.active === true) : [];
    const loadTasks = entries.map((pluginEntry) => {
      const state = this._ensurePluginAssetState(pluginEntry.id);
      if (state.loaded) return Promise.resolve();
      if (state.promise) return state.promise;

      state.promise = Promise.resolve()
        .then(() => {
          this._loadPluginStyles(pluginEntry);
          return this._loadPluginTranslations(pluginEntry);
        })
        .then(() => {
          return this._loadPluginScript(pluginEntry);
        })
        .then(() => {
          state.loaded = true;
          state.failed = false;
          state.errorMessage = '';
        })
        .catch((error) => {
          state.failed = true;
          state.errorMessage = error?.message || String(error);
          this._log('error', `[plugins] ${pluginEntry.id}: ${state.errorMessage}`);
        })
        .finally(() => {
          state.promise = null;
        });

      return state.promise;
    });

    return Promise.all(loadTasks).then(() => {
      this.updateDom();
    });
  },

  _buildPluginStudentRuntimeSlices(studentTitles = []) {
    return studentTitles.map((studentTitle) => ({
      student: {
        id: null,
        title: studentTitle,
      },
      context: {
        config: this.configByStudent?.[studentTitle] || this.config || {},
      },
      data: {
        lessons: this.timetableByStudent?.[studentTitle] || [],
        timeUnits: this.timeUnitsByStudent?.[studentTitle] || [],
        exams: this.examsByStudent?.[studentTitle] || [],
        homework: this.homeworksByStudent?.[studentTitle] || [],
        absences: this.absencesByStudent?.[studentTitle] || [],
        messages: this.messagesOfDayByStudent?.[studentTitle] || [],
        holidays: {
          ranges: this.holidaysByStudent?.[studentTitle] || [],
        },
        dayNotices: this.dayNoticesByStudent?.[studentTitle] || [],
      },
      state: {
        warnings: this.runtimeWarningsByStudent?.[studentTitle] ? Array.from(this.runtimeWarningsByStudent[studentTitle]) : [],
      },
      plugins: {},
    }));
  },

  _createFrontendPluginContext(pluginEntry) {
    return {
      pluginId: pluginEntry.id,
      hostApiVersion: this._getPluginHost()?.hostApiVersion || 1,
      manifest: pluginEntry,
      translate: (key, fallback, replacements) => {
        return this._translatePluginKey(pluginEntry.id, key, fallback, replacements);
      },
      log: (level, message, meta = null) => {
        if (meta) {
          this._log(level, `[plugin:${pluginEntry.id}] ${message}`, meta);
          return;
        }
        this._log(level, `[plugin:${pluginEntry.id}] ${message}`);
      },
      dom: {},
      time: {},
      formatting: {},
      shared: {},
    };
  },

  _renderFrontendPluginWidget(pluginId, studentTitles = []) {
    const pluginEntry = this._getPluginRegistryEntry(pluginId);
    if (pluginEntry?.active !== true) return null;

    const state = this._ensurePluginAssetState(pluginId);
    if (state.failed) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'wu-widget__error widget-error dimmed';
      errorDiv.textContent = state.errorMessage || `Plugin ${pluginId} failed to load`;
      return errorDiv;
    }

    const pluginHost = this._getPluginHost();
    if (!state.loaded || !pluginHost?.hasFrontendPlugin?.(pluginId)) {
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'wu-widget__info dimmed';
      loadingDiv.textContent = `${pluginEntry.title || pluginId} plugin is loading...`;
      return loadingDiv;
    }

    if (!this._frontendPluginInstancesById) {
      this._frontendPluginInstancesById = new Map();
    }

    let pluginInstance = this._frontendPluginInstancesById.get(pluginId);
    if (!pluginInstance) {
      pluginInstance = pluginHost.createFrontendPluginInstance(pluginId, this._createFrontendPluginContext(pluginEntry));
      this._frontendPluginInstancesById.set(pluginId, pluginInstance);
    }

    const renderContext = {
      moduleId: this.identifier,
      mode: this.config?.mode || 'verbose',
      students: this._buildPluginStudentRuntimeSlices(studentTitles),
      warnings: this._getRuntimeWarnings(),
      runtime: {},
    };

    return typeof pluginInstance?.render === 'function' ? pluginInstance.render(renderContext) : null;
  },

  /**
   * Check whether frontend demo mode is enabled.
   *
   * @returns {boolean} True when a demo fixture path is configured.
   */
  _isDemoModeEnabled() {
    const raw = this.config?.demoDataFile;
    return typeof raw === 'string' && raw.trim() !== '';
  },

  /**
   * Resolve the configured demo fixture path to a module-local URL.
   *
   * @returns {string|null} Fixture URL or null when demo mode is disabled.
   */
  _getDemoDataUrl() {
    const raw = String(this.config?.demoDataFile || '')
      .trim()
      .replace(/^\/+/, '');
    if (!raw) return null;
    return this.file(raw);
  },

  /**
   * Normalize demo fixture content to the payload array shape used by the runtime.
   *
   * @param {Object|Object[]} rawData - Parsed demo fixture JSON.
   * @returns {Object[]} Normalized payload entries.
   */
  _normalizeDemoPayloads(rawData) {
    if (!rawData) return [];
    if (Array.isArray(rawData)) return rawData;
    if (Array.isArray(rawData?.payloads)) return rawData.payloads;
    return [rawData];
  },

  /**
   * Load and cache demo payloads from the configured fixture.
   *
   * @returns {Promise<Object[]>} Demo payload entries.
   */
  async _loadDemoPayloads() {
    const demoUrl = this._getDemoDataUrl();
    if (!demoUrl) return [];

    const cacheKey = String(this.config?.demoDataFile || '').trim();
    if (this._demoPayloadCacheKey === cacheKey && Array.isArray(this._demoPayloadCache) && this._demoPayloadCache.length > 0) {
      return this._demoPayloadCache;
    }

    const response = await fetch(demoUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load demo fixture (${response.status}) from ${demoUrl}`);
    }

    const json = await response.json();
    const payloads = this._normalizeDemoPayloads(json);
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new Error(`Demo fixture ${demoUrl} contains no payloads`);
    }

    this._demoPayloadCacheKey = cacheKey;
    this._demoPayloadCache = payloads;
    return payloads;
  },

  /**
   * Emit one or more demo payloads through the normal GOT_DATA handler path.
   *
   * @param {string} [reason='manual'] - Trigger reason for logging/debugging context.
   * @returns {Promise<void>}
   */
  async _emitDemoPayload(reason = 'manual') {
    try {
      const payloads = await this._loadDemoPayloads();
      const statusDefaults = {
        timetable: 200,
        exams: 200,
        homework: 200,
        absences: 200,
        messagesOfDay: 200,
      };
      const fetchDefaults = {
        fetchTimetable: true,
        fetchTimegrid: true,
        fetchExams: true,
        fetchHomeworks: true,
        fetchAbsences: true,
        fetchMessagesOfDay: true,
      };

      payloads.forEach((entry, index) => {
        const fallbackTitle = this.config?.students?.[index]?.title || this.config?.students?.[0]?.title || `Demo Student ${index + 1}`;
        const payload = {
          ...(entry || {}),
          title: String(entry?.title || fallbackTitle),
          config: entry?.config || this.config,
          warnings: Array.isArray(entry?.warnings) ? entry.warnings : [],
          apiStatus: { ...statusDefaults, ...(entry?.apiStatus || {}) },
          fetchFlags: { ...fetchDefaults, ...(entry?.fetchFlags || {}) },
          sessionId: this._sessionId,
          id: this.identifier,
        };
        this.socketNotificationReceived('GOT_DATA', payload);
      });

      this._log('debug', `[DEMO] Rendered ${payloads.length} demo payload(s) (${reason})`);
    } catch (error) {
      const msg = `Demo mode failed: ${error?.message || String(error)}`;
      this._log('error', msg);
      this.moduleWarningsSet = this.moduleWarningsSet || new Set();
      this.moduleWarningsSet.add(msg);
      this.updateDom();
    }
  },

  /**
   * Parse displayMode config and return array of enabled widgets
   * Handles special cases:
   *   - 'grid' → ['grid']
   *   - 'list' → ['lessons', 'exams']
   *   - 'lessons,exams,homework' → ['lessons', 'exams', 'homework']
   *
   * Also normalizes aliases (e.g., 'homework' = 'homeworks', 'absence' = 'absences')
   *
   * @returns {string[]} Array of enabled widget names (lowercase, canonical form)
   */
  _getDisplayWidgets() {
    const displayTokens = this._getLegacyDisplayTokens(this.config || {});

    if (this._pluginRegistryById && this._pluginRegistryById.size > 0 && displayTokens.length > 0) {
      const pluginEntries = Array.from(this._pluginRegistryById.values()).filter((entry) => entry?.active === true);
      const enabledFromDisplayMode = [];

      for (const token of displayTokens) {
        const matches = pluginEntries
          .filter((entry) => {
            const aliases = Array.isArray(entry?.aliases) && entry.aliases.length > 0 ? entry.aliases : [entry?.id];
            return aliases.includes(token);
          })
          .sort((left, right) => {
            const orderDelta = Number(left?.order || 1000) - Number(right?.order || 1000);
            if (orderDelta !== 0) return orderDelta;
            return String(left?.id || '').localeCompare(String(right?.id || ''));
          });

        for (const match of matches) {
          const pluginId = String(match?.id || '');
          if (!pluginId || enabledFromDisplayMode.includes(pluginId)) continue;
          enabledFromDisplayMode.push(pluginId);
        }
      }

      if (enabledFromDisplayMode.length > 0) return enabledFromDisplayMode;
    }

    if (this._pluginRegistryById && this._pluginRegistryById.size > 0) {
      const activePlugins = Array.from(this._pluginRegistryById.values())
        .filter((entry) => entry?.active === true)
        .sort((left, right) => {
          const orderDelta = Number(left?.order || 1000) - Number(right?.order || 1000);
          if (orderDelta !== 0) return orderDelta;
          return String(left?.id || '').localeCompare(String(right?.id || ''));
        })
        .map((entry) => String(entry.id));
      if (activePlugins.length > 0) return activePlugins;
    }

    const explicitPlugins =
      this.config?.plugins && typeof this.config.plugins === 'object' && !Array.isArray(this.config.plugins) ? this.config.plugins : {};
    const explicitEnabled = Object.entries(explicitPlugins)
      .filter(([, entry]) => entry?.enabled === true)
      .map(([pluginId]) => pluginId);
    if (explicitEnabled.length > 0) {
      return explicitEnabled;
    }

    const enabled = [];
    for (const token of displayTokens) {
      if (token === 'list') {
        if (!enabled.includes('lessons')) enabled.push('lessons');
        if (!enabled.includes('exams')) enabled.push('exams');
        continue;
      }
      if (['grid', 'lessons', 'exams', 'homework', 'absences', 'messagesofday'].includes(token) && !enabled.includes(token)) {
        enabled.push(token);
      }
    }
    return enabled.length > 0 ? enabled : ['lessons', 'exams'];
  },

  /**
   * Simple log helper to control verbosity from the module config
   * Respects the configured logLevel (none, error, warn, info, debug)
   * Delegates to frontend logger if available, otherwise uses console
   *
   * @param {string} level - Log level ('error', 'warn', 'info', 'debug')
   * @param {...any} args - Arguments to log (strings, objects, etc.)
   */
  _log(level, ...args) {
    try {
      const frontendFactory = this._createFrontendLogger;
      if (frontendFactory && !this.frontendLogger) {
        this.frontendLogger = frontendFactory('MMM-Webuntis');
      }
      if (this.frontendLogger && typeof this.frontendLogger.log === 'function') {
        const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        this.frontendLogger.log(level, msg);
        return;
      }
    } catch {
      void 0;
    }

    const levels = this._getWidgetApi()?.util?.logLevelWeights || { none: -1, error: 0, warn: 1, info: 2, debug: 3 };
    const configured = this.config?.logLevel || this.defaults.logLevel || 'none';
    const configuredLevel = levels[configured] !== undefined ? configured : 'none';
    const msgLevel = levels[level] !== undefined ? level : 'info';
    if (levels[msgLevel] <= levels[configuredLevel]) {
      try {
        if (msgLevel === 'error') console.error('[MMM-Webuntis]', ...args);
        else if (msgLevel === 'warn') console.warn('[MMM-Webuntis]', ...args);
        else console.warn('[MMM-Webuntis]', ...args);
      } catch {
        void 0;
      }
    }
  },

  _getSortedStudentTitles() {
    if (!this.timetableByStudent || typeof this.timetableByStudent !== 'object') return [];
    return Object.keys(this.timetableByStudent).sort();
  },

  /**
   * Build day-level holiday lookup map from holiday ranges
   * Input is a list of ranges ({startDate, endDate, ...}) and output is
   * a map keyed by YYYYMMDD for O(1) per-day lookups in widgets.
   *
   * @param {Array} holidays - Holiday ranges
   * @returns {Object} Map of YYYYMMDD -> holiday object
   */
  _buildHolidayMapFromRanges(holidays) {
    if (!Array.isArray(holidays) || holidays.length === 0) return {};

    const map = {};
    holidays.forEach((holiday) => {
      const startNum = Number(holiday?.startDate);
      const endNum = Number(holiday?.endDate);
      if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) return;

      const startY = Math.floor(startNum / 10000);
      const startM = Math.floor((startNum % 10000) / 100) - 1;
      const startD = startNum % 100;
      const endY = Math.floor(endNum / 10000);
      const endM = Math.floor((endNum % 10000) / 100) - 1;
      const endD = endNum % 100;

      const cursor = new Date(startY, startM, startD);
      const endDate = new Date(endY, endM, endD);

      if (Number.isNaN(cursor.getTime()) || Number.isNaN(endDate.getTime())) return;

      while (cursor <= endDate) {
        const ymd = cursor.getFullYear() * 10000 + (cursor.getMonth() + 1) * 100 + cursor.getDate();
        map[ymd] = holiday;
        cursor.setDate(cursor.getDate() + 1);
      }
    });

    return map;
  },

  _buildDayNoticeMap(dayNotices) {
    if (!Array.isArray(dayNotices) || dayNotices.length === 0) return {};

    return dayNotices.reduce((map, notice) => {
      const ymd = Number(notice?.date);
      if (!Number.isFinite(ymd) || ymd <= 0) return map;
      map[ymd] = notice;
      return map;
    }, {});
  },

  /**
   * Build configuration object to send to backend
   * Backend performs normalization/default handling for nested widget configs
   *
   * @returns {Object} Config object with session metadata for backend processing
   */
  _buildSendConfig() {
    const rawStudents = Array.isArray(this.config.students) ? this.config.students : [];
    const widgetKeys = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
    const explicitPlugins =
      this.config?.plugins && typeof this.config.plugins === 'object' && !Array.isArray(this.config.plugins)
        ? this.config.plugins
        : undefined;

    const sendConfig = {
      ...this.defaults,
      ...this.config,
      students: rawStudents,
      id: this.identifier,
      sessionId: this._sessionId,
    };

    if (explicitPlugins) {
      sendConfig.plugins = explicitPlugins;
    }

    widgetKeys.forEach((widget) => {
      sendConfig[widget] = {
        ...(this.defaults?.[widget] || {}),
        ...(this.config?.[widget] || {}),
      };
    });

    this._validateAndWarnConfig(sendConfig);

    return sendConfig;
  },

  /**
   * Validate module configuration and collect warnings
   * Checks:
   *   - displayMode contains valid widget names
   *   - logLevel is valid
   *   - Numeric ranges (nextDays, pastDays) are not negative
   *   - Student credentials or parent credentials are configured
   *
   * Warnings are logged and stored in moduleWarningsSet to avoid duplicates
   *
   * @param {Object} config - Configuration object to validate
   */
  _validateAndWarnConfig(config) {
    const warnings = [];

    const validWidgets = ['list', 'grid', 'lessons', 'exams', 'homework', 'absences', 'messagesofday'];
    if (config.displayMode && typeof config.displayMode === 'string') {
      const widgets = config.displayMode
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => w.toLowerCase());
      const invalid = widgets.filter((w) => !validWidgets.includes(w));
      if (invalid.length > 0) {
        warnings.push(`displayMode contains unknown widgets: "${invalid.join(', ')}". Supported: ${validWidgets.join(', ')}`);
      }
    }

    const validLogLevels = ['none', 'error', 'warn', 'info', 'debug'];
    if (config.logLevel && !validLogLevels.includes(String(config.logLevel).toLowerCase())) {
      warnings.push(`Invalid logLevel "${config.logLevel}". Use one of: ${validLogLevels.join(', ')}`);
    }

    if (Number.isFinite(config.nextDays) && config.nextDays < 0) {
      warnings.push(`nextDays cannot be negative. Value: ${config.nextDays}`);
    }
    if (Number.isFinite(config.pastDays) && config.pastDays < 0) {
      warnings.push(`pastDays cannot be negative. Value: ${config.pastDays}`);
    }
    if (Number.isFinite(config.grid?.mergeGap) && config.grid.mergeGap < 0) {
      warnings.push(`grid.mergeGap cannot be negative. Value: ${config.grid.mergeGap}`);
    }
    if (
      config.initRetryTimeout !== undefined &&
      (!Number.isFinite(Number(config.initRetryTimeout)) || Number(config.initRetryTimeout) < 1000)
    ) {
      warnings.push(`initRetryTimeout should be >= 1000ms. Value: ${config.initRetryTimeout}`);
    }
    if (
      config.initRetryMaxAttempts !== undefined &&
      (!Number.isFinite(Number(config.initRetryMaxAttempts)) || Number(config.initRetryMaxAttempts) < 1)
    ) {
      warnings.push(`initRetryMaxAttempts should be >= 1. Value: ${config.initRetryMaxAttempts}`);
    }

    const hasParentCreds = Boolean((config.username && config.password && config.school) || config.qrcode);
    if (!Array.isArray(config.students) || config.students.length === 0) {
      if (!hasParentCreds) {
        warnings.push(
          'No students configured and no parent credentials provided. Either configure students[] or provide username, password, and school for auto-discovery.'
        );
      } else {
        this._log('info', 'Empty students[] with parent credentials: waiting for auto-discovery from backend...');
      }
    }

    warnings.forEach((warning) => {
      this._upsertModuleWarnings([warning], [], { kind: 'config', severity: 'warning' });
      this._log('warn', warning);
    });
  },

  /**
   * Store runtime warnings per student so they can be cleared on the next successful fetch
   * @param {string} studentTitle - Student label from the payload
   * @param {string[]} warningsList - Warning messages returned by the backend
   */
  _updateRuntimeWarnings(studentTitle, warningsList) {
    const key = studentTitle || '__module__';
    this.runtimeWarningsByStudent = this.runtimeWarningsByStudent || {};
    const nextWarnings = Array.isArray(warningsList) && warningsList.length > 0 ? new Set(warningsList) : null;
    const prevWarnings = this.runtimeWarningsByStudent[key] instanceof Set ? this.runtimeWarningsByStudent[key] : null;

    const hasChanged = (() => {
      if (!prevWarnings && !nextWarnings) return false;
      if (!prevWarnings || !nextWarnings) return true;
      if (prevWarnings.size !== nextWarnings.size) return true;
      for (const warning of prevWarnings) {
        if (!nextWarnings.has(warning)) return true;
      }
      return false;
    })();

    if (nextWarnings) {
      this.runtimeWarningsByStudent[key] = nextWarnings;
    } else {
      delete this.runtimeWarningsByStudent[key];
    }

    return hasChanged;
  },

  /**
   * Aggregate the currently active runtime warnings across all students
   * @returns {string[]} Unique runtime warnings still active
   */
  _getRuntimeWarnings() {
    if (!this.runtimeWarningsByStudent) return [];
    const aggregate = new Set();
    for (const warningSet of Object.values(this.runtimeWarningsByStudent)) {
      if (!warningSet) continue;
      if (warningSet instanceof Set) {
        warningSet.forEach((w) => {
          aggregate.add(w);
        });
      } else if (Array.isArray(warningSet)) {
        warningSet.forEach((w) => {
          aggregate.add(w);
        });
      }
    }
    return Array.from(aggregate);
  },

  /**
   * Log runtime warnings once to avoid spamming the console while an outage persists
   * @param {string[]} warningsList - Warning messages returned by the backend
   */
  _logRuntimeWarnings(warningsList) {
    if (!Array.isArray(warningsList) || warningsList.length === 0) return;
    this._runtimeWarningsLogged = this._runtimeWarningsLogged || new Set();
    warningsList.forEach((warning) => {
      if (!this._runtimeWarningsLogged.has(warning)) {
        this._runtimeWarningsLogged.add(warning);
        this._log('warn', `Runtime warning: ${warning}`);
      }
    });
  },

  /**
   * Convert time string or integer to minutes since midnight
   * Supports multiple formats:
   *   - "13:50" → 830 minutes
   *   - 1350 → 830 minutes
   *   - "08:15" → 495 minutes
   *
   * @param {string|number} t - Time value to convert
   * @returns {number} Minutes since midnight (NaN if invalid)
   */
  _toMinutes(t) {
    const util = this._getWidgetApi()?.util;
    if (util && typeof util.toMinutesSinceMidnight === 'function') {
      return util.toMinutesSinceMidnight(t);
    }
    if (t === null || t === undefined) return NaN;
    const s = String(t).trim();
    if (s.includes(':')) {
      const parts = s.split(':').map((p) => p.replace(/\D/g, ''));
      const hh = parseInt(parts[0], 10) || 0;
      const mm = parseInt(parts[1] || '0', 10) || 0;
      return hh * 60 + mm;
    }
    const digits = s.replace(/\D/g, '').padStart(4, '0');
    const hh = parseInt(digits.slice(0, 2), 10) || 0;
    const mm = parseInt(digits.slice(2), 10) || 0;
    return hh * 60 + mm;
  },

  /**
   * Merge module-level warnings with metadata.
   *
   * @param {string[]} warnings - Warning messages
   * @param {Object[]} warningMeta - Optional warning metadata entries
   * @param {Object} [fallbackMeta] - Meta used when no entry exists for a message
   */
  _upsertModuleWarnings(warnings = [], warningMeta = [], fallbackMeta = { kind: 'config', severity: 'warning' }) {
    this.moduleWarningsSet = this.moduleWarningsSet || new Set();
    this.moduleWarningMetaByMessage = this.moduleWarningMetaByMessage || new Map();

    const metaByMessage = new Map();
    if (Array.isArray(warningMeta)) {
      warningMeta.forEach((entry) => {
        if (!entry?.message) return;
        metaByMessage.set(String(entry.message), entry);
      });
    }

    (Array.isArray(warnings) ? warnings : []).forEach((warning) => {
      const message = String(warning || '').trim();
      if (!message) return;
      this.moduleWarningsSet.add(message);

      const nextMeta = metaByMessage.get(message) || { message, ...fallbackMeta };
      const prevMeta = this.moduleWarningMetaByMessage.get(message);
      if (!prevMeta || prevMeta.kind === 'generic') {
        this.moduleWarningMetaByMessage.set(message, { message, ...nextMeta });
      }
    });
  },

  _isCriticalModuleWarning(message) {
    const meta = this.moduleWarningMetaByMessage?.get(String(message));
    return meta?.severity === 'critical' || meta?.level === 'error';
  },

  /**
   * Return true when warning metadata marks at least one warning as critical.
   *
   * @param {string[]} warnings - Warning messages
   * @param {Object[]} warningMeta - Warning metadata from payload
   * @returns {boolean} True if any warning is marked critical by metadata
   */
  _hasCriticalWarningMeta(warnings = [], warningMeta = []) {
    if (!Array.isArray(warnings) || warnings.length === 0) return false;
    const criticalKinds = new Set(['network', 'auth', 'server']);
    const metaByMessage = new Map();
    if (Array.isArray(warningMeta)) {
      warningMeta.forEach((entry) => {
        if (!entry?.message) return;
        metaByMessage.set(String(entry.message), entry);
      });
    }

    return warnings.some((warning) => {
      const meta = metaByMessage.get(String(warning));
      if (!meta) return false;
      return meta.severity === 'critical' || meta.level === 'error' || criticalKinds.has(String(meta.kind || ''));
    });
  },

  /**
   * Detect critical API failures deterministically from API status + fetch flags.
   *
   * @param {Object} apiStatus - payload.state.api
   * @param {Object} fetchFlags - payload.state.fetch
   * @returns {boolean} True if at least one fetched API reports a critical status
   */
  _hasCriticalApiStatus(apiStatus = {}, fetchFlags = {}) {
    const checks = [
      { enabled: fetchFlags.timetable, status: apiStatus.timetable },
      { enabled: fetchFlags.exams, status: apiStatus.exams },
      { enabled: fetchFlags.homework, status: apiStatus.homework },
      { enabled: fetchFlags.absences, status: apiStatus.absences },
      { enabled: fetchFlags.messages, status: apiStatus.messages },
    ];

    return checks.some(({ enabled, status }) => {
      if (enabled !== true) return false;
      const numericStatus = Number(status);
      if (!Number.isFinite(numericStatus)) return false;
      // Treat unknown/connectivity (0), auth, rate-limit, and 5xx as critical.
      return numericStatus === 0 || numericStatus === 401 || numericStatus === 429 || numericStatus >= 500;
    });
  },

  /**
   * Network-only textual fallback for paths where the backend receives plain
   * text network errors without structured metadata.
   *
   * @param {string[]} warnings - Array of warning messages
   * @returns {boolean} True if any warning matches known network text variants
   */
  _hasNetworkTextFallback(warnings = [], warningMeta = []) {
    if (!Array.isArray(warnings) || warnings.length === 0) return false;
    const classifiedWarnings = new Set();
    if (Array.isArray(warningMeta)) {
      warningMeta.forEach((entry) => {
        if (entry?.message) classifiedWarnings.add(String(entry.message));
      });
    }

    const pattern = /(cannot connect|cannot reach|fetch failed|network error|timeout|econnrefused|enotfound|ehostunreach)/i;
    // Fallback should only apply where no structured metadata exists for that warning.
    return warnings.some((w) => {
      const message = String(w);
      if (classifiedWarnings.has(message)) return false;
      return pattern.test(message);
    });
  },

  /**
   * Normalize runtime warnings against current effective data and API status.
   *
   * Goals:
   * - Remove stale "No <type> found..." warnings if data for that type exists again.
   * - Remove stale critical connection/auth warnings when all fetched APIs are healthy (2xx).
   *
   * @param {string[]} warningsList - Raw warnings from backend payload
   * @param {Object} context - Runtime context
   * @param {Object} context.effectiveData - Effective data arrays after preserve logic
   * @param {Object} context.apiStatus - API status object from payload.state.api
   * @param {Object} context.fetchFlags - Fetch flags object from payload.state.fetch
   * @returns {string[]} Normalized warnings
   */
  _normalizeRuntimeWarnings(warningsList, context = {}) {
    if (!Array.isArray(warningsList) || warningsList.length === 0) return [];

    const effectiveData = context.effectiveData || {};
    const apiStatus = context.apiStatus || {};
    const fetchFlags = context.fetchFlags || {};
    const warningMeta = Array.isArray(context.warningMeta) ? context.warningMeta : [];

    const metaByMessage = new Map();
    warningMeta.forEach((entry) => {
      const message = String(entry?.message || '');
      if (!message) return;
      metaByMessage.set(message, entry);
    });

    const typeAlias = {
      lesson: 'lessons',
      lessons: 'lessons',
      exam: 'exams',
      exams: 'exams',
      homework: 'homework',
      homeworks: 'homework',
      absence: 'absences',
      absences: 'absences',
      message: 'messages',
      messages: 'messages',
      messagesofday: 'messages',
    };

    const isStatusOk = (status) => {
      const numericStatus = Number(status);
      return Number.isFinite(numericStatus) && numericStatus >= 200 && numericStatus < 300;
    };

    const fetchedApiChecks = [
      { enabled: fetchFlags.timetable, status: apiStatus.timetable },
      { enabled: fetchFlags.exams, status: apiStatus.exams },
      { enabled: fetchFlags.homework, status: apiStatus.homework },
      { enabled: fetchFlags.absences, status: apiStatus.absences },
      { enabled: fetchFlags.messages, status: apiStatus.messages },
    ].filter((entry) => entry.enabled === true);

    const allFetchedApisHealthy = fetchedApiChecks.length > 0 && fetchedApiChecks.every((entry) => isStatusOk(entry.status));

    return warningsList.filter((warning) => {
      const warningText = String(warning || '');
      const warningMetaEntry = metaByMessage.get(warningText) || null;

      if (warningMetaEntry?.kind === 'config') {
        return true;
      }

      if (warningMetaEntry?.kind === 'no_data') {
        const canonicalType =
          typeAlias[String(warningMetaEntry.dataType || '').toLowerCase()] || String(warningMetaEntry.dataType || '').toLowerCase();
        const currentData = effectiveData[canonicalType];
        if (Array.isArray(currentData) && currentData.length > 0) {
          return false;
        }
        return true;
      }

      // For generic API warnings, rely on API status health instead of text patterns.
      if (allFetchedApisHealthy) {
        return false;
      }

      return true;
    });
  },

  /**
   * Decide whether to preserve previous data when new data is empty or fetch failed
   * Preserves data if:
   *   - Previous data exists AND new data is empty
   *   - Data type wasn't fetched (fetchFlag=false)
   *   - API returned error status (>= 400 or 0)
   *   - Warnings contain critical errors (auth, connection)
   *
   * This prevents blank widgets during temporary API outages
   *
   * @param {Array} nextData - New data from backend
   * @param {Array} prevData - Previous cached data
   * @param {boolean} fetchFlag - Whether this data type was actually fetched
   * @param {number} status - HTTP status code from the specific API
   * @param {string[]} warnings - Warning messages from fetch
   * @param {Object[]} warningMeta - Structured warning metadata from payload
   * @param {Object} apiStatus - Aggregate API status snapshot from payload
   * @param {Object} fetchFlags - Aggregate fetch flags from payload
   * @returns {boolean} True if previous data should be preserved
   */
  _shouldPreserveData(nextData, prevData, fetchFlag, status, warnings, warningMeta = [], apiStatus = {}, fetchFlags = {}) {
    const nextIsArray = Array.isArray(nextData);
    const prevIsArray = Array.isArray(prevData);
    const nextEmpty = nextIsArray && nextData.length === 0;
    const prevHasData = prevIsArray && prevData.length > 0;

    if (!prevHasData) return false;
    if (!nextEmpty) return false;

    if (fetchFlag === false) return true;

    const numericStatus = Number(status);
    const isBadStatus = Number.isFinite(numericStatus) && (numericStatus === 0 || numericStatus >= 400);
    const hasCriticalMeta = this._hasCriticalWarningMeta(warnings, warningMeta);
    const hasNetworkFallbackWarning = this._hasNetworkTextFallback(warnings, warningMeta);
    const timetableCanaryStatus = Number(apiStatus?.timetable);
    const hasCriticalTimetableCanaryFailure =
      fetchFlags?.timetable !== true &&
      Number.isFinite(timetableCanaryStatus) &&
      (timetableCanaryStatus === 0 || timetableCanaryStatus === 401 || timetableCanaryStatus === 429 || timetableCanaryStatus >= 500);

    return isBadStatus || hasCriticalMeta || hasNetworkFallbackWarning || hasCriticalTimetableCanaryFailure;
  },

  /**
   * Build the widget renderer map used by getDom().
   *
   * @param {HTMLElement} wrapper - Module wrapper element.
   * @param {string[]} studentTitles - Sorted student titles.
   * @param {Function} appendWidgetError - Shared widget error renderer.
   * @returns {Object<string, Function>} Widget render functions by display key.
   */
  _createWidgetRenderers(wrapper, studentTitles, appendWidgetError) {
    const renderPluginWidget = (pluginId, widgetLabel) => {
      if (!this._isPluginActive(pluginId)) {
        this._log('warn', `[plugins] ${pluginId} is not active; skipping ${widgetLabel} render path.`);
        return 0;
      }
      try {
        const pluginElement = this._renderFrontendPluginWidget(pluginId, studentTitles);
        if (pluginElement) {
          wrapper.appendChild(pluginElement);
          return 1;
        }
      } catch (error) {
        appendWidgetError(widgetLabel, error);
      }
      return 0;
    };

    return {
      grid: () => renderPluginWidget('grid', 'Grid'),
      lessons: () => renderPluginWidget('lessons', 'Lessons'),
      exams: () => renderPluginWidget('exams', 'Exams'),
      homework: () => renderPluginWidget('homework', 'Homework'),
      absences: () => renderPluginWidget('absences', 'Absences'),
      messagesofday: () => renderPluginWidget('messagesofday', 'Messages of Day'),
    };
  },

  /**
   * Module initialization - called by MagicMirror at startup
   *
   * Performs:
   *   1. Store log level in global config for widget access
   *   2. Initialize data storage structures (timetableByStudent, examsByStudent, etc.)
   *   3. Generate unique session ID for browser window isolation
   *   4. Parse and set debugDate if configured (frozen date for testing)
   *   5. Request INIT_MODULE once DOM is ready (DOM_OBJECTS_CREATED),
   *      with resume() and startup fallback as safety nets
   *
   * Multi-instance support: Each instance should have a unique identifier in config.js
   */
  start() {
    this._sessionId = this._generateSessionId(9);

    // Multi-instance support via explicit identifiers.
    // For multiple MMM-Webuntis instances, you MUST add unique 'identifier' fields in config.js:
    // { module: 'MMM-Webuntis', identifier: 'student_alice', position: '...', config: { ... } }
    // Without explicit identifiers, MagicMirror will auto-assign them (MMM-Webuntis_0, MMM-Webuntis_1, etc)
    if (this.identifier) {
      this._log('debug', `[start] Using explicit identifier from config: ${this.identifier}`);
    } else {
      this._log('warn', '[start] No explicit identifier set. For multiple instances, add "identifier" to module config in config.js');
    }
    this._log('info', `[start] identifier="${this.identifier}", sessionId="${this._sessionId}" (memory-only, unique per window)`);

    if (typeof window !== 'undefined') {
      window.MMMWebuntisConfig = window.MMMWebuntisConfig || {};
      window.MMMWebuntisConfig.logLevel = this.config.logLevel || this.defaults.logLevel || 'info';
    }

    try {
      if (!this.config.language && typeof config !== 'undefined' && config?.language) {
        this.config.language = config.language;
      }
    } catch (err) {
      // Language config is optional; ignore errors silently
      this._log('debug', `[init] Failed to apply language config: ${err?.message}`);
    }

    const startDateContext = this.getCurrentDateContext();
    this._currentTodayYmd = startDateContext.ymd;
    if (startDateContext.isDebug) {
      this._log('debug', `[start] debugDate="${startDateContext.isoDate}" (frozen test mode)`);
    }

    this.timetableByStudent = {};
    this.dayNoticesByStudent = {};
    this.examsByStudent = {};
    this.configByStudent = {};
    this.timeUnitsByStudent = {};
    this.periodNamesByStudent = {};
    this.homeworksByStudent = {};
    this.absencesByStudent = {};
    this.messagesOfDayByStudent = {};
    this.holidaysByStudent = {};
    this.holidayMapByStudent = {};
    this.dayNoticeMapByStudent = {};
    this.preprocessedByStudent = {};

    this.moduleWarningsSet = new Set();
    this.moduleWarningMetaByMessage = new Map();
    this.runtimeWarningsByStudent = {};
    this._runtimeWarningStreakByStudent = {};
    this._runtimeWarningsLogged = new Set();
    this._pluginRegistryById = new Map();
    this._pluginAssetStateById = new Map();
    this._frontendPluginInstancesById = new Map();

    this._updateDomTimer = null;
    this._initialized = false;
    this._initRequested = false;
    this._initFallbackTimer = null;
    this._initWatchdogTimer = null;
    this._initAttemptCount = 0;
    this._deferredInitRetryTimer = null;
    this._deferredInitRetryCount = 0;

    this._lastDataReceivedAt = null;

    this._paused = this._isModuleSuspended();
    if (this._paused) {
      this._log('debug', '[start] Module starts hidden/suspended, deferring timers until resume()');
    } else {
      this._startNowLineUpdater();
    }
    this._sendSessionState(this._paused ? 'paused' : 'active', 'start');

    if (this._isDemoModeEnabled()) {
      this._initialized = true;
      this._initializedAt = Date.now();
      this._log('info', `[DEMO] Enabled with fixture "${this.config.demoDataFile}"`);
      this._emitDemoPayload('start');
      this._startFetchTimer();
      return;
    }

    this._initFallbackTimer = setTimeout(() => {
      this._initFallbackTimer = null;
      this._requestInitIfNeeded('start-fallback');
    }, 2500);

    this._log('info', 'MMM-Webuntis initializing with config:', this.config);
  },

  /**
   * Start the now line updater for grid view
   * The now line shows current time position in the grid widget
   * Only starts if showNowLine config is not explicitly disabled
   */
  _startNowLineUpdater() {
    if (this.config?.grid?.showNowLine === false) return;
    const fn = this._getWidgetApi()?.grid?.startNowLineUpdater;
    if (typeof fn === 'function') fn(this);
  },

  /**
   * Stop the now line updater for grid view
   * Called during suspend() to stop unnecessary timer updates
   */
  _stopNowLineUpdater() {
    const fn = this._getWidgetApi()?.grid?.stopNowLineUpdater;
    if (typeof fn === 'function') fn(this);
  },

  /**
   * Check whether module is currently hidden/suspended by MagicMirror
   *
   * @returns {boolean} True if module should be treated as suspended
   */
  _isModuleSuspended() {
    return this._paused === true || this.hidden === true || this.data?.hidden === true;
  },

  /**
   * Start periodic data fetch timer
   * Sends FETCH_DATA to backend at configured updateInterval
   * Timer is skipped if module is paused or interval is invalid
   */
  _startFetchTimer() {
    if (this._isModuleSuspended()) {
      this._paused = true;
      return;
    }
    if (this._fetchTimer) return;
    const interval = typeof this.config?.updateInterval === 'number' ? Number(this.config.updateInterval) : null;
    if (!interval || !Number.isFinite(interval) || interval <= 0) return;

    this._fetchTimer = setInterval(() => {
      if (this._isModuleSuspended()) {
        this._paused = true;
        this._stopFetchTimer();
        return;
      }
      this._sendFetchData('periodic');
    }, interval);
  },

  /**
   * Notify backend about current session visibility state
   *
   * @param {'paused'|'active'} state - Session state from frontend lifecycle
   * @param {string} reason - Lifecycle reason
   */
  _sendSessionState(state, reason = 'manual') {
    this.sendSocketNotification('SESSION_STATE', {
      id: this.identifier,
      sessionId: this._sessionId,
      state,
      reason,
    });
  },

  /**
   * Send INIT_MODULE notification to backend
   * Triggers one-time module initialization (config validation, student discovery)
   * Backend responds with MODULE_INITIALIZED when ready
   *
   * @param {string} reason - Reason for initialization trigger
   */
  _sendInit(reason = 'manual') {
    this._initAttemptCount += 1;
    this._log('debug', `[INIT] Sending INIT_MODULE to backend (reason=${reason})`);
    this.sendSocketNotification('INIT_MODULE', {
      ...this._buildSendConfig(),
      reason,
    });
    this._armInitWatchdog();
  },

  /**
   * Arm a watchdog for the init handshake and retry when MODULE_INITIALIZED is missing.
   */
  _armInitWatchdog() {
    const configuredTimeout = Number(this.config?.initRetryTimeout);
    const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1000, Math.floor(configuredTimeout)) : 5000;
    const configuredMaxAttempts = Number(this.config?.initRetryMaxAttempts);
    const maxAttempts = Number.isFinite(configuredMaxAttempts) ? Math.max(1, Math.floor(configuredMaxAttempts)) : 4;

    if (this._initWatchdogTimer) {
      clearTimeout(this._initWatchdogTimer);
      this._initWatchdogTimer = null;
    }

    this._initWatchdogTimer = setTimeout(() => {
      this._initWatchdogTimer = null;
      if (this._initialized || !this._initRequested) return;

      if (this._initAttemptCount >= maxAttempts) {
        this._log(
          'warn',
          `[INIT] Watchdog reached max retries (${maxAttempts}) without MODULE_INITIALIZED; reopening init gate for next trigger`
        );
        this._initRequested = false;
        this._initAttemptCount = 0;
        return;
      }

      const nextAttempt = this._initAttemptCount + 1;
      this._log('warn', `[INIT] No MODULE_INITIALIZED within ${timeoutMs}ms, retrying INIT_MODULE (attempt ${nextAttempt}/${maxAttempts})`);
      this._sendInit(`retry-timeout-${nextAttempt}`);
    }, timeoutMs);
  },

  /**
   * Request backend initialization exactly once when needed.
   * Safe to call from multiple lifecycle hooks.
   *
   * @param {string} reason - Why init is requested
   */
  _requestInitIfNeeded(reason = 'manual') {
    if (this._isDemoModeEnabled()) return;
    if (this._initialized || this._initRequested) return;
    this._initRequested = true;
    this._initAttemptCount = 0;
    this._sendInit(reason);
  },

  /**
   * Retry init after DOM_OBJECTS_CREATED when module starts hidden (e.g. MMM-Carousel).
   * Retries only while still uninitialized and never sends init while suspended.
   */
  _scheduleDeferredInitRetry(reason = 'dom-objects-created-hidden') {
    if (this._isDemoModeEnabled()) return;
    if (this._initialized || this._initRequested) return;

    const configuredTimeout = Number(this.config?.initRetryTimeout);
    const intervalMs = Number.isFinite(configuredTimeout) ? Math.max(1000, Math.floor(configuredTimeout)) : 5000;
    const configuredMaxAttempts = Number(this.config?.initRetryMaxAttempts);
    const baseMaxAttempts = Number.isFinite(configuredMaxAttempts) ? Math.max(1, Math.floor(configuredMaxAttempts)) : 4;
    const maxDeferredAttempts = Math.max(baseMaxAttempts * 6, 12);

    if (this._deferredInitRetryTimer) {
      clearTimeout(this._deferredInitRetryTimer);
      this._deferredInitRetryTimer = null;
    }

    this._deferredInitRetryTimer = setTimeout(() => {
      this._deferredInitRetryTimer = null;

      if (this._initialized || this._initRequested) return;

      this._deferredInitRetryCount += 1;
      if (!this._isModuleSuspended()) {
        this._log('info', `[INIT] Deferred init retry successful (attempt ${this._deferredInitRetryCount}/${maxDeferredAttempts})`);
        this._requestInitIfNeeded(`${reason}-retry-${this._deferredInitRetryCount}`);
        return;
      }

      if (this._deferredInitRetryCount >= maxDeferredAttempts) {
        this._log('warn', `[INIT] Deferred init retries exhausted (${maxDeferredAttempts}) while hidden; waiting for resume()`);
        return;
      }

      this._scheduleDeferredInitRetry(reason);
    }, intervalMs);
  },

  /**
   * Send FETCH_DATA notification to backend for data refresh
   * Only sends if module is initialized (prevents fetch before init)
   * Stores pending resume request if called during initialization
   *
   * @param {string} reason - Reason for fetch ('manual', 'periodic', 'resume')
   */
  _sendFetchData(reason = 'manual') {
    if (this._isDemoModeEnabled()) {
      this._emitDemoPayload(reason);
      return;
    }

    // Hard guard: never send FETCH_DATA while module is suspended/paused.
    // This covers timer race conditions where a queued callback might still fire
    // right around suspend().
    if (this._paused) {
      this._log('debug', `[FETCH_DATA] Skipped while suspended (reason=${reason})`);
      return;
    }

    if (!this._initialized) {
      if (String(reason).startsWith('resume')) {
        this._pendingResumeRequest = true;
      }
      return;
    }

    this.sendSocketNotification('FETCH_DATA', {
      ...this._buildSendConfig(),
      reason,
    });
  },

  /**
   * Stop periodic data fetch timer
   * Called during suspend() to stop unnecessary fetch attempts
   */
  _stopFetchTimer() {
    if (this._fetchTimer) {
      clearInterval(this._fetchTimer);
      this._fetchTimer = null;
    }
  },

  /**
   * Suspend module - called by MagicMirror when module becomes hidden
   * Stops all timers to reduce unnecessary processing:
   *   - Now line updater (grid widget)
   *   - Periodic fetch timer
   *   - DOM update batching timer
   */
  suspend() {
    this._log('info', '[suspend] Module suspended');
    this._paused = true;
    this._stopNowLineUpdater();
    this._stopFetchTimer();

    if (this._updateDomTimer) {
      clearTimeout(this._updateDomTimer);
      this._updateDomTimer = null;
    }

    this._sendSessionState('paused', 'suspend');
  },

  /**
   * Resume module - called by MagicMirror when module becomes visible
   *
   * Performs:
   *   1. Aborts immediately if module is secretly hidden (e.g. MMM-Carousel background loading)
   *   2. Starts visual timers and background data loops
   *   3. Detects midnight/date rollovers across sleep
   *   4. Lazily triggers initialization OR smart-fetches stale data if needed
   */
  resume() {
    this._log('debug', `[resume] Module resumed (hidden=${this.hidden}, config.debugDate=${this.config?.debugDate})`);

    if (this.hidden === true || this.data?.hidden === true) {
      this._paused = true;
      this._sendSessionState('paused', 'resume-while-hidden');
      return;
    }

    this._paused = false;
    this._sendSessionState('active', 'resume');

    this._startFetchTimer();
    this._startNowLineUpdater();

    const resumeDateContext = this.getCurrentDateContext();
    if (this._usesLiveClock(resumeDateContext)) {
      if (this._currentTodayYmd !== resumeDateContext.ymd) {
        this._log('debug', `[resume] Detected day change while suspended: ${this._currentTodayYmd || 'unset'} -> ${resumeDateContext.ymd}`);
        this._currentTodayYmd = resumeDateContext.ymd;
      }
    }

    if (!this._initialized && !this._initRequested) {
      this._requestInitIfNeeded('first-visible-resume');
      return;
    }

    const hasReceivedData = Number.isFinite(this._lastDataReceivedAt);
    const dataAge = hasReceivedData ? Date.now() - this._lastDataReceivedAt : Infinity;
    const interval = this.config?.updateInterval || 5 * 60 * 1000;

    if (!hasReceivedData) {
      this._log('debug', '[resume] No data received yet in this session, sending FETCH_DATA...');
      this._sendFetchData('resume-no-data');
    } else if (dataAge >= interval) {
      this._log('debug', `[resume] Data is stale (age=${Math.round(dataAge / 1000)}s), sending FETCH_DATA...`);
      this._sendFetchData('resume-stale-data');
    } else {
      this._log(
        'debug',
        `[resume] Data is fresh (age=${Math.round(dataAge / 1000)}s < ${Math.round(interval / 1000)}s), skipping duplicate fetch`
      );
    }
  },

  getDom() {
    const wrapper = document.createElement('div');
    wrapper.className = 'MMM-Webuntis';
    const widgets = this._getDisplayWidgets();
    let renderedWidgetCount = 0;
    const withWarningIcon = (element, text) => {
      const icon = document.createElement('span');
      icon.className = 'wu-inline-icon wu-inline-icon--warning';
      icon.setAttribute('aria-hidden', 'true');
      element.replaceChildren(icon, document.createTextNode(` ${text}`));
    };
    const appendEmptyState = () => {
      if (renderedWidgetCount > 0) return;
      const infoDiv = document.createElement('div');
      infoDiv.className = 'wu-widget__info dimmed';
      withWarningIcon(infoDiv, this.translate('no_data'));
      wrapper.appendChild(infoDiv);
    };

    const sortedStudentTitles = this._getSortedStudentTitles();

    const appendWidgetError = (widgetLabel, error) => {
      this._log('error', `Failed to render ${widgetLabel.toLowerCase()} widget: ${error.message}`);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'wu-widget__error widget-error dimmed';
      withWarningIcon(errorDiv, this.translate('widget_render_error', { widget: widgetLabel }));
      wrapper.appendChild(errorDiv);
    };

    if (this.moduleWarningsSet && this.moduleWarningsSet.size > 0) {
      const warnContainer = document.createDocumentFragment();
      for (const w of Array.from(this.moduleWarningsSet)) {
        const warnDiv = document.createElement('div');
        const isCritical = this._isCriticalModuleWarning(w);
        warnDiv.className = isCritical ? 'mmm-webuntis-warning critical small bright' : 'mmm-webuntis-warning small bright';
        try {
          withWarningIcon(warnDiv, w);
        } catch {
          withWarningIcon(warnDiv, 'Configuration warning');
        }
        warnContainer.appendChild(warnDiv);
      }
      wrapper.appendChild(warnContainer);
    }

    const runtimeWarnings = this._getRuntimeWarnings();
    if (runtimeWarnings.length > 0) {
      const runtimeContainer = document.createDocumentFragment();
      for (const warning of runtimeWarnings) {
        const warnDiv = document.createElement('div');
        warnDiv.className = 'mmm-webuntis-warning runtime small bright';
        try {
          withWarningIcon(warnDiv, warning);
        } catch {
          withWarningIcon(warnDiv, 'Fetch warning');
        }
        runtimeContainer.appendChild(warnDiv);
      }
      wrapper.appendChild(runtimeContainer);
    }

    const widgetRenderers = this._createWidgetRenderers(wrapper, sortedStudentTitles, appendWidgetError);

    for (const widget of widgets) {
      const renderWidget = widgetRenderers[widget];
      if (typeof renderWidget !== 'function') {
        this._log('warn', `Unknown widget type: ${widget}`);
        continue;
      }
      renderedWidgetCount += renderWidget() || 0;
    }

    appendEmptyState();

    return wrapper;
  },

  notificationReceived(notification) {
    if (notification === 'DOM_OBJECTS_CREATED') {
      if (this.config.__legacyUsed && this.config.__legacyUsed.length > 0) {
        this._log('warn', `⚠️ DEPRECATED CONFIG DETECTED: ${this.config.__legacyUsed.join(', ')}`);
        this._log('warn', 'Your configuration uses deprecated keys that will be removed in future versions.');
        this._log('warn', 'Please update your config.js to use the new configuration format.');
        this._log('warn', 'See the module documentation for migration details.');
      }

      if (this._isModuleSuspended()) {
        this._log('debug', '[INIT] DOM_OBJECTS_CREATED received while hidden, deferring init with retry');
        this._deferredInitRetryCount = 0;
        this._scheduleDeferredInitRetry('dom-objects-created-hidden');
        return;
      }

      this._requestInitIfNeeded('dom-objects-created');
    }
  },

  socketNotificationReceived(notification, payload) {
    if (!this._isValidTargetInstance(payload)) return;

    switch (notification) {
      case 'MODULE_INITIALIZED':
        this._handleModuleInitialized(payload);
        break;

      case 'INIT_ERROR':
        this._handleInitError(payload);
        break;

      case 'CONFIG_WARNING':
      case 'CONFIG_ERROR':
        this._handleConfigIssues(payload);
        break;

      case 'GOT_DATA':
        this._handleGotData(payload);
        break;

      default:
        break;
    }
  },

  /**
   * Ensure the payload matches the current module instance's sessionId or identifier
   */
  _isValidTargetInstance(payload) {
    if (payload?.sessionId && this._sessionId !== payload.sessionId) return false;
    if (payload?.id && !payload?.sessionId && this.identifier !== payload.id) return false;
    return true;
  },

  _handleModuleInitialized(payload) {
    if (this._initialized) {
      this._log('debug', `[MODULE_INITIALIZED] sessionId=${payload?.sessionId} Already initialized, ignoring duplicate notification`);
      return;
    }

    this._log('info', `Module initialized successfully, sessionId=${payload?.sessionId}`);
    this._initialized = true;
    this._initRequested = false;
    this._initializedAt = Date.now();

    if (this._initFallbackTimer) {
      clearTimeout(this._initFallbackTimer);
      this._initFallbackTimer = null;
    }
    if (this._initWatchdogTimer) {
      clearTimeout(this._initWatchdogTimer);
      this._initWatchdogTimer = null;
    }
    if (this._deferredInitRetryTimer) {
      clearTimeout(this._deferredInitRetryTimer);
      this._deferredInitRetryTimer = null;
    }
    this._initAttemptCount = 0;
    this._deferredInitRetryCount = 0;

    if (this._pendingResumeRequest) {
      this._log('debug', '[MODULE_INITIALIZED] Clearing pending resume request (backend handles initial fetch)');
      this._pendingResumeRequest = false;
    }

    if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
      this._upsertModuleWarnings(payload.warnings, payload.warningMeta, { kind: 'config', severity: 'warning' });
      payload.warnings.forEach((w) => {
        this._log('warn', `Init warning: ${w}`);
      });
    }

    this._setPluginRegistry(payload?.plugins || []);
    this._initializeActivePlugins(payload?.plugins || []).catch((error) => {
      this._log('error', `[plugins] initialization failed: ${error?.message || String(error)}`);
    });

    this._log('debug', '[MODULE_INITIALIZED] Backend will auto-fetch data, starting periodic timer only');
    this._startFetchTimer();
  },

  _handleInitError(payload) {
    this._log('error', `Module initialization failed (sessionId=${payload?.sessionId}):`, payload.message || 'Unknown error');
    if (Array.isArray(payload.errors)) {
      payload.errors.forEach((err) => {
        this._log('error', `  - ${err}`);
      });
    }
    if (Array.isArray(payload.warnings)) {
      payload.warnings.forEach((warn) => {
        this._log('warn', `  - ${warn}`);
      });
    }

    const errorWarnings = Array.isArray(payload.errors) ? payload.errors : [];
    const errorWarningMeta = errorWarnings.map((message) => ({
      message: String(message),
      kind: 'config',
      severity: 'critical',
    }));
    this._upsertModuleWarnings(errorWarnings, errorWarningMeta, { kind: 'config', severity: 'critical' });

    if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
      this._upsertModuleWarnings(payload.warnings, payload.warningMeta, { kind: 'config', severity: 'warning' });
    }

    this._initialized = false;
    this._initRequested = false;
    if (this._initWatchdogTimer) {
      clearTimeout(this._initWatchdogTimer);
      this._initWatchdogTimer = null;
    }
    if (this._deferredInitRetryTimer) {
      clearTimeout(this._deferredInitRetryTimer);
      this._deferredInitRetryTimer = null;
    }
    this._initAttemptCount = 0;
    this._deferredInitRetryCount = 0;
    this.updateDom();
  },

  _handleConfigIssues(payload) {
    const warnList = Array.isArray(payload?.warnings) ? payload.warnings : [];
    this._upsertModuleWarnings(warnList, payload?.warningMeta, { kind: 'config', severity: 'warning' });
    warnList.forEach((w) => {
      this._log('warn', `Config warning: ${w}`);
    });
    this.updateDom();
  },

  _handleGotData(payload) {
    if (Number(payload?.contractVersion) !== 3) {
      this._log('warn', `[GOT_DATA] Ignored unsupported contractVersion=${payload?.contractVersion}`);
      return;
    }

    const title = payload?.context?.student?.title;
    if (!title) {
      this._log('warn', '[GOT_DATA] Missing context.student.title in payload, handling as module-level warning payload');
      this._processGotDataWarnings('__module__', payload);

      if (this._updateDomTimer) {
        clearTimeout(this._updateDomTimer);
        this._updateDomTimer = null;
      }
      this.updateDom();
      return;
    }

    this._log('debug', `[GOT_DATA] Received for student=${title}, sessionId=${payload?.sessionId}`);
    this._lastDataReceivedAt = Date.now();
    this.configByStudent[title] = payload?.context?.config || {};

    this._syncDebugDate(this.configByStudent[title]);
    const dataChanged = this._processPayloadData(title, payload);
    const warningsChanged = this._processGotDataWarnings(title, payload);

    if (this._updateDomTimer) {
      clearTimeout(this._updateDomTimer);
      this._updateDomTimer = null;
    }
    if (dataChanged || warningsChanged) {
      this.updateDom();
    } else {
      this._log('debug', `[GOT_DATA] Skipping DOM update for ${title}: no effective data/warning changes`);
    }
  },

  _syncDebugDate(cfg) {
    this._log('debug', `[GOT_DATA] Before filter: _currentTodayYmd=${this._currentTodayYmd}, cfg.debugDate=${cfg?.debugDate}`);
    const debugDateContext = this.getCurrentDateContext(cfg || {});
    if (debugDateContext.isDebug) {
      this._log('debug', `[GOT_DATA] Using debugDate="${debugDateContext.isoDate}" from backend`);
      this._currentTodayYmd = debugDateContext.ymd;
      this._log('debug', `[GOT_DATA] Updated _currentTodayYmd=${debugDateContext.ymd} (before timetable filtering)`);
    } else {
      this._log('debug', `[GOT_DATA] No debugDate in cfg, keeping _currentTodayYmd=${this._currentTodayYmd}`);
    }
  },

  _processPayloadData(title, payload) {
    let dataChanged = false;
    const apiStatus = payload?.state?.api || {};
    const fetchFlags = payload?.state?.fetch || {};
    const warningsList = Array.isArray(payload?.state?.warnings) ? payload.state.warnings : [];
    const warningMeta = Array.isArray(payload?.state?.warningMeta) ? payload.state.warningMeta : [];

    let timeUnits = [];
    try {
      if (Array.isArray(payload?.data?.timeUnits)) {
        timeUnits = payload.data.timeUnits.map((u) => ({
          startTime: u.startTime ?? u.start,
          endTime: u.endTime ?? u.end,
          startMin: this._toMinutes(u.startTime ?? u.start),
          endMin: (u.endTime ?? u.end) ? this._toMinutes(u.endTime ?? u.end) : null,
          name: u.name ?? u.label,
        }));
      }
    } catch (e) {
      this._log('warn', 'failed to build timeUnits from grid', e);
    }

    if (
      !this._shouldPreserveData(
        timeUnits,
        this.timeUnitsByStudent[title] || [],
        fetchFlags.timegrid ?? fetchFlags.timetable ?? true,
        apiStatus.timetable,
        warningsList,
        warningMeta,
        apiStatus,
        fetchFlags
      )
    ) {
      this.timeUnitsByStudent[title] = timeUnits;
      dataChanged = true;
    }

    const periodMap = {};
    (this.timeUnitsByStudent[title] || []).forEach((u) => {
      periodMap[u.startTime] = u.name;
    });
    this.periodNamesByStudent[title] = periodMap;

    const rawLessons = Array.isArray(payload?.data?.lessons) ? payload.data.lessons : [];
    if (
      !this._shouldPreserveData(
        rawLessons,
        this.timetableByStudent[title] || [],
        fetchFlags.timetable ?? true,
        apiStatus.timetable,
        warningsList,
        warningMeta,
        apiStatus,
        fetchFlags
      )
    ) {
      this.timetableByStudent[title] = rawLessons;
      dataChanged = true;
    }
    this._log('debug', `[GOT_DATA] Timetable updated: ${rawLessons.length} total -> ${this.timetableByStudent[title]?.length || 0} valid`);

    const dayNotices = Array.isArray(payload?.data?.dayNotices) ? payload.data.dayNotices : [];
    if (
      !this._shouldPreserveData(
        dayNotices,
        this.dayNoticesByStudent[title] || [],
        fetchFlags.timetable ?? true,
        apiStatus.timetable,
        warningsList,
        warningMeta,
        apiStatus,
        fetchFlags
      )
    ) {
      this.dayNoticesByStudent[title] = dayNotices;
      this.dayNoticeMapByStudent[title] = this._buildDayNoticeMap(dayNotices);
      dataChanged = true;
    }

    const groupedRaw = {};
    (this.timetableByStudent[title] || []).forEach((el) => {
      const key = el && el.date != null ? String(el.date) : null;
      if (!key) return;
      if (!groupedRaw[key]) groupedRaw[key] = [];
      groupedRaw[key].push(el);
    });
    Object.keys(groupedRaw).forEach((k) => {
      groupedRaw[k].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    });
    this.preprocessedByStudent[title] = { ...(this.preprocessedByStudent[title] || {}), rawGroupedByDate: groupedRaw };

    const dataMaps = [
      { key: 'exams', source: payload?.data?.exams, target: this.examsByStudent, flag: fetchFlags.exams, status: apiStatus.exams },
      {
        key: 'homework',
        source: payload?.data?.homework,
        target: this.homeworksByStudent,
        flag: fetchFlags.homework,
        status: apiStatus.homework,
      },
      {
        key: 'absences',
        source: payload?.data?.absences,
        target: this.absencesByStudent,
        flag: fetchFlags.absences,
        status: apiStatus.absences,
      },
      {
        key: 'messages',
        source: payload?.data?.messages,
        target: this.messagesOfDayByStudent,
        flag: fetchFlags.messages,
        status: apiStatus.messages,
      },
    ];

    dataMaps.forEach(({ source, target, flag, status }) => {
      const parsedArray = Array.isArray(source) ? source : [];
      if (
        !this._shouldPreserveData(parsedArray, target[title] || [], flag ?? true, status, warningsList, warningMeta, apiStatus, fetchFlags)
      ) {
        target[title] = parsedArray;
        dataChanged = true;
      }
    });

    const holidays = Array.isArray(payload?.data?.holidays?.ranges) ? payload.data.holidays.ranges : [];
    if (
      !this._shouldPreserveData(
        holidays,
        this.holidaysByStudent[title] || [],
        fetchFlags.timetable ?? true,
        apiStatus.timetable,
        warningsList,
        warningMeta,
        apiStatus,
        fetchFlags
      )
    ) {
      this.holidaysByStudent[title] = holidays;
      this.holidayMapByStudent[title] = this._buildHolidayMapFromRanges(holidays);
      dataChanged = true;
    }

    return dataChanged;
  },

  _processGotDataWarnings(title, payload) {
    const warningsList = Array.isArray(payload?.state?.warnings) ? payload.state.warnings : [];
    const warningMeta = Array.isArray(payload?.state?.warningMeta) ? payload.state.warningMeta : [];

    const warningsAfterNormalization = this._normalizeRuntimeWarnings(warningsList, {
      effectiveData: {
        lessons: this.timetableByStudent[title] || [],
        exams: this.examsByStudent[title] || [],
        homework: this.homeworksByStudent[title] || [],
        absences: this.absencesByStudent[title] || [],
        messages: this.messagesOfDayByStudent[title] || [],
      },
      apiStatus: payload?.state?.api || {},
      fetchFlags: payload?.state?.fetch || {},
      warningMeta,
    });

    const metaByMessage = new Map();
    warningMeta.forEach((entry) => {
      if (entry?.message) metaByMessage.set(String(entry.message), entry);
    });

    const persistentWarnings = warningsAfterNormalization.filter((w) => metaByMessage.get(String(w))?.kind === 'config');
    const debouncedWarnings = warningsAfterNormalization.filter((w) => metaByMessage.get(String(w))?.kind !== 'config');

    const hasAnyDebouncedWarningNow = debouncedWarnings.length > 0;
    const hasCriticalDebouncedWarningNow =
      this._hasCriticalWarningMeta(debouncedWarnings, warningMeta) ||
      this._hasCriticalApiStatus(payload?.state?.api || {}, payload?.state?.fetch || {}) ||
      this._hasNetworkTextFallback(debouncedWarnings, warningMeta);
    const prevRuntimeWarningStreak = Number(this._runtimeWarningStreakByStudent?.[title] || 0);
    const nextRuntimeWarningStreak = hasAnyDebouncedWarningNow ? prevRuntimeWarningStreak + 1 : 0;
    this._runtimeWarningStreakByStudent[title] = nextRuntimeWarningStreak;

    const shouldShowDebouncedNow = hasCriticalDebouncedWarningNow || nextRuntimeWarningStreak >= 2;
    const visibleWarnings = shouldShowDebouncedNow ? [...persistentWarnings, ...debouncedWarnings] : [...persistentWarnings];
    if (hasAnyDebouncedWarningNow && !shouldShowDebouncedNow) {
      this._log('debug', `[GOT_DATA] Warning debounce active for ${title}: delaying runtime warning display until next fetch`);
    }

    let warningsChanged = this._updateRuntimeWarnings(title, visibleWarnings);

    // Recovery cleanup: if we receive a clean student-scoped payload,
    // drop stale module-scoped runtime warnings from earlier title-less payloads.
    if (title !== '__module__' && visibleWarnings.length === 0) {
      warningsChanged = this._updateRuntimeWarnings('__module__', []) || warningsChanged;
      if (this._runtimeWarningStreakByStudent) {
        delete this._runtimeWarningStreakByStudent.__module__;
      }
    }

    this._logRuntimeWarnings(visibleWarnings);
    return warningsChanged;
  },
});
