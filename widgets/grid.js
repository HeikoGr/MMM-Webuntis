const nowLineStates = new WeakMap();

function getNowLineState(ctx) {
  if (!nowLineStates.has(ctx)) {
    nowLineStates.set(ctx, { timer: null, initialTimeout: null });
  }
  return nowLineStates.get(ctx);
}

(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const {
    log,
    escapeHtml,
    addHeader,
    getWidgetConfig,
    formatDate,
    formatTime,
    toMinutes,
    createWidgetContext,
    getTeachers,
    getSubject,
    getRoom,
    getClass,
    getStudentGroup,
    getLessonDisplayMode,
  } = root.util?.initWidget?.(root) || {};

  function startNowLineUpdater(ctx) {
    if (!ctx || ctx._paused) return;
    if (!ctx._hasWidget('grid')) return;
    const state = getNowLineState(ctx);
    if (state.timer || state.initialTimeout) return;

    const tick = () => {
      try {
        const nowLocal = new Date();
        const nowYmd = nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
        // Only refresh data if debugDate is NOT set (i.e., using real time) and the day has changed
        const isDebugMode = ctx.config && typeof ctx.config.debugDate === 'string' && ctx.config.debugDate;
        if (!isDebugMode) {
          if (ctx._currentTodayYmd === undefined) ctx._currentTodayYmd = nowYmd;
          if (nowYmd !== ctx._currentTodayYmd) {
            try {
              // Use the debounced _sendFetchData if available, otherwise direct socket call
              if (typeof ctx._sendFetchData === 'function') {
                ctx._sendFetchData('date-change');
              } else {
                ctx.sendSocketNotification('FETCH_DATA', ctx.config);
              }
            } catch {
              // ignore
            }
            try {
              ctx.updateDom();
            } catch {
              // ignore
            }
            ctx._currentTodayYmd = nowYmd;
          }
        }

        const gridWidget = ctx._getWidgetApi()?.grid;
        if (gridWidget) {
          if (typeof gridWidget.updateNowLinesAll === 'function') gridWidget.updateNowLinesAll(ctx);
          if (typeof gridWidget.refreshPastMasks === 'function') gridWidget.refreshPastMasks(ctx);
        }
      } catch (err) {
        log('debug', 'minute tick update failed', err);
      }
    };

    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    state.initialTimeout = setTimeout(
      () => {
        tick();
        state.timer = setInterval(tick, 60 * 1000);
        state.initialTimeout = null;
      },
      Math.max(0, msToNextMinute)
    );

    tick();
  }

  function stopNowLineUpdater(ctx) {
    if (!ctx) return;
    const state = getNowLineState(ctx);
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    if (state.initialTimeout) {
      clearTimeout(state.initialTimeout);
      state.initialTimeout = null;
    }
  }

  // ============================================================================
  // CONFIGURATION & VALIDATION
  // ============================================================================

  function validateAndExtractGridConfig(ctx, studentConfig) {
    // Read widget-specific config (defaults already applied by MMM-Webuntis.js)
    const configuredNext = getWidgetConfig(studentConfig, 'grid', 'nextDays') ?? 3;
    const configuredPast = getWidgetConfig(studentConfig, 'grid', 'pastDays') ?? 0;
    const daysToShow = configuredNext && Number(configuredNext) > 0 ? parseInt(configuredNext, 10) : 3;
    const pastDays = Math.max(0, parseInt(configuredPast, 10));
    const startOffset = -pastDays;
    const totalDisplayDays = pastDays + 1 + daysToShow;
    const gridDateFormat = getWidgetConfig(studentConfig, 'grid', 'dateFormat') ?? 'EEE dd.MM.';
    const maxGridLessons = Math.max(0, Math.floor(Number(getWidgetConfig(studentConfig, 'grid', 'maxLessons') ?? 0)));

    return {
      daysToShow,
      pastDays,
      startOffset,
      totalDisplayDays,
      gridDateFormat,
      maxGridLessons,
    };
  }

  // ============================================================================
  // TIME AXIS CALCULATION
  // ============================================================================

  function calculateTimeRange(timetable, timeUnits, ctx) {
    let allStart = Infinity;
    let allEnd = -Infinity;

    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      timeUnits.forEach((u) => {
        if (u.startMin !== undefined && u.startMin !== null) allStart = Math.min(allStart, u.startMin);
        if (u.endMin !== undefined && u.endMin !== null) allEnd = Math.max(allEnd, u.endMin);
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

    if (!isFinite(allStart) || allEnd <= allStart) {
      allStart = 7 * 60;
      allEnd = 17 * 60;
    }

    return { allStart, allEnd };
  }

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

      // Make sure cutoff includes the full timeUnit (go to the next unit's start if available)
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

  // ============================================================================
  // DOM CREATION - HEADER & TIME AXIS
  // ============================================================================

  function createGridHeader(totalDisplayDays, baseDate, startOffset, gridDateFormat, ctx, { formatDate }) {
    const header = document.createElement('div');
    header.className = 'grid-days-header';

    const cols = ['minmax(80px,auto)'];
    for (let d = 0; d < totalDisplayDays; d++) {
      cols.push('1fr');
    }
    header.style.gridTemplateColumns = cols.join(' ');

    const emptyHeader = document.createElement('div');
    emptyHeader.className = 'grid-days-header-empty';
    header.appendChild(emptyHeader);

    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
      const dayLabel = document.createElement('div');
      dayLabel.className = 'grid-daylabel';

      const dayLabelText = formatDate
        ? formatDate(dayDate, gridDateFormat)
        : dayDate.toLocaleDateString(ctx.config.language, { weekday: 'short', day: 'numeric', month: 'numeric' });

      dayLabel.innerText = dayLabelText;
      const col = 2 + d;
      dayLabel.style.gridColumn = `${col}`;
      header.appendChild(dayLabel);
    }

    return { header, gridTemplateColumns: cols.join(' ') };
  }

  function createTimeAxis(timeUnits, allStart, allEnd, totalHeight, totalMinutes, ctx) {
    const timeAxis = document.createElement('div');
    timeAxis.className = 'grid-timecell';
    const timeInner = document.createElement('div');
    timeInner.style.position = 'relative';
    timeInner.style.height = `${totalHeight}px`;
    timeInner.style.width = '100%';

    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      for (let ui = 0; ui < timeUnits.length; ui++) {
        const u = timeUnits[ui];
        const { startMin, lineMin } = getTimeUnitBounds(timeUnits, ui);
        if (startMin === null) continue;

        const top = Math.round(((startMin - allStart) / totalMinutes) * totalHeight);
        const lab = document.createElement('div');
        lab.style.position = 'absolute';
        lab.style.top = `${top}px`;
        lab.style.left = '4px';
        lab.style.zIndex = 2;
        lab.style.fontSize = '0.85em';
        lab.style.color = '#666';
        lab.style.textAlign = 'left';

        const periodLabel = ctx.translate('period') || '';
        const periodSuffix = periodLabel ? `${periodLabel}` : '';
        lab.innerText = `${u.name}.${periodSuffix}\n${String(u.startTime)
          .padStart(4, '0')
          .replace(/(\d{2})(\d{2})/, '$1:$2')}`;
        timeInner.appendChild(lab);

        if (lineMin !== undefined && lineMin !== null && lineMin >= allStart && lineMin <= allEnd) {
          const lineTop = Math.round(((lineMin - allStart) / totalMinutes) * totalHeight);
          const tline = document.createElement('div');
          tline.className = 'grid-hourline';
          tline.style.top = `${lineTop - 2}px`;
          timeInner.appendChild(tline);
        }
      }
    } else {
      for (let m = Math.ceil(allStart / 60) * 60; m <= allEnd; m += 60) {
        const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
        const lab = document.createElement('div');
        lab.style.position = 'absolute';
        lab.style.top = `${top}px`;
        lab.style.zIndex = 2;
        lab.style.left = '4px';
        lab.style.fontSize = '0.85em';
        lab.style.color = '#666';
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        lab.innerText = `${hh}:${mm}`;
        timeInner.appendChild(lab);

        const tline = document.createElement('div');
        tline.className = 'grid-hourline';
        tline.style.top = `${top}px`;
        timeInner.appendChild(tline);
      }
    }

    timeAxis.appendChild(timeInner);
    timeAxis.style.gridColumn = '1';

    return timeAxis;
  }

  // ============================================================================
  // LESSON PROCESSING & FILTERING
  // ============================================================================

  function extractDayLessons(sourceForDay, ctx) {
    return sourceForDay.map((el) => {
      // Use dynamic field extraction for flexible display
      const displayMode = getLessonDisplayMode ? getLessonDisplayMode(el) : {};

      return {
        dateStr: String(el.date),
        startMin: ctx._toMinutes(el.startTime),
        endMin: el.endTime ? ctx._toMinutes(el.endTime) : null,
        startTime: el.startTime ? String(el.startTime).padStart(4, '0') : '',
        endTime: el.endTime ? String(el.endTime).padStart(4, '0') : null,
        // Flexible field extraction
        subjectShort: getSubject ? getSubject(el, 'short') : el.su?.[0]?.name || el.su?.[0]?.longname || 'N/A',
        subject: getSubject ? getSubject(el, 'long') : el.su?.[0]?.longname || el.su?.[0]?.name || 'N/A',
        teacherInitial: getTeachers ? getTeachers(el, 'short')[0] : el.te?.[0]?.name || el.te?.[0]?.longname || 'N/A',
        teacher: getTeachers ? getTeachers(el, 'long')[0] : el.te?.[0]?.longname || el.te?.[0]?.name || 'N/A',
        room: getRoom ? getRoom(el, 'short') : el.ro?.[0]?.name || el.ro?.[0]?.longname || '',
        roomLong: getRoom ? getRoom(el, 'long') : el.ro?.[0]?.longname || el.ro?.[0]?.name || '',
        class: getClass ? getClass(el, 'short') : el.cl?.[0]?.name || el.cl?.[0]?.longname || '',
        classLong: getClass ? getClass(el, 'long') : el.cl?.[0]?.longname || el.cl?.[0]?.name || '',
        studentGroup: getStudentGroup ? getStudentGroup(el, 'short') : el.sg?.[0]?.name || el.sg?.[0]?.longname || '',
        studentGroupLong: getStudentGroup ? getStudentGroup(el, 'long') : el.sg?.[0]?.longname || el.sg?.[0]?.name || '',
        // Display mode information
        isTeacherView: displayMode.isTeacherView,
        isStudentView: displayMode.isStudentView,
        // Legacy fields
        code: el.code || '',
        substText: el.substText || '',
        text: el.lstext || '',
        type: el.type || null,
        activityType: el.activityType || 'NORMAL_TEACHING_PERIOD',
        lessonId: el.id ?? el.lid ?? el.lessonId ?? null,
        // Original array fields for flexible display
        te: el.te || [],
        su: el.su || [],
        ro: el.ro || [],
        cl: el.cl || [],
        sg: el.sg || [],
        date: el.date,
      };
    });
  }

  function validateAndNormalizeLessons(dayLessons, log) {
    for (const curr of dayLessons) {
      curr.lessonIds = curr.lessonIds || (curr.lessonId ? [String(curr.lessonId)] : []);

      if (curr.startMin === undefined || curr.startMin === null) {
        log(
          'debug',
          'Lesson missing startMin; backend should provide numeric startMin/endMin',
          curr.lessonId ? { lessonId: curr.lessonId } : curr
        );
      }

      if (curr.endMin === undefined || curr.endMin === null) {
        if (curr.startMin !== undefined && curr.startMin !== null) {
          curr.endMin = curr.startMin + 45;
        }
      }
    }
    return dayLessons;
  }

  function filterLessonsByMaxPeriods(dayLessons, maxGridLessons, timeUnits, studentTitle, dateStr, ctx, allEnd = null) {
    if (maxGridLessons < 1 || !Array.isArray(timeUnits) || timeUnits.length === 0) {
      // If no maxGridLessons limit, still filter by allEnd cutoff if provided
      if (allEnd !== null && allEnd !== undefined) {
        return dayLessons.filter((lesson) => {
          // Always keep cancelled and irregular lessons
          if (
            lesson.code === 'cancelled' ||
            lesson.status === 'CANCELLED' ||
            lesson.code === 'irregular' ||
            lesson.status === 'SUBSTITUTION'
          ) {
            return true;
          }
          const s = lesson.startMin;
          return s === undefined || s === null || Number.isNaN(s) || s < allEnd;
        });
      }
      return dayLessons;
    }

    const filtered = dayLessons.filter((lesson) => {
      const s = lesson.startMin;
      if (s === undefined || s === null || Number.isNaN(s)) {
        return true;
      }

      // If maxGridLessons is set, filter ALL lessons (including cancelled/irregular) by period
      if (maxGridLessons >= 1) {
        // Check if the lesson's period index is within maxGridLessons
        let matchedIndex = -1;
        for (let ui = 0; ui < timeUnits.length; ui++) {
          const u = timeUnits[ui];
          const uStart = u.startMin;
          let uEnd = u.endMin;

          if (uEnd === undefined || uEnd === null) {
            if (ui + 1 < timeUnits.length && timeUnits[ui + 1]?.startMin !== undefined) {
              uEnd = timeUnits[ui + 1].startMin;
            } else {
              uEnd = uStart + 60;
            }
          }

          if (s >= uStart && s < uEnd) {
            matchedIndex = ui;
            break;
          }
        }

        if (matchedIndex === -1 && timeUnits.length > 0 && s >= (timeUnits[timeUnits.length - 1].startMin ?? Number.NEGATIVE_INFINITY)) {
          matchedIndex = timeUnits.length - 1;
        }

        // Only keep lessons in the first maxGridLessons periods
        return matchedIndex !== -1 && matchedIndex < maxGridLessons;
      }

      // Otherwise (no maxGridLessons limit), use allEnd cutoff if provided
      if (allEnd !== null && allEnd !== undefined && s >= allEnd) {
        return false;
      }

      return true;
    });

    if (filtered.length < dayLessons.length) {
      const hidden = dayLessons.length - filtered.length;
      log(
        ctx,
        'debug',
        `Grid: hiding ${hidden} lesson(s) for ${studentTitle} on ${dateStr} due to grid.maxLessons=${maxGridLessons}. ` +
          `Showing first ${maxGridLessons} period(s) plus all cancelled/irregular.`
      );
    }

    return filtered;
  }

  function lessonHasExam(lesson) {
    // Primary check: REST API provides `type: 'EXAM'` (uppercase) directly on lessons that are exams
    if (lesson?.type && String(lesson.type).toUpperCase() === 'EXAM') return true;

    // Fallback: Check if lesson text contains exam keywords
    const lText = String(lesson?.text || lesson?.lstext || '').toLowerCase();
    if (lText.includes('klassenarbeit') || lText.includes('klausur') || lText.includes('arbeit')) {
      return true;
    }

    return false;
  }

  // ============================================================================
  // DOM CREATION - DAY COLUMNS
  // ============================================================================

  function addHourLinesToColumn(inner, timeUnits, allStart, allEnd, totalMinutes, totalHeight) {
    try {
      if (Array.isArray(timeUnits) && timeUnits.length > 0) {
        for (let ui = 0; ui < timeUnits.length; ui++) {
          const { lineMin } = getTimeUnitBounds(timeUnits, ui);
          if (lineMin === undefined || lineMin === null) continue;
          if (lineMin < allStart || lineMin > allEnd) continue;

          const top = Math.round(((lineMin - allStart) / totalMinutes) * totalHeight);
          const line = document.createElement('div');
          line.className = 'grid-hourline';
          line.style.top = `${top - 2}px`;
          inner.appendChild(line);
        }
      } else {
        for (let m = Math.ceil(allStart / 60) * 60; m <= allEnd; m += 60) {
          const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
          const line = document.createElement('div');
          line.className = 'grid-hourline';
          line.style.top = `${top}px`;
          inner.appendChild(line);
        }
      }
    } catch (e) {
      log('debug', 'failed to draw hour lines', e);
    }
  }

  function addNowLineToColumn(inner, allStart, allEnd, totalHeight) {
    const nowLine = document.createElement('div');
    nowLine.className = 'grid-nowline';
    nowLine.style.display = 'none';
    inner.appendChild(nowLine);

    inner._nowLine = nowLine;
    inner._allStart = allStart;
    inner._allEnd = allEnd;
    inner._totalHeight = totalHeight;
  }

  function addDayNotice(inner, totalHeight, icon, text, iconSize = '1.5em') {
    // Unified function for both holiday and no-lessons notices
    const notice = document.createElement('div');
    notice.className = 'grid-lesson lesson lesson-content no-lesson';
    notice.style.height = `${totalHeight}px`;
    notice.innerHTML = `
      <div style="font-size: ${iconSize}; margin-bottom: 4px;">${icon}</div>
      <div style="font-weight: bold;">${text}</div>
    `;
    inner.appendChild(notice);
  }

  function addMoreBadge(inner, hiddenCount, ctx) {
    const moreBadge = document.createElement('div');
    moreBadge.className = 'grid-more-badge';
    moreBadge.innerText = ctx.translate('more');
    const hiddenLessonsKey = hiddenCount > 1 ? 'hidden_lessons_plural' : 'hidden_lessons';
    const hiddenLessonsLabel = ctx.translate ? ctx.translate(hiddenLessonsKey) : hiddenCount > 1 ? 'more lessons' : 'more lesson';
    moreBadge.title = `${hiddenCount} ${hiddenLessonsLabel}`;
    inner.appendChild(moreBadge);
  }

  // ============================================================================
  // LESSON CELL RENDERING
  // ============================================================================

  function createLessonCell(topPx, heightPx, dateStr, eMin) {
    const cell = document.createElement('div');
    cell.className = 'grid-lesson lesson';
    cell.style.top = `${topPx}px`;
    cell.style.height = `${heightPx}px`;
    cell.setAttribute('data-date', dateStr);
    cell.setAttribute('data-end-min', String(eMin));
    return cell;
  }

  function makeLessonInnerHTML(lesson, escapeHtml, ctx) {
    // Special handling for BREAK_SUPERVISION (must run first, before flexible display)
    if (lesson.activityType === 'BREAK_SUPERVISION') {
      const breakSupervisionLabel = ctx.translate ? ctx.translate('break_supervision') : 'Break Supervision';
      const shortLabel = breakSupervisionLabel === 'Pausenaufsicht' ? 'PA' : 'BS';
      const supervisedArea = lesson.room || lesson.roomLong || '';
      const displayText = supervisedArea ? `🔔 ${shortLabel} (${supervisedArea})` : `🔔 ${shortLabel}`;
      return `<div class='lesson-content break-supervision'><span class='lesson-primary'>${escapeHtml(displayText)}</span></div>`;
    }

    // Use flexible field configuration from context if available
    if (ctx && root.util.buildFlexibleLessonDisplay) {
      try {
        const displayParts = root.util.buildFlexibleLessonDisplay(lesson, ctx.config);

        // Skip empty displays (e.g., lessons with no subject, teacher, room)
        const primaryText = displayParts.primary ? escapeHtml(displayParts.primary) : '';
        const secondaryText = displayParts.secondary ? escapeHtml(displayParts.secondary) : '';

        // Format additional fields as inline badges
        let additionalText = '';
        if (displayParts.additional && displayParts.additional.length > 0) {
          const additionalParts = displayParts.additional
            .filter(Boolean)
            .map((item) => `<span class='lesson-additional'>(${escapeHtml(item)})</span>`)
            .join(' ');
          if (additionalParts) {
            additionalText = ` ${additionalParts}`;
          }
        }

        // Build the display
        const subst = lesson.substText
          ? `<br><span class='lesson-substitution-text'>${escapeHtml(lesson.substText).replace(/\n/g, '<br>')}</span>`
          : '';
        const txt = lesson.text ? `<br><span class='lesson-info-text'>${escapeHtml(lesson.text).replace(/\n/g, '<br>')}</span>` : '';

        const secondaryLine = secondaryText ? `<br><span class='lesson-secondary'>${secondaryText}${additionalText}</span>` : '';

        return `<div class='lesson-content'><span class='lesson-primary'>${primaryText}</span>${secondaryLine}${subst}${txt}</div>`;
      } catch {
        // Silently fall through to legacy behavior on error
      }
    }

    // Fallback to legacy behavior
    const subject = escapeHtml(lesson.subjectShort || lesson.subject);
    let secondaryInfo = '';
    if (lesson.isTeacherView && lesson.class) {
      secondaryInfo = escapeHtml(lesson.class);
    } else if (lesson.teacher && lesson.teacher !== 'N/A') {
      secondaryInfo = escapeHtml(lesson.teacherInitial || lesson.teacher);
    }

    let roomInfo = '';
    if (lesson.room && lesson.room !== '') {
      roomInfo = ` <span class='lesson-room'>(${escapeHtml(lesson.room)})</span>`;
    }

    const subst = lesson.substText
      ? `<br><span class='lesson-substitution-text'>${escapeHtml(lesson.substText).replace(/\n/g, '<br>')}</span>`
      : '';
    const txt = lesson.text ? `<br><span class='lesson-info-text'>${escapeHtml(lesson.text).replace(/\n/g, '<br>')}</span>` : '';
    const secondaryLine = secondaryInfo ? `<br><span class='lesson-secondary'>${secondaryInfo}${roomInfo}</span>` : '';

    return `<div class='lesson-content'><span class='lesson-primary'>${subject}</span>${secondaryLine}${subst}${txt}</div>`;
  }

  function checkHomeworkMatch(lesson, homeworks) {
    if (!homeworks || !Array.isArray(homeworks) || homeworks.length === 0) {
      return false;
    }

    const lessonDate = Number(lesson.date);
    const lessonNames = Array.isArray(lesson.su) ? lesson.su.flatMap((su) => [su.name, su.longname].filter(Boolean)) : [];

    return homeworks.some((hw) => {
      const hwDueDate = Number(hw.dueDate);
      const hwSuArr = Array.isArray(hw.su) ? hw.su : hw.su ? [hw.su] : [];
      const hwNames = hwSuArr.flatMap((su) => [su.name, su.longname].filter(Boolean));
      const subjectMatch = lessonNames.some((ln) => hwNames.includes(ln));
      return hwDueDate === lessonDate && subjectMatch;
    });
  }

  function addHomeworkIcon(cell) {
    const icon = document.createElement('span');
    icon.className = 'homework-icon';
    icon.innerHTML = '📘';
    if (cell && cell.innerHTML) {
      cell.appendChild(icon.cloneNode(true));
    }
  }

  function groupLessonsByTimeSlot(lessonsToRender) {
    // Group lessons by date first
    const byDate = new Map();
    for (const lesson of lessonsToRender) {
      if (!byDate.has(lesson.dateStr)) {
        byDate.set(lesson.dateStr, []);
      }
      byDate.get(lesson.dateStr).push(lesson);
    }

    // For each date, find overlapping time slots
    const groups = new Map();
    let groupId = 0;

    for (const [dateStr, lessons] of byDate.entries()) {
      // Separate break supervisions from regular lessons
      // Break supervisions should be positioned freely, not grouped with overlapping lessons
      const regularLessons = [];
      const breakSupervisions = [];

      for (const lesson of lessons) {
        if (lesson.activityType === 'BREAK_SUPERVISION') {
          breakSupervisions.push(lesson);
        } else {
          regularLessons.push(lesson);
        }
      }

      // Sort regular lessons by start time for efficient overlap detection
      const sorted = regularLessons.slice().sort((a, b) => a.startMin - b.startMin);

      // Track which lessons have been assigned to a group
      const assigned = new Set();

      for (let i = 0; i < sorted.length; i++) {
        if (assigned.has(i)) continue;

        const lesson = sorted[i];
        const overlappingGroup = [lesson];
        assigned.add(i);

        // Find all lessons that overlap with any lesson in this group
        let foundNew = true;
        while (foundNew) {
          foundNew = false;
          for (let j = i + 1; j < sorted.length; j++) {
            if (assigned.has(j)) continue;

            const candidate = sorted[j];
            // Check if candidate overlaps with any lesson in the current group
            const hasOverlap = overlappingGroup.some(
              (groupLesson) => candidate.startMin < groupLesson.endMin && candidate.endMin > groupLesson.startMin
            );

            if (hasOverlap) {
              overlappingGroup.push(candidate);
              assigned.add(j);
              foundNew = true;
            }
          }
        }

        // Create unique key for this group
        const key = `${dateStr}_group_${groupId++}`;
        groups.set(key, overlappingGroup);
      }

      // Add break supervisions as individual groups (no overlap checking)
      // This allows them to be positioned freely, even if they overlap with regular lessons
      for (const supervision of breakSupervisions) {
        const key = `${dateStr}_supervision_${groupId++}`;
        groups.set(key, [supervision]);
      }
    }

    return groups;
  }

  function createTickerAnimation(lessons, topPx, heightPx, container, ctx, escapeHtml, hasExam, isPast, homeworks) {
    // Group lessons by subject (same subject = one ticker unit, displayed stacked)
    const getSubjectName = (lesson) => {
      if (lesson.su && lesson.su.length > 0) {
        return lesson.su[0].name || lesson.su[0].longname;
      }
      return null;
    };

    const subjectGroups = new Map();
    for (let index = 0; index < lessons.length; index++) {
      const lesson = lessons[index];
      const subject = getSubjectName(lesson);
      const groupKey = subject || `unknown_${lesson.id ?? index}`;
      if (!subjectGroups.has(groupKey)) {
        subjectGroups.set(groupKey, []);
      }
      subjectGroups.get(groupKey).push(lesson);
    }

    // Create ticker wrapper - minimal container without lesson styling
    const tickerWrapper = document.createElement('div');
    tickerWrapper.className = 'lesson-ticker-wrapper';
    tickerWrapper.style.top = `${topPx}px`;
    tickerWrapper.style.height = `${heightPx}px`;
    tickerWrapper.style.position = 'absolute';
    tickerWrapper.style.left = '0.15rem'; // Match grid-lesson left offset
    tickerWrapper.style.right = '0.15rem'; // Match grid-lesson right offset
    tickerWrapper.setAttribute('data-date', lessons[0].dateStr);
    tickerWrapper.setAttribute('data-end-min', String(Math.max(...lessons.map((l) => l.endMin))));

    // Create ticker track (will contain 2 copies for seamless loop)
    const tickerTrack = document.createElement('div');
    tickerTrack.className = 'ticker-track';

    // Each subject group is one ticker unit
    const itemCount = subjectGroups.size;
    const itemWidthPercent = 100; // Each item should be 100% of wrapper width

    // Track width is: number of items * 2 (for 2 copies) * item width
    const trackWidth = itemCount * 2 * itemWidthPercent;
    tickerTrack.style.width = `${trackWidth}%`;

    // Add subject groups twice for seamless loop
    for (let copy = 0; copy < 2; copy++) {
      for (const [, subjectLessons] of subjectGroups.entries()) {
        const tickerItem = document.createElement('div');
        tickerItem.className = 'ticker-item';

        // Set item width as percentage of track
        tickerItem.style.width = `${itemWidthPercent / (itemCount * 2)}%`;
        tickerItem.style.position = 'relative';
        tickerItem.style.height = '100%';

        // Calculate overall time range for this subject group
        const groupStartMin = Math.min(...subjectLessons.map((l) => l.startMin));
        const groupEndMin = Math.max(...subjectLessons.map((l) => l.endMin));
        const totalGroupMinutes = groupEndMin - groupStartMin;

        // Create a sub-element for each lesson in this subject group (positioned absolutely)
        for (const lesson of subjectLessons) {
          const lessonDiv = document.createElement('div');
          lessonDiv.className = 'lesson-content';

          // Calculate absolute position and height within the group's time range
          const lessonStartOffset = lesson.startMin - groupStartMin;
          const lessonDuration = lesson.endMin - lesson.startMin;

          let topPercent;
          let heightPercent;

          if (totalGroupMinutes === 0) {
            // Degenerate case: no time span in this group (e.g. zero-length lesson).
            // Render the lesson as occupying the full height.
            topPercent = 0;
            heightPercent = 100;
          } else {
            topPercent = (lessonStartOffset / totalGroupMinutes) * 100;
            heightPercent = (lessonDuration / totalGroupMinutes) * 100;
          }

          lessonDiv.style.position = 'absolute';
          lessonDiv.style.top = `${topPercent}%`;
          lessonDiv.style.height = `${heightPercent}%`;
          lessonDiv.style.left = '0';
          lessonDiv.style.right = '0';

          // Apply lesson type styling based on individual lesson
          // Check for activity type first (BREAK_SUPERVISION)
          if (lesson.activityType === 'BREAK_SUPERVISION') {
            lessonDiv.classList.add('lesson-break-supervision');
          } else {
            const lessonCode = lesson.code || '';
            if (lessonCode === 'cancelled' || lesson.status === 'CANCELLED') {
              lessonDiv.classList.add('lesson-cancelled');
            } else if (lessonCode === 'irregular' || lesson.status === 'SUBSTITUTION') {
              lessonDiv.classList.add('lesson-substitution');
            } else {
              lessonDiv.classList.add('lesson-regular');
            }
          }

          if (isPast) lessonDiv.classList.add('past');
          if (hasExam) lessonDiv.classList.add('has-exam');

          lessonDiv.innerHTML = makeLessonInnerHTML(lesson, escapeHtml, ctx);

          if (checkHomeworkMatch(lesson, homeworks)) {
            addHomeworkIcon(lessonDiv);
          }

          tickerItem.appendChild(lessonDiv);
        }

        tickerTrack.appendChild(tickerItem);
      }
    }

    tickerWrapper.appendChild(tickerTrack);

    // Calculate animation duration based on number of subject groups (longer for more items)
    const duration = Math.max(10, itemCount * 3); // 3s per subject group, min 10s
    tickerTrack.style.animation = `ticker-scroll ${duration}s linear infinite`;

    container.appendChild(tickerWrapper);
  }

  function renderLessonCells(lessonsToRender, containers, allStart, allEnd, totalMinutes, totalHeight, homeworks, ctx, escapeHtml) {
    const { bothInner } = containers;

    // Group lessons by time slot
    const timeSlotGroups = groupLessonsByTimeSlot(lessonsToRender);

    let nowYmd = ctx._currentTodayYmd;
    if (nowYmd === undefined || nowYmd === null) {
      const now = new Date();
      nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    }

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // Process each time slot group
    for (const [, lessons] of timeSlotGroups.entries()) {
      if (!lessons || lessons.length === 0) continue;

      // For overlapping lessons, use the entire time range (earliest start to latest end)
      let sMin = Math.min(...lessons.map((l) => l.startMin));
      let eMin = Math.max(...lessons.map((l) => l.endMin));
      sMin = Math.max(sMin, allStart);
      eMin = Math.min(eMin, allEnd);
      if (eMin <= sMin) continue;

      const firstLesson = lessons[0];

      const topPx = Math.round(((sMin - allStart) / totalMinutes) * totalHeight);
      const heightPx = Math.max(12, Math.round(((eMin - sMin) / totalMinutes) * totalHeight));

      const lessonYmd = Number(firstLesson.dateStr) || 0;
      let isPast = false;
      if (lessonYmd < nowYmd) {
        isPast = true;
      } else if (lessonYmd === nowYmd) {
        if (typeof eMin === 'number' && !Number.isNaN(eMin) && eMin <= nowMin) isPast = true;
      }

      const hasExam = lessons.some((l) => lessonHasExam(l));

      // RULE 1a: Exactly 2 lessons - one cancelled, one irregular -> split view (regular substitution)
      // This is the typical case: original lesson cancelled, replacement lesson irregular
      if (lessons.length === 2) {
        const cancelledLesson = lessons.find((l) => l.code === 'cancelled' || l.status === 'CANCELLED');
        const irregularLesson = lessons.find((l) => l.code === 'irregular' || l.status === 'SUBSTITUTION');

        if (cancelledLesson && irregularLesson) {
          // Use split view: irregular left, cancelled right (using position absolute)
          const { bothInner } = containers;

          const leftCell = createLessonCell(topPx, heightPx, irregularLesson.dateStr, eMin);
          leftCell.classList.add('lesson-substitution', 'split-left');
          if (hasExam) leftCell.classList.add('has-exam');
          if (isPast) leftCell.classList.add('past');
          leftCell.innerHTML = makeLessonInnerHTML(irregularLesson, escapeHtml, ctx);
          if (checkHomeworkMatch(irregularLesson, homeworks)) {
            addHomeworkIcon(leftCell);
          }
          bothInner.appendChild(leftCell);

          const rightCell = createLessonCell(topPx, heightPx, cancelledLesson.dateStr, eMin);
          rightCell.classList.add('lesson-cancelled', 'split-right');
          if (hasExam) rightCell.classList.add('has-exam');
          if (isPast) rightCell.classList.add('past');
          rightCell.innerHTML = makeLessonInnerHTML(cancelledLesson, escapeHtml, ctx);
          if (checkHomeworkMatch(cancelledLesson, homeworks)) {
            addHomeworkIcon(rightCell);
          }
          bothInner.appendChild(rightCell);
        } else {
          // Two lessons but not the cancelled+irregular pattern -> use ticker
          createTickerAnimation(lessons, topPx, heightPx, bothInner, ctx, escapeHtml, hasExam, isPast, homeworks);
        }
      }
      // RULE 1b: More than 2 overlapping lessons -> ticker
      else if (lessons.length > 2) {
        createTickerAnimation(lessons, topPx, heightPx, bothInner, ctx, escapeHtml, hasExam, isPast, homeworks);
      }
      // RULE 2: Single lesson -> full width cell
      else if (lessons.length === 1) {
        const lesson = lessons[0];
        const bothCell = createLessonCell(topPx, heightPx, lesson.dateStr, eMin);

        // Check for activity type first (BREAK_SUPERVISION)
        if (lesson.activityType === 'BREAK_SUPERVISION') {
          bothCell.classList.add('lesson-break-supervision');
        } else {
          const lessonCode = lesson.code || '';
          if (lessonCode === 'cancelled' || lesson.status === 'CANCELLED') {
            bothCell.classList.add('lesson-cancelled');
          } else if (lessonCode === 'irregular' || lesson.status === 'SUBSTITUTION') {
            bothCell.classList.add('lesson-substitution');
          } else {
            bothCell.classList.add('lesson-regular');
          }
        }

        if (hasExam) bothCell.classList.add('has-exam');
        if (isPast) bothCell.classList.add('past');
        bothCell.innerHTML = makeLessonInnerHTML(lesson, escapeHtml, ctx);

        if (checkHomeworkMatch(lesson, homeworks)) {
          addHomeworkIcon(bothCell);
        }

        bothInner.appendChild(bothCell);
      }
    }
  }

  // ============================================================================
  // ABSENCE OVERLAY RENDERING
  // ============================================================================

  function createAbsenceOverlay(ctx, topPx, heightPx, dateStr, absence) {
    const overlay = document.createElement('div');
    overlay.className = 'grid-absence-overlay';
    overlay.style.top = `${topPx}px`;
    overlay.style.height = `${heightPx}px`;
    overlay.setAttribute('data-date', dateStr);

    const excusedLabel = absence.excused ? ctx.translate('excused') : ctx.translate('unexcused');
    const reasonText = absence.reason || ctx.translate('no_reason');
    const absenceLabel = ctx.translate('absence_label');

    overlay.setAttribute('title', `${absenceLabel}: ${reasonText} (${excusedLabel})`);

    // Add icon and reason text
    const icon = document.createElement('span');
    icon.className = 'absence-icon';
    icon.textContent = '⚡';
    overlay.appendChild(icon);

    if (absence.reason) {
      const reasonText = document.createElement('span');
      reasonText.className = 'absence-reason';
      reasonText.textContent = absence.reason;
      overlay.appendChild(reasonText);
    }

    return overlay;
  }

  function addAbsenceOverlays(bothInner, dayAbsences, allStart, allEnd, totalMinutes, totalHeight, ctx) {
    if (!Array.isArray(dayAbsences) || dayAbsences.length === 0) {
      return;
    }

    try {
      for (const absence of dayAbsences) {
        // Convert HHMM (1330 = 13:30) to minutes (810 minutes)
        const startMin = ctx._toMinutes(absence?.startTime) || 0;
        const endMin = ctx._toMinutes(absence?.endTime) || 0;

        if (startMin >= allEnd || endMin <= allStart) {
          // Absence is outside the visible time range
          continue;
        }

        // Clamp to visible range
        const clampedStart = Math.max(startMin, allStart);
        const clampedEnd = Math.min(endMin, allEnd);

        if (clampedStart >= clampedEnd) {
          continue;
        }

        const topPx = Math.round(((clampedStart - allStart) / totalMinutes) * totalHeight);
        const heightPx = Math.round(((clampedEnd - clampedStart) / totalMinutes) * totalHeight);
        const dateStr = String(absence?.date || '');

        const overlay = createAbsenceOverlay(ctx, topPx, heightPx, dateStr, absence);
        bothInner.appendChild(overlay);
      }
    } catch (e) {
      log('debug', 'failed to render absence overlays', e);
    }
  }

  // ============================================================================
  // MAIN ORCHESTRATION FUNCTION
  // ============================================================================

  function renderGridForStudent(ctx, studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, absences) {
    // 1. Validate and extract configuration
    const config = validateAndExtractGridConfig(ctx, studentConfig);

    // 2. Calculate time range
    const timeRange = calculateTimeRange(timetable, timeUnits, ctx);
    let { allStart, allEnd } = timeRange;
    const fullDayEnd = allEnd; // Store original end time for holiday overlays
    allEnd = applyMaxLessonsLimit(allStart, allEnd, config.maxGridLessons, timeUnits);

    const totalMinutes = allEnd - allStart;
    const pxPerMinute = 0.75;
    const totalHeight = Math.max(120, Math.round(totalMinutes * pxPerMinute));
    const fullDayHeight = Math.max(120, Math.round((fullDayEnd - allStart) * pxPerMinute));

    // 3. Determine base date
    const baseDate = ctx._currentTodayYmd
      ? (() => {
          const s = String(ctx._currentTodayYmd);
          const by = parseInt(s.substring(0, 4), 10);
          const bm = parseInt(s.substring(4, 6), 10) - 1;
          const bd = parseInt(s.substring(6, 8), 10);
          return new Date(by, bm, bd);
        })()
      : new Date();
    const todayDateStr = `${baseDate.getFullYear()}${('0' + (baseDate.getMonth() + 1)).slice(-2)}${('0' + baseDate.getDate()).slice(-2)}`;

    // 4. Create wrapper and add student title header for verbose mode
    const wrapper = document.createElement('div');

    // Add student title header if in verbose mode using helper
    const widgetCtx = createWidgetContext('grid', studentConfig, root.util || {});
    if (widgetCtx.isVerbose && studentTitle && typeof addHeader === 'function') {
      // Create a separate container for the header with the standard widget styling
      const headerContainer = document.createElement('div');
      headerContainer.className = 'wu-widget-container bright small light';
      addHeader(headerContainer, studentTitle);
      wrapper.appendChild(headerContainer);
    }

    // 5. Create date header and grid container
    const { header, gridTemplateColumns } = createGridHeader(
      config.totalDisplayDays,
      baseDate,
      config.startOffset,
      config.gridDateFormat,
      ctx,
      { formatDate, formatTime, toMinutes }
    );

    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid-combined';
    grid.style.gridTemplateColumns = gridTemplateColumns;

    // 5. Create time axis
    const timeAxis = createTimeAxis(timeUnits, allStart, allEnd, totalHeight, totalMinutes, ctx);
    grid.appendChild(timeAxis);

    // 6. Render each day column
    for (let d = 0; d < config.totalDisplayDays; d++) {
      const dayIndex = config.startOffset + d;
      const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
      const dateStr = `${targetDate.getFullYear()}${('0' + (targetDate.getMonth() + 1)).slice(-2)}${('0' + targetDate.getDate()).slice(-2)}`;

      const groupedRaw = ctx.preprocessedByStudent?.[studentTitle]?.rawGroupedByDate;
      const sourceForDay =
        groupedRaw?.[dateStr] ??
        (Array.isArray(timetable) ? timetable : [])
          .filter((el) => String(el.date) === dateStr)
          .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

      // Extract and normalize lessons
      let dayLessons = extractDayLessons(sourceForDay, ctx);
      dayLessons = validateAndNormalizeLessons(dayLessons, log);

      // Filter by max periods and time cutoff
      const lessonsToRender = filterLessonsByMaxPeriods(dayLessons, config.maxGridLessons, timeUnits, studentTitle, dateStr, ctx, allEnd);

      // Create day column (single column per day)
      const col = 2 + d;
      const isToday = dateStr === todayDateStr;

      const bothWrap = document.createElement('div');
      bothWrap.style.gridColumn = `${col}`;
      bothWrap.style.gridRow = '1';
      const bothInner = document.createElement('div');
      bothInner.className = 'day-column-inner';
      bothInner.style.height = `${totalHeight}px`;
      bothInner.style.position = 'relative';
      if (isToday) bothInner.classList.add('is-today');
      bothWrap.appendChild(bothInner);

      // Add holiday notice if applicable - use full day height
      const holiday = (ctx.holidayMapByStudent?.[studentTitle] || {})[Number(dateStr)] || null;
      if (holiday) {
        addDayNotice(bothInner, fullDayHeight, '🏖️', escapeHtml(holiday.longName || holiday.name), '2em');
      }

      // Add to grid
      grid.appendChild(bothWrap);

      // Add hour lines
      addHourLinesToColumn(bothInner, timeUnits, allStart, allEnd, totalMinutes, totalHeight);

      // Add now line
      addNowLineToColumn(bothInner, allStart, allEnd, totalHeight);

      // Add "more" badge if lessons were hidden
      const hiddenCount = dayLessons.length - lessonsToRender.length;
      if (hiddenCount > 0) {
        addMoreBadge(bothInner, hiddenCount, ctx);
      }

      // Add "no lessons" notice if empty and not a holiday
      if (!Array.isArray(lessonsToRender) || lessonsToRender.length === 0) {
        // Don't show "no lessons" if there's a holiday notice
        if (!holiday) {
          addDayNotice(bothInner, totalHeight, '📅', `<b>${ctx.translate('no-lessons')}</b>`, '1.5em');
        }
      } else {
        // Render lesson cells
        renderLessonCells(lessonsToRender, { bothInner }, allStart, allEnd, totalMinutes, totalHeight, homeworks, ctx, escapeHtml);
      }

      // Add absence overlays if any
      if (Array.isArray(absences) && absences.length > 0) {
        const dayAbsences = absences.filter((ab) => String(ab?.date) === dateStr);
        if (dayAbsences.length > 0) {
          addAbsenceOverlays(bothInner, dayAbsences, allStart, allEnd, totalMinutes, totalHeight, ctx);
        }
      }
    }

    wrapper.appendChild(grid);

    // Draw nowLine immediately on first render
    try {
      const gridWidget = ctx?._getWidgetApi?.()?.grid;
      if (gridWidget && typeof gridWidget.updateNowLinesAll === 'function') {
        gridWidget.updateNowLinesAll(ctx, wrapper);
      }
      if (gridWidget && typeof gridWidget.refreshPastMasks === 'function') {
        gridWidget.refreshPastMasks(ctx, wrapper);
      }
    } catch {
      // ignore
    }

    return wrapper;
  }

  function refreshPastMasks(ctx, rootEl = null) {
    try {
      if (!ctx) return;
      const nowLocal = new Date();
      const todayYmd =
        typeof ctx._currentTodayYmd === 'number' && ctx._currentTodayYmd
          ? ctx._currentTodayYmd
          : nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
      const nowMin = nowLocal.getHours() * 60 + nowLocal.getMinutes();
      const scope = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;
      const lessons = scope.querySelectorAll('.grid-combined .grid-lesson');
      lessons.forEach((ln) => {
        const ds = ln.getAttribute('data-date');
        const de = ln.getAttribute('data-end-min');
        if (!ds) return;
        const lessonYmd = Number(ds) || 0;
        const endMin = de !== null && de !== undefined ? Number(de) : NaN;
        let isPast = false;
        if (lessonYmd < todayYmd) {
          isPast = true;
        } else if (lessonYmd === todayYmd) {
          if (!Number.isNaN(endMin) && endMin <= nowMin) isPast = true;
        }
        if (isPast) ln.classList.add('past');
        else ln.classList.remove('past');
      });
    } catch (e) {
      log('warn', 'failed to refresh past masks', e);
    }
  }

  function updateNowLinesAll(ctx, rootEl = null) {
    try {
      if (!ctx) return;
      // Respect the showNowLine config option (from current displayed student config)
      if (ctx.studentConfig?.showNowLine === false) {
        // Hide all now lines if disabled
        const scope = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;
        const inners = scope.querySelectorAll('.day-column-inner');
        inners.forEach((inner) => {
          const nl = inner._nowLine;
          if (nl) nl.style.display = 'none';
        });
        return 0;
      }
      const scope = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;
      const inners = scope.querySelectorAll('.day-column-inner');
      const nowLocal = new Date();
      const nowMin = nowLocal.getHours() * 60 + nowLocal.getMinutes();
      let updated = 0;
      inners.forEach((inner) => {
        // Only show the now-line for the column explicitly marked as "is-today".
        if (!inner.classList || !inner.classList.contains('is-today')) {
          const nl = inner._nowLine;
          if (nl) nl.style.display = 'none';
          return;
        }
        const nl = inner._nowLine;
        const allS = inner._allStart;
        const allE = inner._allEnd;
        const h = inner._totalHeight;
        if (!nl || allS === undefined || allE === undefined || h === undefined) return;
        if (nowMin < allS || nowMin > allE) {
          nl.style.display = 'none';
          return;
        }
        nl.style.display = 'block';
        const top = Math.round(((nowMin - allS) / (allE - allS)) * h);
        nl.style.top = `${top}px`;
        updated++;
      });
      return updated;
    } catch (e) {
      log('warn', 'updateNowLinesAll failed', e);
      return 0;
    }
  }

  root.grid = {
    renderGridForStudent,
    refreshPastMasks,
    updateNowLinesAll,
    startNowLineUpdater,
    stopNowLineUpdater,
  };
})();
