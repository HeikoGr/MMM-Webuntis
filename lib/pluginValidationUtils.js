function createConfigIssue(pluginId, message, severity = 'warning', extra = {}) {
  return {
    pluginId,
    message,
    severity,
    kind: 'config',
    ...extra,
  };
}

function validateConfigObject(pluginId, pluginConfig, label) {
  if (pluginConfig === undefined || pluginConfig === null) return [];
  if (typeof pluginConfig !== 'object' || Array.isArray(pluginConfig)) {
    return [createConfigIssue(pluginId, `${label} plugin config must be an object.`)];
  }
  return [];
}

function buildFieldPath(scope, key) {
  return `${scope}.${key}`;
}

function validateNonNegativeField(issues, pluginId, scope, config, key, options = {}) {
  const value = config?.[key];
  const path = buildFieldPath(scope, key);
  if (value === undefined || value === null) return;
  if (!Number.isFinite(value)) {
    issues.push(createConfigIssue(pluginId, `${path} must be a number. Value: ${value}`));
    return;
  }

  if (value < 0) {
    issues.push(createConfigIssue(pluginId, `${path} cannot be negative. Value: ${value}`));
    return;
  }

  if (typeof options.upperCondition === 'function' && options.upperCondition(value)) {
    const message =
      typeof options.upperMessage === 'function'
        ? options.upperMessage(value, path)
        : `${path} exceeds the recommended range. Value: ${value}`;
    issues.push(createConfigIssue(pluginId, message, options.upperSeverity || 'warning'));
  }
}

function validateMinimumField(issues, pluginId, scope, config, key, minimum, options = {}) {
  const value = config?.[key];
  const path = buildFieldPath(scope, key);
  if (value === undefined || value === null) return;
  if (!Number.isFinite(value)) {
    issues.push(createConfigIssue(pluginId, `${path} must be a number. Value: ${value}`));
    return;
  }
  if (!Number.isFinite(minimum)) {
    throw new TypeError(`validateMinimumField: minimum must be a finite number, got ${minimum}`);
  }

  if (value < minimum) {
    const message =
      typeof options.lowerMessage === 'function'
        ? options.lowerMessage(value, path, minimum)
        : `${path} must be at least ${minimum}. Value: ${value}`;
    issues.push(createConfigIssue(pluginId, message));
    return;
  }

  if (typeof options.upperCondition === 'function' && options.upperCondition(value)) {
    const message =
      typeof options.upperMessage === 'function'
        ? options.upperMessage(value, path, minimum)
        : `${path} exceeds the recommended range. Value: ${value}`;
    issues.push(createConfigIssue(pluginId, message));
  }
}

function validatePositiveNumberField(issues, pluginId, scope, config, key, options = {}) {
  const rawValue = config?.[key];
  if (rawValue === undefined || rawValue === null) return;

  const path = buildFieldPath(scope, key);
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    const message =
      typeof options.invalidMessage === 'function'
        ? options.invalidMessage(rawValue, path)
        : `${path} must be a positive number. Value: ${rawValue}`;
    issues.push(createConfigIssue(pluginId, message));
    return;
  }

  if (typeof options.lowerCondition === 'function' && options.lowerCondition(value)) {
    const message =
      typeof options.lowerMessage === 'function'
        ? options.lowerMessage(value, path)
        : `${path} is below the recommended range. Value: ${value}`;
    issues.push(createConfigIssue(pluginId, message));
    return;
  }

  if (typeof options.upperCondition === 'function' && options.upperCondition(value)) {
    const message =
      typeof options.upperMessage === 'function'
        ? options.upperMessage(value, path)
        : `${path} exceeds the recommended range. Value: ${value}`;
    issues.push(createConfigIssue(pluginId, message));
  }
}

module.exports = {
  buildFieldPath,
  createConfigIssue,
  validateConfigObject,
  validateMinimumField,
  validateNonNegativeField,
  validatePositiveNumberField,
};
