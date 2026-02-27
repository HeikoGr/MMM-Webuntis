# CSS Customization Guide

MMM-Webuntis provides extensive CSS customization options for users with visual impairments or custom styling preferences. All visual elements can be targeted via CSS classes.

## Quick Start

1. **Copy the template file:**
   ```bash
   cp config/custom.template.css config/custom.css
   ```

2. **Edit `config/custom.css`** with your custom styles

3. **Restart MagicMirror** to apply changes

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
  --wu-lesson-surface: #ffffff;
  --wu-time-color: #666;
  --wu-secondary-text: #888;
  --wu-muted-text: #999;
  --wu-alpha-subtle: 0.06;
  --wu-alpha-soft: 0.18;
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
  --wu-message-card-border: #e0b000;

  /* Overlay & timeline (rgba for transparency) */
  --wu-absence-overlay-bg: rgba(214, 69, 69, var(--wu-alpha-medium));
  --wu-nowline-start: rgba(214, 69, 69, var(--wu-alpha-strong));

  /* Layout & spacing */
  --wu-lesson-outline: #ccc;
  --wu-border-strong: #333;
  --wu-border-muted: #444;
  --wu-split-divider: rgba(0, 0, 0, 0.06);
  --wu-lesson-radius: 4px;
  --wu-lesson-padding: 2px;
  --wu-exam-border-width: 6px;
}
```

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
