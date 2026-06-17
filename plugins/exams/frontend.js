(function registerExamsPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  if (!host || typeof host.registerFrontendPlugin !== 'function') {
    return;
  }

  const DEFAULT_EXAMS_CONFIG = Object.freeze({
    nextDays: 21,
    dateFormat: 'EEE dd.MM.',
    showSubject: true,
    showTeacher: true,
  });

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

  function formatFallbackDate(ymd) {
    const numeric = Number(ymd) || 0;
    const fallbackDay = String(numeric % 100).padStart(2, '0');
    const fallbackMonth = String(Math.floor(numeric / 100) % 100).padStart(2, '0');
    return `${fallbackDay}.${fallbackMonth}.`;
  }

  function formatDisplayDateValue(ymd, format) {
    const formatter = root.MMMWebuntisFrontendShared?.util?.formatDisplayDate;
    if (typeof formatter === 'function') {
      return formatter(ymd, format);
    }
    return formatFallbackDate(ymd);
  }

  function currentTimeAsHHMM(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
    return date.getHours() * 100 + date.getMinutes();
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

  function compareByDateAndStartTime(left, right) {
    const dateCompare = (Number(left?.examDate) || 0) - (Number(right?.examDate) || 0);
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

  function normalizeDays(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
  }

  function resolveStudentConfig(studentSlice) {
    const config = studentSlice?.context?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return {};
    }
    return config;
  }

  function resolveExamConfig(studentConfig, renderContextPluginConfig) {
    const pluginConfig =
      studentConfig?.plugins?.exams?.config && typeof studentConfig.plugins.exams.config === 'object'
        ? studentConfig.plugins.exams.config
        : {};
    const renderConfig = renderContextPluginConfig && typeof renderContextPluginConfig === 'object' ? renderContextPluginConfig : {};

    return {
      ...DEFAULT_EXAMS_CONFIG,
      ...renderConfig,
      ...pluginConfig,
    };
  }

  function isVerboseMode(studentConfig) {
    return (
      String(studentConfig?.mode ?? 'compact')
        .trim()
        .toLowerCase() === 'verbose'
    );
  }

  function translate(pluginContext, key, fallback, replacements) {
    if (typeof pluginContext?.translate !== 'function') return fallback;
    const translated = pluginContext.translate(key, fallback, replacements);
    return translated && translated !== key ? translated : fallback;
  }

  function buildHeaderTitle(pluginContext, studentName, examConfig) {
    const title = escapeHtml(translate(pluginContext, 'exams', 'Exams'));
    const daysLabel = translate(pluginContext, 'widget_filter_days', 'days');
    const nextDays = normalizeDays(examConfig?.nextDays, DEFAULT_EXAMS_CONFIG.nextDays);
    const filterLabel = `+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || '').trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return `${title} <span class="wu-header-meta">(${escapeHtml(meta)})</span>`;
  }

  host.registerFrontendPlugin({
    id: 'exams',
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = createElement('section', 'wu-plugin wu-plugin-exams');
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          const logLevel = String(renderContext?.runtime?.logLevel || root.MMMWebuntisLogLevel || '')
            .trim()
            .toLowerCase();
          const includePastExams = logLevel === 'debug';
          let renderedContainers = 0;

          for (const studentSlice of students) {
            const exams = Array.isArray(studentSlice?.data?.exams) ? studentSlice.data.exams : [];
            if (exams.length === 0) {
              continue;
            }

            const studentConfig = resolveStudentConfig(studentSlice);
            const examConfig = resolveExamConfig(studentConfig, renderContext?.pluginConfig);
            if (normalizeDays(examConfig?.nextDays, DEFAULT_EXAMS_CONFIG.nextDays) <= 0) {
              continue;
            }

            const dateContext = getCurrentDateContext(studentConfig);
            const nowYmd = Number(dateContext?.ymd) || 0;
            const nowHm = currentTimeAsHHMM(dateContext?.date);
            const showSubject = Boolean(examConfig?.showSubject);
            const showTeacher = Boolean(examConfig?.showTeacher);

            const visibleExams = exams
              .slice()
              .sort(compareByDateAndStartTime)
              .filter((exam) => {
                if (includePastExams) return true;
                const examYmd = Number(exam?.examDate) || 0;
                const examHm = Number(exam?.startTime) || 0;
                return !(examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm));
              });

            if (visibleExams.length === 0) {
              continue;
            }

            const studentTitle = String(studentSlice?.student?.title || '').trim();
            const verboseMode = isVerboseMode(studentConfig);
            const studentLabelText = verboseMode ? '' : escapeHtml(studentTitle);
            const container = createContainer();

            if (verboseMode && studentTitle) {
              addHeader(container, buildHeaderTitle(pluginContext, studentTitle, examConfig));
            }

            for (const exam of visibleExams) {
              const examYmd = Number(exam?.examDate) || 0;
              const formattedDate = formatDisplayDateValue(examYmd, examConfig?.dateFormat || DEFAULT_EXAMS_CONFIG.dateFormat);
              const dateTimeCell = formattedDate ? `<span class="wu-exam__date">${escapeHtml(formattedDate)}</span>` : '';

              let nameCell = `<span class="wu-exam__name">${escapeHtml(exam?.name)}</span>`;
              if (showSubject) {
                nameCell = `<span class="wu-exam__subject">${escapeHtml(exam?.subject)}</span>: &nbsp;<span class="wu-exam__name">${escapeHtml(exam?.name)}</span>`;
              }

              if (showTeacher) {
                const teacher = getFirstFieldName(exam?.teachers, 'short');
                if (teacher) {
                  nameCell += `&nbsp;<span class="teacher-name wu-exam__teacher">(${escapeHtml(teacher)})</span>`;
                }
              }

              if (exam?.text) {
                nameCell += `<br/><span class="wu-exam__description">${escapeHtml(exam.text)}</span>`;
              }

              addRow(container, 'examRow', studentLabelText, dateTimeCell, nameCell);
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
