<instructions>

# MMM-Webuntis: AI Agent Coding Guidelines

**Purpose**: Guide AI agents toward productive, high-quality contributions.
**Status**: Production module (~18,900 LOC, 14 backend/core services, 6 first-party plugins).
**Last Updated**: 2026-09-18

## Architecture Overview (Critical to Understand)

**Frontend → Backend Socket Flow**:
```
MMM-Webuntis.js (start) → SESSION_STATE, then CONFIGURE (config once; no REFRESH, no sessionId)
  → node_helper.js → mmm-shared instance hub (one lifecycle per identifier, backend owns the cadence)
    → prepareConfig(): normalizeModuleConfig() + validateNormalizedConfig()
        invalid → CONFIG_INVALID; other credentials than the running instance → CONFIG_REJECTED
    → EVENT CONFIGURED (warnings + plugin registry) to FE, before the first fetch
    → fetchInstance() on schedule (first one immediately, then updateInterval, backoff after failures)
      → studentDiscovery.ensureStudentsFromAppData() (parent account, may log in; retried each fetch)
      → per credential group: orchestrateFetch() → authService.getAuth() → webuntisApiService.callWebUntisAPI()
      → returns { students: [payload per student], allFailed, warnings }
    → EVENT DATA to FE (also FETCH_FAILED); a new socket connection gets INIT_REQUIRED
  → MMM-Webuntis.js:socketNotificationReceived() → _handleData() → one render per DATA
```

**Critical Services** (ordered by importance):
1. **authService.js** - Auth + token caching until the JWT `exp` (14min fallback) with a 60s buffer (QR code, credentials, parent accounts); ONE instance process-wide, cache keyed by credential fingerprint (`node_helper._getCredentialKey()`), so every module instance using the same account shares a single WebUntis session
2. **webuntisApiService.js** - REST endpoint wrappers (getTimetable, getExams, getHomework, etc.)
3. **dataFetchOrchestrator.js** - Timetable-first + parallel fetching (prevents silent token failures)
4. **apiStatusTracker.js** - API status tracking per instance (skips permanent errors 403/404/410, circuit breaker); `node_helper.js` is only the socket adapter
5. **dataOrchestration.js** - Data normalization (timetable→lessons, dates→YYYYMMDD integers)

**REST API Strategy**: Migrate away from deprecated JSON-RPC. Use REST for all data; JSON-RPC only for auth/OTP.

## Key Patterns & Conventions

### Authentication Pattern
- **Always** use `authService.getAuth()` - never call httpClient or fetch directly
- `getAuth()` caches tokens until the JWT `exp` (14 minutes when it has none) with a **60-second buffer**; a fetch takes seconds, and silent empty answers of an expired token are caught by timetable-first
- A re-login logs the session it replaces out in the background (`_retireReplacedSession`), so sessions do not pile up on the server
- QR code auth: extract `person_id` from JWT token via `extractPersonIdFromToken()`
- Parent account: fetches app/data to auto-discover student IDs
- On token expiry: `onAuthError` callback invalidates cache automatically
- A failed login answers all requests for the same account with its error for 30 s (`LOGIN_FAILURE_COOLDOWN_MS`); several endpoints of one fetch otherwise each start a login. Auth failures (`401`) do not count toward the `apiStatusTracker` circuit breaker
- `fetchClient` never follows redirects: `302 → index.do`, a `200 {"state":"LOGIN_ERROR"}` body or HTML are thrown as `SESSION_EXPIRED` (auth error) — never treat them as empty data
- Rejected logins arrive as HTTP 200 (JSON-RPC error body); use `errorHandler.isAuthError()` before looking at numeric statuses, and never record such an error as status 200
- Race condition protection: `_forceReauth` Set is cleared after use, `_pendingAuth` Map coordinates parallel requests

### REST API Calls
- All data fetching via `webuntisApiService.callWebUntisAPI()` - no direct REST calls
- Generic signature: `{ dataType, getAuth, server, params, transform, logger }`
- Endpoint configs in `webuntisApiService.js#ENDPOINTS` - update if adding new data types
- Required headers: `Authorization: Bearer {token}`, `Tenant-Id: {tenantId}`, `X-Webuntis-Api-School-Year-Id: {schoolYearId}`
- Error responses are mapped in `restClient.mapRestError()` (and converted for UI warnings via `errorHandler.convertRestErrorToWarning()`)
- **Return value**: `{ data, status }` object (status code tracked per session)

