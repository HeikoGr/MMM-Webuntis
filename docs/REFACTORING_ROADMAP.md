# MMM-Webuntis Refactoring Roadmap

> **Status:** Planning Phase
> **Last Updated:** 2025-12-29
> **Code Review Date:** 2025-12-29
> **Estimated Total Effort:** ~59 hours (~1.5 weeks full-time)

## Executive Summary

This roadmap outlines critical improvements to the MMM-Webuntis codebase based on a comprehensive code review. The module is production-ready but has significant opportunities for improved maintainability, performance, and developer experience.

### Current State

- **Total LOC:** ~5,200 lines
- **Test Coverage:** 0% (linting only)
- **Code Duplication:** ~400 lines across widgets
- **Largest Function:** 461 lines (`node_helper.js::fetchData()`)
- **Performance:** Sequential API fetching (~5s total)

### Target State

- **Code Reduction:** -600 lines (-11%)
- **Test Coverage:** 50%+
- **Code Duplication:** -88% reduction
- **Performance:** 2.7x faster fetching (parallel)
- **Documentation:** 90% JSDoc coverage

---

## Priority Levels

- 🔴 **CRITICAL** - Immediate action required (security, major bugs, architecture)
- 🟡 **HIGH** - Important for quality and maintainability
- 🟢 **MEDIUM** - Improves UX and developer experience
- 🔵 **LOW** - Nice-to-have optimizations

---

## Phase 1: Critical Refactorings (Week 1-2)

**Estimated Effort:** 21 hours

### 🔴 K1: Split `node_helper.js::fetchData()` into Specialized Modules

**Problem:** Monster function with 461 lines violating Single Responsibility Principle

**Impact:**
- Hard to test (15+ unit tests needed)
- Sequential API calls (slow performance)
- Difficult to debug

**Tasks:**
- [ ] Create `lib/dataFetchOrchestrator.js` (main coordinator)
  - [ ] Implement `fetchAndBuildPayload()` method
  - [ ] Add parallel fetching with `Promise.all()`
  - [ ] Integrate with existing services
- [ ] Create `lib/dateRangeCalculator.js`
  - [ ] Extract range calculation logic (lines 1261-1310)
  - [ ] Support widget-specific overrides (grid, exams, homework)
  - [ ] Add `calculateFetchRange(widgetName)` method
- [ ] Create `lib/payloadBuilder.js`
  - [ ] Extract payload building logic (lines 1671-1689)
  - [ ] Add warning aggregation
  - [ ] Support debug dumps
- [ ] Refactor `node_helper.js::fetchData()`
  - [ ] Replace 461-line function with orchestrator calls
  - [ ] Reduce to ~60 lines
- [ ] Write tests
  - [ ] `dataFetchOrchestrator.test.js` (8 tests)
  - [ ] `dateRangeCalculator.test.js` (6 tests)
  - [ ] `payloadBuilder.test.js` (5 tests)

**Expected Outcome:**
- node_helper.js: -400 lines
- Fetch time: 5s → 2s (2.7x faster)
- Testable components

**Estimated Effort:** 6 hours

---

### 🔴 K2: Unify Async Error Handling

**Problem:** Inconsistent error propagation across codebase (see patterns below)

**Current Issues:**
```javascript
// Pattern 1: Error swallowed (bad)
try {
  timetable = await this._getTimetableViaRest(...);
} catch (error) {
  logger(`Failed: ${error.message}`);
  // timetable remains undefined - silent failure!
}

// Pattern 2: Error propagated (good)
try {
  token = await getBearerToken(...);
} catch (error) {
  logger(`Failed: ${error.message}`);
  throw error; // Correct
}

// Pattern 3: Error partially handled (inconsistent)
try {
  renderRow(...);
} catch (error) {
  logger(`Error: ${error}`);
  // Function continues, no return value check
}
```

**Tasks:**
- [ ] Create `lib/asyncErrorHandler.js`
  - [ ] Implement `tryOrNull()` - non-critical operations
  - [ ] Implement `tryOrDefault()` - with fallback value
  - [ ] Implement `tryOrThrow()` - critical operations
  - [ ] Add comprehensive JSDoc
