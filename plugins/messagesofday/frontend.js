(function registerMessagesOfDayPlugin(root) {
  const host = root.MMMWebuntisPluginHost;
  const sharedDom = root.MMMWebuntisFrontendShared?.dom;
  if (!host || typeof host.registerFrontendPlugin !== "function" || !sharedDom) {
    return;
  }

  const { addFullRow, addHeader, createContainer, createElement, el, headerTitleNodes, richTextNodes } = sharedDom;

  const listOrEmpty = (value) => (Array.isArray(value) ? value : []);

  host.registerFrontendPlugin({
    id: "messagesofday",
    hostApiVersion: 1,

    create(pluginContext) {
      const translate = (key, fallback) => {
        if (typeof pluginContext?.translate !== "function") return fallback;
        const translated = pluginContext.translate(key, fallback);
        return translated || fallback;
      };

      const buildHeaderTitle = (studentTitle = "") => {
        const student = String(studentTitle || "").trim();
        return headerTitleNodes(translate("messagesofday", "Messages of the Day"), student ? `${student}, all` : "all");
      };

      /** Container with header and a grid for its rows. */
      const createMessagesSection = (studentTitle) => {
        const section = createContainer();
        addHeader(section, buildHeaderTitle(studentTitle));
        const messagesGrid = createElement("div", "messages-grid");
        section.appendChild(messagesGrid);
        return { section, messagesGrid };
      };

      /**
       * One message: optional subject (text), then the text. The text is safe HTML from
       * sanitizeRichText(); richTextNodes() keeps only its formatting tags, never parsed as markup here.
       */
      const buildMessageContent = (message) => {
        const subject = String(message?.subject || "").trim();
        const text = String(message?.text || "").trim();
        return [
          subject ? el("span", "message-subject wu-message__subject", subject) : "",
          el("span", "message-text wu-message__text", text ? richTextNodes(text) : translate("no_text", "No text")),
        ];
      };

      const renderStudentMessages = (studentSlice) => {
        const messages = listOrEmpty(studentSlice?.data?.messages);
        if (messages.length === 0) return null;
        const { section, messagesGrid } = createMessagesSection(String(studentSlice?.student?.title || ""));
        for (const message of messages) {
          const rowType = message?.isExpanded === true ? "messageRow message-expanded" : "messageRow";
          addFullRow(messagesGrid, rowType, buildMessageContent(message));
        }
        return section;
      };

      return {
        render(renderContext) {
          const wrapper = createElement("section", "wu-plugin wu-plugin-messagesofday");
          for (const studentSlice of listOrEmpty(renderContext?.students)) {
            const section = renderStudentMessages(studentSlice);
            if (section) wrapper.appendChild(section);
          }

          if (wrapper.childElementCount === 0) {
            const { section, messagesGrid } = createMessagesSection("");
            addFullRow(messagesGrid, "messageRowEmpty", translate("no_messages", "No messages"));
            wrapper.appendChild(section);
          }

          return wrapper;
        },
      };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
