const DEFAULT_CONFIG = Object.freeze({});

function createIssue(message, severity = 'warning') {
  return {
    message,
    severity,
    kind: 'config',
    pluginId: 'grid',
  };
}

module.exports = {
  id: 'grid',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        if (pluginConfig === undefined || pluginConfig === null) return [];
        if (typeof pluginConfig !== 'object' || Array.isArray(pluginConfig)) {
          return [createIssue('grid plugin config must be an object.')];
        }
        return [];
      },

      getCapabilities() {
        return ['lessons', 'timeUnits', 'absences', 'holidays', 'dayNotices', 'studentContext'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