### API Status Tracking & Fetch Strategy
- **Timetable-first strategy**: Timetable API reliably returns 401 on expired tokens; other APIs return 200 OK with empty arrays (silent failures)
- Fetch order: Timetable first (sequential, token validation), then 4 remaining APIs in parallel
- **Status tracking**: `lib/apiStatusTracker.js` tracks HTTP status + `lastSuccessAt` per endpoint/session; the payload reports it as `state.collections.<name>.status` (`ok`/`unavailable`/`disabled`) and the frontend keeps previous data on `unavailable`
- **Permanent errors** (403, 404, 410): API calls skipped on next fetch (no retry)
- **Temporary errors** (5xx, 429, 401): Retried on next fetch
- A timetable body without `days[]` is an `INVALID_RESPONSE` error, not an empty timetable (WebUntis always returns one `days[]` entry per requested day with a `status` of `REGULAR`, `NO_DATA` or `NOT_ALLOWED`)
- Status tracking prevents wasted API calls to endpoints with permanent permission errors

### Data Transformation

**Core Principle**: Deterministic transformations based on data source. No compatibility layers needed since frontend and backend always update synchronously.

**No Legacy Compatibility Code**:
- Do **not** add compatibility wrappers, alias exports, or fallback naming layers.
- Use canonical function and field names only.
- Frontend and backend are deployed synchronously, so compatibility shims are unnecessary and should be removed instead of extended.

- Normalization/compaction and MMM payload mapping happen in `webuntisApiService.js` + `mmm-adapter/mmmPayloadMapper.js`
- Dates MUST be normalized to YYYYMMDD integers (e.g., `20260114`) via `normalizeDateToInteger()`
- HTML sanitization in `mmm-adapter/mmmPayloadMapper.js#sanitizeHtml()` - whitelist: b, strong, i, em, u, br, p
- Never send raw API objects to frontend - run through `compactArray()` with schema

**Time Transformation** (simple, no validation layer needed):
- REST API sends HHMM integers (e.g., 1350 = 13:50) → pass through directly
- Timegrid sends HH:MM strings (e.g., "13:50") → parse to HHMM via `webuntis/dataOrchestration.js#parseHHMMStringToInteger(v)`
- Frontend receives HHMM integers; widgets format via `formatDisplayTime(hhmm)` → "13:50"

**Important**: Data format is always deterministic - always know and specify the source format. No guessing.

### ⚠️ Known Pitfall: extractDayLessons() — Whitelist Trap

`plugins/grid/frontend.js#extractDayLessons()` maps raw payload lesson objects into the internal grid lesson shape. It uses `...el` (spread) as a base, then overrides specific keys. **If you add a new field to `schemas.lesson` in `mmm-adapter/mmmPayloadMapper.js`, it is automatically forwarded** — no change to `extractDayLessons` needed.

This was NOT always the case. Previously it whitelisted explicit field names, causing any new field (e.g. `changedFields`, `teOld`) to be silently dropped in the frontend. If a new field from the payload is missing in the widget despite appearing correctly in debug dumps, check whether `extractDayLessons` needs updating.

**Full data flow for lesson fields:**
```
webuntisApiService.js#mapPositionsToFields()  – adds field to lesson object
  → mmm-adapter/mmmPayloadMapper.js#schemas.lesson – declares field for compaction
    → mmm-adapter/mmmPayloadMapper.js#compactArray() – compacts lessons
      → DATA payload (students[])             – field present in data.lessons[]
        → plugins/grid/frontend.js#extractDayLessons() – spread: auto-forwarded ✅
            → buildLessonContent()                 – field available on `lesson`
```

The whole frontend builds its markup as DOM nodes (`dom.el()` and friends in `lib/frontendShared.js`;
grid: `buildLessonContent()`, `timeUnitLabel()`), so fetched data only ever becomes text. There is no
`innerHTML` and no `escapeHtml` any more; `tests/frontend-dom.test.js` keeps it that way. The only
parsed markup is `messagesofday.text` via `dom.richTextNodes()` (inert `DOMParser`, tag whitelist, no
attributes). See `docs/PLUGINS.md` → "Building markup".

