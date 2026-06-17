const DEFAULT_CONFIG = Object.freeze({});

function createIssue(message, severity = 'warning') {
  return {
    message,
    severity,
    kind: 'config',
    pluginId: 'absences',
  };
}

module.exports = {
  id: 'absences',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        if (pluginConfig === undefined || pluginConfig === null) return [];
        if (typeof pluginConfig !== 'object' || Array.isArray(pluginConfig)) {
          return [createIssue('absences plugin config must be an object.')];
        }
        return [];
      },

      getCapabilities() {
        return ['absences', 'studentContext', 'runtimeState'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
