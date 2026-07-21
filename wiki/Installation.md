# Installation

## Requirements

- Node.js `>=20.18.1`
- a working MagicMirror² installation
- a valid WebUntis account or QR code

Older Node 20 builds have caused auth and runtime issues in real installations. If login suddenly fails after a system update, verify the Node version first.

## Fresh Install

```bash
cd ~/MagicMirror/modules
git clone https://github.com/HeikoGr/MMM-Webuntis
cd MMM-Webuntis
npm ci --omit=dev
```

## Add It To MagicMirror

Add a module entry to your MagicMirror config. Start with the smallest possible setup:

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_right',
  config: {
    students: [
      {
        title: 'Alice',
        qrcode: 'untis://setschool?url=myschool.webuntis.com&school=myschool&user=alice&key=ABC123...',
      },
    ],
  },
}
```

If your account does not support QR login, use the username/password example from [Authentication](Authentication).

## Next Step

Continue with [Quick Start](Quick-Start) if you want a minimal working config first, or jump to [Configuration](Configuration) if you already know which plugins and ranges you want.