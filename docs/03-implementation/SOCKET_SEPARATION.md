# Socket Communication Separation

## Overview

The module now uses separate socket notifications for initialization and data fetching:

- **`INIT_MODULE`**: One-time initialization (config validation, auth setup, student discovery)
- **`FETCH_DATA`**: Periodic data refresh (pure API calls, uses cached config/auth)

## Architecture

### Frontend (MMM-Webuntis.js)

```
start()
  ↓
_sendInit() → INIT_MODULE
  ↓
socketNotificationReceived('MODULE_INITIALIZED')
  ↓
_initialized = true
  ↓
_sendFetchData('post-init') → FETCH_DATA
  ↓
_startFetchTimer() → periodic FETCH_DATA
```

### Backend (node_helper.js)

```
INIT_MODULE
  ↓
_handleInitModule()
  ├─ Validate config
  ├─ Setup AuthService
  ├─ Auto-discover students
  └─ Send MODULE_INITIALIZED or INIT_ERROR

FETCH_DATA
  ↓
_handleFetchData()
  ├─ Check if initialized
  ├─ Coalesce requests
  └─ _executeFetchForSession()
      ├─ Group students by credentials
      └─ Fetch fresh data from WebUntis
```

## Benefits

1. **Clear Semantics**: Init vs. Fetch are explicit operations
2. **Performance**: Config validation only once, not on every fetch
3. **Error Handling**: Separate error paths for init vs. fetch failures
4. **Logging**: Clear `[INIT_MODULE]` and `[FETCH_DATA]` tags
5. **Testability**: Each path can be tested independently

## Migration Notes

No migration needed - frontend and backend are always deployed together.

## State Management

- **`_initialized`** (frontend): Prevents fetches before init completes
- **`_studentsDiscovered`** (backend): Tracks which identifiers have completed auto-discovery
- **`_configsByIdentifier`** (backend): Stores validated configs per module instance
- **`_authServicesByIdentifier`** (backend): AuthService instances per identifier

## Error Scenarios

### Init Errors
- Invalid config → `INIT_ERROR` with validation messages
- Missing credentials → `INIT_ERROR` with credential requirements
- Network errors during discovery → `INIT_ERROR` with API error details

### Fetch Errors
- API temporarily down → `GOT_DATA` with warnings, shows cached/empty data
- Auth expired → Re-authenticates automatically (AuthService handles)
- Network timeout → `GOT_DATA` with error message

## Debugging

Enable debug logging in config:
```javascript
logLevel: 'debug'
```

Look for these log patterns:
- `[INIT_MODULE] Initializing module` - Init started
- `[INIT_MODULE] Module X initialized successfully` - Init complete
- `[FETCH_DATA] Handling data fetch request` - Fetch started
- `[FETCH_DATA] Module X not initialized` - Fetch blocked (needs init first)

## Testing

1. **Fresh start**: Module should initialize once, then fetch periodically
2. **Browser reload**: Should re-init, then continue fetching
3. **Multiple instances**: Each gets own AuthService and config
4. **Network issues**: Init failures prevent fetching, fetch failures don't break init
