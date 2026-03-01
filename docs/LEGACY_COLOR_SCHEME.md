# Legacy Color Scheme (Exact Values)

This guide uses the **exact** historical color values from commit `5fdd1bb` (no approximations).

Goal: recreate the previous multi-color look via `config/custom.css` on current MMM-Webuntis versions.

## Quick Use

1. Copy `config/custom.template.css` to `config/custom.css` (if not already done).
2. Paste the override block below into `config/custom.css`.
3. Restart MagicMirror.

## Exact Legacy Token Overrides (from commit `5fdd1bb`)

```css
.MMM-Webuntis {
  /* Base palette */
  --wu-bg: rgba(0, 0, 0, 0.05);
  --wu-time-color: #666;

  /* Lesson states */
  --wu-replacement-bg: #bfe6ff;
  --wu-replacement-text: #032f56;
  --wu-cancelled-bg: #ffbdbd;
  --wu-cancelled-text: #7a0000;
  --wu-regular-bg: #c9ffbf;
  --wu-regular-text: #0f6b0f;
  --wu-lesson-border: #9fd39f;

  /* Additional legacy tokens */
  --wu-homework-bg: #e9e9e9;
  --wu-no-lesson-bg: #642463;
  --wu-exam-bar: #ffeb3b;

  /* Text accents used in old styles */
  --wu-substitution-generic: #ffa500;
  --wu-substitution-accent: #ffa500;
  --wu-legacy-exam-row-color: rgb(0, 255, 255);

  /* Today variants (old .is-today overrides) */
  --wu-today-replacement-bg: #82c6f0;
  --wu-today-replacement-text: #01242f;
  --wu-today-cancelled-bg: #ff8a8a;
  --wu-today-cancelled-text: #590000;
  --wu-today-regular-bg: #a8f59f;
  --wu-today-regular-text: #054a05;
  --wu-today-lesson-border: #cfcfcf;

  /* Overlays and now-line */
  --wu-absence-overlay-bg: rgba(255, 100, 100, 0.5);
  --wu-absence-overlay-border: rgba(255, 100, 100, 0.8);
  --wu-absence-overlay-today-bg: rgba(255, 80, 80, 0.6);
  --wu-absence-overlay-today-border: rgba(255, 80, 80, 0.9);
  --wu-nowline-start: rgba(255, 0, 0, 0.95);
  --wu-nowline-end: rgba(255, 0, 0, 0.85);
  --wu-nowline-glow: rgba(255, 0, 0, 0.45);

  /* Warning / critical / error tones from old CSS */
  --wu-warning-color: #ff9800;
  --wu-warning-bg-soft: rgba(255, 152, 0, 0.06);
  --wu-warning-bg-strong: rgba(255, 152, 0, 0.1);
  --wu-critical-color: #f44336;
  --wu-critical-bg: rgba(244, 67, 54, 0.15);
  --wu-error-bg: #ffebee;
  --wu-error-border: #d32f2f;
  --wu-error-text: #b71c1c;

  /* Secondary text tones from old CSS */
  --wu-secondary-text: #888;
  --wu-muted-text: #999;
  --wu-message-text: #ddd;
}
```

## Exact Hardcoded Colors from Old CSS (optional add-ons)

Some old colors were not tokenized in that revision. If you want a closer visual match, add:

```css
/* Break supervision block (old exact value) */
.MMM-Webuntis .grid-combined .lesson-break-supervision,
.MMM-Webuntis .grid-combined .lesson-content.break-supervision,
.MMM-Webuntis .ticker-item .lesson-content.break-supervision {
  background-color: #d47aeb;
  color: #ffffff;
}

/* No-lesson label text (old exact value) */
.MMM-Webuntis .grid-combined .no-lesson {
  color: #fff;
}

/* Old generic substitution/error text */
.MMM-Webuntis .substitution {
  color: #ffa500;
}

.MMM-Webuntis .error {
  color: red;
}
```

## Notes

- Values in this document are copied from historical CSS (commit `5fdd1bb`) instead of being approximated.
- This is still a **visual recreation**, not a code rollback to old architecture.
- The new semantic variable structure remains active; only styling values are overridden.
- You can mix legacy colors with the new icon and layout customization options from [CSS_CUSTOMIZATION.md](CSS_CUSTOMIZATION.md).
