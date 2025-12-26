# README.md Proof Read Report

**Date:** December 26, 2025
**Status:** ⚠️ **CRITICAL ISSUES FOUND**

## Summary

Found **7 critical mismatches** between README documentation and actual code defaults, plus **missing documentation** for options that are used in config.template.js.

---

## CRITICAL ISSUES

### 1. **logLevel Default WRONG**
- **README says:** `'none'`
- **Code defaults:** `'debug'`
- **Config template:** `'none'`
- **Issue:** Code will produce verbose debug output by default, not silent
- **Fix:** Update README to match code: change default to `'debug'` OR change code default to match template

### 2. **examsDaysAhead Default WRONG**
- **README says:** `7` days
- **Code defaults:** `21` days
- **Config template:** `7` days
- **Impact:** Users will get 3x more exams than documented
- **Fix:** Update README to `21` (matches code)

### 3. **showRegularLessons Default WRONG**
- **README says:** `true`
- **Code defaults:** `false`
- **Impact:** Regular lessons hidden by default, only substitutions shown
- **Fix:** Update README to `false` (matches code)

### 4. **absencesPastDays Default WRONG**
- **README says:** `14` days
- **Code defaults:** `21` days
- **Config template:** `14` days
- **Impact:** Users will see 1 week more absences than documented
- **Fix:** Update README to `21` (matches code)

### 5. **dateFormats.lessons Default WRONG**
- **README says:** `'EEE'` (weekday only)
- **Code defaults:** `'EEE'` (matches README ✓)
- **Config template:** `'dd.mm.'` (does NOT match)
- **Issue:** Template contradicts code default
- **Fix:** Update template to match code: `'EEE'`

---

## MISSING DOCUMENTATION

### 6. **Missing Options in README: `showTeacherMode`**
- **Location:** Used in `widgets/lessons.js` line 149
- **Template default:** `'full'`
- **Not in code defaults object**
- **Impact:** Users may use undocumented option
- **Fix:** Add to README Lessons Widget section:
  ```
  | `showTeacherMode` | string | `'full'` | Teacher display mode: 'full', 'short', or 'none' |
  ```

### 7. **Missing Options in README: `showSubstitutionText`**
- **Location:** Used in `widgets/lessons.js` line 158
- **Template default:** `false`
- **Not in code defaults object**
- **Impact:** Users may use undocumented option
- **Fix:** Add to README Lessons Widget section:
  ```
  | `showSubstitutionText` | bool | `false` | Show substitution text/notes for changed lessons |
  ```

### 8. **Missing Options in README: `lessonsWeekday` / `weekday`**
- **Location:** Used in `widgets/lessons.js` line 127
- **Template comment:** `'short'` or `'long'` for weekday display
- **Not in code defaults object**
- **Impact:** Users may use undocumented option
- **Fix:** Document in dateFormats section or as separate option

---

## INCONSISTENCIES IN CONFIG.TEMPLATE.JS

The config.template.js uses these options that don't appear in MMM-Webuntis.js defaults:
- `showTeacherMode: 'full'` ← Not in defaults, but used by lessons widget
- `showSubstitutionText: false` ← Not in defaults, but used by lessons widget
- `lessonsWeekday: 'short'` (commented) ← Referenced in code, not in defaults

**Recommendation:** Either:
1. Add all these to MMM-Webuntis.js defaults object, OR
2. Remove from template and document that they're optional undocumented options

---

## RECOMMENDED CORRECTIONS

### Option 1: Fix all README defaults to match code (Preferred - match reality)
```diff
- logLevel: 'none' → 'debug'
- examsDaysAhead: 7 → 21
- showRegularLessons: true → false
- absencesPastDays: 14 → 21
- dateFormats.lessons: 'dd.MM.' → 'EEE' (in template)
```

### Option 2: Fix code defaults to match template (Not recommended - will change behavior)
- Would require changing actual defaults in MMM-Webuntis.js
- Could break existing setups
- Not recommended

### Option 3: Document missing options
- Add `showTeacherMode`, `showSubstitutionText`, `lessonsWeekday` to README Lessons Widget table
- Add corresponding defaults to MMM-Webuntis.js (or note they're optional)

---

## ACTION ITEMS

Priority 1 (Critical - Documentation Accuracy):
- [ ] Fix README: `logLevel` → `'debug'`
- [ ] Fix README: `examsDaysAhead` → `21`
- [ ] Fix README: `showRegularLessons` → `false`
- [ ] Fix README: `absencesPastDays` → `21`
- [ ] Fix template: `dateFormats.lessons: 'EEE'` (if code really defaults to 'EEE')

Priority 2 (Important - Missing Docs):
- [ ] Add `showTeacherMode` to README Lessons Widget section
- [ ] Add `showSubstitutionText` to README Lessons Widget section
- [ ] Document `lessonsWeekday`/`weekday` option
- [ ] Update code defaults object to include these options OR clearly note they're undocumented

Priority 3 (Nice to Have):
- [ ] Verify actual behavior of `showTeacherMode` (what are valid values?)
- [ ] Test template.js configuration to ensure all documented options work
- [ ] Add example configurations for different use cases

---

## OTHER NOTES

### ✓ Correct Information
- Auto-discovery feature documented correctly
- Installation steps accurate
- Parent account support documented well
- Widget types list current (grid, lessons, exams, homework, absences, messagesofday)
- Architecture diagrams added and referenced correctly
- Breaking changes for 0.4.0 documented

### ⚠️ Minor Notes
- Config template uses `dd.mm.` but code uses `dd.MM.` (lowercase vs uppercase for month) — verify case sensitivity
- Server default noted as `'webuntis.com'` in docs but not explicitly shown in code — verify
- `server: ''` defaults to what in template? Should state default explicitly

---

## Verification Steps

To verify these issues:

```bash
# 1. Check actual defaults in code
grep -A 50 "defaults:" MMM-Webuntis.js | grep "logLevel\|examsDaysAhead\|showRegularLessons\|absencesPastDays"

# 2. Check what template uses
grep -E "logLevel|examsDaysAhead|showRegularLessons|absencesPastDays" config/config.template.js

# 3. Check unused options in code
grep -r "showTeacherMode\|showSubstitutionText" widgets/
```
