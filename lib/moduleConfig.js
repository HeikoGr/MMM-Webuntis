/**
 * Module-config normalization for the MagicMirror adapter layer.
 *
 * Turns the raw config received via CONFIGURE into the canonical shape the fetch flow works
 * with: legacy keys mapped, `displayMode` and namespaced widget config folded into
 * `plugins.<id>.{enabled, config}`, per-student plugin config inherited from the module level,
 * and plugin-provided config validation collected as warnings/errors.
 */

const path = require("node:path");
const { validateConfig, applyLegacyMappings, generateDeprecationWarnings } = require("./configValidator");
const { parseDisplayModeTokens } = require("./runtime-utils");
const { buildFetchFlagsFromCapabilities, collectCapabilities } = require("./pluginCapabilityResolver");
const { buildWarningMetaEntries, collectValidationWarnings, mergeUniqueWarnings } = require("./warningUtils");

const ALL_WIDGETS = Object.freeze(["grid", "lessons", "exams", "homework", "absences", "messagesofday"]);

function pluginRecords(pluginHost) {
  return Array.isArray(pluginHost?.plugins) ? pluginHost.plugins : [];
}

function manifestAliases(manifest) {
  return Array.isArray(manifest.activation?.displayAliases) && manifest.activation.displayAliases.length > 0
    ? manifest.activation.displayAliases.slice()
    : [manifest.id];
}

/**
 * Plugin definitions (id, config namespace, aliases, capabilities) from the discovered manifests.
 *
 * @param {Object} pluginHost - Backend plugin host
 * @returns {Map<string, Object>} id -> definition
 */
function getKnownPluginDefinitions(pluginHost) {
  const definitions = new Map();
  pluginRecords(pluginHost).forEach((pluginRecord) => {
    const manifest = pluginRecord?.manifest;
    if (!manifest?.id) return;
    definitions.set(manifest.id, {
      id: manifest.id,
      configNamespace: manifest.configNamespace || manifest.id,
      aliases: manifestAliases(manifest),
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [],
    });
  });
  return definitions;
}

function getBackendPluginDefaultConfig(pluginHost, pluginId, logger) {
  const descriptor = pluginRecords(pluginHost).find((entry) => entry?.id === pluginId);
  const getDefaultConfig = descriptor?.instance?.getDefaultConfig;
  if (typeof getDefaultConfig !== "function") return {};

  try {
    const value = getDefaultConfig();
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return { ...value };
  } catch (error) {
    logger?.(
      "warn",
      null,
      `[plugins] Failed to read default config for plugin "${pluginId}": ${error?.message || error}`,
    );
    return {};
  }
}

/**
 * Build the canonical `plugins.<id>` map for a config object (module level or one student).
 *
 * Precedence for `enabled`: explicit `plugins.<id>.enabled` > displayMode alias > inherited.
 * Precedence for `config`: plugin defaults < inherited < legacy namespace (`grid: {...}`) < explicit.
 *
 * @param {Object} config - Config object carrying displayMode / plugins / namespaced widget config
 * @param {Object} pluginHost - Backend plugin host
 * @param {Object|null} inheritedPlugins - Module-level plugins map to inherit from (for students)
 * @param {Function} [logger] - Logger
 * @returns {Object} plugins map
 */
