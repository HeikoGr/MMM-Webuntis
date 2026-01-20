<instructions>

# MMM-Webuntis: AI Agent Coding Guidelines

**Purpose**: Guide AI agents toward productive, high-quality contributions.
**Status**: Production module (~5,200 LOC, 14 services, 6 widgets).
**Last Updated**: 2026-01-20

## Architecture Overview (Critical to Understand)

**Frontend → Backend Socket Flow**:
```
MMM-Webuntis.js (start) → socketNotification("INIT_MODULE")
  → node_helper.js:socketNotificationReceived() [~L1201] → _handleInitModule()
    → validate + applyLegacyMappings → auto-discover students (optional)
    → socketNotification("MODULE_INITIALIZED") to FE
    → _handleFetchData() auto-runs first fetch (no FE FETCH_DATA needed)
      → orchestrateFetch() → authService.getAuth() → webuntisApiService.callWebUntisAPI()
      → buildGotDataPayload() → socketNotification("GOT_DATA", payload)
  → MMM-Webuntis.js:socketNotificationReceived() → widgets render
```

**Critical Services** (ordered by importance):
1. **authService.js** - Auth + 14min token caching (QR code, credentials, parent accounts)
2. **webuntisApiService.js** - REST endpoint wrappers (getTimetable, getExams, getHomework, etc.)
3. **dataFetchOrchestrator.js** - Parallel data fetching (ISSUES.md CRIT-1 tracks sequential→parallel migration)
4. **dataTransformer.js** - Data normalization (timetable→lessons, dates→YYYYMMDD integers)

**REST API Strategy**: Migrate away from deprecated JSON-RPC. Use REST for all data; JSON-RPC only for auth/OTP.

## Key Patterns & Conventions

### Authentication Pattern
- **Always** use `authService.getAuth()` - never call httpClient or fetch directly
- `getAuth()` caches tokens for 14 minutes; never bypass cache
- QR code auth: extract `person_id` from JWT token via `extractPersonIdFromToken()`
- Parent account: fetches app/data to auto-discover student IDs
- On token expiry: `onAuthError` callback invalidates cache automatically

### REST API Calls
- All data fetching via `webuntisApiService.callWebUntisAPI()` - no direct REST calls
- Generic signature: `{ dataType, getAuth, server, params, transform, logger }`
- Endpoint configs in `webuntisApiService.js#ENDPOINTS` - update if adding new data types
- Required headers: `Authorization: Bearer {token}`, `X-Webuntis-Api-Tenant-Id: {tenantId}`
- Error responses mapped to user-friendly warnings via `errorHandler.mapRestError()`

### Data Transformation

**Core Principle**: Deterministic transformations based on data source. No compatibility layers needed since frontend and backend always update synchronously.

- All API responses normalized in `dataTransformer.js` - use pure functions only
- Dates MUST be normalized to YYYYMMDD integers (e.g., `20260114`) via `normalizeDateToInteger()`
- HTML sanitization in `payloadCompactor.js#sanitizeHtml()` - whitelist: b, strong, i, em, u, br, p
- Never send raw API objects to frontend - run through `compactArray()` with schema

**Time Transformation** (simple, no validation layer needed):
- REST API sends HHMM integers (e.g., 1350 = 13:50) → pass through directly
- Timegrid sends HH:MM strings (e.g., "13:50") → parse to HHMM via `parseTimegridTimeString(v)`
- Frontend receives HHMM integers; widgets format via `formatTime(hhmm)` → "13:50"

**Important**: Data format is always deterministic - always know and specify the source format. No guessing.

### Configuration
- 25 legacy config key mappings in `configValidator.js#applyLegacyMappings()` - don't break them
- Widget-specific validation in `widgetConfigValidator.js` - check before assuming config structure
- Always validate config schema before using - see `MMM-Webuntis.js#defaultConfig`

### Logging Pattern
```javascript
// Backend: use the logger function passed as parameter
logger('debug', null, `[feature] Message ${variable}`);  // null = no student context
logger('warn', 'StudentName', `Warning for student`);    // include student name for context

// Frontend: use console for debugging
console.debug('[feature]', data);
console.warn('[feature] Warning:', error);
```

