const DEFAULT_CONFIG = Object.freeze({});

function createIssue(message, severity = 'warning') {
  return {
    message,
    severity,
    kind: 'config',
    pluginId: 'messagesofday',
  };
}

module.exports = {
  id: 'messagesofday',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        if (pluginConfig === undefined || pluginConfig === null) return [];
        if (typeof pluginConfig !== 'object' || Array.isArray(pluginConfig)) {
          return [createIssue('messagesofday plugin config must be an object.')];
        }
        return [];
      },

      getCapabilities() {
        return ['messages', 'studentContext'];
      },

      deriveStudentData() {
        return null;
      },
    };
  },
};