function buildCanonicalPluginsConfig(config = {}, pluginHost, inheritedPlugins = null, logger = null) {
  const knownDefinitions = getKnownPluginDefinitions(pluginHost);
  const displayTokens = new Set(parseDisplayModeTokens(config?.displayMode));
  const explicitPlugins =
    config?.plugins && typeof config.plugins === "object" && !Array.isArray(config.plugins) ? config.plugins : {};
  const inherited =
    inheritedPlugins && typeof inheritedPlugins === "object" && !Array.isArray(inheritedPlugins)
      ? inheritedPlugins
      : {};
  const result = {};

  knownDefinitions.forEach((definition, pluginId) => {
    const explicitEntry =
      explicitPlugins?.[pluginId] && typeof explicitPlugins[pluginId] === "object" ? explicitPlugins[pluginId] : {};
    const inheritedEntry = inherited?.[pluginId] && typeof inherited[pluginId] === "object" ? inherited[pluginId] : {};
    const namespace = definition.configNamespace || pluginId;
    const legacyWidgetConfig =
      config?.[namespace] && typeof config[namespace] === "object" && !Array.isArray(config[namespace])
        ? config[namespace]
        : {};
    const pluginDefaultConfig = getBackendPluginDefaultConfig(pluginHost, pluginId, logger);
    const enabledFromLegacy = definition.aliases.some((alias) => displayTokens.has(alias));
    const enabled =
      typeof explicitEntry.enabled === "boolean"
        ? explicitEntry.enabled
        : enabledFromLegacy || inheritedEntry.enabled === true;

    result[pluginId] = {
      enabled,
      config: {
        ...pluginDefaultConfig,
        ...(inheritedEntry.config || {}),
        ...legacyWidgetConfig,
        ...(explicitEntry.config || {}),
      },
    };
  });

  Object.keys(explicitPlugins).forEach((pluginId) => {
    if (result[pluginId]) return;
    const explicitEntry = explicitPlugins[pluginId];
    if (!explicitEntry || typeof explicitEntry !== "object") return;
    result[pluginId] = {
      enabled: explicitEntry.enabled === true,
      config:
        explicitEntry.config && typeof explicitEntry.config === "object" && !Array.isArray(explicitEntry.config)
          ? { ...explicitEntry.config }
          : {},
    };
  });

  return result;
}

/**
 * Redact credentials in a config clone for server-side logging.
 */
function redactConfigForLog(config) {
  const redacted = { ...config };
  if (redacted.password) redacted.password = "***redacted***";
  if (redacted.qrcode) redacted.qrcode = "***redacted***";
  if (Array.isArray(redacted.students)) {
    redacted.students = redacted.students.map((s) => {
      const student = { ...s };
      if (student.password) student.password = "***redacted***";
      if (student.qrcode) student.qrcode = "***redacted***";
      return student;
    });
  }
  return redacted;
}

/**
 * Normalize legacy configuration keys to the canonical format.
 * Applies mappings once for module-level config and once for each student entry, lowercases
 * displayMode and derives `plugins` for the module and every student.
 *
 * @param {Object} cfg - Raw configuration object (may contain legacy keys)
 * @param {Object} deps
 * @param {Object} deps.pluginHost - Backend plugin host
 * @param {Function} deps.logger - (level, student, message) logger
 * @returns {{normalizedConfig: Object, legacyUsed: string[], configWarnings: string[]}}
 */
function normalizeModuleConfig(cfg, { pluginHost, logger }) {
  if (!cfg || typeof cfg !== "object") return { normalizedConfig: cfg, legacyUsed: [], configWarnings: [] };

  const { normalizedConfig } = applyLegacyMappings(cfg);
  const legacyUsed = Array.isArray(normalizedConfig.__legacyUsed) ? [...normalizedConfig.__legacyUsed] : [];
  const configWarnings = [];

  // Normalize each student once at init, so fetch flow can treat students as canonical.
  if (Array.isArray(normalizedConfig.students)) {
    normalizedConfig.students = normalizedConfig.students.map((student) => {
      const { normalizedConfig: normalizedStudent } = applyLegacyMappings(student);
      const studentLegacy = Array.isArray(normalizedStudent.__legacyUsed) ? normalizedStudent.__legacyUsed : [];
      studentLegacy.forEach((key) => {
        if (!legacyUsed.includes(key)) legacyUsed.push(key);
      });
      return normalizedStudent;
    });
  }

  if (typeof normalizedConfig.displayMode === "string") {
    normalizedConfig.displayMode = normalizedConfig.displayMode.toLowerCase();
  }

  normalizedConfig.plugins = buildCanonicalPluginsConfig(normalizedConfig, pluginHost, null, logger);

  if (Array.isArray(normalizedConfig.students)) {
    normalizedConfig.students = normalizedConfig.students.map((student) => ({
      ...student,
      plugins: buildCanonicalPluginsConfig(student, pluginHost, normalizedConfig.plugins, logger),
    }));
  }

  if (legacyUsed.length > 0) {
    const detailedWarnings = generateDeprecationWarnings(Array.from(new Set(legacyUsed)));
    configWarnings.push(...detailedWarnings);

    // Attach warnings to config.__warnings so they get sent to frontend and displayed in GUI
    normalizedConfig.__warnings = normalizedConfig.__warnings || [];
    normalizedConfig.__warnings.push(...detailedWarnings);

    detailedWarnings.forEach((warning) => {
      logger?.("warn", null, warning);
    });
    logger?.("debug", null, `Normalized config:\n${JSON.stringify(redactConfigForLog(normalizedConfig), null, 2)}`);
  }

  return { normalizedConfig, legacyUsed, configWarnings };
}

