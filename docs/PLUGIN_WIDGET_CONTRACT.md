# Plugin Widget Contract

Status:
- architecture target
- not implemented yet
- defines the intended plugin contract for widget packages that can be added without changing the host module

Scope of this document:
- define the target contract for frontend and backend widget plugins
- define file layout, manifest shape, lifecycle hooks, and capability declarations
- define which responsibilities stay in the host and which move into plugins
- provide a migration target for the current built-in widgets

Out of scope:
- exact implementation details for dynamic file loading in MagicMirror
- external WebUntis API details
- CSS design rules for individual widgets
- historical compatibility behavior beyond the migration guidance below

For the current module architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).
For the canonical runtime payload, see [API_V3_MANIFEST.md](API_V3_MANIFEST.md).

---

## 1. Purpose

The current module already keeps much widget-specific rendering logic in `widgets/*.js`, but the host still knows each widget explicitly in several places:

- script loading
- displayMode parsing and validation
- frontend renderer selection
- backend fetch-flag decisions
- widget-specific config validation
- translation naming and empty-state behavior

That coupling means a new widget still requires host-module edits.

The target architecture changes this:

- a widget becomes a plugin package
- the plugin declares its own frontend, backend, CSS, config, and capability needs
- the host discovers and mounts plugins generically
- the backend fetches data from declared capabilities, not from hardcoded widget names
- plugins are loaded during module initialization, not hot-loaded during runtime
- adding a new widget should require only a drop-in plugin folder plus optional config activation

---

## 2. Design Goals

Required goals:

- plugins are independent units with their own frontend, backend, and CSS files
- the host module does not need code changes for a newly added plugin
- plugins consume the canonical widget-agnostic V3 runtime contract
- plugins may declare additional derived data needs without changing the base contract
- backend behavior depends on declared capabilities, not on a hardcoded widget list
- plugin config defaults and validation live with the plugin
- plugin rendering logic, filtering, sorting, grouping, and empty states live with the plugin

Non-goals:

- plugins do not call WebUntis directly
- plugins do not own authentication
- plugins do not change the global session lifecycle
- plugins do not define transport contracts outside the host-controlled runtime contract
- plugins do not inject arbitrary socket protocols between frontend and backend
- plugins do not need to be loadable or unloadable during running operation

---

## 3. Core Principles

### 3.1 Host owns platform concerns

The host remains responsible for:

- MagicMirror lifecycle
- socket notifications
- session identity and visibility state
- config normalization at module root level
- canonical backend fetch orchestration
- V3 runtime payload generation
- plugin discovery, registration, and isolation

### 3.2 Plugins own widget concerns

A plugin owns:

- widget presentation
- widget-specific frontend derivation from V3 data
- widget-specific config defaults
- widget-specific config validation
- widget-specific CSS
- widget-specific backend helpers that derive extra plugin data from the canonical bundle when needed

### 3.3 Capabilities replace hardcoded widget names

The backend must not ask whether `grid` or `lessons` is enabled.
Instead, each plugin declares capabilities such as:

- `lessons`
- `timeUnits`
- `exams`
- `homework`
- `absences`
- `messages`
- `holidays`
- `dayNotices`

The host unions all capability declarations of active plugins and derives fetch flags from that union.

### 3.4 Canonical data stays shared

Plugins consume the same V3 contract documented in [API_V3_MANIFEST.md](API_V3_MANIFEST.md).
They may derive local view models, but those view models are plugin-internal and not part of the transport contract.

---

## 4. Target Plugin Package Layout

Each plugin lives in its own folder.

Recommended layout:

```text
plugins/
  lessons/
    manifest.json
    frontend.js
    backend.js
    styles.css
    README.md
    translations/
      en.json
      de.json
```

Rules:

- `manifest.json` is required
- `frontend.js` is required for renderable widgets
- `backend.js` is optional only when the plugin has no backend derivation or validation needs
- `styles.css` is optional but expected for most widgets
- plugin-local translations are optional
- plugin folders must be self-contained and must not require host edits after being copied into `plugins/`

Alternative structure for more complex plugins:

```text
plugins/
  grid/
    manifest.json
    frontend/
      index.js
      dom.js
      helpers.js
    backend/
      index.js
      derive.js
      validate.js
    styles/
      index.css
    translations/
      en.json
      de.json
```

The manifest must define the entry files so the internal folder structure remains a plugin concern.

---

## 5. Manifest Contract

Every plugin must provide a manifest.

Example:

