/**
 * Grid widget, part 1 of 2: the layout arithmetic (visible time range, pixel placement, overlap
 * groups, split/ticker classification, displayed days). No DOM and no host helpers, so it is
 * tested on its own (tests/grid-layout.test.js).
 *
 * The manifest loads this file before frontend.js (`entry.frontend` is a list); frontend.js takes
 * `createGridLayout` from `MMMWebuntisGridLayout` and turns the results into elements.
 */
(function defineGridLayout(globalRoot) {
  function createGridLayout() {
    /** Configured pixels per minute when positive, else the default 0.8. */
    function resolvePxPerMinute(raw) {
      const value = Number(raw);
      return raw !== undefined && raw !== null && Number.isFinite(value) && value > 0 ? value : 0.8;
    }

    /** Rolling view: pastDays before today, today, nextDays after. */
    function rollingRange(configuredNext, configuredPast) {
      const daysToShow = configuredNext && Number(configuredNext) > 0 ? parseInt(configuredNext, 10) : 0;
      const pastDays = Math.max(0, parseInt(configuredPast, 10));
      return { daysToShow, pastDays, startOffset: -pastDays, totalDisplayDays: pastDays + 1 + daysToShow };
    }

    /**
     * Calculate time range for grid (vertical axis)
     * Uses time units if available, otherwise infers from lesson data
     * Filters out lessons longer than 12 hours (likely data errors)
     * Also checks for lessons outside timeUnits range (e.g., early supervision, late activities)
     *
     * @param {Array} timetable - Array of lesson objects
     * @param {Array} timeUnits - Array of time unit objects (startMin, endMin, name, startTime)
     * @param {Object} ctx - Main module context (provides _toMinutes helper)
     * @returns {Object} Time range object:
     *   - allStart: number - Earliest minute of day (default: 7*60 = 7:00 AM)
     *   - allEnd: number - Latest minute of day (default: 17*60 = 5:00 PM)
     */
    function calculateTimeRange(timetable, timeUnits, ctx) {
      let allStart = Infinity;
      let allEnd = -Infinity;

      if (Array.isArray(timeUnits) && timeUnits.length > 0) {
        timeUnits.forEach((u) => {
          if (u.startMin !== undefined && u.startMin !== null) allStart = Math.min(allStart, u.startMin);
          if (u.endMin !== undefined && u.endMin !== null) allEnd = Math.max(allEnd, u.endMin);
        });

        (Array.isArray(timetable) ? timetable : []).forEach((el) => {
          const s = ctx._toMinutes(el.startTime);
          const e = el.endTime ? ctx._toMinutes(el.endTime) : null;
          if (s !== null && s !== undefined && e !== null && e !== undefined) {
            if (s < allStart || e > allEnd) {
              if (e - s < 12 * 60) {
                allStart = Math.min(allStart, s);
                allEnd = Math.max(allEnd, e);
              }
            }
          }
        });
      } else {
        (Array.isArray(timetable) ? timetable : []).forEach((el) => {
          const s = ctx._toMinutes(el.startTime);
          const e = el.endTime ? ctx._toMinutes(el.endTime) : null;
          if (s !== null && s !== undefined && e !== null && e !== undefined) {
            if (e - s < 12 * 60) {
              allStart = Math.min(allStart, s);
              allEnd = Math.max(allEnd, e);
            }
          } else if (s !== null && s !== undefined) {
            allStart = Math.min(allStart, s);
          }
        });
      }

      if (!Number.isFinite(allStart) || allEnd <= allStart) {
        allStart = 7 * 60;
        allEnd = 17 * 60;
      }

      return { allStart, allEnd };
    }

    /**
     * Apply max lessons limit to time range cutoff
     * Limits visible time range to first N periods (respects time unit boundaries)
     *
     * @param {number} allStart - Start time in minutes
     * @param {number} allEnd - End time in minutes (before limit)
     * @param {number} maxGridLessons - Maximum number of periods to show (0 = no limit)
     * @param {Array} timeUnits - Array of time unit objects
     * @returns {number} New end time in minutes (clamped to period boundary)
     */
    function applyMaxLessonsLimit(allStart, allEnd, maxGridLessons, timeUnits) {
      if (maxGridLessons >= 1 && Array.isArray(timeUnits) && timeUnits.length > 0) {
        const targetIndex = Math.min(timeUnits.length - 1, maxGridLessons - 1);
        let cutoff = timeUnits[targetIndex].endMin;

        if (cutoff === undefined || cutoff === null) {
          if (targetIndex + 1 < timeUnits.length && timeUnits[targetIndex + 1]?.startMin !== undefined) {
            cutoff = timeUnits[targetIndex + 1].startMin;
          } else if (timeUnits[targetIndex].startMin !== undefined) {
            cutoff = timeUnits[targetIndex].startMin + 60;
          }
        }

        if (
          cutoff !== undefined &&
          cutoff !== null &&
          targetIndex + 1 < timeUnits.length &&
          timeUnits[targetIndex + 1]?.startMin !== undefined
        ) {
          cutoff = timeUnits[targetIndex + 1].startMin;
        }

        if (cutoff !== undefined && cutoff !== null && cutoff > allStart && cutoff < allEnd) {
          return cutoff;
        }
      }
      return allEnd;
    }

    function getTimeUnitBounds(timeUnits, ui) {
      if (!Array.isArray(timeUnits) || ui < 0 || ui >= timeUnits.length) {
        return { startMin: null, lineMin: null };
      }

      const u = timeUnits[ui];
      const startMin = u?.startMin ?? null;
      let lineMin = null;

      if (ui + 1 < timeUnits.length && timeUnits[ui + 1]?.startMin !== undefined) {
        lineMin = timeUnits[ui + 1].startMin;
      } else if (u?.endMin !== undefined) {
        lineMin = u.endMin;
      } else if (startMin !== null) {
        lineMin = startMin + 60;
      }

      return { startMin, lineMin };
    }

    function lessonHasDisplayIcon(lesson, iconName) {
      if (!lesson || !Array.isArray(lesson.displayIcons) || lesson.displayIcons.length === 0 || !iconName) {
        return false;
      }

      const normalizedIcon = String(iconName).trim().toUpperCase();
      return lesson.displayIcons.some((icon) => String(icon).trim().toUpperCase() === normalizedIcon);
    }

    /**
     * Check if lesson is an exam.
     *
     * @param {Object} lesson - Lesson object
     * @returns {boolean} True if lesson is an exam
     */
    function lessonHasExam(lesson) {
      return lessonHasDisplayIcon(lesson, "EXAM");
    }

    function lessonIsBreakSupervision(lesson) {
      return lessonHasDisplayIcon(lesson, "BREAK_SUPERVISION");
    }

    function lessonIsEvent(lesson) {
      return lessonHasDisplayIcon(lesson, "EVENT");
    }

    function lessonIsMoved(lesson) {
      return lessonHasDisplayIcon(lesson, "MOVED");
    }

    function getVisibleTimeBlockPlacement(startMin, endMin, allStart, allEnd, totalMinutes, totalHeight, options = {}) {
      const { minHeightPx = 0 } = options;
      const normalizedStart = Number(startMin);
      const normalizedEnd = Number(endMin);

      if (!Number.isFinite(normalizedStart) || !Number.isFinite(normalizedEnd)) {
        return null;
      }

      if (normalizedStart >= allEnd || normalizedEnd <= allStart) {
        return null;
      }

      const visibleStart = Math.max(normalizedStart, allStart);
      const visibleEnd = Math.min(normalizedEnd, allEnd);
      if (visibleEnd <= visibleStart) {
        return null;
      }

      const safeTotalMinutes = Math.max(1, totalMinutes);
      const topPx = Math.round(((visibleStart - allStart) / safeTotalMinutes) * totalHeight);
      const rawHeightPx = Math.round(((visibleEnd - visibleStart) / safeTotalMinutes) * totalHeight);
      const heightPx = Math.max(minHeightPx, rawHeightPx);

      return {
        visibleStart,
        visibleEnd,
        topPx,
        heightPx,
      };
    }

    /**
     * Group lessons by overlapping time slots
     * Groups are used to determine rendering strategy:
     * - 1 lesson → full-width cell
     * - 2+ overlapping lessons → ticker animation
     * - Break supervisions → always separate (no overlap checking)
     *
     * @param {Array} lessonsToRender - Array of normalized lesson objects
     * @returns {Map} Map of group key → lesson array
     */
    function groupLessonsByTimeSlot(lessonsToRender) {
      const groups = new Map();
      let groupId = 0;

      for (const [dateStr, lessons] of groupByDate(lessonsToRender)) {
        const regularLessons = lessons.filter((lesson) => !lessonIsBreakSupervision(lesson));
        for (const overlappingGroup of collectOverlapGroups(regularLessons)) {
          groups.set(`${dateStr}_group_${groupId++}`, overlappingGroup);
        }
        for (const supervision of lessons.filter(lessonIsBreakSupervision)) {
          groups.set(`${dateStr}_supervision_${groupId++}`, [supervision]);
        }
      }

      return groups;
    }

    /** Lessons by dateStr, in order of first appearance. */
    function groupByDate(lessons) {
      const byDate = new Map();
      for (const lesson of lessons) {
        if (!byDate.has(lesson.dateStr)) byDate.set(lesson.dateStr, []);
        byDate.get(lesson.dateStr).push(lesson);
      }
      return byDate;
    }

    function lessonsOverlap(a, b) {
      return a.startMin < b.endMin && a.endMin > b.startMin;
    }

    /**
     * Overlap groups of one day's lessons, sorted by start: each group is a lesson plus every later
     * lesson that overlaps any member, repeated until nothing joins any more. Deliberately not a
     * single sweep: lessons without a valid time span (missing start, end before start) must keep
     * their grouping.
     */
    function collectOverlapGroups(lessons) {
      const sorted = lessons.slice().sort((a, b) => a.startMin - b.startMin);
      const assigned = new Set();
      const groups = [];
      for (let i = 0; i < sorted.length; i++) {
        if (assigned.has(i)) continue;
        assigned.add(i);
        groups.push(growOverlapGroup(sorted, i, assigned));
      }
      return groups;
    }

    /** Grows the group of sorted[start] by every later unassigned lesson overlapping a member. */
    function growOverlapGroup(sorted, start, assigned) {
      const group = [sorted[start]];
      let foundNew = true;
      while (foundNew) {
        foundNew = false;
        for (let j = start + 1; j < sorted.length; j++) {
          if (assigned.has(j) || !group.some((member) => lessonsOverlap(sorted[j], member))) continue;
          group.push(sorted[j]);
          assigned.add(j);
          foundNew = true;
        }
      }
      return group;
    }

    function byStartThenEnd(a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin;
    }

    /**
     * Split view: every cancelled lesson next to the replacements overlapping it. Cancelled lessons
     * with the same set of replacements share one pair.
     */
    function pairCancelledWithReplacements(tickerData) {
      if (!tickerData?.hasSplitView || tickerData.cancelledLessons.length === 0) return [];
      const pairs = new Map();
      for (const cancelled of tickerData.cancelledLessons) {
        const replacements = tickerData.replacements.filter(
          (r) => r.startMin < cancelled.endMin && r.endMin > cancelled.startMin,
        );
        if (replacements.length === 0) continue;
        const key = replacements
          .map((r) => `${r.id ?? r.lessonId ?? "noId"}_${r.startMin}_${r.endMin}_${r.status || ""}`)
          .sort()
          .join("|");
        if (!pairs.has(key)) pairs.set(key, { cancelledLessons: [], replacements });
        pairs.get(key).cancelledLessons.push(cancelled);
      }
      const result = [...pairs.values()];
      for (const pair of result) pair.cancelledLessons.sort(byStartThenEnd);
      return result;
    }

    /** Drop lessons that a split-view pair already shows; groups left empty disappear. */
    function removePairedLessons(groups, pairs) {
      const paired = new Set(pairs.flatMap((pair) => [...pair.cancelledLessons, ...pair.replacements]));
      for (const [key, groupLessons] of groups.entries()) {
        const remaining = groupLessons.filter((lesson) => !paired.has(lesson));
        if (remaining.length === 0) groups.delete(key);
        else groups.set(key, remaining);
      }
    }

    /**
     * Check whether a rendered lesson block has already ended.
     *
     * @param {number} ymd - Lesson date as YYYYMMDD.
     * @param {number} endMin - Lesson end time in minutes since midnight.
     * @param {number} nowYmd - Current date as YYYYMMDD.
     * @param {number} nowMin - Current time in minutes since midnight.
     * @returns {boolean} True when the lesson is in the past.
     */
    function calcIsPast(ymd, endMin, nowYmd, nowMin) {
      if (ymd < nowYmd) return true;
      if (ymd === nowYmd && typeof endMin === "number" && !Number.isNaN(endMin) && endMin <= nowMin) return true;
      return false;
    }

    /**
     * Detect whether a lesson carries class or student-group hints.
     *
     * @param {Object} lesson - Normalized lesson object.
     * @returns {boolean} True when class/student-group metadata is present.
     */
    function lessonHasStudentGroupOrClassHint(lesson) {
      const studentGroups = Array.isArray(lesson?.studentGroups) ? lesson.studentGroups : [];
      const classes = Array.isArray(lesson?.classes) ? lesson.classes : [];
      const hasStudentGroup = studentGroups.some((group) => (group?.name || group?.longname || "").trim().length > 0);
      const hasClass = classes.some((group) => (group?.name || group?.longname || "").trim().length > 0);
      return hasStudentGroup || hasClass;
    }

    function hasParallelOverlap(plannedParallelCandidates) {
      if (plannedParallelCandidates.length < 2) return false;

      for (let i = 0; i < plannedParallelCandidates.length; i++) {
        for (let j = i + 1; j < plannedParallelCandidates.length; j++) {
          const first = plannedParallelCandidates[i];
          const second = plannedParallelCandidates[j];
          if (first.startMin < second.endMin && first.endMin > second.startMin) {
            return true;
          }
        }
      }

      return false;
    }

    /**
     * Classify an overlap group into the rendering mode used by the grid.
     *
     * @param {Array} lessons - Overlapping normalized lessons.
     * @returns {Object} Rendering classification metadata.
     */
    function classifyLessonRenderGroup(lessons) {
      const cancelledLessons = lessons.filter((lesson) => lesson.status === "CANCELLED");
      const addedLessons = lessons.filter((lesson) => lesson.status === "ADDITIONAL");
      const substLessons = lessons.filter((lesson) => lesson.status === "SUBSTITUTION");
      const eventLessons = lessons.filter((lesson) => lessonIsEvent(lesson));
      const tickerCandidates = lessons.filter((lesson) => !lessonIsEvent(lesson));
      const plannedParallelCandidates = tickerCandidates.filter((lesson) => {
        const status = String(lesson.status || "").toUpperCase();
        return status === "REGULAR" || status === "CHANGED" || status === "CANCELLED";
      });

      const substitutionTriggersSplit = substLessons.some((lesson) => !lessonHasStudentGroupOrClassHint(lesson));
      const isSplitView =
        cancelledLessons.length >= 1 &&
        (addedLessons.length >= 1 || substitutionTriggersSplit || eventLessons.length >= 1);

      const tcGroupStart =
        tickerCandidates.length > 0 ? Math.min(...tickerCandidates.map((lesson) => lesson.startMin)) : Infinity;
      const tcGroupEnd =
        tickerCandidates.length > 0 ? Math.max(...tickerCandidates.map((lesson) => lesson.endMin)) : -Infinity;
      const spanningLessons = tickerCandidates.filter(
        (lesson) => lesson.startMin <= tcGroupStart && lesson.endMin >= tcGroupEnd,
      );
      const subPeriodLessons = tickerCandidates.filter((lesson) => !spanningLessons.includes(lesson));
      const isSpanSplitLayout =
        !isSplitView &&
        cancelledLessons.length === 0 &&
        addedLessons.length === 0 &&
        spanningLessons.length >= 1 &&
        subPeriodLessons.length >= 1;

      const isTickerGroup = hasParallelOverlap(plannedParallelCandidates);

      return {
        cancelledLessons,
        addedLessons,
        substLessons,
        eventLessons,
        tickerCandidates,
        tcGroupEnd,
        spanningLessons,
        subPeriodLessons,
        isSplitView,
        isTickerGroup,
        shouldUseSplitView: isSplitView && !isTickerGroup,
        isSpanSplitLayout,
      };
    }

    /**
     * Format a Date into the YYYYMMDD key used throughout the grid.
     *
     * @param {Date} date - Date to format.
     * @returns {string} YYYYMMDD key.
     */
    function formatDateKey(date) {
      return `${date.getFullYear()}${(`0${date.getMonth() + 1}`).slice(-2)}${(`0${date.getDate()}`).slice(-2)}`;
    }

    function cloneDayDate(date) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function isWeekendDay(date) {
      const day = date.getDay();
      return day === 0 || day === 6;
    }

    function buildRollingDisplayDates(baseDate, config, hasLessonsForDate) {
      const shouldIncludeDate = (date) => {
        if (!config.hideWeekends) return true;
        if (!isWeekendDay(date)) return true;
        return hasLessonsForDate(formatDateKey(date));
      };

      const displayDates = [];
      const visiblePastDates = [];
      let pastOffset = 1;
      while (visiblePastDates.length < config.pastDays && pastOffset <= 366) {
        const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - pastOffset);
        if (shouldIncludeDate(dayDate)) {
          visiblePastDates.push(dayDate);
        }
        pastOffset += 1;
      }

      for (const date of visiblePastDates.reverse()) {
        displayDates.push(date);
      }

      let extraFutureDays = 0;
      if (shouldIncludeDate(baseDate)) {
        displayDates.push(cloneDayDate(baseDate));
      } else {
        extraFutureDays = 1;
      }

      const futureDaysNeeded = config.daysToShow + extraFutureDays;
      let futureDaysAdded = 0;
      let futureOffset = 1;
      while (futureDaysAdded < futureDaysNeeded && futureOffset <= 366) {
        const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + futureOffset);
        if (shouldIncludeDate(dayDate)) {
          displayDates.push(dayDate);
          futureDaysAdded += 1;
        }
        futureOffset += 1;
      }

      return displayDates;
    }

    return {
      resolvePxPerMinute,
      rollingRange,
      calculateTimeRange,
      applyMaxLessonsLimit,
      getTimeUnitBounds,
      getVisibleTimeBlockPlacement,
      lessonHasDisplayIcon,
      lessonHasExam,
      lessonIsBreakSupervision,
      lessonIsEvent,
      lessonIsMoved,
      groupLessonsByTimeSlot,
      groupByDate,
      lessonsOverlap,
      collectOverlapGroups,
      growOverlapGroup,
      byStartThenEnd,
      pairCancelledWithReplacements,
      removePairedLessons,
      calcIsPast,
      lessonHasStudentGroupOrClassHint,
      hasParallelOverlap,
      classifyLessonRenderGroup,
      formatDateKey,
      cloneDayDate,
      isWeekendDay,
      buildRollingDisplayDates,
    };
  }

  globalRoot.MMMWebuntisGridLayout = { createGridLayout };
})(typeof globalThis !== "undefined" ? globalThis : this);