### ⚠️ Known Pitfall: a config change that does not reach the plugin

Frontend plugins read their config from the backend's DATA payload (`context.config` →
`configByStudent`), not from the browser's `module.config`. The backend keeps the config of the
**first** client that sends CONFIGURE for an instance; a later, different one is only logged
(`[hub] client config differs, the running config keeps precedence`). After `pm2 restart`, old
browser tabs reconnect and resend the config they loaded before the edit, and may win. Reload or
close all tabs before restarting, and check `configByStudent[...]` in the browser rather than the
file. Playwright's `page.goto()` to the same URL with only another `#hash` does not reload the page.
A new plugin option needs no mapping: its default in the plugin's `getDefaultConfig()` is enough.
Details: `docs/PLUGINS.md` → "How a config value reaches a frontend plugin".

### Configuration
- 25 legacy config key mappings in `configValidator.js#applyLegacyMappings()` - don't break them
- Widget-specific validation in `widgetConfigValidator.js` - check before assuming config structure
- Always validate config schema before using - see `MMM-Webuntis.js#defaultConfig`

### Logging Pattern
```javascript
// Backend: use the logger function passed as parameter
logger('debug', null, `[feature] Message ${variable}`);  // null = no student context
logger('warn', 'StudentName', `Warning for student`);    // include student name for context
// In node_helper.js, code that knows its instance logs through this._loggerFor(identifier)
// (that instance's logLevel) and passes it on (e.g. fetchStudentData({ ..., mmLog })).
// this._mmLog is for the shared services and follows the widest instance logLevel.

// Frontend: use the instance logger. Everything goes through MagicMirror's Log (global
// logLevel); the instance's own logLevel can only narrow it
this._log('debug', '[feature]', data);
this._log('warn', '[feature] Warning:', error);
// Plugins: use `log` from `MMMWebuntisFrontendShared` (lib/frontendShared.js), not console
```

## File Organization (Updated: `lib/webuntis/` contains internal WebUntis API logic)

**Essential files** (most editing happens here):
- `node_helper.js` (~450 LOC) - wires the mmm-shared instance hub, `prepareConfig()`, `fetchInstance()` with the per-credential fetch loop, demo mode - nothing else; adapter logic lives in the `lib/` modules below
- `lib/mmm-shared/` - Git submodule shared by all of the author's modules (`createTransport`, `createLogger`, `createLifecycle`). Do not edit it here. `MMM-Webuntis.js` `_createLifecycle()` wires `createLifecycle` for suspend/resume, render gating, `SESSION_STATE` and the day-change tick (the fetch schedule lives in the backend hub, `updateInterval: 0` here); do not add own timers or visibility logic next to it
- `lib/moduleConfig.js` - Legacy mapping, canonical `plugins.<id>` map, validation, frontend plugin registry, fetch flags
- `lib/apiStatusTracker.js` - Per-instance endpoint status (`lastSuccessAt`), 24h permanent-error skip, circuit breaker
- `lib/authSession.js` - Credential fingerprint (`getCredentialKey`), auth session creation, parent auth
- `lib/studentDiscovery.js` - Parent-account student auto-discovery
- `lib/warningUtils.js` - Warning classification (`classifyWarningMetaFromError`), group collectors, payload merge
- `lib/webuntisClient.js` - Public WebUntis entry point for backend consumers
- `lib/webuntis/authService.js` - Auth, QR code, token caching (JWT `exp`, 60s buffer)
- `lib/webuntis/webuntisApiService.js` - Generic API caller for all 5 data types (returns { data, status })
- `lib/webuntis/restClient.js` - REST wrapper (headers, error handling, retry, returns HTTP status)
- `lib/webuntis/dataFetchOrchestrator.js` - Timetable-first + parallel fetch (prevents silent token failures)
- `lib/webuntis/dataOrchestration.js` - Data transformation + fetch range calculation (mapRestStatusToLegacyCode, normalizeDateToInteger, calculateFetchRanges)
- `lib/configValidator.js` - Config schema + 25 legacy key mappings
- `plugins/*/*.js` - first-party frontend/backend plugin implementations for all built-in widgets
- `lib/frontendShared.js` - Shared frontend utilities and DOM helpers used by the module and plugins
- `config/config.template.js` - Config schema with 90+ options (includes grid.fields for flexible display)
- `tests/unit.test.js` - `node:test`-based unit tests, run via `node --run test`

