(function initPluginHost(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.MMMWebuntisPluginHostApi = api;
  api.ensurePluginHost(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPluginHostApi(root) {
  const HOST_PLUGIN_API_VERSION = 1;

  function normalizeLogLevel(level) {
    return ['error', 'warn', 'info', 'debug'].includes(level) ? level : 'info';
  }

  function createPluginHost(options = {}) {
    const logger = typeof options.logger === 'function' ? options.logger : null;
    const definitions = new Map();
    const warnings = [];

    function log(level, message, meta = null) {
      const normalizedLevel = normalizeLogLevel(level);
      if (logger) {
        logger(normalizedLevel, message, meta);
        return;
      }
      try {
        const consoleRef = root.console || console;
        const fn = normalizedLevel === 'error' ? consoleRef.error : normalizedLevel === 'warn' ? consoleRef.warn : consoleRef.info;
        fn.call(consoleRef, `[MMM-Webuntis plugin host] ${message}`, meta || '');
      } catch {
        void 0;
      }
    }

    return {
      hostApiVersion: HOST_PLUGIN_API_VERSION,

      registerFrontendPlugin(definition) {
        if (!definition || typeof definition !== 'object') {
          throw new TypeError('Frontend plugin definition must be an object.');
        }
        if (typeof definition.id !== 'string' || !definition.id.trim()) {
          throw new TypeError('Frontend plugin definition requires a non-empty id.');
        }
        if (definition.hostApiVersion !== HOST_PLUGIN_API_VERSION) {
          throw new Error(`Frontend plugin "${definition.id}" targets unsupported host API version.`);
        }
        if (typeof definition.create !== 'function') {
          throw new TypeError(`Frontend plugin "${definition.id}" must provide create().`);
        }
        definitions.set(definition.id, definition);
      },

      getFrontendPlugin(id) {
        return definitions.get(String(id || '').trim()) || null;
      },

      hasFrontendPlugin(id) {
        return definitions.has(String(id || '').trim());
      },

      listFrontendPluginIds() {
        return Array.from(definitions.keys()).sort();
      },

      createFrontendPluginInstance(id, pluginContext) {
        const definition = definitions.get(String(id || '').trim());
        if (!definition) {
          throw new Error(`Frontend plugin "${id}" is not registered.`);
        }
        return definition.create(pluginContext);
      },

      addWarning(message) {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) return;
        warnings.push(normalizedMessage);
        log('warn', normalizedMessage);
      },

      getWarnings() {
        return warnings.slice();
      },
    };
  }

  function ensurePluginHost(target = root, options = {}) {
    if (target.MMMWebuntisPluginHost) {
      return target.MMMWebuntisPluginHost;
    }
    const host = createPluginHost(options);
    target.MMMWebuntisPluginHost = host;
    return host;
  }

  return {
    HOST_PLUGIN_API_VERSION,
    createPluginHost,
    ensurePluginHost,
  };
});
