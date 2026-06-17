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
```

Allowed variations:
- `frontend.js` may point to a nested file such as `frontend/index.js`
- `backend.js` is optional
- `styles.css` is optional and may be a list of CSS files

All manifest entry paths must:
- be relative to the plugin root
- resolve inside the plugin root
- exist on disk

## Manifest

Every plugin is discovered through `manifest.json`.

Example:

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

Merge order for plugin config is:
1. inherited plugin config
2. legacy top-level namespace such as `lessons` or `grid`
3. explicit `plugins.<id>.config`

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
- `pluginId`
- `hostApiVersion`
- `manifest`
- `translate()`
- `log()`
- `dom`
- `time`
- `formatting`
- `shared`

`renderContext` provides:
- `moduleId`
- `mode`
- `pluginConfig`
- `students`
- `warnings`
- `runtime`

## Backend Host API

Backend plugins are loaded through `lib/pluginHostBackend.js` and export:

```js
module.exports = {
  id: 'lessons',
  hostApiVersion: 1,
  setup(context) {
    return {
      validateConfig(pluginConfig) {
        return [];
      },
      getCapabilities(pluginConfig, helpers) {
        return ['lessons'];
      },
      deriveStudentData(studentInput, helpers) {
        return null;
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
- `validateConfig(pluginConfig)`
- `getCapabilities(pluginConfig, helpers)`
- `deriveStudentData(...)`

## Runtime Boundaries

The plugin system is current production architecture, but two boundaries still matter:
- built-in fallback renderers still exist in `MMM-Webuntis.js`
- central widget validation still exists in `lib/widgetConfigValidator.js`

These are current implementation details, not separate legacy documentation targets.