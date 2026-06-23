(function registerAbsencesPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  if (!host || typeof host.registerFrontendPlugin !== 'function') {
    return;
  }

  function appendClassName(element, className) {
    const normalized = String(className || '').trim();
    if (!normalized) return element;
    element.className = normalized;
    return element;
  }

  function createElement(tagName, className = '') {
    const element = document.createElement(tagName);
    return appendClassName(element, className);
  }

  function createContainer() {
    return createElement('div', 'wu-widget-container bright small light');
  }

  function addHeader(container, text) {
    const header = createElement('div', 'wu-row wu-row-header');
    header.innerHTML = text;
    container.appendChild(header);
  }

  function addRow(container, rowClassName, studentTitle = '', metaHtml = '', dataHtml = '') {
    const row = createElement('div', `wu-row ${rowClassName}`);

    const studentCol = createElement('div', 'wu-col wu-col-student');
    studentCol.innerHTML = studentTitle;
    row.appendChild(studentCol);

    const metaCol = createElement('div', 'wu-col wu-col-meta');
    metaCol.innerHTML = metaHtml;
    row.appendChild(metaCol);

    if (dataHtml !== '') {
      const dataCol = createElement('div', 'wu-col wu-col-data');
      dataCol.innerHTML = dataHtml;
      row.appendChild(dataCol);
    } else if (metaHtml !== '') {
      metaCol.className = 'wu-col wu-col-full';
    }

    container.appendChild(row);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function translate(pluginContext, key, fallback, replacements) {
    if (typeof pluginContext?.translate !== 'function') return fallback;
    const translated = pluginContext.translate(key, fallback, replacements);
    return translated && translated !== key ? translated : fallback;
  }

  function normalizeDays(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
  }

  function formatDisplayDateValue(ymd, format) {
    const formatter = root.MMMWebuntisFrontendShared?.util?.formatDisplayDate;
    if (typeof formatter === 'function') {
      return formatter(ymd, format);
    }

    const numeric = Number(ymd) || 0;
    const fallbackDay = String(numeric % 100).padStart(2, '0');
    const fallbackMonth = String(Math.floor(numeric / 100) % 100).padStart(2, '0');
    return `${fallbackDay}.${fallbackMonth}.`;
  }

  function formatDisplayTimeValue(value) {
    const formatter = root.MMMWebuntisFrontendShared?.util?.formatDisplayTime;
    if (typeof formatter === 'function') {
      return formatter(value);
    }

    const digits = String(value || '')
      .replace(/\D/g, '')
      .padStart(4, '0');
    return digits.trim() ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}` : '';
  }

  function compareByDateAndStartTime(left, right) {
    const dateCompare = (Number(left?.date) || 0) - (Number(right?.date) || 0);
    if (dateCompare !== 0) return dateCompare;
    return (Number(left?.startTime) || 0) - (Number(right?.startTime) || 0);
  }

  function getFieldDisplayName(entry, format = 'short') {
    if (entry === null || entry === undefined) return '';
    if (typeof entry === 'string' || typeof entry === 'number') {
      return String(entry).trim();
    }
    if (typeof entry !== 'object') return '';
    const shortName = String(entry.name ?? '').trim();
    const longName = String(entry.longname ?? '').trim();
    return format === 'long' ? longName || shortName : shortName || longName;
  }

  function getFirstFieldName(entries, format = 'short') {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    return getFieldDisplayName(entries[0], format);
  }

  function getCurrentDateContext(studentConfig) {
    const runtimeUtils = root.MMModuleRuntimeUtils;
    if (runtimeUtils && typeof runtimeUtils.getCurrentDateContext === 'function') {
      return runtimeUtils.getCurrentDateContext(studentConfig || {}, {
        defaultTimezone: 'Europe/Berlin',
      });
    }

    const date = new Date();
    return {
      date,
      ymd: date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate(),
      isoDate: '',
      isDebug: false,
      timezone: 'Europe/Berlin',
    };
  }

  function resolveStudentConfig(studentSlice) {
    const config = studentSlice?.context?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
    return config;
  }

  function resolveAbsencesConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.absences?.config && typeof studentConfig.plugins.absences.config === 'object'
        ? studentConfig.plugins.absences.config
        : {};

    return { ...pluginConfig };
  }

  function isVerboseMode(studentConfig) {
    return (
      String(studentConfig?.mode ?? 'compact')
        .trim()
        .toLowerCase() === 'verbose'
    );
  }

  function buildHeaderTitle(pluginContext, studentName, absencesConfig) {
    const title = escapeHtml(translate(pluginContext, 'absences', 'Absences'));
    const daysLabel = translate(pluginContext, 'widget_filter_days', 'days');
    const nextDays = normalizeDays(absencesConfig?.nextDays, 0);
    const pastDays = normalizeDays(absencesConfig?.pastDays, 0);
    const filterLabel = `-${pastDays}/+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || '').trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return `${title} <span class="wu-header-meta">(${escapeHtml(meta)})</span>`;
  }

  function createWarningInfo(pluginContext) {
    const infoDiv = createElement('div', 'dimmed small wu-absence__unavailable-info absences-unavailable-info');
    const icon = createElement('span', 'wu-inline-icon wu-inline-icon--warning');
    icon.setAttribute('aria-hidden', 'true');
    infoDiv.replaceChildren(
      icon,
      document.createTextNode(
        ` ${translate(pluginContext, 'absences_unavailable_parent_account', 'Absences unavailable for parent account')}`
      )
    );
    return infoDiv;
  }

  host.registerFrontendPlugin({
    id: 'absences',
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = createElement('section', 'wu-plugin wu-plugin-absences');
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          if (students.some((studentSlice) => studentSlice?.state?.absencesUnavailable === true)) {
            wrapper.appendChild(createWarningInfo(pluginContext));
          }

          let renderedContainers = 0;

          for (const studentSlice of students) {
            const absences = Array.isArray(studentSlice?.data?.absences) ? studentSlice.data.absences : [];
            const studentConfig = resolveStudentConfig(studentSlice);
            const absencesConfig = resolveAbsencesConfig(studentConfig);
            const studentTitle = String(studentSlice?.student?.title || '').trim();
            const verboseMode = isVerboseMode(studentConfig);
            const studentLabelText = verboseMode ? '' : escapeHtml(studentTitle);
            const container = createContainer();

            if (verboseMode && studentTitle) {
              addHeader(container, buildHeaderTitle(pluginContext, studentTitle, absencesConfig));
            }

            if (!Array.isArray(absences) || absences.length === 0) {
              addRow(container, 'absenceRowEmpty', studentLabelText, escapeHtml(translate(pluginContext, 'no_absences', 'no absences')));
              wrapper.appendChild(container);
              renderedContainers += 1;
              continue;
            }

            const maxItems = Number(absencesConfig?.maxItems);
            const showDate = Boolean(absencesConfig?.showDate);
            const showExcused = Boolean(absencesConfig?.showExcused);
            const showReason = Boolean(absencesConfig?.showReason);
            const nowContext = getCurrentDateContext(studentConfig);
            const nowYmd = Number(nowContext?.ymd) || 0;
            const pastDays = absencesConfig?.pastDays;
            const nextDays = absencesConfig?.nextDays;
            const dateFormat = absencesConfig?.dateFormat;

            const sorted = absences
              .slice()
              .filter((absence) => {
                const absenceYmd = Number(absence?.date) || 0;
                if (absenceYmd === 0) return false;

                const absYear = Math.floor(absenceYmd / 10000);
                const absMonth = Math.floor((absenceYmd % 10000) / 100);
                const absDay = absenceYmd % 100;
                const nowYear = Math.floor(nowYmd / 10000);
                const nowMonth = Math.floor((nowYmd % 10000) / 100);
                const nowDay = nowYmd % 100;
                const absUtcMs = Date.UTC(absYear, absMonth - 1, absDay);
                const nowUtcMs = Date.UTC(nowYear, nowMonth - 1, nowDay);
                const daysDiff = Math.floor((nowUtcMs - absUtcMs) / (1000 * 60 * 60 * 24));

                if (pastDays !== null && pastDays !== undefined && daysDiff > pastDays) {
                  return false;
                }
                if (nextDays !== null && nextDays !== undefined && daysDiff < -nextDays) {
                  return false;
                }
                return true;
              })
              .sort(compareByDateAndStartTime);

            let visibleCount = 0;
            for (const absence of sorted) {
              if (Number.isFinite(maxItems) && maxItems > 0 && visibleCount >= maxItems) break;

              const dateStr = absence?.date ? formatDisplayDateValue(absence.date, dateFormat) : '';
              const start = formatDisplayTimeValue(absence?.startTime);
              const end = formatDisplayTimeValue(absence?.endTime);
              const timeRange = start && end ? `${start}-${end}` : start || end || '';
              const subject = getFirstFieldName(Array.isArray(absence?.subjects) ? absence.subjects : [], 'long');
              const reason = String(absence?.reason || '').trim();
              const isExcused = absence?.excused === true;
              const isUnexcused = absence?.excused === false;
              const meta = showDate && dateStr ? `<span class="wu-absence__date">${escapeHtml(dateStr)}</span>` : '';

              let statusLabel = '';
              let statusClass = '';
              if (showExcused) {
                if (isExcused) {
                  statusLabel = translate(pluginContext, 'excused', 'excused');
                  statusClass = 'absence-excused';
                } else if (isUnexcused) {
                  statusLabel = translate(pluginContext, 'unexcused', 'unexcused');
                  statusClass = 'absence-unexcused';
                }
              }

              const dataParts = [];
              if (timeRange) dataParts.push(`<b class="wu-absence__time">${escapeHtml(timeRange)}</b>`);
              if (subject) {
                const note = statusLabel ? ` <span class="${statusClass} wu-absence__status">(${escapeHtml(statusLabel)})</span>` : '';
                dataParts.push(`<span class="wu-absence__subject">${escapeHtml(subject)}</span>${note}`);
              } else if (statusLabel) {
                dataParts.push(`<span class="${statusClass} wu-absence__status">${escapeHtml(statusLabel)}</span>`);
              }
              if (showReason && reason) {
                dataParts.push(`<br><span class="wu-absence__reason">${escapeHtml(reason).replace(/\n/g, '<br>')}</span>`);
              }

              const data =
                dataParts.length > 0
                  ? dataParts.join(' ')
                  : `<span class="wu-absence__label">${escapeHtml(translate(pluginContext, 'absences', 'Absences'))}</span>`;

              addRow(
                container,
                'absenceRow',
                studentLabelText,
                meta || `<span class="wu-absence__label">${escapeHtml(translate(pluginContext, 'absences', 'Absences'))}</span>`,
                data
              );

              visibleCount += 1;
            }

            wrapper.appendChild(container);
            renderedContainers += 1;
          }

          return renderedContainers > 0 ? wrapper : null;
        },
      };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
