(function registerHomeworkPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  const sharedDom = root.MMMWebuntisFrontendShared?.dom;
  if (!host || typeof host.registerFrontendPlugin !== "function" || !sharedDom) {
    return;
  }

  const { addHeader, addRow, createContainer, createElement, escapeHtml } = sharedDom;

  function translate(pluginContext, key, fallback, replacements) {
    if (typeof pluginContext?.translate !== "function") return fallback;
    const translated = pluginContext.translate(key, fallback, replacements);
    return translated || fallback;
  }

  function normalizeDays(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
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

  function formatDisplayDateValue(ymd, format) {
    const formatter = root.MMMWebuntisFrontendShared?.util?.formatDisplayDate;
    if (typeof formatter === "function") {
      return formatter(ymd, format);
    }

    const numeric = Number(ymd) || 0;
    const fallbackDay = String(numeric % 100).padStart(2, "0");
    const fallbackMonth = String(Math.floor(numeric / 100) % 100).padStart(2, "0");
    return `${fallbackDay}.${fallbackMonth}.`;
  }

  function resolveStudentConfig(studentSlice) {
    const config = studentSlice?.context?.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) return {};
    return config;
  }

  function resolveHomeworkConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.homework?.config && typeof studentConfig.plugins.homework.config === "object"
        ? studentConfig.plugins.homework.config
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

  function buildHeaderTitle(pluginContext, studentName, homeworkConfig) {
    const title = escapeHtml(translate(pluginContext, "homework", "Homework"));
    const daysLabel = translate(pluginContext, "widget_filter_days", "days");
    const nextDays = normalizeDays(homeworkConfig?.nextDays, 0);
    const pastDays = normalizeDays(homeworkConfig?.pastDays, 0);
    const filterLabel = `-${pastDays}/+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || "").trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return `${title} <span class="wu-header-meta">(${escapeHtml(meta)})</span>`;
  }

  /**
   * Due date, then subject, then the homework id: WebUntis does not guarantee a stable order for
   * entries tied on the first two, and the id keeps it identical across refreshes (issue #89).
   */
  function compareHomework(left, right) {
    return (
      (Number(left?.dueDate) || 0) - (Number(right?.dueDate) || 0) ||
      getFieldDisplayName(left?.subject || null, "short").localeCompare(
        getFieldDisplayName(right?.subject || null, "short"),
      ) ||
      (Number(left?.id) || 0) - (Number(right?.id) || 0)
    );
  }

  function homeworkLabel(pluginContext) {
    return `<span class="wu-homework__label">${escapeHtml(translate(pluginContext, "homework", "Homework"))}</span>`;
  }

  /** Right-hand cell: subject and text as configured, the widget label when both are off or empty. */
  function buildContentCell(pluginContext, homework, homeworkConfig) {
    const subjectLabel = homeworkConfig?.showSubject ? getFieldDisplayName(homework?.subject || null, "long") : "";
    const text = homeworkConfig?.showText ? String(homework?.text || "").trim() : "";
    const parts = [];
    if (subjectLabel) parts.push(`<b class="wu-homework__subject">${escapeHtml(subjectLabel)}</b>`);
    if (text) parts.push(`<span class="wu-homework__text">${escapeHtml(text).replace(/\n/g, "<br>")}</span>`);
    return parts.length > 0 ? parts.join(": ") : homeworkLabel(pluginContext);
  }

  /** "no homework" or "data unavailable" in place of the list. */
  function addEmptyRow(pluginContext, container, studentSlice, studentLabelText) {
    const unavailable = studentSlice?.state?.collections?.homework?.status === "unavailable";
    addRow(
      container,
      unavailable ? "homeworkRowEmpty unavailable-notice" : "homeworkRowEmpty",
      studentLabelText,
      escapeHtml(
        translate(
          pluginContext,
          unavailable ? "unavailable" : "no_homework",
          unavailable ? "data unavailable" : "no homework",
        ),
      ),
    );
  }

  function renderStudent(pluginContext, studentSlice) {
    const homeworks = Array.isArray(studentSlice?.data?.homework) ? studentSlice.data.homework : [];
    const studentConfig = resolveStudentConfig(studentSlice);
    const homeworkConfig = resolveHomeworkConfig(studentConfig);
    const studentTitle = String(studentSlice?.student?.title || "").trim();
    const verboseMode = isVerboseMode(studentConfig);
    const studentLabelText = verboseMode ? "" : escapeHtml(studentTitle);
    const container = createContainer();

    if (verboseMode && studentTitle) {
      addHeader(container, buildHeaderTitle(pluginContext, studentTitle, homeworkConfig));
    }
    if (homeworks.length === 0) {
      addEmptyRow(pluginContext, container, studentSlice, studentLabelText);
      return container;
    }

    for (const homework of homeworks.slice().sort(compareHomework)) {
      const due = homework?.dueDate ? formatDisplayDateValue(homework.dueDate, homeworkConfig?.dateFormat) : "";
      const dateCell = due ? `<span class="wu-homework__date">${escapeHtml(due)}</span>` : homeworkLabel(pluginContext);
      addRow(
        container,
        "homeworkRow",
        studentLabelText,
        dateCell,
        buildContentCell(pluginContext, homework, homeworkConfig),
      );
    }
    return container;
  }

  host.registerFrontendPlugin({
    id: "homework",
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = createElement("section", "wu-plugin wu-plugin-homework");
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          for (const studentSlice of students) {
            wrapper.appendChild(renderStudent(pluginContext, studentSlice));
          }
          return students.length > 0 ? wrapper : null;
        },
      };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
