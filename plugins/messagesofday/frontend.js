(function registerMessagesOfDayPlugin(root) {
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

  function addHeader(container, text) {
    const header = createElement('div', 'wu-row wu-row-header');
    header.innerHTML = text;
    container.appendChild(header);
  }

  function addFullRow(container, rowClassName, content = '') {
    const row = createElement('div', `wu-row ${rowClassName}`);
    const fullCol = createElement('div', 'wu-col wu-col-full-width');
    fullCol.innerHTML = content;
    row.appendChild(fullCol);
    container.appendChild(row);
  }

  function createContainer() {
    return createElement('div', 'wu-widget-container bright small light');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  host.registerFrontendPlugin({
    id: 'messagesofday',
    hostApiVersion: 1,

    create(pluginContext) {
      const translate = (key, fallback) => {
        if (typeof pluginContext?.translate !== 'function') return fallback;
        const translated = pluginContext.translate(key, fallback);
        return translated && translated !== key ? translated : fallback;
      };

      const buildHeaderTitle = (studentTitle = '') => {
        const name = escapeHtml(translate('messagesofday', 'Messages of the Day'));
        const student = escapeHtml(String(studentTitle || '').trim());
        const meta = student ? `${student}, all` : 'all';
        return `${name} <span class="wu-header-meta">(${meta})</span>`;
      };

      return {
        render(renderContext) {
          const wrapper = createElement('section', 'wu-plugin wu-plugin-messagesofday');

          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          let renderedContainers = 0;

          for (const studentSlice of students) {
            const messages = Array.isArray(studentSlice?.data?.messages) ? studentSlice.data.messages : [];
            if (messages.length === 0) {
              continue;
            }

            const studentName = String(studentSlice?.student?.title || '');
            const studentSection = createContainer();
            addHeader(studentSection, buildHeaderTitle(studentName));

            const messagesGrid = createElement('div', 'messages-grid');
            studentSection.appendChild(messagesGrid);

            for (const message of messages) {
              const subject = String(message?.subject || '').trim();
              const text = String(message?.text || '').trim();
              const isExpanded = message?.isExpanded === true;
              const subjectHtml = subject ? `<span class="message-subject wu-message__subject">${escapeHtml(subject)}</span>` : '';
              const contentText = text || escapeHtml(translate('no_text', 'No text'));
              const fullContent = subjectHtml
                ? `${subjectHtml}<span class="message-text wu-message__text">${contentText}</span>`
                : `<span class="message-text wu-message__text">${contentText}</span>`;

              addFullRow(messagesGrid, isExpanded ? 'messageRow message-expanded' : 'messageRow', fullContent);
            }

            wrapper.appendChild(studentSection);
            renderedContainers += 1;
          }

          if (renderedContainers === 0) {
            const emptyContainer = createContainer();
            addHeader(emptyContainer, buildHeaderTitle(''));
            const messagesGrid = createElement('div', 'messages-grid');
            emptyContainer.appendChild(messagesGrid);
            addFullRow(messagesGrid, 'messageRowEmpty', escapeHtml(translate('no_messages', 'No messages')));
            wrapper.appendChild(emptyContainer);
          }

          return wrapper;
        },
      };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