**Supporting modules** (rarely modified):
- `lib/webuntis/fetchClient.js` - HTTP fetch abstraction
- `lib/webuntis/httpClient.js` - JSON-RPC client (auth only)
- `lib/webuntis/cacheManager.js` - TTL cache
- `lib/webuntis/responseCache.js` - short-lived GET response cache shared by sessions of one account (credKey)
- `lib/mmm-adapter/mmmPayloadMapper.js` - MMM adapter: compaction schemas, payload mapping, and debug dumps
- `lib/mmm-adapter/lessonAdjustments.js` - Config-driven `excludeLessons` filter and `addLessons` (own lessons), applied to compacted lessons + validation warnings
- `lib/webuntis/errorHandler.js` - Error mapping + warnings
- `lib/webuntis/errorUtils.js` - Shared async/error helpers for internal API modules
- `lib/webuntis/cookieJar.js` - Session cookie management
- `lib/widgetConfigValidator.js` - Widget-specific config validation

Frontend date/time helpers (`formatHHMMTime`, `toMinutesSinceMidnight`, …) live in `lib/frontendShared.js`; there is no separate `dateTimeUtils.js`.

Boundary rule:
- Only `lib/webuntisClient.js` is a public WebUntis API entry point at the lib root.
- Everything under `lib/webuntis/` is internal implementation detail unless a change explicitly promotes it.
- `lib/webuntis/` must not import `lib/mmm-adapter/`; the public facade composes core bundles with the MMM adapter.

**Documentation** (especially important for understanding decisions):
- `docs/ARCHITECTURE.md` - Mermaid diagrams of data flows
- `docs/API_REFERENCE.md` - External APIs plus normalization rules (time, date, HTML sanitization)
- `docs/SERVER_REQUEST_FLOW.md` - Runtime request order, retries, skip rules, and statuses
- `docs/API_V3_MANIFEST.md` - Currently shipped frontend/backend payload contract
- `docs/PLUGINS.md` - Plugin runtime contract, manifest model, and host APIs

## Quality bar

- Follow the repository’s existing Biome configuration.
- Avoid broad refactors “for cleanliness”; do focused edits.
- After any code change: run `node --run lint` and fix any new Biome diagnostics before saving/closing the change.
- Align config/CLI changes with the matching templates and translations (`config.template.js`, `translations/*.json`, `custom.template.css` etc.) to avoid drift.
- Fix errors and warnings where possible. Don't suppress them unless absolutely necessary.
- Implement easy fixes even if they weren't your fault.
- Add comments for complex logic or non-obvious decisions.
- **When making code changes, review and update related documentation**:
  - Update Mermaid diagrams in `docs/ARCHITECTURE.md` if control flow or data flow changes
  - Update this file (`copilot-instructions.md`) if file organization, build commands, or conventions change
  - Update `docs/PLUGINS.md` if plugin host APIs or manifest fields change
  - Update `docs/CLI.md` if CLI options or workflow changes

### Git & Commits - IMPORTANT RESTRICTIONS

- **NEVER create commits independently without explicit order** - commits are user responsibility only
- **NEVER push changes to any branch without explicit order** - all changes must remain staged/uncommitted for user review
- **NEVER run `git commit` or `git push` without explicit order** at any point, even if changes look complete
- **Do NOT initialize git repositories without explicit order** or change git configuration
- Changes are ready when:
  1. Code is edited and saved
  2. Available checks pass (`node --run lint`, optional `node --run check`)
  3. Linting passes (`node --run lint` succeeds without errors)
  4. Changes are staged with `git add` if needed
  5. User is notified of completion and can review/commit manually
## How to build and test

