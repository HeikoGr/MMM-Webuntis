# Plugin Widget API

Status:
- target specification
- complements [PLUGIN_WIDGET_CONTRACT.md](PLUGIN_WIDGET_CONTRACT.md)
- defines concrete manifest rules and host API shapes

Purpose of this document:
- make the plugin contract concrete enough for implementation
- define one host API version for frontend and backend plugin integration
- provide a normalized manifest schema and JS interface targets

Out of scope:
- exact loader implementation in MagicMirror
- transport contract details already owned by [API_V3_MANIFEST.md](API_V3_MANIFEST.md)

---

## 1. Versioning

This specification defines:

- plugin host API version: `1`
- required runtime contract version: `3`

Compatibility rules:

- host rejects plugins whose `compatibility.hostApiVersion` is not `1`
- host rejects plugins whose `compatibility.contractVersion` is not `3`
- future incompatible host API changes require a new host API version, not silent fallback behavior

---

## 2. Canonical Plugin Folder Model

Canonical plugin root:

```text
plugins/
  <pluginId>/
    manifest.json
    frontend.js
    backend.js
    styles.css
```

Permitted variation:

- `frontend.js` may be replaced by a nested path such as `frontend/index.js`
- `backend.js` may be omitted
- `styles.css` may be omitted or replaced by one or more nested CSS files

Path rules:

- every path in the manifest is relative to the plugin root
- absolute paths are invalid
- path traversal via `..` is invalid
- the host must normalize and verify that all resolved paths stay inside the plugin root

---

## 3. Manifest JSON Schema

Normative schema file:

- [docs/schemas/plugin-widget-manifest.schema.json](schemas/plugin-widget-manifest.schema.json)

Example manifest:

```json
{
  "$schema": "../docs/schemas/plugin-widget-manifest.schema.json",
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

### 3.1 Required manifest fields

- `id`
- `version`
- `title`
- `type`
- `entry.frontend`
- `capabilities`
- `compatibility.contractVersion`
- `compatibility.hostApiVersion`

### 3.2 Allowed values

- `type` must be `widget`
- `slots` currently allows only `main`
- `compatibility.contractVersion` must be `3`
- `compatibility.hostApiVersion` must be `1`

### 3.3 Manifest validation rules beyond JSON Schema

These checks stay host-owned even if the manifest passes JSON Schema:

- plugin folder name must equal `id`
- `id` must be unique across all discovered plugins
- every configured path must exist
- every path must resolve inside the plugin root
- every declared capability must be a known canonical capability
- aliases must not collide with another plugin ID

---

## 4. Canonical Capability Set

Host API version `1` defines this exact capability set:

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

Semantics:

- `studentContext` means the plugin needs `context.student`, `context.timezone`, `context.todayYmd`, and `context.range`
- `runtimeState` means the plugin needs warning and API/runtime status data under `state`
- `pluginDerivedData` means the plugin expects backend-derived data under `plugins.<pluginId>`

Mapping rules:

- the host maps canonical capabilities to fetch flags
- the host may maintain an internal capability-to-fetch lookup table
- plugins never see or define fetch flags directly

---

## 5. Frontend Registration API

Each frontend plugin entry must call the host registration API during initialization.

Canonical global:

```js
window.MMMWebuntisPluginHost
```

Required method:

```js
window.MMMWebuntisPluginHost.registerFrontendPlugin(pluginDefinition)
```

### 5.1 Frontend plugin definition

Target JS interface:

```js
/**
 * @typedef {Object} FrontendPluginDefinition
 * @property {string} id
 * @property {number} hostApiVersion
 * @property {(pluginContext: FrontendPluginContext) => FrontendPluginInstance} create
 */
```

Rules:

- `id` must match the manifest `id`
- `hostApiVersion` must be `1`
- `create` must return an object implementing the instance contract below

### 5.2 Frontend plugin context

Target JS interface:

```js
/**
 * @typedef {Object} FrontendPluginContext
 * @property {string} pluginId
 * @property {number} hostApiVersion
 * @property {Object} manifest
 * @property {(key: string, fallback?: string, replacements?: Object) => string} translate
 * @property {(level: 'error'|'warn'|'info'|'debug', message: string, meta?: any) => void} log
 * @property {Object} dom
 * @property {Object} time
 * @property {Object} formatting
 * @property {Object} shared
 */
```

Required helper groups:

- `dom`: generic DOM helpers only
- `time`: generic date/time helpers only
- `formatting`: text/date/time formatting helpers only
- `shared`: stable shared derivation helpers that are widget-agnostic

The host must not expose private module internals through this context.

### 5.3 Frontend plugin instance

Target JS interface:

```js
/**
 * @typedef {Object} FrontendPluginInstance
 * @property {(renderContext: FrontendRenderContext) => HTMLElement|DocumentFragment|null} render
 * @property {(renderContext: FrontendRenderContext) => void} [onDataUpdated]
 * @property {(state: { hidden: boolean }) => void} [onVisibilityChanged]
 * @property {() => void} [dispose]
 */
```

Required behavior:

- `render` must be side-effect safe and return one renderable subtree or `null`
- `render` must not send socket notifications
- `render` must not mutate host-owned state outside the documented API

### 5.4 Frontend render context

Target JS interface:

```js
/**
 * @typedef {Object} FrontendRenderContext
 * @property {string} moduleId
 * @property {'compact'|'verbose'} mode
 * @property {Object} pluginConfig
 * @property {Array<StudentRuntimeSlice>} students
 * @property {Array<Object>} warnings
 * @property {Object} runtime
 */
