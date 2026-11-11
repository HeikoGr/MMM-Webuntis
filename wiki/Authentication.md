# Authentication

MMM-Webuntis supports two practical login modes.

## 1. QR Code Login

Recommended for:

- student accounts
- parent accounts
- schools that use SSO

Example:

```javascript
students: [
  {
    title: 'Alice',
    qrcode: 'untis://setschool?url=myschool.webuntis.com&school=myschool&user=alice&key=ABC123...',
  },
]
```

Why this is usually the best choice:

- fewer manual fields
- works better with SSO-backed accounts
- easier to keep consistent with the mobile app

## 2. Username / Password Login

Use this when QR login is not available.

Example:

```javascript
students: [
  {
    title: 'Alice',
    username: 'alice.smith',
    password: 'secret',
    school: 'myschool',
    server: 'myschool.webuntis.com',
  },
]
```

## Parent Account Auto-Discovery

If you log in with a parent account, you can let the module discover all children automatically.

Example:

```javascript
config: {
  username: 'parent@example.com',
  password: 'secret',
  school: 'myschool',
  server: 'myschool.webuntis.com',
  students: [],
}
```

Important detail:

- `students: []` is what enables the child auto-discovery flow.

If you want to customize only one discovered child, add a `students` entry with the matching `studentId`.

## Mixed Setups

You can mix credentials across `students` if needed, but start simple unless you really need that flexibility.

## If Login Fails

- Verify the Node version.
- Check whether the account should use QR instead of direct credentials.
- Confirm `school` and `server` are correct.
- Enable `logLevel: 'debug'` and continue with [Troubleshooting](Troubleshooting).

## Keeping Credentials Safe

- **Treat the QR code like a password.** The `key=` part is a permanent secret that generates the
  login codes. Anyone with the QR URL can sign in as that account until you create a new QR code in
  your WebUntis profile (where the QR code for the mobile app is shown), which replaces the old one.
- **Keep the secrets out of the browser.** Write them as `${SECRET_WEBUNTIS_PASSWORD}` or
  `${SECRET_WEBUNTIS_QRCODE}` in `config.js`, put the values into `config/config.env` and set
  `hideConfigSecrets: true` (see the MagicMirror documentation on config variables). The module's
  backend reads the real values; its payloads never send passwords or QR codes to the browser.
- **Limit who can reach the mirror.** MagicMirror serves its page and the `modules/` folder on its
  port. `address: "0.0.0.0"` with `ipWhitelist: []` opens it to every device in your network; list
  only the devices that need it, and never forward the port to the internet.
- **Do not paste credentials into issues.** Logs and warnings are redacted, but check anything you
  share. Security problems go through [SECURITY.md](https://github.com/HeikoGr/MMM-Webuntis/blob/master/SECURITY.md).
