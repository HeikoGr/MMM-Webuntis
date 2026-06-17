# Plugin Widget Migration Plan

Status:
- implementation planning document
- assumes the target architecture from [PLUGIN_WIDGET_CONTRACT.md](PLUGIN_WIDGET_CONTRACT.md)
- aligned with the concrete API target in [PLUGIN_WIDGET_API.md](PLUGIN_WIDGET_API.md)

Purpose of this document:
- break the migration into safe phases
- identify the main file changes per phase
- reduce regression risk while moving from hardcoded widgets to plugins

---

## 1. Migration Objective

End state:

- widgets are plugin packages loaded during module initialization
- host no longer contains hardcoded widget render maps or widget-name-based fetch planning
- new plugins can be added without changing host code
- current built-in widgets continue to work throughout the migration

Constraints:

- no runtime hot-loading required
- V3 runtime contract remains canonical
- backend auth and orchestration stay host-owned

---

## 2. Phase Overview

Recommended phases:

1. Introduce plugin infrastructure without behavior change
2. Normalize activation and config model
3. Move fetch planning to capabilities
4. Move rendering ownership into plugins
5. Migrate defaults and validation into plugins
6. Remove legacy host widget wiring

Each phase should be mergeable and testable on its own.

---

## 3. Phase 1: Plugin Infrastructure Without Behavior Change

Goal:

- add discovery, manifest loading, and plugin registration while keeping current widget behavior intact

Main work:

- add plugin folder root, for example `plugins/`
- add manifest schema validation
- add backend plugin loader
- add frontend plugin host registry
- wrap current built-in widgets as first-party plugins
- keep current host render methods and fetch planning as the source of truth temporarily

Primary file targets:

- [MMM-Webuntis.js](MMM-Webuntis.js)
- [node_helper.js](node_helper.js)
- new [docs/PLUGIN_WIDGET_API.md](docs/PLUGIN_WIDGET_API.md)
- new `lib/pluginLoader.js`
- new `lib/pluginManifestValidator.js`
- new `lib/pluginHostFrontend.js`
- new `lib/pluginHostBackend.js`
- new `plugins/grid/manifest.json`
- new `plugins/lessons/manifest.json`
- new `plugins/exams/manifest.json`
- new `plugins/homework/manifest.json`
- new `plugins/absences/manifest.json`
- new `plugins/messagesofday/manifest.json`

Acceptance criteria:

- host can discover first-party plugins on startup
- invalid manifests are surfaced as warnings
- existing widgets still render exactly as before
- no fetch behavior changes yet

Main risk:

- loader complexity introduced before any user-visible benefit

Mitigation:

- keep first phase behaviorally neutral
- avoid moving widget logic yet

---

## 4. Phase 2: Activation And Config Normalization

Goal:

- replace implicit `displayMode` semantics with canonical plugin activation and config namespaces

Main work:

- introduce canonical `plugins.<id>.enabled`
- introduce canonical `plugins.<id>.config`
- introduce student-level `students[].plugins.<id>.config`
- map legacy `displayMode` and top-level widget config into canonical plugin config once during normalization
- ensure frontend and backend runtime paths use normalized plugin activation only

Primary file targets:

- [MMM-Webuntis.js](MMM-Webuntis.js)
- [node_helper.js](node_helper.js)
- [lib/configValidator.js](lib/configValidator.js)
- [config/config.template.js](config/config.template.js)
- [README.md](README.md)
- [docs/CONFIG.md](docs/CONFIG.md)

Acceptance criteria:

- both legacy and canonical config inputs work
- runtime logic internally uses only canonical plugin activation
- plugin ordering is deterministic and explicit

Main risk:

- config drift between legacy and canonical models

Mitigation:

- perform normalization in one place only
- add focused config tests for normalization

---

## 5. Phase 3: Capability-Based Fetch Planning

Goal:

- remove widget-name-specific fetch decisions from the backend

Main work:

- replace `_wantsWidget` driven fetch planning with capability union planning
- let active plugins contribute capabilities through backend definitions
- centralize capability-to-fetch mapping in one host helper
- keep canonical payload generation unchanged

Primary file targets:

- [node_helper.js](node_helper.js)
- [lib/webuntisClient.js](lib/webuntisClient.js)
- new `lib/pluginCapabilityResolver.js`
- [docs/SERVER_REQUEST_FLOW.md](docs/SERVER_REQUEST_FLOW.md)

Acceptance criteria:

- active plugin set fully determines fetch flags
- adding a new plugin with known capabilities requires no backend host edits
- canonical V3 payload shape remains unchanged

Main risk:

- accidental under-fetching or over-fetching during transition

Mitigation:

- keep a compatibility test matrix for current built-in widgets
- compare old and new fetch flags for the same configs during transition

---

## 6. Phase 4: Rendering Ownership Moves Into Plugins

Goal:

- remove per-widget rendering orchestration from the host frontend

Main work:

