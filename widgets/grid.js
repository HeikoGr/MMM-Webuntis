const nowLineStates = new WeakMap();

function getNowLineState(ctx) {
  if (!nowLineStates.has(ctx)) {
    nowLineStates.set(ctx, { timer: null, initialTimeout: null });
  }
  return nowLineStates.get(ctx);
}

(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const util = root.util || {};
  const log = typeof util.log === 'function' ? util.log : () => { };
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');

  function startNowLineUpdater(ctx) {
    if (!ctx || ctx._paused) return;
    if (!ctx._hasWidget('grid')) return;
    const state = getNowLineState(ctx);
    if (state.timer || state.initialTimeout) return;

    log('debug', '[grid] Starting now-line updater');

    const tick = () => {
      try {
        const nowLocal = new Date();
        const nowYmd = nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
        // Only refresh data if debugDate is NOT set (i.e., using real time) and the day has changed
        const isDebugMode = ctx.config && typeof ctx.config.debugDate === 'string' && ctx.config.debugDate;
        if (!isDebugMode) {
          if (ctx._currentTodayYmd === undefined) ctx._currentTodayYmd = nowYmd;
          if (nowYmd !== ctx._currentTodayYmd) {
            log('debug', `[grid] Date changed from ${ctx._currentTodayYmd} to ${nowYmd}, refreshing data`);
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
        log('debug', '[grid] Now-line updater initialized');
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
    log('debug', '[grid] Now-line updater stopped');
  }

  function renderGridForStudent(ctx, studentTitle, studentConfig, timetable, homeworks, timeUnits) {
    // Normalized config from backend already has all legacy keys mapped
    // Default grid.nextDays to 3 to show a few days ahead (homework matching needs reasonable visibility)
    const configuredNext = studentConfig?.grid?.nextDays ?? studentConfig?.nextDays ?? 3;
    const configuredPast = studentConfig?.grid?.pastDays ?? studentConfig?.pastDays ?? 0;
    const daysToShow = configuredNext && Number(configuredNext) > 0 ? parseInt(configuredNext, 10) : 3;
    const pastDays = Math.max(0, parseInt(configuredPast, 10));
    const startOffset = -pastDays;
    // totalDisplayDays = past + today + future
    // Example: pastDays=0, daysToShow=3 → 0 + 1 + 3 = 4 days (today, tomorrow, +2d, +3d)
    const totalDisplayDays = pastDays + 1 + daysToShow;

    log(
      ctx,
      'debug',
      `[grid] render start | student: "${studentTitle}" | entries: ${Array.isArray(timetable) ? timetable.length : 0} | days: ${totalDisplayDays}/${pastDays} | homeworks: ${Array.isArray(homeworks) ? homeworks.length : 0}`
    );

    const header = document.createElement('div');
    header.className = 'grid-days-header';

    const cols = ['minmax(80px,auto)'];
    for (let d = 0; d < totalDisplayDays; d++) {
      cols.push('1fr');
      cols.push('1fr');
    }
    header.style.gridTemplateColumns = cols.join(' ');

    const emptyHeader = document.createElement('div');
    emptyHeader.className = 'grid-days-header-empty';
    header.appendChild(emptyHeader);

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

    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
      const dayLabel = document.createElement('div');
      dayLabel.className = 'grid-daylabel';
      // Determine date format from student config (already normalized by backend)
      const gridDateFormat = studentConfig?.grid?.dateFormat ?? 'EEE dd.MM.';
      let headerFormat = gridDateFormat;

      const dayLabelText = util?.formatDate
        ? util.formatDate(dayDate, headerFormat)
        : dayDate.toLocaleDateString(ctx.config.language, { weekday: 'short', day: 'numeric', month: 'numeric' });
      dayLabel.innerText = dayLabelText;
      const startCol = 2 + d * 2;
      const endCol = startCol + 2;
      dayLabel.style.gridColumn = `${startCol} / ${endCol}`;
      header.appendChild(dayLabel);
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid-combined';
    grid.style.gridTemplateColumns = cols.join(' ');

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

    const maxGridLessonsCfg_before = Number(studentConfig?.grid?.maxLessons ?? studentConfig?.maxLessons ?? 0);
    const maxGridLessons_before = Number.isFinite(maxGridLessonsCfg_before) ? Math.max(0, Math.floor(maxGridLessonsCfg_before)) : 0;
    if (maxGridLessons_before >= 1 && Array.isArray(timeUnits) && timeUnits.length > 0) {
      const tu = timeUnits;
      const targetIndex = Math.min(tu.length - 1, maxGridLessons_before - 1);
      let cutoff = tu[targetIndex].endMin;
      if (cutoff === undefined || cutoff === null) {
        if (
          targetIndex + 1 < tu.length &&
          tu[targetIndex + 1] &&
          tu[targetIndex + 1].startMin !== undefined &&
          tu[targetIndex + 1].startMin !== null
        ) {
          cutoff = tu[targetIndex + 1].startMin;
        } else if (tu[targetIndex].startMin !== undefined && tu[targetIndex].startMin !== null) {
          cutoff = tu[targetIndex].startMin + 60;
        }
      }
      if (cutoff !== undefined && cutoff !== null && cutoff > allStart) {
        if (cutoff < allEnd) {
          log(
            ctx,
            'debug',
            `Grid: vertical range limited to first ${maxGridLessons_before} timeUnit(s) (cutoff ${cutoff}) for student ${studentTitle}`
          );
          allEnd = cutoff;
        }
      }
    }

    const getUnitBounds = (ui) => {
      if (!Array.isArray(timeUnits) || ui < 0 || ui >= timeUnits.length) return { startMin: null, lineMin: null };
      const u = timeUnits[ui];
      const startMin = u && u.startMin !== undefined && u.startMin !== null ? u.startMin : null;
      let lineMin = null;
      if (
        Array.isArray(timeUnits) &&
        ui + 1 < timeUnits.length &&
        timeUnits[ui + 1] &&
        timeUnits[ui + 1].startMin !== undefined &&
        timeUnits[ui + 1].startMin !== null
      ) {
        lineMin = timeUnits[ui + 1].startMin;
      } else if (u && u.endMin !== undefined && u.endMin !== null) {
        lineMin = u.endMin;
      } else if (startMin !== null) {
        lineMin = startMin + 60;
      }
      return { startMin, lineMin };
    };

    const totalMinutes = allEnd - allStart;
    const pxPerMinute = 0.75;
    const totalHeight = Math.max(120, Math.round(totalMinutes * pxPerMinute));

    const timeAxis = document.createElement('div');
    timeAxis.className = 'grid-timecell';
    const timeInner = document.createElement('div');
    timeInner.style.position = 'relative';
    timeInner.style.height = `${totalHeight}px`;
    timeInner.style.width = '100%';

    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      for (let ui = 0; ui < timeUnits.length; ui++) {
        const u = timeUnits[ui];
        const { startMin, lineMin } = getUnitBounds(ui);
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
    grid.appendChild(timeAxis);

    const lessonHasExam = (lesson) => {
      // Primary check: REST API provides `type: 'EXAM'` (uppercase) directly on lessons that are exams.
      if (lesson?.type && String(lesson.type).toUpperCase() === 'EXAM') return true;
      // Fallback: Check if lesson text contains exam keywords like "Klassenarbeit", "Klausur", "Arbeit"
      const lText = String(lesson?.text || lesson?.lstext || '').toLowerCase();
      if (lText.includes('klassenarbeit') || lText.includes('klausur') || lText.includes('arbeit')) {
        return true;
      }

      return false;
    };

    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
      const dateStr = `${targetDate.getFullYear()}${('0' + (targetDate.getMonth() + 1)).slice(-2)}${('0' + targetDate.getDate()).slice(-2)}`;

      const groupedRaw =
        ctx.preprocessedByStudent && ctx.preprocessedByStudent[studentTitle] && ctx.preprocessedByStudent[studentTitle].rawGroupedByDate
          ? ctx.preprocessedByStudent[studentTitle].rawGroupedByDate
          : null;

      const sourceForDay =
        groupedRaw && groupedRaw[dateStr]
          ? groupedRaw[dateStr]
          : (Array.isArray(timetable) ? timetable : [])
            .filter((el) => String(el.date) === dateStr)
            .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

      log('debug', `[grid] Day ${dateStr}: found ${sourceForDay.length} lessons`);

      let dayLessons = sourceForDay.map((el) => ({
        dateStr: String(el.date),
        startMin: ctx._toMinutes(el.startTime),
        endMin: el.endTime ? ctx._toMinutes(el.endTime) : null,
        startTime: el.startTime ? String(el.startTime).padStart(4, '0') : '',
        endTime: el.endTime ? String(el.endTime).padStart(4, '0') : null,
        subjectShort: el.su?.[0]?.name || el.su?.[0]?.longname || 'N/A',
        subject: el.su?.[0]?.longname || el.su?.[0]?.name || 'N/A',
        teacherInitial: el.te?.[0]?.name || el.te?.[0]?.longname || 'N/A',
        teacher: el.te?.[0]?.longname || el.te?.[0]?.name || 'N/A',
        code: el.code || '',
        substText: el.substText || '',
        text: el.lstext || '',
        type: el.type || null,
        lessonId: el.id ?? el.lid ?? el.lessonId ?? null,
        su: el.su || [], // Preserve original su array for homework matching
        date: el.date, // Preserve date for homework matching
      }));

      // The backend now returns already-merged lesson blocks. Use the data as-is
      // and perform light validation (ensure endMin exists where possible).
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
          if (curr.startMin !== undefined && curr.startMin !== null) curr.endMin = curr.startMin + 45;
        }
      }

      // If grid.maxLessons is set, limit to that many timeUnits (school periods)
      // Always keep cancelled/irregular lessons regardless of this limit.
      const maxGridLessonsCfg = Number(studentConfig?.grid?.maxLessons ?? studentConfig?.maxLessons ?? 0);
      const maxGridLessons = Number.isFinite(maxGridLessonsCfg) ? Math.max(0, Math.floor(maxGridLessonsCfg)) : 0;
      let lessonsToRender = dayLessons;

      if (maxGridLessons >= 1 && Array.isArray(timeUnits) && timeUnits.length > 0) {
        const tu = timeUnits;
        // Always keep cancelled and irregular (substitution) lessons; only limit regular lessons to first N periods.
        const filtered = lessonsToRender.filter((lesson) => {
          // Always keep cancelled and irregular lessons regardless of maxGridLessons
          if (
            lesson.code === 'cancelled' ||
            lesson.status === 'CANCELLED' ||
            lesson.code === 'irregular' ||
            lesson.status === 'SUBSTITUTION'
          ) {
            return true;
          }

          const s = lesson.startMin;
          if (s === undefined || s === null || Number.isNaN(s)) return true;

          let matchedIndex = -1;
          for (let ui = 0; ui < tu.length; ui++) {
            const u = tu[ui];
            const uStart = u.startMin;
            let uEnd = u.endMin;
            if (uEnd === undefined || uEnd === null) {
              if (ui + 1 < tu.length && tu[ui + 1] && tu[ui + 1].startMin !== undefined && tu[ui + 1].startMin !== null) {
                uEnd = tu[ui + 1].startMin;
              } else {
                uEnd = uStart + 60;
              }
            }
            if (s >= uStart && s < uEnd) {
              matchedIndex = ui;
              break;
            }
          }
          if (matchedIndex === -1 && tu.length > 0 && s >= (tu[tu.length - 1].startMin ?? Number.NEGATIVE_INFINITY))
            matchedIndex = tu.length - 1;
          // Only include if matched to one of the first maxGridLessons periods
          return matchedIndex === -1 ? true : matchedIndex < maxGridLessons;
        });

        if (Array.isArray(filtered) && filtered.length < dayLessons.length) {
          const hidden = dayLessons.length - filtered.length;
          log(
            ctx,
            'debug',
            `Grid: hiding ${hidden} lesson(s) for ${studentTitle} on ${dateStr} due to grid.maxLessons=${maxGridLessons}. Showing first ${maxGridLessons} period(s) plus all cancelled/irregular.`
          );
        }
        lessonsToRender = filtered;
      }

      const colLeft = 2 + d * 2;
      const colRight = colLeft + 1;

      const leftWrap = document.createElement('div');
      leftWrap.style.gridColumn = `${colLeft}`;
      leftWrap.style.gridRow = '1';
      const leftInner = document.createElement('div');
      leftInner.className = 'day-column-inner';
      leftInner.style.height = `${totalHeight}px`;
      leftInner.style.position = 'relative';
      leftWrap.appendChild(leftInner);

      const rightWrap = document.createElement('div');
      rightWrap.style.gridColumn = `${colRight}`;
      rightWrap.style.gridRow = '1';
      const rightInner = document.createElement('div');
      rightInner.className = 'day-column-inner';
      rightInner.style.height = `${totalHeight}px`;
      rightInner.style.position = 'relative';
      rightWrap.appendChild(rightInner);

      const bothWrap = document.createElement('div');
      bothWrap.style.gridColumn = `${colLeft} / ${colRight + 1}`;
      bothWrap.style.gridRow = '1';
      const bothInner = document.createElement('div');
      bothInner.className = 'day-column-inner';
      bothInner.style.height = `${totalHeight}px`;
      bothInner.style.position = 'relative';
      bothWrap.appendChild(bothInner);

      if (dateStr === todayDateStr) {
        leftInner.classList.add('is-today');
        rightInner.classList.add('is-today');
        bothInner.classList.add('is-today');
      }

      // Check for holidays using backend-prepared map
      const holiday = (ctx.holidayMapByStudent?.[studentTitle] || {})[Number(dateStr)] || null;
      if (holiday) {
        const holidayNotice = document.createElement('div');
        holidayNotice.className = 'grid-holiday-notice';
        holidayNotice.style.position = 'absolute';
        holidayNotice.style.top = '0';
        holidayNotice.style.left = '0';
        holidayNotice.style.right = '0';
        holidayNotice.style.height = `${totalHeight}px`;
        holidayNotice.style.display = 'flex';
        holidayNotice.style.alignItems = 'center';
        holidayNotice.style.justifyContent = 'center';
        holidayNotice.style.background = 'rgba(255, 200, 0, 0.15)';
        holidayNotice.style.zIndex = '5';
        holidayNotice.style.pointerEvents = 'none';
        holidayNotice.innerHTML = `
                    <div style="text-align: center; padding: 8px;">
                        <div style="font-size: 2em; margin-bottom: 4px;">🏖️</div>
                        <div style="font-weight: bold;">${escapeHtml(holiday.longName || holiday.name)}</div>
                    </div>
                `;
        bothInner.appendChild(holidayNotice);
      }

      grid.appendChild(bothWrap);
      grid.appendChild(leftWrap);
      grid.appendChild(rightWrap);

      try {
        if (Array.isArray(timeUnits) && timeUnits.length > 0) {
          for (let ui = 0; ui < timeUnits.length; ui++) {
            const { lineMin } = getUnitBounds(ui);
            if (lineMin === undefined || lineMin === null) continue;
            if (lineMin < allStart || lineMin > allEnd) continue;
            const top = Math.round(((lineMin - allStart) / totalMinutes) * totalHeight);
            const line = document.createElement('div');
            line.className = 'grid-hourline';
            line.style.top = `${top - 2}px`;
            bothInner.appendChild(line);
          }
        } else {
          for (let m = Math.ceil(allStart / 60) * 60; m <= allEnd; m += 60) {
            const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
            const line = document.createElement('div');
            line.className = 'grid-hourline';
            line.style.top = `${top}px`;
            bothInner.appendChild(line);
          }
        }
      } catch (e) {
        log('debug', 'failed to draw hour lines', e);
      }

      const nowLine = document.createElement('div');
      nowLine.className = 'grid-nowline';
      nowLine.style.display = 'none';
      bothInner.appendChild(nowLine);
      bothInner._nowLine = nowLine;
      bothInner._allStart = allStart;
      bothInner._allEnd = allEnd;
      bothInner._totalHeight = totalHeight;

      const hiddenCount = Array.isArray(dayLessons)
        ? Math.max(0, dayLessons.length - (Array.isArray(lessonsToRender) ? lessonsToRender.length : 0))
        : 0;
      if (hiddenCount > 0) {
        const moreBadge = document.createElement('div');
        moreBadge.className = 'grid-more-badge';
        moreBadge.innerText = ctx.translate('more');
        moreBadge.title = `${hiddenCount} weitere Stunde${hiddenCount > 1 ? 'n' : ''} ausgeblendet`;
        moreBadge.style.position = 'absolute';
        moreBadge.style.right = '6px';
        moreBadge.style.bottom = '6px';
        moreBadge.style.zIndex = 30;
        moreBadge.style.padding = '2px 6px';
        moreBadge.style.background = 'rgba(0,0,0,0.45)';
        moreBadge.style.color = '#fff';
        moreBadge.style.borderRadius = '4px';
        moreBadge.style.fontSize = '0.85em';
        moreBadge.style.cursor = 'default';
        bothInner.appendChild(moreBadge);
      }

      if (!Array.isArray(lessonsToRender) || lessonsToRender.length === 0) {
        const noLesson = document.createElement('div');
        noLesson.className = 'grid-lesson lesson lesson-content no-lesson';
        noLesson.style.position = 'absolute';
        noLesson.style.top = '0px';
        noLesson.style.left = '0px';
        noLesson.style.right = '0px';
        noLesson.style.height = `${totalHeight}px`;
        noLesson.innerHTML = `<b>${ctx.translate('no-lessons')}</b>`;

        bothInner.appendChild(noLesson);
      }

      for (let idx = 0; idx < lessonsToRender.length; idx++) {
        const lesson = lessonsToRender[idx];

        const hasExam = lessonHasExam(lesson);

        let sMin = lesson.startMin;
        let eMin = lesson.endMin;
        sMin = Math.max(sMin, allStart);
        eMin = Math.min(eMin, allEnd);
        if (eMin <= sMin) continue;
        const topPx = Math.round(((sMin - allStart) / totalMinutes) * totalHeight);
        const heightPx = Math.max(12, Math.round(((eMin - sMin) / totalMinutes) * totalHeight));

        // Use ctx._currentTodayYmd (which respects debugDate) instead of real system date
        let nowYmd = ctx._currentTodayYmd;
        if (nowYmd === undefined || nowYmd === null) {
          const now = new Date();
          nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
        }
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const lessonYmd = Number(dateStr) || 0;
        let isPast = false;
        if (lessonYmd < nowYmd) {
          isPast = true;
        } else if (lessonYmd === nowYmd) {
          if (typeof eMin === 'number' && !Number.isNaN(eMin) && eMin <= nowMin) isPast = true;
        } else {
          isPast = false;
        }

        const leftCell = document.createElement('div');
        leftCell.className = 'grid-lesson lesson';
        leftCell.style.position = 'absolute';
        leftCell.style.top = `${topPx}px`;
        leftCell.style.left = '0px';
        leftCell.style.right = '0px';
        leftCell.style.height = `${heightPx}px`;
        leftCell.setAttribute('data-date', dateStr);
        leftCell.setAttribute('data-end-min', String(eMin));

        const rightCell = document.createElement('div');
        rightCell.className = 'grid-lesson lesson';
        rightCell.style.position = 'absolute';
        rightCell.style.top = `${topPx}px`;
        rightCell.style.left = '0px';
        rightCell.style.right = '0px';
        rightCell.style.height = `${heightPx}px`;
        rightCell.setAttribute('data-date', dateStr);
        rightCell.setAttribute('data-end-min', String(eMin));

        const bothCell = document.createElement('div');
        bothCell.className = 'grid-lesson lesson';
        bothCell.style.position = 'absolute';
        bothCell.style.top = `${topPx}px`;
        bothCell.style.left = '0px';
        bothCell.style.right = '0px';
        bothCell.style.height = `${heightPx}px`;
        bothCell.setAttribute('data-date', dateStr);
        bothCell.setAttribute('data-end-min', String(eMin));

        const makeInner = (lsn) => {
          const base = `<b>${escapeHtml(lsn.subjectShort || lsn.subject)}</b><br>${escapeHtml(lsn.teacherInitial || lsn.teacher)}`;
          const subst = lsn.substText ? `<br><span class='xsmall dimmed'>${escapeHtml(lsn.substText).replace(/\n/g, '<br>')}</span>` : '';
          const txt = lsn.text ? `<br><span class='xsmall dimmed'>${escapeHtml(lsn.text).replace(/\n/g, '<br>')}</span>` : '';
          return `<div class='lesson-content'>${base + subst + txt}</div>`;
        };

        if (lesson.code === 'irregular' || lesson.status === 'SUBSTITUTION') {
          leftCell.classList.add('lesson-replacement');
          if (hasExam) leftCell.classList.add('has-exam');
          if (isPast) leftCell.classList.add('past');
          leftCell.innerHTML = makeInner(lesson);
        } else if (lesson.code === 'cancelled' || lesson.status === 'CANCELLED') {
          rightCell.classList.add('lesson-cancelled-split');
          if (hasExam) rightCell.classList.add('has-exam');
          if (isPast) rightCell.classList.add('past');
          rightCell.innerHTML = makeInner(lesson);
        } else {
          bothCell.classList.add('lesson-regular');
          if (hasExam) bothCell.classList.add('has-exam');
          if (isPast) bothCell.classList.add('past');
          bothCell.innerHTML = makeInner(lesson);
        }

        if (homeworks && Array.isArray(homeworks) && homeworks.length > 0) {
          // Match homework by dueDate and subject name/longname (all su entries, both lesson and homework)
          const lessonDate = Number(lesson.date);
          const lessonNames = Array.isArray(lesson.su) ? lesson.su.flatMap((su) => [su.name, su.longname].filter(Boolean)) : [];

          const hwMatch = homeworks.some((hw) => {
            const hwDueDate = Number(hw.dueDate);
            // homework su can be object or array (defensive)
            const hwSuArr = Array.isArray(hw.su) ? hw.su : hw.su ? [hw.su] : [];
            const hwNames = hwSuArr.flatMap((su) => [su.name, su.longname].filter(Boolean));
            const subjectMatch = lessonNames.some((ln) => hwNames.includes(ln));
            const matches = hwDueDate === lessonDate && subjectMatch;
            return matches;
          });
          if (hwMatch) {
            const icon = document.createElement('span');
            icon.className = 'homework-icon';
            icon.innerHTML = '📘';
            if (lesson.code === 'irregular' || lesson.status === 'SUBSTITUTION') {
              if (leftCell && leftCell.innerHTML) leftCell.appendChild(icon.cloneNode(true));
            } else if (lesson.code === 'cancelled' || lesson.status === 'CANCELLED') {
              if (rightCell && rightCell.innerHTML) rightCell.appendChild(icon.cloneNode(true));
            } else {
              if (bothCell && bothCell.innerHTML) bothCell.appendChild(icon.cloneNode(true));
            }
          }
        }

        if (lesson.code === 'irregular' || lesson.status === 'SUBSTITUTION') {
          leftInner.appendChild(leftCell);
        } else if (lesson.code === 'cancelled' || lesson.status === 'CANCELLED') {
          rightInner.appendChild(rightCell);
        } else {
          bothInner.appendChild(bothCell);
        }
      }
    }

    wrapper.appendChild(grid);

    // Draw nowLine immediately on first render (no need to wait for the next minute tick).
    // Use the local wrapper scope so this works even before MagicMirror inserts the DOM.
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