- **Lint code**: `node --run lint` (or `node --run lint:fix` to auto-fix)
- **Unit tests**: `node --run test` (`node:test`-based tests in `tests/`)
- **Test configuration**: `node --run check` (interactive CLI tool, runs without errors)
- **Debug mode**: `node --run debug` (interactive CLI tool, same as check but with verbose output; useful for troubleshooting auth/API issues)
- **Low-level auth test**: `node --run test:auth:curl` (curl-based JSON-RPC test, bypasses module logic; useful for debugging credentials with special characters)

### Debugger: Node & Chrome

- The devcontainer's `entrypoint.sh` runs `exec pm2-runtime start /opt/magic_mirror/ecosystem.config.js`: `watch: false`, no inspector. The mirror does **not** restart on file changes; use `pm2 restart magicmirror` after backend changes. To attach a debugger, restart it with `pm2 restart magicmirror --node-args="--inspect=0.0.0.0:9229"` (a plain `pm2 restart magicmirror` turns the inspector off again).

- **Never `pm2 stop`, `pm2 delete` or `pm2 kill`:** `pm2-runtime` is PID 1 of the container, so stopping the app ends the whole devcontainer (and every background process in it). Only `pm2 restart magicmirror`. To keep the mirror quiet for a measurement, freeze it (`kill -STOP` its node process, `kill -CONT` afterwards) or use a separate test mirror on another port.

- VS Code debugging is already configured in `.vscode/launch.json` with two predefined configurations:
  - **Attach to node process** (port 9229) — Debug the backend Node.js process via `node_helper.js`.
  - **Launch MagicMirror² in Chrome with MMM-Webuntis** — Debug the frontend, opens `http://localhost:8080` in Chrome with DevTools.

- To debug:
  1. Press `Ctrl+Shift+D` (or click the Debug icon in the sidebar).
  2. Select either "Attach to node process" or the Chrome launch config from the dropdown.
  3. Click the play button (or press `F5`) to start debugging.
  4. Set breakpoints in the editor; execution will pause when hit.
  5. Use the Debug Console to inspect variables and step through code.

- VS Code automatically handles port forwarding from the devcontainer — no manual port configuration needed.

- Notes:
  - `--inspect-brk` pauses execution until a debugger attaches; use `--inspect` (no `-brk`) if you do not want this behavior. The mirror starts without an inspector; enable it as described above before starting the "Attach to node process" configuration.
  - Debug breakpoints on Node will pause the entire process — ideal for step-through debugging, but can slow interactive testing.
  - Use `console.log()` / `logger()` for non-blocking debugging, especially during development cycles.


### Logging and Troubleshooting

**Backend Logs:**
- **You can ONLY see backend logs** (Node.js side in `node_helper.js`), not frontend logs
- Use `pm2 logs --lines 200` to view PM2 logs (prefer this for initial inspection)
- **IMPORTANT**: When viewing logs with tail/follow mode (`pm2 logs`, `tail -f`), these commands block the terminal indefinitely - interrupt them with `Ctrl+C` when done
- Log files persist in PM2 storage; use `get_terminal_output` tool to retrieve logs without blocking

**Frontend:**
- Frontend logs are visible in MagicMirror's browser console - you **cannot directly access** these from the backend
- Use the built-in Simple Browser (`open_simple_browser` tool) for limited visual inspection of the module
- Test frontend rendering changes via `node --run debug` (backend) + manual browser testing

**Testing Workflow:**
1. Run `node --run debug` to test config loading, auth, and data fetch orchestration (backend only)
2. Use debug dumps (`dumpBackendPayloads: true`) to inspect transformed data before frontend consumption
3. Visual testing requires running MagicMirror in a display environment (dev container has limited GUI)

