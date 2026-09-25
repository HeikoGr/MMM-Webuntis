Module.register("MMM-Webuntis", {
  _cacheVersion: "2.0.2",

  defaults: {
    // === GLOBAL OPTIONS ===
    header: "MMM-Webuntis", // displayed as module title in MagicMirror
    updateInterval: 5 * 60 * 1000, // fetch interval in milliseconds (default: 5 minutes)
    backgroundRefresh: true, // keep refreshing while hidden (e.g. under MMM-Carousel)
    quietHours: null, // optional window without polling, e.g. { from: '22:00', to: '06:00' }
    timezone: "Europe/Berlin", // timezone for date calculations

    // === DEBUG OPTIONS ===
    // Optional: none, error, warn, info, debug. Output goes through MagicMirror's Log, so the
    // global logLevel decides; this can only narrow it. Unset (null) = the global level alone.
    logLevel: null,
    debugDate: null, // set to 'YYYY-MM-DD' to freeze the calendar day for debugging (null = disabled)
    demoDataFile: null, // optional fixture path(s), comma-separated: render demo data instead of fetching from WebUntis
    initRetryTimeout: 5000, // timeout for CONFIGURE -> MODULE_READY watchdog (milliseconds)
    initRetryMaxAttempts: 4, // max CONFIGURE attempts before reopening init gate
    dumpBackendPayloads: false, // dump raw payloads from backend in ./debug_dumps/ folder
    dumpRawApiResponses: false, // save raw REST API responses to ./debug_dumps/raw_api_*.json

    // === DISPLAY OPTIONS ===
    // Comma-separated list of widgets to render (top-to-bottom).
    // Supported widgets: grid, lessons, exams, homework, absences, messagesofday
    displayMode: "lessons, exams", // Legacy widget activation string.
    mode: "verbose", // 'verbose' (per-student sections) or 'compact' (combined view)
    useClassTimetable: false, // Prefer class timetable endpoints when available.
    excludeLessons: [], // Hide lessons by subject/student group/lesson text, e.g. ['Förder', '/^AG$/i']; also hides homework and exams of matching subjects (per student: students[].excludeLessons)
    addLessons: [], // Own lessons, e.g. [{ weekday: 'tue', startTime: '15:30', endTime: '16:15', subject: 'Violin', room: 'Music school' }]

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
    // Canonical configuration uses plugins.<pluginId>.{enabled,config}.
    // Per-student overrides can be provided via students[].plugins.<pluginId>.config.
    plugins: {},
  },

  /**
   * Frontend logger factory for widget logging.
   * Uses the runtime utility loaded via getScripts(); _log provides the console fallback.
   *
   * @param {string} moduleName - Module name for log prefixes (default: 'MMM-Webuntis')
   * @returns {Object|null} Logger object with log(level, msg) method, or null if unavailable
   */
  _createFrontendLogger(moduleName = "MMM-Webuntis") {
    if (!globalThis.MMModuleRuntimeUtils?.createLevelLogger) {
      return null;
    }

    return globalThis.MMModuleRuntimeUtils.createLevelLogger({
      prefix: `[${moduleName}]`,
      // This instance's own level, not the window global: two instances may be configured with
      // different logLevels, and the global can only hold one value (see getScripts).
      getLevel: () => this.config?.logLevel,
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
        defaultTimezone: this.defaults?.timezone || "Europe/Berlin",
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
      isoDate: `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      isDebug: false,
      timezone: configOverride?.timezone || this.config?.timezone || this.defaults?.timezone || "Europe/Berlin",
    };
  },

  _usesLiveClock(nowContext = this.getCurrentDateContext()) {
    return nowContext?.isDebug !== true;
  },

  _handleClockDrivenDayRollover(nowContext = this.getCurrentDateContext()) {
    const nextTodayYmd = Number(nowContext?.ymd);
    if (!Number.isFinite(nextTodayYmd) || nextTodayYmd <= 0) return false;
    if (nextTodayYmd === this._currentTodayYmd) return false;
    this._currentTodayYmd = nextTodayYmd;
    return true;
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
      const scopedId = globalThis.MMModuleRuntimeUtils.generateScopedId("wu", length);
      return scopedId.startsWith("wu_") ? scopedId.slice(3) : scopedId;
    }

    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

    const cryptoObj =
      (typeof window !== "undefined" && window.crypto) ||
      (typeof self !== "undefined" && self.crypto) ||
      (typeof crypto !== "undefined" && crypto);

    let result = "";

    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
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

  /**
   * Return array of CSS files to load for this module
   * Called by MagicMirror during module initialization
   *
   * @returns {string[]} Array of CSS file paths
   */
  getStyles() {
    return [this.file("MMM-Webuntis.css")];
  },

  /**
   * Called by MagicMirror during module initialization
   * Return array of JavaScript files to load for this module
   *
   * @returns {string[]} Array of JavaScript file paths
   */
  getScripts() {
    // Shared widget code (lib/frontendShared.js log(), plugin frontends without a renderContext)
    // has no instance to ask, so it reads this global. With two instances there is only one
    // value to hold, and silently taking the last one started would swallow the other one's
    // logs - so keep the most verbose level any instance asked for. Instance-scoped logging
    // (_log, _createFrontendLogger, renderContext.runtime.logLevel) is unaffected by this.
    // Unset ("") means "no own filter" and so ranks above debug.
    const levels = { none: -1, error: 0, warn: 1, info: 2, debug: 3, "": 4 };
    const own = this.config?.logLevel || "";
    const current = window.MMMWebuntisLogLevel;
    if (levels[current] === undefined || (levels[own] ?? 4) > levels[current]) {
      window.MMMWebuntisLogLevel = own;
    }

    const scripts = [
      this.file("lib/mmm-shared/mmm-shared.js"),
      this.file("lib/runtime-utils.js"),
      this.file("lib/pluginHostFrontend.js"),
      this.file("lib/frontendShared.js"),
    ];

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
      en: "translations/en.json",
      de: "translations/de.json",
    };
  },

  _getPluginTranslationEntry(pluginId, key) {
    const translations = this._pluginTranslationsById?.get(String(pluginId || "").trim());
    if (!translations || typeof translations !== "object") return undefined;
    return Object.hasOwn(translations, key) ? translations[key] : undefined;
  },

  _applyTranslationReplacements(template, replacements) {
    const source = String(template ?? "");
    if (!replacements || typeof replacements !== "object" || Array.isArray(replacements)) {
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

    if (!this._hasModuleTranslation(key)) return fallback || key;
    return replacements ? this.translate(key, replacements) : this.translate(key);
  },

  /**
   * Whether MagicMirror knows a translation for `key` (module or core, any loaded language).
   * translate() returns the key itself for a missing entry, so a translation that equals its key
   * ("homework": "homework") can only be told apart by looking it up.
   *
   * @param {string} key - Translation key
   * @returns {boolean} True when a translation exists
   */
  _hasModuleTranslation(key) {
    const translator = typeof Translator !== "undefined" ? Translator : null;
    if (!translator) {
      const translated = this.translate(key);
      return Boolean(translated) && translated !== key;
    }
    return [
      translator.translations?.[this.name],
      translator.coreTranslations,
      translator.translationsFallback?.[this.name],
      translator.coreTranslationsFallback,
    ].some((table) => table && Object.hasOwn(table, key));
  },

  _getPluginTranslationLoadOrder() {
    const configuredLanguage = String(
      // MagicMirror's config is a global `let` in the browser, not a globalThis property.
      (typeof config !== "undefined" && config?.language) || this.config?.language || navigator?.language || "en",
    ).trim();
    const normalizedLanguage = configuredLanguage || "en";
    const baseLanguage = normalizedLanguage.split("-")[0];
    return Array.from(new Set(["en", baseLanguage, normalizedLanguage].filter(Boolean)));
  },

  async _loadPluginTranslations(pluginEntry) {
    const pluginId = String(pluginEntry?.id || "").trim();
    if (!pluginId) return;

    if (!this._pluginTranslationsById) {
      this._pluginTranslationsById = new Map();
    }
    if (this._pluginTranslationsById.has(pluginId)) return;

    const frontendEntry = String(pluginEntry?.entry?.frontend || "").trim();
    const lastSlash = frontendEntry.lastIndexOf("/");
    const pluginRoot = lastSlash === -1 ? "" : frontendEntry.slice(0, lastSlash);
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
        const response = await fetch(url, { cache: "no-store" });
        if (response.status === 404) continue;
        if (!response.ok) {
          this._log(
            "warn",
            `[plugins] ${pluginId}: failed to load translations from ${relativePath} (${response.status})`,
          );
          continue;
        }

        const json = await response.json();
        if (!json || typeof json !== "object" || Array.isArray(json)) {
          this._log("warn", `[plugins] ${pluginId}: ignoring non-object translations in ${relativePath}`);
          continue;
        }

        Object.assign(mergedTranslations, json);
      } catch (error) {
        this._log(
          "warn",
          `[plugins] ${pluginId}: failed to load translations from ${relativePath}: ${error?.message || error}`,
        );
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
      const pluginId = String(entry?.id || "").trim();
      if (!pluginId) return;
      this._pluginRegistryById.set(pluginId, entry);
    });
  },

  _getPluginRegistryEntry(pluginId) {
    return this._pluginRegistryById?.get(String(pluginId || "").trim()) || null;
  },

  _getLegacyDisplayTokens(configSource = this.config || {}) {
    const parseDisplayModeTokens = globalThis.MMModuleRuntimeUtils?.parseDisplayModeTokens;
    if (typeof parseDisplayModeTokens === "function") {
      return parseDisplayModeTokens(configSource?.displayMode);
    }

    const raw = configSource?.displayMode;
    const displayMode = raw === undefined || raw === null ? "" : String(raw).toLowerCase().trim();
    if (displayMode === "grid") return ["grid"];
    if (displayMode === "list") return ["list", "lessons", "exams"];
    return displayMode
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  },

  _isPluginActive(pluginId) {
    return this._getPluginRegistryEntry(pluginId)?.active === true;
  },

  _hasWidget(name) {
    const normalizedName = String(name || "")
      .trim()
      .toLowerCase();
    if (!normalizedName) return false;
    return this._getDisplayWidgets().includes(normalizedName);
  },

  _ensurePluginAssetState(pluginId) {
    if (!this._pluginAssetStateById) {
      this._pluginAssetStateById = new Map();
    }
    const normalizedPluginId = String(pluginId || "").trim();
    if (!this._pluginAssetStateById.has(normalizedPluginId)) {
      this._pluginAssetStateById.set(normalizedPluginId, {
        loaded: false,
        failed: false,
        promise: null,
        errorMessage: "",
      });
    }
    return this._pluginAssetStateById.get(normalizedPluginId);
  },

  _loadPluginStyles(pluginEntry) {
    const styles = Array.isArray(pluginEntry?.entry?.styles) ? pluginEntry.entry.styles : [];
    styles.forEach((stylePath) => {
      const href = this.file(stylePath);
      if (document.querySelector(`link[data-wu-plugin-style="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.wuPluginStyle = href;
      document.head.appendChild(link);
    });
  },

  _loadPluginScript(pluginEntry) {
    return new Promise((resolve, reject) => {
      const scriptPath = pluginEntry?.entry?.frontend;
      if (!scriptPath) {
        reject(new Error(`Plugin ${pluginEntry?.id || "unknown"} is missing a frontend entry.`));
        return;
      }

      const src = this.file(scriptPath);
      const existing = document.querySelector(`script[data-wu-plugin-script="${src}"]`);
      if (existing) {
        if (existing.dataset.wuPluginLoaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Failed to load plugin script ${scriptPath}`)), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.dataset.wuPluginScript = src;
      script.addEventListener(
        "load",
        () => {
          script.dataset.wuPluginLoaded = "true";
          resolve();
        },
        { once: true },
      );
      script.addEventListener("error", () => reject(new Error(`Failed to load plugin script ${scriptPath}`)), {
        once: true,
      });
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
          state.errorMessage = "";
        })
        .catch((error) => {
          state.failed = true;
          state.errorMessage = error?.message || String(error);
          this._log("error", `[plugins] ${pluginEntry.id}: ${state.errorMessage}`);
        })
        .finally(() => {
          state.promise = null;
        });

      return state.promise;
    });

    return Promise.all(loadTasks)
      .then(() => {
        this.lifecycle.render();
      })
      .catch((error) => {
        this._log("error", "[plugins] failed to initialize plugin widgets", error);
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
        warnings: this.runtimeWarningsByStudent?.[studentTitle]
          ? Array.from(this.runtimeWarningsByStudent[studentTitle])
          : [],
        collections: this.collectionStateByStudent?.[studentTitle] || {},
      },
      plugins: {},
    }));
  },

  /**
   * Build the context object handed to a frontend plugin's create().
   *
   * The dom/time/formatting/shared namespaces are forwarded from the shared frontend API
   * (`window.MMMWebuntisFrontendShared`), which owns their grouping. They used to be empty
   * placeholders, which is why plugins reach for the global directly; new plugin code should use
   * `pluginContext.*` instead. See docs/PLUGINS.md.
   *
   * @param {Object} pluginEntry - Registry entry for the plugin
   * @returns {Object} Plugin context
   */
  _createFrontendPluginContext(pluginEntry) {
    const shared = this._getWidgetApi();
    if (!shared) {
      this._log(
        "warn",
        `[plugins] ${pluginEntry.id}: shared frontend API unavailable; context namespaces will be empty`,
      );
    }

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
      dom: shared?.dom || {},
      time: shared?.time || {},
      formatting: shared?.formatting || {},
      shared: shared || {},
    };
  },

  _renderFrontendPluginWidget(pluginId, studentTitles = []) {
    const pluginEntry = this._getPluginRegistryEntry(pluginId);
    if (pluginEntry?.active !== true) return null;

    const state = this._ensurePluginAssetState(pluginId);
    if (state.failed) {
      const errorDiv = document.createElement("div");
      errorDiv.className = "wu-widget__error widget-error dimmed";
      errorDiv.textContent = state.errorMessage || `Plugin ${pluginId} failed to load`;
      return errorDiv;
    }

    const pluginHost = this._getPluginHost();
    if (!state.loaded || !pluginHost?.hasFrontendPlugin?.(pluginId)) {
      const loadingDiv = document.createElement("div");
      loadingDiv.className = "wu-widget__info dimmed";
      loadingDiv.textContent = `${pluginEntry.title || pluginId} plugin is loading...`;
      return loadingDiv;
    }

    if (!this._frontendPluginInstancesById) {
      this._frontendPluginInstancesById = new Map();
    }

    let pluginInstance = this._frontendPluginInstancesById.get(pluginId);
    if (!pluginInstance) {
      pluginInstance = pluginHost.createFrontendPluginInstance(
        pluginId,
        this._createFrontendPluginContext(pluginEntry),
      );
      this._frontendPluginInstancesById.set(pluginId, pluginInstance);
    }

    const renderContext = {
      moduleId: this.identifier,
      mode: this.config?.mode || "verbose",
      students: this._buildPluginStudentRuntimeSlices(studentTitles),
      warnings: this._getRuntimeWarnings(),
      runtime: {},
    };

    return typeof pluginInstance?.render === "function" ? pluginInstance.render(renderContext) : null;
  },

  /**
   * Check whether demo mode is enabled. The backend serves the fixtures (lib/demoData.js); the
   * frontend only needs to know so it does not ask for students or credentials.
   *
   * @returns {boolean} True when a demo fixture path is configured.
   */
  _isDemoModeEnabled() {
    const raw = this.config?.demoDataFile;
    return typeof raw === "string" && raw.trim() !== "";
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
    const explicitPlugins =
      this.config?.plugins && typeof this.config.plugins === "object" && !Array.isArray(this.config.plugins)
        ? this.config.plugins
        : {};
    const explicitEnabled = Object.entries(explicitPlugins)
      .filter(([, entry]) => entry?.enabled === true)
      .map(([pluginId]) => pluginId);
    const defaultDisplayMode =
      typeof this.defaults?.displayMode === "string" ? this.defaults.displayMode.toLowerCase().trim() : "";
    const currentDisplayMode =
      typeof this.config?.displayMode === "string" ? this.config.displayMode.toLowerCase().trim() : "";

    if (explicitEnabled.length > 0 && currentDisplayMode === defaultDisplayMode) {
      return explicitEnabled;
    }

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
            return String(left?.id || "").localeCompare(String(right?.id || ""));
          });

        for (const match of matches) {
          const pluginId = String(match?.id || "");
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
          return String(left?.id || "").localeCompare(String(right?.id || ""));
        })
        .map((entry) => String(entry.id));
      if (activePlugins.length > 0) return activePlugins;
    }

    if (explicitEnabled.length > 0) {
      return explicitEnabled;
    }

    const enabled = [];
    for (const token of displayTokens) {
      if (token === "list") {
        if (!enabled.includes("lessons")) enabled.push("lessons");
        if (!enabled.includes("exams")) enabled.push("exams");
        continue;
      }
      if (
        ["grid", "lessons", "exams", "homework", "absences", "messagesofday"].includes(token) &&
        !enabled.includes(token)
      ) {
        enabled.push(token);
      }
    }
    return enabled.length > 0 ? enabled : ["lessons", "exams"];
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
      if (!this.frontendLogger) {
        // Call bound: the logger reads this instance's configured level.
        this.frontendLogger = this._createFrontendLogger("MMM-Webuntis");
      }
      if (this.frontendLogger && typeof this.frontendLogger.log === "function") {
        const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
        this.frontendLogger.log(level, msg);
        return;
      }
    } catch {
      void 0;
    }

    // Fallback without the runtime utils: same rule - MagicMirror's Log applies the global
    // level, an own logLevel can only narrow it.
    const levels = this._getWidgetApi()?.util?.logLevelWeights || { none: -1, error: 0, warn: 1, info: 2, debug: 3 };
    const configured = levels[this.config?.logLevel];
    const msgLevel = levels[level] !== undefined ? level : "info";
    if (configured !== undefined && levels[msgLevel] > configured) return;
    try {
      const sink = globalThis.Log || console;
      (sink[msgLevel] || sink.log).call(sink, "[MMM-Webuntis]", ...args);
    } catch {
      void 0;
    }
  },

  _getSortedStudentTitles() {
    if (!this.timetableByStudent || typeof this.timetableByStudent !== "object") return [];
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
    return this._getWidgetApi()?.util?.buildHolidayMapFromRanges(holidays) || {};
  },

  _buildDayNoticeMap(dayNotices) {
    return this._getWidgetApi()?.util?.buildDayNoticeMap(dayNotices) || {};
  },

  /**
   * Build configuration object to send to backend
   * Backend performs normalization/default handling for nested widget configs
   *
   * @returns {Object} Config object with session metadata for backend processing
   */
  _buildSendConfig() {
    const rawStudents = Array.isArray(this.config.students) ? this.config.students : [];
    const widgetKeys = ["lessons", "grid", "exams", "homework", "absences", "messagesofday"];
    const explicitPlugins =
      this.config?.plugins && typeof this.config.plugins === "object" && !Array.isArray(this.config.plugins)
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

    const validWidgets = ["list", "grid", "lessons", "exams", "homework", "absences", "messagesofday"];
    if (config.displayMode && typeof config.displayMode === "string") {
      const widgets = config.displayMode
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => w.toLowerCase());
      const invalid = widgets.filter((w) => !validWidgets.includes(w));
      if (invalid.length > 0) {
        warnings.push(
          `displayMode contains unknown widgets: "${invalid.join(", ")}". Supported: ${validWidgets.join(", ")}`,
        );
      }
    }

    const validLogLevels = ["none", "error", "warn", "info", "debug"];
    if (config.logLevel && !validLogLevels.includes(String(config.logLevel).toLowerCase())) {
      warnings.push(`Invalid logLevel "${config.logLevel}". Use one of: ${validLogLevels.join(", ")}`);
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
    // Demo mode renders fixtures and never logs in, so it needs neither students nor credentials.
    if (!this._isDemoModeEnabled() && (!Array.isArray(config.students) || config.students.length === 0)) {
      if (!hasParentCreds) {
        warnings.push(
          "No students configured and no parent credentials provided. Either configure students[] or provide username, password, and school for auto-discovery.",
        );
      } else {
        this._log("info", "Empty students[] with parent credentials: waiting for auto-discovery from backend...");
      }
    }

    warnings.forEach((warning) => {
      this._upsertModuleWarnings([warning], [], { kind: "config", severity: "warning" });
      this._log("warn", warning);
    });
  },

  /**
   * Store runtime warnings per student so they can be cleared on the next successful fetch
   * @param {string} studentTitle - Student label from the payload
   * @param {string[]} warningsList - Warning messages returned by the backend
   */
  _updateRuntimeWarnings(studentTitle, warningsList) {
    const key = studentTitle || "__module__";
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
        this._log("warn", `Runtime warning: ${warning}`);
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
    if (util && typeof util.toMinutesSinceMidnight === "function") {
      return util.toMinutesSinceMidnight(t);
    }
    if (t === null || t === undefined) return NaN;
    const s = String(t).trim();
    if (s.includes(":")) {
      const parts = s.split(":").map((p) => p.replace(/\D/g, ""));
      const hh = parseInt(parts[0], 10) || 0;
      const mm = parseInt(parts[1] || "0", 10) || 0;
      return hh * 60 + mm;
    }
    const digits = s.replace(/\D/g, "").padStart(4, "0");
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
  _upsertModuleWarnings(warnings = [], warningMeta = [], fallbackMeta = { kind: "config", severity: "warning" }) {
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
      const message = String(warning || "").trim();
      if (!message) return;
      this.moduleWarningsSet.add(message);

      const nextMeta = metaByMessage.get(message) || { message, ...fallbackMeta };
      const prevMeta = this.moduleWarningMetaByMessage.get(message);
      if (!prevMeta || prevMeta.kind === "generic") {
        this.moduleWarningMetaByMessage.set(message, { message, ...nextMeta });
      }
    });
  },

  _isCriticalModuleWarning(message) {
    const meta = this.moduleWarningMetaByMessage?.get(String(message));
    return meta?.severity === "critical" || meta?.level === "error";
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
    const criticalKinds = new Set(["network", "auth", "server"]);
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
      return meta.severity === "critical" || meta.level === "error" || criticalKinds.has(String(meta.kind || ""));
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

    const pattern =
      /(cannot connect|cannot reach|fetch failed|network error|timeout|econnrefused|enotfound|ehostunreach)/i;
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
      const message = String(entry?.message || "");
      if (!message) return;
      metaByMessage.set(message, entry);
    });

    const typeAlias = {
      lesson: "lessons",
      lessons: "lessons",
      exam: "exams",
      exams: "exams",
      homework: "homework",
      homeworks: "homework",
      absence: "absences",
      absences: "absences",
      message: "messages",
      messages: "messages",
      messagesofday: "messages",
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

    const allFetchedApisHealthy =
      fetchedApiChecks.length > 0 && fetchedApiChecks.every((entry) => isStatusOk(entry.status));

    return warningsList.filter((warning) => {
      const warningText = String(warning || "");
      const warningMetaEntry = metaByMessage.get(warningText) || null;

      if (warningMetaEntry?.kind === "config") {
        return true;
      }

      if (warningMetaEntry?.kind === "no_data") {
        const canonicalType =
          typeAlias[String(warningMetaEntry.dataType || "").toLowerCase()] ||
          String(warningMetaEntry.dataType || "").toLowerCase();
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
   * Decide whether to keep the previously displayed data of a collection.
   *
   * The backend reports per collection whether the latest fetch succeeded
   * (`state.collections.<name>.status`: `ok`, `unavailable`, `disabled`). Data is replaced only
   * on `ok`; a failed or skipped fetch keeps whatever was shown before, so a temporary outage
   * never blanks a widget. A collection without previous data stays empty and is flagged
   * `unavailable` so plugins can render "data unavailable" instead of "no lessons".
   *
   * @param {Array} nextData - New data from backend
   * @param {Array} prevData - Previously displayed data
   * @param {Object} collectionState - `state.collections.<name>` entry from the payload
   * @returns {boolean} True if previous data should be preserved
   */
  _shouldPreserveData(nextData, prevData, collectionState) {
    const prevHasData = Array.isArray(prevData) && prevData.length > 0;
    const nextHasData = Array.isArray(nextData) && nextData.length > 0;
    if (!prevHasData || nextHasData) return false;
    return String(collectionState?.status || "ok") !== "ok";
  },

  /**
   * Effective collection state for the frontend: the backend state plus whether stale data is
   * being shown in place of a failed fetch.
   *
   * @param {Object} collectionState - `state.collections.<name>` entry from the payload
   * @param {boolean} preserved - Whether previous data was kept
   * @returns {Object} { status, httpStatus, lastSuccessAt, stale }
   */
  _resolveCollectionState(collectionState, preserved) {
    return {
      status: String(collectionState?.status || "ok"),
      httpStatus: collectionState?.httpStatus ?? null,
      lastSuccessAt: collectionState?.lastSuccessAt ?? null,
      stale: Boolean(preserved),
    };
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
        this._log("warn", `[plugins] ${pluginId} is not active; skipping ${widgetLabel} render path.`);
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
      grid: () => renderPluginWidget("grid", "Grid"),
      lessons: () => renderPluginWidget("lessons", "Lessons"),
      exams: () => renderPluginWidget("exams", "Exams"),
      homework: () => renderPluginWidget("homework", "Homework"),
      absences: () => renderPluginWidget("absences", "Absences"),
      messagesofday: () => renderPluginWidget("messagesofday", "Messages of Day"),
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
   *   5. Request CONFIGURE once DOM is ready (DOM_OBJECTS_CREATED),
   *      with resume() and startup fallback as safety nets
   *
   * Multi-instance support: Each instance should have a unique identifier in config.js
   */
  start() {
    this.shared = globalThis.MMModuleShared;
    this.transport = this.shared.createTransport({
      moduleName: "MMM-Webuntis",
      identifier: this.identifier,
      instanceId: this.identifier,
      sendSocketNotification: this.sendSocketNotification.bind(this),
    });
    this.notifications = this.transport.notifications;

    this._sessionId = this._generateSessionId(9);

    // Multi-instance support via explicit identifiers.
    // For multiple MMM-Webuntis instances, you MUST add unique 'identifier' fields in config.js:
    // { module: 'MMM-Webuntis', identifier: 'student_alice', position: '...', config: { ... } }
    // Without explicit identifiers, MagicMirror will auto-assign them (MMM-Webuntis_0, MMM-Webuntis_1, etc)
    if (this.identifier) {
      this._log("debug", `[start] Using explicit identifier from config: ${this.identifier}`);
    } else {
      this._log(
        "warn",
        '[start] No explicit identifier set. For multiple instances, add "identifier" to module config in config.js',
      );
    }
    this._log(
      "info",
      `[start] identifier="${this.identifier}", sessionId="${this._sessionId}" (memory-only, unique per window)`,
    );

    try {
      if (!this.config.language && typeof config !== "undefined" && config?.language) {
        this.config.language = config.language;
      }
    } catch (err) {
      // Language config is optional; ignore errors silently
      this._log("debug", `[init] Failed to apply language config: ${err?.message}`);
    }

    const startDateContext = this.getCurrentDateContext();
    this._currentTodayYmd = startDateContext.ymd;
    if (startDateContext.isDebug) {
      this._log("debug", `[start] debugDate="${startDateContext.isoDate}" (frozen test mode)`);
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
    this.collectionStateByStudent = {};

    this.moduleWarningsSet = new Set();
    this.moduleWarningMetaByMessage = new Map();
    this.runtimeWarningsByStudent = {};
    this._runtimeWarningStreakByStudent = {};
    this._runtimeWarningsLogged = new Set();
    this._pluginRegistryById = new Map();
    this._pluginAssetStateById = new Map();
    this._frontendPluginInstancesById = new Map();

    this._initialized = false;
    this._initRequested = false;
    this._initWatchdogTimer = null;
    this._initAttemptCount = 0;

    this._lastDataReceivedAt = null;

    this._createLifecycle();

    this.lifecycle.start();
    // Deliberately unredacted: this only reaches the browser DevTools console, and only when the
    // module's own logLevel is explicitly 'info' or 'debug' - never by the global level alone,
    // which is on INFO in a default MagicMirror. Its whole purpose is to let a user see -
    // and paste to the maintainer for support - the exact config MagicMirror is running with.
    // MagicMirror already round-trips this config in plaintext between server and frontend, so
    // there is nothing left to protect by redacting it here. Persisted artifacts are a different
    // story and ARE redacted before being written to disk - see redactSensitiveFields() in
    // lib/mmm-adapter/mmmPayloadMapper.js, used by dumpBackendPayloads/dumpRawApiResponses -
    // because those files get sent back to the maintainer and must not leak credentials.
    if (["info", "debug"].includes(String(this.config?.logLevel || "").toLowerCase())) {
      this._log("info", "MMM-Webuntis initializing with config:", this.config);
    }
  },

  /**
   * Build the shared lifecycle.
   *
   * It owns everything that used to live in this file as hand-written timer and
   * visibility bookkeeping: the freshness guard on resume(), the guard inside
   * the interval callback, the deferred init for a module that starts hidden,
   * the day rollover across a suspend, jitter and quiet hours.
   *
   * @private
   */
  _createLifecycle() {
    this.lifecycle = this.shared.createLifecycle({
      module: this,
      log: this._log.bind(this),
      getUpdateInterval: () => this.config?.updateInterval,
      minUpdateInterval: 30 * 1000,
      backgroundRefresh: this.config?.backgroundRefresh !== false,
      quietHours: this.config?.quietHours,
      getDayKey: () => {
        const context = this.getCurrentDateContext();
        return this._usesLiveClock(context) ? String(context?.ymd ?? "") : null;
      },
      onDayChange: ({ previous, current }) => {
        this._log("debug", `[lifecycle] Day change detected: ${previous} -> ${current}`);
        this._handleClockDrivenDayRollover();
      },
      onVisible: () => this._startNowLineUpdater(),
      onHidden: () => {
        this._stopNowLineUpdater();
      },
      onSessionState: ({ state, reason }) =>
        this.transport.sendRequest("SESSION_STATE", { sessionId: this._sessionId, state, reason }),
      onFetch: ({ reason }) => this._sendFetchData(reason),
      deferredInit: {
        run: (reason) => this._requestInitIfNeeded(reason),
        isPending: () => !this._initialized && !this._initRequested,
        intervalMs: Number(this.config?.initRetryTimeout) || 5000,
        maxAttempts: 12,
      },
    });
  },

  /**
   * Start the now line updater for grid view
   * The now line shows current time position in the grid widget
   * Only starts if showNowLine config is not explicitly disabled
   */
  _startNowLineUpdater() {
    if (this.config?.grid?.showNowLine === false) return;
    const fn = this._getWidgetApi()?.grid?.startNowLineUpdater;
    if (typeof fn === "function") fn(this);
  },

  /**
   * Stop the now line updater for grid view
   * Called during suspend() to stop unnecessary timer updates
   */
  _stopNowLineUpdater() {
    const fn = this._getWidgetApi()?.grid?.stopNowLineUpdater;
    if (typeof fn === "function") fn(this);
  },

  /**
   * Send CONFIGURE request to backend
   * Triggers one-time module initialization (config validation, student discovery)
   * Backend responds with MODULE_READY when ready
   *
   * @param {string} reason - Reason for initialization trigger
   */
  _sendInit(reason = "manual") {
    this._initAttemptCount += 1;
    this._log("debug", `[CONFIGURE] Sending to backend (reason=${reason})`);
    this.transport.sendRequest("CONFIGURE", {
      ...this._buildSendConfig(),
      reason,
    });
    this._armInitWatchdog();
  },

  /**
   * Arm a watchdog for the init handshake and retry when MODULE_READY is missing.
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
          "warn",
          `[INIT] Watchdog reached max retries (${maxAttempts}) without MODULE_READY; reopening init gate for next trigger`,
        );
        this._initRequested = false;
        this._initAttemptCount = 0;
        return;
      }

      const nextAttempt = this._initAttemptCount + 1;
      this._log(
        "warn",
        `[INIT] No MODULE_READY within ${timeoutMs}ms, retrying CONFIGURE (attempt ${nextAttempt}/${maxAttempts})`,
      );
      this._sendInit(`retry-timeout-${nextAttempt}`);
    }, timeoutMs);
  },

  /**
   * Request backend initialization exactly once when needed.
   * Safe to call from multiple lifecycle hooks.
   *
   * @param {string} reason - Why init is requested
   */
  _requestInitIfNeeded(reason = "manual") {
    if (this._initialized || this._initRequested) return;
    this._initRequested = true;
    this._initAttemptCount = 0;
    this._sendInit(reason);
  },

  /**
   * Send REFRESH request to backend for data refresh
   * Only sends if module is initialized (prevents fetch before init)
   * Stores pending resume request if called during initialization
   *
   * @param {string} reason - Reason for fetch ('manual', 'periodic', 'resume')
   */
  _sendFetchData(reason = "manual") {
    if (!this._initialized) {
      if (String(reason).startsWith("resume")) {
        this._pendingResumeRequest = true;
      }
      return;
    }

    // REFRESH carries only what the backend reads from it - routing, the reason, and the two
    // per-request overrides. The full config travels with CONFIGURE; a backend that has lost the
    // session answers with INIT_REQUIRED instead of re-initializing from this payload.
    this.transport.sendRequest("REFRESH", {
      id: this.identifier,
      sessionId: this._sessionId,
      reason,
      debugDate: this.config?.debugDate ?? this.defaults.debugDate,
      backgroundRefresh: this.config?.backgroundRefresh ?? this.defaults.backgroundRefresh,
    });
  },

  suspend() {
    this.lifecycle.suspend();
  },

  resume() {
    this.lifecycle.resume();
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "MMM-Webuntis";
    const widgets = this._getDisplayWidgets();
    let renderedWidgetCount = 0;
    const withWarningIcon = (element, text) => {
      const icon = document.createElement("span");
      icon.className = "wu-inline-icon wu-inline-icon--warning";
      icon.setAttribute("aria-hidden", "true");
      element.replaceChildren(icon, document.createTextNode(` ${text}`));
    };
    const appendEmptyState = () => {
      if (renderedWidgetCount > 0) return;
      const infoDiv = document.createElement("div");
      infoDiv.className = "wu-widget__info dimmed";
      withWarningIcon(infoDiv, this.translate("no_data"));
      wrapper.appendChild(infoDiv);
    };

    const sortedStudentTitles = this._getSortedStudentTitles();

    const appendWidgetError = (widgetLabel, error) => {
      this._log("error", `Failed to render ${widgetLabel.toLowerCase()} widget: ${error.message}`);
      const errorDiv = document.createElement("div");
      errorDiv.className = "wu-widget__error widget-error dimmed";
      withWarningIcon(errorDiv, this.translate("widget_render_error", { widget: widgetLabel }));
      wrapper.appendChild(errorDiv);
    };

    if (this.moduleWarningsSet && this.moduleWarningsSet.size > 0) {
      const warnContainer = document.createDocumentFragment();
      for (const w of Array.from(this.moduleWarningsSet)) {
        const warnDiv = document.createElement("div");
        const isCritical = this._isCriticalModuleWarning(w);
        warnDiv.className = isCritical
          ? "mmm-webuntis-warning critical small bright"
          : "mmm-webuntis-warning small bright";
        try {
          withWarningIcon(warnDiv, w);
        } catch {
          withWarningIcon(warnDiv, "Configuration warning");
        }
        warnContainer.appendChild(warnDiv);
      }
      wrapper.appendChild(warnContainer);
    }

    const runtimeWarnings = this._getRuntimeWarnings();
    if (runtimeWarnings.length > 0) {
      const runtimeContainer = document.createDocumentFragment();
      for (const warning of runtimeWarnings) {
        const warnDiv = document.createElement("div");
        warnDiv.className = "mmm-webuntis-warning runtime small bright";
        try {
          withWarningIcon(warnDiv, warning);
        } catch {
          withWarningIcon(warnDiv, "Fetch warning");
        }
        runtimeContainer.appendChild(warnDiv);
      }
      wrapper.appendChild(runtimeContainer);
    }

    const widgetRenderers = this._createWidgetRenderers(wrapper, sortedStudentTitles, appendWidgetError);

    for (const widget of widgets) {
      const renderWidget = widgetRenderers[widget];
      if (typeof renderWidget !== "function") {
        this._log("warn", `Unknown widget type: ${widget}`);
        continue;
      }
      renderedWidgetCount += renderWidget() || 0;
    }

    appendEmptyState();

    return wrapper;
  },

  notificationReceived(notification) {
    if (notification === "DOM_OBJECTS_CREATED") {
      if (this.config.__legacyUsed && this.config.__legacyUsed.length > 0) {
        this._log("warn", `⚠️ DEPRECATED CONFIG DETECTED: ${this.config.__legacyUsed.join(", ")}`);
        this._log("warn", "Your configuration uses deprecated keys that will be removed in future versions.");
        this._log("warn", "Please update your config.js to use the new configuration format.");
        this._log("warn", "See the module documentation for migration details.");
      }

      // The lifecycle already triggered (or deferred) init in start(); this is
      // only a safety net and is a no-op once init is under way.
      this._requestInitIfNeeded("dom-objects-created");
    }
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== this.notifications.EVENT) return;
    if (!this._isValidTargetInstance(payload)) return;

    const action = payload?.action;
    const eventData = payload?.data || {};

    switch (action) {
      case "MODULE_READY":
        this._handleModuleInitialized(eventData);
        break;

      case "MODULE_INIT_FAILED":
        this._handleInitError(eventData);
        break;

      case "INIT_REQUIRED":
        this._handleInitRequired(eventData);
        break;

      case "DATA_UPDATE":
        this._handleGotData(eventData);
        break;

      default:
        break;
    }
  },

  /**
   * Ensure the payload matches the current module instance's sessionId or identifier
   */
  _isValidTargetInstance(payload) {
    const routed = payload?.data || payload || {};
    if (routed?.sessionId && this._sessionId !== routed.sessionId) return false;
    if (routed?.id && !routed?.sessionId && this.identifier !== routed.id) return false;
    if (payload?.identifier && this.identifier !== payload.identifier) return false;
    return true;
  },

  /**
   * Backend lost this session's config (helper restart) and asked for a new CONFIGURE handshake.
   * Reopen the init gate and re-send the full config; the watchdog takes over from there.
   *
   * @param {Object} payload - Event payload ({ reason })
   */
  _handleInitRequired(payload) {
    this._log(
      "warn",
      `[INIT_REQUIRED] Backend requested re-initialization (reason=${payload?.reason || "unspecified"})`,
    );
    this._initialized = false;
    this._initRequested = false;
    this._initAttemptCount = 0;
    if (this._initWatchdogTimer) {
      clearTimeout(this._initWatchdogTimer);
      this._initWatchdogTimer = null;
    }
    this._requestInitIfNeeded("backend-init-required");
  },

  _handleModuleInitialized(payload) {
    if (this._initialized) {
      this._log(
        "debug",
        `[MODULE_READY] sessionId=${payload?.sessionId} Already initialized, ignoring duplicate notification`,
      );
      return;
    }

    this._log("info", `Module ready, sessionId=${payload?.sessionId}`);
    this._initialized = true;
    this._initRequested = false;
    this._initializedAt = Date.now();

    if (this._initWatchdogTimer) {
      clearTimeout(this._initWatchdogTimer);
      this._initWatchdogTimer = null;
    }
    this._initAttemptCount = 0;

    if (this._pendingResumeRequest) {
      this._log("debug", "[MODULE_READY] Clearing pending resume request (backend handles initial fetch)");
      this._pendingResumeRequest = false;
    }

    if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
      this._upsertModuleWarnings(payload.warnings, payload.warningMeta, { kind: "config", severity: "warning" });
      payload.warnings.forEach((w) => {
        this._log("warn", `Init warning: ${w}`);
      });
    }

    this._setPluginRegistry(payload?.plugins || []);
    this._initializeActivePlugins(payload?.plugins || []).catch((error) => {
      this._log("error", `[plugins] initialization failed: ${error?.message || String(error)}`);
    });

    this._log("debug", "[MODULE_READY] Backend will auto-fetch data, periodic timer is owned by the lifecycle");
  },

  _handleInitError(payload) {
    this._log(
      "error",
      `Module initialization failed (sessionId=${payload?.sessionId}):`,
      payload.message || "Unknown error",
    );
    if (Array.isArray(payload.errors)) {
      payload.errors.forEach((err) => {
        this._log("error", `  - ${err}`);
      });
    }
    if (Array.isArray(payload.warnings)) {
      payload.warnings.forEach((warn) => {
        this._log("warn", `  - ${warn}`);
      });
    }

    const errorWarnings = Array.isArray(payload.errors) ? payload.errors : [];
    const errorWarningMeta = errorWarnings.map((message) => ({
      message: String(message),
      kind: "config",
      severity: "critical",
    }));
    this._upsertModuleWarnings(errorWarnings, errorWarningMeta, { kind: "config", severity: "critical" });

    if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
      this._upsertModuleWarnings(payload.warnings, payload.warningMeta, { kind: "config", severity: "warning" });
    }

    this._initialized = false;
    this._initRequested = false;
    if (this._initWatchdogTimer) {
      clearTimeout(this._initWatchdogTimer);
      this._initWatchdogTimer = null;
    }
    this._initAttemptCount = 0;
    this.lifecycle.markFetchFailed();
    this.lifecycle.render();
  },

  _handleGotData(payload) {
    if (Number(payload?.contractVersion) !== 3) {
      this._log("warn", `[DATA_UPDATE] Ignored unsupported contractVersion=${payload?.contractVersion}`);
      return;
    }

    const title = payload?.context?.student?.title;
    if (!title) {
      this._log(
        "warn",
        "[DATA_UPDATE] Missing context.student.title in payload, handling as module-level warning payload",
      );
      this._processGotDataWarnings("__module__", payload);

      this.lifecycle.render();
      return;
    }

    this._log("debug", `[DATA_UPDATE] Received for student=${title}, sessionId=${payload?.sessionId}`);
    this._lastDataReceivedAt = Date.now();
    this.lifecycle.markDataReceived(this._lastDataReceivedAt);
    this.configByStudent[title] = payload?.context?.config || {};

    this._syncDebugDate(this.configByStudent[title]);
    const dataChanged = this._processPayloadData(title, payload);
    const warningsChanged = this._processGotDataWarnings(title, payload);

    if (dataChanged || warningsChanged) {
      this.lifecycle.render();
    } else {
      this._log("debug", `[DATA_UPDATE] Skipping DOM update for ${title}: no effective data/warning changes`);
    }
  },

  _syncDebugDate(cfg) {
    this._log(
      "debug",
      `[DATA_UPDATE] Before filter: _currentTodayYmd=${this._currentTodayYmd}, cfg.debugDate=${cfg?.debugDate}`,
    );
    const debugDateContext = this.getCurrentDateContext(cfg || {});
    if (debugDateContext.isDebug) {
      this._log("debug", `[DATA_UPDATE] Using debugDate="${debugDateContext.isoDate}" from backend`);
      this._currentTodayYmd = debugDateContext.ymd;
      this._log("debug", `[DATA_UPDATE] Updated _currentTodayYmd=${debugDateContext.ymd} (before timetable filtering)`);
    } else {
      this._log("debug", `[DATA_UPDATE] No debugDate in cfg, keeping _currentTodayYmd=${this._currentTodayYmd}`);
    }
  },

  _processPayloadData(title, payload) {
    let dataChanged = false;
    const collections =
      payload?.state?.collections && typeof payload.state.collections === "object" ? payload.state.collections : {};
    const lessonsState = collections.lessons || {};
    const nextCollectionState = {};

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
      this._log("warn", "failed to build timeUnits from grid", e);
    }

    // timeUnits, dayNotices and holidays travel with the timetable and follow its state.
    if (!this._shouldPreserveData(timeUnits, this.timeUnitsByStudent[title] || [], lessonsState)) {
      this.timeUnitsByStudent[title] = timeUnits;
      dataChanged = true;
    }

    const periodMap = {};
    (this.timeUnitsByStudent[title] || []).forEach((u) => {
      periodMap[u.startTime] = u.name;
    });
    this.periodNamesByStudent[title] = periodMap;

    const rawLessons = Array.isArray(payload?.data?.lessons) ? payload.data.lessons : [];
    const preserveLessons = this._shouldPreserveData(rawLessons, this.timetableByStudent[title] || [], lessonsState);
    if (!preserveLessons) {
      this.timetableByStudent[title] = rawLessons;
      dataChanged = true;
    }
    nextCollectionState.lessons = this._resolveCollectionState(lessonsState, preserveLessons);
    this._log(
      "debug",
      `[DATA_UPDATE] Timetable updated: ${rawLessons.length} total -> ${this.timetableByStudent[title]?.length || 0} valid`,
    );

    const dayNotices = Array.isArray(payload?.data?.dayNotices) ? payload.data.dayNotices : [];
    if (!this._shouldPreserveData(dayNotices, this.dayNoticesByStudent[title] || [], lessonsState)) {
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
      { key: "exams", source: payload?.data?.exams, target: this.examsByStudent },
      { key: "homework", source: payload?.data?.homework, target: this.homeworksByStudent },
      { key: "absences", source: payload?.data?.absences, target: this.absencesByStudent },
      { key: "messages", source: payload?.data?.messages, target: this.messagesOfDayByStudent },
    ];

    dataMaps.forEach(({ key, source, target }) => {
      const parsedArray = Array.isArray(source) ? source : [];
      const collectionState = collections[key] || {};
      const preserve = this._shouldPreserveData(parsedArray, target[title] || [], collectionState);
      if (!preserve) {
        target[title] = parsedArray;
        dataChanged = true;
      }
      nextCollectionState[key] = this._resolveCollectionState(collectionState, preserve);
    });

    const holidays = Array.isArray(payload?.data?.holidays?.ranges) ? payload.data.holidays.ranges : [];
    if (!this._shouldPreserveData(holidays, this.holidaysByStudent[title] || [], lessonsState)) {
      this.holidaysByStudent[title] = holidays;
      this.holidayMapByStudent[title] = this._buildHolidayMapFromRanges(holidays);
      dataChanged = true;
    }

    const prevCollectionState = this.collectionStateByStudent[title];
    if (JSON.stringify(prevCollectionState || null) !== JSON.stringify(nextCollectionState)) {
      dataChanged = true;
    }
    this.collectionStateByStudent[title] = nextCollectionState;

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

    const persistentWarnings = warningsAfterNormalization.filter(
      (w) => metaByMessage.get(String(w))?.kind === "config",
    );
    const debouncedWarnings = warningsAfterNormalization.filter((w) => metaByMessage.get(String(w))?.kind !== "config");

    const hasAnyDebouncedWarningNow = debouncedWarnings.length > 0;
    const hasCriticalDebouncedWarningNow =
      this._hasCriticalWarningMeta(debouncedWarnings, warningMeta) ||
      this._hasCriticalApiStatus(payload?.state?.api || {}, payload?.state?.fetch || {}) ||
      this._hasNetworkTextFallback(debouncedWarnings, warningMeta);
    const prevRuntimeWarningStreak = Number(this._runtimeWarningStreakByStudent?.[title] || 0);
    const nextRuntimeWarningStreak = hasAnyDebouncedWarningNow ? prevRuntimeWarningStreak + 1 : 0;
    this._runtimeWarningStreakByStudent[title] = nextRuntimeWarningStreak;

    const shouldShowDebouncedNow = hasCriticalDebouncedWarningNow || nextRuntimeWarningStreak >= 2;
    const visibleWarnings = shouldShowDebouncedNow
      ? [...persistentWarnings, ...debouncedWarnings]
      : [...persistentWarnings];
    if (hasAnyDebouncedWarningNow && !shouldShowDebouncedNow) {
      this._log(
        "debug",
        `[DATA_UPDATE] Warning debounce active for ${title}: delaying runtime warning display until next fetch`,
      );
    }

    let warningsChanged = this._updateRuntimeWarnings(title, visibleWarnings);

    // Recovery cleanup: if we receive a clean student-scoped payload,
    // drop stale module-scoped runtime warnings from earlier title-less payloads.
    if (title !== "__module__" && visibleWarnings.length === 0) {
      warningsChanged = this._updateRuntimeWarnings("__module__", []) || warningsChanged;
      if (this._runtimeWarningStreakByStudent) {
        delete this._runtimeWarningStreakByStudent.__module__;
      }
    }

    this._logRuntimeWarnings(visibleWarnings);
    return warningsChanged;
  },
});