- [ ] Refactor `node_helper.js`
  - [ ] Replace try-catch blocks in `fetchData()`
  - [ ] Update `_getTimetableViaRest()` calls
  - [ ] Update `_getExamsViaRest()` calls
  - [ ] Update `_getHomeworkViaRest()` calls
- [ ] Refactor `lib/authService.js`
  - [ ] Update `getAuth()` method
  - [ ] Update `getAuthFromQRCode()` method
- [ ] Refactor `lib/webuntisApiService.js`
  - [ ] Update `callWebUntisAPI()` error handling
- [ ] Write tests
  - [ ] `asyncErrorHandler.test.js` (6 tests)
  - [ ] Integration tests for error scenarios

**Expected Outcome:**
- Consistent error behavior across codebase
- -40% try-catch boilerplate
- Clear intention (tryOrNull vs tryOrThrow)
- No silent failures

**Estimated Effort:** 3 hours

---

### 🔴 K3: Widget Base Class for Shared Rendering Logic

**Problem:** ~400 lines of duplicated code across 6 widgets

**Current Duplication:**
```javascript
// Repeated in lessons.js, exams.js, homework.js, absences.js:
const mode = studentConfig?.mode ?? 'compact';
const studentCell = mode === 'verbose' ? '' : studentCellTitle;
if (mode === 'verbose') addTableHeader(table, studentCellTitle);

const nextDays = util.getWidgetConfig(studentConfig, 'WIDGET', 'nextDays');
const pastDays = util.getWidgetConfig(studentConfig, 'WIDGET', 'pastDays');
const dateFormat = util.getWidgetConfig(studentConfig, 'WIDGET', 'dateFormat');
// ... etc
```

**Tasks:**
- [ ] Create `widgets/widgetBase.js`
  - [ ] Implement `WidgetRendererBase` class
  - [ ] Add config getters (nextDays, pastDays, dateFormat)
  - [ ] Add `prepareTableHeader()` method
  - [ ] Add template method `render()`
  - [ ] Add abstract `renderRows()` method
- [ ] Refactor `widgets/lessons.js`
  - [ ] Extend `WidgetRendererBase`
  - [ ] Implement `renderRows()` with widget-specific logic only
  - [ ] Remove duplicated boilerplate
- [ ] Refactor `widgets/exams.js`
  - [ ] Extend `WidgetRendererBase`
  - [ ] Implement `renderRows()`
- [ ] Refactor `widgets/homework.js`
  - [ ] Extend `WidgetRendererBase`
  - [ ] Implement `renderRows()`
- [ ] Refactor `widgets/absences.js`
  - [ ] Extend `WidgetRendererBase`
  - [ ] Implement `renderRows()`
- [ ] Refactor `widgets/messagesofday.js`
  - [ ] Extend `WidgetRendererBase`
  - [ ] Implement `renderRows()`
- [ ] Update `MMM-Webuntis.js`
  - [ ] Use new renderer classes
  - [ ] Update `_renderWidgetTableRows()` if needed
- [ ] Write tests
  - [ ] `widgetRendererBase.test.js` (8 tests)
  - [ ] Widget-specific tests (5 tests each)

**Expected Outcome:**
- -150 lines across all widgets (-22% reduction)
- Consistent widget behavior
- Easier to add new widgets
- Better testability

**Estimated Effort:** 12 hours

---

## Phase 2: Quality Improvements (Week 3-4)

**Estimated Effort:** 27 hours

### 🟡 H1: Add JSDoc for All Public Functions

**Problem:** 60% of functions lack documentation

**Current State:**
```javascript
// lib/authService.js - No JSDoc
async getAuth({ school, username, password, server, options = {} }) {
  // Implementation...
}
```

**Target:**
```javascript
/**
 * Authenticate with WebUntis and retrieve bearer token + cookies
 *
 * @param {Object} params - Authentication parameters
 * @param {string} params.school - School identifier (e.g., "demo-school")
 * @param {string} params.username - WebUntis username
 * @param {string} params.password - WebUntis password
 * @param {string} [params.server='webuntis.com'] - Server hostname
 * @param {Object} [params.options={}] - Additional options
 * @param {string} [params.options.cacheKey] - Cache key for token reuse
 * @returns {Promise<AuthResult>} Authentication result with token, cookies, tenantId
 * @throws {Error} When authentication fails or credentials are invalid
 *
 * @example
 * const auth = await authService.getAuth({
 *   school: 'demo',
 *   username: 'parent',
 *   password: 'secret'
 * });
 * console.log(auth.token); // "eyJhbGc..."
 */
async getAuth({ school, username, password, server, options = {} }) {
  // Implementation...
}
```

