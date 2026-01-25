# MMM-Webuntis

> ⚠️ **Disclaimer / Haftungsausschluss**:
>
> **English:** This project is **not** an official Untis product, is **not** affiliated with, endorsed by, or supported by Untis GmbH or any of its subsidiaries. WebUntis is a registered trademark of Untis GmbH. This is an independent, community-developed module for MagicMirror² that interfaces with WebUntis APIs. Use at your own risk.
>
> **Deutsch:** Dieses Projekt ist **kein** offizielles Untis-Produkt und steht in **keiner** Verbindung zu Untis GmbH oder deren Tochtergesellschaften. Es wird **nicht** von Untis unterstützt oder empfohlen. WebUntis ist eine eingetragene Marke der Untis GmbH. Dies ist ein unabhängiges, von der Community entwickeltes Modul für MagicMirror², das die WebUntis-APIs nutzt. Nutzung auf eigene Gefahr.

> ⚠️ **Important Notice**:
>
> This project contains substantial AI-generated code. Review, test, and audit all files, web UI, and documentation before using it in production or safety-relevant contexts. Treat defaults and generated logic as untrusted until verified.

A MagicMirror² module that displays WebUntis timetables, exams, homework, and absences.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/HeikoGr/MMM-Webuntis
cd MMM-Webuntis
npm ci --omit=dev
```

## Update

```bash
cd ~/MagicMirror/modules/MMM-Webuntis
git pull
npm ci --omit=dev
```

## Quick Start

Add to your `config/config.js`:

```javascript
{
  module: "MMM-Webuntis",
  position: "top_right",
  config: {
    students: [
      {
        title: "Alice",
        qrcode: "untis://setschool?..."  // Get from WebUntis app
      }
    ]
  }
}
```

**Getting the QR code:**
1. Open WebUntis app
2. Go to Account → Data Access
3. Generate QR code for this app
4. Copy the `untis://...` URL

## Common Configurations

### Week View (Monday-Friday)

```javascript
{
  module: "MMM-Webuntis",
  position: "top_right",
  config: {
    displayMode: "grid",
    grid: {
      weekView: true,  // Auto-shows Mon-Fri, advances on weekends
      maxLessons: 8,
    },
    students: [
      { title: "Alice", qrcode: "untis://..." }
    ]
  }
}
```

### Multiple Students

```javascript
{
  module: "MMM-Webuntis",
  position: "top_left",
  config: {
    students: [
      { title: "Alice", qrcode: "untis://..." },
      { title: "Bob", qrcode: "untis://..." }
    ]
  }
}
```

### Parent Account (Auto-Discovery)

```javascript
{
  module: "MMM-Webuntis",
  position: "top_right",
  config: {
    username: "parent@example.com",
    password: "your-password",
    school: "myschool",
    server: "myschool.webuntis.com",
    students: []  // Empty = auto-discover all children
  }
}
```

## Widget Types

Set via `displayMode` (comma-separated):

- `grid` - Visual timetable grid
- `lessons` - List of upcoming lessons
- `exams` - Upcoming exams
- `homework` - Homework assignments
- `absences` - Absence records
- `messagesofday` - School announcements

**Example:**
```javascript
displayMode: "grid,exams,homework"
```

## Configuration

For all configuration options, see [docs/CONFIG.md](docs/CONFIG.md).

### Most Common Options

| Option | Default | Description |
| --- | --- | --- |
| `displayMode` | `'lessons,exams'` | Widgets to show (comma-separated) |
| `updateInterval` | `5 * 60 * 1000` | Update frequency (milliseconds) |
| `grid.weekView` | `false` | Enable Mon-Fri week view |
| `grid.maxLessons` | `0` | Limit grid height (0 = all) |
| `logLevel` | `'none'` | Debug logging: `'debug'`, `'info'`, `'warn'`, `'error'`, `'none'` |

## Troubleshooting

**No data showing?**
1. Check credentials (QR code or username/password)
2. Enable debug logging: `logLevel: 'debug'`
3. Check browser console and PM2 logs

**Empty grid/widgets?**
- Past lessons are hidden by default
- Adjust `nextDays` to show more future days
- Try `grid.weekView: true` for automatic week display

**SSO/Corporate login?**
- Use QR code instead of username/password
- Generate from WebUntis app → Account → Data Access

**Need student IDs?**
- Use parent account with empty `students: []`
- Check logs for auto-discovered IDs
- See [docs/CONFIG.md - Auto-Discovery](docs/CONFIG.md#auto-discovery-feature)

## CLI Testing Tool

Test your configuration without running MagicMirror:

```bash
cd ~/MagicMirror/modules/MMM-Webuntis
node --run debug
```

## Development

```bash
node --run lint           # Check code style
node --run lint:fix       # Auto-fix formatting
node --run test:spelling  # Check spelling
node --run deps:check     # Verify dependencies
```

## Documentation

- **[docs/CONFIG.md](docs/CONFIG.md)** - Complete configuration reference
- **[docs/CSS_CUSTOMIZATION.md](docs/CSS_CUSTOMIZATION.md)** - Styling and themes
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture
- **[config/config.template.js](config/config.template.js)** - Full example config

## Screenshots

**Week view (grid):**

![Grid View](screenshot-all.png)

**List view (lessons + exams):**

![List View](screenshot-list.png)

## Support

- Issues: [GitHub Issues](https://github.com/HeikoGr/MMM-Webuntis/issues)
- Documentation: Check [docs/CONFIG.md](docs/CONFIG.md) first
- Logs: Enable `logLevel: 'debug'` in config

## License

MIT License - See [LICENSE](LICENSE)

---

**Note:** This module contains AI-generated code. Review and test thoroughly before production use.

