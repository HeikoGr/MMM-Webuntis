# Code Quality Todos

Source: Code review from 2026-03-09
Status: open

## High Priority

- [x] Centralize magic numbers for auth timing
  - Files: lib/webuntis/authService.js
  - Task: Define TOKEN_TTL_MS and TOKEN_BUFFER_MS as constants and replace all direct values (300000, 5*60*1000, 14*60*1000).
  - Acceptance: No direct timing literals remain in auth flows.
  - Done: 2026-03-09 - Constants TOKEN_TTL_MS (14 minutes) and TOKEN_BUFFER_MS (5 minutes) introduced

- [x] API-Timeouts zentralisieren
  - Files: lib/webuntis/webuntisApiService.js, lib/webuntis/authService.js, lib/webuntis/httpClient.js, lib/webuntis/restClient.js
  - Task: Introduce a shared API_TIMEOUT_MS constant and replace all 15000 values.
  - Acceptance: Exactly one central timeout definition.
  - Done: 2026-03-09 - API_TIMEOUT_MS (15 seconds) constant introduced in all 4 files

- [x] Deduplicate widget initialization (DRY)
  - Files: widgets/lessons.js, widgets/exams.js, widgets/homework.js, widgets/absences.js, widgets/messagesofday.js, widgets/grid.js, widgets/util.js
  - Task: Introduce a shared helper for createWidgetContext/Header/Label.
  - Acceptance: Repeated initialization blocks in widgets removed.
  - Done: 2026-03-09 - initializeWidgetContextAndHeader() helper introduced in util.js and used in 5 widgets (exams, homework, absences, messagesofday, lessons; grid keeps special structure)

- [x] Extract duplicated debug dump logic in auth service
  - Files: lib/webuntis/authService.js
  - Task: Use a shared function for directory creation, file naming, and writeFileSync.
  - Acceptance: Dump logic exists in one place only.
  - Done: 2026-03-10 - Helper _writeDebugDump() introduced and both app/data dump paths moved to helper

## Medium Priority

- [x] Unify date formatting
  - Files: lib/webuntis/webuntisApiService.js, lib/webuntis/dataOrchestration.js, lib/webuntis/restClient.js
  - Task: Merge redundant date formatters (cleanly encapsulate YYYYMMDD and YYYY-MM-DD).
  - Acceptance: No duplicated date formatters with the same responsibility.
  - Done: 2026-03-10 - Central dateUtils.js introduced and formatter usage unified in the three files

- [x] Unify sort comparator in widgets
  - Files: widgets/absences.js, widgets/exams.js, optional other widgets
  - Task: Introduce a shared comparator helper in widgets/util.js.
  - Acceptance: Unified sorting logic in all list widgets.
  - Done: 2026-03-10 - compareByDateAndStartTime() introduced in util.js and used in absences/exams

- [x] Encapsulate HHMM time calculation as utility
  - Files: widgets/lessons.js, widgets/exams.js, widgets/util.js
  - Task: Use utility for nowHm calculation (e.g., currentTimeAsHHMM).
  - Acceptance: No getHours()*100 + getMinutes() in widgets.
  - Done: 2026-03-10 - currentTimeAsHHMM() introduced in util.js and used in lessons/exams

- [x] Move HTTP status text mapping out of callRestAPI
  - Files: lib/webuntis/restClient.js
  - Task: Define STATUS_TEXTS as a module constant instead of rebuilding per call.
  - Acceptance: No per-request reinitialization of the status mapping.
  - Done: 2026-03-10 - STATUS_TEXTS introduced at module level and getStatusText() extracted

## Low Priority

- [x] Remove commented/dead code
  - Files: lib/mmm-adapter/mmmPayloadMapper.js, widgets/exams.js
  - Task: Delete outdated, commented-out blocks.
  - Acceptance: No dead comment-code paths remain in these files.
  - Done: 2026-03-10 - Removed outdated comment block in exams and cleaned unnecessary eslint-disable comment paths in MMM adapter

- [x] Unify logger signature
  - Files: lib/webuntis/errorUtils.js, optionally widgets/util.js
  - Task: Define a unified logger API and reduce fallback paths.
  - Acceptance: No try/catch fallbacks solely due to signature differences.
  - Done: 2026-03-10 - Logger signature in errorUtils unified via arity normalization (3/2/1 args), signature fallback try/catch removed

- [x] Consolidate naming for date variables
  - Files: multiple (especially widgets/grid.js, widgets/lessons.js, lib/webuntis/*)
  - Task: Define a convention (e.g., ymd for integer, date for Date object).
  - Acceptance: New/updated code follows the convention.
  - Done: 2026-03-10 - Date/ymd naming consolidated in lessons/grid/dataOrchestration (entryYmdStr/dayYmdStr/entryDate/dateValue)

## Optional Larger Refactorings

- [x] Split orchestrateFetch into smaller units (SRP)
  - File: lib/webuntis/dataFetchOrchestrator.js
  - Idea: validateFetchParams, buildAuthContext, fetchTimetablePhase, fetchParallelPhase, mergeResults.
  - Done: 2026-03-10 - Split into phase helpers (validateFetchParams, buildOrchestratorContext, buildTargetHelpers, runAuthCanaryIfNeeded, fetchTimetablePhase, buildParallelFetchPlans)

- [x] Modularize buildGotDataPayload
  - File: lib/mmm-adapter/mmmPayloadMapper.js
  - Idea: Separate redaction, compaction, warning assembly, and debug dump into dedicated functions.
  - Done: 2026-03-10 - Split into helpers (Compaction, Base payload, Meta enrichment, Warning assembly, Redaction/Ordering, Debug dump)
