# Changelog

## Unreleased

- Nothing yet. 🚧

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

- **Separated Socket Communication**: Split initialization (`INIT_MODULE`) from data fetching (`FETCH_DATA`) for cleaner architecture
  - Init phase: One-time config validation, authentication setup, student auto-discovery
  - Fetch phase: Pure data refresh using cached config and authentication
  - Performance: Config validation and auto-discovery now only run once instead of on every fetch
  - Better error handling: Separate error paths for initialization vs. runtime data fetch failures
  - Improved logging: Clear `[INIT_MODULE]` and `[FETCH_DATA]` tags for easier debugging

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

- **Parent Account Support**: New config options `parentUsername`, `parentPassword` (optional, for multi-student setups)
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
