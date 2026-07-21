# Exams Plugin

The exams plugin lists upcoming exams in chronological order.

## Enable The Plugin

Simple activation via `displayMode`:

```javascript
displayMode: 'exams'
```

Canonical activation via `plugins.exams`:

```javascript
plugins: {
  exams: {
    enabled: true,
    config: {
      nextDays: 21,
    },
  },
}
```

The old top-level namespace `exams: { ... }` is still accepted for compatibility, but `plugins.exams.config` is the canonical form.

## All Configuration Options

| Option | Type / Values | Default | Effect |
| --- | --- | --- | --- |
| `nextDays` | number `>= 0` | `21` | Future exam window in days |
| `pastDays` | number `>= 0` | none by default | Optional past exam window for filtering and compatibility |
| `dateFormat` | string | `EEE dd.MM.` | Date format for the exam date column |
| `showSubject` | boolean | `true` | Prepends the subject before the exam title |
| `showTeacher` | boolean | `true` | Appends the primary teacher in brackets |

## Notes On Behavior

- Exams are sorted by date and start time.
- In normal operation, past exams are hidden. With `logLevel: 'debug'`, old exams remain visible for troubleshooting.
- If `nextDays` is `0`, the plugin skips rendering.
- `pastDays` is supported by validation and compatibility mappings even though the built-in defaults do not set it explicitly.

## Typical Config

```javascript
plugins: {
  exams: {
    enabled: true,
    config: {
      nextDays: 30,
      dateFormat: 'EEEE dd.MM.',
      showSubject: true,
      showTeacher: false,
    },
  },
}
```