**Tasks:**
- [ ] `lib/authService.js` (all public methods)
  - [ ] `getAuth()`
  - [ ] `getAuthFromQRCode()`
  - [ ] `buildRestTargets()`
  - [ ] `deriveStudentsFromAppData()`
- [ ] `lib/webuntisApiService.js`
  - [ ] `callWebUntisAPI()`
  - [ ] `getTimetable()`
  - [ ] `getExams()`
  - [ ] `getHomework()`
  - [ ] `getAbsences()`
  - [ ] `getMessagesOfDay()`
- [ ] `lib/dataTransformer.js`
  - [ ] `mapRestStatusToLegacyCode()`
  - [ ] `sanitizeHtmlText()`
  - [ ] `normalizeDateToInteger()`
  - [ ] `normalizeTimeToMinutes()`
- [ ] `lib/cacheManager.js`
  - [ ] `set()`
  - [ ] `get()`
  - [ ] `has()`
  - [ ] `clear()`
- [ ] `lib/errorHandler.js`
  - [ ] `formatError()`
  - [ ] `convertRestErrorToWarning()`
  - [ ] `checkEmptyDataWarning()`
- [ ] `lib/configValidator.js`
  - [ ] `validateConfig()`
  - [ ] `applyLegacyMappings()`
  - [ ] `generateDeprecationWarnings()`
- [ ] `lib/widgetConfigValidator.js`
  - [ ] `validateStudentCredentials()`
  - [ ] `validateStudentWidgets()`
  - [ ] `validateAllWidgets()`
- [ ] `widgets/widgetBase.js` (new)
  - [ ] All methods

**Expected Outcome:**
- JSDoc coverage: 40% → 90%
- Better IDE IntelliSense
- Auto-generated documentation possible
- Improved developer experience

**Estimated Effort:** 8 hours

---

### 🟡 H2: Unit Tests (Target: 50% Coverage)

**Problem:** No unit tests, only linting

**Setup:**
- [ ] Install Jest
  ```bash
  npm install --save-dev jest @types/jest
  ```
- [ ] Update `package.json`
  ```json
  {
    "scripts": {
      "test": "node --run lint && jest",
      "test:unit": "jest",
      "test:coverage": "jest --coverage",
      "test:watch": "jest --watch"
    }
  }
  ```
- [ ] Create `jest.config.js`

**Test Files to Create:**

**Pure Functions (High Priority):**
- [ ] `tests/lib/dataTransformer.test.js`
  - [ ] `sanitizeHtmlText()` - 5 tests
  - [ ] `normalizeDateToInteger()` - 4 tests
  - [ ] `normalizeTimeToMinutes()` - 4 tests
  - [ ] `mapRestStatusToLegacyCode()` - 3 tests
- [ ] `tests/lib/dateTimeUtils.test.js`
  - [ ] `formatDateYYYYMMDD()` - 3 tests
  - [ ] `formatDateISO()` - 3 tests
  - [ ] `addDays()` - 2 tests

**New Modules (From Phase 1):**
- [ ] `tests/lib/asyncErrorHandler.test.js`
  - [ ] `tryOrNull()` - 2 tests
  - [ ] `tryOrDefault()` - 2 tests
  - [ ] `tryOrThrow()` - 2 tests
- [ ] `tests/lib/payloadBuilder.test.js`
  - [ ] `addWarning()` - 2 tests
  - [ ] `build()` - 3 tests
- [ ] `tests/lib/dateRangeCalculator.test.js`
  - [ ] `calculateFetchRange()` - 4 tests
  - [ ] Widget-specific overrides - 2 tests

**Widget Tests:**
- [ ] `tests/widgets/widgetRendererBase.test.js`
  - [ ] `getConfig()` - 2 tests
  - [ ] `prepareTableHeader()` - 3 tests
  - [ ] `render()` template method - 3 tests

