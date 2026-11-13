(function registerExamsPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  if (!host || typeof host.registerFrontendPlugin !== "function") {
    return;
  }

  // DOM, time and formatting helpers come from pluginContext (docs/PLUGINS.md), not from the global.

  function resolveExamConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.exams?.config && typeof studentConfig.plugins.exams.config === "object"
        ? studentConfig.plugins.exams.config
        : {};

    return { ...pluginConfig };
  }

  function buildHeaderTitle(pluginContext, studentName, examConfig) {
    const { headerTitleNodes } = pluginContext.dom;
    const title = pluginContext.translate("exams", "Exams");
    const daysLabel = pluginContext.translate("widget_filter_days", "days");
    const nextDays = pluginContext.widget.normalizeDays(examConfig?.nextDays, 0);
    const filterLabel = `+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || "").trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return headerTitleNodes(title, meta);
  }

  /** An exam still ahead (or running) at the given day and time; debug mode keeps past ones. */
  function isUpcoming(exam, nowYmd, nowHm) {
    const examYmd = Number(exam?.examDate) || 0;
    const examHm = Number(exam?.startTime) || 0;
    return !(examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm));
  }

  /** Name cell of one exam: optional subject, name, optional teacher, description. */
  function buildNameCell(pluginContext, exam, showSubject, showTeacher) {
    const { el } = pluginContext.dom;
    const name = el("span", "wu-exam__name", exam?.name);
    const cell = showSubject ? [el("span", "wu-exam__subject", exam?.subject), ": \u00a0", name] : [name];

    const teacher = showTeacher ? pluginContext.widget.getFirstFieldName(exam?.teachers, "short") : "";
    if (teacher) {
      cell.push("\u00a0", el("span", "teacher-name wu-exam__teacher", `(${teacher})`));
    }
    if (exam?.text) {
      cell.push(document.createElement("br"), el("span", "wu-exam__description", exam.text));
    }
    return cell;
  }

  /** Container with the verbose-mode header, for a student with something to show. */
  function createStudentContainer(pluginContext, studentSlice, studentConfig, examConfig) {
    const studentTitle = String(studentSlice?.student?.title || "").trim();
    const verboseMode = pluginContext.widget.isVerboseMode(studentConfig);
    const { addHeader, createContainer } = pluginContext.dom;
    const container = createContainer();
    if (verboseMode && studentTitle) {
      addHeader(container, buildHeaderTitle(pluginContext, studentTitle, examConfig));
    }
    return { container, studentLabelText: verboseMode ? "" : studentTitle };
  }

  /**
   * One student's exams, or null when there is nothing to show: the widget is off for the student
   * (nextDays <= 0), no exam is ahead, or the list is empty without the collection being unavailable.
   */
  function renderStudent(pluginContext, studentSlice, includePastExams) {
    const { addRow, el } = pluginContext.dom;
    const { currentTimeAsHHMM, getCurrentDateContext } = pluginContext.time;
    const exams = Array.isArray(studentSlice?.data?.exams) ? studentSlice.data.exams : [];
    const studentConfig = pluginContext.widget.resolveStudentConfig(studentSlice);
    const examConfig = resolveExamConfig(studentConfig);
    if (pluginContext.widget.normalizeDays(examConfig?.nextDays, 0) <= 0) return null;

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
        pluginContext.translate("unavailable", "data unavailable"),
      );
      return container;
    }

    const dateContext = getCurrentDateContext(studentConfig);
    const nowYmd = Number(dateContext?.ymd) || 0;
    const nowHm = currentTimeAsHHMM(dateContext?.date);
    const visibleExams = exams
      .slice()
      .sort((left, right) => pluginContext.widget.compareByDateAndStartTime(left, right, { dateKey: "examDate" }))
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
      const formattedDate = pluginContext.formatting.formatDisplayDate(
        Number(exam?.examDate) || 0,
        examConfig?.dateFormat,
      );
      const dateTimeCell = formattedDate ? el("span", "wu-exam__date", formattedDate) : "";
      addRow(
        container,
        "examRow",
        studentLabelText,
        dateTimeCell,
        buildNameCell(pluginContext, exam, showSubject, showTeacher),
      );
    }
    return container;
  }

  host.registerFrontendPlugin({
    id: "exams",
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = pluginContext.dom.createElement("section", "wu-plugin wu-plugin-exams");
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
