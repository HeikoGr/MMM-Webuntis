# Troubleshooting

## No Data Appears

Check these first:

1. Verify the Node version is at least `22.22.1`.
2. Confirm the auth method matches the account type.
3. Set `logLevel: 'debug'`.
4. For parent setups, confirm `students: []` is present if you expect auto-discovery.
5. Make sure the selected date range actually contains timetable data.

## Which Log Level To Pick

`logLevel: 'info'` is the level for "data disappears now and then". It stays quiet during normal
operation and prints exactly two kinds of auth line:

- one line per real login (`REST auth: logging in ...` or `QR Auth: Starting authentication ...`) -
  cached sessions are reused silently, so every line here is an actual login
- one line per invalidated session (`Invalidating expired token cache`)

A login without a preceding invalidation means the token simply aged out. A login right after an
invalidation means something rejected the session. Correlating those timestamps with the moment
data vanished is usually enough to tell a session problem from an empty timetable.

`logLevel: 'debug'` adds cache hits, per-request details and payload summaries - useful once you
know where to look, too noisy to watch for hours.

## Empty View But Data May Have Failed To Load

An empty timetable view does not always mean that there is really no school on that day.

Current runtime behavior to keep in mind:

- the backend uses a timetable-first fetch strategy because timetable is the auth canary
- the frontend can preserve older data when a new fetch fails critically
- if no usable timetable data remains for a day, the grid plugin falls back to `no-lessons`
- the lessons plugin may render its empty row text even though the interesting question is really whether data was unavailable or the day was genuinely empty

For investigations, verify these separately:

1. Was timetable fetching attempted at all?
2. What does the API status snapshot report for `timetable`?
3. Were warnings or `warningMeta` entries emitted for auth, network, or server errors?
4. Does the selected date range actually include lessons?
5. Do debug dumps or PM2 logs show an upstream empty response, a timeout, or an auth refresh?

### Telling the four empty states apart

With `dumpBackendPayloads: true`, open the newest `debug_dumps/<timestamp>_<student>_api.json`
and look at `state.collections` first - it says per collection whether the latest fetch succeeded
(`ok`), failed or was skipped (`unavailable`) or was not requested (`disabled`), and when the last
success was (`lastSuccessAt`). Then `state.fetch`, `state.api`, `state.warnings`, `data.lessons`
and `data.dayNotices`:

| State | `state.fetch.timetable` | `state.api.timetable` | `state.warnings` | `data.lessons` | What the widgets show |
|-------|-------------------------|-----------------------|------------------|----------------|-----------------------|
| Timetable never requested | `false` (no grid/lessons plugin) or `true` with `nextDays: 0` | `null` | – | `[]` | plugin not rendered, or rendered empty |
| Fetch failed (network, 5xx, 401) | `true` | `0`, `5xx` or `401` | network/auth/server warning | `[]` | previous data is kept if the session had any; otherwise `kein Unterricht` plus a warning banner |
| Endpoint forbidden (403, remembered for 24h) | `true` | `403` | **none** | `[]` | previous data is kept if any; otherwise `kein Unterricht` **without** a warning |
| Session cookie expired (idle > ~5 min) and the automatic re-login failed | `true` | `401` | auth warning (`session expired` / `Authentication failed`) | `[]` | previous data is kept and `state.collections.lessons.status` is `unavailable`; a fresh session shows `Daten nicht verfügbar` per day plus the warning banner |
| Timetable body without `days[]` (maintenance page, proxy error) | `true` | `0` | `unusable response` warning | `[]` | previous data is kept; without previous data: `Daten nicht verfügbar` |
| Plan locked by the school (`NOT_ALLOWED`) | `true` | `200` | none | `[]` | `Plan gesperrt` (from `data.dayNotices[].kind = timetable-restricted`) |
| Genuinely no lessons | `true` | `200` | none | `[]` | `kein Unterricht`; WebUntis marks such days `NO_DATA`, forwarded as `data.dayNotices[].kind = no-data` |

`Plan gesperrt` and a genuinely lesson-free day both come with `state.collections.lessons.status =
ok`; the raw `raw_api_*_timetable.json` dump written by `dumpRawApiResponses: true` shows the
per-day status (`NO_DATA` vs. `NOT_ALLOWED`). Failed requests are dumped as
`raw_api_*_<type>_error.json` with status, error code, redirect location and a body snippet.

Useful references:

- `docs/SERVER_REQUEST_FLOW.md`
- `docs/API_V3_MANIFEST.md`
- `docs/ARCHITECTURE.md`

## QR Login Does Not Work

- Check that the QR code still matches the right account.
- Prefer QR for SSO-backed accounts.
- Re-scan the code if the original value was copied manually.

## Username / Password Login Does Not Work

- Re-check `school` and `server`.
- Make sure the account really supports direct login.
- If the school uses SSO, switch to QR.

## The Module Starts But A Widget Is Missing

- Check `displayMode` first.
- Then review plugin-specific `plugins.<id>.config` settings.
- Test with a simpler mode such as `lessons, exams`.

## Useful Commands

```bash
node --run check
node --run debug
node --run test:auth:curl
pm2 logs --lines 100
```

## When You Need More Detail

The repository still contains technical diagnostics and internals in `docs/`, especially:

- `docs/CLI.md`
- `docs/API_REFERENCE.md`
- `docs/SERVER_REQUEST_FLOW.md`

If you are debugging module internals rather than just setting it up, start there.