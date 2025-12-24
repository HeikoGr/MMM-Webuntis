(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const util = root.util || {};
  const log = typeof util.log === 'function' ? util.log : () => {};
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => {};

  function stripHtmlButKeepLineBreaks(html) {
    if (!html) return '';

    // Create a temporary DOM element to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Replace <br>, <br/>, <br /> tags with newlines before stripping
    temp.innerHTML = temp.innerHTML
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n');

    // Get text content (strips all HTML tags)
    let text = temp.textContent || temp.innerText || '';

    // Clean up multiple consecutive newlines
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
  }

  function renderMessagesOfDayForStudent(ctx, table, studentCellTitle, studentConfig, messagesOfDay) {
    let addedRows = 0;

    if (!Array.isArray(messagesOfDay) || messagesOfDay.length === 0) {
      log('debug', `[messagesofday] no data`);
      addTableRow(table, 'messageRowEmpty', studentCellTitle, ctx.translate('no_messages'));
      return 1;
    }

    log('debug', `[messagesofday] render start | entries: ${messagesOfDay.length}`);

    const sorted = messagesOfDay.slice();

    for (const msg of sorted) {
      const subject = String(msg?.subject || '').trim();
      const rawText = String(msg?.text || '').trim();
      const isExpanded = msg?.isExpanded === true;

      log('debug', `[messagesofday] add: subj="${subject}", text_len=${rawText.length}`);

      // Subject is displayed as the "meta" column (similar to date in other widgets)
      const meta = subject || '';

      // Strip HTML but preserve line breaks
      const cleanText = stripHtmlButKeepLineBreaks(rawText);

      // Build the main content text
      let contentText = cleanText || ctx.translate('no_text');

      // Build the row classes
      let rowClasses = 'messageRow';
      if (isExpanded) {
        rowClasses += ' message-expanded';
      }

      addTableRow(table, rowClasses, '', meta, '<b>' + ctx.translate('messagesofday') + '</b>' + '<br>' + escapeHtml(contentText));
      addedRows++;
    }

    log('debug', `[messagesofday] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.messagesofday = root.messagesofday || {};
  root.messagesofday.renderMessagesOfDayForStudent = renderMessagesOfDayForStudent;
})();
