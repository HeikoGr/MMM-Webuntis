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

Override these in `config/custom.css` to change colors globally:

```css
.MMM-Webuntis {
  /* Lesson background colors */
  --wu-replacement-bg: #bfe6ff;        /* Substitutions (blue) */
  --wu-replacement-text: #032f56;
  --wu-cancelled-bg: #ffbdbd;          /* Cancelled lessons (red) */
  --wu-cancelled-text: #7a0000;
  --wu-regular-bg: #c9ffbf;            /* Regular lessons (green) */
  --wu-regular-text: #0f6b0f;

  /* Other elements */
  --wu-exam-bar: #ffeb3b;              /* Exam indicator (yellow) */
  --wu-no-lesson-bg: #642463;          /* No lesson notice (purple) */
  --wu-lesson-surface: #fff;           /* Lesson surface background */
  --wu-time-color: #666;               /* Time labels */
  --wu-secondary-text: #888;           /* Secondary/teacher text */
  --wu-muted-text: #999;               /* Muted helper text */
  --wu-message-text: #ddd;             /* Message body text */

  /* State & accent colors */
  --wu-substitution-accent: #ff8800;   /* Substitution detail text */
  --wu-exam-description-color: #ff6600;
  --wu-holiday-notice-color: #d35400;
  --wu-absence-excused-color: #2e7d32;
  --wu-absence-unexcused-color: #b71c1c;
  --wu-warning-color: #ff9800;
  --wu-warning-bg-soft: rgba(255, 152, 0, 0.06);
  --wu-warning-bg-strong: rgba(255, 152, 0, 0.1);
  --wu-critical-color: #f44336;
  --wu-critical-bg: rgba(244, 67, 54, 0.15);
  --wu-error-text: #b71c1c;
  --wu-error-bg: #ffebee;
  --wu-error-border: #d32f2f;

  /* Today/day-column overrides */
  --wu-today-replacement-bg: #82c6f0;
  --wu-today-replacement-text: #01242f;
  --wu-today-cancelled-bg: #ff8a8a;
  --wu-today-cancelled-text: #590000;
  --wu-today-regular-bg: #a8f59f;
  --wu-today-regular-text: #054a05;
  --wu-today-lesson-border: #cfcfcf;

  /* Overlay and timeline accents */
  --wu-grid-more-bg: rgba(0, 0, 0, 0.45);
  --wu-absence-overlay-bg: rgba(255, 100, 100, 0.5);
  --wu-absence-overlay-border: rgba(255, 100, 100, 0.8);
  --wu-absence-overlay-hover-bg: rgba(255, 100, 100, 0.65);
  --wu-absence-overlay-hover-border: rgba(255, 100, 100, 1);
  --wu-hourline-color: rgba(239, 239, 239, 0.5);
  --wu-nowline-start: rgba(255, 0, 0, 0.95);
  --wu-nowline-end: rgba(255, 0, 0, 0.85);
  --wu-nowline-glow: rgba(255, 0, 0, 0.45);

  /* Spacing & borders */
  --wu-lesson-outline: #ccc;
  --wu-border-strong: #333;
  --wu-border-muted: #444;
  --wu-split-divider: rgba(0, 0, 0, 0.06);
  --wu-lesson-radius: 4px;
  --wu-lesson-padding: 2px;
  --wu-exam-border-width: 6px;

  /* Message cards / changed fields */
  --wu-message-card-bg: rgba(255, 255, 255, 0.05);
  --wu-message-card-border: #ffcc00;
  --wu-changed-highlight: #f0a030;
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
| `.absence-excused` | Excused absences | Green color |
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
  --wu-cancelled-bg: #0077bb;      /* Blue instead of red */
  --wu-cancelled-text: #ffffff;
  --wu-regular-bg: #ee7733;        /* Orange instead of green */
  --wu-regular-text: #000000;
}
```

### Deuteranopia (Green-Blind)

```css
.MMM-Webuntis {
  --wu-regular-bg: #0077bb;        /* Blue instead of green */
  --wu-regular-text: #ffffff;
  --wu-replacement-bg: #ee7733;    /* Orange */
  --wu-replacement-text: #000000;
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