**Validation Tests:**
- [ ] `tests/lib/configValidator.test.js`
  - [ ] `applyLegacyMappings()` - 4 tests
  - [ ] `generateDeprecationWarnings()` - 2 tests
- [ ] `tests/lib/widgetConfigValidator.test.js`
  - [ ] `validateStudentCredentials()` - 3 tests
  - [ ] `validateStudentWidgets()` - 4 tests

**Target Metrics:**
- [ ] 50%+ overall coverage
- [ ] 80%+ coverage for pure functions
- [ ] All new code (Phase 1) at 90%+ coverage

**Expected Outcome:**
- Confidence in refactoring
- Regression prevention
- Better code quality
- Automated CI/CD possible

**Estimated Effort:** 16 hours

---

### 🟡 H3: Optimize Payload Size

**Problem:** Frontend only uses ~60% of transmitted data

**Current Payload Analysis:**
```javascript
// lesson schema (14 fields sent)
lesson: [
  'id', 'date', 'startTime', 'endTime',
  'su', 'te', 'ro', 'code', 'substText', 'lstext',
  'activityType', 'lessonText', 'status', 'statusDetail'
]

// Frontend actually uses (lessons.js):
// ✅ date, startTime, su[0].name, code, substText
// ❌ NOT USED: id, te, ro, activityType, lessonText, statusDetail
```

**Tasks:**
- [ ] Create minimal schemas in `lib/payloadCompactor.js`
  - [ ] `lesson.minimal` - 6 fields (vs 14 current)
  - [ ] `exam.minimal` - 7 fields (vs 12 current)
  - [ ] `homework.minimal` - 6 fields (vs 10 current)
  - [ ] `absence.minimal` - 5 fields (vs 8 current)
- [ ] Update `node_helper.js::fetchData()`
  - [ ] Add mode selection: `const mode = config.dumpBackendPayloads ? 'full' : 'minimal'`
  - [ ] Pass mode to `compactArray()`
  - [ ] Measure payload sizes (before/after)
- [ ] Update `lib/payloadCompactor.js`
  - [ ] Support schema mode parameter
  - [ ] Add size measurement logging (debug mode)
- [ ] Test with all widgets
  - [ ] Grid widget with minimal payloads
  - [ ] Lessons widget with minimal payloads
  - [ ] Exams widget with minimal payloads
  - [ ] Homework widget with minimal payloads

**Expected Outcome:**
- Payload size: ~150KB → ~105KB (-30%)
- Faster socket transmission
- Less RAM usage in frontend
- Better performance on low-end devices (Raspberry Pi)

**Estimated Effort:** 3 hours

---

## Phase 3: UX Improvements (Week 5-6)

**Estimated Effort:** 11 hours

### 🟢 M1: Grid Widget Performance Optimization

**Problem:** `updateNowLinesAll()` runs every minute even when grid is off-screen

**Impact:**
- Unnecessary CPU usage
- Poor performance on Raspberry Pi
- Battery drain on mobile devices

**Tasks:**
- [ ] Add viewport detection to `widgets/grid.js`
  - [ ] Implement `isElementInViewport()` helper
  - [ ] Update `updateNowLinesAll()` to check visibility
  - [ ] Skip updates when off-screen
- [ ] Add performance monitoring
  - [ ] Log update frequency (debug mode)
  - [ ] Measure CPU impact before/after
- [ ] Test scenarios
  - [ ] Grid visible → updates run
  - [ ] Grid hidden → updates skipped
  - [ ] Grid scrolled into view → updates resume

**Expected Outcome:**
- CPU usage: ~8% → ~5% when off-screen
- Better battery life on mobile
- Smoother operation on Raspberry Pi

**Estimated Effort:** 2 hours

---

### 🟢 M2: Early Config Validation

**Problem:** Invalid configs detected only at `FETCH_DATA`, not at module start

**Current Behavior:**
1. User starts MagicMirror with invalid config
2. Module loads, shows empty space
3. `FETCH_DATA` triggered → error logged to backend
4. User sees nothing, no feedback

**Target Behavior:**
1. Module loads
2. Config validated immediately in `start()`
3. Errors displayed in UI with helpful messages
4. User fixes config and restarts

