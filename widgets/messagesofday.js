(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { log, escapeHtml, addFullRow, addHeader } = root.util?.initWidget?.(root) || {};

  function renderMessagesOfDayForStudent(ctx, container, studentCellTitle, studentConfig, messagesOfDay) {
    let addedRows = 0;

    // Add localized header "Messages of the Day" / "Nachrichten des Tages"
    const headerTitle = ctx.translate('messagesofday');
    addHeader(container, headerTitle);

    if (!Array.isArray(messagesOfDay) || messagesOfDay.length === 0) {
      log('debug', `[messagesofday] no data`);
      addFullRow(container, 'messageRowEmpty', ctx.translate('no_messages'));
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
        ? `${subjectHtml}<br/><span class="message-text">${contentText}</span>`
        : `<span class="message-text">${contentText}</span>`;

      // Build the row classes
      let rowClasses = 'messageRow';
      if (isExpanded) {
        rowClasses += ' message-expanded';
      }

      // Text contains safe HTML formatting tags from backend (b, i, u, etc.)
      // Don't escape - render as HTML via innerHTML. Backend sanitizes and only allows safe tags.
      addFullRow(container, rowClasses, fullContent);
      addedRows++;
    }

    log('debug', `[messagesofday] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.messagesofday = root.messagesofday || {};
  root.messagesofday.renderMessagesOfDayForStudent = renderMessagesOfDayForStudent;
})();
