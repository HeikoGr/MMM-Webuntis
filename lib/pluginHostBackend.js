const { loadPluginRegistry } = require('./pluginLoader');
const { HOST_PLUGIN_API_VERSION } = require('./pluginManifestValidator');

function createNoopLogger() {
  return () => void 0;
}

function initializeBackendPluginHost(options = {}) {
  const logger = typeof options.logger === 'function' ? options.logger : createNoopLogger();
  const requireFn = typeof options.requireFn === 'function' ? options.requireFn : require;
  const registry = loadPluginRegistry(options);
  const warnings = registry.warnings.slice();
  const plugins = [];

  for (const pluginDescriptor of registry.plugins) {
    const backendEntry = pluginDescriptor.entryPaths.backend;
    if (!backendEntry) {
      plugins.push({ ...pluginDescriptor, backendDefinition: null, instance: null });
      continue;
    }

    let backendDefinition;
    try {
      backendDefinition = requireFn(backendEntry);
    } catch (error) {
      warnings.push(`[plugins] Failed to load backend plugin "${pluginDescriptor.id}": ${error.message}`);
      continue;
    }

    if (!backendDefinition || backendDefinition.id !== pluginDescriptor.id) {
      warnings.push(`[plugins] Backend plugin "${pluginDescriptor.id}" must export a matching id.`);
      continue;
    }
    if (backendDefinition.hostApiVersion !== HOST_PLUGIN_API_VERSION) {
      warnings.push(`[plugins] Backend plugin "${pluginDescriptor.id}" targets unsupported host API version.`);
      continue;
    }
    if (typeof backendDefinition.setup !== 'function') {
      warnings.push(`[plugins] Backend plugin "${pluginDescriptor.id}" must export a setup() function.`);
      continue;
    }

    let instance;
    try {
      instance = backendDefinition.setup({
        pluginId: pluginDescriptor.id,
        hostApiVersion: HOST_PLUGIN_API_VERSION,
        manifest: pluginDescriptor.manifest,
        log(level, studentTitle, message) {
          logger(level, studentTitle, `[plugin:${pluginDescriptor.id}] ${message}`);
        },
        helpers: options.helpers || {},
      });
    } catch (error) {
      warnings.push(`[plugins] Backend plugin "${pluginDescriptor.id}" setup failed: ${error.message}`);
      continue;
    }

    plugins.push({
      ...pluginDescriptor,
      backendDefinition,
      instance: instance || null,
    });
  }

  return {
    plugins,
    warnings,
  };
}

module.exports = {
  initializeBackendPluginHost,
};
