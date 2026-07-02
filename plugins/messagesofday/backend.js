const { validateConfigObject } = require('../../lib/pluginValidationUtils');

const DEFAULT_CONFIG = Object.freeze({
  // No plugin-specific config options yet.
});

module.exports = {
  id: 'messagesofday',
  hostApiVersion: 1,

  setup() {
    return {
      getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
      },

      validateConfig(pluginConfig) {
        return validateConfigObject('messagesofday', pluginConfig, 'messagesofday');
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