/**
 * Run every backend plugin's validateConfig() hook against its slice of the config.
 *
 * @param {Object} config - Config carrying `plugins`
 * @param {Object} pluginHost - Backend plugin host
 * @returns {{warnings: string[], errors: string[], warningMeta: Object[]}}
 */
function collectPluginValidationIssues(config = {}, pluginHost) {
  const pluginConfigMap = config?.plugins && typeof config.plugins === "object" ? config.plugins : {};
  const warnings = [];
  const errors = [];
  const warningMeta = [];

  pluginRecords(pluginHost).forEach((pluginDescriptor) => {
    const validate = pluginDescriptor?.instance?.validateConfig;
    if (typeof validate !== "function") return;

    const pluginId = pluginDescriptor.id;
    const issues = validate(pluginConfigMap?.[pluginId]?.config, { config, pluginId });
    if (!Array.isArray(issues) || issues.length === 0) return;

    issues.forEach((issue) => {
      const message = typeof issue === "string" ? issue : issue?.message;
      if (!message) return;
      const severity = typeof issue === "object" && issue?.severity ? String(issue.severity).toLowerCase() : "warning";
      const kind = typeof issue === "object" && issue?.kind ? issue.kind : "config";
      const meta = {
        message: String(message),
        kind,
        severity,
        pluginId: typeof issue === "object" && issue?.pluginId ? String(issue.pluginId) : pluginId,
      };
      warningMeta.push(meta);
      warnings.push(meta.message);
      if (severity === "error" || severity === "critical") errors.push(meta.message);
    });
  });

  return {
    warnings: Array.from(new Set(warnings)),
    errors: Array.from(new Set(errors)),
    warningMeta,
  };
}

/**
 * Validate a normalized config (schema + plugin hooks) and fold every warning source together.
 *
 * @param {Object} normalizedConfig - Normalized module config
 * @param {string[]} configWarnings - Deprecation warnings from normalizeModuleConfig()
 * @param {Object} pluginHost - Backend plugin host
 * @returns {{valid: boolean, errors: string[], warnings: string[], warningMeta: Object[]}}
 */
function validateNormalizedConfig(normalizedConfig, configWarnings = [], pluginHost) {
  const { valid, errors, warnings } = validateConfig(normalizedConfig, { log: () => {} });
  const pluginValidation = collectPluginValidationIssues(normalizedConfig, pluginHost);
  const combinedWarnings = mergeUniqueWarnings(
    [...(warnings || []), ...(configWarnings || []), ...pluginValidation.warnings],
    normalizedConfig?.__warnings || [],
  );
  const combinedErrors = collectValidationWarnings(errors, pluginValidation.errors);
  const combinedWarningMeta = [
    ...buildWarningMetaEntries(warnings || [], { kind: "config", severity: "warning" }),
    ...buildWarningMetaEntries(configWarnings || [], { kind: "config", severity: "warning" }),
    ...pluginValidation.warningMeta,
  ];

  return {
    valid: Boolean(valid) && combinedErrors.length === 0,
    errors: combinedErrors,
    warnings: combinedWarnings,
    warningMeta: combinedWarningMeta,
  };
}

/**
 * Registry entries handed to the frontend in MODULE_READY so it can load plugin assets.
 *
 * @param {Object} config - Normalized config
 * @param {Object} pluginHost - Backend plugin host
 * @param {string} moduleRoot - Absolute module directory (paths are made relative to it)
 * @returns {Object[]} registry entries
 */
