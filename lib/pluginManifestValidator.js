const HOST_PLUGIN_API_VERSION = 1;
const CONTRACT_VERSION = 3;

const CANONICAL_PLUGIN_CAPABILITIES = Object.freeze([
  'lessons',
  'timeUnits',
  'exams',
  'homework',
  'absences',
  'messages',
  'holidays',
  'dayNotices',
  'studentContext',
  'runtimeState',
  'pluginDerivedData',
]);

const CAPABILITY_SET = new Set(CANONICAL_PLUGIN_CAPABILITIES);
const SLOT_SET = new Set(['main']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (normalized.includes('..')) return false;
  if (normalized.includes('\\')) return false;
  return true;
}

function isValidPluginId(value) {
  return typeof value === 'string' && /^[a-z0-9-]+$/.test(value);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function validatePluginManifest(manifest, options = {}) {
  const errors = [];
  const pluginDirName = typeof options.pluginDirName === 'string' ? options.pluginDirName.trim() : '';

  if (!isPlainObject(manifest)) {
    return {
      valid: false,
      errors: ['Manifest must be an object.'],
      manifest: null,
    };
  }

  const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  const title = typeof manifest.title === 'string' ? manifest.title.trim() : '';
  const type = typeof manifest.type === 'string' ? manifest.type.trim() : '';
  const entry = isPlainObject(manifest.entry) ? manifest.entry : null;
  const compatibility = isPlainObject(manifest.compatibility) ? manifest.compatibility : null;

  if (!isValidPluginId(id)) {
    errors.push('Manifest field "id" must match ^[a-z0-9-]+$.');
  }
  if (pluginDirName && id && pluginDirName !== id) {
    errors.push(`Plugin folder name "${pluginDirName}" must match manifest id "${id}".`);
  }
  if (!version) {
    errors.push('Manifest field "version" is required.');
  }
  if (!title) {
    errors.push('Manifest field "title" is required.');
  }
  if (type !== 'widget') {
    errors.push('Manifest field "type" must be "widget".');
  }
  if (!entry) {
    errors.push('Manifest field "entry" is required.');
  }
  if (!compatibility) {
    errors.push('Manifest field "compatibility" is required.');
  }

  const frontendEntry = entry?.frontend;
  const backendEntry = entry?.backend;
  const styleEntries = normalizeStringArray(entry?.styles);

  if (!isSafeRelativePath(frontendEntry)) {
    errors.push('Manifest field "entry.frontend" must be a safe relative path.');
  }
  if (backendEntry !== undefined && backendEntry !== null && !isSafeRelativePath(backendEntry)) {
    errors.push('Manifest field "entry.backend" must be a safe relative path when provided.');
  }
  styleEntries.forEach((stylePath) => {
    if (!isSafeRelativePath(stylePath)) {
      errors.push(`Manifest style entry "${stylePath}" must be a safe relative path.`);
    }
  });

  const rawCapabilities = normalizeStringArray(manifest.capabilities);
  if (rawCapabilities.length === 0) {
    errors.push('Manifest field "capabilities" must contain at least one capability.');
  }
  rawCapabilities.forEach((capability) => {
    if (!CAPABILITY_SET.has(capability)) {
      errors.push(`Unknown plugin capability "${capability}".`);
    }
  });

  const slots = normalizeStringArray(manifest.slots);
  slots.forEach((slot) => {
    if (!SLOT_SET.has(slot)) {
      errors.push(`Unsupported plugin slot "${slot}".`);
    }
  });

  const activation = isPlainObject(manifest.activation) ? manifest.activation : {};
  const displayAliases = normalizeStringArray(activation.displayAliases);
  displayAliases.forEach((alias) => {
    if (!isValidPluginId(alias)) {
      errors.push(`Display alias "${alias}" must match ^[a-z0-9-]+$.`);
    }
  });

  const configNamespaceRaw = manifest.configNamespace;
  const configNamespace = typeof configNamespaceRaw === 'string' && configNamespaceRaw.trim() ? configNamespaceRaw.trim() : id;
  if (!isValidPluginId(configNamespace)) {
    errors.push('Manifest field "configNamespace" must match ^[a-z0-9-]+$ when provided.');
  }

  if (compatibility?.contractVersion !== CONTRACT_VERSION) {
    errors.push(`Manifest compatibility.contractVersion must be ${CONTRACT_VERSION}.`);
  }
  if (compatibility?.hostApiVersion !== HOST_PLUGIN_API_VERSION) {
    errors.push(`Manifest compatibility.hostApiVersion must be ${HOST_PLUGIN_API_VERSION}.`);
  }

  const rawOrder = manifest.order;
  const order = Number.isInteger(rawOrder) && rawOrder >= 0 ? rawOrder : 1000;

  return {
    valid: errors.length === 0,
    errors,
    manifest: {
      id,
      version,
      title,
      type: 'widget',
      entry: {
        frontend: frontendEntry,
        backend: typeof backendEntry === 'string' ? backendEntry.trim() : null,
        styles: styleEntries,
      },
      slots: slots.length > 0 ? slots : ['main'],
      order,
      capabilities: rawCapabilities,
      configNamespace,
      activation: {
        enabledByDefault: activation.enabledByDefault === true,
        displayAliases,
      },
      compatibility: {
        contractVersion: CONTRACT_VERSION,
        hostApiVersion: HOST_PLUGIN_API_VERSION,
      },
    },
  };
}

module.exports = {
  CANONICAL_PLUGIN_CAPABILITIES,
  CONTRACT_VERSION,
  HOST_PLUGIN_API_VERSION,
  isSafeRelativePath,
  validatePluginManifest,
};