## File Organization (Updated: lib/ fully documented)

**Essential files** (most editing happens here):
- `node_helper.js` (1765 LOC) - Socket listener & data fetch orchestrator
- `lib/authService.js` - Auth, QR code, token caching (14min TTL)
- `lib/webuntisApiService.js` - Generic API caller for all 5 data types
- `lib/restClient.js` - REST wrapper (headers, error handling, retry)
- `lib/dataFetchOrchestrator.js` - Parallel fetch logic (CRITICAL: see ISSUES.md CRIT-1)
- `lib/dataOrchestration.js` - Data transformation + fetch range calculation (mapRestStatusToLegacyCode, normalizeDateToInteger, calculateFetchRanges)
- `lib/configValidator.js` - Config schema + 25 legacy key mappings
- `widgets/*.js` - 6 renderer modules (lessons, grid, exams, homework, absences, messagesofday)
- `config/config.template.js` - Config schema with 90+ options
- `tests/unit.test.js` - Jest tests (currently 0% coverage)

**Supporting modules** (rarely modified):
- `lib/fetchClient.js` - HTTP fetch abstraction
- `lib/httpClient.js` - JSON-RPC client (auth only)
- `lib/cacheManager.js` - TTL cache
- `lib/payloadCompactor.js` - Schema-driven payload optimization + time/HTML transformations (explicit `normalizeRestApiTime()`, `normalizeTimegridTime()`)
- `lib/errorHandler.js` - Error mapping + warnings
- `lib/dateTimeUtils.js` - Frontend date/time utilities (formatTime, toMinutes, etc.)
- `lib/cookieJar.js` - Session cookie management
- `lib/widgetConfigValidator.js` - Widget-specific config validation
- `lib/payloadBuilder.js` - Build GOT_DATA payloads + debug dumps

**Documentation** (especially important for understanding decisions):
- `docs/ARCHITECTURE.md` - Mermaid diagrams of data flows
- `docs/DATA_TRANSFORMATIONS.md` - **Complete analysis of all data transformations (time, date, HTML sanitization)**
- `docs/01-research/API_ARCHITECTURE.md` - REST endpoints, auth methods, coverage
- `docs/ISSUES.md` - Known issues, CRITICAL refactoring tasks
- `docs/lib-README.md` - Service documentation

## Quality bar

- Follow the repository’s existing ESLint/Prettier configuration.
- Avoid broad refactors “for cleanliness”; do focused edits.
- After any code change: run `node --run lint` and fix any new lint errors before saving/closing the change.
- Align config/CLI changes with the matching templates and translations (`config.template.js`, `translations/*.json`, `custom.template.css` etc.) to avoid drift.
- Fix errors and warnings where possible. Don't suppress them unless absolutely necessary.
- Implement easy fixes even if they weren't your fault.
- Add comments for complex logic or non-obvious decisions.
- **When making code changes, review and update related documentation**:
  - Update Mermaid diagrams in `docs/ARCHITECTURE.md` if control flow or data flow changes
  - Update this file (`copilot-instructions.md`) if file organization, build commands, or conventions change
  - Keep `docs/lib-README.md` in sync with `lib/` folder changes
  - Update `CLI_COMPREHENSIVE_GUIDE.md` if CLI options or workflow changes

### Git & Commits - IMPORTANT RESTRICTIONS

- **NEVER create commits independently without explicit order** - commits are user responsibility only
- **NEVER push changes to any branch without explicit order** - all changes must remain staged/uncommitted for user review
- **NEVER run `git commit` or `git push` without explicit order** at any point, even if changes look complete
- **Do NOT initialize git repositories without explicit order** or change git configuration
- Changes are ready when:
  1. Code is edited and saved
  2. Tests pass (`npm test` succeeds)
  3. Linting passes (`node --run lint` succeeds without errors)
  4. Changes are staged with `git add` if needed
  5. User is notified of completion and can review/commit manually
