(function registerAbsencesPlugin(root) {
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

  function formatDisplayTimeValue(value) {
    const formatter = root.MMMWebuntisFrontendShared?.util?.formatDisplayTime;
    if (typeof formatter === "function") {
      return formatter(value);
    }

    const digits = String(value || "")
      .replace(/\D/g, "")
      .padStart(4, "0");
    return digits.trim() ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}` : "";
  }

  function compareByDateAndStartTime(left, right) {
    const dateCompare = (Number(left?.date) || 0) - (Number(right?.date) || 0);
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

  function getCurrentDateContext(studentConfig) {
    return root.MMMWebuntisFrontendShared.time.getCurrentDateContext(studentConfig);
  }

  function resolveStudentConfig(studentSlice) {
    const config = studentSlice?.context?.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) return {};
    return config;
  }

  function resolveAbsencesConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.absences?.config && typeof studentConfig.plugins.absences.config === "object"
        ? studentConfig.plugins.absences.config
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

  function buildHeaderTitle(pluginContext, studentName, absencesConfig) {
    const title = escapeHtml(translate(pluginContext, "absences", "Absences"));
    const daysLabel = translate(pluginContext, "widget_filter_days", "days");
    const nextDays = normalizeDays(absencesConfig?.nextDays, 0);
    const pastDays = normalizeDays(absencesConfig?.pastDays, 0);
    const filterLabel = `-${pastDays}/+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || "").trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return `${title} <span class="wu-header-meta">(${escapeHtml(meta)})</span>`;
  }

  function createWarningInfo(pluginContext) {
    const infoDiv = createElement("div", "dimmed small wu-absence__unavailable-info absences-unavailable-info");
    const icon = createElement("span", "wu-inline-icon wu-inline-icon--warning");
    icon.setAttribute("aria-hidden", "true");
    infoDiv.replaceChildren(
      icon,
      document.createTextNode(
        ` ${translate(pluginContext, "absences_unavailable_parent_account", "Absences unavailable for parent account")}`,
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
      return { label: translate(pluginContext, "excused", "excused"), className: "absence-excused" };
    }
    if (absence?.excused === false) {
      return { label: translate(pluginContext, "unexcused", "unexcused"), className: "absence-unexcused" };
    }
    return { label: "", className: "" };
  }

  function absencesLabel(pluginContext) {
    return `<span class="wu-absence__label">${escapeHtml(translate(pluginContext, "absences", "Absences"))}</span>`;
  }

  /** Data cell of one absence: time range, subject with excuse note, reason. */
  function buildAbsenceDataHtml(pluginContext, absence, options) {
    const start = formatDisplayTimeValue(absence?.startTime);
    const end = formatDisplayTimeValue(absence?.endTime);
    const timeRange = start && end ? `${start}-${end}` : start || end || "";
    const subject = getFirstFieldName(Array.isArray(absence?.subjects) ? absence.subjects : [], "long");
    const reason = String(absence?.reason || "").trim();
    const excuse = describeExcuse(pluginContext, absence, options.showExcused);

    const parts = [];
    if (timeRange) parts.push(`<b class="wu-absence__time">${escapeHtml(timeRange)}</b>`);
    if (subject) {
      const note = excuse.label
        ? ` <span class="${excuse.className} wu-absence__status">(${escapeHtml(excuse.label)})</span>`
        : "";
      parts.push(`<span class="wu-absence__subject">${escapeHtml(subject)}</span>${note}`);
    } else if (excuse.label) {
      parts.push(`<span class="${excuse.className} wu-absence__status">${escapeHtml(excuse.label)}</span>`);
    }
    if (options.showReason && reason) {
      parts.push(`<br><span class="wu-absence__reason">${escapeHtml(reason).replace(/\n/g, "<br>")}</span>`);
    }
    return parts.length > 0 ? parts.join(" ") : absencesLabel(pluginContext);
  }

  /** "no absences" or "data unavailable" in place of the list. */
  function addEmptyRow(pluginContext, container, studentSlice, studentLabelText) {
    const unavailable = studentSlice?.state?.collections?.absences?.status === "unavailable";
    addRow(
      container,
      unavailable ? "absenceRowEmpty unavailable-notice" : "absenceRowEmpty",
      studentLabelText,
      escapeHtml(
        translate(
          pluginContext,
          unavailable ? "unavailable" : "no_absences",
          unavailable ? "data unavailable" : "no absences",
        ),
      ),
    );
  }

  /** One student's absences: filtered to the day window, sorted, cut to maxItems. */
  function renderStudent(pluginContext, studentSlice) {
    const absences = Array.isArray(studentSlice?.data?.absences) ? studentSlice.data.absences : [];
    const studentConfig = resolveStudentConfig(studentSlice);
    const absencesConfig = resolveAbsencesConfig(studentConfig);
    const studentTitle = String(studentSlice?.student?.title || "").trim();
    const verboseMode = isVerboseMode(studentConfig);
    const studentLabelText = verboseMode ? "" : escapeHtml(studentTitle);
    const container = createContainer();

    if (verboseMode && studentTitle) {
      addHeader(container, buildHeaderTitle(pluginContext, studentTitle, absencesConfig));
    }

    if (absences.length === 0) {
      addEmptyRow(pluginContext, container, studentSlice, studentLabelText);
      return container;
    }

    const nowYmd = Number(getCurrentDateContext(studentConfig)?.ymd) || 0;
    const maxItems = Number(absencesConfig?.maxItems);
    const limit = Number.isFinite(maxItems) && maxItems > 0 ? Math.ceil(maxItems) : Number.POSITIVE_INFINITY;
    const options = {
      showExcused: Boolean(absencesConfig?.showExcused),
      showReason: Boolean(absencesConfig?.showReason),
    };
    const visible = absences
      .filter((absence) => isWithinDayWindow(absence, nowYmd, absencesConfig?.pastDays, absencesConfig?.nextDays))
      .sort(compareByDateAndStartTime)
      .slice(0, limit);

    for (const absence of visible) {
      const dateStr = absence?.date ? formatDisplayDateValue(absence.date, absencesConfig?.dateFormat) : "";
      const meta =
        absencesConfig?.showDate && dateStr ? `<span class="wu-absence__date">${escapeHtml(dateStr)}</span>` : "";
      addRow(
        container,
        "absenceRow",
        studentLabelText,
        meta || absencesLabel(pluginContext),
        buildAbsenceDataHtml(pluginContext, absence, options),
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
          const wrapper = createElement("section", "wu-plugin wu-plugin-absences");
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
