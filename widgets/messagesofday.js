/**
 * Messages of Day Widget
 * Renders daily messages/announcements from school
 * Supports:
 * - Subject and text display
 * - HTML-formatted text (safe tags only: b, i, u, br, p)
 * - Expanded message display mode
 * - Localized "Messages of the Day" header
 */
(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { log, escapeHtml, addFullRow, addHeader, createWidgetContext, buildWidgetHeaderTitle } = root.util?.initWidget?.(root) || {};

  /**
   * Render messages of day widget for a single student
   * Displays messages in full-width rows with subject + text
   * Text supports safe HTML formatting tags (backend sanitizes)
   *
   * @param {Object} ctx - Main module context (provides translate, config)
   * @param {HTMLElement} container - DOM element to append message rows
   * @param {string} studentCellTitle - Student name (not used, messages span full width)
   * @param {Object} studentConfig - Student-specific configuration
   * @param {Array} messagesOfDay - Array of message objects (subject, text, isExpanded)
   * @returns {number} Number of rows added to container
   */
  function renderMessagesOfDayForStudent(ctx, container, studentCellTitle, studentConfig, messagesOfDay) {
    let addedRows = 0;

    const widgetCtx = createWidgetContext('messagesofday', studentConfig, root.util || {}, ctx);

    // Add widget header with active filter/range context
    const headerTitle = buildWidgetHeaderTitle(ctx, 'messagesofday', widgetCtx, studentCellTitle);
    addHeader(container, headerTitle);

    const messagesContainer = document.createElement('div');
    messagesContainer.className = 'messages-grid';
    container.appendChild(messagesContainer);

    if (!Array.isArray(messagesOfDay) || messagesOfDay.length === 0) {
      log('debug', `[messagesofday] no data`);
      addFullRow(messagesContainer, 'messageRowEmpty', ctx.translate('no_messages'));
      return 1;
    }

    log('debug', `[messagesofday] render start | entries: ${messagesOfDay.length}`);

    const sorted = messagesOfDay.slice();

    for (const msg of sorted) {
      const subject = String(msg?.subject || '').trim();
      const text = String(msg?.text || '').trim();
      const isExpanded = msg?.isExpanded === true;

      // Subject as bold prefix, followed by text on the same line or next line
      const subjectHtml = subject ? `<span class="message-subject">${escapeHtml(subject)}</span>` : '';
      const contentText = text || ctx.translate('no_text');

      // Combine subject and text
      const fullContent = subjectHtml
        ? `${subjectHtml}<span class="message-text">${contentText}</span>`
        : `<span class="message-text">${contentText}</span>`;

      // Build the row classes
      let rowClasses = 'messageRow';
      if (isExpanded) {
        rowClasses += ' message-expanded';
      }

      // Text contains safe HTML formatting tags from backend (b, i, u, etc.)
      // Don't escape - render as HTML via innerHTML. Backend sanitizes and only allows safe tags.
      addFullRow(messagesContainer, rowClasses, fullContent);
      addedRows++;
    }

    log('debug', `[messagesofday] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.messagesofday = root.messagesofday || {};
  root.messagesofday.renderMessagesOfDayForStudent = renderMessagesOfDayForStudent;
})();
