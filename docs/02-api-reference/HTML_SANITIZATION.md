# HTML Sanitization in MMM-Webuntis

## Overview

MMM-Webuntis implements HTML sanitization across API responses to clean up malformed or unnecessary HTML markup while preserving intentional formatting.

## When Sanitization Happens

HTML sanitization is automatically applied to the following data fields:

| Data Type | Fields Sanitized | Preserve Line Breaks |
|-----------|-----------------|----------------------|
| **Messages of Day** | `subject`, `text` | ✅ Yes (`<br>` → newline) |
| **Homework** | `text`, `remark` | ✅ `text`; ❌ `remark` |
| **Exams** | `name`, `subject`, `text` | ✅ `text` only |
| **Absences** | `reason` | ❌ No |

## Sanitization Process

The `_sanitizeHtmlText()` function performs the following steps:

### 1. **Preserve Intentional Line Breaks**
   - Converts all variants of `<br>` tags to newlines:
     - `<br>` → `\n`
     - `<br/>` → `\n`
     - `<br />` → `\n`
   - Only applied when `preserveLineBreaks = true`

### 2. **Remove All HTML Tags**
   - Strips all remaining HTML tags: `<div>`, `<span>`, `<p>`, etc.
   - Regex: `/<[^>]*>/g`

### 3. **Decode HTML Entities**
   - Converts HTML entities to characters:
     - `&lt;` → `<`
     - `&gt;` → `>`
     - `&quot;` → `"`
     - `&apos;` → `'`
     - `&amp;` → `&` (processed last to avoid double-decoding)

### 4. **Normalize Whitespace**
   - Collapses multiple consecutive whitespace characters to single space
   - Trims leading/trailing whitespace
   - Preserves intentional newlines from step 1

## Examples

### Messages of Day
**Input (from API):**
```
"Jungen- und Mädchenchor der 5. Klasse:<br>1. und 2. Stunde Probe in der Kirche, Treffen 8.00"
```

**Output (after sanitization):**
```
Jungen- und Mädchenchor der 5. Klasse:
1. und 2. Stunde Probe in der Kirche, Treffen 8.00
```

### Homework with Rich Text
**Input:**
```
"<p>Complete exercises <b>1-5</b>&nbsp;&amp;&nbsp;write summary</p><br>Submit via email"
```

**Output:**
```
Complete exercises 1-5 & write summary
Submit via email
```

### Absence Reason
**Input:**
```
"<b>Doctor's appointment</b> - Medical leave"
```

**Output:**
```
Doctor's appointment - Medical leave
```

## Code Integration

In `node_helper.js`, the sanitization is called during data compaction:

```javascript
// In _compactMessagesOfDay()
subject: this._sanitizeHtmlText(m.subject ?? m.title ?? '', true),
text: this._sanitizeHtmlText(m.text ?? m.content ?? '', true),

// In _compactAbsences()
reason: this._sanitizeHtmlText(a.reason ?? a.reasonText ?? a.text ?? '', false),

// In _compactHomeworks()
text: this._sanitizeHtmlText(hw.text ?? hw.description ?? hw.remark ?? '', true),
remark: this._sanitizeHtmlText(hw.remark ?? '', false),
```

The `preserveLineBreaks` parameter is set based on the expected format:
- `true` for message-like fields (descriptions, notes with multiple lines)
- `false` for short-form fields (reasons, names, subjects)

## Performance

- Sanitization uses efficient regex operations
- Applied only once during data compaction (not on every render)
- No external HTML parsing library required (lightweight implementation)

## Future Enhancements

Potential improvements for future versions:
- Support for other intentional formatting tags (bold, italic)
- Configurable sanitization level (strict vs. lenient)
- Whitelist of allowed HTML tags for rich text fields
- Custom entity decoders for WebUntis-specific markup
