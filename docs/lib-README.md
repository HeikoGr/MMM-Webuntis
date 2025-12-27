# MMM-Webuntis refactor: lib/ utilities

This document briefly describes the new `lib/` helper modules introduced during the refactor and how they are intended to be used.

lib/restClient.js
- Unified REST caller for WebUntis REST endpoints.
- Exports: `callRestAPI(url, method, headers, body, opts)` and helpers for header building and error mapping.
- Usage: the backend `node_helper.js` should use `restClient.callRestAPI` for all REST calls to centralize auth/token handling.

lib/payloadCompactor.js
- Schema-driven compaction of raw API payloads into minimal frontend payloads.
- Exports: `compactArray(rawArray, schema)`, `compactItem`, `schemas`, `timeToMinutes`, `formatSubject`.
- Note: time fields are normalized to HHMM integers so frontend will convert to minutes consistently.

lib/configValidator.js
- Centralized configuration schema and validation.
- Exports: `validateConfig(config, logger)` which returns `{ valid, errors, warnings }`.
- Use in `socketNotificationReceived(FETCH_DATA)` to validate and surface `CONFIG_ERROR`/`CONFIG_WARNING` notifications.

lib/logger.js
- Small adapters to unify backend/frontend logging.
- Exports: `createBackendLogger(mmLogFn, moduleName)` and `createFrontendLogger(moduleName)`.

Compatibility notes
- Legacy config keys are mapped by `lib/legacy-config-mapper.js` and further normalized by `node_helper._normalizeLegacyConfig()`.
- The backend now deduplicates per-fetch warnings and suppresses repeated `CONFIG_WARNING` notifications across fetches.

If you want a more detailed developer guide or API examples, I can expand this file with code snippets and usage examples.