function buildFrontendPluginRegistry(config = {}, pluginHost, moduleRoot) {
  const pluginConfigMap = config?.plugins && typeof config.plugins === "object" ? config.plugins : {};
  const toRelative = (absolutePath) => path.relative(moduleRoot, absolutePath).split(path.sep).join("/");

  return pluginRecords(pluginHost).map((pluginDescriptor) => {
    const manifest = pluginDescriptor.manifest || {};
    return {
      id: manifest.id,
      title: manifest.title,
      order: manifest.order || 1000,
      configNamespace: manifest.configNamespace || manifest.id,
      aliases: manifestAliases(manifest),
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [],
      active: pluginConfigMap?.[manifest.id]?.enabled === true,
      entry: {
        frontend: toRelative(pluginDescriptor.entryPaths.frontend),
        styles: Array.isArray(pluginDescriptor.entryPaths.styles)
          ? pluginDescriptor.entryPaths.styles.map(toRelative)
          : [],
      },
    };
  });
}

/**
 * Build widget/fetch flags from the canonical `plugins.<id>` config.
 *
 * displayMode has already been folded into `plugins.<id>.enabled` by buildCanonicalPluginsConfig(),
 * so only the plugin map is consulted. A config without any enabled plugin yields all-false flags.
 *
 * @param {Object} config - Config object carrying `plugins`
 * @param {Object} pluginHost - Backend plugin host
 * @returns {Object} Widget and fetch flags
 */
function buildFetchFlags(config, pluginHost) {
  const pluginsConfig =
    config && typeof config === "object" && config.plugins && typeof config.plugins === "object" ? config.plugins : {};
  const activePluginIds = Object.entries(pluginsConfig)
    .filter(([, entry]) => entry?.enabled === true)
    .map(([pluginId]) => pluginId);
  const activeSet = new Set(activePluginIds);

  // Ask the plugin records (not the flattened definitions) so a backend plugin's
  // getCapabilities() hook can override its manifest. Falls back to manifest capabilities.
  const activeRecords = pluginRecords(pluginHost).filter((pluginRecord) => activeSet.has(pluginRecord?.manifest?.id));
  const capabilities =
    activePluginIds.length > 0
      ? collectCapabilities(activeRecords, { getPluginConfig: (pluginId) => pluginsConfig[pluginId]?.config || {} })
      : [];
  const capabilityFlags = buildFetchFlagsFromCapabilities(capabilities);

  return {
    wantsGridWidget: activeSet.has("grid"),
    wantsLessonsWidget: activeSet.has("lessons"),
    wantsExamsWidget: activeSet.has("exams"),
    wantsHomeworkWidget: activeSet.has("homework"),
    wantsAbsencesWidget: activeSet.has("absences"),
    wantsMessagesOfDayWidget: activeSet.has("messagesofday"),
    fetchTimegrid: Boolean(capabilityFlags.fetchTimegrid || capabilityFlags.fetchTimetable),
    fetchTimetable: Boolean(capabilityFlags.fetchTimetable),
    fetchExams: Boolean(capabilityFlags.fetchExams),
    fetchHomeworks: Boolean(capabilityFlags.fetchHomeworks),
    fetchAbsences: Boolean(capabilityFlags.fetchAbsences),
    fetchMessagesOfDay: Boolean(capabilityFlags.fetchMessagesOfDay),
  };
}

/**
 * Effective config for one student: module config overlaid with the student entry.
 *
 * @param {Object} student - Student config
 * @param {Object} config - Module config
 * @returns {Object} Effective config
 */
function buildEffectiveStudentConfig(student, config) {
  return {
    ...config,
    ...(student || {}),
    displayMode: student?.displayMode || config?.displayMode,
    plugins: student?.plugins || config?.plugins,
  };
}

module.exports = {
  ALL_WIDGETS,
  buildCanonicalPluginsConfig,
  buildEffectiveStudentConfig,
  buildFetchFlags,
  buildFrontendPluginRegistry,
  collectPluginValidationIssues,
  getKnownPluginDefinitions,
  normalizeModuleConfig,
  validateNormalizedConfig,
};
