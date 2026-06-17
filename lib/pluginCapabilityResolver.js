const { CANONICAL_PLUGIN_CAPABILITIES } = require('./pluginManifestValidator');

const CAPABILITY_SET = new Set(CANONICAL_PLUGIN_CAPABILITIES);

function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) return [];
  return Array.from(
    new Set(
      capabilities.filter((capability) => typeof capability === 'string' && CAPABILITY_SET.has(capability)).map((capability) => capability)
    )
  ).sort();
}

function collectCapabilities(pluginRecords = [], options = {}) {
  const getPluginConfig = typeof options.getPluginConfig === 'function' ? options.getPluginConfig : () => ({});
  const out = new Set();

  for (const pluginRecord of pluginRecords) {
    if (!pluginRecord?.manifest?.id) continue;
    const pluginConfig = getPluginConfig(pluginRecord.manifest.id);
    const instanceCapabilities =
      typeof pluginRecord.instance?.getCapabilities === 'function'
        ? pluginRecord.instance.getCapabilities(pluginConfig, options.helpers || {})
        : null;
    const sourceCapabilities = Array.isArray(instanceCapabilities) ? instanceCapabilities : pluginRecord.manifest.capabilities;
    normalizeCapabilities(sourceCapabilities).forEach((capability) => {
      out.add(capability);
    });
  }

  return Array.from(out).sort();
}

function buildFetchFlagsFromCapabilities(capabilities = []) {
  const capabilitySet = new Set(normalizeCapabilities(capabilities));

  return {
    fetchTimetable: capabilitySet.has('lessons'),
    fetchTimegrid: capabilitySet.has('timeUnits'),
    fetchExams: capabilitySet.has('exams'),
    fetchHomeworks: capabilitySet.has('homework'),
    fetchAbsences: capabilitySet.has('absences'),
    fetchMessagesOfDay: capabilitySet.has('messages'),
  };
}

module.exports = {
  buildFetchFlagsFromCapabilities,
  collectCapabilities,
  normalizeCapabilities,
};
