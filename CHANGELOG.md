# Changelog

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
- **Improved CLI Tool**: `npm run debug` with comprehensive testing and data validation

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
