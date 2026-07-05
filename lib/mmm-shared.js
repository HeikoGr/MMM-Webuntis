(function initMMModuleShared(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.MMModuleShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMMModuleShared() {
  const LEVELS = {
    none: -1,
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  function normalizeLevel(level, fallback = 'info') {
    return Object.hasOwn(LEVELS, level) ? level : fallback;
  }

  function sanitizeForLogging(value, redactedKeys) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    const seen = new WeakSet();

    function cloneAndRedact(input) {
      if (!input || typeof input !== 'object') {
        return input;
      }

      if (seen.has(input)) {
        return '[Circular]';
      }
      seen.add(input);

      if (Array.isArray(input)) {
        return input.map((item) => cloneAndRedact(item));
      }

      const output = {};
      for (const [key, nested] of Object.entries(input)) {
        const lowered = String(key).toLowerCase();
        if (redactedKeys.some((token) => lowered.includes(token))) {
          output[key] = '***redacted***';
          continue;
        }
        output[key] = cloneAndRedact(nested);
      }

      return output;
    }

    return cloneAndRedact(value);
  }

  function createLogger({
    moduleName,
    identifier,
    getLevel = () => 'info',
    structured = true,
    redact = true,
    redactedKeys = ['password', 'token', 'apikey', 'secret', 'qrcode', 'refreshtoken'],
    consoleRef = console,
  } = {}) {
    function write(level, message, context) {
      const configured = normalizeLevel(typeof getLevel === 'function' ? getLevel() : getLevel, 'info');
      const current = normalizeLevel(level, 'info');
      if (LEVELS[current] > LEVELS[configured]) {
        return;
      }

      const method = current === 'debug' ? 'debug' : current;
      const outputContext = redact ? sanitizeForLogging(context, redactedKeys) : context;

      if (structured) {
        consoleRef[method]({
          ts: Date.now(),
          level: current,
          module: moduleName,
          identifier: identifier || null,
          message,
          context: outputContext || {},
        });
        return;
      }

      const prefix = `[${moduleName}${identifier ? `:${identifier}` : ''}]`;
      if (outputContext === undefined) {
        consoleRef[method](prefix, message);
        return;
      }
      consoleRef[method](prefix, message, outputContext);
    }

    return {
      debug: (message, context) => write('debug', message, context),
      info: (message, context) => write('info', message, context),
      warn: (message, context) => write('warn', message, context),
      error: (message, context) => write('error', message, context),
      child(extraIdentifier) {
        return createLogger({
          moduleName,
          identifier: extraIdentifier || identifier,
          getLevel,
          structured,
          redact,
          redactedKeys,
          consoleRef,
        });
      },
    };
  }

  function buildNotifications(moduleName) {
    return {
      REQUEST: `${moduleName}_REQUEST`,
      CONFIG: `${moduleName}_CONFIG`,
      LIFECYCLE: `${moduleName}_LIFECYCLE`,
      RESPONSE: `${moduleName}_RESPONSE`,
      EVENT: `${moduleName}_EVENT`,
      ERROR: `${moduleName}_ERROR`,
    };
  }

  function generateRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function createModuleContext(moduleName, identifier, options = {}) {
    const instanceId = options.instanceId || identifier || 'default';
    const featureFlags = {
      logLevel: options.logLevel || 'info',
      logStructured: options.logStructured !== false,
      logRedaction: options.logRedaction !== false,
      strictValidation: options.strictValidation === true,
      allowLegacyKeys: options.allowLegacyKeys === true,
      multiInstanceMode: options.multiInstanceMode || 'auto',
    };

    return {
      moduleName,
      identifier: identifier || 'default',
      instanceId,
      featureFlags,
      now: () => Date.now(),
      requestIdFactory: generateRequestId,
    };
  }

  function createEnvelope(input) {
    return {
      identifier: input.identifier || 'default',
      instanceId: input.instanceId || input.identifier || 'default',
      requestId: input.requestId || generateRequestId(),
      ts: input.ts || Date.now(),
      action: input.action,
      ok: Boolean(input.ok),
      data: input.data === undefined ? null : input.data,
      error: input.error || null,
      meta: input.meta || {},
    };
  }

  function createTransport({ moduleName, identifier, instanceId, sendSocketNotification }) {
    const notifications = buildNotifications(moduleName);

    return {
      notifications,
      sendRequest(action, data, meta = {}) {
        const payload = createEnvelope({
          identifier,
          instanceId: instanceId || identifier,
          action,
          ok: true,
          data,
          meta,
        });
        sendSocketNotification(notifications.REQUEST, payload);
        return payload.requestId;
      },
      sendConfig(config) {
        sendSocketNotification(
          notifications.CONFIG,
          createEnvelope({
            identifier,
            instanceId: instanceId || identifier,
            action: 'CONFIG',
            ok: true,
            data: config,
          })
        );
      },
      sendLifecycle(state) {
        sendSocketNotification(
          notifications.LIFECYCLE,
          createEnvelope({
            identifier,
            instanceId: instanceId || identifier,
            action: state,
            ok: true,
            data: null,
          })
        );
      },
    };
  }

  function createNodeTransport({ moduleName, sendSocketNotification }) {
    const notifications = buildNotifications(moduleName);

    return {
      notifications,
      sendSuccess(requestEnvelope, data, meta = {}) {
        sendSocketNotification(
          notifications.RESPONSE,
          createEnvelope({
            identifier: requestEnvelope.identifier,
            instanceId: requestEnvelope.instanceId,
            requestId: requestEnvelope.requestId,
            action: requestEnvelope.action,
            ok: true,
            data,
            meta,
          })
        );
      },
      sendError(requestEnvelope, error, meta = {}) {
        sendSocketNotification(
          notifications.ERROR,
          createEnvelope({
            identifier: requestEnvelope.identifier,
            instanceId: requestEnvelope.instanceId,
            requestId: requestEnvelope.requestId,
            action: requestEnvelope.action,
            ok: false,
            data: null,
            error,
            meta,
          })
        );
      },
    };
  }

  function createErrorFactory() {
    return {
      createError(code, message, details = {}, retryable = false, severity = 'error') {
        return { code, message, details, retryable, severity };
      },
      fromException(error, context = {}) {
        const message = error instanceof Error ? error.message : String(error);
        const code = context.code || 'UNKNOWN_ERROR';
        return {
          code,
          message,
          details: {
            ...(context.details || {}),
            originalName: error instanceof Error ? error.name : typeof error,
          },
          retryable: context.retryable === true,
          severity: context.severity || 'error',
        };
      },
    };
  }

  function createValidator({ schema = {}, defaults = {}, strictValidation = false } = {}) {
    function validateValue(path, value, rule, errors) {
      const expected = rule.type;
      const actual = Array.isArray(value) ? 'array' : typeof value;
      if (expected && expected !== actual) {
        errors.push(`${path} must be ${expected}, got ${actual}`);
        return;
      }
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(`${path} must be one of ${rule.enum.join(', ')}`);
      }
      if (expected === 'number') {
        if (rule.min !== undefined && value < rule.min) {
          errors.push(`${path} must be >= ${rule.min}`);
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push(`${path} must be <= ${rule.max}`);
        }
      }
      if (rule.schema && expected === 'object') {
        for (const [nestedKey, nestedRule] of Object.entries(rule.schema)) {
          const nestedValue = value ? value[nestedKey] : undefined;
          if (nestedRule.required && nestedValue === undefined) {
            errors.push(`${path}.${nestedKey} is required`);
            continue;
          }
          if (nestedValue !== undefined) {
            validateValue(`${path}.${nestedKey}`, nestedValue, nestedRule, errors);
          }
        }
      }
    }

    return {
      normalize(rawConfig = {}) {
        return { ...defaults, ...rawConfig };
      },
      validate(rawConfig = {}) {
        const normalized = { ...defaults, ...rawConfig };
        const errors = [];
        for (const [key, rule] of Object.entries(schema)) {
          const value = normalized[key];
          if (rule.required && value === undefined) {
            errors.push(`${key} is required`);
            continue;
          }
          if (value !== undefined) {
            validateValue(key, value, rule, errors);
          }
        }
        return {
          valid: strictValidation ? errors.length === 0 : errors.length === 0,
          config: normalized,
          errors,
          warnings: [],
          legacyUsed: [],
        };
      },
      explain(errors = [], warnings = []) {
        return { errors, warnings };
      },
    };
  }

  function createInstanceRegistry({ mode = 'auto' } = {}) {
    const states = new Map();

    function resolveKey(identifier, payload = {}) {
      if (mode === 'disabled') {
        return 'default';
      }
      if (mode === 'enabled') {
        return payload.instanceId || identifier || 'default';
      }
      return payload.instanceId || identifier || 'default';
    }

    return {
      resolveKey,
      get(key) {
        return states.get(key);
      },
      set(key, value) {
        states.set(key, value);
      },
      delete(key) {
        states.delete(key);
      },
      cleanup(maxAgeMs) {
        const now = Date.now();
        for (const [key, value] of states.entries()) {
          if (!value || !value.updatedAt || now - value.updatedAt > maxAgeMs) {
            states.delete(key);
          }
        }
      },
    };
  }

  return {
    LEVELS,
    normalizeLevel,
    buildNotifications,
    createModuleContext,
    createTransport,
    createNodeTransport,
    createLogger,
    createValidator,
    createErrorFactory,
    createInstanceRegistry,
    createEnvelope,
    sanitizeForLogging,
  };
});