**Tasks:**
- [ ] Add early validation to `MMM-Webuntis.js`
  - [ ] Update `start()` method
  - [ ] Call `_validateConfig(this.config)`
  - [ ] Store errors in `this.configErrors`
- [ ] Update `getDom()` method
  - [ ] Check for `this.configErrors`
  - [ ] Render error UI if present
  - [ ] Show helpful fix instructions
- [ ] Improve error UI styling
  - [ ] Add `.mmm-webuntis-config-error` CSS class
  - [ ] Make errors prominent (red border, warning icon)
  - [ ] Include fix suggestions
- [ ] Test with common invalid configs
  - [ ] Missing `students[]`
  - [ ] Student without credentials
  - [ ] Invalid `displayMode` values
  - [ ] Invalid `logLevel` values

**Expected Outcome:**
- Immediate user feedback on config errors
- Better UX (no silent failures)
- Fewer support requests

**Estimated Effort:** 4 hours

---

### 🟢 M3: CLI Config Generator

**Problem:** CLI only shows status, doesn't help create configs

**Current CLI:**
- Read-only (shows current data)
- No config generation
- Users must manually edit config.js

**Target CLI:**
- Interactive config generation
- Guided prompts (QR code, credentials, widgets)
- JSON output with proper formatting
- Optional file write

**Tasks:**
- [ ] Add `generateConfig()` function to `cli/node_helper_wrapper.js`
  - [ ] Use `inquirer` for interactive prompts
  - [ ] Prompt for QR code URL
  - [ ] Prompt for credentials (if no QR)
  - [ ] Prompt for widget selection (checkbox)
  - [ ] Prompt for display options (nextDays, pastDays)
- [ ] Implement JSON generation
  - [ ] Build config object from answers
  - [ ] Format with proper indentation
  - [ ] Validate before output
- [ ] Add file write option
  - [ ] Prompt for confirmation
  - [ ] Write to `config/config.js`
  - [ ] Show success message
- [ ] Update CLI menu
  - [ ] Add "Generate Config" option
  - [ ] Update help text
- [ ] Update documentation
  - [ ] Add CLI section to README.md
  - [ ] Update CLI_COMPREHENSIVE_GUIDE.md
  - [ ] Add examples

**Expected Outcome:**
- Easier onboarding for new users
- Fewer configuration errors
- Better user experience

**Estimated Effort:** 5 hours

---

## Phase 4: Low Priority (Optional)

### 🔵 L1: TypeScript Migration

**Benefits:**
- Type safety across codebase
- Better IDE support
- Refactoring confidence
- Fewer runtime errors

**Tasks:**
- [ ] Setup TypeScript
  - [ ] Install `typescript`, `@types/node`
  - [ ] Create `tsconfig.json`
  - [ ] Configure build scripts
- [ ] Migrate lib/ modules first
  - [ ] `lib/dataTransformer.ts`
  - [ ] `lib/dateTimeUtils.ts`
  - [ ] `lib/cacheManager.ts`
  - [ ] Define interfaces for all services
- [ ] Migrate node_helper.js
- [ ] Migrate widgets/
- [ ] Update build process

**Estimated Effort:** 30-40 hours

**Recommendation:** Only if long-term maintenance planned

---

### 🔵 L2: Persistent Caching for Offline Mode

**Idea:** Cache last-known-good data to filesystem/Redis for offline resilience

**Benefits:**
- Module works during API outages
- Shows last data instead of empty screen
- Better user experience

**Tasks:**
- [ ] Extend `lib/cacheManager.js`
  - [ ] Add filesystem persistence
  - [ ] Add Redis support (optional)
  - [ ] TTL-based expiration
- [ ] Update `node_helper.js`
  - [ ] Try cache on fetch failure
  - [ ] Show "cached data" indicator
- [ ] Add config option
  - [ ] `enableOfflineMode: true/false`
  - [ ] `cacheBackend: 'filesystem'|'redis'`

**Estimated Effort:** 10-15 hours

**Recommendation:** Nice-to-have for production deployments

---

## Implementation Checklist

### Pre-Refactoring Preparation

- [ ] **Create backup**
  ```bash
  git tag v0.4.1-pre-refactor
  git push origin v0.4.1-pre-refactor
  ```
- [ ] **Create refactoring branch**
  ```bash
  git switch -b refactor/critical-improvements
  ```
