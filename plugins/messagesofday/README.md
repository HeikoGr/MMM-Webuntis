# messagesofday Plugin

Reference first-party widget plugin for the current MMM-Webuntis plugin host.

Contents:

- `manifest.json`: canonical plugin manifest
- `backend.js`: minimal backend registration with config validation and capabilities
- `frontend.js`: minimal frontend registration and render implementation
- `styles.css`: plugin-scoped CSS hooks

Current status:

- active first-party plugin loaded by the current host during initialization
- still coexists with legacy host-side fallback rendering in `MMM-Webuntis.js`