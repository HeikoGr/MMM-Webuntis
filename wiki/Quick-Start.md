# Quick Start

This page gives you the fastest route to a working setup.

## Minimal QR-Code Example

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_right',
  config: {
    displayMode: 'grid, lessons, exams',
    students: [
      {
        title: 'Alice',
        qrcode: 'untis://setschool?url=myschool.webuntis.com&school=myschool&user=alice&key=ABC123...',
      },
    ],
  },
}
```

## Minimal Username/Password Example

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_right',
  config: {
    displayMode: 'lessons, exams',
    students: [
      {
        title: 'Alice',
        username: 'alice.smith',
        password: 'secret',
        school: 'myschool',
        server: 'myschool.webuntis.com',
      },
    ],
  },
}
```

## Good Defaults For A First Run

- Keep `logLevel: 'none'` unless you are debugging.
- Start with one student only.
- Use `displayMode: 'lessons, exams'` or `displayMode: 'grid, lessons, exams'`.
- Prefer QR login if your school uses SSO.

## What To Configure Next

- Auth method and parent-account setups: [Authentication](Authentication)
- Common options and ranges: [Configuration](Configuration)
- Widget-specific display choices: [Widgets](Widgets)