## How to build and test

- **Lint code**: `node --run lint` (or `node --run lint:fix` to auto-fix)
- **Test**: `npm test` (runs linting)
- **Unit tests**: `node --run test:unit`
- **Spell check**: `node --run test:spelling`
- **Test configuration**: `node --run check` (interactive CLI tool, runs without errors)
- **Debug mode**: `node --run debug` (interactive CLI tool, same as check but with verbose output; useful for troubleshooting auth/API issues)

### Debugger: Node & Chrome

- The devcontainer's `entrypoint.sh` starts PM2 with `--node-args="--inspect-brk"` and `--watch` by default, enabling live debugging and auto-restart on file changes.

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
  - `--inspect-brk` pauses execution until a debugger attaches; use `--inspect` (no `-brk`) if you do not want this behavior.
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
   - Run `node --run lint` to catch ESLint/Prettier issues
   - Run `npm test` to validate behavior
   - Use `node --run debug` to test backend functionality with real config
   - Inspect debug dumps if transformations changed
5. **Complete** → notify user, **DO NOT commit**, user handles git operations

### Common Commands & Their Purpose

| Command | Purpose | Output Behavior | Use Case |
|---------|---------|-----------------|----------|
| `node --run lint` | ESLint + Prettier validation | Returns immediately | Before finishing any code changes |
| `npm test` | Jest unit tests (includes lint) | Returns immediately | Validate logic, run after major refactors |
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

- **Purpose:** Capture the MagicMirror frontend console and a full-page screenshot non-interactively.
- **Install (once):**
  - `npm install --save-dev playwright`
- **Run capture script:**
  - `node --run capture:console`
- **Output:** `debug_dumps/magicmirror_playwright.png` and `debug_dumps/magicmirror_console_logs.json`

This script runs a headless Chromium session, navigates to `http://localhost:8080`, waits for network idle, captures console messages and a screenshot, and writes results to `debug_dumps/`.

### Playwright MCP (interactive) — Notes

In addition to the non‑interactive capture script, we now support Playwright MCP (Managed Capture Protocol) for interactive access to the MagicMirror browser. MCP enables:
- Interactive DOM exploration: use `page.$`, `page.$$eval`, and `page.evaluate()` to read and modify HTML/JS.
- Automation patterns: click sequences, form filling, navigation, and request mocking/interception.
- Enhanced forensics: combine screenshots, console logs, network traces and accessibility snapshots in a single session.

Startup / environment options:
- Recommended (isolated): `npx @playwright/mcp@latest --isolated` or configure via `.vscode/mcp.json` (see repo).
- Running Chromium as root (e.g. in Codespaces) requires `--no-sandbox`. Set `PLAYWRIGHT_CHROMIUM_ARGS="--no-sandbox"` or export that environment variable before launching.
- Use a separate user data directory for parallel runs: `PLAYWRIGHT_CHROMIUM_USER_DATA_DIR=$(mktemp -d)`.

Migration guidance for the existing `scripts/playwright_capture_console.js`:
- The capture script remains useful as a non‑interactive fallback (CI, cron), but MCP can replace it for interactive investigations.
- If you adopt MCP for interactive work, you may either keep the capture script as a lightweight CLI wrapper or remove it after transition.

Security note:
- MCP can read the DOM and execute page scripts — treat dumps and console exports as sensitive data. Redaction/filtering is recommended (see `lib/payloadBuilder.js`).

### Testing Changes

**Backend Only** (what the AI agent can verify):
- Config loading via `node --run check` / `node --run debug`
- Authentication, token caching
- Data fetch orchestration & API calls
- Data transformation logic (via debug dumps)
- Error handling & logging

**Frontend** (requires browser/display):
- Widget rendering (widgets/*.js)
- CSS styling (MMM-Webuntis.css, custom.css)
- Socket message handling (MMM-Webuntis.js)
- Browser console errors

For frontend testing: run `node --run debug` to validate backend, then use `open_simple_browser` to test visual aspects (limited GUI in dev container).

</instructions>