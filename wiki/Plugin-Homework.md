# Homework Plugin

The homework plugin shows homework entries with due date, subject, and description text.

## Enable The Plugin

Simple activation via `displayMode`:

```javascript
displayMode: 'homework'
```

Canonical activation via `plugins.homework`:

```javascript
plugins: {
  homework: {
    enabled: true,
    config: {
      nextDays: 28,
    },
  },
}
```

The old top-level namespace `homework: { ... }` is still accepted for compatibility, but `plugins.homework.config` is the canonical form.

## All Configuration Options

| Option | Type / Values | Default | Effect |
| --- | --- | --- | --- |
| `nextDays` | number `>= 0` | `28` | Future homework window in days |
| `pastDays` | number `>= 0` | `0` | Keeps recent homework visible for that many days |
| `dateFormat` | string | `EEE dd.MM.` | Date format for due dates |
| `showSubject` | boolean | `true` | Shows the homework subject label |
| `showText` | boolean | `true` | Shows the homework description text |

## Notes On Behavior

- Homework is sorted by due date and then by subject.
- If a student has no homework entries, the plugin renders a `no homework` placeholder row.
- `showText: false` is useful when you only want a compact reminder list.

## Typical Config

```javascript
plugins: {
  homework: {
    enabled: true,
    config: {
      nextDays: 14,
      pastDays: 2,
      dateFormat: 'EEE dd.MM.',
      showSubject: true,
      showText: false,
    },
  },
}
```