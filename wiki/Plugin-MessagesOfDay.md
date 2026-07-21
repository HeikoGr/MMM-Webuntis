# Messages Of Day Plugin

The messages of day plugin shows WebUntis message cards for each student.

## Enable The Plugin

Simple activation via `displayMode`:

```javascript
displayMode: 'messagesofday'
```

Canonical activation via `plugins.messagesofday`:

```javascript
plugins: {
  messagesofday: {
    enabled: true,
    config: {},
  },
}
```

The old top-level namespace `messagesofday: { ... }` is still accepted for compatibility, but `plugins.messagesofday.config` is the canonical form.

## All Configuration Options

This plugin currently has no plugin-specific configuration options.

Use the module-level options instead when needed:

- `displayMode` or `plugins.messagesofday.enabled` to activate it
- `mode` to influence how student sections are grouped in the surrounding module output
- CSS customization if you want to change the card layout or styling

## Notes On Behavior

- If at least one student has messages, the plugin renders one message section per student.
- If no messages exist at all, the plugin still renders an empty state with `No messages`.
- Message text is rendered from the sanitized backend payload, so formatting depends on the data already prepared by the module.

## Typical Config

```javascript
plugins: {
  messagesofday: {
    enabled: true,
    config: {},
  },
}
```