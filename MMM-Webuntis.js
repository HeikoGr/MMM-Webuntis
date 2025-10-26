Module.register("MMM-Webuntis", {

  defaults: {
    header: "WebUntis", // no header by default
    students: [
      {
        title: "SET CONFIG!",
        qrcode: "",
        school: "",
        username: "",
        password: "",
        server: "",
        class: ""
      }
    ],
    days: 7,                        // number of days to show per student
    fetchInterval: 15 * 60 * 1000,  // 15 minutes
    showStartTime: false,           // whether to show start time in lesson listings
    useClassTimetable: false,       // whether to use class timetable instead of student timetable
    showRegularLessons: false,      // whether to show regular lessons (not only substitutions)
    showTeacher: true,              // whether to show teacher initials/names
    shortSubject: false,            // whether to use short subject names
    showSubstText: false,           // whether to show substitution text
    examsDays: 0,                   // number of days ahead to show exams
    examsShowSubject: true,         // whether to show subject in exam listings
    examsShowTeacher: true,         // whether to show teacher in exam listings
    mode: "verbose",                // 'verbose' or 'compact' mode
    debug: true,                    // enable debug logging
    mergeGapMin: 15,                // maximum gap in minutes allowed between consecutive lessons to merge
    debugLastDays: 0,               // number of past days to include in debug mode
    displayMode: "grid"             // 'list' (default) or 'grid'
  },

  getStyles() {
    return ["MMM-Webuntis.css"];
  },

  getTranslations() {
    return {
      en: "translations/en.json",
      de: "translations/de.json"
    };
  },

  /* Helper to add a table header row */
  _addTableHeader(table, studentTitle = "") {
    const thisRow = document.createElement("tr");
    const cellType = "th";
    const studentCell = document.createElement(cellType);
    studentCell.innerHTML = studentTitle;
    studentCell.colSpan = 3;
    studentCell.className = "align-left alignTop";
    thisRow.appendChild(studentCell);
    table.appendChild(thisRow);
  },

  /* Helper to add a table row */
  _addTableRow(table, type, studentTitle = "", text1 = "", text2 = "", addClass = "") {
    const thisRow = document.createElement("tr");
    thisRow.className = type;
    const cellType = "td";

    if (studentTitle != "") {
      const studentCell = document.createElement(cellType);
      studentCell.innerHTML = studentTitle;
      studentCell.className = "align-left alignTop bold";
      thisRow.appendChild(studentCell);
    }

    const cell1 = document.createElement(cellType);
    if (text2 == "") {
      cell1.colSpan = 2;
    }
    cell1.innerHTML = text1;
    cell1.className = "align-left alignTop ";
    thisRow.appendChild(cell1);

    if (text2 != "") {
      const cell2 = document.createElement(cellType);
      cell2.innerHTML = text2;
      cell2.className = `align-left alignTop ${addClass}`;
      thisRow.appendChild(cell2);
    }

    table.appendChild(thisRow);
  },

  /* Tooltip helpers (single global tooltip element) */
  _ensureTooltip() {
    let tooltip = document.getElementById('webuntis-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'webuntis-tooltip';
      tooltip.className = 'webuntis-tooltip';
      document.body.appendChild(tooltip);
    }
    return tooltip;
  },

  _showTooltip(e, data) {
    const tooltip = this._ensureTooltip();
    try {
      const txt = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      tooltip.innerText = txt;
      tooltip.style.display = 'block';
      const pad = 12;
      const x = Math.min(window.innerWidth - pad - tooltip.offsetWidth, e.clientX + 12);
      const y = Math.min(window.innerHeight - pad - tooltip.offsetHeight, e.clientY + 12);
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    } catch (err) {
      tooltip.innerText = String(data);
      tooltip.style.display = 'block';
    }
  },

  _hideTooltip() {
    const tooltip = document.getElementById('webuntis-tooltip');
    if (tooltip) tooltip.style.display = 'none';
  },

  /* Render the multi-day grid for a student: returns a DOM element containing header and grid */
  _renderGridForStudent(studentConfig, lessons, homeworks, timeUnits) {
    // number of upcoming days to show (per-student config overrides module config)
    const daysToShow = (studentConfig.days && studentConfig.days > 0) ? parseInt(studentConfig.days) : 1;
    // debugLastDays: how many past days to include (can be set per-student or globally)
    const pastDays = Math.max(0, parseInt(studentConfig.debugLastDays ?? this.config.debugLastDays ?? 0));
    // start offset (negative means we start in the past)
    const startOffset = -pastDays;
    // total days displayed = pastDays + future/current window
    const totalDisplayDays = daysToShow;

    const header = document.createElement('div');
    header.className = 'webuntis-grid-days-header';
    // build columns: first column is time axis, then for each displayed day two columns (left/right)
    const cols = ["minmax(60px,auto)"];
    for (let d = 0; d < totalDisplayDays; d++) {
      cols.push('1fr'); // left half
      cols.push('1fr'); // right half
    }
    header.style.gridTemplateColumns = cols.join(' ');

    const emptyHeader = document.createElement('div');
    emptyHeader.className = 'webuntis-grid-days-header-empty';
    header.appendChild(emptyHeader);

    const today = new Date();
    // day loop now accounts for past days by applying startOffset
    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d; // negative for past days
      const dayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayIndex);
      const dayLabel = document.createElement('div');
      dayLabel.className = 'webuntis-grid-daylabel';
      dayLabel.innerText = `${dayDate.toLocaleDateString(config.language, { weekday: 'short', day: 'numeric', month: 'numeric' })}`;
      // span both columns for this day
      const startCol = 2 + d * 2;
      const endCol = startCol + 2;
      dayLabel.style.gridColumn = `${startCol} / ${endCol}`;
      header.appendChild(dayLabel);
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'webuntis-grid-combined';
    // We position lessons absolutely inside per-day columns based on exact start/end times.
    grid.style.gridTemplateColumns = cols.join(' ');

    // NOTE: minute conversion is performed in node_helper; this frontend relies on
    // the numeric fields `startMin` / `endMin` on lessons and timeUnits.

    let allStart = Infinity;
    let allEnd = -Infinity;
    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      timeUnits.forEach(u => {
        if (u.startMin !== undefined && u.startMin !== null) allStart = Math.min(allStart, u.startMin);
        if (u.endMin !== undefined && u.endMin !== null) allEnd = Math.max(allEnd, u.endMin);
      });
    } else {
      // compute from lessons but filter out full-day-ish events (>= 12h)
      lessons.forEach(l => {
        if (l.startMin !== undefined && l.startMin !== null && l.endMin !== undefined && l.endMin !== null) {
          const s = l.startMin;
          const e = l.endMin;
          if ((e - s) < 12 * 60) {
            allStart = Math.min(allStart, s);
            allEnd = Math.max(allEnd, e);
          }
        } else if (l.startMin !== undefined && l.startMin !== null) {
          allStart = Math.min(allStart, l.startMin);
        }
      });
    }

    if (!isFinite(allStart) || allEnd <= allStart) {
      // fallback to standard school day
      allStart = 7 * 60; // 07:00
      allEnd = 17 * 60; // 17:00
    }

    const totalMinutes = allEnd - allStart;
    // visual scale: pixels per minute (2px/min gives ~120px for 2 hours)
    const pxPerMinute = 1;
    const totalHeight = Math.max(120, Math.round(totalMinutes * pxPerMinute));

    // Create time axis column as the left column with absolute-positioned labels
    const timeAxis = document.createElement('div');
    timeAxis.className = 'webuntis-grid-timecell';
    // inner timeline container
    const timeInner = document.createElement('div');
    timeInner.style.position = 'relative';
    timeInner.style.height = `${totalHeight}px`;
    timeInner.style.width = '100%';
    // add markers from timeUnits or hourly markers
    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      for (let u of timeUnits) {
        if (u.startMin === undefined || u.startMin === null) continue;
        const m = u.startMin;
        const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
        const lab = document.createElement('div');
        lab.style.position = 'absolute';
        lab.style.top = `${top}px`;
        lab.style.left = '4px';
        lab.style.zIndex = 2; // ensure label sits above hour lines
        lab.style.fontSize = '0.85em';
        lab.style.color = '#666';
        lab.innerText = `${u.name} Std.\n ${String(u.startTime).padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2')}`;
        timeInner.appendChild(lab);
        // mirror hour line in the time axis to match day columns
        if (u.endMin !== undefined && u.endMin !== null && u.endMin >= allStart && u.endMin <= allEnd) {
          const lineTop = Math.round(((u.endMin - allStart) / totalMinutes) * totalHeight);
          const tline = document.createElement('div');
          tline.className = 'webuntis-grid-hourline';
          tline.style.top = `${lineTop + 2}px`;
          timeInner.appendChild(tline);
        }
      }
    } else {
      // hourly markers
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
        // add corresponding hour line
        const tline = document.createElement('div');
        tline.className = 'webuntis-grid-hourline';
        tline.style.top = `${top}px`;
        timeInner.appendChild(tline);
      }
    }
    timeAxis.appendChild(timeInner);
    timeAxis.style.gridColumn = '1';
    grid.appendChild(timeAxis);

    const allLessons = lessons.slice();
    // build one column group per displayed day; account for past days by applying startOffset
    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const targetDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayIndex);
      const dateStr = `${targetDate.getFullYear()}${('0' + (targetDate.getMonth() + 1)).slice(-2)}${('0' + targetDate.getDate()).slice(-2)}`;

      const dayLessons = allLessons.filter(l => {
        const norm = `${l.year}${('0' + l.month).slice(-2)}${('0' + l.day).slice(-2)}`;
        return norm === dateStr;
      }).sort((a, b) => a.startTime - b.startTime);

      // merge double lessons
      const mergedLessons = [];
      for (let i = 0; i < dayLessons.length; i++) {
        let curr = { ...dayLessons[i] };
        // preserve all lesson ids for merged lessons
        curr.lessonIds = [];
        const firstId = curr.lessonId ?? curr.id ?? curr.lid ?? null;
        if (firstId !== null && firstId !== undefined) curr.lessonIds.push(String(firstId));
        // ensure text fields exist
        curr.substText = curr.substText || '';
        curr.text = curr.text || '';
        let j = i + 1;
        // Merge loop: use numeric minute comparisons and configurable gap (mergeGapMin)
        while (j < dayLessons.length) {
          const cand = dayLessons[j];
          const currEndMin = (curr.endMin !== undefined && curr.endMin !== null) ? curr.endMin : null;
          const candStartMin = (cand.startMin !== undefined && cand.startMin !== null) ? cand.startMin : null;
          const candEndMin = (cand.endMin !== undefined && cand.endMin !== null) ? cand.endMin : null;
          const gapMin = candStartMin - currEndMin;
          const allowedGap = Number(this.config.mergeGapMin ?? 15);
          const sameContent = (cand.subjectShort === curr.subjectShort && cand.teacherInitial === curr.teacherInitial && cand.code === curr.code);

          // require candidate to start at or after current end, within allowed gap, and same content
          if (currEndMin === null || candStartMin === null) {
            // missing numeric times: cannot reliably merge; break
            break;
          }
          if (!(candStartMin >= currEndMin && gapMin <= allowedGap && sameContent)) {
            break;
          }

          // extend merged lesson (update both string times and numeric minutes)
          curr.endTime = cand.endTime;
          curr.endMin = candEndMin !== null ? candEndMin : (candStartMin + 45);
          curr.substText = curr.substText || '';
          curr.text = curr.text || '';
          if (cand.substText && !curr.substText.includes(cand.substText)) curr.substText += `\n${cand.substText}`;
          if (cand.text && !curr.text.includes(cand.text)) curr.text += `\n${cand.text}`;
          // collect lesson ids
          const addId = cand.lessonId ?? cand.id ?? cand.lid ?? null;
          if (addId !== null && addId !== undefined) curr.lessonIds.push(String(addId));
          j++;
        }
        // ensure lessonId remains available for backward compatibility
        if ((!curr.lessonId || curr.lessonId === null) && curr.lessonIds && curr.lessonIds.length > 0) curr.lessonId = curr.lessonIds[0];
        // ensure numeric bounds on merged lesson exist
        if (curr.startMin === undefined || curr.startMin === null) {
          // try to take from curr.startTime if possible (no conversion allowed here) -> skip if not present
          // In normal operation node_helper provides startMin; log in debug
          if (this.config.debug) console.warn('[MMM-Webuntis] merged lesson missing startMin', curr);
        }
        if (curr.endMin === undefined || curr.endMin === null) {
          // if still missing, try set endMin = startMin + 45 when startMin available
          if (curr.startMin !== undefined && curr.startMin !== null) curr.endMin = curr.startMin + 45;
        }
        mergedLessons.push(curr);
        i = j - 1;
      }

      const colLeft = 2 + d * 2;
      const colRight = colLeft + 1;

      // Create per-day wrappers once: left, right and both (span both columns)
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
      bothWrap.style.gridColumn = `${colLeft} / ${colRight + 1}`; // span both columns
      bothWrap.style.gridRow = '1';
      const bothInner = document.createElement('div');
      bothInner.className = 'day-column-inner';
      bothInner.style.height = `${totalHeight}px`;
      bothInner.style.position = 'relative';
      bothWrap.appendChild(bothInner);

      // append wrappers to grid (bothWrap first so it sits behind left/right if overlapping)
      grid.appendChild(bothWrap);
      grid.appendChild(leftWrap);
      grid.appendChild(rightWrap);

      // add thin hour divider lines to the day's background (use timeUnits if available)
      try {
        if (Array.isArray(timeUnits) && timeUnits.length > 0) {
          for (let u of timeUnits) {
            if (u.endMin === undefined || u.endMin === null) continue;
            // only draw if within visible range
            if (u.endMin < allStart || u.endMin > allEnd) continue;
            const top = Math.round(((u.endMin - allStart) / totalMinutes) * totalHeight);
            const line = document.createElement('div');
            line.className = 'webuntis-grid-hourline';
            line.style.top = `${top + 2}px`;
            bothInner.appendChild(line);
          }
        } else {
          for (let m = Math.ceil(allStart / 60) * 60; m <= allEnd; m += 60) {
            const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
            const line = document.createElement('div');
            line.className = 'webuntis-grid-hourline';
            line.style.top = `${top}px`;
            bothInner.appendChild(line);
          }
        }
      } catch (e) {
        // non-fatal if drawing hour lines fails
        if (this.config.debug) console.warn('[MMM-Webuntis] failed to draw hour lines', e);
      }

      // Create and append 'now' line for this day and register to updater
      const nowLine = document.createElement('div');
      nowLine.className = 'webuntis-grid-nowline';
      bothInner.appendChild(nowLine);
      // store reference on wrapper for updater
      bothInner._nowLine = nowLine;
      bothInner._allStart = allStart;
      bothInner._allEnd = allEnd;
      bothInner._totalHeight = totalHeight;

      // virtual no-lessons block when none -> create a single block spanning both columns
      if (mergedLessons.length === 0) {
        const noLesson = document.createElement('div');
        noLesson.className = 'webuntis-grid-lesson lesson no-lesson';
        noLesson.style.position = 'absolute';
        noLesson.style.top = '0px';
        noLesson.style.left = '0px';
        noLesson.style.right = '0px';
        noLesson.style.height = `${totalHeight}px`;
        noLesson.innerHTML = `<b>kein Unterricht</b>`;
        noLesson.addEventListener('mouseenter', e => this._showTooltip(e, { note: 'kein Unterricht' }));
        noLesson.addEventListener('mousemove', e => this._showTooltip(e, { note: 'kein Unterricht' }));
        noLesson.addEventListener('mouseleave', () => this._hideTooltip());
        bothInner.appendChild(noLesson);
      }

      for (let idx = 0; idx < mergedLessons.length; idx++) {
        const lesson = mergedLessons[idx];

        // compute absolute positioning within the day's column using minutes
        // compute start/end minutes and clamp them to the visible range
        let sMin = lesson.startMin;
        let eMin = lesson.endMin;
        // clamp to within first/last lesson times so full-day events don't expand the timeline
        sMin = Math.max(sMin, allStart);
        eMin = Math.min(eMin, allEnd);
        // skip lessons that do not overlap the visible range
        if (eMin <= sMin) continue;
        const topPx = Math.round(((sMin - allStart) / totalMinutes) * totalHeight);
        const heightPx = Math.max(12, Math.round(((eMin - sMin) / totalMinutes) * totalHeight));

        // create lesson elements depending on type
        const leftCell = document.createElement('div');
        leftCell.className = 'webuntis-grid-lesson lesson';
        leftCell.style.position = 'absolute';
        leftCell.style.top = `${topPx}px`;
        leftCell.style.left = '0px';
        leftCell.style.right = '0px';
        leftCell.style.height = `${heightPx}px`;

        const rightCell = document.createElement('div');
        rightCell.className = 'webuntis-grid-lesson lesson';
        rightCell.style.position = 'absolute';
        rightCell.style.top = `${topPx}px`;
        rightCell.style.left = '0px';
        rightCell.style.right = '0px';
        rightCell.style.height = `${heightPx}px`;

        const bothCell = document.createElement('div');
        bothCell.className = 'webuntis-grid-lesson lesson';
        bothCell.style.position = 'absolute';
        bothCell.style.top = `${topPx}px`;
        bothCell.style.left = '0px';
        bothCell.style.right = '0px';
        bothCell.style.height = `${heightPx}px`;

        const makeInner = (lsn) => {
          const base = `<b>${lsn.subjectShort || lsn.subject}</b><br>${lsn.teacherInitial || lsn.teacher}`;
          const subst = lsn.substText ? `<br><span class='xsmall dimmed'>${lsn.substText.replace(/\n/g, '<br>')}</span>` : '';
          const txt = lsn.text ? `<br><span class='xsmall dimmed'>${lsn.text.replace(/\n/g, '<br>')}</span>` : '';
          return `<div class='lesson-content'>${base + subst + txt}</div>`;
        };

        if (lesson.code === 'irregular') {
          leftCell.classList.add('lesson-replacement');
          leftCell.innerHTML = makeInner(lesson);
        } else if (lesson.code === 'cancelled') {
          rightCell.classList.add('lesson-cancelled-split');
          rightCell.innerHTML = makeInner(lesson);
        } else {
          bothCell.classList.add('lesson-regular');
          bothCell.innerHTML = makeInner(lesson);
        }

        if (homeworks && Array.isArray(homeworks)) {
          const hwMatch = homeworks.some(hw => {
            const hwLessonId = hw.lessonId ?? hw.lid ?? hw.id ?? null;
            const lessonLessonId = lesson.lessonId ?? null;
            const lessonIds = lesson.lessonIds && Array.isArray(lesson.lessonIds) ? lesson.lessonIds : (lesson.lessonId ? [String(lesson.lessonId)] : []);
            const lessonIdMatch = hwLessonId && lessonIds.length > 0 ? lessonIds.includes(String(hwLessonId)) : false;
            const subjectMatch = hw.su && (hw.su.name === lesson.subjectShort || hw.su.longname === lesson.subject);
            return lessonIdMatch || subjectMatch;
          });
          if (hwMatch) {
            const icon = document.createElement('span');
            icon.className = 'homework-icon';
            icon.innerHTML = '📘';
            if (leftCell && leftCell.innerHTML) leftCell.appendChild(icon.cloneNode(true));
            else if (rightCell && rightCell.innerHTML) rightCell.appendChild(icon);
          }
        }

        // attach events and append to appropriate wrapper
        if (lesson.code === 'irregular') {
          [leftCell].forEach(c => {
            c.addEventListener('mouseenter', e => this._showTooltip(e, lesson));
            c.addEventListener('mousemove', e => this._showTooltip(e, lesson));
            c.addEventListener('mouseleave', () => this._hideTooltip());
          });
          leftInner.appendChild(leftCell);
        } else if (lesson.code === 'cancelled') {
          [rightCell].forEach(c => {
            c.addEventListener('mouseenter', e => this._showTooltip(e, lesson));
            c.addEventListener('mousemove', e => this._showTooltip(e, lesson));
            c.addEventListener('mouseleave', () => this._hideTooltip());
          });
          rightInner.appendChild(rightCell);
        } else {
          [bothCell].forEach(c => {
            c.addEventListener('mouseenter', e => this._showTooltip(e, lesson));
            c.addEventListener('mousemove', e => this._showTooltip(e, lesson));
            c.addEventListener('mouseleave', () => this._hideTooltip());
          });
          bothInner.appendChild(bothCell);
        }
      }
    }

    wrapper.appendChild(grid);
    // Helper to update now-lines across all day columns inside this grid
    const updateNowLines = () => {
      const inners = grid.querySelectorAll('.day-column-inner');
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      inners.forEach(inner => {
        const nl = inner._nowLine;
        const allS = inner._allStart;
        const allE = inner._allEnd;
        const h = inner._totalHeight;
        if (!nl || allS === undefined || allE === undefined || h === undefined) return;
        // if current time is outside visible range hide the line
        if (nowMin < allS || nowMin > allE) {
          nl.style.display = 'none';
          return;
        }
        nl.style.display = 'block';
        const top = Math.round(((nowMin - allS) / (allE - allS)) * h);
        nl.style.top = `${top}px`;
      });
      if (this.config.debug) console.debug('[MMM-Webuntis] updated now-lines at', new Date().toISOString());
    };

    // initial update and periodic refresh (every 30 seconds)
    try {
      updateNowLines();
      setInterval(updateNowLines, 30 * 1000);
    } catch (e) {
      if (this.config.debug) console.warn('[MMM-Webuntis] now-line updater failed', e);
    }

    return wrapper;
  },

  start() {
    this.lessonsByStudent = [];
    this.examsByStudent = [];
    this.configByStudent = [];
    this.todayLessonsByStudent = [];
    this.timeUnitsByStudent = [];
    this.config.id = this.identifier;
    this.sendSocketNotification("FETCH_DATA", this.config);
  },

  getDom() {
    const wrapper = document.createElement("div");
    const table = document.createElement("table");
    table.className = "bright small light";

    // no student
    if (this.lessonsByStudent === undefined) {
      console.info("[MMM-Webuntis] no student data available");
      return table;
    }

    const sortedStudentTitles = Object.keys(this.lessonsByStudent).sort();

    // iterate through students
    for (const studentTitle of sortedStudentTitles) {
      let addedRows = 0;

      var lessons = this.lessonsByStudent[studentTitle];
      const studentConfig = this.configByStudent[studentTitle];
      var exams = this.examsByStudent[studentTitle];
      var todayLessons = this.todayLessonsByStudent[studentTitle];
      var timeUnits = this.timeUnitsByStudent[studentTitle];

      var homeworks = (this.homeworksByStudent && this.homeworksByStudent[studentTitle]) ? this.homeworksByStudent[studentTitle] : [];
      if (Array.isArray(homeworks) && homeworks.length > 0) {
        console.log(`[MMM-Webuntis] Homeworks für ${studentTitle}:`, homeworks);
      }

      // use module-level helpers: this._addTableHeader / this._addTableRow
      let studentCellTitle = "";

      // only display student name as header cell if there are more than one student
      if (this.config.mode == "verbose" && this.config.students.length > 1) {
        this._addTableHeader(table, studentTitle);
      } else {
        studentCellTitle = studentTitle;
      }

      if (studentConfig && studentConfig.days > 0) {
        const studentTitle = studentConfig.title;
        var lessons = this.lessonsByStudent[studentTitle];

        // sort lessons by start time
        lessons.sort((a, b) => a.sortString - b.sortString);

        // iterate through lessons of current student
        for (let i = 0; i < lessons.length; i++) {
          const lesson = lessons[i];
          var time = new Date(lesson.year, lesson.month - 1, lesson.day, lesson.hour, lesson.minutes);

          // Skip if nothing special or past lessons (unless in debug mode)
          if (!studentConfig.showRegularLessons && lesson.code === "" ||
            time < new Date() && lesson.code !== "error" && !this.config.debug) {
            continue;
          }

          addedRows++;

          let timeStr = `${time.toLocaleDateString(config.language, { weekday: "short" }).toUpperCase()}&nbsp;`;
          if (studentConfig.showStartTime || lesson.lessonNumber === undefined) {
            timeStr += time.toLocaleTimeString(config.language, { hour: "2-digit", minute: "2-digit" });
          } else {
            timeStr += `${lesson.lessonNumber}.`;
          }

          // subject
          let subjectStr = lesson.subject;
          if (studentConfig.shortSubject) {
            subjectStr = lesson.subjectShort;
          }

          // teachers name
          if (studentConfig.showTeacher) {
            if (studentConfig.showTeacher == "initial" && lesson.teacherInitial !== "") {
              subjectStr += "&nbsp;" + `(${lesson.teacherInitial})`;
            } else if (lesson.teacher !== "") {
              subjectStr += "&nbsp;" + `(${lesson.teacher})`;
            }
          }

          // lesson substitute text
          if (studentConfig.showSubstText && lesson.substText !== "") {
            subjectStr += `<br/><span class='xsmall dimmed'>${lesson.substText}</span>`;
          }

          if (lesson.text !== "") {
            if (subjectStr.trim() !== "") {
              subjectStr += "<br/>";
            }
            subjectStr += `<span class='xsmall dimmed'>${lesson.text}</span>`;
          }

          let addClass = "";
          if (lesson.code == "cancelled" || lesson.code == "error" || lesson.code == "info") {
            addClass = lesson.code;
          }

          this._addTableRow(table, "lessonRow", studentCellTitle, timeStr, subjectStr, addClass);
        } // end for lessons

        // add message row if table is empty
        if (addedRows == 0) {
          this._addTableRow(table, "lessonRowEmpty", studentCellTitle, this.translate("nothing"));
        }
      }

      addedRows = 0;
      var exams = this.examsByStudent[studentTitle];

      if (!exams || studentConfig.examsDays == 0) {
        continue;
      }

      // sort exams
      exams.sort((a, b) => a.sortString - b.sortString);

      // iterate through exams of current student
      for (let i = 0; i < exams.length; i++) {
        const exam = exams[i];
        var time = new Date(exam.year, exam.month - 1, exam.day, exam.hour, exam.minutes);

        // Skip if exam has started (unless in debug mode)
        if (time < new Date() && !this.config.debug) {
          continue;
        }

        addedRows++;

        // date and time
        const dateTimeCell = `${time.toLocaleDateString("de-DE", { month: "numeric", day: "numeric" }).toUpperCase()}&nbsp;`;

        // subject of exam
        let nameCell = exam.name;
        if (studentConfig.examsShowSubject) {
          nameCell = `${exam.subject}: &nbsp;${exam.name}`;
        }

        // teachers name
        if (studentConfig.examsShowTeacher) {
          if (exam.teacher) {
            nameCell += "&nbsp;" + `(${exam.teacher})`;
          }
        }

        // exam additional text
        if (exam.text) {
          nameCell += `<br/><span class="xsmall dimmed">${exam.text}</span>`;
        }

        this._addTableRow(table, "examRow", studentCellTitle, dateTimeCell, nameCell);
      } // end for exam

      // add message row if table is empty
      if (addedRows == 0) {
        this._addTableRow(table, "examRowEmpty", studentCellTitle, this.translate("no_exams"));
      }

      // --- Mehrtägiges Tagesstundenplan-Grid anzeigen ---
      if (this.config.displayMode === 'grid') {
        if (timeUnits && timeUnits.length > 0 && lessons && lessons.length > 0) {
          // delegate grid rendering to a helper
          const gridElem = this._renderGridForStudent(studentConfig, lessons, homeworks, timeUnits);
          if (gridElem) wrapper.appendChild(gridElem);
        }
      }
    } // end for students

    wrapper.appendChild(table);
    return wrapper;
  },

  notificationReceived(notification, payload) {
    switch (notification) {
      case "DOM_OBJECTS_CREATED":
        var timer = setInterval(() => {
          this.sendSocketNotification("FETCH_DATA", this.config);
        }, this.config.fetchInterval);
        break;
    }
  },

  socketNotificationReceived(notification, payload) {
    if (this.identifier !== payload.id) {
      return;
    }

    if (notification === "GOT_DATA") {
      if (payload.lessons) {
        this.lessonsByStudent[payload.title] = payload.lessons;
      }
      if (payload.exams) {
        this.examsByStudent[payload.title] = payload.exams;
      }
      if (payload.config) {
        this.configByStudent[payload.title] = payload.config;
      }
      if (payload.todayLessons) {
        this.todayLessonsByStudent[payload.title] = payload.todayLessons;
      }
      if (payload.timeUnits) {
        this.timeUnitsByStudent[payload.title] = payload.timeUnits;
      }
      if (payload.homeworks) {
        if (!this.homeworksByStudent) this.homeworksByStudent = {};
        this.homeworksByStudent[payload.title] = payload.homeworks;
      }

      if (this.config.debug) {
        console.log(`[MMM-Webuntis] data received for ${payload.title}${JSON.stringify(payload, null, 2)}`);
      }
      this.updateDom();
    }
  }
});
