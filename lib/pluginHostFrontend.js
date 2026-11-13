/*
 * The frontend plugin registry (window.MMMWebuntisPluginHost). Each plugins/<id>/frontend.js
 * registers itself here; MMM-Webuntis.js asks whether a plugin is there and creates one
 * instance per module instance with its pluginContext (docs/PLUGINS.md).
 */
(function initPluginHost(root) {
  if (root.MMMWebuntisPluginHost) {
    return;
  }

  const HOST_PLUGIN_API_VERSION = 1;
  const definitions = new Map();

  root.MMMWebuntisPluginHost = {
    hostApiVersion: HOST_PLUGIN_API_VERSION,

    registerFrontendPlugin(definition) {
      if (!definition || typeof definition !== "object") {
        throw new TypeError("Frontend plugin definition must be an object.");
      }
      if (typeof definition.id !== "string" || !definition.id.trim()) {
        throw new TypeError("Frontend plugin definition requires a non-empty id.");
      }
      if (definition.hostApiVersion !== HOST_PLUGIN_API_VERSION) {
        throw new Error(`Frontend plugin "${definition.id}" targets unsupported host API version.`);
      }
      if (typeof definition.create !== "function") {
        throw new TypeError(`Frontend plugin "${definition.id}" must provide create().`);
      }
      definitions.set(definition.id, definition);
    },

    hasFrontendPlugin(id) {
      return definitions.has(String(id || "").trim());
    },

    createFrontendPluginInstance(id, pluginContext) {
      const definition = definitions.get(String(id || "").trim());
      if (!definition) {
        throw new Error(`Frontend plugin "${id}" is not registered.`);
      }
      return definition.create(pluginContext);
    },
  };
})(globalThis);