- introduce a generic frontend render lifecycle for plugins
- let plugins receive canonical student runtime slices
- move row assembly, empty states, sorting, grouping, and widget headers into plugin frontend code
- keep generic host warning and error rendering only

Primary file targets:

- [MMM-Webuntis.js](MMM-Webuntis.js)
- [widgets/util.js](widgets/util.js)
- [widgets/grid.js](widgets/grid.js)
- [widgets/lessons.js](widgets/lessons.js)
- [widgets/exams.js](widgets/exams.js)
- [widgets/homework.js](widgets/homework.js)
- [widgets/absences.js](widgets/absences.js)
- [widgets/messagesofday.js](widgets/messagesofday.js)
- new plugin frontend entry files under `plugins/*`

Acceptance criteria:

- host no longer has a per-widget renderer map
- host no longer calls per-widget render wrapper methods
- plugins render themselves through the generic API

Main risk:

- large frontend diff surface

Mitigation:

- migrate one first-party plugin end-to-end first, preferably `exams` or `messagesofday`
- reuse old widget code inside the plugin wrapper initially

---

## 7. Phase 5: Defaults And Validation Move Into Plugins

Goal:

- eliminate central widget-specific defaults and validation logic

Main work:

- move widget defaults out of host defaults into backend plugin definitions
- move widget validation out of `lib/widgetConfigValidator.js`
- keep host validation only for module-global concerns and plugin platform concerns

Primary file targets:

- [MMM-Webuntis.js](MMM-Webuntis.js)
- [lib/widgetConfigValidator.js](lib/widgetConfigValidator.js)
- plugin backend files under `plugins/*`
- [config/config.template.js](config/config.template.js)
- [docs/CONFIG.md](docs/CONFIG.md)

Acceptance criteria:

- built-in plugins fully own their defaults and validators
- host has no hardcoded widget validation rules left

Main risk:

- duplicated defaults during migration

Mitigation:

- explicitly deprecate and remove legacy defaults per plugin once migrated

---

## 8. Phase 6: Legacy Cleanup

Goal:

- remove the remaining hardcoded widget wiring from the host

Main work:

- remove widget script maps from the frontend host
- remove widget name whitelists and alias maps except the legacy config adapter
- remove widget-name-specific render methods
- remove widget-name-specific fetch helpers
- remove obsolete widget utility coupling that exists only for the pre-plugin host model

Primary file targets:

- [MMM-Webuntis.js](MMM-Webuntis.js)
- [node_helper.js](node_helper.js)
- [widgets/util.js](widgets/util.js)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

Acceptance criteria:

- host no longer contains built-in widget IDs in control-flow code
- first-party widgets exist only as plugins
- new plugin addition requires no host modification

---

## 9. Suggested Migration Order For Built-In Widgets

Recommended order:

1. `messagesofday`
2. `exams`
3. `homework`
4. `absences`
5. `lessons`
6. `grid`

Reasoning:

- `messagesofday` is the smallest rendering surface
- `exams` and `homework` are list-like and lower risk
- `absences` adds warning-state concerns
- `lessons` has richer derivation logic
- `grid` is the most coupled widget because of live time updates and layout complexity

---

## 10. Recommended Tests Per Phase

Phase 1:

- manifest validation tests
- plugin discovery tests
- duplicate plugin ID tests

Phase 2:

- config normalization tests
- legacy `displayMode` mapping tests
- student-level plugin override tests

Phase 3:

- capability union tests
- fetch-flag mapping tests
- parity tests against current built-in widget configs

Phase 4:

- plugin render smoke tests
- frontend error isolation tests
- first render waits for plugin registration tests

Phase 5:

- plugin default merge tests
- plugin validation output tests

Phase 6:

- regression tests for built-in plugin equivalence
- architecture cleanup review

---

## 11. Concrete Technical Cut Points

The cleanest cut points in the current codebase are:

- current hardcoded frontend widget loading in [MMM-Webuntis.js](MMM-Webuntis.js)
- current frontend renderer map in [MMM-Webuntis.js](MMM-Webuntis.js)
- current widget helper contract in [widgets/util.js](widgets/util.js)
- current widget-specific validation in [lib/widgetConfigValidator.js](lib/widgetConfigValidator.js)
- current backend widget-name-based fetch planning in [node_helper.js](node_helper.js)

These are the main seams to replace.

---

## 12. First Implementation Recommendation

The best first implementation slice is:

1. build manifest validation and backend discovery
2. convert `messagesofday` into the first first-party plugin
3. keep legacy render wrappers temporarily
4. add canonical plugin activation config

Why this slice:

- it validates the architecture with minimal risk
- it touches both frontend and backend plugin plumbing
- it avoids the grid complexity too early

---

## 13. Definition Of Completion

The migration is complete only when all of the following are true:

- all built-in widgets are first-party plugins
- host fetch planning is capability-driven
- host rendering is generic and plugin-driven
- widget-specific defaults and validation live in plugins
- plugin assets load only during initialization and before first render
- adding a new plugin folder plus config is sufficient to extend the module