```

Student runtime slice:

```js
/**
 * @typedef {Object} StudentRuntimeSlice
 * @property {{id: number|string|null, title: string}} student
 * @property {Object} context
 * @property {Object} data
 * @property {Object} state
 * @property {Object} [plugins]
 */
```

Rules:

- `students[].data` follows the canonical V3 domain contract
- plugin-specific derived backend data, when present, lives under `students[].plugins[pluginId]`
- the plugin is responsible for sorting, grouping, filtering, empty states, and widget-specific headers

---

## 6. Backend Registration API

Each backend plugin entry is loaded during initialization only.

Loader rule:

- backend plugin modules are loaded once during module initialization
- there is no runtime hot-loading and no runtime unloading requirement

Canonical backend module export:

```js
module.exports = {
  id: 'lessons',
  hostApiVersion: 1,
  setup(pluginContext) {
    return {
      getDefaultConfig() {
        return {};
      },
      validateConfig(pluginConfig, helpers) {
        return [];
      },
      getCapabilities(pluginConfig, helpers) {
        return ['lessons', 'holidays', 'dayNotices', 'studentContext'];
      },
      deriveStudentData(studentBundle, helpers) {
        return null;
      }
    };
  }
};
```

### 6.1 Backend plugin definition

Target JS interface:

```js
/**
 * @typedef {Object} BackendPluginDefinition
 * @property {string} id
 * @property {number} hostApiVersion
 * @property {(pluginContext: BackendPluginContext) => BackendPluginInstance} setup
 */
```

### 6.2 Backend plugin context

Target JS interface:

```js
/**
 * @typedef {Object} BackendPluginContext
 * @property {string} pluginId
 * @property {number} hostApiVersion
 * @property {Object} manifest
 * @property {(level: 'error'|'warn'|'info'|'debug', studentTitle: string|null, message: string) => void} log
 * @property {Object} helpers
 */
```

### 6.3 Backend plugin instance

Target JS interface:

```js
/**
 * @typedef {Object} BackendPluginInstance
 * @property {() => Object} [getDefaultConfig]
 * @property {(pluginConfig: Object, helpers: Object) => Array<PluginValidationIssue>} [validateConfig]
 * @property {(pluginConfig: Object, helpers: Object) => Array<string>} [getCapabilities]
 * @property {(studentBundle: Object, helpers: Object) => Object|null} [deriveStudentData]
 */
```

Validation issue shape:

```js
/**
 * @typedef {Object} PluginValidationIssue
 * @property {string} message
 * @property {'warning'|'error'} severity
 * @property {'config'|'manifest'|'runtime'} kind
 * @property {string} pluginId
 */
```

Behavior rules:

- `getDefaultConfig` returns plugin-local defaults only
- `validateConfig` validates only plugin-local config
- `getCapabilities` may narrow or expand capability needs depending on plugin config
- `deriveStudentData` may only return plugin-local data that will be mounted under `plugins.<pluginId>`
- backend plugins must not perform direct auth or API calls

---

## 7. Resolved Config Model

The canonical resolved config target is:

```json
{
  "plugins": {
    "lessons": {
      "enabled": true,
      "config": {
        "nextDays": 4,
        "pastDays": 0
      }
    }
  },
  "students": [
    {
      "title": "Student A",
      "plugins": {
        "lessons": {
          "config": {
            "nextDays": 2
          }
        }
      }
    }
  ]
}
```

Resolution order:

1. host global defaults
2. backend plugin `getDefaultConfig()`
3. module-level `plugins.<id>.config`
4. student-level `students[].plugins.<id>.config`

Rules:

- legacy top-level widget namespaces are compatibility input only
- all runtime logic after normalization should use the canonical plugin config structure

---

## 8. Error And Isolation Rules

Frontend plugin load failure:

- plugin is marked unavailable
- host logs a plugin-scoped warning
- other plugins still initialize

Backend plugin load failure:

- plugin is marked unavailable
- its config may still be reported as ignored
- other plugins still initialize

Plugin render failure:

- host catches the error
- host renders a generic plugin error box
- failure is scoped to that plugin instance

Plugin validation failure:

- `warning` issues do not disable the plugin automatically
- `error` issues disable that plugin for the current module instance unless the host explicitly decides otherwise

---

## 9. Initialization Sequence

Because runtime hot-loading is out of scope, the initialization sequence is strict:

1. backend discovers plugin folders
2. backend validates manifests
3. backend loads backend plugin modules
4. backend normalizes config and computes active plugin set
5. backend computes the union of active plugin capabilities
6. backend emits registry metadata needed by the frontend
7. frontend loads plugin scripts and CSS
8. frontend waits for all required plugin registrations or deterministic failures
9. frontend performs first render

This sequence is normative for host API version `1`.

---

## 10. Recommended File Targets

The following file targets are recommended for implementation:

- backend discovery: `lib/pluginLoader.js`
- backend schema validation: `lib/pluginManifestValidator.js`
- backend capability mapping: `lib/pluginCapabilityResolver.js`
- frontend host API: `lib/pluginHostFrontend.js`
- backend host API: `lib/pluginHostBackend.js`

These names are recommendations, not hard requirements, but the split of responsibilities should remain comparable.
