const { NETWORK_ERROR_CODES } = require('./webuntis/transportConstants');
const { isAuthError } = require('./webuntis/errorHandler');
const { extractHttpStatus } = require('./apiStatusTracker');

const DEFAULT_WARNING_META = Object.freeze({ kind: 'generic', severity: 'warning' });

/**
 * Determine whether an error is a network connectivity failure.
 * Uses structured error codes first; falls back to message parsing only for
 * network wording variants that sometimes arrive as plain text.
 *
 * @param {Error|Object} err - Error object
 * @returns {boolean} True if network-related
 */
function isNetworkError(err) {
  const code = String(err?.code || err?.cause?.code || '').toUpperCase();
  const name = String(err?.name || err?.cause?.name || '').toUpperCase();
  if (NETWORK_ERROR_CODES.has(code)) return true;
  if (name === 'ABORTERROR' || String(err?.cause?.name || '').toUpperCase() === 'ABORTERROR') return true;

  // Allowed fallback: some lower-level fetch paths only surface text.
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('ehostunreach') ||
    msg.includes('eai_again') ||
    msg.includes('connection refused')
  );
}

/**
 * Build structured warning metadata from a fetch/auth error.
 *
 * @param {Error|Object} err - Error object
 * @param {Object} extra - Additional or overriding metadata
 * @returns {Object} warning metadata ({ kind, severity, status, code, ...extra })
 */
function classifyWarningMetaFromError(err, extra = {}) {
  const status = extractHttpStatus(err);
  const code = String(err?.code || err?.cause?.code || '').toUpperCase() || null;
  let kind = 'generic';
  let severity = 'warning';

  if (isNetworkError(err)) {
    kind = 'network';
    severity = 'critical';
  } else if (status === 401 || isAuthError(err)) {
    kind = 'auth';
    severity = 'critical';
  } else if (status === 429) {
    kind = 'rate_limit';
    severity = 'warning';
  } else if (status >= 500) {
    kind = 'server';
    severity = 'critical';
  } else if (status >= 400) {
    kind = 'client';
    severity = status === 403 ? 'warning' : 'critical';
  }

  return {
    kind,
    severity,
    status: status || null,
    code,
    ...extra,
  };
}

/**
 * Build warning metadata entries for a list of warning messages.
 *
 * @param {string[]} warnings - Warning messages
 * @param {Object} baseMeta - Metadata merged into each entry
 * @returns {Object[]} warningMeta array
 */
function buildWarningMetaEntries(warnings = [], baseMeta = {}) {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .filter((message) => Boolean(message))
    .map((message) => ({
      message: String(message),
      ...baseMeta,
    }));
}

/**
 * Flatten warning arrays from several validators into one list of non-empty strings.
 *
 * @param {...Array} warningGroups - Warning arrays
 * @returns {string[]} Flattened warnings
 */
function collectValidationWarnings(...warningGroups) {
  return warningGroups.flat().filter((warning) => typeof warning === 'string' && warning.length > 0);
}

/**
 * Collector for warnings raised while processing one credential group (auth failure, student
 * config issues) so they can be attached to every student payload of that group.
 */
function createGroupWarningCollector() {
  const groupWarnings = [];
  const groupWarningMetaByMessage = new Map();
  const currentFetchWarnings = new Set();

  return {
    groupWarnings,
    groupWarningMetaByMessage,
    currentFetchWarnings,
    addGroupWarning: (message, meta = {}) => {
      if (!message) return;
      if (!currentFetchWarnings.has(message)) {
        groupWarnings.push(message);
        currentFetchWarnings.add(message);
      }

      if (!groupWarningMetaByMessage.has(message)) {
        groupWarningMetaByMessage.set(message, {
          ...DEFAULT_WARNING_META,
          ...meta,
        });
      }
    },
  };
}

/**
 * Merge group-level warnings into a student payload's `state.warnings`/`state.warningMeta`.
 *
 * @param {Object} payload - DATA_UPDATE payload
 * @param {string[]} groupWarnings - Group warning messages
 * @param {Map} groupWarningMetaByMessage - message -> meta
 * @returns {Object} New payload object with merged warnings
 */
function mergeGroupWarningsIntoPayload(payload, groupWarnings, groupWarningMetaByMessage = new Map()) {
  const uniqWarnings = mergeUniqueWarnings(groupWarnings);
  const mergedWarnings = mergeUniqueWarnings(payload?.state?.warnings || [], uniqWarnings);
  const mergedWarningMetaByMessage = createWarningMetaMap(Array.isArray(payload?.state?.warningMeta) ? payload.state.warningMeta : []);

  uniqWarnings.forEach((message) => {
    const existing = mergedWarningMetaByMessage.get(message) || null;
    const groupMeta = groupWarningMetaByMessage.get(message) || null;
    if (!existing || (existing.kind === 'generic' && groupMeta)) {
      mergedWarningMetaByMessage.set(message, createWarningMetaEntry(message, groupMeta || DEFAULT_WARNING_META));
    }
  });

  return {
    ...payload,
    state: {
      ...(payload.state || {}),
      warnings: mergedWarnings,
      warningMeta: buildWarningMetaList(mergedWarnings, mergedWarningMetaByMessage),
    },
  };
}

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
  buildWarningMetaEntries,
  classifyWarningMetaFromError,
  collectValidationWarnings,
  createGroupWarningCollector,
  createWarningMetaMap,
  isNetworkError,
  mergeGroupWarningsIntoPayload,
  mergeUniqueWarnings,
  createWarningCollector,
};
