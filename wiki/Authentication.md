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