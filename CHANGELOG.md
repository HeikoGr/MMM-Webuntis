# Changelog

## Unreleased

- Nothing yet. 🚧

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
