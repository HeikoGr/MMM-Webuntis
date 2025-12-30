(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const util = root.util || {};
  const log = typeof util.log === 'function' ? util.log : () => { };
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => { };

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
      const text = String(msg?.text || '').trim();
      const isExpanded = msg?.isExpanded === true;

      // Subject is displayed as the "meta" column (similar to date in other widgets)
      const meta = subject || '';

      // Text comes pre-sanitized from backend with \n preserved from <br> tags
      const contentText = text || ctx.translate('no_text');

      // Build the row classes
      let rowClasses = 'messageRow';
      if (isExpanded) {
        rowClasses += ' message-expanded';
      }

      // Text contains safe HTML formatting tags from backend (b, i, u, etc.)
      // Don't escape - render as HTML via innerHTML. Backend sanitizes and only allows safe tags.
      // But DO escape the meta (subject) field
      addTableRow(table, rowClasses, '', escapeHtml(meta), contentText);
      addedRows++;
    }

    log('debug', `[messagesofday] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.messagesofday = root.messagesofday || {};
  root.messagesofday.renderMessagesOfDayForStudent = renderMessagesOfDayForStudent;
})();
