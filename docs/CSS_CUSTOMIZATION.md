# CSS Customization Guide

MMM-Webuntis provides extensive CSS customization options for users with visual impairments or custom styling preferences. All visual elements can be targeted via CSS classes.

## Quick Start

1. **Copy the template file:**
   ```bash
   cp config/custom.template.css config/custom.css
   ```

2. **Edit `config/custom.css`** with your custom styles

3. **Restart MagicMirror** to apply changes

## Important Additional Variables

These are frequently useful but were easy to miss in older examples:

- **Messages of Day layout:** `--wu-messages-min-width`, `--wu-messages-max-cols`
- **Messages card rendering:** `--wu-message-card-bg`, `--wu-message-card-border`, `--wu-message-text`
- **Current-time line:** `--wu-nowline-start`, `--wu-nowline-end`, `--wu-nowline-glow`
- **Today emphasis (grid):** `--wu-today-replacement-bg`, `--wu-today-cancelled-bg`, `--wu-today-regular-bg`
- **Ticker spacing:** `--wu-ticker-padding-block`, `--wu-ticker-padding-inline`, `--wu-ticker-stack-gap`, `--wu-ticker-item-gap`
- **UI icons:** `--wu-icon-warning`, `--wu-icon-homework`, `--wu-icon-break-supervision`, `--wu-icon-holiday`, `--wu-icon-no-lessons`, `--wu-icon-absence`, `--wu-icon-moved`

## Icon Configuration (CSS)

You can override all visual UI icons centrally via CSS variables:

```css
.MMM-Webuntis {
  --wu-icon-warning: '⚠️';
  --wu-icon-homework: '📘';
  --wu-icon-break-supervision: '🔔';
  --wu-icon-holiday: '🏖️';
  --wu-icon-no-lessons: '📅';
  --wu-icon-absence: '⚡';
  --wu-icon-moved: '↕';
}
```

Example alternative set:

```css
.MMM-Webuntis {
  --wu-icon-warning: '❗';
  --wu-icon-homework: '📝';
  --wu-icon-break-supervision: '🚨';
  --wu-icon-holiday: '🌴';
  --wu-icon-no-lessons: '🗓️';
  --wu-icon-absence: '🚫';
  --wu-icon-moved: '⇅';
}
```

## Recommended Variables by Widget

| Widget | Recommended CSS variables |
|---|---|
| `grid` | `--wu-regular-bg`, `--wu-replacement-bg`, `--wu-cancelled-bg`, `--wu-nowline-start`, `--wu-nowline-end`, `--wu-nowline-glow`, `--wu-hourline-color`, `--wu-lesson-radius`, `--wu-lesson-padding` |
| `lessons` | `--wu-substitution-generic`, `--wu-substitution-accent`, `--wu-warning-color`, `--wu-critical-color`, `--wu-secondary-text`, `--wu-muted-text`, `--wu-ticker-padding-block`, `--wu-ticker-padding-inline`, `--wu-ticker-stack-gap`, `--wu-ticker-item-gap` |
| `exams` | `--wu-exam-bar`, `--wu-exam-border-width`, `--wu-exam-description-color`, `--wu-warning-color`, `--wu-message-card-border` |
| `homework` | `--wu-homework-padding`, `--wu-homework-icon-top`, `--wu-homework-icon-right`, `--wu-secondary-text`, `--wu-muted-text` |
| `absences` | `--wu-absence-overlay-bg`, `--wu-absence-overlay-border`, `--wu-absence-reason-color`, `--wu-absence-excused-color`, `--wu-absence-unexcused-color`, `--wu-critical-bg` |
| `messagesofday` | `--wu-messages-min-width`, `--wu-messages-max-cols`, `--wu-message-card-bg`, `--wu-message-card-border`, `--wu-message-text` |
| `all widgets (icons)` | `--wu-icon-warning`, `--wu-icon-homework`, `--wu-icon-break-supervision`, `--wu-icon-holiday`, `--wu-icon-no-lessons`, `--wu-icon-absence`, `--wu-icon-moved` |

## Available CSS Variables

The module now uses a reduced design language:
- **Blue** = new / active / informational
- **Yellow** = important / changed / attention
- **Red** = cancelled / error / critical

