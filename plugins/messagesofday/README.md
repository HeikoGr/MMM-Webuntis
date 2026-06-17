# messagesofday Plugin

Reference first-party widget plugin for the planned MMM-Webuntis plugin host.

Contents:

- `manifest.json`: canonical plugin manifest
- `backend.js`: minimal backend registration with config validation and capabilities
- `frontend.js`: minimal frontend registration and render implementation
- `styles.css`: plugin-scoped CSS hooks

Current status:

- infrastructure pilot only
- loaded by the future plugin host during initialization
- does not replace the current built-in `widgets/messagesofday.js` path yet