```json
{
  "id": "lessons",
  "version": "1.0.0",
  "title": "Lessons",
  "entry": {
    "frontend": "frontend.js",
    "backend": "backend.js",
    "styles": ["styles.css"]
  },
  "slots": ["main"],
  "order": 200,
  "capabilities": ["lessons", "holidays", "dayNotices"],
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

- `id`: canonical plugin identifier
- `version`: plugin version
- `title`: human-readable title
- `entry.frontend`: frontend entry path
- `capabilities`: list of canonical data capabilities
- `compatibility.contractVersion`: required V3 contract version
- `compatibility.hostApiVersion`: required host plugin API version

Recommended fields:

- `entry.backend`
- `entry.styles`
- `configNamespace`
- `order`
- `slots`
- `activation`

Rules:

- `id` must be unique across all discovered plugins
- `configNamespace` defaults to `id` when omitted
- `capabilities` must only use host-known canonical capability names
- `displayAliases` may exist for migration but must not redefine canonical plugin IDs

---

## 6. Host Discovery Contract

The host scans the `plugins/` directory on startup and builds a plugin registry.

Discovery rules:

- every direct child folder under `plugins/` is a plugin candidate
- a candidate is valid only when `manifest.json` exists and passes schema validation
- invalid plugins are skipped and surfaced as module warnings
- plugins are sorted by `order`, then by `id`

The registry result contains:

- manifest metadata
- resolved file paths
- backend registration hooks
- frontend registration hooks
- declared config namespace
- declared capability set

The host must not contain a hardcoded list of widget IDs.

Initialization rule:

- plugin discovery happens only during module initialization
- plugin frontend scripts and CSS are loaded before first render
- runtime hot-loading is explicitly out of scope
- adding, removing, or changing plugin files requires a module restart or MagicMirror restart

---

## 7. Activation Model

Plugin discovery and plugin activation are separate.

Discovery:
- plugin exists on disk and loads successfully

Activation:
- plugin is enabled by config for the current module instance

Recommended activation config:

```json
{
  "plugins": {
    "lessons": {
      "enabled": true
    },
    "exams": {
      "enabled": true
    },
    "attendance-summary": {
      "enabled": false
    }
  }
}
```

Rules:

- `plugins.<id>.enabled` is the canonical activation flag
- legacy `displayMode` may still be supported during migration, but only as an adapter into plugin activation
- a plugin may be discovered but inactive
- inactive plugins contribute no rendering and no capabilities

Migration rule:

- current built-in names like `grid`, `lessons`, `exams`, `homework`, `absences`, `messagesofday`, and `list` should be translated once into plugin activation at config normalization time
- all later stages should operate only on active plugin IDs

---

## 8. Capability Contract

Capabilities describe canonical data dependencies.

Initial canonical capability set:

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

Capability semantics:

- `lessons`: needs `data.lessons`
- `timeUnits`: needs `data.timeUnits`
- `exams`: needs `data.exams`
- `homework`: needs `data.homework`
- `absences`: needs `data.absences`
- `messages`: needs `data.messages`
- `holidays`: needs `data.holidays`
- `dayNotices`: needs `data.dayNotices`
- `studentContext`: needs `context.student`, `context.timezone`, `context.todayYmd`, and `context.range`
- `runtimeState`: needs `state`

Backend rule:

- fetch flags are derived from the union of active plugin capabilities
- capability-to-fetch mapping is host-owned and centralized
- plugins may not directly modify fetch orchestration

Initial host mapping example:

| Capability | Backend fetch effect |
| --- | --- |
| `lessons` | fetch timetable |
| `timeUnits` | fetch timegrid |
| `exams` | fetch exams |
| `homework` | fetch homework |
| `absences` | fetch absences |
| `messages` | fetch messages of day |
| `holidays` | no extra fetch, derived from timetable bundle when available |
| `dayNotices` | no direct extra fetch |

---

## 9. Frontend Plugin API

The host provides a stable frontend plugin API.

Example registration shape:

```js
registerFrontendPlugin({
  manifest,
  create(pluginContext) {
    return {
      render(renderContext) {},
      onDataUpdated(renderContext) {},
      dispose() {},
    };
  },
});
```

Required frontend behavior:

- a plugin must export a registration function or registration object
- rendering must happen through the host-provided API and context
- plugins must not query host internals directly outside the documented API

### 9.1 `pluginContext`

Stable frontend context should provide:

- `pluginId`
- `manifest`
- `hostApiVersion`
- `translate(key, fallback)`
- `log(level, ...args)`
- `dom` helpers
- `time` helpers
- `config` accessors
- `shared` helper access to stable frontend derivations

### 9.2 `renderContext`

Each render call should receive:

- `moduleId`
- `studentEntries`
- `runtime`
- `warnings`
- `createContainer()` helper
- `createHeader()` helper
- `appendWarning()` helper

`studentEntries[]` should contain canonical per-student runtime slices:

```json
{
  "student": { "id": 1001, "title": "Student A" },
  "config": {},
  "context": {},
  "data": {},
  "state": {}
}
```

Frontend rule:

- the host gives the plugin the full canonical slice it is allowed to use
- the plugin decides filtering, grouping, headers, and empty states itself
- the host must not contain plugin-specific row renderers

### 9.3 Frontend lifecycle hooks

Recommended hooks:

- `render(renderContext)`
- `onDataUpdated(renderContext)`
- `onVisibilityChanged({ hidden })`
- `dispose()`

Optional time-based hooks such as the current grid minute updater should be moved behind generic host lifecycle hooks, not left as hardcoded calls to one plugin ID.

---

## 10. Backend Plugin API

Some plugins need backend-side logic, but that logic must stay within a constrained host contract.

Example registration shape:

```js
registerBackendPlugin({
  manifest,
  setup(pluginContext) {
    return {
      getCapabilities() {
        return manifest.capabilities;
      },
      getDefaultConfig() {
        return {};
      },
      validateConfig(config, helpers) {
        return [];
      },
      deriveStudentData(bundle, helpers) {
        return {};
      },
    };
  },
});
```

Allowed backend responsibilities:

- plugin-local config defaults
- plugin-local config validation
- plugin-local derived data from the canonical fetched bundle
- plugin-local warning generation

Forbidden backend responsibilities:

- auth handling
- direct REST or JSON-RPC orchestration
- session lifecycle ownership
- independent socket protocols
- rewriting the canonical V3 contract structure

### 10.1 Backend derivation output

If a plugin needs backend-derived helper data, that data should live in a dedicated plugin namespace inside the per-student payload context, for example:

```json
{
  "plugins": {
    "attendance-summary": {
      "totals": {
        "excused": 3,
        "unexcused": 1
      }
    }
  }
}
```

Rules:

- plugin-derived payload additions must stay under `plugins.<pluginId>`
- canonical shared domain data remains under top-level `data`
- the host payload builder owns final assembly and validation

---

## 11. CSS Contract

Each plugin may ship its own CSS files.

Rules:

- plugin CSS is loaded only when the plugin is discovered
- plugin CSS must be namespaced with a plugin root class, for example `.wu-plugin-lessons`
- plugin CSS must not style host internals by element selectors alone
- global CSS variables may be consumed, but plugin-local class names must remain plugin-owned

Recommended root DOM shape:

```html
<section class="wu-plugin wu-plugin-lessons">
  ...
