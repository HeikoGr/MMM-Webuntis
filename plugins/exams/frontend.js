(function registerExamsPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  const sharedDom = root.MMMWebuntisFrontendShared?.dom;
  if (!host || typeof host.registerFrontendPlugin !== "function" || !sharedDom) {
    return;
  }

  const { addHeader, addRow, createContainer, createElement, escapeHtml } = sharedDom;

  function formatFallbackDate(ymd) {
    const numeric = Number(ymd) || 0;
    const fallbackDay = String(numeric % 100).padStart(2, "0");
    const fallbackMonth = String(Math.floor(numeric / 100) % 100).padStart(2, "0");
    return `${fallbackDay}.${fallbackMonth}.`;
  }

  function formatDisplayDateValue(ymd, format) {
    const formatter = root.MMMWebuntisFrontendShared?.util?.formatDisplayDate;
    if (typeof formatter === "function") {
      return formatter(ymd, format);
    }
    return formatFallbackDate(ymd);
  }

  function currentTimeAsHHMM(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
    return date.getHours() * 100 + date.getMinutes();
  }

  function getCurrentDateContext(studentConfig) {
    return root.MMMWebuntisFrontendShared.time.getCurrentDateContext(studentConfig);
  }

  function compareByDateAndStartTime(left, right) {
    const dateCompare = (Number(left?.examDate) || 0) - (Number(right?.examDate) || 0);
    if (dateCompare !== 0) return dateCompare;
    return (Number(left?.startTime) || 0) - (Number(right?.startTime) || 0);
  }

  function getFieldDisplayName(entry, format = "short") {
    if (entry === null || entry === undefined) return "";

    if (typeof entry === "string" || typeof entry === "number") {
      return String(entry).trim();
    }

    if (typeof entry !== "object") return "";

    const shortName = String(entry.name ?? "").trim();
    const longName = String(entry.longname ?? "").trim();
    return format === "long" ? longName || shortName : shortName || longName;
  }

  function getFirstFieldName(entries, format = "short") {
    if (!Array.isArray(entries) || entries.length === 0) return "";
    return getFieldDisplayName(entries[0], format);
  }

  function normalizeDays(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
  }

  function resolveStudentConfig(studentSlice) {
    const config = studentSlice?.context?.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return {};
    }
    return config;
  }

  function resolveExamConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.exams?.config && typeof studentConfig.plugins.exams.config === "object"
        ? studentConfig.plugins.exams.config
        : {};

    return { ...pluginConfig };
  }

  function isVerboseMode(studentConfig) {
    return (
      String(studentConfig?.mode ?? "compact")
        .trim()
        .toLowerCase() === "verbose"
    );
  }

  function translate(pluginContext, key, fallback, replacements) {
    if (typeof pluginContext?.translate !== "function") return fallback;
    const translated = pluginContext.translate(key, fallback, replacements);
    return translated || fallback;
  }

  function buildHeaderTitle(pluginContext, studentName, examConfig) {
    const title = escapeHtml(translate(pluginContext, "exams", "Exams"));
    const daysLabel = translate(pluginContext, "widget_filter_days", "days");
    const nextDays = normalizeDays(examConfig?.nextDays, 0);
    const filterLabel = `+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || "").trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return `${title} <span class="wu-header-meta">(${escapeHtml(meta)})</span>`;
  }

  /** An exam still ahead (or running) at the given day and time; debug mode keeps past ones. */
  function isUpcoming(exam, nowYmd, nowHm) {
    const examYmd = Number(exam?.examDate) || 0;
    const examHm = Number(exam?.startTime) || 0;
    return !(examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm));
  }

  /** Name cell of one exam: optional subject, name, optional teacher, description. */
  function buildNameCell(exam, showSubject, showTeacher) {
    const name = `<span class="wu-exam__name">${escapeHtml(exam?.name)}</span>`;
    let cell = showSubject ? `<span class="wu-exam__subject">${escapeHtml(exam?.subject)}</span>: &nbsp;${name}` : name;

    const teacher = showTeacher ? getFirstFieldName(exam?.teachers, "short") : "";
    if (teacher) {
      cell += `&nbsp;<span class="teacher-name wu-exam__teacher">(${escapeHtml(teacher)})</span>`;
    }
    if (exam?.text) {
      cell += `<br/><span class="wu-exam__description">${escapeHtml(exam.text)}</span>`;
    }
    return cell;
  }

  /** Container with the verbose-mode header, for a student with something to show. */
  function createStudentContainer(pluginContext, studentSlice, studentConfig, examConfig) {
    const studentTitle = String(studentSlice?.student?.title || "").trim();
    const verboseMode = isVerboseMode(studentConfig);
    const container = createContainer();
    if (verboseMode && studentTitle) {
      addHeader(container, buildHeaderTitle(pluginContext, studentTitle, examConfig));
    }
    return { container, studentLabelText: verboseMode ? "" : escapeHtml(studentTitle) };
  }

  /**
   * One student's exams, or null when there is nothing to show: the widget is off for the student
   * (nextDays <= 0), no exam is ahead, or the list is empty without the collection being unavailable.
   */
  function renderStudent(pluginContext, studentSlice, includePastExams) {
    const exams = Array.isArray(studentSlice?.data?.exams) ? studentSlice.data.exams : [];
    const studentConfig = resolveStudentConfig(studentSlice);
    const examConfig = resolveExamConfig(studentConfig);
    if (normalizeDays(examConfig?.nextDays, 0) <= 0) return null;

    if (exams.length === 0) {
      if (studentSlice?.state?.collections?.exams?.status !== "unavailable") return null;
      const { container, studentLabelText } = createStudentContainer(
        pluginContext,
        studentSlice,
        studentConfig,
        examConfig,
      );
      addRow(
        container,
        "examRowEmpty unavailable-notice",
        studentLabelText,
        escapeHtml(translate(pluginContext, "unavailable", "data unavailable")),
      );
      return container;
    }

    const dateContext = getCurrentDateContext(studentConfig);
    const nowYmd = Number(dateContext?.ymd) || 0;
    const nowHm = currentTimeAsHHMM(dateContext?.date);
    const visibleExams = exams
      .slice()
      .sort(compareByDateAndStartTime)
      .filter((exam) => includePastExams || isUpcoming(exam, nowYmd, nowHm));
    if (visibleExams.length === 0) return null;

    const { container, studentLabelText } = createStudentContainer(
      pluginContext,
      studentSlice,
      studentConfig,
      examConfig,
    );
    const showSubject = Boolean(examConfig?.showSubject);
    const showTeacher = Boolean(examConfig?.showTeacher);
    for (const exam of visibleExams) {
      const formattedDate = formatDisplayDateValue(Number(exam?.examDate) || 0, examConfig?.dateFormat);
      const dateTimeCell = formattedDate ? `<span class="wu-exam__date">${escapeHtml(formattedDate)}</span>` : "";
      addRow(container, "examRow", studentLabelText, dateTimeCell, buildNameCell(exam, showSubject, showTeacher));
    }
    return container;
  }

  host.registerFrontendPlugin({
    id: "exams",
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = createElement("section", "wu-plugin wu-plugin-exams");
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          // Debug mode keeps past exams visible.
          const logLevel = String(renderContext?.runtime?.logLevel || root.MMMWebuntisLogLevel || "")
            .trim()
            .toLowerCase();
          const includePastExams = logLevel === "debug";

          const containers = students
            .map((studentSlice) => renderStudent(pluginContext, studentSlice, includePastExams))
            .filter(Boolean);
          for (const container of containers) {
            wrapper.appendChild(container);
          }
          return containers.length > 0 ? wrapper : null;
        },
      };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
