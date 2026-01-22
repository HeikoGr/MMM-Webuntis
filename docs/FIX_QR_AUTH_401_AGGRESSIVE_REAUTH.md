# Fix: QR Code Auth 401 Error - Aggressive Re-authentication

## Problem Description

User reported (QR code login):
- Screen goes black shortly after startup
- Consistent log pattern before blackout:
  1. 401 error at `app/data`
  2. Token refresh triggered
  3. 404 error at timetable after refresh
  4. Everything fails, screen goes black

**Log pattern:**
```
[lib] GET failed with status 401
[AuthService] app/data response was empty
[timetable] Authentication token expired, invalidating cache and retrying...
[timetable] Retry failed after token refresh: GET failed with status 404
[Stundenplan <Name>] GET failed with status 404
```

## Root Cause Analysis

### Original Implementation

1. **QR Auth Flow** (in `_performQRAuth()`):
   - `httpClient.authenticateWithQRCode()` → OTP login
   - `httpClient.getBearerToken()` → get Bearer token
   - `_fetchAppData()` → **fetch app/data for tenantId/schoolYearId**

2. **Problem with `_fetchAppData()`**:
   - Used `wrapAsync()` wrapper that **catches all errors**
   - On 401 error: only logged a warning, returned `null` values
   - Auth flow continued with **NULL tenantId/schoolYearId**
   - Cache was populated with invalid auth data

3. **Cascade Failure**:
   - Subsequent API calls (timetable) used cached auth **without tenantId**
   - REST API returned **404 Not Found** (wrong endpoint/missing tenant)
   - Module stopped working, screen went black

### Why 401 at app/data?

Possible causes:
- **Cookie expired** between `getBearerToken()` and `_fetchAppData()` calls
- **Token invalid** for app/data endpoint (rare but possible)
- **Race condition**: Cookie invalidated during auth flow
- **Session timeout**: WebUntis server invalidated session mid-flow

## Solution: Aggressive Re-authentication

### Changes Made

**File: `lib/authService.js`**

1. **Removed `wrapAsync()` wrapper** from `_fetchAppData()`:
   - Direct fetch without error suppression
   - Explicit 401 detection and error throwing

2. **Added explicit 401 check**:
   ```javascript
   if (appDataResp.status === 401) {
     this.logger('error', `[AuthService] app/data returned 401 Unauthorized - aborting auth flow to force complete re-authentication`);
     throw new Error(`app/data authentication failed (HTTP 401): credentials or token invalid/expired`);
   }
   ```

3. **Error propagates up to `_performQRAuth()`**:
   - `tryOrThrow()` wrapper catches error
   - Auth flow fails cleanly
   - No invalid cache entry created

4. **Retry with `_forceReauth` flag**:
   - When `invalidateCache()` is called (on API 401 errors), `_forceReauth` flag is set
   - Next auth attempt **completely bypasses cache**
   - **Brand new QR auth flow**: new OTP, new cookies, new token, new app/data call

### How It Works Now

**Normal Flow (no errors):**
```
QR Code → OTP login → Bearer Token → app/data (200 OK)
→ Cache populated → API calls succeed
```

**Error Flow (401 at app/data):**
```
QR Code → OTP login → Bearer Token → app/data (401)
→ ERROR thrown → Auth flow aborted
→ No cache entry created
→ Retry triggered (webuntisApiService.js onAuthError callback)
→ invalidateCache() → _forceReauth flag set
→ NEW QR Auth: new OTP → new cookies → new token → app/data (200 OK)
→ Cache populated → API calls succeed
```

**Error Flow (401 at timetable API):**
```
Timetable API call → 401 error
→ onAuthError callback triggered
→ invalidateCache() → _forceReauth flag set
→ Retry: getAuth() called again
→ _forceReauth bypasses cache → NEW QR Auth flow
→ New token → Retry timetable API → success
```

## Benefits

1. **Fail-fast**: Errors during auth flow are detected immediately
2. **No invalid cache**: Failed auth doesn't populate cache with NULL values
3. **Complete re-auth**: Token refresh always does full QR auth (new OTP, cookies, token)
4. **Better logging**: 401 errors clearly indicate auth failure reason
5. **Prevents cascade failures**: Subsequent API calls get valid auth data

## Testing

Tested with `node --run debug`:
- ✅ QR code auth succeeds normally
- ✅ Cached auth reused correctly (5-minute buffer)
- ✅ No lint errors
- ✅ All 3 test modules succeed

## User Impact

- **Fixes black screen issue** caused by 401 at app/data
- **More robust auth**: transient errors trigger complete re-auth
- **No config changes needed**: fix is transparent to users

## Related Files

- `lib/authService.js` - Auth service with aggressive 401 handling
- `lib/webuntisApiService.js` - onAuthError callback triggers invalidateCache()
- `node_helper.js` - Defines onAuthError callbacks for all API calls

## Deployment Notes

- No breaking changes
- No config migration needed
- Users experiencing "black screen + 401 at app/data" should see immediate improvement