`rgba(...)` values are used for transparency (overlays, glows). Base colors stay in hex.
The overlay system uses shared alpha levels: `--wu-alpha-subtle`, `--wu-alpha-soft`, `--wu-alpha-medium`, `--wu-alpha-strong`.

Override these in `config/custom.css` to customize globally:

```css
.MMM-Webuntis {
  /* Theme: neutral base */
  --wu-bg: rgba(0, 0, 0, 0.06);
  --wu-lesson-surface: #ffffff;
  --wu-text-on-dark: #ffffff;
  --wu-time-color: #666;
  --wu-border-strong: #333;
  --wu-border-muted: #444;
  --wu-lesson-outline: #ccc;
  --wu-split-divider: rgba(0, 0, 0, 0.06);
  --wu-secondary-text: #888;
  --wu-muted-text: #999;
  --wu-alpha-subtle: 0.06;
  --wu-alpha-soft: 0.1;
  --wu-alpha-medium: 0.45;
  --wu-alpha-strong: 0.85;

  /* Theme: 3-color core accents */
  --wu-accent-blue: #2f80ed;
  --wu-accent-yellow: #e0b000;
  --wu-accent-red: #d64545;

  /* Feedback mapping (blue/yellow/red) */
  --wu-replacement-bg: #dbe9ff;
  --wu-cancelled-bg: #f9d8d8;
  --wu-regular-bg: #e8f1ff;
  --wu-warning-color: #e0b000;
  --wu-critical-color: #d64545;
  --wu-message-text: #ddd;
  --wu-message-card-bg: rgba(255, 255, 255, 0.1);
  --wu-message-card-border: #e0b000;

  /* Overlay & timeline (rgba for transparency) */
  --wu-absence-overlay-bg: rgba(214, 69, 69, var(--wu-alpha-medium));
  --wu-nowline-start: rgba(214, 69, 69, var(--wu-alpha-strong));
  --wu-nowline-end: rgba(214, 69, 69, var(--wu-alpha-medium));
  --wu-nowline-glow: rgba(214, 69, 69, var(--wu-alpha-soft));

  /* Layout & spacing */
  --wu-lesson-outline: #ccc;
  --wu-border-strong: #333;
  --wu-border-muted: #444;
  --wu-split-divider: rgba(0, 0, 0, 0.06);
  --wu-lesson-radius: 4px;
  --wu-lesson-padding: 2px;
  --wu-homework-padding: 2px;
  --wu-exam-border-width: 6px;

  /* Messages of Day card layout */
  --wu-messages-min-width: 200px; /* default */
  --wu-messages-max-cols: 3;      /* default */

  /* Icons (all UI icons are CSS-configurable) */
  --wu-icon-warning: '⚠️';
  --wu-icon-homework: '📘';
  --wu-icon-break-supervision: '🔔';
  --wu-icon-holiday: '🏖️';
  --wu-icon-no-lessons: '📅';
  --wu-icon-absence: '⚡';
  --wu-icon-moved: '↕';
}
```

## Default Values (with color preview)

The following defaults are defined in `MMM-Webuntis.css`.