</section>
```

The host should also keep a small stable CSS contract:

- shared typography variables
- shared spacing variables
- shared warning and empty-state utility classes
- shared visually-hidden accessibility helpers

---

## 12. Translation Contract

Plugins may ship local translations.

Rules:

- plugin translation keys are namespaced, for example `plugin.lessons.empty` or `plugin.attendance-summary.title`
- the host merges plugin translations into the runtime translation lookup
- plugin titles and empty states should not require edits to the host translation files

Fallback rules:

- if a plugin key is missing, the plugin must provide a readable fallback string
- the host should log a debug warning, not fail rendering

---

## 13. Config Contract

Each plugin owns its namespaced configuration.

Canonical config shape:

```json
{
  "plugins": {
    "lessons": {
      "enabled": true,
      "config": {
        "nextDays": 4,
        "pastDays": 0,
        "showRoom": false
      }
    }
  }
}
```

Rules:

- host-level config stays at module root
- plugin config lives under `plugins.<id>.config`
- plugin defaults come from the plugin backend registration, not from a host hardcoded widget list
- plugin validators return warnings or errors in a host-defined normalized format

Migration note:

- existing top-level namespaces such as `lessons`, `grid`, `exams`, `homework`, `absences`, and `messagesofday` may be mapped into `plugins.<id>.config` during normalization
- that mapping should happen once in the config adapter layer and nowhere else

---

## 14. Validation Contract

Validation is split into two layers.

### 14.1 Host validation

Host validation covers:

- module-level config
- plugin activation config shape
- manifest schema
- capability names
- plugin API compatibility

### 14.2 Plugin validation

Plugin validation covers:

- plugin-local config shape
- plugin-specific numeric ranges and constraints
- plugin-specific incompatibility warnings

Validation result format should be normalized:

```json
{
  "message": "lessons.nextDays is very large (30)",
  "severity": "warning",
  "kind": "config",
  "pluginId": "lessons"
}
```

---

## 15. Rendering Contract

The host should not keep per-plugin render wrappers like `renderLessonsForStudent` or `renderExamsForStudent`.

Target behavior:

1. host resolves active plugins
2. host builds canonical per-student runtime slices
3. host calls each plugin with the same generic render contract
4. plugin returns a DOM subtree or appends to a host container
5. host mounts the result in configured order

Required return behavior:

- plugin render returns either a DOM element, a document fragment, or `null`
- `null` means nothing should be shown
- plugin errors are caught by the host and rendered through a generic plugin error state

---

## 16. Error Isolation Contract

Plugins must fail independently.

Rules:

- one broken plugin must not prevent other plugins from rendering
- manifest load failures become warnings and disable only that plugin
- backend derivation failures become plugin-scoped warnings where possible
- frontend render failures become plugin-scoped error boxes

The host should track errors by `pluginId`.

---

## 17. Security And Boundary Rules

Plugins run in-process and therefore are trusted code from the module owner's perspective.
Even so, the host must keep boundaries explicit.

Rules:

- plugins do not receive raw credentials
- plugins do not receive auth tokens
- plugins do not perform direct WebUntis network calls
- plugins only receive canonical runtime data and host-provided helpers
- plugin backend derivation runs after canonical fetch/auth orchestration, not during it

---

## 18. Migration Strategy

Recommended migration order:

### Phase 1: Registry without behavior change

- introduce plugin discovery and manifest loading
- wrap current built-in widgets as first-party plugins
- keep current V3 payload and current fetch behavior intact behind an adapter

### Phase 2: Activation normalization

- normalize `displayMode` into `plugins.<id>.enabled`
- keep legacy `displayMode` only as input compatibility
- switch frontend rendering to active plugin IDs only

### Phase 3: Capability-based backend decisions

- replace hardcoded widget-name checks with capability unions
- derive fetch flags from active plugin capabilities

### Phase 4: Plugin-owned config and validation

- migrate built-in widget defaults and validators into plugin packages
- reduce host widget-specific validation to zero

### Phase 5: Remove legacy host wrappers

- remove per-widget render methods from the host
- remove host hardcoded script maps and widget lists

---

## 19. Recommended First-Party Plugin Mapping

Built-in widgets should become first-party plugins with these initial capabilities:

| Plugin | Capabilities |
| --- | --- |
| `grid` | `lessons`, `timeUnits`, `absences`, `holidays`, `dayNotices`, `studentContext`, `runtimeState` |
| `lessons` | `lessons`, `holidays`, `dayNotices`, `studentContext` |
| `exams` | `exams`, `studentContext` |
| `homework` | `homework`, `studentContext` |
| `absences` | `absences`, `studentContext`, `runtimeState` |
| `messagesofday` | `messages`, `studentContext` |

The legacy `list` mode is not a plugin. It is only a compatibility alias that enables `lessons` and `exams` together.

---

## 20. Target Host Surface After Migration

After migration, the host should know only these plugin concepts:

- discovery
- registration
- activation
- capability union
- config merge
- validation routing
- generic render lifecycle
- plugin CSS loading
- plugin translation loading
- plugin error isolation

The host should not know:

- how lessons are grouped
- how exam rows are sorted
- how grid cells are built
- how empty states are phrased
- which plugin-specific config keys exist

That is the core success criterion for plugin independence.

---

## 21. Decision Summary

This target contract intentionally chooses:

- plugin folders instead of single loose JS files
- one required manifest per plugin
- frontend and backend entries per plugin
- plugin-local CSS and optional translations
- plugin loading only during initialization, with no runtime hot-loading requirement
- capability-driven backend fetch decisions
- plugin-owned config defaults and validation
- shared canonical V3 runtime data as the only transport baseline

This is the smallest architecture that makes "drop in a new widget plugin without changing the module" technically credible.

---

## 22. Next Technical Specs

The concrete follow-up specifications for this contract are documented here:

- [PLUGIN_WIDGET_API.md](PLUGIN_WIDGET_API.md)
- [PLUGIN_WIDGET_MIGRATION_PLAN.md](PLUGIN_WIDGET_MIGRATION_PLAN.md)
