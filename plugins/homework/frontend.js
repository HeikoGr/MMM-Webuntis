(function registerHomeworkPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  if (!host || typeof host.registerFrontendPlugin !== 'function') {
    return;
  }

  const DEFAULT_HOMEWORK_CONFIG = Object.freeze({
    nextDays: 28,
    pastDays: 0,
    dateFormat: 'EEE dd.MM.',
    showSubject: true,
    showText: true,
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

  function resolveStudentConfig(studentSlice) {
    const config = studentSlice?.context?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
    return config;
  }

  function resolveHomeworkConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.homework?.config && typeof studentConfig.plugins.homework.config === 'object'
        ? studentConfig.plugins.homework.config
        : {};

    return {
      ...DEFAULT_HOMEWORK_CONFIG,
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

  function buildHeaderTitle(pluginContext, studentName, homeworkConfig) {
    const title = escapeHtml(translate(pluginContext, 'homework', 'Homework'));
    const daysLabel = translate(pluginContext, 'widget_filter_days', 'days');
    const nextDays = normalizeDays(homeworkConfig?.nextDays, DEFAULT_HOMEWORK_CONFIG.nextDays);
    const pastDays = normalizeDays(homeworkConfig?.pastDays, DEFAULT_HOMEWORK_CONFIG.pastDays);
    const filterLabel = `-${pastDays}/+${nextDays} ${daysLabel}`;
    const normalizedStudent = String(studentName || '').trim();
    const meta = normalizedStudent ? `${normalizedStudent}, ${filterLabel}` : filterLabel;
    return `${title} <span class="wu-header-meta">(${escapeHtml(meta)})</span>`;
  }

  host.registerFrontendPlugin({
    id: 'homework',
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = createElement('section', 'wu-plugin wu-plugin-homework');
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          let renderedContainers = 0;

          for (const studentSlice of students) {
            const homeworks = Array.isArray(studentSlice?.data?.homework) ? studentSlice.data.homework : [];
            const studentConfig = resolveStudentConfig(studentSlice);
            const homeworkConfig = resolveHomeworkConfig(studentConfig);
            const studentTitle = String(studentSlice?.student?.title || '').trim();
            const verboseMode = isVerboseMode(studentConfig);
            const studentLabelText = verboseMode ? '' : escapeHtml(studentTitle);
            const container = createContainer();

            if (verboseMode && studentTitle) {
              addHeader(container, buildHeaderTitle(pluginContext, studentTitle, homeworkConfig));
            }

            if (!Array.isArray(homeworks) || homeworks.length === 0) {
              addRow(container, 'homeworkRowEmpty', studentLabelText, escapeHtml(translate(pluginContext, 'no_homework', 'no homework')));
              wrapper.appendChild(container);
              renderedContainers += 1;
              continue;
            }

            const showSubject = Boolean(homeworkConfig?.showSubject);
            const showText = Boolean(homeworkConfig?.showText);
            const dateFormat = homeworkConfig?.dateFormat || DEFAULT_HOMEWORK_CONFIG.dateFormat;

            const sorted = homeworks.slice().sort((left, right) => {
              const leftSubject = left?.subject || null;
              const rightSubject = right?.subject || null;
              return (
                (Number(left?.dueDate) || 0) - (Number(right?.dueDate) || 0) ||
                getFieldDisplayName(leftSubject, 'short').localeCompare(getFieldDisplayName(rightSubject, 'short'))
              );
            });

            for (const homework of sorted) {
              const due = homework?.dueDate ? formatDisplayDateValue(homework.dueDate, dateFormat) : '';
              const subject = homework?.subject || null;
              const subjectLabel = showSubject ? getFieldDisplayName(subject, 'long') : '';
              const text = showText ? String(homework?.text || '').trim() : '';
              const left = due
                ? `<span class="wu-homework__date">${escapeHtml(due)}</span>`
                : `<span class="wu-homework__label">${escapeHtml(translate(pluginContext, 'homework', 'Homework'))}</span>`;
              const rightParts = [];
              if (subjectLabel) rightParts.push(`<b class="wu-homework__subject">${escapeHtml(subjectLabel)}</b>`);
              if (text) rightParts.push(`<span class="wu-homework__text">${escapeHtml(text).replace(/\n/g, '<br>')}</span>`);
              const right =
                rightParts.length > 0
                  ? rightParts.join(': ')
                  : `<span class="wu-homework__label">${escapeHtml(translate(pluginContext, 'homework', 'Homework'))}</span>`;

              addRow(container, 'homeworkRow', studentLabelText, left, right);
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