**Terminal Command Best Practices:**
- ✅ Good: `pm2 logs --lines 200` (returns output, doesn't block)
- ✅ Good: `pm2 logs | head -50` (pipes to limit, quick exit)
- ❌ Avoid: `pm2 logs --lines 0` (blocks indefinitely, requires manual interrupt)
- ❌ Avoid: `tail -f <logfile>` (blocks terminal, must interrupt)
- When in doubt about a blocking command, use `Ctrl+C` to abort and try a different approach

### Debug dumps structure

Debug dumps are generated when `dumpBackendPayloads: true` is set in config. Files are stored in `debug_dumps/` (git-ignored):

**Filename pattern**: `TIMESTAMP_StudentName_api.json`

**Structure** (deeply nested):
```json
{
  "title": "StudentName",
  "config": { /* entire config object */ },
  "studentIds": { /* name -> ID mappings */ },
  "userData": { /* user info from API */ },
  "timetableRange": [ /* lessons array with {startTime, endTime, subject, ...} */ ],
  "exams": [ /* exam entries */ ],
  "homeworks": [ /* homework entries with {title, dueDate, subject, text} */ ],
  "absences": [ /* absence records */ ],
  "messagesOfDay": [ /* message entries */ ],
  "fetchedAt": "timestamp"
}
```

Use `jq` to inspect: `cat debug_dumps/TIMESTAMP_StudentName_api.json | jq '.timetableRange' | head`

### Available CLI Tools in Devcontainer

The devcontainer includes additional CLI tools beyond the standard Node.js development stack. See [docs/DEVCONTAINER.md](../docs/DEVCONTAINER.md) for full details.

**REST API Testing:**
- `httpie` (or `http` command) - Modern REST API client with better syntax than curl
  ```bash
  http GET https://arche.webuntis.com/... Authorization:"Bearer $TOKEN"
  ```
- `curl` - Traditional HTTP client (fallback)

**Process & System Monitoring:**
- `htop` - Interactive process viewer (better than `top`)
- `watch` - Repeat commands periodically (e.g., `watch -n 2 'pm2 list'`)

**Data Processing:**
- `jq` - JSON parsing and filtering (heavily used for debug dumps)

**Network Debugging:**
- `netcat` (`nc` command) - Test TCP/UDP connections and ports

**Development:**
- `node --run test` - Runs the `node:test`-based unit tests in `tests/unit.test.js`
- `diff-so-fancy` - Enhanced git diff output (automatically used by git)
- `playwright` - Frontend testing (provided by the shared devcontainer base image)

**Configuration:**
- Playwright, `playwright-mcp`, and Chrome are preinstalled in the shared devcontainer base image
- See `docs/DEVCONTAINER.md` for lifecycle scripts and environment variables


## Code Review Guidelines

### Review Philosophy

- Only comment when you have HIGH CONFIDENCE (>80%) that an issue exists
- Be concise: one sentence per comment when possible
- Focus on actionable feedback, not observations
- When reviewing text, only comment on clarity issues if the text is genuinely confusing or could lead to errors. "Could be clearer" is not the same as "is confusing" - stay silent unless HIGH confidence it will cause problems

### Priority Areas (Review These)

#### Security & Safety

- Unsafe code blocks without justification
- Command injection risks (shell commands, user input)
- Path traversal vulnerabilities
- Credential exposure or hardcoded secrets
- Missing input validation on external data
- Improper error handling that could leak sensitive info

#### Correctness Issues

- Logic errors that could cause panics or incorrect behavior
- Race conditions in async code
- Resource leaks (files, connections, memory)
- Off-by-one errors or boundary conditions
- Incorrect error propagation
- Optional types that don't need to be optional
- Booleans that should default to false but are set as optional
- Error context that doesn't add useful information
- Overly defensive code that adds unnecessary checks
- Unnecessary comments that just restate what the code already shows (remove them)

#### Architecture & Patterns

- Code that violates existing patterns in the codebase
- Missing error handling
- Async/await misuse or blocking operations in async contexts

### Response Format

When you identify an issue:
1. **State the problem** (1 sentence)
2. **Why it matters** (1 sentence, only if not obvious)
3. **Suggested fix** (code snippet or specific action)

### When to Stay Silent

If you're uncertain whether something is an issue, don't comment. False positives create noise and reduce trust in the review process.

## Development Workflow & Common Patterns

### Typical Development Cycle

1. **Understand the issue/task** → read relevant files and architecture docs
2. **Plan changes** → identify which files/services need modification
3. **Implement** → make focused, testable changes
4. **Validate**:
  - Run `node --run lint` to catch Biome issues
  - Run `node --run check` / `node --run debug` to validate behavior
   - Use `node --run debug` to test backend functionality with real config
   - Inspect debug dumps if transformations changed
5. **Complete** → notify user, **DO NOT commit**, user handles git operations

### Common Commands & Their Purpose

| Command | Purpose | Output Behavior | Use Case |
|---------|---------|-----------------|----------|
| `node --run lint` | Biome validation | Returns immediately | Before finishing any code changes |
| `node --run debug` | Interactive CLI test (config, auth, fetch) | Returns immediately | Debug auth issues, test data fetching, config loading |
| `node --run check` | Same as debug, quieter mode | Returns immediately | Quick validation |
| `pm2 logs --lines 200` | View recent PM2 logs | Returns immediately with last 200 lines | Check runtime behavior |
| `pm2 logs \| head -50` | View PM2 logs, limited | Returns immediately after 50 lines | Quick log inspection |
| ❌ `pm2 logs` (no args) | Follow mode - BLOCKS indefinitely | Requires `Ctrl+C` to interrupt | DO NOT USE - use `--lines` instead |
| ❌ `tail -f <file>` | Follow mode - BLOCKS indefinitely | Requires `Ctrl+C` to interrupt | DO NOT USE - use `--lines` instead |

### Accessing Logs & Debugging

**Key Principle**: All commands must **return control immediately** unless background processes are intentional.

**Good Patterns:**
- `pm2 logs --lines 200` → get last 200 lines, returns immediately
- `pm2 logs --lines 100 \| grep "error"` → filtered view, returns immediately
- `cat debug_dumps/TIMESTAMP_StudentName_api.json \| jq '.timetableRange' \| head` → inspect specific data
- `node --run debug` → interactive backend test, returns when user quits

**Bad Patterns:**
- ❌ `pm2 logs` without `--lines` → follows new logs indefinitely, must interrupt
- ❌ `tail -f /path/to/logfile` → same issue, indefinite follow
- ❌ `pm2 logs --lines 0` → infinite output, blocks indefinitely

### Playwright (node) frontend capture

- There is currently no integrated `capture:console` script in `package.json`.
- For non-interactive captures, either run a local ad-hoc Playwright script or use Playwright MCP.

### Playwright MCP (interactive) — Notes

In addition to the non‑interactive capture script, we now support Playwright MCP (Managed Capture Protocol) for interactive access to the MagicMirror browser. MCP enables:
- Interactive DOM exploration: use `page.$`, `page.$$eval`, and `page.evaluate()` to read and modify HTML/JS.
- Automation patterns: click sequences, form filling, navigation, and request mocking/interception.
- Enhanced forensics: combine screenshots, console logs, network traces and accessibility snapshots in a single session.

Startup / environment options:
- Recommended: use the committed MCP configuration - `.mcp.json` for Claude Code, `.vscode/mcp.json` for Copilot Chat. Both spawn the preinstalled `playwright-mcp` binary over stdio.
- Running Chromium as root (e.g. in Codespaces) requires `--no-sandbox`. Set `PLAYWRIGHT_CHROMIUM_ARGS="--no-sandbox"` or export that environment variable before launching.
- Use a separate user data directory for parallel runs: `PLAYWRIGHT_CHROMIUM_USER_DATA_DIR=$(mktemp -d)`.

Migration guidance:
- If a dedicated capture script is introduced, it should be registered in `package.json` and documented here.

Security note:
- MCP can read the DOM and execute page scripts — treat dumps and console exports as sensitive data. Redaction/filtering is recommended (see `lib/mmm-adapter/mmmPayloadMapper.js`).

### Testing Changes

**Backend Only** (what the AI agent can verify):
- Config loading via `node --run check` / `node --run debug`
- Authentication, token caching
- Data fetch orchestration & API calls
- Data transformation logic (via debug dumps)
- Error handling & logging

**Frontend** (requires browser/display):
- Widget rendering (`plugins/*/*.js`, plus `lib/frontendShared.js` for shared helpers)
- CSS styling (MMM-Webuntis.css, custom.css)
- Socket message handling (MMM-Webuntis.js)
- Browser console errors

For frontend testing: run `node --run debug` to validate backend, then use `open_simple_browser` to test visual aspects (limited GUI in dev container).

</instructions>