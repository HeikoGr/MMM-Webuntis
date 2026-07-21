# MMM-Webuntis

> ⚠️ **Disclaimer / Haftungsausschluss**:
>
> **English:** This project is **not** an official Untis product and is not affiliated with, endorsed by, or supported by Untis GmbH or any of its subsidiaries. WebUntis is a registered trademark of Untis GmbH. The software is provided without warranty, including accuracy, completeness, or error-free operation of displayed WebUntis data. Use is at your own risk.
>
> **Deutsch:** Dieses Projekt ist **kein** offizielles Untis-Produkt und steht in **keiner** Verbindung zu Untis GmbH oder deren Tochtergesellschaften; es wird nicht von Untis unterstützt oder empfohlen. WebUntis ist eine eingetragene Marke der Untis GmbH. Die Software wird ohne Gewähr bereitgestellt; insbesondere wird keine Haftung für Fehlerfreiheit sowie für Vollständigkeit, Aktualität oder Richtigkeit der angezeigten WebUntis-Daten übernommen. Die Nutzung erfolgt auf eigene Gefahr.

> ⚠️ **Important Notice**:
>
> This project contains substantial AI-generated code. Review, test, and audit all files, web UI, and documentation before using it in production or safety-relevant contexts. Treat defaults and generated logic as untrusted until verified.

A MagicMirror² module that displays WebUntis timetables, exams, homework, absences, and messages of day.

## Requirements

- Node.js `>=20.18.1`

Older Node 20 installations have shown authentication and runtime failures in real-world setups, especially around the module's native HTTP stack. If direct login or QR login suddenly stops working, update Node first and then run `npm ci --omit=dev` again.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/HeikoGr/MMM-Webuntis
cd MMM-Webuntis
npm ci --omit=dev
```

## Quick Start

A minimal QR-code setup looks like this:

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

## Documentation

User-facing setup and configuration documentation now lives in the project wiki:

- [Wiki Home](https://github.com/HeikoGr/MMM-Webuntis/wiki)
- [Installation](https://github.com/HeikoGr/MMM-Webuntis/wiki/Installation)
- [Update](https://github.com/HeikoGr/MMM-Webuntis/wiki/Update)
- [Quick Start](https://github.com/HeikoGr/MMM-Webuntis/wiki/Quick-Start)
- [Configuration](https://github.com/HeikoGr/MMM-Webuntis/wiki/Configuration)
- [Authentication](https://github.com/HeikoGr/MMM-Webuntis/wiki/Authentication)
- [Widgets](https://github.com/HeikoGr/MMM-Webuntis/wiki/Widgets)
- [Troubleshooting](https://github.com/HeikoGr/MMM-Webuntis/wiki/Troubleshooting)

Technical background documentation remains in `docs/`:

- [docs/API_V3_MANIFEST.md](docs/API_V3_MANIFEST.md)
- [docs/API_REFERENCE.md](docs/API_REFERENCE.md)
- [docs/SERVER_REQUEST_FLOW.md](docs/SERVER_REQUEST_FLOW.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/CSS_CUSTOMIZATION.md](docs/CSS_CUSTOMIZATION.md)
- [docs/CLI.md](docs/CLI.md)
- [config/config.template.js](config/config.template.js)

## Screenshots

**Week view (grid):**

![Grid View](screenshot-all.png)

**List view (lessons + exams):**

![List View](screenshot-list.png)

## Support

- Issues: [GitHub Issues](https://github.com/HeikoGr/MMM-Webuntis/issues)
- Documentation: start with the [project wiki](https://github.com/HeikoGr/MMM-Webuntis/wiki)
- Logs: enable `logLevel: 'debug'` in your config

## License

MIT License - See [LICENSE](LICENSE)

---

**Note:** This module contains AI-generated code. Review and test thoroughly before production use.