| Variable | Default | Preview | Typical usage |
|---|---|---|---|
| `--wu-accent-blue` | `#2f80ed` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#2f80ed;border:1px solid #666;vertical-align:middle;"></span> | Core accent (info/new) |
| `--wu-accent-yellow` | `#e0b000` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#e0b000;border:1px solid #666;vertical-align:middle;"></span> | Core accent (warning/changed) |
| `--wu-accent-red` | `#d64545` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#d64545;border:1px solid #666;vertical-align:middle;"></span> | Core accent (cancelled/error) |
| `--wu-regular-bg` | `#e8f1ff` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#e8f1ff;border:1px solid #666;vertical-align:middle;"></span> | Grid regular lesson background |
| `--wu-replacement-bg` | `#dbe9ff` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#dbe9ff;border:1px solid #666;vertical-align:middle;"></span> | Grid replacement lesson background |
| `--wu-cancelled-bg` | `#f9d8d8` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#f9d8d8;border:1px solid #666;vertical-align:middle;"></span> | Grid cancelled lesson background |
| `--wu-exam-bar` | `#e0b000` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#e0b000;border:1px solid #666;vertical-align:middle;"></span> | Exams left border |
| `--wu-message-card-border` | `#e0b000` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#e0b000;border:1px solid #666;vertical-align:middle;"></span> | Messages card accent border |
| `--wu-message-card-bg` | `rgba(255, 255, 255, 0.1)` | <span style="display:inline-block;width:0.9em;height:0.9em;background:rgba(255,255,255,0.1);border:1px solid #666;vertical-align:middle;"></span> | Messages card background |
| `--wu-message-text` | `#ddd` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#ddd;border:1px solid #666;vertical-align:middle;"></span> | Messages text color |
| `--wu-nowline-start` | `rgba(214, 69, 69, 0.85)` | <span style="display:inline-block;width:0.9em;height:0.9em;background:rgba(214,69,69,0.85);border:1px solid #666;vertical-align:middle;"></span> | Current-time line start |
| `--wu-nowline-end` | `rgba(214, 69, 69, 0.45)` | <span style="display:inline-block;width:0.9em;height:0.9em;background:rgba(214,69,69,0.45);border:1px solid #666;vertical-align:middle;"></span> | Current-time line end |
| `--wu-nowline-glow` | `rgba(214, 69, 69, 0.1)` | <span style="display:inline-block;width:0.9em;height:0.9em;background:rgba(214,69,69,0.1);border:1px solid #666;vertical-align:middle;"></span> | Current-time glow |
| `--wu-absence-overlay-bg` | `rgba(214, 69, 69, 0.45)` | <span style="display:inline-block;width:0.9em;height:0.9em;background:rgba(214,69,69,0.45);border:1px solid #666;vertical-align:middle;"></span> | Absence overlay fill |
| `--wu-absence-overlay-border` | `#d64545` | <span style="display:inline-block;width:0.9em;height:0.9em;background:#d64545;border:1px solid #666;vertical-align:middle;"></span> | Absence overlay border |
| `--wu-messages-min-width` | `200px` | — | Messages column minimum width |
| `--wu-messages-max-cols` | `3` | — | Messages max columns |
| `--wu-exam-border-width` | `6px` | — | Exam border thickness |
| `--wu-lesson-radius` | `4px` | — | Lesson card corner radius |
| `--wu-lesson-padding` | `2px` | — | Lesson card inner spacing |
| `--wu-homework-padding` | `2px` | — | Homework/exam content offset |
| `--wu-icon-warning` | `'⚠️'` | <span style="display:inline-block;width:0.9em;height:0.9em;vertical-align:middle;">⚠️</span> | Warning messages |
| `--wu-icon-homework` | `'📘'` | <span style="display:inline-block;width:0.9em;height:0.9em;vertical-align:middle;">📘</span> | Homework badge in grid |
| `--wu-icon-break-supervision` | `'🔔'` | <span style="display:inline-block;width:0.9em;height:0.9em;vertical-align:middle;">🔔</span> | Break supervision lesson |
| `--wu-icon-holiday` | `'🏖️'` | <span style="display:inline-block;width:0.9em;height:0.9em;vertical-align:middle;">🏖️</span> | Holiday notices |
| `--wu-icon-no-lessons` | `'📅'` | <span style="display:inline-block;width:0.9em;height:0.9em;vertical-align:middle;">📅</span> | No-lessons notice |
| `--wu-icon-absence` | `'⚡'` | <span style="display:inline-block;width:0.9em;height:0.9em;vertical-align:middle;">⚡</span> | Absence overlay |
| `--wu-icon-moved` | `'↕'` | <span style="display:inline-block;width:0.9em;height:0.9em;vertical-align:middle;">↕</span> | Moved lesson badge |

## Messages of Day Layout (new)

The `messagesofday` widget uses a masonry-like column layout via CSS `columns`:

```css
.MMM-Webuntis {
  --wu-messages-min-width: 200px;
  --wu-messages-max-cols: 4;
}
```

- `--wu-messages-min-width`: Minimum card width per column (default `200px`)
- `--wu-messages-max-cols`: Maximum number of columns (default `3`, your example: `4`)

Related card styling options:
- `--wu-message-card-bg`
- `--wu-message-card-border`
- `--wu-message-text`

## High Contrast Example (for Visual Impairments)

