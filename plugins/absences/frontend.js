(function registerAbsencesPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  if (!host || typeof host.registerFrontendPlugin !== "function") {
    return;
  }

  // DOM, time and formatting helpers come from pluginContext (docs/PLUGINS.md), not from the global.

  function resolveAbsencesConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.absences?.config && typeof studentConfig.plugins.absences.config === "object"
        ? studentConfig.plugins.absences.config
        : {};

    return { ...pluginConfig };
  }

  function buildHeaderTitle(pluginContext, studentName, absencesConfig) {
    const { headerTitleNodes } = pluginContext.dom;
    const title = pluginContext.translate("absences", "Absences");
    const daysLabel = pluginContext.translate("widget_filter_days", "days");
    const nextDays = pluginContext.widget.normalizeDays(absencesConfig?.nextDays, 0);
    const pastDays = pluginContext.widget.normalizeDays(absencesConfig?.pastDays, 0);
    const filterLabel = `-${pastDays}/+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || "").trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return headerTitleNodes(title, meta);
  }

  function createWarningInfo(pluginContext) {
    const { createElement } = pluginContext.dom;
    const infoDiv = createElement("div", "dimmed small wu-absence__unavailable-info absences-unavailable-info");
    const icon = createElement("span", "wu-inline-icon wu-inline-icon--warning");
    icon.setAttribute("aria-hidden", "true");
    infoDiv.replaceChildren(
      icon,
      document.createTextNode(
        ` ${pluginContext.translate("absences_unavailable_parent_account", "Absences unavailable for parent account")}`,
      ),
    );
    return infoDiv;
  }

  /** A YYYYMMDD integer as UTC midnight in ms. */
  function ymdToUtcMs(ymd) {
    return Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100);
  }

  /**
   * Whether an absence lies inside the configured window around today. An unset pastDays or
   * nextDays leaves that side open.
   */
  function isWithinDayWindow(absence, nowYmd, pastDays, nextDays) {
    const absenceYmd = Number(absence?.date) || 0;
    if (absenceYmd === 0) return false;
    const daysAgo = Math.floor((ymdToUtcMs(nowYmd) - ymdToUtcMs(absenceYmd)) / (1000 * 60 * 60 * 24));
    if (pastDays !== null && pastDays !== undefined && daysAgo > pastDays) return false;
    if (nextDays !== null && nextDays !== undefined && daysAgo < -nextDays) return false;
    return true;
  }

  /** "excused"/"unexcused" label and class, or none when showExcused is off or it is unknown. */
  function describeExcuse(pluginContext, absence, showExcused) {
    if (!showExcused) return { label: "", className: "" };
    if (absence?.excused === true) {
      return { label: pluginContext.translate("excused", "excused"), className: "absence-excused" };
    }
    if (absence?.excused === false) {
      return { label: pluginContext.translate("unexcused", "unexcused"), className: "absence-unexcused" };
    }
    return { label: "", className: "" };
  }

  function absencesLabel(pluginContext) {
    return pluginContext.dom.el("span", "wu-absence__label", pluginContext.translate("absences", "Absences"));
  }

  /** Parts (each a node or node list) separated by single spaces. */
  function joinWithSpaces(parts) {
    return parts.flatMap((part, index) => (index > 0 ? [" ", part] : [part]));
  }

  /** Data cell of one absence: time range, subject with excuse note, reason. */
  function buildAbsenceDataNodes(pluginContext, absence, options) {
    const { el, multilineNodes } = pluginContext.dom;
    const start = pluginContext.formatting.formatDisplayTime(absence?.startTime);
    const end = pluginContext.formatting.formatDisplayTime(absence?.endTime);
    const timeRange = start && end ? `${start}-${end}` : start || end || "";
    const subject = pluginContext.widget.getFirstFieldName(
      Array.isArray(absence?.subjects) ? absence.subjects : [],
      "long",
    );
    const reason = String(absence?.reason || "").trim();
    const excuse = describeExcuse(pluginContext, absence, options.showExcused);

    const statusClass = `${excuse.className} wu-absence__status`;
    const parts = [];
    if (timeRange) parts.push(el("b", "wu-absence__time", timeRange));
    if (subject) {
      const note = excuse.label ? [" ", el("span", statusClass, `(${excuse.label})`)] : [];
      parts.push([el("span", "wu-absence__subject", subject), ...note]);
    } else if (excuse.label) {
      parts.push(el("span", statusClass, excuse.label));
    }
    if (options.showReason && reason) {
      parts.push([document.createElement("br"), el("span", "wu-absence__reason", multilineNodes(reason))]);
    }
    return parts.length > 0 ? joinWithSpaces(parts) : absencesLabel(pluginContext);
  }

  /** "no absences" or "data unavailable" in place of the list. */
  function addEmptyRow(pluginContext, container, studentSlice, studentLabelText) {
    const { addRow } = pluginContext.dom;
    const unavailable = studentSlice?.state?.collections?.absences?.status === "unavailable";
    addRow(
      container,
      unavailable ? "absenceRowEmpty unavailable-notice" : "absenceRowEmpty",
      studentLabelText,
      pluginContext.translate(
        unavailable ? "unavailable" : "no_absences",
        unavailable ? "data unavailable" : "no absences",
      ),
    );
  }

  /** One student's absences: filtered to the day window, sorted, cut to maxItems. */
  function renderStudent(pluginContext, studentSlice) {
    const { addHeader, addRow, createContainer, el } = pluginContext.dom;
    const absences = Array.isArray(studentSlice?.data?.absences) ? studentSlice.data.absences : [];
    const studentConfig = pluginContext.widget.resolveStudentConfig(studentSlice);
    const absencesConfig = resolveAbsencesConfig(studentConfig);
    const studentTitle = String(studentSlice?.student?.title || "").trim();
    const verboseMode = pluginContext.widget.isVerboseMode(studentConfig);
    const studentLabelText = verboseMode ? "" : studentTitle;
    const container = createContainer();

    if (verboseMode && studentTitle) {
      addHeader(container, buildHeaderTitle(pluginContext, studentTitle, absencesConfig));
    }

    if (absences.length === 0) {
      addEmptyRow(pluginContext, container, studentSlice, studentLabelText);
      return container;
    }

    const nowYmd = Number(pluginContext.time.getCurrentDateContext(studentConfig)?.ymd) || 0;
    const maxItems = Number(absencesConfig?.maxItems);
    const limit = Number.isFinite(maxItems) && maxItems > 0 ? Math.ceil(maxItems) : Number.POSITIVE_INFINITY;
    const options = {
      showExcused: Boolean(absencesConfig?.showExcused),
      showReason: Boolean(absencesConfig?.showReason),
    };
    const visible = absences
      .filter((absence) => isWithinDayWindow(absence, nowYmd, absencesConfig?.pastDays, absencesConfig?.nextDays))
      .sort((left, right) => pluginContext.widget.compareByDateAndStartTime(left, right))
      .slice(0, limit);

    for (const absence of visible) {
      const dateStr = absence?.date
        ? pluginContext.formatting.formatDisplayDate(absence.date, absencesConfig?.dateFormat)
        : "";
      const meta = absencesConfig?.showDate && dateStr ? el("span", "wu-absence__date", dateStr) : "";
      addRow(
        container,
        "absenceRow",
        studentLabelText,
        meta || absencesLabel(pluginContext),
        buildAbsenceDataNodes(pluginContext, absence, options),
      );
    }

    return container;
  }

  host.registerFrontendPlugin({
    id: "absences",
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = pluginContext.dom.createElement("section", "wu-plugin wu-plugin-absences");
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          if (students.some((studentSlice) => studentSlice?.state?.absencesUnavailable === true)) {
            wrapper.appendChild(createWarningInfo(pluginContext));
          }
          for (const studentSlice of students) {
            wrapper.appendChild(renderStudent(pluginContext, studentSlice));
          }
          return students.length > 0 ? wrapper : null;
        },
      };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
