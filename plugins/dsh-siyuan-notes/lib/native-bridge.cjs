// 只经本机原生会话的 loadPetals 响应加载，不安装到思源工作空间。
const { Plugin, Protyle } = require("siyuan");

module.exports = class DshNativeBridge extends Plugin {
  onload() {
    // 此桥接没有内核插件，初始化仅发生在当前浏览器页面。
    if (this.kernel) this.kernel.init = async () => {};
    this.boot = window.__DSH_NATIVE__;
    this.disposers = [];
    this.revision = 0;
    this.savedRevision = 0;
    this.requests = new Set();
    this.saveError = null;
    this.originalFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url, location.href);
      const request = this.originalFetch.call(window, input, init);
      if (url.origin !== location.origin || !["/api/transactions", "/api/transactions/undo", "/api/transactions/redo", "/api/filetree/renameDoc", "/api/filetree/renameDocByID"].includes(url.pathname)) return request;
      this.send("dirty");
      const checked = request.then(async (response) => {
        const data = await response.clone().json();
        if (!response.ok || data.code !== 0 || data.data?.failed) throw new Error(data.msg || data.data?.msg || "原生事务未确认");
        return response;
      });
      this.requests.add(checked);
      checked.then(() => {
        this.requests.delete(checked);
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => void this.flush().catch(() => {}), 500);
      }, (error) => {
        this.requests.delete(checked);
        this.saveError = error.message;
        this.send("error", { message: this.saveError });
      });
      return request;
    };
  }

  send(type, payload = {}) {
    const message = { source: "dsh-siyuan-native", channel: this.boot.channel, docId: this.boot.docId, type, payload };
    window.parent.postMessage(message, this.boot.parentOrigin === "null" ? "*" : this.boot.parentOrigin);
  }

  onLayoutReady() {
    const start = () => {
      if (!window.siyuan?.isReady) { this.readyTimer = setTimeout(start, 100); return; }
      const root = document.createElement("div");
      root.id = "dsh-native-editor";
      const host = document.createElement("div");
      root.appendChild(host);
      document.body.appendChild(root);
      this.root = root;
      this.editor = new Protyle(this.app, host, {
        blockId: this.boot.docId,
        action: ["cb-get-all", "cb-get-focus"],
        render: { breadcrumb: false, title: true, background: false, gutter: true, scroll: true },
        after: (editor) => this.bindEditor(editor),
      });
    };
    start();
  }

  bindEditor(editor) {
    this.editor = editor;
    if (this.boundElement === editor.protyle.wysiwyg.element) return;
    this.boundElement = editor.protyle.wysiwyg.element;
    if (typeof editor.flushPendingTransactions !== "function") {
      editor.disable();
      this.send("error", { message: "当前思源编辑器缺少事务确认接口，请切回 Markdown 模式" });
      return;
    }
    const editable = editor.protyle.wysiwyg.element;
    editor.disable();
    const quote = document.createElement("button");
    quote.type = "button";
    quote.className = "b3-button dsh-native-quote";
    quote.textContent = "引用到 DSH 对话";
    quote.hidden = true;
    quote.style.display = "none";
    document.body.appendChild(quote);
    this.quote = quote;
    const bind = (target, name, listener, capture = false) => { target.addEventListener(name, listener, capture); this.disposers.push(() => target.removeEventListener(name, listener, capture)); };
    const changed = () => {
      this.revision++;
      this.send("dirty");
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => void this.flush().catch(() => {}), 800);
    };
    bind(this.root, "beforeinput", changed, true);
    bind(this.root, "input", changed, true);
    bind(this.root, "compositionstart", () => { this.composing = true; }, true);
    bind(this.root, "compositionend", () => { this.composing = false; changed(); }, true);
    bind(this.root, "paste", (event) => { if (event.clipboardData?.files?.length) changed(); }, true);
    bind(this.root, "drop", (event) => { if (event.dataTransfer?.files?.length) changed(); }, true);
    const context = () => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      if (!anchor || !editable.contains(anchor)) { quote.hidden = true; quote.style.display = "none"; return; }
      const nodeElement = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
      const blockId = nodeElement?.closest("[data-node-id]")?.getAttribute("data-node-id") || null;
      const text = selection.isCollapsed ? "" : selection.toString().slice(0, 16000);
      const endNode = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
      const endBlockId = endNode?.closest("[data-node-id]")?.getAttribute("data-node-id") || blockId;
      this.selected = text ? { text, title: this.currentTitle(), docId: this.boot.docId, blockId, endBlockId } : null;
      quote.hidden = !this.selected;
      quote.style.display = this.selected ? "" : "none";
      this.send("context", { title: this.currentTitle(), blockId, selection: text ? { text, blockId, endBlockId, startLine: 0, endLine: 0 } : null });
    };
    bind(document, "selectionchange", context);
    bind(editable, "focusin", () => { this.send("focus"); context(); });
    bind(quote, "pointerdown", (event) => event.preventDefault());
    bind(quote, "click", () => { if (this.selected) this.send("quote", this.selected); });
    bind(window, "message", (event) => {
      const message = event.data;
      if (event.source !== window.parent || event.origin !== this.boot.parentOrigin || message?.channel !== this.boot.channel || message.docId !== this.boot.docId) return;
      if (message.type === "flush") {
        void this.flush().then(() => this.send("flushed", { requestId: message.requestId }),
          (error) => this.send("flush-failed", { requestId: message.requestId, message: error.message }));
      } else if (message.type === "quote" && this.selected) this.send("quote", this.selected);
      else if (message.type === "focus-block" && /^\d{14}-[a-z0-9]{7}$/.test(message.blockId || "")) {
        const block = editable.querySelector(`[data-node-id="${message.blockId}"]`);
        if (block) { editor.focusBlock(block); block.scrollIntoView({ block: "center" }); }
      }
    });
    bind(window, "beforeunload", (event) => {
      if (this.revision !== this.savedRevision || this.requests.size || this.saveError) { event.preventDefault(); event.returnValue = ""; }
    });
    const ready = () => {
      const socket = editor.protyle.ws?.ws;
      if (socket?.readyState !== WebSocket.OPEN) {
        if ((this.readyAttempts = (this.readyAttempts || 0) + 1) > 100) { this.send("error", { message: "思源实时连接未建立，请重新登录" }); return; }
        this.socketTimer = setTimeout(ready, 100); return;
      }
      bind(socket, "close", () => { this.connectionLost = true; this.send("connection-lost", { message: "思源实时连接已断开，请核对网络和登录状态" }); });
      editor.enable();
      this.send("ready", { version: editor.version });
      this.send("context", { title: this.currentTitle(), blockId: null, selection: null });
    };
    ready();
  }

  currentTitle() { return this.root?.querySelector(".protyle-title__input")?.textContent || this.boot.title; }

  async flush() {
    if (this.composing) throw new Error("输入法仍在组合文字，请完成输入后再切换");
    if (!this.editor) throw new Error("原生编辑器仍在加载");
    if (this.editor.isUploading()) throw new Error("图片仍在上传，请上传结束后再切换");
    const revision = this.revision;
    this.send("saving");
    try {
      await this.editor.flushPendingTransactions();
      await Promise.all([...this.requests]);
      if (this.saveError) throw new Error(this.saveError);
      if (revision !== this.revision) throw new Error("保存期间有新输入，请稍后再切换");
      this.savedRevision = revision;
      this.send("saved", { title: this.currentTitle() });
    } catch (error) {
      this.send("error", { message: error.message });
      throw error;
    }
  }

  onunload() {
    clearTimeout(this.readyTimer);
    clearTimeout(this.saveTimer);
    clearTimeout(this.socketTimer);
    for (const dispose of this.disposers || []) dispose();
    this.editor?.destroy();
    this.root?.remove();
    this.quote?.remove();
    if (this.originalFetch) window.fetch = this.originalFetch;
  }
};