```css
/* config/custom.css - High contrast theme */
.MMM-Webuntis {
  --wu-replacement-bg: #0066cc;
  --wu-replacement-text: #ffffff;
  --wu-cancelled-bg: #cc0000;
  --wu-cancelled-text: #ffffff;
  --wu-regular-bg: #008800;
  --wu-regular-text: #ffffff;
  --wu-exam-bar: #ffcc00;
}
```

## Semantic CSS Classes

All text elements have dedicated CSS classes for precise styling:

| Class | Element | Example Use |
|-------|---------|-------------|
| `.lesson-primary` | Primary field (Grid) - typically subject, but configurable via `grid.fields.primary` | Increase font size |
| `.lesson-secondary` | Secondary field (Grid) - typically teacher, but configurable via `grid.fields.secondary` | Change color |
| `.lesson-break-supervision` | Break supervision periods | Customize background/color |
| `.teacher-name` | Teacher name (Lessons/Exams) | Make bold |
| `.lesson-substitution-text` | Substitution info | Orange color |
| `.lesson-info-text` | General lesson text | Italic style |
| `.exam-description` | Exam details | Highlight color |
| `.message-subject` | Message headline | Larger font |
| `.message-text` | Message content | Line spacing |
| `.lesson-cancelled` | Cancelled lessons | Background color |
| `.lesson-substitution` | Substitution lessons | Background color |
| `.lesson-regular` | Regular lessons | Background color |
| `.has-exam` | Lessons with exam | Border highlight |
| `.past` | Past lessons | Striped overlay |
| `.homework-icon` | Homework indicator 📘 | Size/position |
| `.grid-daylabel` | Day labels (Mo, Di, etc.) | Font weight |
| `.absence-excused` | Excused absences | Blue color |
| `.absence-unexcused` | Unexcused absences | Red color |

## Common Customization Examples

### 1. Strike-through cancelled lessons in grid

```css
/* config/custom.css */
.MMM-Webuntis .grid-combined .lesson-cancelled .lesson-primary,
.MMM-Webuntis .grid-combined .lesson-cancelled .lesson-secondary {
  text-decoration: line-through;
}
```

### 2. Larger text for visually impaired users

```css
.MMM-Webuntis .lesson-primary {
  font-size: 1rem;          /* Default: 0.75rem */
}

.MMM-Webuntis .lesson-secondary {
  font-size: 0.85rem;       /* Default: 0.65rem */
}

.MMM-Webuntis .message-subject {
  font-size: 1.2rem;        /* Default: 1rem */
}
```

### 3. Bold teacher names (when teacher is secondary field)

```css
.MMM-Webuntis .teacher-name,
.MMM-Webuntis .lesson-secondary {
  font-weight: 700;
}
```

### 4. Customize break supervision appearance

```css
.MMM-Webuntis .lesson-break-supervision {
  background-color: #ffd700;  /* Gold background */
  color: #000000;
  font-weight: 600;
  border-left: 4px solid #ff6600;  /* Orange accent */
}
```

### 5. Highlight exam descriptions

```css
.MMM-Webuntis .exam-description {
  background-color: rgba(255, 235, 59, 0.2);
  padding: 2px 4px;
  border-radius: 2px;
  font-weight: 700;
  color: #ff3300;
}
```

### 6. Hide homework icons

```css
.MMM-Webuntis .homework-icon {
  display: none;
}
```

### 7. Custom day label styling

```css
.MMM-Webuntis .grid-daylabel {
  text-transform: uppercase;
  font-weight: 700;
  font-size: 0.9rem;
  color: #fff;
  background-color: #444;
  padding: 4px 8px;
  border-radius: 3px;
}
```

### 8. Increase spacing for better readability

```css
.MMM-Webuntis .wu-widget-container {
  row-gap: 0.5rem;          /* Default: 0.25rem */
}

.MMM-Webuntis .message-text {
  line-height: 1.6;         /* Default: inherit */
}
```

## Color Blindness Support

### Protanopia (Red-Blind)

```css
.MMM-Webuntis {
  --wu-accent-red: #0077bb;        /* Blue instead of red */
  --wu-cancelled-bg: #dbe9ff;
  --wu-cancelled-text: #0f2f57;
}
```

### Deuteranopia (Green-Blind)