- [ ] **Install testing dependencies**
  ```bash
  npm install --save-dev jest @types/jest
  ```
- [ ] **Code freeze** - No new features during refactoring
- [ ] **Document current metrics**
  - [ ] Measure fetch times (baseline)
  - [ ] Measure payload sizes (baseline)
  - [ ] Note current LOC count

### Phase 1 Checklist (Critical)

**K1: Split node_helper.js**
- [ ] Create `lib/dataFetchOrchestrator.js`
- [ ] Create `lib/dateRangeCalculator.js`
- [ ] Create `lib/payloadBuilder.js`
- [ ] Refactor `node_helper.js::fetchData()`
- [ ] Implement parallel fetching
- [ ] Write tests (19 total)
- [ ] Integration test (end-to-end)
- [ ] Performance benchmark (before/after)

**K2: Async Error Handling**
- [ ] Create `lib/asyncErrorHandler.js`
- [ ] Refactor node_helper.js
- [ ] Refactor authService.js
- [ ] Refactor webuntisApiService.js
- [ ] Write tests (6 total)
- [ ] Verify no silent failures

**K3: Widget Base Class**
- [ ] Create `widgets/widgetBase.js`
- [ ] Refactor lessons.js
- [ ] Refactor exams.js
- [ ] Refactor homework.js
- [ ] Refactor absences.js
- [ ] Refactor messagesofday.js
- [ ] Update MMM-Webuntis.js
- [ ] Write tests (8 base + 25 widget-specific)

**Post-Phase 1 Testing:**
- [ ] All widgets render correctly
- [ ] Fetch times < 2 seconds
- [ ] No regressions vs v0.4.1
- [ ] `node --run lint` passes
- [ ] Manual testing (all widgets, all configs)

### Phase 2 Checklist (Quality)

**H1: JSDoc**
- [ ] lib/authService.js
- [ ] lib/webuntisApiService.js
- [ ] lib/dataTransformer.js
- [ ] lib/cacheManager.js
- [ ] lib/errorHandler.js
- [ ] lib/configValidator.js
- [ ] lib/widgetConfigValidator.js
- [ ] widgets/widgetBase.js

**H2: Unit Tests**
- [ ] Setup Jest config
- [ ] dataTransformer.test.js (16 tests)
- [ ] dateTimeUtils.test.js (8 tests)
- [ ] asyncErrorHandler.test.js (6 tests)
- [ ] payloadBuilder.test.js (5 tests)
- [ ] dateRangeCalculator.test.js (6 tests)
- [ ] widgetRendererBase.test.js (8 tests)
- [ ] configValidator.test.js (6 tests)
- [ ] widgetConfigValidator.test.js (7 tests)
- [ ] Achieve 50%+ coverage

**H3: Payload Optimization**
- [ ] Define minimal schemas
- [ ] Update payloadCompactor.js
- [ ] Update node_helper.js
- [ ] Measure size reduction
- [ ] Test all widgets

**Post-Phase 2 Testing:**
- [ ] `npm test` passes (all green)
- [ ] Coverage >= 50%
- [ ] Payload size -30% vs v0.4.1

### Phase 3 Checklist (UX)

**M1: Grid Performance**
- [ ] Implement `isElementInViewport()`
- [ ] Update `updateNowLinesAll()`
- [ ] Measure CPU impact
- [ ] Test on/off screen scenarios

**M2: Config Validation**
- [ ] Update `start()` method
- [ ] Update `getDom()` error UI
- [ ] Add CSS styling
- [ ] Test invalid configs

**M3: CLI Generator**
- [ ] Implement `generateConfig()`
- [ ] Add inquirer prompts
- [ ] Add file write option
- [ ] Update documentation

**Post-Phase 3 Testing:**
- [ ] CLI generates valid configs
- [ ] Config errors shown immediately
- [ ] Grid performance improved

### Documentation & Release

**Update Documentation:**
- [ ] README.md (new features)
- [ ] CHANGELOG.md (v0.5.0 notes)
- [ ] ARCHITECTURE.md (new modules)
- [ ] CONFIG_BY_WIDGET.md (deprecated keys)
- [ ] CONTRIBUTING.md (testing guide)

