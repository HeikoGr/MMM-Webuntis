const fs = require('node:fs');
const path = require('node:path');
const { validatePluginManifest } = require('./pluginManifestValidator');

function resolvePluginsRoot(moduleRoot, pluginsDir = 'plugins') {
  return path.resolve(moduleRoot, pluginsDir);
}

function readJsonFile(filePath, fsImpl = fs) {
  const raw = fsImpl.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function isPathInsideRoot(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolvePluginEntrypoints(pluginRoot, manifest) {
  const frontendPath = path.resolve(pluginRoot, manifest.entry.frontend);
  const backendPath = manifest.entry.backend ? path.resolve(pluginRoot, manifest.entry.backend) : null;
  const stylePaths = Array.isArray(manifest.entry.styles)
    ? manifest.entry.styles.map((styleEntry) => path.resolve(pluginRoot, styleEntry))
    : [];

  return {
    frontend: frontendPath,
    backend: backendPath,
    styles: stylePaths,
  };
}

function loadPluginRegistry(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const pathImpl = options.pathImpl || path;
  const moduleRoot = options.moduleRoot || process.cwd();
  const pluginsRoot = resolvePluginsRoot(moduleRoot, options.pluginsDir || 'plugins');
  const warnings = [];
  const plugins = [];
  const pluginIds = new Set();

  if (!fsImpl.existsSync(pluginsRoot)) {
    return {
      pluginsRoot,
      plugins,
      warnings,
    };
  }

  const entries = fsImpl.readdirSync(pluginsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  for (const entry of entries) {
    const pluginRoot = pathImpl.join(pluginsRoot, entry.name);
    const manifestPath = pathImpl.join(pluginRoot, 'manifest.json');
    if (!fsImpl.existsSync(manifestPath)) {
      continue;
    }

    let manifestRaw;
    try {
      manifestRaw = readJsonFile(manifestPath, fsImpl);
    } catch (error) {
      warnings.push(`[plugins] Failed to parse manifest for "${entry.name}": ${error.message}`);
      continue;
    }

    const validation = validatePluginManifest(manifestRaw, { pluginDirName: entry.name });
    if (!validation.valid || !validation.manifest) {
      validation.errors.forEach((message) => {
        warnings.push(`[plugins] Invalid manifest for "${entry.name}": ${message}`);
      });
      continue;
    }

    if (pluginIds.has(validation.manifest.id)) {
      warnings.push(`[plugins] Duplicate plugin id "${validation.manifest.id}" ignored.`);
      continue;
    }

    const entryPaths = resolvePluginEntrypoints(pluginRoot, validation.manifest);
    const candidatePaths = [entryPaths.frontend, entryPaths.backend, ...entryPaths.styles].filter(Boolean);

    const invalidPath = candidatePaths.find((candidatePath) => !isPathInsideRoot(candidatePath, pluginRoot));
    if (invalidPath) {
      warnings.push(`[plugins] Plugin "${validation.manifest.id}" has entry path outside plugin root.`);
      continue;
    }

    const missingPath = candidatePaths.find((candidatePath) => !fsImpl.existsSync(candidatePath));
    if (missingPath) {
      warnings.push(`[plugins] Plugin "${validation.manifest.id}" is missing entry file "${pathImpl.relative(pluginRoot, missingPath)}".`);
      continue;
    }

    pluginIds.add(validation.manifest.id);

    plugins.push({
      id: validation.manifest.id,
      manifest: validation.manifest,
      manifestPath,
      pluginRoot,
      entryPaths,
    });
  }

  const allPluginIds = new Set(plugins.map((plugin) => plugin.id));
  const filteredPlugins = plugins.filter((plugin) => {
    const aliases = Array.isArray(plugin.manifest?.activation?.displayAliases) ? plugin.manifest.activation.displayAliases : [];
    const collidingAlias = aliases.find((alias) => alias !== plugin.id && allPluginIds.has(alias));
    if (collidingAlias) {
      warnings.push(
        `[plugins] Plugin "${plugin.id}" has activation.displayAliases entry "${collidingAlias}" which collides with plugin id "${collidingAlias}".`
      );
      return false;
    }
    return true;
  });

  filteredPlugins.sort((left, right) => {
    const orderDelta = (left.manifest.order || 1000) - (right.manifest.order || 1000);
    if (orderDelta !== 0) return orderDelta;
    return left.id.localeCompare(right.id);
  });

  return {
    pluginsRoot,
    plugins: filteredPlugins,
    warnings,
  };
}

module.exports = {
  loadPluginRegistry,
  resolvePluginsRoot,
};