```css
.MMM-Webuntis {
  --wu-accent-blue: #0077bb;
  --wu-accent-yellow: #ee7733;
  --wu-replacement-bg: #dbe9ff;
  --wu-warning-color: #ee7733;
}
```

## Accessibility Best Practices

1. **Test contrast ratios:** Ensure text/background combinations meet WCAG AA standards (4.5:1 for normal text)
2. **Use semantic classes:** Target `.lesson-primary`/`.lesson-secondary` instead of generic `.small`
3. **Avoid pure color coding:** Use icons, text styles, or patterns in addition to colors
4. **Test with screen readers:** Ensure custom styles don't break screen reader navigation
5. **Increase font sizes gradually:** Start with 1.2× and adjust based on viewing distance
6. **Consider flexible field configuration:** Grid widget supports configurable primary/secondary fields via `grid.fields` config

## Full CSS Class Reference

### Layout Classes
- `.wu-widget-container` - Main widget container
- `.wu-row` - Table row equivalent
- `.wu-col` - Table cell equivalent
- `.wu-col-student` - Student name column
- `.wu-col-meta` - Meta information column (dates, times)
- `.wu-col-data` - Data content column
- `.wu-col-full` - Full-width data column
- `.wu-col-full-width` - Spans all columns

### Grid Classes
- `.grid-combined` - Grid container
- `.grid-timecell` - Time axis labels
- `.grid-daylabel` - Day column headers
- `.grid-days-header` - Days header container
- `.grid-lesson` - Individual lesson cell
- `.grid-hourline` - Hour separator lines
- `.grid-nowline` - Current time indicator (red line)
- `.grid-absence-overlay` - Absence indicator overlay

### Messages of Day Classes
- `.messages-grid` - Multi-column container for message cards
- `.messageRow` - Individual message card
- `.messageRowEmpty` - Empty-state message card
- `.MMM-Webuntis.messagesofday` - Root widget wrapper (single-widget mode)

### Lesson State Classes
- `.lesson-cancelled` - Cancelled lessons
- `.lesson-substitution` - Substitution/replacement lessons
- `.lesson-regular` - Regular lessons
- `.past` - Past lessons (adds striped overlay)
- `.has-exam` - Lessons with exams (yellow left border)

### Text Element Classes
- `.lesson-primary` - Primary field (configurable via `grid.fields.primary`, typically subject)
- `.lesson-secondary` - Secondary field (configurable via `grid.fields.secondary`, typically teacher)
- `.lesson-break-supervision` - Break supervision periods
- `.teacher-name` - Teacher name (inline)
- `.lesson-substitution-text` - Substitution details
- `.lesson-info-text` - General lesson information
- `.exam-description` - Exam description text
- `.message-subject` - Message headline
- `.message-text` - Message body text

### Legacy Classes (Deprecated, use lesson-primary/lesson-secondary instead)
- `.lesson-subject` - **Deprecated:** Use `.lesson-primary`
- `.lesson-teacher` - **Deprecated:** Use `.lesson-secondary`

### Row Type Classes
- `.examRow` - Exam data row
- `.examRowEmpty` - Empty exam row placeholder
- `.lessonRow` - Lesson data row
- `.lessonRowEmpty` - Empty lesson row placeholder
- `.homeworkRow` - Homework data row
- `.homeworkRowEmpty` - Empty homework row placeholder
- `.absenceRow` - Absence data row
- `.absenceRowEmpty` - Empty absence row placeholder
- `.messageRow` - Message row
- `.messageRowEmpty` - Empty message row placeholder

### Utility Classes
- `.homework-icon` - Homework indicator icon
- `.absence-excused` - Excused absence styling
- `.absence-unexcused` - Unexcused absence styling
- `.cancelled` - Generic cancelled/strikethrough style
- `.substitution` - Generic substitution/orange style
- `.error` - Error message styling
- `.info` - Info message styling
- `.dimmed` - Dimmed/faded text
- `.xsmall` - Extra small text
- `.small` - Small text
- `.bright` - Bright text
- `.light` - Light text weight

### Ticker Animation Classes
- `.lesson-ticker-wrapper` - Ticker container
- `.ticker-track` - Animated ticker track
- `.ticker-item` - Individual ticker item
- `.lesson-content` - Lesson content within ticker

### Today Highlight
- `.is-today` - Applied to current day column (intensifies colors)