**Release Preparation:**
- [ ] `package.json` version bump (0.5.0)
- [ ] `node --run lint --fix`
- [ ] `npm test` (all green)
- [ ] Manual testing (all widgets, all configs)
- [ ] Performance benchmark vs 0.4.1
- [ ] Create migration guide
- [ ] Git merge to main
- [ ] Git tag v0.5.0
- [ ] GitHub Release with notes

---

## Success Metrics

### Code Quality Targets

- **LOC Reduction:**
  - node_helper.js: 1,714 → ~1,100 lines (-35%)
  - widgets/: ~1,800 → ~1,400 lines (-22%)
  - Total: -600 lines (-11%)

- **Code Duplication:**
  - Current: ~400 lines duplicated
  - Target: ~50 lines (-88%)

- **Test Coverage:**
  - Current: 0%
  - Target: 50%+ overall, 80%+ for pure functions

- **Documentation:**
  - JSDoc coverage: 40% → 90%
  - All public APIs documented

### Performance Targets

- **Fetch Speed:**
  - Current: ~5 seconds (sequential)
  - Target: ~2 seconds (parallel) - **2.7x faster**

- **Payload Size:**
  - Current: ~150KB per student
  - Target: ~105KB per student (-30%)

- **Grid CPU Usage:**
  - Current: ~8% when off-screen
  - Target: ~5% when off-screen (-37%)

### Developer Experience

- **Error Visibility:**
  - Current: Delayed (at FETCH_DATA)
  - Target: Immediate (at module start)

- **Config Generation:**
  - Current: Manual editing only
  - Target: Interactive CLI wizard

- **Maintainability:**
  - Largest function: 461 → ~80 lines
  - Clear separation of concerns
  - Testable components

---

## Risk Assessment

### High Risk Items

1. **Widget Base Class Refactoring (K3)**
   - **Risk:** Breaking existing widget rendering
   - **Mitigation:** Comprehensive testing, gradual migration (one widget at a time)
   - **Rollback:** Keep old widget code in comments until tested

2. **Parallel Fetching (K1)**
   - **Risk:** Race conditions, auth token conflicts
   - **Mitigation:** Thorough testing with multiple students, rate limiting
   - **Rollback:** Keep sequential option as fallback

### Medium Risk Items

1. **Error Handler Refactoring (K2)**
   - **Risk:** Changed error behavior might hide issues
   - **Mitigation:** Explicit policy (tryOrNull vs tryOrThrow), good logging
   - **Rollback:** Original try-catch patterns documented

2. **Payload Optimization (H3)**
   - **Risk:** Missing fields breaks widgets
   - **Mitigation:** Careful schema analysis, extensive testing
   - **Rollback:** Keep 'full' mode available

### Low Risk Items

- JSDoc additions (H1) - Documentation only
- Unit tests (H2) - Additive, no code changes
- CLI generator (M3) - New feature, doesn't affect existing code

---

## Questions & Decisions

### Open Questions

1. **TypeScript Migration (L1):**
   - Decision needed: Full migration or just type definitions?
   - Timeline: Now or future release?

2. **Offline Caching (L2):**
   - Decision needed: Include in v0.5.0 or defer to v0.6.0?
   - Storage backend: Filesystem or Redis?

3. **Deprecation Policy:**
   - When to remove legacy config keys?
   - How many versions to maintain compatibility?

### Decisions Made

- ✅ **Parallel Fetching:** Implement in Phase 1 (performance critical)
- ✅ **Widget Base Class:** Worth the effort (eliminates major duplication)
- ✅ **Test Coverage Target:** 50% is realistic for v0.5.0
- ✅ **Payload Optimization:** 'minimal' mode default, 'full' for debug

---

## Notes

- Keep backward compatibility with v0.4.x configs
- Maintain legacy key support (with warnings) for at least 2 releases
- All breaking changes must be documented in CHANGELOG.md
- Performance benchmarks should be reproducible (document test setup)
- Consider creating a v0.4.x maintenance branch for critical fixes

---

**Next Steps:**

1. Review this roadmap with team/maintainers
2. Create GitHub issues for each major task
3. Set up project board for tracking
4. Begin Phase 1 implementation
5. Regular progress updates (weekly)

**Contact:** For questions or clarifications, open an issue in the repository.
