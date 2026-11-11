# Installation

## Requirements

- Node.js `>=22.22.2 <23` or `>=24`, the same range as MagicMirror² 2.38
- a working MagicMirror² installation
- a valid WebUntis account or QR code

Older Node builds have caused auth and runtime issues in real installations. If login suddenly fails after a system update, verify the Node version first.

## Fresh Install

```bash
cd ~/MagicMirror/modules
git clone --recurse-submodules https://github.com/HeikoGr/MMM-Webuntis
cd MMM-Webuntis
npm ci --omit=dev
```

The module needs the `lib/mmm-shared` git submodule; a ZIP download does not contain it. If the
module fails to start with `Cannot find module './lib/mmm-shared/mmm-shared'`, run
`git submodule update --init --recursive` in the module folder.

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