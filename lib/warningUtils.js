const DEFAULT_WARNING_META = Object.freeze({ kind: 'generic', severity: 'warning' });

function createWarningMetaEntry(message, meta = DEFAULT_WARNING_META) {
  const resolvedMeta = meta && typeof meta === 'object' ? meta : DEFAULT_WARNING_META;
  return {
    message: String(message),
    ...resolvedMeta,
  };
}

function buildWarningMetaList(messages, warningMetaByMessage = new Map(), fallbackMeta = DEFAULT_WARNING_META) {
  if (!Array.isArray(messages)) return [];

  return messages.map((message) => {
    const normalizedMessage = String(message);
    return warningMetaByMessage.get(normalizedMessage) || createWarningMetaEntry(normalizedMessage, fallbackMeta);
  });
}

function createWarningMetaMap(entries = []) {
  const warningMetaByMessage = new Map();

  entries.forEach((entry) => {
    if (!entry?.message) return;
    warningMetaByMessage.set(String(entry.message), { ...entry });
  });

  return warningMetaByMessage;
}

function mergeUniqueWarnings(...warningGroups) {
  return Array.from(
    new Set(
      warningGroups.flatMap((group) => {
        if (Array.isArray(group)) return group.filter(Boolean).map((message) => String(message));
        return group ? [String(group)] : [];
      })
    )
  );
}

function createWarningCollector(currentWarnings = null, options = {}) {
  const { fallbackMeta = DEFAULT_WARNING_META } = options;
  const warnings = [];
  const payloadWarningSet = new Set();
  const warningMetaByMessage = new Map();

  const addWarning = (message, meta = null, options = {}) => {
    const { persist = true } = options;
    if (!message) return;

    const normalizedMessage = String(message);
    if (payloadWarningSet.has(normalizedMessage)) {
      if (meta && typeof meta === 'object' && !warningMetaByMessage.has(normalizedMessage)) {
        warningMetaByMessage.set(normalizedMessage, meta);
      }
      return;
    }

    warnings.push(normalizedMessage);
    payloadWarningSet.add(normalizedMessage);

    if (meta && typeof meta === 'object') {
      warningMetaByMessage.set(normalizedMessage, meta);
    }

    if (persist && currentWarnings && typeof currentWarnings.add === 'function') {
      currentWarnings.add(normalizedMessage);
    }
  };

  if (currentWarnings && typeof currentWarnings.forEach === 'function') {
    currentWarnings.forEach((message) => {
      addWarning(message, null, { persist: false });
    });
  }

  const flushToPayload = (payload) => {
    const mergedWarnings = mergeUniqueWarnings(payload?.state?.warnings || [], warnings);
    const mergedWarningMetaByMessage = createWarningMetaMap(Array.isArray(payload?.state?.warningMeta) ? payload.state.warningMeta : []);

    warningMetaByMessage.forEach((meta, message) => {
      const existing = mergedWarningMetaByMessage.get(message) || null;
      if (!existing || (existing.kind === 'generic' && meta)) {
        mergedWarningMetaByMessage.set(message, createWarningMetaEntry(message, meta));
      }
    });

    payload.state = {
      ...(payload.state || {}),
      warnings: mergedWarnings,
      warningMeta: buildWarningMetaList(mergedWarnings, mergedWarningMetaByMessage, fallbackMeta),
    };
  };

  return {
    addWarning,
    flushToPayload,
  };
}

module.exports = {
  DEFAULT_WARNING_META,
  createWarningMetaEntry,
  buildWarningMetaList,
  createWarningMetaMap,
  mergeUniqueWarnings,
  createWarningCollector,
};
