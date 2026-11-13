(function registerHomeworkPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  if (!host || typeof host.registerFrontendPlugin !== "function") {
    return;
  }

  // DOM, time and formatting helpers come from pluginContext (docs/PLUGINS.md), not from the global.

  function resolveHomeworkConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.homework?.config && typeof studentConfig.plugins.homework.config === "object"
        ? studentConfig.plugins.homework.config
        : {};

    return { ...pluginConfig };
  }

  function buildHeaderTitle(pluginContext, studentName, homeworkConfig) {
    const { headerTitleNodes } = pluginContext.dom;
    const title = pluginContext.translate("homework", "Homework");
    const daysLabel = pluginContext.translate("widget_filter_days", "days");
    const nextDays = pluginContext.widget.normalizeDays(homeworkConfig?.nextDays, 0);
    const pastDays = pluginContext.widget.normalizeDays(homeworkConfig?.pastDays, 0);
    const filterLabel = `-${pastDays}/+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || "").trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return headerTitleNodes(title, meta);
  }

  /**
   * Due date, then subject, then the homework id: WebUntis does not guarantee a stable order for
   * entries tied on the first two, and the id keeps it identical across refreshes (issue #89).
   */
  function compareHomework(pluginContext, left, right) {
    return (
      (Number(left?.dueDate) || 0) - (Number(right?.dueDate) || 0) ||
      pluginContext.widget
        .getFieldDisplayName(left?.subject || null, "short")
        .localeCompare(pluginContext.widget.getFieldDisplayName(right?.subject || null, "short")) ||
      (Number(left?.id) || 0) - (Number(right?.id) || 0)
    );
  }

  function homeworkLabel(pluginContext) {
    return pluginContext.dom.el("span", "wu-homework__label", pluginContext.translate("homework", "Homework"));
  }

  /** Right-hand cell: subject and text as configured, the widget label when both are off or empty. */
  function buildContentCell(pluginContext, homework, homeworkConfig) {
    const { el, multilineNodes } = pluginContext.dom;
    const subjectLabel = homeworkConfig?.showSubject
      ? pluginContext.widget.getFieldDisplayName(homework?.subject || null, "long")
      : "";
    const text = homeworkConfig?.showText ? String(homework?.text || "").trim() : "";
    const subject = subjectLabel ? el("b", "wu-homework__subject", subjectLabel) : null;
    const textSpan = text ? el("span", "wu-homework__text", multilineNodes(text)) : null;
    if (subject && textSpan) return [subject, ": ", textSpan];
    return subject || textSpan || homeworkLabel(pluginContext);
  }

  /** "no homework" or "data unavailable" in place of the list. */
  function addEmptyRow(pluginContext, container, studentSlice, studentLabelText) {
    const { addRow } = pluginContext.dom;
    const unavailable = studentSlice?.state?.collections?.homework?.status === "unavailable";
    addRow(
      container,
      unavailable ? "homeworkRowEmpty unavailable-notice" : "homeworkRowEmpty",
      studentLabelText,
      pluginContext.translate(
        unavailable ? "unavailable" : "no_homework",
        unavailable ? "data unavailable" : "no homework",
      ),
    );
  }

  function renderStudent(pluginContext, studentSlice) {
    const { addHeader, addRow, createContainer, el } = pluginContext.dom;
    const homeworks = Array.isArray(studentSlice?.data?.homework) ? studentSlice.data.homework : [];
    const studentConfig = pluginContext.widget.resolveStudentConfig(studentSlice);
    const homeworkConfig = resolveHomeworkConfig(studentConfig);
    const studentTitle = String(studentSlice?.student?.title || "").trim();
    const verboseMode = pluginContext.widget.isVerboseMode(studentConfig);
    const studentLabelText = verboseMode ? "" : studentTitle;
    const container = createContainer();

    if (verboseMode && studentTitle) {
      addHeader(container, buildHeaderTitle(pluginContext, studentTitle, homeworkConfig));
    }
    if (homeworks.length === 0) {
      addEmptyRow(pluginContext, container, studentSlice, studentLabelText);
      return container;
    }

    for (const homework of homeworks.slice().sort((left, right) => compareHomework(pluginContext, left, right))) {
      const due = homework?.dueDate
        ? pluginContext.formatting.formatDisplayDate(homework.dueDate, homeworkConfig?.dateFormat)
        : "";
      const dateCell = due ? el("span", "wu-homework__date", due) : homeworkLabel(pluginContext);
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
          const wrapper = pluginContext.dom.createElement("section", "wu-plugin wu-plugin-homework");
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
