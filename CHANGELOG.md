# Changelog

## [0.10.1](https://github.com/HeikoGr/MMM-Webuntis/compare/v0.10.0...v0.10.1) (2026-08-19)


### 🐛 Fixes

* add node_helper stop() to clear cached auth state on shutdown ([3b6e6cf](https://github.com/HeikoGr/MMM-Webuntis/commit/3b6e6cf4a8475fe365fef33135647ad628dbc7fd))
* cap raw API debug dumps at 50 files ([afa8343](https://github.com/HeikoGr/MMM-Webuntis/commit/afa834399f0f0e6cbc2725175ac6715f2d6f41b4))
* catch unhandled rejections in socketNotificationReceived ([06b29e8](https://github.com/HeikoGr/MMM-Webuntis/commit/06b29e8b1a4928c9f1203fbb1f82f39cdbd3f184))
* escape time-unit period name in grid time axis ([582118c](https://github.com/HeikoGr/MMM-Webuntis/commit/582118cb51a117772b0b9f827353c4d4e3da6f53))
* guard plugin widget init promise chain with a catch ([da243f7](https://github.com/HeikoGr/MMM-Webuntis/commit/da243f7659230c0dfa51738c217bfff1d97a36bc))
* redact credential-shaped fields in raw API and appData dumps ([f5299f1](https://github.com/HeikoGr/MMM-Webuntis/commit/f5299f19ad52a33b08a2648d0bec8587608edb97))
* redact qrcode and other secret-shaped fields in debug dumps ([7b9ca2c](https://github.com/HeikoGr/MMM-Webuntis/commit/7b9ca2cc10a62b0c9dd849bfcf4bd39f420223be))
* respect prefers-reduced-motion for the grid overlap ticker ([e5b1169](https://github.com/HeikoGr/MMM-Webuntis/commit/e5b1169076926fa0271c709e17910b2b913ebdb5))


### ⚡ Performance

* render through the shared lifecycle instead of calling updateDom() directly ([1affca6](https://github.com/HeikoGr/MMM-Webuntis/commit/1affca6baed43036b689f646c53e7c521ed14996))


### 🧱 Refactoring

* remove dead code with no callers ([36ffa1a](https://github.com/HeikoGr/MMM-Webuntis/commit/36ffa1a6f4f92796fa4e6d3f83529bdecb733188))


### 📚 Documentation

* correct Node version requirement to match package.json engines ([0497238](https://github.com/HeikoGr/MMM-Webuntis/commit/0497238174a3d4b360255875b710e923e30f5f81))
* document the missing top-level config options in the wiki ([dc256ae](https://github.com/HeikoGr/MMM-Webuntis/commit/dc256aea2a34310ab654810c9802a741a3de4d28))
* document unredacted config logging as an intentional design decision ([26f9264](https://github.com/HeikoGr/MMM-Webuntis/commit/26f92646589ee7a52e92342c31e6912af71f1903))


### 🧪 Testing

* cover frontend preserve/warning/widget-selection logic ([d013985](https://github.com/HeikoGr/MMM-Webuntis/commit/d0139854103b19fa359bea7ea1a46dda9519497b))

## [0.10.0](https://github.com/HeikoGr/MMM-Webuntis/compare/v0.9.0...v0.10.0) (2026-08-17)


### 🔌 Features

* **devcontainer:** enhance Playwright MCP configuration and update documentation ([eb7dd91](https://github.com/HeikoGr/MMM-Webuntis/commit/eb7dd91aae0aecbe8a4612b236be0f0d66e43e2b))
* **devcontainer:** enhance postStart script and update mounts for SSH keys ([89d35ac](https://github.com/HeikoGr/MMM-Webuntis/commit/89d35ace254f4baad6fce1b8e8a78eb589a7cafd))
* replace the hand-written frontend lifecycle with the shared helper ([3622445](https://github.com/HeikoGr/MMM-Webuntis/commit/3622445b4b391a56fed319143497843d65de3b53))


### 🐛 Fixes

* bump mmm-shared submodule to include createLifecycle ([4c3fc1a](https://github.com/HeikoGr/MMM-Webuntis/commit/4c3fc1a202b1af63ecb9d8bc655205996f4dba5d))

## [0.9.0](https://github.com/HeikoGr/MMM-Webuntis/compare/v0.8.5...v0.9.0) (2026-08-14)


### 🔌 Features

* **demo:** build the demo plugin registry from plugin manifests ([960342e](https://github.com/HeikoGr/MMM-Webuntis/commit/960342ed0b6644b534aaaece89c5dcaabb55d069))


### 🐛 Fixes

* **api:** make the configured timezone authoritative over the host clock ([307fdc2](https://github.com/HeikoGr/MMM-Webuntis/commit/307fdc24752ff47bc9f9d7034f9229d0e440264c))
* **cli:** stop mistaking flag values for the positional config path ([c292363](https://github.com/HeikoGr/MMM-Webuntis/commit/c292363c429ab0add5687e71b07ae7d16661dc5f))
* **i18n:** use literal umlauts in the German absences translation ([a2c9728](https://github.com/HeikoGr/MMM-Webuntis/commit/a2c9728c2e783ac9a94fc5ff16450c8d2f5e87d9))
* **node_helper:** release stale session state and back off from failing endpoints ([77db2a0](https://github.com/HeikoGr/MMM-Webuntis/commit/77db2a0216bc085b50db1c93d6f37e1b545c4b47))
* **plugins:** populate the plugin context dom, time, formatting and shared namespaces ([26421a8](https://github.com/HeikoGr/MMM-Webuntis/commit/26421a8a29cedb78e589064371de3eb24c33c602))


### 🧱 Refactoring

* **api:** consolidate HTML sanitizing on the sanitize-html library ([2cb05bc](https://github.com/HeikoGr/MMM-Webuntis/commit/2cb05bc1d36a3869f5b85df6ce073c110c750a71))
* **node_helper:** resolve fetch capabilities through the capability resolver ([2c72eff](https://github.com/HeikoGr/MMM-Webuntis/commit/2c72eff6a224650d8ec7b9da654afd5902836af5))
* **plugins:** move duplicated frontend helpers into frontendShared ([0c667d6](https://github.com/HeikoGr/MMM-Webuntis/commit/0c667d6296082207e4a33fbf7a2f99545555bc94))
* **plugins:** remove dead backend hooks and the superseded widget validator ([11dce81](https://github.com/HeikoGr/MMM-Webuntis/commit/11dce81e4c7f1a6377b0bf05cf7dc79c7300d561))


### 📚 Documentation

* correct architecture, plugin and changelog documentation ([d4130c3](https://github.com/HeikoGr/MMM-Webuntis/commit/d4130c3ba386305a3312dc1a444310ec2374b0e4))


### 🧪 Testing

* cover date context resolution across host timezones ([755c8c4](https://github.com/HeikoGr/MMM-Webuntis/commit/755c8c4108f819c10fb26e42ec903850e5e3f410))
* cover session eviction, endpoint backoff, CLI parsing and shared namespaces ([9b97337](https://github.com/HeikoGr/MMM-Webuntis/commit/9b9733752ab64cac864cec0f01f47263e2b7bc37))


### 📦 Build & Dependencies

* **devcontainer:** install the GitHub CLI ([f4c298b](https://github.com/HeikoGr/MMM-Webuntis/commit/f4c298b66321ad9abc5bcdcfe037b9ac7b2e797f))
* **devcontainer:** pin the container to Europe/Berlin ([0f7d0b8](https://github.com/HeikoGr/MMM-Webuntis/commit/0f7d0b8da4cf0232288ad9048bdbe2694f42a80f))
* enforce commit conventions and repair the spell-check gate ([f427bcd](https://github.com/HeikoGr/MMM-Webuntis/commit/f427bcde3c144214582c23344c98a2c7c5fbb4d5))
* teach Copilot the repository commit conventions ([b7faf77](https://github.com/HeikoGr/MMM-Webuntis/commit/b7faf77c652d5d25aca9c19ecdf97c5fe184a071))


### 🔧 Tooling

* run lint, tests and spell check on PRs and automate releases ([7971efa](https://github.com/HeikoGr/MMM-Webuntis/commit/7971efa4a84ce201b08807c2e2f476f8174ad8b8))
* run the unit tests under UTC and Europe/Berlin ([73eaf2e](https://github.com/HeikoGr/MMM-Webuntis/commit/73eaf2e1bb2ee5def2f7927195185f349c6490e5))
* sync package-lock.json engines field to &gt;=22.22.1 ([f7b2715](https://github.com/HeikoGr/MMM-Webuntis/commit/f7b2715cc499e2e5cfa71cf124919a0157dce545))
* upgrade Node setup action to v7 ([b36fc85](https://github.com/HeikoGr/MMM-Webuntis/commit/b36fc8535519b611fbdccee071ec5ae82a35be41))
* upgrade Node.js to 22 and align package.json engines ([a5b6198](https://github.com/HeikoGr/MMM-Webuntis/commit/a5b61986f60349df18548e98bc8b45e2e2ad5aeb))

## 0.8.5 - 2026-07-26

### ⚙️ Configuration

- Added `MMM-Config.schema.json`, a full JSON schema of every module and plugin option, so MMM-Config can render a form-based editor for this module.
- Changed internal `defaults` reads from `this.defaults` to `this['defaults']`. MMM-Config extracts the defaults block by parsing the source, and bracket access keeps that parse reliable.
- Removed the 80-line `plugins` block from the module `defaults`. Plugin defaults now come solely from each plugin backend's `getDefaultConfig()`, which removes a second, drifting source of truth. Plugin activation was already driven by `displayMode` or an explicit `plugins.<id>.enabled`, since every manifest declares `enabledByDefault: false`.

## 0.8.4 - 2026-07-22

### 📚 Documentation

- Rewrote the README around a minimal quick-start config and moved detailed setup into the wiki.
- Added screenshots to the wiki home page.

## 0.8.3 - 2026-07-09

### 🧱 Architecture & Runtime

- Converted the bundled `lib/mmm-shared.js` into the `lib/mmm-shared` git submodule so the shared transport, envelope, and logger helpers can be reused across modules. `postinstall` runs `scripts/install-mmm-shared-submodule.js` to fetch it.

### 📚 Documentation

- Added the `wiki/` documentation set (installation, quick start, configuration, authentication, troubleshooting, update, and one page per plugin) plus a workflow that syncs it to the GitHub wiki.
- Consolidated plugin documentation into a single current-state reference at `docs/PLUGINS.md`, and updated architecture, configuration, and API docs to describe the shipped plugin runtime instead of the earlier migration target state.
- Corrected payload-contract documentation so V3 is documented as the currently shipped frontend/backend contract and V2 is treated as archived history.
- Renamed remaining "widgets" terminology to "plugins" across docs and code.

### 🔧 Tooling

- Switched Dependabot to daily checks and added an auto-merge workflow for minor and patch updates.

## 0.8.2 - 2026-07-05

### 🌐 API & Data Handling

- Replaced the flat socket-notification protocol with a two-channel envelope. Frontend and backend now exchange `MMM-Webuntis_REQUEST` and `MMM-Webuntis_EVENT`, each carrying `{ action, requestId, ts, data, error }`, which makes responses correlatable and log redaction uniform.
- Renamed the actions carried in that envelope: `INIT_MODULE` → `CONFIGURE`, `FETCH_DATA` → `REFRESH`, `GOT_DATA` → `DATA_UPDATE`, `MODULE_INITIALIZED` → `MODULE_READY`, `INIT_ERROR` → `MODULE_INIT_FAILED`.
- Replaced `lib/logger.js` with the broader `lib/mmm-shared.js`, which provides the notification names, envelope factory, and request-id generation used by both runtime halves.

## 0.8.1 - 2026-07-02

The widgets-to-plugins migration. `displayMode` remains a supported public config option; the backend normalizes it into `plugins.<id>.enabled`.

Note: the version jumped from `0.7.14` straight to `0.8.1`; no `0.8.0` was ever released.

### 🔌 Plugin Architecture

- Replaced the `widgets/` directory with `plugins/`, where each of the six first-party plugins (`grid`, `lessons`, `exams`, `homework`, `absences`, `messagesofday`) owns its `manifest.json`, `frontend.js`, optional `backend.js`, `styles.css`, and `translations/`.
- Introduced the plugin host: `lib/pluginLoader.js` discovers and validates plugin folders, `lib/pluginHostBackend.js` and `lib/pluginHostFrontend.js` load and register entrypoints, and `lib/pluginManifestValidator.js` enforces the manifest contract including safe relative entry paths.
- Added the capability model in `lib/pluginCapabilityResolver.js`: plugins declare what data they need, and the backend derives fetch flags from the union of active plugins instead of from hardcoded display flags.
- Split the monolithic `MMM-Webuntis.css` and the two module translation files, moving plugin-specific styles and strings into the owning plugin.
- Promoted `widgets/util.js` to `lib/frontendShared.js` as the shared frontend helper API.
- Added `docs/schemas/plugin-widget-manifest.schema.json` and `docs/PLUGINS.md`.
- Introduced `messagesofday` as a first-party plugin with its own frontend and backend entrypoints.

### 🖥️ Frontend

- Added clock-driven day rollover so the display advances at midnight without waiting for the next fetch.

## 0.7.14 - 2026-06-17

### 🖥️ Widgets & Frontend

- Fixed `lessons.nextDays: 0` being treated as "not configured" and silently skipping the widget. Zero is now a valid value meaning "no future days"; only a missing value skips.

### ⚙️ Configuration

- Adjusted the config template defaults: `lessons.nextDays` 4 → 2 and `exams.nextDays` 2 → 4, matching the typical use of a short lesson list next to a longer exam outlook.

## 0.7.6 - 0.7.13

Historical changelog catch-up for the previously undocumented range between `0.7.5` and `0.7.13`.

### 🧱 Architecture & Runtime

- Added the CLI wrapper and expanded local diagnostics around `node --run debug`, `node --run check`, and related maintenance scripts.
- Migrated linting and formatting to Biome and cleaned up repository automation around hooks, tasks, and devcontainer workflows.
- Introduced `require-devcontainer` task integration and simplified Docker/devcontainer bootstrap behavior.
- Centralized date handling, logger behavior, transport constants, and parts of widget data shaping to reduce duplication across the stack.

### 🌐 API & Data Handling

- Improved REST error handling, retry behavior, and timeout handling across the transport layer.
- Added endpoint-discovery and API-service tooling, plus better diagnostics for low-level API investigation.
- Implemented day-notice handling and updated translations for timetable restrictions.
- Improved teacher-target fetching and error-message context for backend fetch flows.

### 🖥️ Widgets & Frontend

- Refined lesson visibility, lesson text normalization, and grid/widget data consumption around `displayIcons` and related lesson markers.
- Continued cleanup of widget data structures so frontend rendering depends more consistently on normalized backend data.

### ⚠️ Validation, Security & Sanitization

- Strengthened configuration validation and warning handling in `node_helper.js`.
- Addressed multiple code-scanning findings, including sanitization and path-handling issues.
- Improved payload processing and related logging around runtime error conditions.

### 📚 Documentation & Tooling

- Consolidated configuration and CSS customization docs, refreshed API documentation, and improved usage guidance for diagnostics and testing tools.
- Updated development dependencies such as `Biome`, `cspell`, `lint-staged`, and `sanitize-html` across the release line.

## 0.7.5

### ✅ Stability & Recovery

- Backend initialization is more reliable during MagicMirror startup, reducing cases where the module stayed empty until a later cycle.
- Runtime warnings are now delivered more consistently after per-student fetch failures and are cleared again after healthy fetches.
- Authentication, network-error handling, and auto-discovery flows were tightened to reduce empty-data states in mixed and parent-account setups.

### 🌐 WebUntis API Handling

- Endpoints that permanently return HTTP `403` are handled gracefully and skipped on later fetches instead of producing repeated noisy failures.
- Internal fetch orchestration and payload assembly were cleaned up without changing the documented frontend contract, making data refreshes more predictable.

### 🎨 UI & Customization

- Student config merging and widget fallback resolution were refined so per-student rendering behaves more consistently across widgets.
- Widget CSS class names were normalized for consistency. Users with custom CSS overrides should review their selectors after updating.

### 🔧 Compatibility

- The supported minimum Node.js version is now `>=20.18.1`.
- This requirement is based on observed authentication/runtime failures on older Node 20 installations. The most likely area is the native HTTP/fetch stack used by the module, but the exact lower-version break point is not isolated yet.

### 📚 Documentation

- README, configuration docs, architecture docs, API docs, and CSS customization docs were synchronized with the current code and release behavior.

## 0.7.4

### 🌐 API & Data Handling

- `HTTP 403` from unlicensed WebUntis endpoints is now handled gracefully: the call returns empty data and the endpoint is skipped on later cycles instead of failing the fetch.
- Normalized lesson display markers into a single `displayIcons` field, so widgets no longer derive icon state themselves from scattered status fields.
- Switched to a single `AbortController` for the full request lifecycle, fixing timeouts that could leave requests running.

### 🖥️ Widgets & Frontend

- Reworked grid rendering and icon chip styling; widgets now consume `displayIcons` instead of duplicating the derivation.

### 🧱 Initialization

- Backend initialization is now triggered via `DOM_OBJECTS_CREATED`, with configurable init-retry options for slow or hidden startups.

### 🔧 Tooling

- Added `scripts/webuntis-network-toggle.sh` for simulating network loss during diagnostics.

## 0.7.2 - 0.7.3

Historical catch-up. This entry was originally filed under `0.7.4`; the work landed in `0.7.2` and `0.7.3`.

### 🧱 Architecture & Data Flow

- Backend fetching was further modularized and cleaned up: orchestration now flows more clearly through `webuntisClient`, mapper, and payload builder layers, with better separation of responsibilities.
- Initialization was improved: backend init is triggered more deliberately (deferred initialization), session state is handled more robustly, and fetch cycles are more stable.
- The API v2 contract and payload structure were unified consistently and documented throughout (including refreshed reference docs).

### ⚠️ Warnings, Errors & Auth

- Runtime warnings were normalized and extended with metadata; warnings are now processed and displayed more consistently per student.
- Empty-data warnings now factor in timetable API status more accurately to reduce false positives.
- Error handling and auth handling were improved across multiple services, especially for re-auth and API error scenarios.

### 🧼 Security & Sanitization

- Several code-scanning findings were addressed (including sanitization/unescaping, randomness, and path-handling topics).
- `sanitizeHtmlText` was fixed so decoded entities are preserved and `preserveLineBreaks` is handled correctly.

### 🖼️ UI & Widget Improvements

- Lessons/Grid now support placeholders for changed fields, making field changes clearer in the UI.
- Widget headers were enhanced with dynamic titles.
- Optional legacy color-scheme documentation and CSS overrides were added (for the previous multi-color look).

### 📦 Packaging

- Package metadata and exports were revised (including README in package contents), plus minor maintenance updates to install scripts.

### 🗂️ Module Layout (0.7.3)

- Split the WebUntis core into `lib/webuntis/*` (auth, HTTP, REST, cache, cookies, orchestration) and the MMM adapter into `lib/webuntis-client/*`, establishing the layer boundary the module still uses today.
- Added `lib/webuntis/webuntisClient.js` as the facade over that core and moved payload mapping into a dedicated mapper, shrinking `node_helper.js` substantially.

## 0.7.1

### 🔧 Maintenance

- Dependency update: `minimatch` was updated.
- Version bumped to `0.7.1`.

## 0.7.0

### ✨ Widgets & UI

- MessagesOfDay cards now render in a responsive masonry layout: each card keeps its own height and columns are filled top-to-bottom so dense announcement sets no longer create table-like gaps.
- The timetable grid received a major pass: `grid.pxPerMinute` lets you tune the vertical scale, split-view lessons swap sides for better readability, ticker rows preserve spacing, and the "now" line updater now targets the module root to avoid stale references.
- Widget config lookup is now centralized, giving lessons/homework/exams consistent fallbacks for student-specific overrides and keeping per-widget options in sync.

### ⚙️ Configuration & Data Flow

- Added validation and documentation for `grid.pxPerMinute` (warns outside 0.2–5) and removed the obsolete `fetchIntervalMs` legacy mapping to reduce noisy warnings.
- Node helper now merges student overrides once during init, reducing duplicated config mutations before fetch orchestration kicks in.

### 🎨 Theming & Docs

- Extended the CSS variable palette (including the exam bar) and refreshed `config/custom.template.css` plus `docs/CSS_CUSTOMIZATION.md` to reflect the new tokens and layout guidance.

### 🐛 Fixes

- Messages-of-day markup no longer inherits `display: contents`, preventing flex quirks in custom themes.
- Lesson span spacing, split overlays, and the grid "now" line all receive targeted fixes to eliminate overlapping borders in dense schedules.

## 0.6.14

### 🧰 Developer Experience

- Removed the redundant `bootstrap-magicmirror.sh` call from the devcontainer post-create hook and Dockerfile so provisioning runs exactly once and no longer double-installs MagicMirror dependencies.

## 0.6.13

### ⚙️ API & Widget Logic

- Centralized the WebUntis `position1–7` mapping logic: lessons now expose `changedFields`, retain `teOld/suOld/roOld`, and log INFO entries for future debugging.
- Homework and exam extraction use stricter student matching plus smarter subject fallback so reminders stay linked even when the underlying lesson is missing.
- Updated absences/exams/homework/grid widgets (and `widgets/util.js`) to reuse the new config resolver, reducing per-widget drift.

### 🧪 Tooling

- `scripts/magicmirror-check.mjs` and related maintenance scripts gained clearer health output, better dump toggles, and improved MagicMirror bootstrap handling.

## 0.6.12

### 🛠️ Development Environment

- Overhauled the devcontainer setup: streamlined Dockerfile layers, added a single bootstrap path via `bootstrap-magicmirror.sh`, and aligned `entrypoint.sh` / `postCreate.sh` so the local MagicMirror install is reliable on first launch.

## 0.6.2 - 0.6.11

Historical changelog catch-up for the previously undocumented range between `0.6.1` and `0.6.12`.

### 🖥️ Widgets & Frontend

- Substantially expanded the grid widget: overlapping-lesson handling, split view for cancelled plus replacement lessons, ticker animation for parallel lessons, and absence overlays.
- Reworked the shared widget utilities around consistent field extraction and formatting.

### 🌐 API & Data Handling

- Reworked payload compaction and the WebUntis API service, reducing the payload sent to the frontend.

### 🔧 Tooling

- Heavily expanded `scripts/magicmirror-check.mjs` and added `scripts/test_with_dump.js` for fixture-based backend testing.

## 0.6.1

### ✨ New Features

- **Flexible Lesson Display**: New configuration options for grid widget to customize which fields are displayed (teachers, rooms, classes, student groups)
  - Configure via `grid.fields` in config - choose any combination of available data fields
  - Dynamic field extraction for improved lesson display flexibility
  - Support for new activity types in lesson rendering

### 🛠️ Improvements

- **Smarter API Error Handling**: Module now tracks API status codes and automatically skips endpoints with permanent errors (403, 404, 410) to reduce unnecessary API calls
- **Enhanced Authentication**: Session-wide authentication management with aggressive reauthentication on auth errors for more reliable token handling
- **Better Performance**: Optimized data fetching by tracking last received data timestamp to prevent unnecessary API calls
- **Role Discovery**: QR code login now extracts and handles user roles from authentication tokens
- **Improved Styling**: Enhanced CSS with semantic classes for better customization and accessibility

### 🐛 Bug Fixes

- Fixed git hooks installation script to handle missing dev dependencies gracefully in production installs
- Improved error handling for authentication refresh during data fetching
- Better validation for student configuration and auto-discovery logic

## 0.6.0

### ✅ Reliability & Auth

- QR login now refreshes cleanly after expiry (per-instance cache keys and forced re-auth on refresh failures) to avoid empty payloads after the 14-minute TTL.
- Better isolation in mixed environments (parent + QR + direct logins): tokens and cache entries stay separated, so instances no longer interfere with each other.

### 🖥️ User Experience

- Immediate UI updates after new data (debounce removed) — no slide switching or waiting needed to see fresh data.
- Quieter logs: QR re-auth, init success, and auto-assign messages are now debug-level.
- Absence overlay in widgets: absences now render as overlays alongside timetable/grid so missed lessons are visible without switching views.

### 🏗️ Architecture Improvements

- **Separated Socket Communication**: Split initialization (`CONFIGURE`) from data fetching (`REFRESH`) for cleaner architecture
  - Init phase: One-time config validation, authentication setup, student auto-discovery
  - Fetch phase: Pure data refresh using cached config and authentication
  - Performance: Config validation and auto-discovery now only run once instead of on every fetch
  - Better error handling: Separate error paths for initialization vs. runtime data fetch failures
  - Improved logging: Clear `[CONFIGURE]` and `[REFRESH]` tags for easier debugging

## 0.5.0

### 🚀 Major Changes: Migration to REST API

**BREAKING CHANGE**: Complete migration from deprecated JSON-RPC API to modern REST API

- **REST API Integration**: All data operations (timetable, exams, homework, absences, messages of day) now use REST endpoints instead of JSON-RPC
- **Bearer Token Authentication**: Implements secure token-based authentication for all API requests
- **QR Code Login Support**: Direct student authentication via WebUntisQR codes (`untis://setschool?...`)
- **Parent Account Mode**: Configure once with parent credentials, automatically discover and load all children
- **Auto-Discovery**: Students are automatically discovered from WebUntis `app/data` endpoint when using parent accounts
- **New Data Sources**: Access to holidays, absences (now available for parent accounts), and messages of day via REST API

### 🎯 New Features

- **Student Auto-Discovery**: Empty `students: []` array triggers automatic detection of all children in parent account
- **Flexible Authentication**: Support for QR codes, parent credentials, or traditional username/password per student
- **Enhanced Data Filtering**: Student-specific filtering for exams and absences in parent account mode
- **Holiday Integration**: Full holiday support in grid and lessons widgets with visual indicators
- **Messages of Day Widget**: New widget displaying school-wide announcements and messages
- **Improved CLI Tool**: `node --run debug` with comprehensive testing and data validation

### ⚙️ Configuration Changes

- **Parent Account Support**: Added module-level parent account credentials for multi-student setups (current canonical keys are `username`, `password`, `school`, `server`)
- **Widget-Specific Configuration**: All widgets now support nested configuration (e.g., `lessons: { dateFormat: 'EEEE' }`)
- **Unified Date Range**: `nextDays` and `pastDays` replace legacy `daysToShow` / `pastDaysToShow`
- **Enhanced Validation**: Comprehensive config validation with detailed error messages and warnings

### 🔧 Internal Improvements

- **New `lib/` Architecture**: Modularized codebase with dedicated services (authService, httpClient, cacheManager, etc.)
- **Performance Optimizations**: Shared holiday extraction, reduced redundant API calls, optimized widget initialization
- **Better Error Handling**: User-friendly error messages with REST API status code mapping
- **Code Quality**: Eliminated redundancy, improved maintainability, comprehensive documentation

## 0.4.1

- Added `maxGridLessons` (0 = all; >=1 limits by timeUnit or falls back to count).
- Vertical clipping of grid and "... more" badge when lessons are hidden.
- Period labels now align to timeUnit starts; hour lines prefer next timeUnit start (offset -2px).
- Internal: unified timeUnit bounds (`getUnitBounds`). README updated.
