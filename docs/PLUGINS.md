# Plugin Architecture

This document describes the current plugin system used by MMM-Webuntis.

Use it for:
- plugin folder layout
- manifest fields and validation rules
- frontend and backend host APIs
- canonical plugin config shape
- capability-based fetch behavior

For overall module boundaries, see [ARCHITECTURE.md](ARCHITECTURE.md).
For the runtime payload contract, see [API_V3_MANIFEST.md](API_V3_MANIFEST.md).

## Overview

MMM-Webuntis loads first-party plugins from `plugins/*`.

The current host responsibilities are:
- discover plugin folders and validate manifests
- load backend plugin entrypoints during module initialization
- load frontend plugin assets before first render
- normalize public config into canonical plugin activation and plugin config
- derive fetch requirements from active plugin capabilities

The current plugin responsibilities are:
- define manifest metadata
- register frontend rendering code
- optionally register backend validation or derived-data helpers
- consume the canonical frontend runtime slice

`displayMode` remains a supported public config option. Internally, the backend normalizes it into `plugins.<id>.enabled`.

## Folder Layout

Canonical plugin structure:

```text
plugins/
  <pluginId>/
    manifest.json
    frontend.js
    backend.js
    styles.css
    translations/
      en.json
      de.json
```

Allowed variations:
- `frontend.js` may point to a nested file such as `frontend/index.js`
- `backend.js` is optional
- `styles.css` is optional and may be a list of CSS files
- `translations/` is optional (see [Translations](#translations))

All manifest entry paths must:
- be relative to the plugin root
- resolve inside the plugin root
- exist on disk

## Manifest

Every plugin is discovered through `manifest.json`.

Example:

```json
{
  "$schema": "../../docs/schemas/plugin-widget-manifest.schema.json",
  "id": "lessons",
  "version": "1.0.0",
  "title": "Lessons",
  "type": "widget",
  "entry": {
    "frontend": "frontend.js",
    "backend": "backend.js",
    "styles": ["styles.css"]
  },
  "slots": ["main"],
  "order": 200,
  "capabilities": ["lessons", "holidays", "dayNotices", "studentContext"],
  "configNamespace": "lessons",
  "activation": {
    "enabledByDefault": false,
    "displayAliases": ["lessons", "list"]
  },
  "compatibility": {
    "contractVersion": 3,
    "hostApiVersion": 1
  }
}
```

Required fields:
- `id`
- `version`
- `title`
- `type`
- `entry.frontend`
- `capabilities`
- `compatibility.contractVersion`
- `compatibility.hostApiVersion`

Current required values:
- `type` must be `widget`
- `compatibility.contractVersion` must be `3`
- `compatibility.hostApiVersion` must be `1`
- `slots` currently only supports `main`

Host-side validation also enforces:
- plugin folder name matches `id`
- plugin IDs are unique
- aliases do not collide with plugin IDs
- capabilities use host-known names only

## Canonical Config Shape

Public config can still use:
- `displayMode`
- top-level namespaces such as `lessons`, `grid`, `exams`, `homework`, `absences`, `messagesofday`

The backend normalizes those inputs into this canonical shape:

```js
plugins: {
  lessons: {
    enabled: true,
    config: {
      nextDays: 4,
      dateFormat: 'EEE'
    }
  }
}
```

Supported config layers:
- module-level `plugins.<id>.enabled`
- module-level `plugins.<id>.config`
- student-level `students[].plugins.<id>.config`

Merge order for plugin config is (`moduleConfig.buildCanonicalPluginsConfig()`):
1. the backend plugin's `getDefaultConfig()`
2. inherited plugin config
3. legacy top-level namespace such as `lessons` or `grid`
4. explicit `plugins.<id>.config`

The merge spreads whole objects, so it keeps every key, including ones no default declares.

### How a config value reaches a frontend plugin

A frontend plugin does not read the module's own `this.config`. It reads the student config the
backend sends back:

```
config.js (served by MagicMirror at page load)
  → browser: module.config                       – fixed for the lifetime of the page
    → CONFIGURE (socket, once per page load and after INIT_REQUIRED)
      → backend-session hub: the first CONFIGURE of an identifier wins
        → node_helper.prepareConfig() → normalizeModuleConfig() → buildCanonicalPluginsConfig()
          → DATA payload: context.config (per student, canonical plugins map)
            → frontend: configByStudent[title] → studentSlice.context.config
              → plugin: plugins.<id>.config via createWidgetContext().getConfig()
```

A new plugin option needs only its default in `getDefaultConfig()` (plus its check in
`validateConfig()`). No mapping or whitelist has to learn it. A backend that reads it for fetching
gets it from the same canonical map (`webuntisClient.buildFetchPlan()` → `pluginConfig(id)`).

**Pitfall: a changed `config.js` seems to be ignored.** The backend keeps the config of the
first client that configures an instance. A later client with a different config is answered with
the running one and only logged: `[hub] client config differs, the running config keeps
precedence {"keys":[...]}` (critical keys such as credentials or `students` are rejected with
`CONFIG_REJECTED` instead). After `pm2 restart`, every browser tab that was open reconnects and sends
**the config it loaded before the edit**. If such a tab is quicker than a freshly loaded one, the
backend keeps the old values until the next restart. Seen while adding `lessons.previewNext`
(2026-10-03): the option was in `config.js`, but the plugin got `previewNext: false` (the default),
because an old tab won the race. What to do:

- Reload or close every open tab of the mirror, then `pm2 restart magicmirror`.
- Check what the backend uses, not what the file says: in the browser,
  `MM.getModules().find(m => m.name === "MMM-Webuntis").configByStudent[<title>].plugins.<id>.config`.
- With Playwright, `page.goto()` to the same URL with only another `#hash` does **not** reload the
  page (same-document navigation); the page keeps its old config. Add a query string
  (`/?r=2#1`) or call `page.reload()`.

## Discovery And Loading

Backend discovery:
- scans direct children of `plugins/`
- reads and validates `manifest.json`
- resolves entry paths
- loads backend entrypoints during module initialization
- skips invalid plugins and surfaces warnings

Frontend loading:
- receives the backend-built plugin registry
- loads plugin CSS before first render
- loads plugin frontend scripts on demand from the registry
- creates one frontend plugin instance per active plugin

Plugins are sorted by `order`, then by `id`.

## Translations

Each plugin may ship its own translation files under `plugins/<pluginId>/translations/<lang>.json`.
These are separate from the module-level `translations/` folder registered via `getTranslations()`.

Load behavior (`MMM-Webuntis.js` → `_loadPluginTranslations`):

- files are fetched relative to the plugin root derived from `entry.frontend`
- load order is `en`, then the base language, then the full locale — for example
  `en` → `de` → `de-AT`
- later files shallow-merge over earlier ones, so `en.json` acts as the fallback layer
- a `404` is silently skipped; other failures and non-object payloads log a warning and are ignored
- results are cached per plugin ID for the module lifetime

Frontend plugins read them through `pluginContext.translate(key, fallback, replacements)`, which
returns `fallback` when the key is unknown. Keys are plugin-scoped, so two plugins may use the same
key without colliding.

File shape:

```json
{
  "homework": "Hausaufgaben",
  "no_homework": "keine Hausaufgaben"
}
```

## Capability Model

Current canonical capabilities:
- `lessons`
- `timeUnits`
- `exams`
- `homework`
- `absences`
- `messages`
- `holidays`
- `dayNotices`
- `studentContext`
- `runtimeState`
- `pluginDerivedData`

Capabilities drive fetch planning. Plugins do not define fetch flags directly.

Current mapping rules:
- timetable data comes from `lessons`
- time-grid data comes from `timeUnits`
- exams data comes from `exams`
- homework data comes from `homework`
- absences data comes from `absences`
- messages-of-day data comes from `messages`

## Frontend Host API

Canonical global:

```js
window.MMMWebuntisPluginHost
```

Frontend plugins must register themselves with:

```js
window.MMMWebuntisPluginHost.registerFrontendPlugin(definition)
```

Frontend definition shape:

```js
{
  id: 'lessons',
  hostApiVersion: 1,
  create(pluginContext) {
    return {
      render(renderContext) {
        return document.createElement('div');
      }
    };
  }
}
```

`pluginContext` provides:

| Field | Contents |
| --- | --- |
| `pluginId` | Plugin ID from the manifest |
| `hostApiVersion` | Host API version (currently `1`) |
| `manifest` | The plugin's registry entry |
| `translate(key, fallback, replacements)` | Plugin-scoped translation lookup, see [Translations](#translations) |
| `log(level, message, meta)` | Logger prefixed with `[plugin:<id>]` |
| `dom` | `el`, `createElement`, `iconSpan`, `multilineNodes`, `headerTitleNodes`, `richTextNodes`, `createContainer`, `addHeader`, `addRow`, `addFullRow` (see [Building markup](#building-markup)) |
| `time` | `getCurrentDateContext`, `currentTimeAsHHMM`, `toMinutesSinceMidnight`, `DEFAULT_TIMEZONE` |
| `formatting` | `formatDisplayDate`, `formatDisplayTime`, `formatYmd` |
| `shared` | The full `window.MMMWebuntisFrontendShared` object as an escape hatch |

The four namespaces are forwarded verbatim from `window.MMMWebuntisFrontendShared`, which owns the
grouping (`lib/frontendShared.js`). `shared.util` continues to expose every helper, including those
not surfaced in a namespace.

Always prefer `pluginContext.*` over reaching for the global directly. The first-party plugins still
use the global in places because these namespaces were empty placeholders until recently — that is
legacy, not the pattern to copy.

### Building markup

Plugins build their output as DOM nodes; there is no `innerHTML` anywhere in the frontend, and
`tests/frontend-dom.test.js` keeps it that way.

- `dom.el(tag, className, ...children)` creates an element. Children are nodes, strings or arrays
  of both; **a string is always text**, never parsed as HTML, so fetched values need no escaping
  (`escapeHtml` no longer exists). `null`, `undefined`, `false` and `""` are skipped.
- `dom.createElement`, `addHeader`, `addRow` and `addFullRow` take the same kind of content.
  `addRow` treats `""` as "no content" for its meta and data columns.
- `dom.iconSpan(className)` is a decorative, `aria-hidden` icon; `dom.multilineNodes(text)` splits
  a text at `\n` into text and `<br>`; `dom.headerTitleNodes(name, meta)` is the standard widget
  header "name (meta)".
- `dom.richTextNodes(html)` is the one exception, for fields the backend deliberately keeps as
  sanitized HTML (`messagesofday.text`, see `docs/API_REFERENCE.md`): it parses inert with
  `DOMParser` and rebuilds only the allowed formatting tags, without attributes.

```javascript
const { el, addRow } = pluginContext.dom;
addRow(container, "examRow", studentLabel, el("span", "wu-exam__date", date), [
  el("span", "wu-exam__name", exam.name),
  "\u00a0",
  el("span", "teacher-name", `(${teacher})`),
]);
```

Use `time.getCurrentDateContext(config)` rather than `new Date()`: it honours the `debugDate` config
option, which is what makes deterministic screenshots and fixture-based demo mode work.

`renderContext` provides:
- `identifier`
- `mode`
- `students` (each with `student`, `context.config`, `data.*`, `state.warnings`)
- `warnings`
- `runtime` (currently empty)

`students[].state.collections.<name>` carries `{ status, httpStatus, lastSuccessAt, stale }` per
collection (`lessons`, `exams`, `homework`, `absences`, `messages`): `status` is `ok`,
`unavailable` or `disabled` as reported by the backend, `stale` is `true` when the host kept older
data because the latest fetch failed. Use it to render "data unavailable" instead of an empty
state: `getEmptyDayState()` already does this for days without lessons, and the list plugins
render an `unavailable` row when their collection failed and nothing older is shown.

Not provided: `pluginConfig` (read it from `students[].context.config.plugins.<id>.config`),
`state.api` and `state.fetch`.

## Backend Host API

Backend plugins are loaded through `lib/pluginHostBackend.js` and export:

```js
module.exports = {
  id: 'lessons',
  hostApiVersion: 1,
  setup(context) {
    return {
      getDefaultConfig() {
        return { nextDays: 4 };
      },
      validateConfig(pluginConfig) {
        return [];
      },
      getCapabilities(pluginConfig, helpers) {
        return ['lessons'];
      }
    };
  }
};
```

`setup(context)` receives:
- `pluginId`
- `hostApiVersion`
- `manifest`
- `log(level, studentTitle, message)`
- `helpers`

Supported instance hooks are:

| Hook | Called by | Purpose |
| --- | --- | --- |
| `getDefaultConfig()` | `moduleConfig.getBackendPluginDefaultConfig()` | Defaults merged under the plugin's config namespace |
| `validateConfig(pluginConfig, ctx)` | `moduleConfig.collectPluginValidationIssues()` | Returns config issues as strings or `{ message, severity }` |
| `getCapabilities(pluginConfig, helpers)` | `pluginCapabilityResolver.collectCapabilities()` | Overrides the manifest's `capabilities` — use only for config-dependent capabilities |

All three are optional. When `getCapabilities()` is absent, the manifest's `capabilities` array is
used, which is what every first-party plugin relies on: a hook that just restates the manifest is
duplication, and the two declarations will drift.

Capability names outside the canonical list are dropped, so a hook cannot invent fetch flags.

## Runtime Boundaries

The plugin system is current production architecture. Demo mode uses it unchanged: the registry comes
from the backend host like in live operation, only the data is read from fixtures
(see [ARCHITECTURE.md](ARCHITECTURE.md#demo-mode)).

Plugin config validation is fully owned by the plugins: each backend implements `validateConfig()`
on top of the shared helpers in `lib/pluginValidationUtils.js`. `lib/widgetConfigValidator.js` only
covers student credentials, which belong to no single plugin.

These are current implementation details, not separate legacy documentation targets.