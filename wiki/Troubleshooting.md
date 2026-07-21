# Troubleshooting

## No Data Appears

Check these first:

1. Verify the Node version is at least `20.18.1`.
2. Confirm the auth method matches the account type.
3. Set `logLevel: 'debug'`.
4. For parent setups, confirm `students: []` is present if you expect auto-discovery.
5. Make sure the selected date range actually contains timetable data.

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