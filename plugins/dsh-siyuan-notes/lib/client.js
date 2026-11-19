window.__ModuleLoader__.load({
	id: "dsh-siyuan-notes",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;
		const { useCallback, useEffect, useMemo, useRef, useState } = React;

		/** Locale namespace owned by this plugin. */
		const NS = "siyuan-notes";
		/** Sidebar entry id; the layout dispatches the same key into the `main` slot. */
		const PANEL_ID = "siyuan-notes";
		/** 记忆面板是**独立**的侧栏入口——它不该挤进编辑器面板，也不该拖慢它的首屏。 */
		const MEMORY_PANEL_ID = "siyuan-memory";
		const HOST_BRIDGE = "/siyuan";

		// #region dictionaries
		const zh = {
			panel: "思源笔记",
			title: "思源笔记",
			subtitle: "浏览与编辑你的思源文档",
			connecting: "正在连接思源…",
			connectTitle: "连接思源内核",
			connectHint:
				"填写思源内核地址与 API token。Docker 部署通常是 http://宿主机IP:6806 ；token 在思源「设置 → 关于 → API token」里。",
			baseUrl: "内核地址",
			token: "API Token",
			connect: "连接",
			reconnect: "重新连接",
			connected: "已连接",
			disconnected: "未连接",
			version: "版本",
			notebooks: "笔记本",
			docs: "文档",
			outline: "大纲",
			search: "搜索文档…",
			searching: "搜索中…",
			noResults: "没有匹配的文档",
			noDocs: "这里还没有文档",
			noNotebook: "还没有笔记本",
			refresh: "刷新",
			loading: "加载中…",
			openNotebook: "打开笔记本",
			closedNotebook: "未打开",
			untitled: "未命名",
			editor: "编辑器",
			placeholder: "在这里书写 Markdown……",
			noDocSelected: "从左侧选择一篇文档开始编辑",
			noDocHint: "支持 Markdown 语法，Ctrl+S 保存，Ctrl+E 切换预览。",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
			savedAt: "已保存 {time}",
			unsaved: "未保存",
			reload: "重载",
			reloadHint: "放弃本地修改并从思源重新读取",
			edit: "编辑",
			split: "分栏",
			preview: "预览",
			autoSave: "自动保存",
			rename: "重命名",
			remove: "删除",
			confirmRemove: "确认删除《{title}》？",
			cancel: "取消",
			create: "新建",
			createDoc: "新建文档",
			createDocHint: "新建文档名称",
			blockCount: "{n} 个块",
			typingRate: "{n} 字/分",
			charCount: "{n} 字",
			emptyDoc: "（空文档）",
			saveFailed: "保存失败：{msg}",
			loadFailed: "读取失败：{msg}",
			fallbackNotice: "已整篇覆盖保存（块 ID 已重建）",
			verifyFailed: "保存后内容校验不一致，修改尚未确认，请重试或重新读取",
			saveUnconfirmed: "写入结果尚未确认，修改仍保留在编辑器中，请重试校验",
			backupFailed: "备份失败，已停止保存：{msg}",
			closeUnsaved: "以下文档有未保存或未确认的修改：{titles}。确定放弃并关闭吗？取消后可按 Ctrl+S 保存。",
			closeSaving: "文档正在保存，请完成后再关闭",
			backupAt: "备份：{file}",
			markdown: "Markdown",
			insertTable: "插入表格",
			insertLink: "插入链接",
			link: "链接",
			insertCode: "插入代码块",
			insertImage: "插入图片",
			uploading: "上传中…",
			uploadFailed: "图片上传失败：{msg}",
			uploadCancelled: "编辑标签已切换或关闭，图片未插入；已上传的资源保留在思源中",
			uploadTooLarge: "图片超过 20MB，先压缩再插入",
			imageBroken: "图未找到",
			imageLine: "第 {n} 行",
			imageAlt: "图片说明",
			imageWidth: "宽度",
			imageWidthOriginal: "原始",
			imageWidthHalf: "50%",
			imageWidthFull: "100%",
			imageDelete: "删除该图",
			imageSource: "显示源码",
			imageSourceHide: "收起源码",
			imageResplit: "重排图片卡片",
			imageResplitHint: "把新写好的 ![…](…) 行收成图片卡片（正常打字不会自动收，免得光标被吃掉）",
			imageOpen: "在新标签页打开原图",
			quoteBlock: "引用",
			bullets: "无序列表",
			numbers: "有序列表",
			tasks: "任务列表",
			divider: "分隔线",
			bold: "加粗",
			italic: "斜体",
			strike: "删除线",
			code: "行内代码",
			underline: "下划线",
			highlight: "高亮",
			find: "查找",
			findPlaceholder: "在当前文档里查找…",
			findNext: "下一个",
			findPrev: "上一个",
			findNone: "没有匹配",
			findCount: "{n}/{total}",
			chineseCount: "中文 {n}",
			outlineJump: "跳到这一行",
			h1: "一级标题",
			h2: "二级标题",
			h3: "三级标题",
			outlineEmpty: "这篇文档没有标题结构",
			tip: "提示",
			close: "关闭",
			retry: "重试",
			newTab: "新标签页",
			indent: "首行缩进",
			indentHint: "开启后按回车即开始一个缩进两格的新段落；旁边的「补齐全篇」可以把已经写好的段落也补上缩进",
			indentAppliedCount: "已给 {n} 个段落补上缩进（开关保持打开）",
			indentRemoved: "已移除当前文档段落的缩进",
			indentAlreadyOn: "段落已经都有缩进了（开关保持打开）",
			indentAlreadyOff: "段落本来就没有缩进（开关已关闭）",
			splitPane: "在右侧拆分",
			splitLimit: "最多只能分成三栏",
			indentFill: "补齐全篇（{n} 段）",
			indentFillHint: "给还没缩进的段落补上首行缩进，并保持开关打开",
			closePane: "关闭这个面板",
			paneEmpty: "这个面板还没有文档",
			paneEmptyHint: "在左侧点一篇文档，就会在这里打开",
			paneStale: "另一个面板保存了这篇文档",
			paneStaleReload: "重载",
			changeExternal: "文档已被外部修改（AI 或思源端），保存已暂停",
			changeUnverified: "无法确认文档状态：{msg}",
			changeReload: "重新读取",
			changeRetry: "重试保存",
			changeOverwrite: "仍要保存（覆盖）",
			changeSkipCheck: "仍要保存（跳过检测）",
			changeSkipped: "未确认文档状态就保存了：{msg}（无备份，按上次已知内容为基线）",
			closeTab: "关闭标签页",
			chat: "对话",
			chatSide: "右侧栏",
			chatFloat: "悬浮窗",
			chatClose: "关闭对话",
			chatCollapse: "收起到边缘",
			chatExpand: "展开对话",
			chatResize: "拖动调整大小",
			chatHistory: "历史对话",
			chatHistoryEmpty: "还没有别的对话",
			chatNew: "新开对话",
			chatNewHint: "开一个新对话，并在这一栏里跟它聊",
			chatNewFailed: "新开对话失败，请重试",
			chatCurrent: "当前",
			chatRunning: "正在回复",
			quoteOpening: "正在打开对话栏…",
			chatSideHint: "在面板右侧打开对话栏（可关闭）",
			chatFloatHint: "打开悬浮对话窗；可收起到面板边缘，点一下再展开",
			quoteSelected: "引用到对话",
			quoteSelectedHint: "把选中的这段原文引用到对话输入框",
			quoteSource: "摘自",
			quoteLine: "第 {n} 行",
			quoteFailed: "引用失败：下方输入框暂时不可用，请先切到对话面板",
			quoteDone: "已引用到下方输入框，接着输入你的问题即可",
			chatUnavailable: "对话暂不可用（未选中会话）",
			chatBrokenHint: "编辑功能不受影响；可以刷新页面，或先在左侧对话里说句话再切回来",
			panelBrokenHint: "可以刷新页面重试；如果反复出现，把这段错误信息发给我",
			// 记忆面板
			memory: "记忆体",
			memoryTitle: "长期记忆体",
			memorySubtitle: "模型跨会话记住的东西，写入即生效。改正文请直接在思源里改，这里做查看与撤销。",
			memoryRefresh: "重新读取",
			memoryAll: "全部",
			memoryEmpty: "还没有记忆。模型认为值得长期记住的东西会自动出现在这里。",
			memoryLoading: "正在读取记忆…",
			memoryFailed: "读取失败：{message}",
			memoryProject: "项目过滤…",
			memoryRevoke: "撤销这条",
			memoryRestore: "恢复为有效",
			memoryRevoked: "已撤销",
			memoryRestored: "已恢复",
			memoryActionFailed: "操作失败：{message}",
			memoryCopyId: "复制 id",
			memoryCopied: "id 已复制",
			memoryCount: "{n} 条",
			memoryTypePref: "偏好",
			memoryTypeFact: "事实",
			memoryTypeDecision: "决策",
			memoryTypeState: "状态",
			memoryStatusActive: "有效",
			memoryStatusCandidate: "候选（推断）",
			memoryApprove: "调整范围或正文后确认",
			memoryApproved: "已确认生效",
			memoryPartial: "仅展示最新的部分条目，请缩小筛选范围。",
			memoryStatusSuperseded: "已被取代",
			memoryStatusRevoked: "已撤销",
			memoryHandoff: "交接卡",
			memoryHandoffClose: "收起交接卡",
			memoryHandoffHint: "把当前记忆压成一段可粘贴的 Markdown。注意它是记忆快照，不是本次会话的流水。",
			memoryHandoffCopy: "复制全文",
			memoryRefcount: "读过 {n} 次",
			memoryRefcountHint: "被 memory_read 读过的次数。一直是 0 的条目可能是噪音，值得回头看看。",
		};
		const en = {
			panel: "SiYuan Notes",
			title: "SiYuan Notes",
			subtitle: "Browse and edit your SiYuan documents",
			connecting: "Connecting to SiYuan…",
			connectTitle: "Connect the SiYuan kernel",
			connectHint:
				"Enter the kernel URL and API token. A Docker deployment usually listens on http://<host>:6806; the token lives in SiYuan → Settings → About → API token.",
			baseUrl: "Kernel URL",
			token: "API token",
			connect: "Connect",
			reconnect: "Reconnect",
			connected: "Connected",
			disconnected: "Disconnected",
			version: "Version",
			notebooks: "Notebooks",
			docs: "Documents",
			outline: "Outline",
			search: "Search documents…",
			searching: "Searching…",
			noResults: "No matching document",
			noDocs: "No document here yet",
			noNotebook: "No notebook yet",
			refresh: "Refresh",
			loading: "Loading…",
			openNotebook: "Open notebook",
			closedNotebook: "Closed",
			untitled: "Untitled",
			editor: "Editor",
			placeholder: "Write Markdown here…",
			noDocSelected: "Pick a document on the left to start editing",
			noDocHint: "Markdown supported. Ctrl+S saves, Ctrl+E toggles the preview.",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			savedAt: "Saved {time}",
			unsaved: "Unsaved",
			reload: "Reload",
			reloadHint: "Discard local changes and read the document again",
			edit: "Edit",
			split: "Split",
			preview: "Preview",
			autoSave: "Auto save",
			rename: "Rename",
			remove: "Delete",
			confirmRemove: "Delete “{title}”?",
			cancel: "Cancel",
			create: "New",
			createDoc: "New document",
			createDocHint: "New document title",
			blockCount: "{n} blocks",
			typingRate: "{n} cpm",
			charCount: "{n} chars",
			emptyDoc: "(empty document)",
			saveFailed: "Save failed: {msg}",
			loadFailed: "Load failed: {msg}",
			fallbackNotice: "Saved by replacing the whole document (block ids rebuilt)",
			verifyFailed: "Saved content did not match. Changes remain unconfirmed; retry or reload.",
			saveUnconfirmed: "The write is unconfirmed. Your changes remain in the editor; retry verification.",
			backupFailed: "Backup failed; saving was stopped: {msg}",
			closeUnsaved: "These documents have unsaved or unconfirmed changes: {titles}. Discard and close? Cancel to save with Ctrl+S.",
			closeSaving: "Wait for the document to finish saving before closing it",
			backupAt: "Backup: {file}",
			markdown: "Markdown",
			insertTable: "Insert table",
			insertLink: "Insert link",
			link: "Link",
			insertCode: "Insert code block",
			insertImage: "Insert image",
			uploading: "Uploading…",
			uploadFailed: "Image upload failed: {msg}",
			uploadCancelled: "The editor tab changed or closed. The image was not inserted; any uploaded asset remains in SiYuan.",
			uploadTooLarge: "Image is over 20MB — compress it before inserting",
			imageBroken: "Image not found",
			imageLine: "line {n}",
			imageAlt: "Caption",
			imageWidth: "Width",
			imageWidthOriginal: "Original",
			imageWidthHalf: "50%",
			imageWidthFull: "100%",
			imageDelete: "Delete image",
			imageSource: "Show source",
			imageSourceHide: "Hide source",
			imageResplit: "Rebuild image cards",
			imageResplitHint: "Turn freshly typed ![…](…) lines into image cards (typing never does this on its own, so the caret is never stolen)",
			imageOpen: "Open the original in a new tab",
			quoteBlock: "Quote",
			bullets: "Bullet list",
			numbers: "Numbered list",
			tasks: "Task list",
			divider: "Divider",
			bold: "Bold",
			italic: "Italic",
			strike: "Strikethrough",
			code: "Inline code",
			underline: "Underline",
			highlight: "Highlight",
			find: "Find",
			findPlaceholder: "Find in this document…",
			findNext: "Next",
			findPrev: "Previous",
			findNone: "No match",
			findCount: "{n}/{total}",
			chineseCount: "{n} Chinese",
			outlineJump: "Jump to this line",
			h1: "Heading 1",
			h2: "Heading 2",
			h3: "Heading 3",
			outlineEmpty: "This document has no heading structure",
			tip: "Tip",
			close: "Close",
			retry: "Retry",
			newTab: "New tab",
			indent: "First-line indent",
			indentHint: "With this on, Enter starts a new indented paragraph; the Indent all button next to it indents the paragraphs already written",
			indentAppliedCount: "Indented {n} paragraphs (the switch stays on)",
			indentRemoved: "Removed the paragraph indents in this document",
			indentAlreadyOn: "Every paragraph already has the indent (the switch stays on)",
			indentAlreadyOff: "Paragraphs had no indent (the switch is now off)",
			splitPane: "Split right",
			splitLimit: "Three columns at most",
			indentFill: "Indent all ({n})",
			indentFillHint: "Indent the paragraphs that still lack it and keep the switch on",
			closePane: "Close this pane",
			paneEmpty: "No document in this pane",
			paneEmptyHint: "Pick a document on the left to open it here",
			paneStale: "Another pane saved this document",
			paneStaleReload: "Reload",
			changeExternal: "This document was changed outside the panel (AI or SiYuan) — saving is paused",
			changeUnverified: "Could not confirm the document state: {msg}",
			changeReload: "Reload",
			changeRetry: "Retry save",
			changeOverwrite: "Save anyway (overwrite)",
			changeSkipCheck: "Save anyway (skip check)",
			changeSkipped: "Saved without confirming the document state: {msg} (no backup; based on the last known content)",
			closeTab: "Close tab",
			chat: "Chat",
			chatSide: "Side panel",
			chatFloat: "Floating",
			chatClose: "Close chat",
			chatCollapse: "Collapse to edge",
			chatExpand: "Expand chat",
			chatResize: "Drag to resize",
			chatHistory: "History",
			chatHistoryEmpty: "No other conversations yet",
			chatNew: "New chat",
			chatNewHint: "Start a new conversation and talk to it right here",
			chatNewFailed: "Could not start a new conversation",
			chatCurrent: "current",
			chatRunning: "replying",
			quoteOpening: "Opening chat\u2026",
			chatSideHint: "Open the conversation in a closable right column",
			chatFloatHint: "Open a floating chat window; it collapses to an edge tab you can click",
			quoteSelected: "Quote to chat",
			quoteSelectedHint: "Quote exactly this passage into the composer",
			quoteSource: "from",
			quoteLine: "line {n}",
			quoteFailed: "Quote failed: the composer is not available yet — open the conversation panel once",
			quoteDone: "Quoted into the composer below; type your question",
			chatUnavailable: "Chat unavailable (no session selected)",
			chatBrokenHint: "Editing still works; refresh the page, or send a message in the main conversation first",
			panelBrokenHint: "Refresh to retry; if it keeps happening, send me this error text",
			// memory panel
			memory: "Memory",
			memoryTitle: "Long-term memory",
			memorySubtitle: "What the model remembers across sessions. Edit the text in SiYuan itself; this view is for browsing and revoking.",
			memoryRefresh: "Reload",
			memoryAll: "All",
			memoryEmpty: "No memories yet. Anything the model decides is worth keeping will show up here.",
			memoryLoading: "Loading memories…",
			memoryFailed: "Failed to load: {message}",
			memoryProject: "Filter by project…",
			memoryRevoke: "Revoke this",
			memoryRestore: "Restore as active",
			memoryRevoked: "Revoked",
			memoryRestored: "Restored",
			memoryActionFailed: "Action failed: {message}",
			memoryCopyId: "Copy id",
			memoryCopied: "id copied",
			memoryCount: "{n}",
			memoryTypePref: "Preference",
			memoryTypeFact: "Fact",
			memoryTypeDecision: "Decision",
			memoryTypeState: "State",
			memoryStatusActive: "Active",
			memoryStatusCandidate: "Candidate (inferred)",
			memoryApprove: "Adjust, then confirm",
			memoryApproved: "Confirmed",
			memoryPartial: "Only recent entries are shown. Narrow the filters.",
			memoryStatusSuperseded: "Superseded",
			memoryStatusRevoked: "Revoked",
			memoryHandoff: "Handoff",
			memoryHandoffClose: "Hide handoff",
			memoryHandoffHint: "Condenses the current memories into pasteable Markdown. It is a memory snapshot, not this session's transcript.",
			memoryHandoffCopy: "Copy all",
			memoryRefcount: "read {n}×",
			memoryRefcountHint: "Times this entry was read via memory_read. Entries stuck at 0 may be noise.",
		};
		// #endregion

		// #region styles
		const CSS = `
.sy-root{position:relative;display:flex;flex:1 1 auto;flex-direction:column;min-height:0;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}
.sy-root *{box-sizing:border-box}
.sy-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;white-space:nowrap}
.sy-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.sy-btn:disabled{opacity:.45;cursor:default}
.sy-btn[data-tone=accent]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base)}
.sy-btn[data-tone=accent]:hover{filter:brightness(1.06)}
.sy-btn[data-tone=danger]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.sy-btn[data-tone=ghost]{border-color:transparent}
.sy-btn[data-active=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.sy-iconbtn{width:26px;height:26px;padding:0;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;border:.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit}
.sy-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sy-iconbtn[data-active=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sy-header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.sy-header h1{margin:0;font-size:14px;font-weight:600;letter-spacing:.01em}
.sy-header .sy-sub{color:var(--dsw-alias-label-secondary);font-size:12px}
.sy-spacer{flex:1 1 auto}
.sy-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:0 0 auto}
.sy-dot[data-on=true]{background:var(--dsw-alias-state-success-primary)}
.sy-dot[data-on=false]{background:var(--dsw-alias-state-error-primary)}
.sy-body{flex:1 1 auto;display:flex;min-height:0}
.sy-side{width:272px;flex:0 0 272px;display:flex;flex-direction:column;min-height:0;border-right:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.sy-side-head{display:flex;align-items:center;gap:6px;padding:8px 10px;flex:0 0 auto}
.sy-tabs{display:flex;gap:2px;padding:2px;border-radius:7px;background:var(--dsw-alias-bg-base)}
.sy-tabs button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:3px 10px;border-radius:5px;cursor:pointer}
.sy-tabs button[data-active=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sy-search{position:relative;padding:0 10px 8px;flex:0 0 auto}
.sy-search input{width:100%;height:28px;padding:0 8px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.sy-search input:focus{border-color:var(--dsw-alias-brand-primary)}
.sy-scroll{flex:1 1 auto;overflow:auto;min-height:0;padding:0 6px 12px}
.sy-tree-row{display:flex;align-items:center;gap:4px;height:26px;padding:0 6px;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-primary);user-select:none}
.sy-tree-row:hover{background:var(--dsw-alias-bg-layer-2)}
.sy-tree-row[data-active=true]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.sy-tree-row[data-active=true] .sy-tree-sub{color:color-mix(in srgb,currentColor 76%,transparent)}
.sy-caret{width:14px;height:14px;flex:0 0 14px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);transition:transform .12s ease}
.sy-caret[data-open=true]{transform:rotate(90deg)}
.sy-tree-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sy-tree-sub{font-size:11px;color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.sy-emoji{width:16px;flex:0 0 16px;text-align:center;font-size:12px}
.sy-hint{padding:14px;color:var(--dsw-alias-label-secondary);text-align:center;font-size:12px}
.sy-outline-row{padding:4px 8px;border-radius:6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.sy-outline-row:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sy-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dsw-alias-bg-base)}
.sy-native{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.sy-native-viewport{flex:1;min-height:0}
.sy-native-frame{position:fixed;border:0;background:var(--dsw-alias-bg-base);z-index:2}
.sy-native-status{padding:6px 12px;color:var(--dsw-alias-label-secondary);font-size:12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.sy-native-status[data-error=true]{color:var(--dsw-alias-state-error-primary)}
.sy-panes{flex:1 1 auto;display:flex;min-width:0;min-height:0}
.sy-column{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0}
.sy-pane{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;border-left:.5px solid var(--dsw-alias-border-l1)}
.sy-pane:first-child{border-left:0}
.sy-pane[data-active=false] .sy-pane-head{opacity:.66}
.sy-pane[data-active=true] .sy-pane-head{box-shadow:inset 0 -1.5px 0 var(--dsw-alias-brand-primary)}
.sy-pane-head{display:flex;align-items:center;gap:4px;padding:4px 8px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:0 0 auto;min-height:32px;overflow:hidden}
.sy-tabstrip{display:flex;align-items:center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:none}
.sy-tabstrip::-webkit-scrollbar{display:none}
.sy-tabpill{display:inline-flex;align-items:center;gap:6px;max-width:190px;height:24px;padding:0 6px 0 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;user-select:none;flex:0 0 auto}
.sy-tabpill:hover{color:var(--dsw-alias-label-primary)}
.sy-tabpill[data-active=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}
.sy-tab-name{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sy-tab-x{opacity:.55;font-size:11px;line-height:1;padding:0 1px;border-radius:3px}
.sy-tab-x:hover{opacity:1;color:var(--dsw-alias-state-error-primary)}
.sy-tab-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:0 0 auto}
.sy-pane-actions{display:flex;align-items:center;gap:2px;flex:0 0 auto}
/* The conversation owns its own scrolling and pins its composer using a measured
   --dsh-composer-height, so it needs a container with a DEFINITE size: absolute
   fill inside a sized parent is the reliable shape. */
.sy-chat-fill{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.sy-chat-fill>div{flex:1 1 auto;min-height:0;height:100%}
.sy-sidechat{flex:0 0 384px;width:384px;display:flex;flex-direction:column;min-height:0;min-width:0;border-left:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);position:relative}
.sy-sidechat-head,.sy-float-head{display:flex;align-items:center;gap:6px;cursor:move;user-select:none;touch-action:none;padding:4px 8px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:0 0 auto;min-height:30px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.sy-sidechat-body{flex:1 1 auto;position:relative;min-height:0}
/* Session list floating under the header, shared by both surfaces. */
.sy-chatmenu{position:absolute;top:30px;left:6px;right:6px;z-index:30;max-height:min(60%,340px);overflow:auto;padding:4px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 28px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);display:flex;flex-direction:column;gap:1px}
.sy-chatmenu-empty{padding:10px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:center}
.sy-chatmenu-row{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.45;text-align:left;cursor:pointer}
.sy-chatmenu-row:hover{background:var(--dsw-alias-bg-layer-2)}
.sy-chatmenu-row[data-current=true]{color:var(--dsw-alias-brand-primary)}
.sy-chatmenu-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sy-chatmenu-tag{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sy-float{position:absolute;right:14px;bottom:14px;width:430px;height:66%;max-height:640px;min-height:260px;z-index:40;display:flex;flex-direction:column;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);box-shadow:0 12px 36px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);overflow:hidden}
.sy-float-body{flex:1 1 auto;position:relative;min-height:0}
.sy-float-resize{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none}
.sy-float-resize:after{content:"";position:absolute;right:3px;bottom:3px;width:9px;height:9px;border-right:2px solid var(--dsw-alias-border-l2);border-bottom:2px solid var(--dsw-alias-border-l2)}
.sy-float[data-collapsed=true]{display:none}
.sy-float-tab{position:absolute;right:0;top:50%;transform:translateY(-50%);z-index:40;display:inline-flex;align-items:center;gap:4px;padding:8px 6px;border:.5px solid var(--dsw-alias-border-l2);border-right:0;border-radius:8px 0 0 8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;writing-mode:vertical-rl}
.sy-float-tab:hover{color:var(--dsw-alias-label-primary)}
.sy-chat-fallback{flex:1 1 auto;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:12px;padding:20px;text-align:center}
.sy-boundary{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:20px;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;min-height:0;overflow:auto}
.sy-boundary strong{color:var(--dsw-alias-state-error-primary);font-size:12px;font-weight:600}
.sy-boundary-hint{color:var(--dsw-alias-label-secondary);opacity:.85}
.sy-toolbar{display:flex;align-items:center;gap:4px;padding:6px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:0 0 auto;flex-wrap:wrap;row-gap:4px}
.sy-toolbar .sy-div{width:.5px;height:16px;background:var(--dsw-alias-border-l1);margin:0 4px;flex:0 0 auto}
.sy-doc-title{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:38ch}
.sy-badge{font-size:11px;padding:1px 7px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sy-badge[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.sy-badge[data-tone=ok]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.sy-badge[data-tone=err]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.sy-workarea{flex:1 1 auto;display:flex;min-height:0}
.sy-editorwrap{flex:1 1 auto;display:flex;min-width:0;min-height:0}
/* Floating action bar over a text selection, mirroring the app's own selection menu. */
.sy-selbar{position:fixed;z-index:60;display:flex;align-items:center;gap:2px;padding:3px;border-radius:9px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 6px 20px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
.sy-selbar button{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.4;white-space:nowrap;cursor:pointer}
.sy-selbar button:hover{background:var(--dsw-alias-bg-layer-2)}
.sy-textarea{flex:1 1 50%;min-width:0;min-height:0;resize:none;border:0;outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,"JetBrains Mono",Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.7;padding:20px 22px;tab-size:2}
.sy-findbar{display:flex;align-items:center;gap:6px;padding:4px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.sy-findbar input{flex:0 1 260px;height:26px;padding:0 8px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}
.sy-findbar input:focus{border-color:var(--dsw-alias-brand-primary)}
.sy-findcount{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:52px}
.sy-textarea::placeholder{color:var(--dsw-alias-label-secondary)}
.sy-preview{flex:1 1 50%;min-width:0;min-height:0;overflow:auto;padding:20px 26px 60px;border-left:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.sy-preview[data-only=true]{border-left:0;flex:1 1 auto;max-width:980px;margin:0 auto;width:100%}
.sy-preview h1,.sy-preview h2,.sy-preview h3,.sy-preview h4,.sy-preview h5,.sy-preview h6{margin:1.4em 0 .5em;line-height:1.3;font-weight:600}
.sy-preview h1{font-size:1.7em}.sy-preview h2{font-size:1.4em}.sy-preview h3{font-size:1.2em}.sy-preview h4{font-size:1.05em}
.sy-preview h1:first-child,.sy-preview h2:first-child{margin-top:0}
.sy-preview p{margin:.55em 0}
.sy-preview.sy-indent p{text-indent:2em}
.sy-preview ul,.sy-preview ol{margin:.5em 0;padding-left:1.6em}
.sy-preview li{margin:.18em 0}
.sy-preview blockquote{margin:.7em 0;padding:.1em 0 .1em .9em;border-left:3px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-secondary)}
.sy-preview pre{margin:.7em 0;padding:12px 14px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);overflow:auto;font-size:12.5px;line-height:1.6}
.sy-preview code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em;background:var(--dsw-alias-bg-layer-2);padding:1px 5px;border-radius:4px}
.sy-preview pre code{background:transparent;padding:0}
.sy-preview table{border-collapse:collapse;margin:.7em 0;font-size:12.5px;display:block;overflow:auto}
.sy-preview th,.sy-preview td{border:.5px solid var(--dsw-alias-border-l2);padding:5px 10px;text-align:left}
.sy-preview th{background:var(--dsw-alias-bg-layer-1);font-weight:600}
.sy-preview hr{border:0;border-top:.5px solid var(--dsw-alias-border-l2);margin:1.4em 0}
.sy-preview a{color:var(--dsw-alias-brand-primary);text-decoration:none}
.sy-preview a:hover{text-decoration:underline}
.sy-preview img{max-width:100%;height:auto;border-radius:6px;display:block;margin:6px 0}
/* --- 分段编辑区（路线 A）----------------------------------------------------
   编辑区不再是「整篇一个 textarea」，而是「文本段 textarea + 图片卡片」：图片所在的行
   变成卡片，于是图片在写作时就是可见的。滚动交给外层容器，每个文本段自己按内容长高。 */
.sy-segments{flex:1 1 50%;min-width:0;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base)}
.sy-seg-text{display:block;width:100%;resize:none;overflow:hidden;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,"JetBrains Mono",Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.7;padding:0 22px;tab-size:2}
.sy-segments > .sy-seg-text:first-child{padding-top:20px}
.sy-segments > .sy-seg-text:last-child{padding-bottom:20px}
/* 段内的空行也要看得见：文本段之间没有可见分隔，靠细分隔线提示"这里换段了"（图片卡片本来就有框）。 */
.sy-imgcard{margin:10px 22px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.sy-imgcard-head{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.sy-imgcard-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.sy-imgcard-line{flex:0 0 auto}
.sy-imgcard-label{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.sy-imgcard-shot{display:block;padding:10px;text-align:center}
.sy-imgcard-shot img,.sy-imgcard-img{max-width:100%;max-height:260px;height:auto;border-radius:6px;display:inline-block;cursor:zoom-in}
.sy-imgcard-shot[data-broken=true] img{display:none}
.sy-imgcard-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;border-top:.5px solid var(--dsw-alias-border-l1)}
.sy-imgcard-actions .sy-mem-btn{height:24px;font-size:11.5px}
.sy-imgcard-actions .sy-mem-btn[data-on=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.sy-imgcard-alt{flex:1 1 140px;min-width:90px;height:24px;padding:0 8px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;outline:none}
.sy-imgcard-alt:focus{border-color:var(--dsw-alias-brand-primary)}
.sy-imgcard-src{display:block;width:100%;min-height:52px;resize:vertical;border:0;border-top:.5px solid var(--dsw-alias-border-l1);outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;line-height:1.6;padding:8px 10px;tab-size:2}
.sy-imgcard-broken{display:none;padding:14px 10px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.sy-imgcard-shot[data-broken=true] .sy-imgcard-broken{display:block}
/* 破图态：预览渲染完由 JS 扫描到加载失败，给 img 加 data-broken，并在它后面插一条
   「图未找到」占位条。img 本身收起来，否则浏览器会自己画一遍破图 alt，出现两份文字。 */
.sy-preview img[data-broken]{display:none}
.sy-preview .sy-imgbroken{display:inline-flex;align-items:center;gap:4px;margin:6px 0;padding:1px 8px;border-radius:6px;border:.5px dashed var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px}
.sy-preview .sy-imgph{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:6px;border:.5px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px}
.sy-preview .sy-task{list-style:none;margin-left:-1.2em}
.sy-preview .sy-task input{margin-right:6px}
.sy-preview mark{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-radius:3px;padding:0 2px}
.sy-statusbar{display:flex;align-items:center;gap:10px;padding:5px 14px;border-top:.5px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.sy-notice{display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:12px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.sy-notice[data-tone=err]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.sy-notice[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
.sy-notice[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}
/* The transient note floats over the panel instead of taking a row in the column. A row
   that appears above the editor pushed every line down, then let it snap back when the
   note expired — during an auto-save that reads as the text jumping under the caret. */
.sy-toast{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);z-index:50;max-width:min(80%,420px);border:0;border-radius:8px;box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);pointer-events:none}
.sy-toast[data-tone]{background:var(--dsw-alias-bg-layer-1)}
/* "保存" -> "保存中…" is a wider label; inside the wrapping toolbar that extra width could
   move the last button onto a new row and shift the whole editor. The slot keeps its size,
   with headroom for a wider font or language (13px x 4 CJK + ellipsis still fits). */
.sy-btn-label{display:inline-block;min-width:5em;text-align:center}
.sy-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-secondary);padding:40px;text-align:center}
.sy-empty strong{color:var(--dsw-alias-label-primary);font-weight:600;font-size:14px}
.sy-connect{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:32px;overflow:auto}
.sy-card{width:100%;max-width:440px;display:flex;flex-direction:column;gap:12px;padding:22px;border-radius:14px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}
.sy-card h2{margin:0;font-size:15px;font-weight:600}
.sy-card p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.sy-field{display:flex;flex-direction:column;gap:5px}
.sy-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.sy-field input{height:32px;padding:0 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.sy-field input:focus{border-color:var(--dsw-alias-brand-primary)}
.sy-row{display:flex;align-items:center;gap:8px}
.sy-modal{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-label-primary) 38%,transparent)}
.sy-modal .sy-card{max-width:380px}
.sy-menu{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sy-check{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.sy-check input{margin:0}
/* --- 记忆面板 -------------------------------------------------------------
   一张可筛选的表格 + 每行可展开正文。刻意做成只读视图：改记忆的正式入口是思源
   本身（它就是编辑器），面板负责「看得见」和「撤得掉」。 */
.sy-mem{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
.sy-mem-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);min-width:0}
/* 标题让位给右侧按钮：面板窄的时候省略标题，而不是把按钮压成竖排。 */
.sy-mem-head h2{margin:0;font-size:14px;font-weight:600;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 文字按钮。不要用 .sy-iconbtn —— 那是 26px 固定宽的图标按钮，塞中文标签会一字一行。 */
.sy-mem-btn{flex:0 0 auto;height:26px;padding:0 10px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;border:.5px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:1;white-space:nowrap}
.sy-mem-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sy-mem-btn:disabled{opacity:.5;cursor:default}
.sy-mem-filters{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.sy-mem-chip{height:24px;padding:0 10px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.sy-mem-chip[data-on=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.sy-mem-input{height:24px;min-width:120px;flex:1 1 120px;padding:0 8px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;outline:none}
.sy-mem-list{flex:1 1 auto;overflow:auto}
.sy-mem-row{display:block;width:100%;text-align:left;border:0;border-bottom:.5px solid var(--dsw-alias-border-l1);background:transparent;padding:8px 12px;cursor:pointer;color:var(--dsw-alias-label-primary);font:inherit}
.sy-mem-row:hover{background:var(--dsw-alias-bg-layer-1)}
.sy-mem-row[data-open=true]{background:var(--dsw-alias-bg-layer-1)}
.sy-mem-title{font-size:13px;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sy-mem-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sy-mem-body{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-base);font-size:12px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
.sy-mem-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.sy-mem-note{padding:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.sy-mem-note[data-tone=err]{color:var(--dsw-alias-state-error-primary)}
.sy-mem-review-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:12px 0;white-space:normal}
.sy-mem-review-fields label{display:flex;flex-direction:column;gap:6px}
.sy-mem-review-fields label:first-child{flex-direction:row;align-items:center}
.sy-mem-review-fields input:not([type=checkbox]),.sy-mem-review-fields select{width:100%;box-sizing:border-box;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:inherit}
`;

		function installStyles(ctx) {
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-siyuan-notes";
				tag.dataset.pluginCss = "dsh-siyuan-notes/client.css";
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "siyuan-notes: styles");
		}
		// #endregion

		// #region host bridge
		function unwrapError(json, res) {
			if (json && typeof json === "object") {
				if (json.ok === false && json.error) {
					return { code: String(json.error.code ?? "transport"), message: String(json.error.message ?? "request failed") };
				}
				if (typeof json.code === "number" && json.code !== 0) {
					return { code: String(json.code), message: String(json.msg || "SiYuan returned an error") };
				}
			}
			if (!res.ok) return { code: "http-" + res.status, message: "HTTP " + res.status };
			return null;
		}

		async function callHost(path, body, method) {
			const res = await fetch(HOST_BRIDGE + path, {
				method: method || (body === undefined ? "GET" : "POST"),
				headers: body === undefined ? undefined : { "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				credentials: "same-origin",
			});
			const text = await res.text();
			let json = null;
			try {
				json = text ? JSON.parse(text) : null;
			} catch {
				throw new Error("插件宿主未就绪：/siyuan 路由没有响应（请在插件设置里重新启用 dsh-siyuan-notes，或重启应用后刷新页面）");
			}
			if (json && typeof json === "object" && json.ok === true && "value" in json) return json.value;
			if (json && typeof json === "object" && json.ok === false) {
				const err = json.error ?? {};
				throw new Error(String(err.message ?? err.code ?? "host error"));
			}
			if (!res.ok) throw new Error("HTTP " + res.status);
			return json;
		}

		const bridge = {
			state: () => callHost("/state"),
			saveConfig: (baseUrl, token) => callHost("/config", { baseUrl, token }),
			backup: (docId, title, kramdown) => callHost("/backup", { docId, title, kramdown }),
			/** The editor layout the user last left behind, or null when nothing is remembered. */
			loadLayout: () => callHost("/layout"),
			/** Remember the editor layout so the next visit opens the same documents. */
			saveLayout: (layout) => callHost("/layout", layout),
			/** 资源相对路径 -> 预览图片 URL（走宿主代理，token 只留在宿主）。 */
			assetUrl: (relPath) => assetPreviewUrl(relPath),
			/**
			 * 上传一张图片到思源资源库，返回内核给出的相对路径（如 `assets/x-20261108….png`）。
			 *
			 * 刻意不走 `callHost`：那个封装固定 JSON 请求体，而这里是 multipart 字节流，
			 * Content-Type 必须由浏览器自己带 boundary。字段名与思源一致：
			 * `assetsDirPath="/assets/"` + `file[]`（本期只写根资源目录，与用户库现状一致）。
			 * 宿主把这段 multipart 原样转发给内核，并把内核信封包成 `{ok, value:{code,msg,data}}`。
			 */
			async uploadAsset(file) {
				const form = new FormData();
				form.append("assetsDirPath", "/assets/");
				form.append("file[]", file, file.name);
				const res = await fetch(HOST_BRIDGE + "/asset/upload", {
					method: "POST",
					body: form,
					credentials: "same-origin",
				});
				const text = await res.text();
				let json = null;
				try {
					json = text ? JSON.parse(text) : null;
				} catch {
					throw new Error("上传接口没有返回 JSON（宿主路由可能还没就绪，重启 DSH 后再试）");
				}
				if (json && typeof json === "object" && json.ok === false) {
					const err = json.error ?? {};
					throw new Error(String(err.message ?? err.code ?? "host error"));
				}
				if (!res.ok) throw new Error("HTTP " + res.status);
				const envelope = json && typeof json === "object" && "value" in json ? json.value : json;
				// 内核自己的错误信封（code != 0）在这里变成异常，和 /siyuan/api 一致。
				const upstream = unwrapError(envelope, { ok: true, status: 200 });
				if (upstream) {
					const failure = new Error(upstream.message);
					failure.code = upstream.code;
					throw failure;
				}
				const data = (envelope && envelope.data) || {};
				const succMap = data.succMap && typeof data.succMap === "object" ? data.succMap : {};
				const files = Array.isArray(data.succFiles) ? data.succFiles : [];
				// 优先按原名查映射表，退化到 succFiles[0].path（内核两种都会给）。
				const relPath = succMap[file.name] || (files[0] && files[0].path);
				if (!relPath) throw new Error("内核没有返回资源路径（上传结果里既没有 succMap 也没有 succFiles）");
				return String(relPath);
			},
			async api(path, payload) {
				const json = await callHost("/api", { path, payload: payload ?? {} });
				const error = unwrapError(json, { ok: true, status: 200 });
				if (error) {
					const failure = new Error(error.message);
					failure.code = error.code;
					throw failure;
				}
				return json.data;
			},
		};
		// #endregion

		// #region kramdown model
		const INDENT = "\u3000\u3000";
		const IAL_LINE = /^\{:\s*id="([^"]+)"([^}]*)\}$/;
		const INLINE_IAL = /\{:\s*id="[^"]*"[^}]*\}/g;

		/** Trim surrounding whitespace without touching a leading U+3000 indent. */
		function trimEdges(text) {
			return String(text ?? "")
				.replace(/^[ \t\r\n\f\v\u00A0\uFEFF]+/, "")
				.replace(/[ \t\r\n\f\v\u00A0\uFEFF]+$/, "");
		}

		/** Drop characters SiYuan adds or rewrites on read-back, so a diff stays about real edits. */
		function normalizeText(text) {
			return String(text ?? "")
				.replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
				.replace(/\u00A0/g, " ")
				.replace(/\[X\]/g, "[x]")
				.replace(/[ \t]+$/gm, "")
				.replace(/^[ \t\r\n\f\v]+/, "")
				.replace(/[ \t\r\n\f\v]+$/, "");
		}

		/** Strip SiYuan's block-attribute noise and the serializer's one-indent prefix from one block's markdown. */
		function cleanBlockText(raw) {
			if (!raw) return "";
			const lines = String(raw).split("\n");
			const kept = [];
			for (const line of lines) {
				if (/^\s*\{:\s*id=/.test(line)) continue; // inline child IAL line
				kept.push(line.replace(INLINE_IAL, "").replace(/\s+$/, ""));
			}
			let text = trimEdges(kept.join("\n"));
			// SiYuan's document serializer prefixes every paragraph EXCEPT the first with one
			// indent that is not part of the stored text: remove exactly that one and keep any
			// real indent. Verified byte-wise against the real kernel: the second paragraph
			// arrives as four ideographic spaces (prefix + real indent) while the first arrives
			// with none at all.
			//
			// Do not "fix" the first paragraph here. The kernel omits its lead entirely, so
			// there is nothing to strip; skipping the strip would leave the first paragraph
			// unchanged and corrupt every later one. The first block's lead is restored on
			// read instead — see `restoreFirstLead`.
			if (text.startsWith(INDENT)) text = text.slice(INDENT.length);
			return normalizeText(text.replace(/^[ \t]+/, ""));
		}

		/**
		 * Split a document kramdown into its top-level blocks.
		 * An IAL line at column 0 closes the block it follows; the trailing
		 * `type="doc"` IAL belongs to the document itself and is dropped.
		 */
		function splitKramdown(kramdown) {
			const out = [];
			if (!kramdown) return out;
			const lines = String(kramdown).split("\n");
			let buffer = [];
			const flush = (id) => {
				const raw = buffer.join("\n");
				buffer = [];
				if (!raw.trim()) return;
				out.push({ id, text: cleanBlockText(raw) });
			};
			for (const line of lines) {
				const m = IAL_LINE.exec(line);
				if (m) {
					if (/type="doc"/.test(m[2])) {
						buffer = [];
						continue;
					}
					flush(m[1]);
					continue;
				}
				buffer.push(line);
			}
			if (buffer.join("").trim()) flush(null);
			return out;
		}

		/** Split edited markdown into top-level blocks the same way SiYuan would. */
		function splitMarkdown(markdown) {
			const out = [];
			const lines = String(markdown ?? "").split("\n");
			let buffer = [];
			let fence = null;
			const flush = () => {
				const text = normalizeText(buffer.join("\n").replace(/^[ \t]+/, ""));
				buffer = [];
				if (text.trim()) out.push(text);
			};
			for (const line of lines) {
				const fenceMatch = /^\s*(```+|~~~+)\s*([\w+#-]*)\s*$/.exec(line);
				if (fence !== null) {
					buffer.push(line);
					if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
					continue;
				}
				if (fenceMatch) {
					flush();
					fence = fenceMatch[1];
					buffer.push(line);
					continue;
				}
				if (!line.trim()) {
					flush();
					continue;
				}
				if (/^#{1,6}\s/.test(line)) {
					// A heading is a single-line block in SiYuan: close what came before it.
					flush();
					buffer.push(line);
					flush();
					continue;
				}
				buffer.push(line);
			}
			flush();
			return out;
		}

		/**
		 * Turn the session store snapshot into history rows, newest first.
		 *
		 * Pure and defensive: `byId` entries are optional and partially populated, and
		 * an id can briefly appear before its summary does.
		 *
		 * @param ids session ids in store order.
		 * @param byId session summaries by id.
		 * @param currentId the session the chat is showing.
		 * @param t translator.
		 * @param limit how many rows to render.
		 * @returns array of { id, label, current, running }
		 */
		function sessionHistoryItems(ids, byId, currentId, t, limit) {
			const list = Array.isArray(ids) ? ids : [];
			const index = byId && typeof byId === "object" ? byId : {};
			const rows = [];
			for (const id of list) {
				if (typeof id !== "string") continue;
				// Subagent conversations are reachable from their parent, not a good
				// destination for a loose "switch conversation" menu.
				const summary = index[id];
				if (summary && summary.parentId !== undefined) continue;
				const label = (summary && (summary.displayTitle || summary.title)) || String(id).slice(0, 8);
				rows.push({
					id,
					label: String(label).replace(/\s+/g, " ").trim() || String(id).slice(0, 8),
					current: id === currentId,
					running: Boolean(summary && summary.running),
				});
				if (rows.length >= (limit || 30)) break;
			}
			return rows;
		}

		/**
		 * Where to float the selection action bar.
		 *
		 * Pointer selections float above the pointer; keyboard selections have no
		 * coordinates, so the bar parks over the pane being read instead. Everything is
		 * clamped so a selection near an edge cannot push the bar off screen.
		 *
		 * @param point the pointer position, or null for a keyboard selection.
		 * @param viewWidth the viewport width.
		 * @param anchorRect the bounding rect to fall back to.
		 * @returns {{ left: string, top: string }}
		 */
		function selectionBarPosition(point, viewWidth, anchorRect) {
			const width = 210;
			const height = 34;
			if (point === null || point === undefined || viewWidth === 0) {
				if (anchorRect === null || anchorRect === undefined) return { left: "12px", top: "12px" };
				return {
					left: Math.max(8, anchorRect.right - width - 12) + "px",
					top: Math.max(8, anchorRect.top + 8) + "px",
				};
			}
			return {
				left: Math.max(8, Math.min(point.x - width / 2, Math.max(8, viewWidth - width - 8))) + "px",
				top: Math.max(8, point.y - height - 10) + "px",
			};
		}

		/**
		 * Find the source line a quoted passage came from. Rendering drops markup
		 * (bold markers, list bullets, indentation), so an exact match rarely exists;
		 * the first non-trivial line of the quote is matched instead.
		 *
		 * @param text the document's markdown.
		 * @param quote the text the reader selected.
		 * @returns 1-based line number, or 1 when nothing matches.
		 */
		function locateQuote(text, quote) {
			const lines = String(text ?? "").split("\n").map((line) => line.replace(/[\s\u3000]+/g, ""));
			const probes = String(quote ?? "")
				.split("\n")
				.map((line) => line.replace(/[\s\u3000]+/g, ""))
				.filter((line) => line.length >= 4)
				.map((line) => line.slice(0, 12));
			for (const probe of probes) {
				for (let index = 0; index < lines.length; index++) {
					if (lines[index].includes(probe)) return index + 1;
				}
			}
			return 1;
		}

		/** One first-line indent, as Chinese prose uses it. */
		const FIRST_INDENT = "\u3000\u3000";

		/** True for a line that begins a normal paragraph rather than a structural line. */
		function isParagraphLine(line) {
			if (!line.trim()) return false;
			return !/^\s*([-*+]\s|\d+[.)]\s|>|#{1,6}\s|\||```|~~~)/.test(line);
		}

		/** Walk lines, reporting whether each one starts inside a fenced code block. */
		function fenceState(lines) {
			const states = [];
			let fence = null;
			for (const line of lines) {
				const open = /^\s*(```+|~~~+)/.exec(line);
				if (fence === null) {
					states.push(false);
					if (open) fence = open[1][0];
					continue;
				}
				states.push(true);
				if (open && open[1][0] === fence) fence = null;
			}
			return states;
		}

		/** Add one first-line indent to every paragraph that lacks it. Idempotent. */
		function indentParagraphs(text) {
			const lines = String(text ?? "").split("\n");
			const inFence = fenceState(lines);
			let changed = false;
			for (let i = 0; i < lines.length; i++) {
				if (inFence[i]) continue;
				const line = lines[i];
				if (!isParagraphLine(line)) continue;
				if (line.startsWith(FIRST_INDENT)) continue;
				// Only the first line of a paragraph: a previous non-blank line means continuation.
				if (i > 0 && lines[i - 1].trim() !== "") continue;
				lines[i] = FIRST_INDENT + line;
				changed = true;
			}
			return changed ? lines.join("\n") : String(text ?? "");
		}

		/**
		 * Paragraph lines that still lack the first-line indent.
		 *
		 * Mirrors `indentParagraphs` exactly: same structural skip, same "first line of
		 * the paragraph" rule, same fenced-code skip. Callers use the count to decide
		 * what the indent button should do; a drift between the two is caught by test.
		 */
		function bareParagraphLines(text) {
			const lines = String(text ?? "").split("\n");
			const inFence = fenceState(lines);
			const bare = [];
			for (let i = 0; i < lines.length; i++) {
				if (inFence[i]) continue;
				const line = lines[i];
				if (!isParagraphLine(line)) continue;
				if (i > 0 && lines[i - 1].trim() !== "") continue;
				if (line.startsWith(FIRST_INDENT)) continue;
				bare.push(i);
			}
			return bare;
		}

		/** Remove one first-line indent from every paragraph that has it. Idempotent. */
		function unindentParagraphs(text) {
			const lines = String(text ?? "").split("\n");
			const inFence = fenceState(lines);
			let changed = false;
			for (let i = 0; i < lines.length; i++) {
				if (inFence[i]) continue;
				const line = lines[i];
				if (!line.startsWith(FIRST_INDENT)) continue;
				const rest = line.slice(FIRST_INDENT.length);
				if (!isParagraphLine(rest)) continue;
				lines[i] = rest;
				changed = true;
			}
			return changed ? lines.join("\n") : String(text ?? "");
		}

		/**
		 * The first-line indent a paragraph needs once it has been typed into.
		 *
		 * The switch promises that a *new* paragraph starts indented, and Enter keeps that
		 * promise by writing the indent itself. The paragraph a writer begins in an empty
		 * document never passes through Enter, so it stayed flush left while every later
		 * paragraph was indented — the switch looked like it only worked from the second
		 * paragraph on.
		 *
		 * It fires only for a line that was blank before this edit, so typing inside a
		 * paragraph that already exists, or deliberately starting one with spaces, is left
		 * alone.
		 *
		 * @param {string} before the buffer before the edit.
		 * @param {string} after the buffer after the edit.
		 * @param {number} caret the caret offset in `after`.
		 * @param {{ indent?: boolean }} [options] whether the switch is on.
		 * @returns {{ text: string, at: number, caret: number } | null} the buffer with the indent, where it goes, and the caret after it.
		 */
		function autoIndentParagraph(before, after, caret, options) {
			const opts = options || {};
			const text = String(after ?? "");
			const previous = String(before ?? "");
			if (!opts.indent) return null;
			if (text === previous) return null;
			if (!Number.isFinite(caret) || caret < 0 || caret > text.length) return null;
			const lines = text.split("\n");
			const at = text.lastIndexOf("\n", caret - 1) + 1;
			const index = text.slice(0, at).split("\n").length - 1;
			const line = lines[index];
			if (line === undefined || !line.trim()) return null;
			// Spaces the writer typed on purpose are a decision, not a paragraph start.
			if (/^\s/.test(line)) return null;
			if (!isParagraphLine(line)) return null;
			// Only the line that begins a block: a previous non-blank line is a continuation
			// (Shift-free Enter with the switch off is a soft break, not a new paragraph). A
			// heading is a one-line block, so the line after it does begin one, and so does the
			// line after a closing fence.
			if (index > 0 && lines[index - 1].trim() !== "" && !/^#{1,6}\s/.test(lines[index - 1])) {
				const fences = fenceState(lines);
				if (!(fences[index - 1] && !fences[index])) return null;
			}
			if (fenceState(lines)[index]) return null;
			// The line has to be new. `at` is the same offset in both buffers for an insertion,
			// so `previous[at]` is the character that used to start this line: any real
			// character there means the line already had text and this edit merely added to it.
			// Measure by offset, not by line number — deleting a newline above shifts every
			// line number and would misjudge which line the caret landed on.
			const startsNewLine = at >= previous.length || previous[at] === "\n";
			if (!startsNewLine) return null;
			return { text: text.slice(0, at) + FIRST_INDENT + text.slice(at), at, caret: caret + FIRST_INDENT.length };
		}

		/**
		 * The same decision, gated by the things only the browser event knows.
		 *
		 * Kept beside the rule so the guards are testable too: a composing input method owns
		 * the buffer (editing under it would fight the candidate window), a programmatic write
		 * that is still running must not be answered with another write, and a paste or an undo
		 * is not a person starting a paragraph.
		 *
		 * @param {string} before the buffer before the edit.
		 * @param {string} after the buffer after the edit.
		 * @param {number} caret the caret offset in `after`.
		 * @param {{ indent?: boolean, kind?: string, composing?: boolean }} [options]
		 * @returns {{ text: string, at: number, caret: number } | null}
		 */
		function typingIndentPlan(before, after, caret, options) {
			const opts = options || {};
			if (opts.composing) return null;
			if (!isTypingInput(opts.kind)) return null;
			return autoIndentParagraph(before, after, caret, { indent: opts.indent });
		}

		/**
		 * Where the caret goes after a whole-document indent rewrite.
		 *
		 * `indentParagraphs` / `unindentParagraphs` only insert or remove one indent at a line
		 * start, so the caret's own line keeps its column (plus or minus that indent) and the
		 * lines before it only move by the indents they gained or lost. Without this mapping the
		 * caret fell back to offset 0, which the browser scrolls into view — clicking the switch
		 * or 「补齐全篇」 threw the writer back to the top of the document.
		 *
		 * @param {string} before the buffer before the rewrite.
		 * @param {string} after the buffer after the rewrite.
		 * @param {number} caret the caret offset in `before`.
		 * @returns {number} the same place, as an offset in `after`.
		 */
		function caretAfterIndent(before, after, caret) {
			const rows = String(before ?? "").split("\n");
			const next = String(after ?? "").split("\n");
			const at = Math.max(0, Math.min(Number.isFinite(caret) ? caret : 0, String(before ?? "").length));
			// The rewrite never adds or removes a line; anything else is not this rewrite.
			if (next.length !== rows.length) return Math.max(0, Math.min(String(after ?? "").length, at));
			const offsetOf = (list, index) => {
				let offset = 0;
				for (let i = 0; i < index; i++) offset += list[i].length + 1;
				return offset;
			};
			const line = String(before ?? "").slice(0, at).split("\n").length - 1;
			const column = Math.max(0, at - offsetOf(rows, line));
			const width = next[line].length;
			// The caret's line is indented (+2), unindented (−2) or untouched, so adding the
			// line's own change and clamping keeps the caret next to the same characters.
			return offsetOf(next, line) + Math.max(0, Math.min(width, column + (width - rows[line].length)));
		}

		/** Compare-shape of one block: its cleaned text. */
		// #region editor ux
		// The editor is a textarea over kramdown, so "editing like SiYuan" means a set of
		// decisions about the caret: what Enter continues, what Tab indents, which keys
		// wrap the selection. Those decisions live here as pure functions — the component
		// below only turns their answers into DOM operations, and the tests below that
		// exercise them without a browser.
		// See notes/siyuan-editor-facts.md for the SiYuan source each rule mirrors.

		/** One nesting level for Tab / Shift+Tab. Two spaces is what kramdown nests with. */
		const INDENT_UNIT = "  ";

		const TASK_RE = /^(\s*)([-*+])\s+\[[ xX]\]\s*(.*)$/;
		const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
		const ORDERED_RE = /^(\s*)(\d+)([.)])\s+(.*)$/;
		const QUOTE_RE = /^(\s*)((?:>\s*)+)(.*)$/;
		const HEADING_RE = /^#{1,6}\s/;

		/**
		 * What Enter should do on this line.
		 *
		 * Mirrors SiYuan's `wysiwyg/enter.ts`: a list or quote continues with the same
		 * marker (ordered lists tick the number), an *empty* item ends the block instead
		 * of continuing it, a heading drops back to a paragraph, and a plain paragraph
		 * starts the next indented paragraph when writing mode is on.
		 */
		function continueOnEnter(line, options) {
			const opts = options || {};
			const none = { kind: "none", prefix: "", exit: false, spaced: false };
			if (opts.inFence) return none;
			const text = String(line ?? "");
			if (!text.trim()) return none;

			const task = TASK_RE.exec(text);
			if (task) {
				if (!task[3].trim()) return { kind: "task", prefix: "", exit: true, spaced: false };
				return { kind: "task", prefix: task[1] + task[2] + " [ ] ", exit: false, spaced: false };
			}
			const ordered = ORDERED_RE.exec(text);
			if (ordered) {
				if (!ordered[4].trim()) return { kind: "ordered", prefix: "", exit: true, spaced: false };
				return { kind: "ordered", prefix: ordered[1] + (Number(ordered[2]) + 1) + ordered[3] + " ", exit: false, spaced: false };
			}
			const bullet = BULLET_RE.exec(text);
			if (bullet) {
				if (!bullet[3].trim()) return { kind: "list", prefix: "", exit: true, spaced: false };
				return { kind: "list", prefix: bullet[1] + bullet[2] + " ", exit: false, spaced: false };
			}
			const quote = QUOTE_RE.exec(text);
			if (quote) {
				if (!quote[3].trim()) return { kind: "quote", prefix: "", exit: true, spaced: false };
				// The inner line never gets a first-line indent: `indentParagraphs` skips
				// structural lines, so indenting here would write stray U+3000 into the text.
				const inner = continueOnEnter(quote[3], { indent: false, inFence: false });
				return { kind: "quote", prefix: quote[1] + quote[2] + (inner.exit ? "" : inner.prefix), exit: false, spaced: false };
			}
			if (HEADING_RE.test(text)) return { kind: "heading", prefix: "", exit: false, spaced: false };
			if (isParagraphLine(text)) {
				return { kind: "paragraph", prefix: opts.indent ? FIRST_INDENT : "", exit: false, spaced: Boolean(opts.indent) };
			}
			return none;
		}

		/** Drop an empty list / quote marker so Enter ends the block instead of continuing it. */
		function stripBlockMark(line) {
			const text = String(line ?? "");
			const quote = QUOTE_RE.exec(text);
			if (quote && !quote[3].trim()) return quote[1];
			for (const pattern of [TASK_RE, ORDERED_RE, BULLET_RE]) {
				const match = pattern.exec(text);
				if (match && !match[match.length - 1].trim()) return match[1];
			}
			return text;
		}

		/**
		 * Tab / Shift+Tab over the lines a selection touches. Returns a new array; the
		 * caller's array is never touched.
		 *
		 * Whitespace-only lines stay as they are: padding a blank line would leave
		 * trailing spaces in the document, and the kernel round-trips those back.
		 * `delta` outside {-1, +1} is a no-op rather than a silent outdent.
		 */
		function changeIndent(rows, from, to, delta) {
			const list = Array.isArray(rows) ? rows : [];
			if (list.length === 0) return { rows: list.slice(), from, to };
			const start = Math.max(0, Math.min(from, to));
			const end = Math.min(list.length - 1, Math.max(from, to));
			const out = list.slice();
			for (let index = start; index <= end; index++) {
				const row = String(out[index] ?? "");
				if (!row.trim()) continue;
				if (delta > 0) out[index] = INDENT_UNIT + row;
				else if (delta < 0 && row.startsWith(INDENT_UNIT)) out[index] = row.slice(INDENT_UNIT.length);
				else if (delta < 0 && row.startsWith("\t")) out[index] = row.slice(1);
			}
			return { rows: out, from, to };
		}

		/**
		 * The keyboard map. Keys are `mod+[shift+]<key>` with mod = Ctrl or Cmd, so the
		 * same table serves Windows, Linux and macOS; `alt+<key>` covers the bindings
		 * SiYuan puts on Alt.
		 *
		 * The primary column is SiYuan's own default keymap (app/src/constants.ts
		 * SIYUAN_KEYMAP, see notes/siyuan-editor-facts.md), so muscle memory carries over:
		 *   Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · Ctrl+Shift+S strike
		 *   Ctrl+G inline code · Alt+D highlight · Ctrl+K link
		 * Ctrl+Shift+C / Ctrl+Shift+H are kept as aliases, and Ctrl+S is ours — SiYuan
		 * has no save shortcut because the kernel persists on its own, but this panel
		 * writes through an explicit save.
		 */
		const HOTKEYS = {
			"mod+b": "bold",
			"mod+i": "italic",
			"mod+u": "underline",
			"mod+shift+s": "strike",
			"mod+g": "code",
			"mod+shift+c": "code",
			"alt+d": "highlight",
			"mod+shift+h": "highlight",
			"mod+k": "link",
			"mod+s": "save",
			"mod+e": "toggleView",
			"mod+f": "find",
		};

		/** Inline formats a hotkey or the selection bar can toggle. */
		const INLINE_FORMATS = {
			bold: ["**", "**"],
			italic: ["*", "*"],
			underline: ["<u>", "</u>"],
			strike: ["~~", "~~"],
			code: ["`", "`"],
			highlight: ["==", "=="],
			link: ["[", "](https://)"],
		};

		/** Resolve a keyboard event to an editor action id, or null when nothing matches. */
		function hotkeyOf(event) {
			const e = event || {};
			const key = typeof e.key === "string" ? e.key : "";
			const lower = key.toLowerCase();
			const mod = Boolean(e.ctrlKey || e.metaKey);
			if (!mod) {
				// KeyboardEvent.key is "Tab" in every browser, but a synthetic event may not be.
				if (lower === "tab") {
					if (e.altKey) return null;
					return e.shiftKey ? "outdent" : "indent";
				}
				if (e.altKey && !e.shiftKey) {
					// On macOS Option turns `key` into a dead character (Option+D → "∂"),
					// so the physical code is the reliable half of an Alt binding there.
					const byCode = typeof e.code === "string" && /^Key[A-Z]$/.test(e.code) ? HOTKEYS["alt+" + e.code.slice(3).toLowerCase()] : null;
					return byCode ?? HOTKEYS["alt+" + lower] ?? null;
				}
				return null;
			}
			// No Ctrl/Cmd+Alt bindings; AltGr on a European layout arrives as Ctrl+Alt.
			if (e.altKey) return null;
			if (key.length !== 1) return null;
			return HOTKEYS["mod+" + (e.shiftKey ? "shift+" : "") + lower] ?? null;
		}

		/**
		 * Wrap or unwrap a selection. Pressing the same button twice has to remove the
		 * marks again, which is what makes the selection bar feel like a toggle.
		 */
		function wrapSelection(value, start, end, before, after, placeholder) {
			const text = String(value ?? "");
			const from = Math.max(0, Math.min(start, end));
			const to = Math.min(text.length, Math.max(start, end));
			const openMark = before || "";
			const closeMark = after || "";
			const inner = text.slice(from, to);
			// Two ways a selection can already be marked up: it *includes* the marks
			// (select `**粗**` and press B) or sits *between* them (select `粗`).
			// Both have to unwrap, or the button can only ever add marks.
			if (openMark.length > 0 && closeMark.length > 0 && inner.length >= openMark.length + closeMark.length && inner.startsWith(openMark) && inner.endsWith(closeMark)) {
				const body = inner.slice(openMark.length, inner.length - closeMark.length);
				const head = text.slice(0, from);
				return { text: head + body + text.slice(to), start: head.length, end: head.length + body.length };
			}
			const wrappedOutside =
				inner.length > 0 &&
				openMark.length > 0 &&
				from >= openMark.length &&
				text.slice(from - openMark.length, from) === openMark &&
				closeMark.length > 0 &&
				text.slice(to, to + closeMark.length) === closeMark;
			if (wrappedOutside) {
				const head = text.slice(0, from - openMark.length);
				return { text: head + inner + text.slice(to + closeMark.length), start: head.length, end: head.length + inner.length };
			}
			if (inner.length === 0) {
				const filler = placeholder || "";
				const head = text.slice(0, from) + openMark;
				return { text: head + filler + closeMark + text.slice(to), start: head.length, end: head.length + filler.length };
			}
			const head = text.slice(0, from) + openMark;
			return { text: head + inner + closeMark + text.slice(to), start: head.length, end: head.length + inner.length };
		}

		/** Characters that close themselves, including the full-width pairs used in Chinese. */
		const AUTO_PAIRS = {
			"(": ")",
			"（": "）",
			"[": "]",
			"【": "】",
			"《": "》",
			"\u201c": "\u201d",
			'"': '"',
			"'": "'",
			"`": "`",
			"*": "*",
			"_": "_",
			"~": "~",
		};

		/**
		 * Auto-close the pair for a typed character.
		 *
		 * With a selection, the selection is wrapped instead of replaced — that is the
		 * behaviour that keeps `选中一段再敲括号` from throwing the text away.
		 */
		function autoPairAction(value, start, end, typed) {
			const closer = AUTO_PAIRS[typed];
			if (!closer) return null;
			const text = String(value ?? "");
			const from = Math.max(0, Math.min(start, end));
			const to = Math.min(text.length, Math.max(start, end));
			const inner = text.slice(from, to);
			if (inner.length > 0) {
				const head = text.slice(0, from) + typed;
				return { text: head + inner + closer + text.slice(to), start: head.length, end: head.length + inner.length };
			}
			// The pair (or at least its closer) is already at the caret: step over it
			// rather than inserting a second one.
			if (text.startsWith(typed + closer, from) || text.charAt(from) === closer) {
				return { text, start: from + 1, end: from + 1 };
			}
			const head = text.slice(0, from) + typed;
			return { text: head + closer + text.slice(to), start: head.length, end: head.length };
		}

		/** One contiguous change between two strings, as a replacement range. */
		function diffRange(before, after) {
			const from = String(before ?? "");
			const to = String(after ?? "");
			const max = Math.min(from.length, to.length);
			let head = 0;
			while (head < max && from[head] === to[head]) head++;
			let tail = 0;
			const limit = Math.min(from.length - head, to.length - head);
			while (tail < limit && from[from.length - 1 - tail] === to[to.length - 1 - tail]) tail++;
			return { start: head, end: from.length - tail, insert: to.slice(head, to.length - tail) };
		}

		/**
		 * Raised while the panel itself rewrites the buffer (toolbar actions, indent, paste-back
		 * from a preview). Those writes go through `execCommand("insertText")`, which fires a
		 * `beforeinput` indistinguishable from typing, so the meter needs to be told.
		 */
		let suppressTypingCount = false;

		/**
		 * Run a programmatic edit without it counting towards the typing rate.
		 * @param {() => any} run the edit.
		 * @returns {any} whatever `run` returns.
		 */
		function withoutTypingCount(run) {
			const previous = suppressTypingCount;
			suppressTypingCount = true;
			try {
				return run();
			} finally {
				suppressTypingCount = previous;
			}
		}

		/**
		 * Replace a range in a textarea.
		 *
		 * `execCommand("insertText")` performs the replacement as a real user edit, so
		 * the browser's own undo stack survives — assigning `.value` (what re-rendering
		 * a controlled textarea does) wipes it. But the command is also the least
		 * trustworthy part of this file: it is deprecated, it is unavailable in some
		 * embeddings, and it can report success without touching the DOM. A silent no-op
		 * is indistinguishable from "the button does nothing", so the DOM is the source
		 * of truth and the assignment is the guarantee. `applied` only says the edit
		 * went in through the browser, i.e. that undo still covers it.
		 *
		 * Returns `text: null` when there is no textarea; callers must not write that back.
		 */
		function replaceRange(textarea, start, end, insert, selStart, selEnd) {
			const text = String(insert ?? "");
			const caret = selStart === undefined ? start + text.length : selStart;
			const caretEnd = selEnd === undefined ? caret : selEnd;
			if (!textarea) return { text: null, applied: false };
			const before = textarea.value;
			const wanted = before.slice(0, start) + text + before.slice(end);
			textarea.focus();
			textarea.setSelectionRange(start, end);
			try {
				if (typeof document !== "undefined" && document !== null && typeof document.execCommand === "function") {
					withoutTypingCount(() => document.execCommand("insertText", false, text));
				}
			} catch {
				/* fall through to the assignment below */
			}
			const byCommand = textarea.value === wanted && wanted !== before;
			if (textarea.value !== wanted) withoutTypingCount(() => { textarea.value = wanted; });
			textarea.setSelectionRange(caret, caretEnd);
			return { text: wanted, applied: byCommand };
		}

		/**
		 * Apply the paragraph indent to a live textarea, as one real user edit.
		 *
		 * Returns how many characters were inserted (0 when the rule does not apply), so the
		 * typing meter can leave them out of the rate: the writer did not type the indent.
		 *
		 * @param {{ value: string, selectionStart: number, selectionEnd: number }} textarea the live editor.
		 * @param {string} beforeText the buffer as it was before the edit.
		 * @param {{ indent?: boolean, kind?: string, composing?: boolean, busy?: boolean }} [options]
		 * @returns {number} characters inserted.
		 */
		function autoIndentTextarea(textarea, beforeText, options) {
			if (!textarea) return 0;
			// A selection is not a paragraph start: leave the wrap/replace to the browser.
			if (textarea.selectionStart !== textarea.selectionEnd) return 0;
			const plan = typingIndentPlan(beforeText, textarea.value, textarea.selectionStart, options);
			if (!plan) return 0;
			replaceRange(textarea, plan.at, plan.at, FIRST_INDENT, plan.caret, plan.caret);
			return FIRST_INDENT.length;
		}

		/** Scroll position that keeps the target pane aligned with the source pane. */
		function scrollSyncTop(sourceTop, sourceScrollHeight, sourceClientHeight, targetScrollHeight, targetClientHeight) {
			const span = Math.max(1, Number(sourceScrollHeight) - Number(sourceClientHeight));
			const ratio = Math.min(1, Math.max(0, Number(sourceTop) / span));
			return ratio * Math.max(0, Number(targetScrollHeight) - Number(targetClientHeight));
		}

		/**
		 * Status-bar numbers: `chars` ignores whitespace, `chinese` counts CJK ideographs.
		 *
		 * Counted in UTF-16 code units, the way the DOM counts a string: an emoji is 2
		 * and CJK extension B is outside the ranges below. Prose — what this panel is
		 * for — is unaffected, and the alternative would be a grapheme segmenter.
		 */
		function countText(markdown) {
			const text = String(markdown ?? "");
			return {
				chars: text.replace(/\s+/g, "").length,
				chinese: (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length,
				words: (text.match(/[A-Za-z0-9]+/g) || []).length,
			};
		}

		/**
		 * Input types that count as typing.
		 *
		 * The editor also receives programmatic edits — indent, bold, the bulk-indent button, a
		 * restored document's text — and every one of them fires the same change event as a
		 * keystroke. Counting those would report hundreds of characters per minute for a single
		 * button click, so only the input types a person produces are accepted. Paste and drop
		 * are excluded on purpose: they are not typing speed.
		 *
		 * @param {string | undefined} inputType the inputType of a beforeinput event.
		 * @returns {boolean} true when the edit is a real keystroke (or IME composition).
		 */
		function isTypingInput(inputType) {
			if (typeof inputType !== "string" || inputType === "") return false;
			// Plain insertion, and the IME commit paths. Committing a Chinese candidate REPLACES
			// the composing text and reports `insertReplacementText`, so treating it as "not
			// typing" leaves the rate at 0 for every Chinese keystroke.
			if (inputType === "insertText" || inputType === "insertCompositionText") return true;
			if (inputType === "insertReplacementText" || inputType === "insertFromComposition") return true;
			// Enter, and the two deletion keys a person uses while writing.
			if (inputType === "insertLineBreak" || inputType === "insertParagraph") return true;
			if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") return true;
			// Paste, drop, cut, undo/redo, drag: content that was not typed.
			return false;
		}

		/** Plausible upper bound for the reported rate, in characters per minute. */
		const TYPING_RATE_CEILING = 1200;

		/**
		 * A rolling one-minute typing-rate meter over NET new characters.
		 *
		 * The number answers how fast text is being produced right now. Deletions count against
		 * it, so rewriting a sentence does not inflate the figure, and a pause decays it because
		 * old samples fall out of the window.
		 *
		 * @param {{ windowMs?: number }} [options] window length in milliseconds.
		 * @returns {{ add: (chars: number, at?: number) => void, rate: (at?: number) => number, reset: () => void }}
		 */
		function typingMeter(options) {
			const windowMs = options && Number.isFinite(options.windowMs) && options.windowMs > 0 ? options.windowMs : 60000;
			/** Samples of net characters, oldest first. */
			let samples = [];

			/**
			 * Drop samples that have fallen out of the window.
			 * @param {number} now epoch milliseconds.
			 */
			const prune = (now) => {
				const cutoff = now - windowMs;
				samples = samples.filter((sample) => sample.at > cutoff);
			};

			return {
				/**
				 * Record net characters: +1 for a typed character, -3 after a deletion.
				 * @param {number} chars signed character delta.
				 * @param {number} [at] epoch milliseconds, defaults to now.
				 */
				add(chars, at) {
					const when = Number.isFinite(at) ? at : Date.now();
					if (!Number.isFinite(chars) || chars === 0) return;
					prune(when);
					const last = samples[samples.length - 1];
					// Fold rapid keystrokes into one sample so the array cannot grow without bound.
					if (last && when - last.at < 1000) last.chars += chars;
					else samples.push({ at: when, chars });
				},
					/**
					 * Characters per minute across the span the retained samples cover.
					 *
					 * The denominator is the age of the oldest surviving sample, capped at the window —
					 * not the age of the whole run. Using the run's age made a steady rate decay over time,
					 * because pruned samples shrank the numerator while the denominator kept growing.
					 *
					 * @param {number} [at] epoch milliseconds, defaults to now.
					 * @returns {number} rounded characters per minute, never negative.
					 */
					rate(at) {
						const when = Number.isFinite(at) ? at : Date.now();
						prune(when);
						if (samples.length === 0) return 0;
						let total = 0;
						for (const sample of samples) total += sample.chars;
						const span = Math.max(1000, when - samples[0].at);
						const perMinute = (total / span) * 60000;
						if (!Number.isFinite(perMinute)) return 0;
						return Math.max(0, Math.min(TYPING_RATE_CEILING, Math.round(perMinute)));
					},
				reset() {
					samples = [];
				},
			};
		}

		/** Openers worth auto-closing while typing. `*` is left out: it starts a bullet list. */
		const AUTO_PAIR_KEYS = "([【《\u201c\"'`（";

		/**
		 * Emphasis marks that wrap a selection but never auto-close while typing.
		 * A bare `*` at the start of a line has to stay a list marker, so these only
		 * act when there is something selected to wrap.
		 */
		const EMPHASIS_KEYS = "*_";

		/** Selection-bar glyphs, in the order SiYuan shows its inline buttons. */
		const INLINE_GLYPHS = { bold: "B", italic: "I", underline: "U", strike: "S", code: "</>", highlight: "==" };
		const INLINE_ORDER = ["bold", "italic", "underline", "strike", "code", "highlight"];

		/** Byte range of a 0-based line index, for jumping from the outline into the text. */
		function lineRange(text, index) {
			const rows = String(text ?? "").split("\n");
			const wanted = Math.max(0, Math.min(Number(index) || 0, rows.length - 1));
			let at = 0;
			for (let i = 0; i < wanted; i++) at += rows[i].length + 1;
			return { start: at, end: at + rows[wanted].length, line: wanted, total: rows.length };
		}
		// #endregion

		/**
		 * Does a block's text carry leading indent characters?
		 *
		 * `getBlockKramdown` trims the start of its whole response, so a document's FIRST
		 * block always reads back without the lead it really has — the index (`blocks.content`)
		 * and `getBlockDOM` both keep it, and SiYuan's own editor shows it. Everything else in
		 * the plugin must therefore treat "the first block lost its lead" as a read artefact
		 * rather than an edit.
		 * @param {string} text block text.
		 * @returns {boolean} true when the text begins with whitespace.
		 */
		function hasLeadingSpace(text) {
			return /^[\u3000\u00a0 \t]/.test(String(text ?? ""));
		}

		/**
		 * Re-attach the lead the kernel dropped from a document's first block.
		 *
		 * The lead is recovered from the block index, which is the only read channel that
		 * reports it faithfully. Only the first block is repaired: the trim happens at the
		 * start of the response, so every later block arrives intact.
		 *
		 * @param {Array<{ id?: string, text: string }>} blocks blocks as read.
		 * @param {string} lead leading whitespace the document really has ("" when none).
		 * @returns {Array<{ id?: string, text: string }>} a new list with the lead restored.
		 */
		function restoreFirstLead(blocks, lead) {
			if (!Array.isArray(blocks) || blocks.length === 0) return Array.isArray(blocks) ? blocks.slice() : [];
			if (typeof lead !== "string" || lead === "") return blocks.slice();
			const first = blocks[0];
			if (first === null || typeof first !== "object") return blocks.slice();
			if (hasLeadingSpace(first.text)) return blocks.slice();
			const out = blocks.slice();
			out[0] = { ...first, text: lead + String(first.text ?? "") };
			return out;
		}

		/**
		 * Read a document's text the way the editor should see it.
		 *
		 * One call instead of three bespoke ones at every call site: fetch the kramdown,
		 * split it into blocks, and put back the first block's lead that the kernel trimmed.
		 * The lead comes from the index and is only fetched when the first block could have
		 * lost one, so the common case stays a single request.
		 *
		 * @param {{ api: (path: string, payload: object) => Promise<any> }} client bridge.
		 * @param {string} docId document id.
		 * @returns {Promise<{ kramdown: string, blocks: Array<{ id?: string, text: string }>, text: string, lead: string }>}
		 */
		async function readDocumentText(client, docId) {
			const data = await client.api("/api/block/getBlockKramdown", { id: docId });
			const kramdown = data && data.kramdown ? data.kramdown : "";
			const raw = splitKramdown(kramdown).filter((block) => block.id != null);
			const lead = raw.length > 0 && !hasLeadingSpace(raw[0].text) ? await firstBlockLead(client, raw[0].id) : "";
			const blocks = restoreFirstLead(raw, lead);
			return { kramdown, blocks, text: blocks.map((block) => block.text).join("\n\n"), lead };
		}

		/**
		 * The leading whitespace a block really starts with, per the kernel's index.
		 *
		 * Returns "" when the block has no indent, when the query fails, or when the answer
		 * cannot be trusted — the caller then shows the text exactly as the kernel read it,
		 * which is the behaviour before this repair existed.
		 *
		 * @param {{ api: (path: string, payload: object) => Promise<any> }} client bridge.
		 * @param {string} blockId block id.
		 * @returns {Promise<string>} the lead characters, or "".
		 */
		async function firstBlockLead(client, blockId) {
			if (typeof blockId !== "string" || blockId === "") return "";
			try {
				const rows = await client.api("/api/query/sql", {
					stmt: "SELECT content FROM blocks WHERE id = '" + blockId.replace(/'/g, "''") + "' LIMIT 1",
				});
				const row = Array.isArray(rows) ? rows[0] : null;
				const content = row && typeof row.content === "string" ? row.content : "";
				const match = /^[\u3000\u00a0 \t]+/.exec(content);
				return match ? match[0] : "";
			} catch {
				return "";
			}
		}

		function sameTexts(a, b) {
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
			return true;
		}

		/**
		 * Plan a block-level sync between the blocks currently stored in SiYuan and
		 * the blocks the user's text now describes. Returns ordered steps that keep
		 * untouched blocks (and their ids) intact.
		 */
		/**
		 * Fold a replacement (a removed block followed by an added one) into a single
		 * update step, so the block keeps its id and its inbound references survive.
		 */
		function normalizeSteps(steps) {
			const out = [];
			let index = 0;
			while (index < steps.length) {
				if (steps[index].op !== "delete") {
					out.push(steps[index]);
					index++;
					continue;
				}
				// A run of removals followed by a run of additions is a rewrite: pair them
				// positionally so the blocks keep their ids (and their inbound references).
				const removed = [];
				while (index < steps.length && steps[index].op === "delete") removed.push(steps[index++]);
				const added = [];
				while (index < steps.length && steps[index].op === "insert") added.push(steps[index++]);
				const paired = Math.min(removed.length, added.length);
				for (let i = 0; i < paired; i++) out.push({ op: "update", id: removed[i].id, text: added[i].text });
				for (let i = paired; i < removed.length; i++) out.push(removed[i]);
				for (let i = paired; i < added.length; i++) out.push(added[i]);
			}
			return out;
		}
		function planSync(original, next) {
			const n = original.length;
			const m = next.length;
			if (n * m > 4_000_000) {
				const steps = [];
				const common = Math.min(n, m);
				for (let i = 0; i < common; i++) {
					steps.push(original[i].text === next[i] ? { op: "keep", id: original[i].id } : { op: "update", id: original[i].id, text: next[i] });
				}
				for (let i = common; i < m; i++) steps.push({ op: "insert", text: next[i] });
				for (let i = common; i < n; i++) steps.push({ op: "delete", id: original[i].id });
				return normalizeSteps(steps);
			}
			const width = m + 1;
			const dp = new Uint32Array((n + 1) * width);
			for (let i = n - 1; i >= 0; i--) {
				for (let j = m - 1; j >= 0; j--) {
					dp[i * width + j] =
						original[i].text === next[j]
							? dp[(i + 1) * width + j + 1] + 1
							: Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
				}
			}
			const steps = [];
			let i = 0;
			let j = 0;
			while (i < n && j < m) {
				if (original[i].text === next[j]) {
					steps.push({ op: "keep", id: original[i].id });
					i++;
					j++;
				} else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
					steps.push({ op: "delete", id: original[i].id });
					i++;
				} else {
					steps.push({ op: "insert", text: next[j] });
					j++;
				}
			}
			while (i < n) {
				steps.push({ op: "delete", id: original[i].id });
				i++;
			}
			while (j < m) {
				steps.push({ op: "insert", text: next[j] });
				j++;
			}
			return normalizeSteps(steps);
		}

		/**
		 * 磁盘上的文档是否仍等于面板的「上次保存点」。
		 *
		 * 比的是**块级文本**（planSync 的口径），不是原始 kramdown：尾随空行、两连空行、
		 * 首块缩进这些版面差异内核读回时本来就和缓冲区不同，按原始文本比会立刻误报，
		 * 于是这道闸就成了「每次保存都喊有冲突」的噪音源。全是 keep 才算没被改过。
		 *
		 * @param {Array<{ id?: string, text: string }>} blocks 现在磁盘上的块。
		 * @param {string} savedText 上次确认的正文；空串也是有效基线。
		 * @returns {boolean} true = 没有外部改动。
		 */
		function documentUnchanged(blocks, savedText) {
			const original = Array.isArray(blocks) ? blocks : [];
			const baseline = String(savedText ?? "");
			const steps = planSync(original, splitMarkdown(baseline));
			return steps.every((step) => step.op === "keep");
		}

		/** The id of the block a write created, read out of the transaction SiYuan returns. */
		function createdBlockId(result) {
			if (!Array.isArray(result)) return undefined;
			for (const transaction of result) {
				const ops = transaction && transaction.doOperations;
				if (!Array.isArray(ops)) continue;
				for (const op of ops) {
					if (op && op.action === "insert" && typeof op.id === "string") return op.id;
				}
			}
			return undefined;
		}
		// #endregion

		// #region images
		/**
		 * 图片（上传 + 预览渲染）共用的常量与纯函数。
		 *
		 * 三条链路取同一份规则：浏览器侧的大小上限、IAL 宽度白名单、资源路径 → 宿主代理 URL。
		 * 全部导出到 `exports.__test`，既给单测，也给后续的分段编辑器（design §9.2）复用。
		 */
		/** 单张图片的浏览器侧上限：超过就地提示，不浪费一次上传（宿主侧另有 32MB 硬限）。 */
		const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
		/** 宽度值允许的形态：宽度是唯一从正文 IAL 走进 HTML 的东西，所以收得很紧。 */
		const IMAGE_WIDTH_VALUE = /^\d+(\.\d+)?(px|%|em|rem)$/;
		/** 本期只放行根资源目录（用户库 62 张图全在这里）；其余相对路径仍是占位标签。 */
		const ASSET_PREFIX = "assets/";
		/** 图片宽度预设（design §9.5：只做三档，不做自由缩放/拖动）。`null` = 原始（去掉 IAL）。 */
		const IMAGE_WIDTH_PRESETS = [
			{ key: "original", label: "imageWidthOriginal", width: null },
			{ key: "half", label: "imageWidthHalf", width: "50%" },
			{ key: "full", label: "imageWidthFull", width: "100%" },
		];

		/** 资源相对路径 → 宿主代理 URL。URL 里不出现 token，浏览器也不直连内核。 */
		function assetPreviewUrl(relPath) {
			return "/siyuan/asset?path=" + encodeURIComponent(String(relPath ?? ""));
		}

		/**
		 * 还原 `escapeHtml` 转过的那几个实体。
		 *
		 * 兼容已经转义过的 IAL 属性与资源显示名，避免实体变成可见文字。
		 * 图片路径则直接由原始 Markdown 解析，只在进入代理 URL 时编码一次。
		 */
		function decodeHtmlEntities(text) {
			return String(text ?? "")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#39;/g, "'")
				.replace(/&amp;/g, "&");
		}

		/**
		 * 从行内 IAL 里抽出可以安全写进 `<img style>` 的宽度。
		 *
		 * 入参是完整 IAL 文本（`{: style="width: 560px;"}`），也容忍已 HTML 转义的形式 ——
		 * 兼容调用者已经把引号转成 `&quot;` 的输入。
		 * 只放行 `width` / `max-width` 两条声明，且值必须命中宽度白名单；IAL 里的其它属性
		 * （color、自定义属性、expression…）连解析都不进，因此不可能泄漏到 HTML 里。
		 * 返回 `{ width, maxWidth, style }`：前两者是合法值字符串或 null，`style` 可直接写进属性。
		 */
		function parseImageIal(ialText) {
			const result = { width: null, maxWidth: null, style: "" };
			let body = String(ialText ?? "");
			if (!body) return result;
			// 先还原实体，这样 raw markdown 与已转义的预览文本两种入参都能吃。
			body = decodeHtmlEntities(body).replace(/&apos;/g, "'");
			body = body.replace(/^\s*\{:\s*/, "").replace(/\}\s*$/, "");
			const style = /style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;"'}]+))/i.exec(body);
			if (!style) return result;
			for (const declaration of (style[1] ?? style[2] ?? style[3] ?? "").split(";")) {
				const match = /^\s*(max-width|width)\s*:\s*(.+?)\s*$/.exec(declaration);
				if (!match) continue;
				const key = match[1].toLowerCase() === "max-width" ? "maxWidth" : "width";
				if (!IMAGE_WIDTH_VALUE.test(match[2])) continue; // 形态不合法就地丢弃，不留痕迹
				if (result[key] === null) result[key] = match[2]; // 同名多次出现只认第一条
			}
			const parts = [];
			if (result.width) parts.push("width:" + result.width);
			if (result.maxWidth) parts.push("max-width:" + result.maxWidth);
			result.style = parts.join(";");
			return result;
		}

		/** 文件名 → 图片说明：去掉最后一个扩展名，`]` 转义（别截断 markdown），换行折成空格。 */
		function filenameToAlt(fileName) {
			const name = String(fileName ?? "").replace(/^.*[\\/]/, "");
			const dot = name.lastIndexOf(".");
			const stem = dot > 0 ? name.slice(0, dot) : name;
			return stem.replace(/[\r\n]+/g, " ").replace(/\]/g, "\\]").trim();
		}

		/** 说明输入框和图片替代文字显示原字符；源码里的反斜杠转义仍留在 syntax 中。 */
		function imageAltText(alt) {
			return String(alt ?? "").replace(/\\(\\|\[|\])/g, "$1");
		}

		/** 逐个定位行内图片；保留字符边界，跳过转义、行内代码和 HTML 注释。 */
		function imagesInLine(line) {
			const text = String(line ?? "");
			const images = [];
			const tokens = /<!--[\s\S]*?(?:-->|$)|`+|\\.|!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)(?:[ \t]+"[^"]*")?\)([ \t]*\{:[^}]*\})?/g;
			let match;
			while ((match = tokens.exec(text)) !== null) {
				if (match[0][0] === "`") {
					// 只有长度相同的反引号才能结束行内代码；未闭合的标记仍是正文。
					const marker = match[0];
					let end = text.indexOf(marker, tokens.lastIndex);
					while (end !== -1 && (text[end - 1] === "`" || text[end + marker.length] === "`")) end = text.indexOf(marker, end + marker.length);
					if (end !== -1) tokens.lastIndex = end + marker.length;
					continue;
				}
				if (match[1] === undefined) continue;
				const ial = (match[3] || "").trim();
				images.push({ start: match.index, end: tokens.lastIndex, path: match[2], alt: match[1], ial, style: parseImageIal(ial).style });
			}
			return images;
		}

		/** 整行只有一张图时返回图片信息，供插入路径识别独立图片行。 */
		function imageLineOf(line) {
			const text = String(line ?? "");
			const images = imagesInLine(text);
			if (images.length !== 1 || text.slice(0, images[0].start).trim() || text.slice(images[0].end).trim()) return null;
			const { path, alt, ial, style } = images[0];
			return { path, alt, ial, style };
		}
		// #endregion

		// #region editor segments
		/**
		 * 编辑区分段（design §9.2/§9.5 路线 A）：整篇 markdown → 「文本段 + 图片段」。
		 *
		 * 切分是纯函数，也是编辑区唯一真值来源：每段都记着自己在原文里的 `start/end`，
		 * 重组时按序拼接各段的 `text` / 图片语法行，必须**逐字节**等于原文（单测锁死）。
		 * 独立图片行包含它自己的换行；与正文同一行的图片仅占自己的语法区间，
		 * 前后正文仍属文本段。绝不补分隔符，CRLF、缺尾换行、空行都能原样还原。
		 *
		 * 段形状：
		 *   { kind:"text",  start, end, text, line }                        // text 含其末尾换行
		 *   { kind:"image", start, end, syntax, assetPath, alt, ial,
		 *                   style, line }                                  // 独立图含换行，行内图只含语法
		 * `line` 是 0 基行号，卡片显示行号、查找与滚动同步都用它。
		 *
		 * 图片位置由 `imagesInLine` 识别（同段多图、缩进均支持），并且**跟踪围栏状态**：
		 * ``` / ~~~ 里面的 `![](…)` 是代码，不是图片。
		 */
		function splitEditorSegments(source) {
			const text = String(source ?? "");
			const segments = [];
			/** 围栏状态：{marker, size}；与预览渲染器的开闭规则保持一致。 */
			let fence = null;
			let line = 0;
			let rowStart = 0;
			/** 当前文本段的**起始**行号（不是收段时所在的行）。 */
			let textLine = 0;
			/** 把 [rowStart, end) 收成一个文本段（空的不产生段）。 */
			const flushText = (end) => {
				if (end <= rowStart) return;
				segments.push({ kind: "text", start: rowStart, end, text: text.slice(rowStart, end), line: textLine });
				rowStart = end;
			};
			let at = 0;
			while (at < text.length) {
				const breakAt = text.indexOf("\n", at);
				const rowEnd = breakAt === -1 ? text.length : breakAt + 1; // 行 + 它的换行
				const body = breakAt === -1 ? text.slice(at) : text.slice(at, breakAt);
				const fenceMatch = /^\s*(`{3,}|~{3,})\s*([\w+#-]*)\s*$/.exec(body);
				if (fenceMatch) {
					if (fence === null) fence = { marker: fenceMatch[1][0], size: fenceMatch[1].length };
					else if (fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.size) fence = null;
				}
				const images = fence === null ? imagesInLine(body) : [];
				const wholeLine = images.length === 1 && !body.slice(0, images[0].start).trim() && !body.slice(images[0].end).trim();
				for (const image of images) {
					const start = wholeLine ? at : at + image.start;
					const end = wholeLine ? rowEnd : at + image.end;
					flushText(start);
					segments.push({
						kind: "image",
						start,
						end,
						syntax: text.slice(start, end),
						assetPath: image.path,
						alt: image.alt,
						ial: image.ial,
						style: image.style,
						line,
					});
					rowStart = end;
					textLine = wholeLine && breakAt !== -1 ? line + 1 : line;
				}
				line++;
				at = rowEnd;
			}
			flushText(text.length);
			return segments;
		}

		/**
		 * 编辑区用的分段：与 `splitEditorSegments` 相同，但空文档也**至少给一个空文本段**，
		 * 否则空白文档在编辑区里连一个可打字的 textarea 都没有。
		 */
		function editorSegments(source) {
			const rows = splitEditorSegments(source);
			if (rows.length > 0) return rows;
			return [{ kind: "text", start: 0, end: 0, text: "", line: 0 }];
		}

		/** 分段 → 整篇文本。与 `splitEditorSegments` 互为逆运算（逐字节）。 */
		function joinEditorSegments(segments) {
			return (Array.isArray(segments) ? segments : [])
				.map((segment) => (segment && segment.kind === "image" ? segment.syntax : segment && segment.text) ?? "")
				.join("");
		}

		/** 用新内容替换第 index 段（文本段给新正文，图片段给新语法行），返回重组后的整篇文本。 */
		function replaceSegmentText(source, segments, index, next) {
			const segment = (segments || [])[index];
			if (!segment) return String(source ?? "");
			const text = String(source ?? "");
			return text.slice(0, segment.start) + String(next ?? "") + text.slice(segment.end);
		}

		/**
		 * 只改一段的内容，其余段的位置按增量平移 —— **不重切分**。
		 *
		 * 这条是「文本段里打字绝不触发重切分」的实现：段边界、段 key、段内光标都不动，
		 * 只有后面的 start/end 跟着长度差平移，所以键入 `![](` 不会在下一帧跳成卡片。
		 */
		function withSegmentText(segments, index, next) {
			const rows = (segments || []).slice();
			const target = rows[index];
			if (!target) return rows;
			const value = String(next ?? "");
			const before = target.kind === "image" ? target.syntax : target.text;
			const delta = value.length - String(before ?? "").length;
			rows[index] =
				target.kind === "image"
					? { ...target, end: target.start + value.length, syntax: value }
					: { ...target, end: target.start + value.length, text: value };
			if (delta !== 0) {
				for (let i = index + 1; i < rows.length; i++) rows[i] = { ...rows[i], start: rows[i].start + delta, end: rows[i].end + delta };
			}
			return rows;
		}

		/** 行号 → 段下标（含该行的段；行号超出末尾时给最后一段）。空数组返回 -1。 */
		function segmentIndexForLine(segments, line) {
			const rows = Array.isArray(segments) ? segments : [];
			for (let i = rows.length - 1; i >= 0; i--) if (line >= rows[i].line) return i;
			return rows.length > 0 ? 0 : -1;
		}

		/** 整篇字符偏移 → 段下标（偏移落在哪一段里）。空数组返回 -1。 */
		function segmentIndexForOffset(segments, offset) {
			const rows = Array.isArray(segments) ? segments : [];
			for (let i = rows.length - 1; i >= 0; i--) if (offset >= rows[i].start) return i;
			return rows.length > 0 ? 0 : -1;
		}

		/**
		 * 从 index 起找最近的**可编辑**（文本）段：图片卡片段没有可放光标的地方，
		 * 所以「跳到某行」「定位查找命中」都要能滑到旁边的文本段去。
		 */
		function nearestTextSegment(segments, index, direction) {
			const rows = Array.isArray(segments) ? segments : [];
			if (rows.length === 0) return -1;
			const step = direction < 0 ? -1 : 1;
			for (let i = Math.min(Math.max(index, 0), rows.length - 1); i >= 0 && i < rows.length; i += step) {
				if (rows[i].kind === "text") return i;
			}
			// 这个方向没有文本段（比如图片在文档末尾），反过来找
			for (let i = Math.min(Math.max(index, 0), rows.length - 1); i >= 0 && i < rows.length; i -= step) {
				if (rows[i].kind === "text") return i;
			}
			return -1;
		}

		/** 资源路径 → 卡片上显示的文件名（只取最后一段，AntSword 式的长哈希名也看得懂）。 */
		function assetDisplayName(assetPath) {
			const name = String(assetPath ?? "").split(/[\\/]/).pop() ?? "";
			return decodeHtmlEntities(name) || String(assetPath ?? "");
		}

		/** 图片行的 IAL 宽度预设：写回 `{: style="width: …" }`；`null` 表示「原始」（去掉 IAL）。 */
		function imageSyntaxWithWidth(assetPath, alt, width) {
			const head = "![" + String(alt ?? "") + "](" + String(assetPath ?? "") + ")";
			return width ? head + '{: style="width: ' + String(width) + ';"}' : head;
		}
		// #endregion

		// #region markdown preview
		function escapeHtml(text) {
			return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		}

		function inlineHtml(text) {
			// 与编辑卡片共用识别器；先把图片替换为占位，后续加粗/链接解析不再碰 img 属性。
			const source = String(text ?? "");
			const images = [];
			const parts = [];
			let at = 0;
			for (const image of imagesInLine(source)) {
				const alt = escapeHtml(imageAltText(image.alt));
				const size = image.style ? ' style="' + image.style + '"' : "";
				const src = image.path.startsWith(ASSET_PREFIX) ? assetPreviewUrl(image.path) : /^(https?:|data:)/i.test(image.path) ? image.path : null;
				const html = src === null
					? '<span class="sy-imgph">🖼 ' + (alt || escapeHtml(image.path)) + "</span>"
					: '<img alt="' + alt + '" src="' + escapeHtml(src) + '" loading="lazy" decoding="async"' + size + " />";
				parts.push(source.slice(at, image.start), "\u0000I" + images.length + "\u0000");
				images.push(html);
				at = image.end;
			}
			parts.push(source.slice(at));
			let s = escapeHtml(parts.join(""));
			const codes = [];
			s = s.replace(/`([^`]+)`/g, (_, code) => {
				codes.push(code);
				return "\u0000C" + (codes.length - 1) + "\u0000";
			});
			s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => {
				const safe = /^(https?:|mailto:|#)/i.test(href) ? href : "#";
				return '<a href="' + safe + '" target="_blank" rel="noreferrer noopener">' + label + "</a>";
			});
			s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
			s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
			s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
			s = s.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
			s = s.replace(/\u0000C(\d+)\u0000/g, (_, index) => "<code>" + codes[Number(index)] + "</code>");
			s = s.replace(/\u0000I(\d+)\u0000/g, (_, index) => images[Number(index)]);
			return s;
		}

		function listItem(line) {
			const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
			if (!match) return null;
			const indent = match[1].replace(/\t/g, "  ").length;
			const ordered = /^\d/.test(match[2]);
			let body = match[3];
			let task = null;
			const checked = /^\[([ xX])\]\s+(.*)$/.exec(body);
			if (checked) {
				task = checked[1].toLowerCase() === "x";
				body = checked[2];
			}
			return { indent, ordered, body, task };
		}

		/**
		 * Render the subset of Markdown a SiYuan document is likely to contain.
		 *
		 * `options.lineAnchors` 让每个顶层块带上 `data-line="<0 基行号>"`：编辑区改成
		 * 分段渲染之后，两侧滚动同步要有「预览的哪一块对应源文的哪一行」这个锚点，
		 * 而预览以前一个锚点都没有。默认关闭 —— 老调用点与既有断言的 HTML 保持逐字不变。
		 */
		function markdownToHtml(markdown, options) {
			const lines = String(markdown ?? "").split("\n");
			const html = [];
			const lineAnchors = Boolean(options && options.lineAnchors);
			const anchor = (at) => (lineAnchors ? ' data-line="' + at + '"' : "");
			let i = 0;
			while (i < lines.length) {
				const line = lines[i];
				if (!line.trim()) {
					i++;
					continue;
				}
				const rowAt = i;
				const fence = /^\s*(```+|~~~+)\s*([\w+#-]*)\s*$/.exec(line);
				if (fence) {
					const marker = fence[1][0];
					const size = fence[1].length;
					const lang = fence[2];
					i++;
					const body = [];
					while (i < lines.length) {
						const close = /^\s*([`~]+)\s*$/.exec(lines[i]);
						if (close && close[1][0] === marker && close[1].length >= size) {
							i++;
							break;
						}
						body.push(lines[i]);
						i++;
					}
					html.push(
						"<pre" + anchor(rowAt) + "><code" + (lang ? ' class="language-' + escapeHtml(lang) + '"' : "") + ">" + escapeHtml(body.join("\n")) + "</code></pre>",
					);
					continue;
				}
				const heading = /^(#{1,6})\s+(.*)$/.exec(line);
				if (heading) {
					const level = heading[1].length;
					html.push("<h" + level + anchor(rowAt) + ">" + inlineHtml(heading[2].replace(/\s+#+\s*$/, "")) + "</h" + level + ">");
					i++;
					continue;
				}
				if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
					html.push("<hr" + anchor(rowAt) + " />");
					i++;
					continue;
				}
				if (/^\s*>/.test(line)) {
					const body = [];
					while (i < lines.length && /^\s*>/.test(lines[i])) {
						body.push(lines[i].replace(/^\s*>\s?/, ""));
						i++;
					}
					html.push("<blockquote" + anchor(rowAt) + ">" + body.map((row) => (row.trim() ? "<p>" + inlineHtml(row) + "</p>" : "")).join("") + "</blockquote>");
					continue;
				}
				if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
					const head = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
					const rows = [];
					i += 2;
					while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
						rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
						i++;
					}
					html.push(
						"<table" + anchor(rowAt) + "><thead><tr>" +
							head.map((cell) => "<th>" + inlineHtml(cell) + "</th>").join("") +
							"</tr></thead><tbody>" +
							rows.map((row) => "<tr>" + row.map((cell) => "<td>" + inlineHtml(cell) + "</td>").join("") + "</tr>").join("") +
							"</tbody></table>",
					);
					continue;
				}
				if (listItem(line)) {
					const items = [];
					while (i < lines.length && lines[i].trim() && (listItem(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
						const item = listItem(lines[i]);
						if (item) {
							items.push(item);
							i++;
							continue;
						}
						if (items.length > 0) items[items.length - 1].body += " " + lines[i].trim();
						i++;
					}
					const ordered = items[0] ? items[0].ordered : false;
					const tag = ordered ? "ol" : "ul";
					const minIndent = Math.min(...items.map((item) => item.indent));
					html.push(
						"<" +
							tag +
							anchor(rowAt) +
							">" +
							items
								.map((item) => {
									const depth = Math.max(0, Math.round((item.indent - minIndent) / 2));
									const style = depth > 0 ? ' style="margin-left:' + depth * 16 + 'px"' : "";
									const check = item.task === null ? "" : '<input type="checkbox" disabled' + (item.task ? " checked" : "") + " />";
									const cls = item.task === null ? "" : ' class="sy-task"';
									return "<li" + cls + style + ">" + check + inlineHtml(item.body) + "</li>";
								})
								.join("") +
							"</" +
							tag +
							">",
					);
					continue;
				}
				const paragraph = [];
				while (i < lines.length && lines[i].trim()) {
					const next = lines[i];
					if (/^(#{1,6})\s/.test(next) || /^\s*>/.test(next) || /^\s*(```+|~~~+)/.test(next) || listItem(next)) break;
					if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(next)) break;
					paragraph.push(next);
					i++;
				}
				if (paragraph.length === 0) {
					i++;
					continue;
				}
					// The paragraph's own indent is drawn by CSS, so a literal one is dropped
					// first — otherwise an indented paragraph would render twice as deep.
					const bare = paragraph.map((row) => row.replace(/^\u3000\u3000/, ""));
					html.push("<p" + anchor(rowAt) + ">" + bare.map((row) => inlineHtml(row)).join("<br />") + "</p>");
			}
			return html.join("\n");
		}

		/** Headings of the current document, for the outline tab. */
		function outlineOf(markdown) {
			const out = [];
			const lines = String(markdown ?? "").split("\n");
			let fence = null;
			for (let index = 0; index < lines.length; index++) {
				const line = lines[index];
				const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
				if (fenceMatch) {
					if (fence === null) fence = fenceMatch[1][0];
					else if (fenceMatch[1][0] === fence) fence = null;
					continue;
				}
				if (fence !== null) continue;
				const heading = /^(#{1,6})\s+(.*)$/.exec(line);
				// `line` is the 0-based source line, so the outline can put the caret there.
				if (heading) out.push({ level: heading[1].length, text: heading[2].trim(), line: index });
			}
			return out;
		}
		// #endregion

		// #region conversation bridge
		/**
		 * The composer lives inside the conversation subtree, so its actions are
		 * published by a component mounted there and consumed by this panel's
		 * toolbar. One stable record with a tiny subscription keeps both halves in
		 * sync without pulling the whole conversation tree into this module.
		 */
		const composerBridge = (() => {
			let snapshot = { sessionId: undefined, actions: undefined };
			const listeners = new Set();
			return {
				get: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				publish(next) {
					if (snapshot.sessionId === next.sessionId && snapshot.actions === next.actions) return;
					snapshot = next;
					for (const listener of listeners) listener();
				},
			};
		})();

		/**
		 * The slot entry point.
		 *
		 * PanelPage is itself the crash point for a broken prop wiring, so the boundary
		 * *inside* it never runs in that case: the registration just fails and the region
		 * renders as nothing at all, with no message to read. Wrapping it here turns that
		 * into a visible error — a bug you can see is a bug you can report.
		 */
		function PanelHost(props) {
			const label = typeof props.t === "function" ? props.t("title") : "SiYuan Notes";
			const hint = typeof props.t === "function" ? props.t("panelBrokenHint") : "";
			return h(PanelBoundary, { label, hint }, h(PanelPage, props));
		}

		/**
		 * Contains a render failure to the region it happens in. A broken optional
		 * region (the embedded conversation) must cost that region only — an
		 * unhandled throw unmounts the whole slot entry, which the user sees as a
		 * blank panel.
		 */
		class PanelBoundary extends React.Component {
			constructor(props) {
				super(props);
				this.state = { message: null };
			}

			static getDerivedStateFromError(error) {
				return { message: error && error.message ? error.message : String(error) };
			}

			componentDidCatch(error, info) {
				// Surfaced in the region itself; the console keeps the component stack.
				console.error("[dsh-siyuan-notes]", this.props.label || "panel", error, info);
			}

			render() {
				if (this.state.message !== null) {
					return h(
						"div",
						{ className: "sy-boundary" },
						h("strong", null, (this.props.label || "region") + " 渲染失败"),
						h("span", null, this.state.message),
						this.props.hint ? h("span", { className: "sy-boundary-hint" }, this.props.hint) : null,
					);
				}
				return this.props.children;
			}
		}

		/** Records the composer actions of whichever conversation is mounted. */
		function ComposerBridge({ sessionId, inputActions }) {
			useEffect(() => {
				composerBridge.publish({ sessionId, actions: inputActions });
				return () => composerBridge.publish({ sessionId: undefined, actions: undefined });
			}, [sessionId, inputActions]);
			return null;
		}

		function useComposerBridge() {
			return React.useSyncExternalStore(composerBridge.subscribe, composerBridge.get, composerBridge.get);
		}
		// #endregion

		// #region small components
		const CARET = h(
			"svg",
			{ viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": true },
			h("path", { d: "M6 3.5 10.5 8 6 12.5", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }),
		);

		function SidebarIcon({ size, active }) {
			const stroke = "currentColor";
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: size || 18,
					height: size || 18,
					"aria-hidden": true,
					style: { display: "block", opacity: active ? 1 : 0.82 },
				},
				h("rect", { x: 3.2, y: 3.2, width: 13.4, height: 17.6, rx: 2.6, fill: "none", stroke, strokeWidth: 1.6 }),
				h("path", { d: "M6.6 8h6.6M6.6 11.5h6.6M6.6 15h4", fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round" }),
				h("path", { d: "M17.2 13.2l3.6 3.6-4.8 1.2 1.2-4.8z", fill: stroke }),
			);
		}

		function ToolButton({ label, onClick, active, children, tone, disabled }) {
			return h(
				"button",
				{
					type: "button",
					className: "sy-iconbtn",
					title: label,
					"aria-label": label,
					"data-active": active ? true : undefined,
					"data-tone": tone,
					disabled,
					onMouseDown: (event) => event.preventDefault(),
					onClick,
				},
				children ?? label,
			);
		}

		function Badge({ tone, children }) {
			return h("span", { className: "sy-badge", "data-tone": tone }, children);
		}
		// #endregion

		// #region tree pane
		function TreePane({ t, client, state, activeDocId, onOpenDoc, onNotebookOpen, onOutlineJump, expanded, setExpanded, expandedReady }) {
			const [notebooks, setNotebooks] = useState([]);
			const [children, setChildren] = useState({});
			const [error, setError] = useState(null);
			const [tab, setTab] = useState("docs");
			const [query, setQuery] = useState("");
			const [results, setResults] = useState(null);
			const [searching, setSearching] = useState(false);

			// Directories already asked for. A ref, not state: the restore and a click can
			// both request the same path within one tick, and a second request would be
			// wasted (and could race the first one's answer).
			const requestedRef = useRef(new Set());

			const loadNotebooks = useCallback(async () => {
				try {
					const data = await client.api("/api/notebook/lsNotebooks", {});
					const list = (data && data.notebooks) || [];
					setNotebooks(list);
					setError(null);
				} catch (err) {
					setError(err && err.message ? err.message : String(err));
				}
			}, [client]);

			useEffect(() => {
				void loadNotebooks();
			}, [loadNotebooks, state]);

			const loadPath = useCallback(
				async (notebookId, path, force) => {
					const key = notebookId + "::" + path;
					if (requestedRef.current.has(key) && !force) return;
					requestedRef.current.add(key);
					setChildren((prev) => ({ ...prev, [key]: { status: "loading", files: prev[key] ? prev[key].files : [] } }));
					try {
						const data = await client.api("/api/filetree/listDocsByPath", { notebook: notebookId, path, maxListCount: 1000 });
						const files = ((data && data.files) || []).slice().sort(compareDocEntries);
						setChildren((prev) => ({ ...prev, [key]: { status: "ready", files } }));
					} catch (err) {
						requestedRef.current.delete(key);
						setChildren((prev) => ({ ...prev, [key]: { status: "error", files: [], error: err && err.message ? err.message : String(err) } }));
					}
				},
				[client],
			);

			/**
			 * Load the directories a restored expansion state needs.
			 *
			 * Every remembered folder is requested at once. That is safe because
			 * `listDocsByPath` takes a full path and the kernel resolves it directly — it
			 * does not need the parent to be listed first (verified against the real kernel).
			 * The requests are still ordered outermost-first for a friendlier failure mode,
			 * and anything already loaded is skipped, so this is cheap to run again after a
			 * refresh.
			 */
			useEffect(() => {
				if (!expandedReady) return;
				const keys = Object.keys(expanded || {}).filter((key) => expanded[key] === true);
				if (keys.length === 0) return;
				const load = (key) => {
					const split = key.indexOf("::");
					if (split === -1) return;
					const notebookId = key.slice(0, split);
					const path = key.slice(split + 2);
					void loadPath(notebookId, path);
				};
				// Outermost first: the notebook root, then paths with fewer segments.
				keys
					.filter((key) => key.endsWith("::/"))
					.sort()
					.forEach(load);
				keys
					.filter((key) => !key.endsWith("::/"))
					.sort((left, right) => (left.match(/\//g) || []).length - (right.match(/\//g) || []).length)
					.forEach(load);
			}, [expandedReady, expanded, loadPath]);

			const toggle = useCallback(
				(notebookId, path) => {
					const key = notebookId + "::" + path;
					setExpanded((prev) => {
						const next = { ...prev, [key]: !prev[key] };
						if (next[key]) void loadPath(notebookId, path);
						return next;
					});
				},
				[loadPath, setExpanded],
			);

			useEffect(() => {
				const trimmed = query.trim();
				if (!trimmed) {
					setResults(null);
					return;
				}
				const timer = setTimeout(async () => {
					setSearching(true);
					try {
						const escaped = trimmed.replace(/'/g, "''");
						const rows = await client.api("/api/query/sql", {
							stmt:
								"SELECT id, content AS name, hpath, box, updated FROM blocks WHERE type = 'd' AND (content LIKE '%" +
								escaped +
								"%' OR hpath LIKE '%" +
								escaped +
								"%') ORDER BY updated DESC LIMIT 60",
						});
						setResults(Array.isArray(rows) ? rows : []);
					} catch (err) {
						setResults({ error: err && err.message ? err.message : String(err) });
					} finally {
						setSearching(false);
					}
				}, 260);
				return () => clearTimeout(timer);
			}, [query, client]);

			const renderDocs = (notebookId, path, depth) => {
				const key = notebookId + "::" + path;
				const entry = children[key];
				if (!entry) return null;
				if (entry.status === "loading" && entry.files.length === 0) {
					return h("div", { className: "sy-hint", key: key + "-loading" }, t("loading"));
				}
				if (entry.status === "error") {
					return h("div", { className: "sy-hint", key: key + "-error" }, entry.error);
				}
				if (entry.files.length === 0) {
					return depth === 0 ? h("div", { className: "sy-hint", key: key + "-empty" }, t("noDocs")) : null;
				}
				return entry.files.map((file) => {
					const childPath = file.path;
					const hasChildren = Number(file.subFileCount) > 0;
					const isOpen = !!expanded[notebookId + "::" + childPath];
					return h(
						"div",
						{ key: childPath },
						h(
							"div",
							{
								className: "sy-tree-row",
								style: { paddingLeft: 6 + depth * 12 },
								"data-active": activeDocId === file.id ? true : undefined,
								title: file.name || t("untitled"),
								onClick: () => onOpenDoc({ id: file.id, title: file.name || t("untitled") }),
							},
							h(
								"span",
								{
									className: "sy-caret",
									"data-open": isOpen ? true : undefined,
									onClick: (event) => {
										event.stopPropagation();
										if (hasChildren) toggle(notebookId, childPath);
									},
									style: hasChildren ? undefined : { visibility: "hidden" },
								},
								CARET,
							),
							file.icon ? h("span", { className: "sy-emoji" }, emojiOf(file.icon)) : null,
							h("span", { className: "sy-tree-name" }, file.name || t("untitled")),
							hasChildren ? h("span", { className: "sy-tree-sub" }, String(file.subFileCount)) : null,
						),
						isOpen ? renderDocs(notebookId, childPath, depth + 1) : null,
					);
				});
			};

			const outline = useMemo(() => (state && state.text ? outlineOf(state.text) : []), [state && state.text]);

			return h(
				"aside",
				{ className: "sy-side" },
				h(
					"div",
					{ className: "sy-side-head" },
					h(
						"div",
						{ className: "sy-tabs", role: "tablist" },
						h("button", { type: "button", role: "tab", "data-active": tab === "docs" ? true : undefined, onClick: () => setTab("docs") }, t("docs")),
						h("button", { type: "button", role: "tab", "data-active": tab === "outline" ? true : undefined, onClick: () => setTab("outline") }, t("outline")),
					),
					h("span", { className: "sy-spacer" }),
					h(
						"button",
						{
							type: "button",
							className: "sy-iconbtn",
							title: t("refresh"),
							onClick: () => {
								requestedRef.current = new Set();
								setChildren({});
								setExpanded({});
								void loadNotebooks();
							},
						},
						"⟳",
					),
				),
				tab === "docs"
					? h(
							"div",
							{ className: "sy-search" },
							h("input", {
								type: "search",
								value: query,
								placeholder: t("search"),
								onChange: (event) => setQuery(event.target.value),
							}),
						)
					: null,
				h(
					"div",
					{ className: "sy-scroll" },
					tab === "outline"
						? outline.length === 0
							? h("div", { className: "sy-hint" }, t("outlineEmpty"))
							: outline.map((item, index) =>
									h(
										"div",
										{
											key: index,
											className: "sy-outline-row",
											style: { paddingLeft: 8 + (item.level - 1) * 12 },
											title: item.text,
											"aria-label": t("outlineJump"),
											onClick: () => {
												if (typeof onOutlineJump === "function") onOutlineJump(item.line);
											},
										},
										item.text,
									),
								)
						: results !== null
							? Array.isArray(results)
								? results.length === 0
									? h("div", { className: "sy-hint" }, searching ? t("searching") : t("noResults"))
									: results.map((row) =>
											h(
												"div",
												{
													key: row.id,
													className: "sy-tree-row",
													"data-active": activeDocId === row.id ? true : undefined,
													title: row.hpath || row.name,
													onClick: () => onOpenDoc({ id: row.id, title: row.name || t("untitled") }),
												},
												h("span", { className: "sy-caret", style: { visibility: "hidden" } }, CARET),
												h("span", { className: "sy-tree-name" }, row.name || t("untitled")),
												h("span", { className: "sy-tree-sub" }, "·"),
											),
										)
								: h("div", { className: "sy-hint" }, String(results.error ?? ""))
							: error !== null
								? h("div", { className: "sy-hint" }, error)
								: notebooks.length === 0
									? h("div", { className: "sy-hint" }, t("noNotebook"))
									: notebooks.map((notebook) => {
											const key = notebook.id + "::/";
											const isOpen = notebook.closed ? false : !!expanded[key];
											return h(
												"div",
												{ key: notebook.id },
												h(
													"div",
													{
														className: "sy-tree-row",
														onClick: () => {
															if (notebook.closed) {
																void onNotebookOpen(notebook.id);
																return;
															}
															toggle(notebook.id, "/");
														},
													},
													h("span", { className: "sy-caret", "data-open": isOpen ? true : undefined }, CARET),
													h("span", { className: "sy-emoji" }, "📚"),
													h("span", { className: "sy-tree-name" }, notebook.name || t("untitled")),
													notebook.closed ? h("span", { className: "sy-tree-sub" }, t("closedNotebook")) : null,
												),
												isOpen ? renderDocs(notebook.id, "/", 1) : null,
											);
										}),
				),
			);
		}

		/** Order entries the way the SiYuan UI does: by `sort` ascending, then by name. */
		function compareDocEntries(left, right) {
			const a = Number(left && left.sort);
			const b = Number(right && right.sort);
			if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
			return String((left && left.name) || "").localeCompare(String((right && right.name) || ""), "zh-CN");
		}

		/** SiYuan stores icons as a hex codepoint (`1f4d4`). */
		function emojiOf(icon) {
			try {
				const code = parseInt(String(icon).trim(), 16);
				if (!Number.isFinite(code) || code <= 0) return "";
				return String.fromCodePoint(code);
			} catch {
				return "";
			}
		}
		// #endregion

		// #region editor
		// 原生连接登记在稳定的标签 key 下，让父面板切换/关闭前等待真实编辑事务。
		const nativeControllers = new Map();
		function acceptNativeMessage(event, frame, session) {
			const message = event && event.data;
			return Boolean(session && frame && event.source === frame.contentWindow && event.origin === session.origin &&
				message && message.source === "dsh-siyuan-native" && message.channel === session.channel && message.docId === session.docId);
		}
		function NativeEditorPane({ doc, setDoc, client, onQuote, onCaret, onNotice, onSaved, onExit, onActivate }) {
			const frameRef = useRef(null);
			const viewportRef = useRef(null);
			const sessionRef = useRef(null);
			const stateRef = useRef({ ready: false, changed: false, error: null });
			const latest = useRef(null);
			latest.current = { doc, setDoc, onQuote, onCaret, onNotice, onSaved, onActivate };
			const [session, setSession] = useState(null);
			const [status, setStatus] = useState("正在连接思源原生编辑器…");
			const [error, setError] = useState(null);
			const requests = useRef(new Map());
			const sequence = useRef(0);
			const send = (type, extra = {}) => {
				const current = sessionRef.current;
				if (current && frameRef.current) frameRef.current.contentWindow.postMessage({ type, channel: current.channel, docId: current.docId, ...extra }, current.origin);
			};
			const flush = () => {
				if (!stateRef.current.ready) return stateRef.current.changed ? Promise.reject(new Error("原生编辑尚未就绪")) : Promise.resolve();
				const requestId = String(++sequence.current);
				return new Promise((resolve, reject) => {
					const timeout = setTimeout(() => { requests.current.delete(requestId); reject(new Error("原生保存确认超时，请留在当前文档检查")); }, 15000);
					requests.current.set(requestId, { resolve: () => { clearTimeout(timeout); resolve(); }, reject: (reason) => { clearTimeout(timeout); reject(reason); } });
					send("flush", { requestId });
				});
			};
			useEffect(() => {
				let disposed = false;
				let observer;
				let recovery;
				const positionFrame = () => {
					if (disposed || !frameRef.current || !viewportRef.current) return;
					const rect = viewportRef.current.getBoundingClientRect();
					Object.assign(frameRef.current.style, { left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px" });
				};
				const receive = (event) => {
					if (!acceptNativeMessage(event, frameRef.current, sessionRef.current)) return;
					const { type, payload = {} } = event.data;
					if (type === "flushed" || type === "flush-failed") {
						const pending = requests.current.get(payload.requestId);
						if (pending) { requests.current.delete(payload.requestId); type === "flushed" ? pending.resolve() : pending.reject(new Error(payload.message)); }
					}
					if (disposed) return;
					const current = latest.current;
					if (type === "ready") { stateRef.current.ready = true; setStatus("原生编辑 · 自动保存到思源"); }
					if (type === "login-required") { stateRef.current.login = true; setStatus("请在下方完成思源锁屏登录"); }
					if (type === "focus") current.onActivate?.();
					if (type === "context") {
						current.onCaret?.({ line: 0, totalLines: 0, blockId: payload.blockId, selection: payload.selection, view: "native" });
						if (payload.title && payload.title !== current.doc.title) current.setDoc((old) => old ? { ...old, title: payload.title } : old);
					}
					if (type === "quote") { current.onActivate?.(); current.onQuote?.(payload); }
					if (type === "dirty" || type === "saving") {
						stateRef.current.changed = true;
						current.setDoc((previous) => previous ? { ...previous, nativePending: true } : previous);
						setStatus(type === "saving" ? "正在确认原生保存…" : "正在编辑…");
					}
					if (type === "saved") {
						const changed = stateRef.current.changed;
						stateRef.current.changed = false;
						current.setDoc((previous) => previous ? { ...previous, nativePending: false, title: payload.title || previous.title } : previous);
						setStatus("原生编辑 · 已保存到思源"); if (!stateRef.current.connectionLost) setError(null);
						if (changed) current.onSaved?.(current.doc.id);
					}
					if (type === "error") { setError(payload.message || "原生编辑发生错误"); stateRef.current.error = payload.message; }
					if (type === "connection-lost") { stateRef.current.connectionLost = true; setError(payload.message); }
				};
				window.addEventListener("message", receive);
				const controller = { flush };
				nativeControllers.set(doc.key, controller);
				void callHost("/native", { action: "open", docId: doc.id, title: doc.title, parentOrigin: window.location.origin }).then((opened) => {
					if (disposed) { void callHost("/native", { action: "close", id: opened.id }).catch(() => {}); return; }
					sessionRef.current = opened; setSession(opened);
					const frame = document.createElement("iframe");
					frame.className = "sy-native-frame"; frame.title = "思源原生编辑器";
					frame.referrerPolicy = "no-referrer"; frame.allow = "clipboard-read; clipboard-write";
					frame.src = opened.url; frameRef.current = frame;
					document.body.appendChild(frame); positionFrame();
					observer = new ResizeObserver(positionFrame); observer.observe(viewportRef.current);
					window.addEventListener("resize", positionFrame); window.addEventListener("scroll", positionFrame, true);
				}).catch((failure) => { if (!disposed) setError(failure.message); });
				const timeout = setTimeout(() => { if (!stateRef.current.ready && !stateRef.current.login) setError("原生编辑器尚未加载完成，可检查连接后重试或切回 Markdown"); }, 30000);
				const heartbeat = setInterval(() => { if (sessionRef.current) void callHost("/native", { action: "touch", id: sessionRef.current.id }).catch(() => {}); }, 30000);
				const release = () => {
					clearInterval(heartbeat); window.removeEventListener("message", receive);
					frameRef.current?.remove(); recovery?.remove();
					if (nativeControllers.get(doc.key) === controller) nativeControllers.delete(doc.key);
					for (const request of requests.current.values()) request.reject(new Error("编辑页已关闭"));
					requests.current.clear();
					if (sessionRef.current) void callHost("/native", { action: "close", id: sessionRef.current.id }).catch(() => {});
				};
				const retainFailedDraft = (failure) => {
					if (!frameRef.current) { release(); return; }
					recovery = document.createElement("div");
					Object.assign(recovery.style, { position: "fixed", inset: "0 0 auto 0", height: "72px", zIndex: "2100", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", padding: "12px" });
					const label = document.createElement("span"); label.textContent = "《" + doc.title + "》保存尚未确认，文稿已保留：" + failure.message;
					const retry = document.createElement("button"); retry.textContent = "重新确认保存并关闭";
					retry.onclick = () => { retry.disabled = true; void flush().then(release).catch((error) => { label.textContent = error.message; retry.disabled = false; }); };
					const discard = document.createElement("button"); discard.textContent = "放弃未确认修改";
					discard.onclick = () => { if (window.confirm("确定放弃这份仍未确认保存的文稿并关闭吗？")) release(); };
					recovery.append(label, retry, discard); document.body.appendChild(recovery);
					Object.assign(frameRef.current.style, { visibility: "visible", left: "0", top: "72px", width: "100vw", height: "calc(100vh - 72px)", zIndex: "2099" });
				};
				return () => {
					disposed = true; clearTimeout(timeout); observer?.disconnect();
					window.removeEventListener("resize", positionFrame); window.removeEventListener("scroll", positionFrame, true);
					// iframe 独立于 React 标签树，离开面板后仍连接，待事务完成才释放。
					if (!stateRef.current.ready) { release(); return; }
					if (frameRef.current) frameRef.current.style.visibility = "hidden";
					void flush().then(release).catch(retainFailedDraft);
				};
			}, [doc.id, doc.key]);
			const leave = async () => {
				try { await flush(); await onExit(); }
				catch (failure) { setError(failure.message); }
			};
			const forgetLogin = async () => {
				try {
					await callHost("/native", { action: "forget-login" });
					setStatus("已忘记登录，下次打开原生编辑器时需重新登录");
				} catch (failure) { setError("清除登录记录失败：" + failure.message); }
			};
			return h("section", { className: "sy-main sy-native" },
				h("div", { className: "sy-toolbar" }, h("strong", null, doc.title), h("span", { className: "sy-spacer" }),
					h("button", { type: "button", className: "sy-btn", onClick: () => send("quote") }, "引用选区到对话"),
					h("button", { type: "button", className: "sy-btn", title: "清除本机记住的登录；当前文稿可以继续编辑", onClick: () => void forgetLogin() }, "忘记登录"),
					h("button", { type: "button", className: "sy-btn", onClick: () => void leave() }, "切回 Markdown")),
				h("div", { className: "sy-native-status", "data-error": error ? true : undefined, role: "status" }, error || status),
				h("div", { className: "sy-native-viewport", ref: viewportRef }, session ? null : h("div", { className: "sy-empty" }, error ? "连接未完成" : "正在准备原生编辑视图…")));
		}

		function EditorPane({ t, client, doc, setDoc, onReload, onRename, onRemove, view, setView, autoSave, setAutoSave, onNotice, stale, onSaved, indentOn, onIndentChange, onQuote, onCaret, caretRequest, onNative }) {
			const previewRef = useRef(null);
			const findRef = useRef(null);
			// Writing scrollTop fires the other column's scroll event, which would write
			// straight back; the lock breaks that loop.
			const scrollLockRef = useRef(false);
			const [findOpen, setFindOpen] = useState(false);
			const [findQuery, setFindQuery] = useState("");
			const [findIndex, setFindIndex] = useState(0);
			const docRef = useRef(doc);
			docRef.current = doc;
			/** The first-line-indent switch as of the latest render, read by the textarea's DOM listeners. */
			const indentRef = useRef(indentOn);
			indentRef.current = indentOn !== false;

			const update = useCallback(
				(next) => {
					setDoc((prev) => (prev === null ? prev : { ...prev, ...next }));
				},
				[setDoc],
			);

			// ---- 分段视图（design §9.2/§9.5 路线 A）--------------------------------
			// 编辑区不再是「整篇一个 textarea」，而是「文本段 textarea + 图片卡片」。
			// segmentsRef 是同步真值（所有偏移计算都读它），segmentsRev 只负责触发重渲染；
			// activeSegmentRef 记住光标在哪一段，applyEdit / 格式化 / 查找都从它取活动 textarea。
			const segmentsRef = useRef({ docId: null, rows: [] });
			const [segmentsRev, setSegmentsRev] = useState(0);
			const activeSegmentRef = useRef({ index: -1, ta: null });
			/** 每段 textarea 的 DOM 节点（按段序号登记），查找/滚动同步要按段的元素定位。 */
			const segmentNodesRef = useRef(new Map());
			/** 分段滚动的宿主容器（整体滚动的那一层）。 */
			const segmentsHostRef = useRef(null);
			/**
			 * 我们自己写缓冲区的记账。
			 *
			 * 「只在四个时机重算分段」要能同时容忍**外部**改缓冲区（重载按钮、保存回读、
			 * 另一栏覆盖）：只要 doc.text 与我们记账的文本不一致、而记账的版本号没被我们
			 * 自己推进过，就说明是外部改动，必须重切分，否则编辑区会显示旧内容。
			 */
			const bufferSeenRef = useRef({ docId: null, text: "", rev: 0 });
			const bufferRevRef = useRef(0);
			/** 跨段改写后的光标落点（整篇偏移），由 segmentsRev 之后的 effect 消费。 */
			const pendingCaretRef = useRef(null);
			/** 展开源码手改的那张卡片（-1 = 都收起）。放在这里是因为它必须在提前 return 之前。 */
			const [sourceIndex, setSourceIndex] = useState(-1);
			/**
			 * 外部变更闸门的状态（design §11）。
			 *
			 *   null                    正常
			 *   { reason:"external" }   磁盘与上次保存点不一致 → 暂停保存，等用户决定
			 *   { reason:"unverified" } 读不出来（网络/内核超时）→ 既不当成外部改动，也不静默写
			 *
			 * 用 ref 镜像是因为 `save()` 是 useCallback，闭包里的 state 会过期。
			 */
			const [guard, setGuard] = useState(null);
			const guardRef = useRef(null);
			guardRef.current = guard;
			/**
			 * 两个「仍要保存」是**两件事**，不要合并成一个标记（UI 上文案相似，语义完全不同）：
			 *
			 * - `overwriteOnceRef`：磁盘读得出来、但确实被外部改过。跳过的只是「外部改动」这道判断，
			 *   基线仍是**刚刚读到的磁盘块表**（所以覆盖是「以磁盘现状为基线合并本地编辑」）。
			 * - `skipCheckOnceRef`：磁盘读不出来（网络/内核超时）。跳过的是「这次检测」本身，
			 *   基线退化成面板上次已知的 `doc.blocks`（可能过期，见 save() 里的已知局限说明）。
			 *
			 * 两者都只对**紧接着的那一次**保存有效，且只由用户点击设置 —— 任何自动路径都不设。
			 */
			const overwriteOnceRef = useRef(false);
			const skipCheckOnceRef = useRef(false);

			/** 记账：这一段文本是我们自己写进去的，下一次渲染不要当成外部改动再切一遍。 */
			const markBuffer = (text) => {
				bufferRevRef.current += 1;
				bufferSeenRef.current = { docId: bufferSeenRef.current.docId, text: String(text ?? ""), rev: bufferRevRef.current };
			};

			/**
			 * 重算分段（允许的时机：文档打开 / 保存后缓冲区真的变了 / 程序化插入图片后 /
			 * 手动重排）。**文本段里打字绝不走这里** —— 那是 `commitSegment` 的增量更新。
			 */
			const resplit = useCallback((text, keepIndex) => {
				const rows = editorSegments(text);
				segmentsRef.current = { docId: segmentsRef.current.docId, rows };
				const keep = typeof keepIndex === "number" ? keepIndex : -1;
				if (keep >= 0 && keep < rows.length && rows[keep].kind === "text") {
					// 段结构没动的那一部分还能复用活动段，光标不必跳走
					activeSegmentRef.current = { index: keep, ta: activeSegmentRef.current.ta };
				} else {
					activeSegmentRef.current = { index: -1, ta: null };
				}
				markBuffer(text);
				setSegmentsRev((n) => n + 1);
			}, []);

			/**
			 * 文本段内容变化 → 整篇缓冲区（**不重切分**）。
			 *
			 * 这是「键入 `![](` 不会在下一帧跳成卡片、光标不被吃掉」的实现：段边界、
			 * 段 key、段内光标都不动，只有后面的段按长度差平移。
			 */
			const commitSegment = useCallback(
				(index, value) => {
					const rows = withSegmentText(segmentsRef.current.rows, index, value);
					const text = joinEditorSegments(rows);
					segmentsRef.current = { docId: segmentsRef.current.docId, rows };
					markBuffer(text);
					setSegmentsRev((n) => n + 1);
					update({ text, error: null });
					return rows;
				},
				[update],
			);
			/** 手动重排：把新写好的 `![…](…)` 行收成卡片（打字绝不自动收，免得吃掉光标）。 */
			const resplitNow = () => {
				const current = docRef.current;
				if (!current) return;
				resplit(current.text);
			};
			/** DOM 监听器（可能活得很久）通过 ref 取到最新的提交函数。 */
			const commitSegmentRef = useRef(commitSegment);
			commitSegmentRef.current = commitSegment;

			// 文档打开（含 loading→loaded）：首帧就切好，别先渲染一个空的编辑区。
			// 渲染期改 ref 与文件里 `docRef.current = doc` 同一套路，不是状态更新。
			if (doc && doc.id) {
				const seen = bufferSeenRef.current;
				const external = seen.docId === doc.id && doc.text !== seen.text && bufferRevRef.current === seen.rev;
				if (seen.docId !== doc.id || external) {
					const rows = editorSegments(doc.text);
					segmentsRef.current = { docId: doc.id, rows };
					activeSegmentRef.current = { index: -1, ta: null };
					bufferSeenRef.current = { docId: doc.id, text: doc.text, rev: bufferRevRef.current };
				}
			}

			/**
			 * Write the buffer back to SiYuan, block by block.
			 *
			 * `silent` is what the auto-save timer passes: it must not raise the transient
			 * note, because a note appearing and expiring every couple of seconds is part of
			 * what made the panel look like it moved on its own. A manual save still confirms,
			 * and a failure always reports.
			 *
			 * **写前闸门（design §11）**：先在读一次文档，与「上次保存点」比对。不一致就是
			 * 外部改动（AI 插图工具、思源端编辑、另一个面板），此时**一个字都不写**并进入冲突态；
			 * 因为 planSync 是「和上次读回的块比对」，不设这道闸的话外部新增的块会被当成
			 * 「多余块」删掉。读失败同样不写：既不能当外部改动误报，也不能拿空的 original
			 * 去 planSync（那会把整篇当新增、重复插入一遍）。
			 */
			const save = useCallback(async (silent) => {
				const current = docRef.current;
				if (!current || current.saving || current.loading) return;
				if (current.text === current.savedText && !current.pendingSave) {
					if (silent !== true) onNotice({ tone: "ok", text: t("saved") });
					return;
				}
				// 自动保存不许越过未处理的告警；手动保存允许重试一次检测（用户可能刚在思源里收拾好）。
				if (silent === true && (guardRef.current !== null || current.pendingSave)) return;
				const overwrite = overwriteOnceRef.current;
				const skipCheck = skipCheckOnceRef.current;
				overwriteOnceRef.current = false;
				skipCheckOnceRef.current = false;
				update({ saving: true, error: null });
				let backupFile = null;
				let writeStarted = false;
				try {
					let kramdown = "";
					let original = [];
					let baseline = current.savedText;
					try {
						const read = await readDocumentText(client, current.id);
						kramdown = read.kramdown;
						original = read.blocks;
					} catch (err) {
						const message = err && err.message ? err.message : String(err);
						// 读不出来 = 无法确认。默认不写（既不能误报成外部改动，也不能拿空的
						// original 去 planSync —— 那会把整篇当新增、重复插一遍）。
						// 只有用户明确点了「跳过检测」、而且手上还有上次已知的块表时，才带着
						// 那份基线往下写，并**留痕**（下面那条 warn）。
						//
						// 已知局限（知情接受）：`current.blocks` 是「上次成功读到的块表」，外部
						// 增删块之后它可能已经过期 —— 过期的 id 会让 updateBlock/insertBlock 被内核
						// 拒绝，从而**保存失败并报错**（响亮地失败，不会静默删错块：delete 只针对
						// 基线里存在的 id，外部新插的块不在基线里，因此永远不会被这条路径删掉）。
						// 保留这条路是因为另一头是「读失败时用户完全无法保存」——那等于逼用户丢掉
						// 正在写的整篇稿子，比一次可重试的失败更糟。前提是用户自己点了这个按钮。
						const known = Array.isArray(current.blocks) ? current.blocks : [];
						if (!skipCheck || known.length === 0 || current.pendingSave) {
							update({ saving: false });
							setGuard({ reason: current.pendingSave ? "unconfirmed" : "unverified", message });
							return;
						}
						onNotice({ tone: "warn", text: t("changeSkipped", { msg: message }) });
						original = known;
						kramdown = null;
					}
					// 上次写入可能已经落盘，只是回执丢了：先确认，绝不直接重放插入。
					if (current.pendingSave && documentUnchanged(original, current.pendingSave.text)) {
						baseline = current.pendingSave.text;
						update({ savedText: baseline, pendingSave: null, blocks: original, baselineLoaded: true });
					}
					if (!overwrite && (current.baselineLoaded === false || !documentUnchanged(original, baseline))) {
						// 有基线、且磁盘已经不是上次保存的样子 → 外部改动，停手等用户决定。
						update({ saving: false });
						setGuard({ reason: "external" });
						return;
					}
					if (kramdown !== null) {
						try {
							const receipt = await callHost("/backup", { docId: current.id, title: current.title, kramdown });
							backupFile = receipt && receipt.file ? receipt.file : null;
							if (!backupFile) throw new Error("备份接口未返回文件位置");
						} catch (error) {
							throw new Error(t("backupFailed", { msg: error && error.message ? error.message : String(error) }));
						}
					}

					const next = splitMarkdown(current.text);
					const steps = planSync(original, next);
					writeStarted = steps.some((step) => step.op !== "keep");
					if (writeStarted) update({ pendingSave: { text: current.text } });

					let previousId = null;
					for (const step of steps) {
						if (step.op === "keep") {
							previousId = step.id;
							continue;
						}
						if (step.op === "update") {
							await client.api("/api/block/updateBlock", { id: step.id, dataType: "markdown", data: step.text });
							previousId = step.id;
							continue;
						}
						if (step.op === "insert") {
							const created = previousId
								? await client.api("/api/block/insertBlock", { previousID: previousId, dataType: "markdown", data: step.text })
								: await client.api("/api/block/prependBlock", { parentID: current.id, dataType: "markdown", data: step.text });
							const newId = createdBlockId(created);
							if (!newId) throw new Error(t("saveUnconfirmed"));
							previousId = newId;
							continue;
						}
						if (step.op === "delete") {
							await client.api("/api/block/deleteBlock", { id: step.id });
						}
					}

					// The kernel's read model settles a beat after a write, so poll briefly
					// instead of reporting a false mismatch against a stale snapshot.
					//
					// 轮询只用于「读到了但内容还没收敛」；**读失败**（网络/内核超时）不重试 ——
					// 那是另一类问题，再等 5 个 250ms 既不会变好，还把保存卡住 1.25 秒（用户点了
					// 保存却半天没反应）。一次失败就收手，按「校验未完成」处理。
					let verify = null;
					let verified = [];
					for (let attempt = 0; attempt < 6; attempt++) {
						if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250));
						try {
							const after = await readDocumentText(client, current.id);
							verify = after.kramdown;
							verified = after.blocks;
						} catch {
							verify = null;
							verified = [];
							break;
						}
						if (sameTexts(verified.map((block) => block.text), next)) break;
					}
					if (verify === null || !sameTexts(verified.map((block) => block.text), next)) {
						const message = t(verify === null ? "saveUnconfirmed" : "verifyFailed");
						update({ saving: false, error: message, pendingSave: { text: current.text } });
						setGuard({ reason: "unconfirmed", message });
						onNotice({ tone: "warn", text: message });
						return;
					}
					// The buffer is never rebuilt from the read-back. The kernel's text can
					// differ from what the writer is looking at only by blank-line layout — a
					// trailing empty line has no block, two blank lines collapse into one — and
					// replacing the value is exactly what dropped the blank line the caret was
					// blinking on and snapped it back to the end of the paragraph above. So the
					// buffer keeps its shape and `savedText` names the buffer that was written;
					// a save that finishes after the next keystroke therefore cannot swallow it.
					// 只有读回确认一致，才推进保存点；未确认的写入仍留在标签状态里。
					setDoc((prev) =>
						prev === null
							? prev
							: { ...prev, savedText: current.text, saving: false, savedAt: Date.now(), error: null, blocks: verified, pendingSave: null, baselineLoaded: true },
					);
					if (typeof onSaved === "function") onSaved(current.id);
					// 写成功了：冲突态（如果有，比如用户点了「仍要保存」）到此解除。
					setGuard(null);
					if (silent !== true) onNotice({ tone: "ok", text: backupFile ? t("savedAt", { time: timeOf(Date.now()) }) : t("saved") });
				} catch (err) {
					update({ saving: false, error: err && err.message ? err.message : String(err) });
					if (writeStarted) setGuard({ reason: "unconfirmed", message: t("saveUnconfirmed") });
					onNotice({ tone: "err", text: t("saveFailed", { msg: err && err.message ? err.message : String(err) }) });
				}
			}, [client, onNotice, setDoc, t, update]);

			useEffect(() => {
				if (!autoSave) return;
				// 冲突/无法确认期间暂停自动保存：否则 2.2 秒后就把用户的决定抢走了。
				if (guard !== null) return;
				const current = docRef.current;
				if (!current || current.saving || current.pendingSave || current.text === current.savedText) return;
				const timer = setTimeout(() => void save(true), 2200);
				return () => clearTimeout(timer);
			}, [doc && doc.text, autoSave, save, doc, guard]);

			/** 冲突态处理：重新读取（丢弃本地改动，走既有重载逻辑）。 */
			const reloadAfterExternal = useCallback(() => {
				overwriteOnceRef.current = false;
				skipCheckOnceRef.current = false;
				setGuard(null);
				onReload();
			}, [onReload]);

			/**
			 * 「仍要保存」的**外部改动**分支：磁盘读得出来、只是被外部改过。
			 * 只跳过一次外部改动判断，基线是刚读到的磁盘块表 —— 绝不自动执行。
			 */
			const overwriteAfterExternal = useCallback(() => {
				overwriteOnceRef.current = true;
				skipCheckOnceRef.current = false;
				setGuard(null);
				void save();
			}, [save]);

			/**
			 * 「仍要保存」的**无法确认**分支：这次读不到磁盘，用户选择用面板已知块表硬写。
			 * 与上面那个是独立标记；`save()` 里还会再确认一次「确实有已知块表」才放行。
			 */
			const skipCheckAfterUnverified = useCallback(() => {
				skipCheckOnceRef.current = true;
				overwriteOnceRef.current = false;
				setGuard(null);
				void save();
			}, [save]);

			/** 无法确认时的「重试保存」：清掉告警再走一次完整检测。 */
			const retryAfterUnverified = useCallback(() => {
				setGuard(null);
				void save();
			}, [save]);

			// 换文档（或重载后 id/stamp 变了）时丢掉上一份文档的告警与两个一次性标记。
			useEffect(() => {
				setGuard(null);
				overwriteOnceRef.current = false;
				skipCheckOnceRef.current = false;
			}, [doc && doc.id]);

			/**
			 * Rewrite the buffer through `replaceRange`, so a toolbar click, a hotkey or
			 * an Enter rule lands as one real user edit and Ctrl+Z still walks back over it.
			 */
			const applyEdit = useCallback(
				(mutate) => {
					const current = docRef.current;
					if (!current) return;
					const rows = segmentsRef.current.rows;
					const active = activeSegmentRef.current;
					const ta = active && active.ta;
					const seg = ta ? rows[active.index] : null;
					// 整篇坐标：段内偏移 + 段起点。段内文本以 DOM 为准（刚键入的字还没走到 doc.text）。
					let value = current.text;
					let start = value.length;
					let end = value.length;
					if (ta && seg && seg.kind === "text") {
						value = current.text.slice(0, seg.start) + ta.value + current.text.slice(seg.end);
						start = seg.start + ta.selectionStart;
						end = seg.start + ta.selectionEnd;
					}
					const result = mutate(value, start, end);
					if (!result || result.text === value) return null;
					if (!ta || !seg || seg.kind !== "text") {
						// 纯预览（没有 textarea）或光标不在文本段：整篇替换 + 重切分
						update({ text: result.text });
						resplit(result.text);
						return { text: result.text, start: result.start };
					}
					const change = diffRange(value, result.text);
					if (change.start >= seg.start && change.end <= seg.end) {
						// 落在活动段内：交给 replaceRange，保住浏览器原生撤销栈（段内撤销）
						const applied = replaceRange(ta, change.start - seg.start, change.end - seg.start, change.insert, result.start - seg.start, result.end - seg.start);
						commitSegment(active.index, applied.text);
						return { text: result.text, start: result.start };
					}
					// 跨段改写（插入图片块、补齐全篇、删掉整行…）：整篇替换 + 重切分，
					// 光标交给 pendingCaretRef 在下一帧放回原处。撤销按已确认的取舍只保段内。
					update({ text: result.text });
					resplit(result.text);
					pendingCaretRef.current = { offset: result.start };
					return { text: result.text, start: result.start };
				},
				// eslint-disable-next-line react-hooks/exhaustive-deps -- 这些引用要么是 ref、要么是稳定回调
				[update, resplit, commitSegment],
			);

			/** Wrap (or unwrap) the current selection, the way a toolbar button should. */
			const wrap = (before, after, placeholder) =>
				applyEdit((value, start, end) => wrapSelection(value, start, end, before, after, placeholder));

			/** Apply or remove one inline format on the current selection. */
			const applyFormat = (action) => {
				const marks = INLINE_FORMATS[action];
				wrap(marks[0], marks[1], t(action));
			};

			/** Report where the caret sits, so the agent can be told which part is "here". */
			const reportCaret = (element, index) => {
				if (!element || typeof onCaret !== "function") return;
				const seg = segmentsRef.current.rows[index];
				// 段内行号 + 段的起始行 = 整篇行号（分段之后 textarea 只看到自己那一段）
				const base = seg ? seg.line : 0;
				const value = element.value;
				const start = element.selectionStart;
				const end = element.selectionEnd;
				const line = base + value.slice(0, start).split("\n").length;
				const selection =
					end > start
						? {
								text: value.slice(start, end).slice(0, 2000),
								startLine: line,
								endLine: base + value.slice(0, end).split("\n").length,
							}
						: null;
				const totalLines = docRef.current ? docRef.current.text.split("\n").length : value.split("\n").length;
				onCaret({ line, totalLines, selection });
			};

			/** 把光标放到某段内的某个偏移，并让这一段进入视口。 */
			const focusSegment = (index, offset, block) => {
				const node = segmentNodesRef.current.get(index);
				if (!node) return false;
				const seg = segmentsRef.current.rows[index];
				const local = Math.max(0, Math.min(node.value.length, Number(offset || 0) - (seg ? seg.start : 0)));
				node.focus();
				node.setSelectionRange(local, local);
				activeSegmentRef.current = { index, ta: node };
				if (block !== false && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
				reportCaret(node, index);
				return true;
			};

			/**
			 * Jump to a line the outline asked for, and put it in the middle of the view.
			 *
			 * 只认**新**的请求：这个 effect 现在还要跟着 segmentsRev 重跑（段结构变了要重新
			 * 定位），若不记住「已经处理过哪一个请求」，每次敲字都会把光标拽回大纲那一行。
			 */
			const caretRequestSeenRef = useRef(null);
			useEffect(() => {
				if (!caretRequest || caretRequest === caretRequestSeenRef.current) return;
				caretRequestSeenRef.current = caretRequest;
				const rows = segmentsRef.current.rows;
				if (rows.length === 0) return;
				const index = nearestTextSegment(rows, segmentIndexForLine(rows, caretRequest.line), 1);
				if (index === -1) return;
				const seg = rows[index];
				const range = lineRange(seg.text, Math.max(0, caretRequest.line - seg.line));
				focusSegment(index, seg.start + range.start, true);
				// eslint-disable-next-line react-hooks/exhaustive-deps -- segmentsRev 只是「段结构变了要重新定位」的信号
			}, [caretRequest, segmentsRev]);

			/** 跨段改写后的光标归位：放到包含该偏移的文本段（卡片段就滑到旁边的文本段）。 */
			useEffect(() => {
				const pending = pendingCaretRef.current;
				if (!pending) return;
				pendingCaretRef.current = null;
				const rows = segmentsRef.current.rows;
				if (rows.length === 0) return;
				const index = nearestTextSegment(rows, segmentIndexForOffset(rows, pending.offset), 1);
				if (index === -1) return;
				focusSegment(index, pending.offset, pending.block !== false);
			}, [segmentsRev]);

			/**
			 * Enter: continue whatever block the caret is in, or start the next paragraph.
			 *
			 * Everything is expressed as one insertion at the caret, so pressing Enter in
			 * the middle of a list item moves the tail into the new item for free.
			 */
			const handleEnterKey = (event) => {
				if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
				const ta = event.currentTarget;
				const value = ta.value;
				const start = ta.selectionStart;
				if (start !== ta.selectionEnd) return false;
				const lineStart = value.lastIndexOf("\n", start - 1) + 1;
				const lineEnd = value.indexOf("\n", start);
				const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
				// 围栏状态要看**整篇**前缀：围栏可能开在前面的段里，只看本段会误判成代码。
				const current = docRef.current;
				const seg = segmentsRef.current.rows[activeSegmentRef.current.index];
				const inFence = fenceState(((current ? current.text.slice(0, seg ? seg.start : 0) : "") + value.slice(0, start)).split("\n")).pop();
				const plan = continueOnEnter(line, { indent: indentOn, inFence });
				if (plan.exit) {
					const cleaned = stripBlockMark(line);
					if (cleaned === line) return false;
					event.preventDefault();
					applyEdit((text, caretAt) => {
						const at = caretAt - (start - lineStart);
						const next = text.slice(0, at) + cleaned + text.slice(at + line.length);
						return { text: next, start: at + cleaned.length, end: at + cleaned.length };
					});
					return true;
				}
				if (plan.kind === "none" || plan.kind === "heading") return false;
				if (!plan.prefix) return false;
				event.preventDefault();
				const insert = (plan.spaced ? "\n\n" : "\n") + plan.prefix;
				applyEdit((text, from) => ({ text: text.slice(0, from) + insert + text.slice(from), start: from + insert.length, end: from + insert.length }));
				return true;
			};

			/**
			 * Tab / Shift+Tab: indent or outdent every line the selection touches.
			 *
			 * 现在整段逻辑走 `applyEdit` 的整篇坐标：段内改动仍会落到 replaceRange（原生撤销
			 * 有效），跨段改动走整篇替换 + 重切分。
			 */
			const indentSelection = (delta) => {
				applyEdit((value, start, end) => {
					const rows = value.split("\n");
					const offsetOf = (list, index) => {
						let at = 0;
						for (let i = 0; i < index; i++) at += list[i].length + 1;
						return at;
					};
					const lineAt = (offset) => value.slice(0, offset).split("\n").length - 1;
					const from = lineAt(start);
					// A selection that ends exactly on a line start does not include that line:
					// dragging down to the beginning of the next line selects whole lines only.
					const to = end > start && value[end - 1] === "\n" ? lineAt(end) - 1 : lineAt(end);
					const result = changeIndent(rows, from, to, delta);
					const text = result.rows.join("\n");
					if (text === value) return null;
					const collapsed = start === end;
					const column = start - offsetOf(rows, from);
					const nextColumn = delta > 0 ? column + INDENT_UNIT.length : Math.max(0, column - INDENT_UNIT.length);
					const head = offsetOf(result.rows, from);
					const caret = head + Math.min(nextColumn, result.rows[from].length);
					const tail = offsetOf(result.rows, to) + result.rows[to].length;
					return { text, start: collapsed ? caret : head, end: collapsed ? caret : tail };
				});
			};

			/** Auto-close the pair for a typed opener, unless an input method is composing. */
			const pairKey = (event) => {
				if (event.key.length !== 1) return false;
				const ta = event.currentTarget;
				const rows = segmentsRef.current.rows;
				const seg = rows[activeSegmentRef.current.index];
				if (!ta || !seg || seg.kind !== "text") return false;
				const current = docRef.current;
				// 配对规则按整篇坐标算，但改动只落在本段里 → 仍走 replaceRange（撤销有效）
				const value = current ? current.text.slice(0, seg.start) + ta.value + current.text.slice(seg.end) : ta.value;
				const start = seg.start + ta.selectionStart;
				const end = seg.start + ta.selectionEnd;
				const selecting = start !== end;
				const wraps = AUTO_PAIR_KEYS.indexOf(event.key) !== -1 || (selecting && EMPHASIS_KEYS.indexOf(event.key) !== -1);
				if (!wraps) return false;
				const plan = autoPairAction(value, start, end, event.key);
				if (!plan) return false;
				event.preventDefault();
				if (plan.text === value) {
					ta.setSelectionRange(plan.start - seg.start, plan.end - seg.start);
					return true;
				}
				applyEdit(() => plan);
				return true;
			};

			// ---- 两侧滚动同步：预览顶层块带 data-line，按行号对上段 ----
			/** 段容器里第一个露头的段（按 getBoundingClientRect，不依赖 offsetParent）。 */
			const firstVisibleSegmentIndex = (host) => {
				if (!host || typeof host.getBoundingClientRect !== "function") return -1;
				const top = host.getBoundingClientRect().top;
				const rows = segmentsRef.current.rows;
				let last = -1;
				for (const [index, node] of segmentNodesRef.current) {
					if (typeof node.getBoundingClientRect !== "function") continue;
					if (node.getBoundingClientRect().bottom <= top + 1) continue; // 已经完全滚出去
					last = last === -1 ? index : Math.min(last, index);
				}
				return last === -1 ? Math.max(0, rows.length - 1) : last;
			};

			/** 预览里第一个露头的顶层块的行号（靠 data-line 锚点）。 */
			const firstVisiblePreviewLine = (article) => {
				if (!article || typeof article.querySelectorAll !== "function" || typeof article.getBoundingClientRect !== "function") return null;
				const top = article.getBoundingClientRect().top;
				for (const block of article.querySelectorAll("[data-line]")) {
					if (typeof block.getBoundingClientRect !== "function") continue;
					if (block.getBoundingClientRect().bottom <= top + 1) continue;
					const line = Number(block.dataset ? block.dataset.line : block.getAttribute("data-line"));
					if (Number.isFinite(line)) return line;
				}
				return null;
			};

			/** 编辑器 → 预览：按「第一个可见段的行号」找预览里对应的那一块。 */
			const syncEditorToPreview = (host, article) => {
				if (!host || !article || scrollLockRef.current) return;
				const index = firstVisibleSegmentIndex(host);
				const seg = segmentsRef.current.rows[index];
				const blocks = typeof article.querySelectorAll === "function" ? article.querySelectorAll("[data-line]") : [];
				if (!seg || blocks.length === 0) {
					// 没有锚点（旧内容、纯文本）：退回按比例同步，至少方向是对的
					const top = scrollSyncTop(host.scrollTop, host.scrollHeight, host.clientHeight, article.scrollHeight, article.clientHeight);
					if (Math.abs(article.scrollTop - top) >= 1) {
						scrollLockRef.current = true;
						article.scrollTop = top;
						requestAnimationFrame(() => {
							scrollLockRef.current = false;
						});
					}
					return;
				}
				let target = blocks[0];
				for (const block of blocks) {
					const line = Number(block.dataset ? block.dataset.line : block.getAttribute("data-line"));
					if (Number.isFinite(line) && line <= seg.line) target = block;
					else break;
				}
				if (typeof target.getBoundingClientRect !== "function" || typeof article.getBoundingClientRect !== "function") return;
				const top = target.getBoundingClientRect().top - article.getBoundingClientRect().top + article.scrollTop;
				if (Math.abs(article.scrollTop - top) < 1) return;
				scrollLockRef.current = true;
				article.scrollTop = Math.max(0, top);
				requestAnimationFrame(() => {
					scrollLockRef.current = false;
				});
			};

			/** 预览 → 编辑器：按「第一个可见块的行号」找到它所在的段，滚到容器里对齐。 */
			const syncPreviewToEditor = (article, host) => {
				if (!host || !article || scrollLockRef.current) return;
				const line = firstVisiblePreviewLine(article);
				const rows = segmentsRef.current.rows;
				if (line === null || rows.length === 0) return;
				const index = segmentIndexForLine(rows, line);
				const node = segmentNodesRef.current.get(index);
				if (!node || typeof node.getBoundingClientRect !== "function" || typeof host.getBoundingClientRect !== "function") return;
				const top = host.scrollTop + (node.getBoundingClientRect().top - host.getBoundingClientRect().top);
				if (Math.abs(host.scrollTop - top) < 1) return;
				scrollLockRef.current = true;
				host.scrollTop = Math.max(0, top);
				requestAnimationFrame(() => {
					scrollLockRef.current = false;
				});
			};

			/** Offsets of every occurrence of the find query in the open document. */
			const findMatches = useMemo(() => {
				const text = doc ? doc.text : "";
				if (!findQuery) return [];
				const haystack = text.toLowerCase();
				const needle = findQuery.toLowerCase();
				const out = [];
				let at = haystack.indexOf(needle);
				while (at !== -1 && out.length < 1000) {
					out.push(at);
					at = haystack.indexOf(needle, at + needle.length);
				}
				return out;
			}, [doc && doc.text, findQuery]);

			/**
			 * Select the next or previous match, wrapping around, and scroll it into view.
			 *
			 * 命中位置是整篇偏移，先映射到「段 + 段内偏移」；命中的如果是图片卡片段
			 * （比如搜 "assets"），就滑到旁边的文本段 —— 卡片里没有可放光标的地方。
			 */
			const goToMatch = (step) => {
				const matches = findMatches;
				if (matches.length === 0) return;
				const next = ((findIndex + step) % matches.length + matches.length) % matches.length;
				setFindIndex(next);
				const at = matches[next];
				const rows = segmentsRef.current.rows;
				if (rows.length === 0) return;
				const index = nearestTextSegment(rows, segmentIndexForOffset(rows, at), 1);
				if (index === -1) return;
				const node = segmentNodesRef.current.get(index);
				if (!node) return;
				const seg = rows[index];
				const local = Math.max(0, Math.min(node.value.length, at - seg.start));
				node.focus();
				node.setSelectionRange(local, Math.min(node.value.length, local + findQuery.length));
				activeSegmentRef.current = { index, ta: node };
				if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
				reportCaret(node, index);
			};

			const openFind = () => {
				setFindOpen(true);
				requestAnimationFrame(() => {
					if (!findRef.current) return;
					findRef.current.focus();
					findRef.current.select();
				});
			};

			/** One keypress, one decision: every editor shortcut runs through here. */
			const handleKeyDown = (event) => {
				// An IME owns the keyboard while composing; rewriting the buffer under it
				// would drop the characters being typed.
				if (event.isComposing || event.keyCode === 229) return;
				if (event.key === "Escape" && findOpen) {
					event.preventDefault();
					setFindOpen(false);
					return;
				}
				const action = hotkeyOf({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey });
				if (action === "save") {
					event.preventDefault();
					void save();
					return;
				}
				if (action === "toggleView") {
					event.preventDefault();
					setView(view === "preview" ? "split" : "preview");
					return;
				}
				if (action === "find") {
					event.preventDefault();
					openFind();
					return;
				}
				if (action === "indent" || action === "outdent") {
					event.preventDefault();
					indentSelection(action === "indent" ? 1 : -1);
					return;
				}
				const marks = action ? INLINE_FORMATS[action] : null;
				if (marks) {
					event.preventDefault();
					applyFormat(action);
					return;
				}
				if (event.key === "Enter" && !event.isComposing && handleEnterKey(event)) return;
				if (!event.ctrlKey && !event.metaKey && !event.altKey) pairKey(event);
			};

			/**
			 * Hand the highlighted text to the composer.
			 *
			 * The panel shows the source and the rendered preview side by side, and people
			 * select in whichever one they are reading. A textarea keeps its own selection
			 * that the DOM knows nothing about, and vice versa — so we ask the focused
			 * element which kind of selection it is instead of assuming the textarea.
			 */
			/**
			 * Selection action bar state: where to float it and what it would quote.
			 * Capturing the payload at selection time (rather than on click) means the
			 * quote survives focus moving to the bar itself.
			 */
			const [selectionBar, setSelectionBar] = useState(null);

			/** The selected text of the source editor, if any. */
			const textareaSelection = () => {
				const active = activeSegmentRef.current;
				const textarea = active ? active.ta : null;
				if (!textarea) return null;
				const start = textarea.selectionStart;
				const end = textarea.selectionEnd;
				if (end <= start) return null;
				const text = textarea.value.slice(start, end);
				if (!text.trim()) return null;
				const seg = segmentsRef.current.rows[active.index];
				// 行号要按整篇报（段的起始行 + 段内行号）
				const line = (seg ? seg.line : 0) + textarea.value.slice(0, start).split("\n").length;
				return { source: "textarea", text: text.trim(), line };
			};

			/** The selected text of the rendered preview, if any. */
			const previewSelection = () => {
				const selection = typeof window !== "undefined" && typeof window.getSelection === "function" ? window.getSelection() : null;
				if (selection === null || selection.isCollapsed) return null;
				const text = String(selection.toString());
				if (!text.trim()) return null;
				const current = docRef.current;
				return { source: "preview", text: text.trim(), line: locateQuote(current ? current.text : "", text) };
			};

			/** Float the bar above the pointer; without pointer coordinates, over the pane. */
			const showSelectionBar = (event, hit) => {
				if (hit === null) {
					setSelectionBar(null);
					return;
				}
				const hasPoint = event !== undefined && event !== null && typeof event.clientX === "number" && typeof event.clientY === "number";
				setSelectionBar({
					...hit,
					x: hasPoint ? event.clientX : null,
					y: hasPoint ? event.clientY : null,
				});
			};

			const hideSelectionBar = () => setSelectionBar(null);

			const selectionBarStyle =
				selectionBar === null
					? undefined
					: selectionBarPosition(
							selectionBar.x === null ? null : { x: selectionBar.x, y: selectionBar.y },
							typeof window !== "undefined" ? window.innerWidth : 0,
							activeSegmentRef.current.ta && typeof activeSegmentRef.current.ta.getBoundingClientRect === "function"
								? activeSegmentRef.current.ta.getBoundingClientRect()
								: null,
						);

			/**
			 * The bar that floats next to a selection.
			 *
			 * SiYuan pops an inline-format toolbar there. The source editor can do the
			 * same because the marks are just characters: the buttons wrap the selection.
			 * A selection in the rendered preview has no source range, so it only offers
			 * the quote action.
			 */
			const selectionBarNode =
				selectionBar === null
					? null
					: h(
							"div",
							{ className: "sy-selbar", style: selectionBarStyle, onMouseDown: (event) => event.preventDefault() },
							selectionBar.source === "textarea"
								? INLINE_ORDER.map((action) =>
										h(
											"button",
											{
												key: action,
												type: "button",
												title: t(action),
												onClick: () => {
													hideSelectionBar();
													applyFormat(action);
												},
											},
											INLINE_GLYPHS[action],
										),
									)
								: null,
							selectionBar.source === "textarea" ? h("span", { className: "sy-div" }) : null,
							h(
								"button",
								{
									type: "button",
									title: t("quoteSelectedHint"),
									onClick: () => {
										const payload = { title: docRef.current ? docRef.current.title : "", text: selectionBar.text, line: selectionBar.line };
										hideSelectionBar();
										void onQuote(payload);
									},
								},
								"❝ " + t("quoteSelected"),
							),
						);


			/**
			 * The switch: future paragraphs, and the document kept in step with it.
			 *
			 * Turning it on indents what is already written (that is what the tooltip
			 * promises); turning it off removes the indents. A switch that is already on
			 * and a document that has nothing to indent means the click has nothing to
			 * do — say so instead of looking dead.
			 */
			const toggleIndent = () => {
				const next = !indentOn;
				onIndentChange(next);
				const current = docRef.current;
				if (!current) return;
				const bare = bareParagraphLines(current.text).length;
				if (current.text === "" && current.savedText === "") return;
				const rewritten = next ? indentParagraphs(current.text) : unindentParagraphs(current.text);
				if (rewritten === current.text) {
					onNotice({ tone: "ok", text: next ? t("indentAlreadyOn") : t("indentAlreadyOff") });
					return;
				}
				applyEdit((value, start) => {
					const indented = next ? indentParagraphs(value) : unindentParagraphs(value);
					const mapped = caretAfterIndent(value, indented, start);
					return { text: indented, start: mapped, end: mapped };
				});
				onNotice({ tone: "ok", text: next ? t("indentAppliedCount", { n: bare }) : t("indentRemoved") });
			};

			/**
			 * The action button that sits next to the switch while some paragraph still
			 * lacks the indent. It is a separate control on purpose: a checkbox-shaped
			 * switch that silently rewrote the whole document would be a trap.
			 */
			const applyIndentAll = () => {
				const current = docRef.current;
				if (!current) return;
				const bare = bareParagraphLines(current.text).length;
				onIndentChange(true);
				if (bare === 0) {
					onNotice({ tone: "ok", text: t("indentAlreadyOn") });
					return;
				}
				applyEdit((value, start) => {
					const indented = indentParagraphs(value);
					const mapped = caretAfterIndent(value, indented, start);
					return { text: indented, start: mapped, end: mapped };
				});
				onNotice({ tone: "ok", text: t("indentAppliedCount", { n: bare }) });
			};

			const prefixLines = (prefix) =>
				applyEdit((value, start, end) => {
					const lineStart = value.lastIndexOf("\n", start - 1) + 1;
					let lineEnd = value.indexOf("\n", end);
					if (lineEnd === -1) lineEnd = value.length;
					const block = value.slice(lineStart, lineEnd);
					const rows = block.split("\n");
					const allPrefixed = rows.every((row) => !row.trim() || row.startsWith(prefix));
					const nextRows = rows.map((row) => {
						if (!row.trim()) return row;
						if (allPrefixed) return row.slice(prefix.length);
						return prefix + row;
					});
					const replacement = nextRows.join("\n");
					const text = value.slice(0, lineStart) + replacement + value.slice(lineEnd);
					return { text, start: lineStart, end: lineStart + replacement.length };
				});

			const insertBlock = (snippet) => {
				const applied = applyEdit((value, start, end) => {
					const needsLeading = start > 0 && value[start - 1] !== "\n";
					const needsTrailing = value[end] !== "\n" && end < value.length;
					const insert = (needsLeading ? "\n\n" : start === 0 ? "" : "") + snippet + (needsTrailing ? "\n\n" : "\n\n");
					const text = value.slice(0, start) + insert + value.slice(end);
					const caret = start + insert.length - 2;
					return { text, start: caret, end: caret };
				});
				// 插图主路径：插完**立刻**成卡片。
				// 插在活动段内部时 applyEdit 走的是 replaceRange（不重切分），用户会看到一条
				// `![名字](assets/…)` 源码行 + 一个「收成卡片」按钮 —— 刚点完图片按钮还要再点一次
				// 才能看见图，说不过去。所以这里显式重切分，并把光标定位到新卡片之后的文本段。
				if (!applied || !imageLineOf(String(snippet).trim())) return;
				resplit(applied.text);
				pendingCaretRef.current = { offset: applied.start };
			};

			// ---- 图片上传（工具栏 / 粘贴 / 拖拽三个入口共用这一条路） ----------------
			/**
			 * 串行队列：所有来源都排进同一条 promise 链，同一时刻只跑一个上传，插入顺序与
			 * 用户操作顺序一致。后到的排队而不是被丢掉，所以连着粘三张截图不会少一张。
			 */
			const uploadQueueRef = useRef(Promise.resolve());
			const uploadActiveRef = useRef(true);
			useEffect(() => {
				uploadActiveRef.current = true;
				return () => { uploadActiveRef.current = false; };
			}, []);
			/** 还在排队的批次数，>0 时按钮置忙并显示「上传中…」。 */
			const [uploadPending, setUploadPending] = useState(0);
			/** 选文件的隐藏 input，由工具栏按钮点开；随面板一起卸载，分屏多栏各持一份。 */
			const fileInputRef = useRef(null);

			/** 上传一批图片并逐张插入。失败只提示，缓冲区与撤销栈保持不动。 */
			const uploadImages = async (images, target) => {
				const isCurrent = () => uploadActiveRef.current && docRef.current?.id === target.id && docRef.current?.key === target.key;
				if (images.some((file) => file.size > MAX_UPLOAD_BYTES)) onNotice({ tone: "err", text: t("uploadTooLarge") });
				for (const file of images) {
					if (!isCurrent()) { onNotice({ tone: "warn", text: t("uploadCancelled") }); return; }
					// 前置拦截：超限的图不发请求，也不影响同批次里其它图。
					if (file.size > MAX_UPLOAD_BYTES) continue;
					try {
						const relPath = await client.uploadAsset(file);
						if (!isCurrent()) { onNotice({ tone: "warn", text: t("uploadCancelled") }); return; }
						insertBlock("![" + filenameToAlt(file.name) + "](" + relPath + ")");
					} catch (error) {
						const msg = error && error.message ? error.message : String(error);
						onNotice({ tone: "err", text: t("uploadFailed", { msg }) });
					}
				}
			};

			/** 只认图片文件；其它文件（以及拖动选中的文字）都不属于这里。 */
			const imageFilesOf = (list) => Array.from(list || []).filter((file) => file && /^image\//i.test(file.type || ""));

			const queueUpload = (files) => {
				const images = imageFilesOf(files);
				const target = docRef.current;
				if (images.length === 0 || !target || !uploadActiveRef.current) return;
				setUploadPending((n) => n + 1);
				uploadQueueRef.current = uploadQueueRef.current
					.then(() => uploadImages(images, { id: target.id, key: target.key }))
					.catch(() => {})
					.finally(() => { if (uploadActiveRef.current) setUploadPending((n) => n - 1); });
			};
			/** textarea 的 DOM 监听器挂在 effect 里，用 ref 取到最新那份闭包（含当前语言的 t）。 */
			const queueUploadRef = useRef(queueUpload);
			queueUploadRef.current = queueUpload;

			const pickImage = () => {
				const input = fileInputRef.current;
				if (!input) return;
				input.value = ""; // 复位一下，连着选同一个文件也能再次触发 change
				input.click();
			};

			// 预览带 data-line 锚点：分段视图的滚动同步靠它把「预览的哪一块」对上「源文哪一行」。
			const previewHtml = useMemo(() => markdownToHtml(doc ? doc.text : "", { lineAnchors: true }), [doc && doc.text]);

			/**
			 * 预览里的图片加载失败时统一降级。
			 *
			 * 预览是 `dangerouslySetInnerHTML` 渲染出来的字符串，写不了内联 onerror（也不该写），
			 * 所以在每次渲染后扫一遍 `<img>` 绑监听：失败的图挂上 `data-broken`（CSS 收起来），
			 * 并在它后面插一条「图未找到」占位 —— alt 文字保留在占位里，不弹窗、不刷控制台。
			 * 图片 URL 一换，React 会整段重写 innerHTML，下一轮 effect 自然重新绑定。
			 */
			useEffect(() => {
				const host = previewRef.current;
				if (!host) return undefined;
				const bound = [];
				const markBroken = (img) => {
					if (img.dataset.broken === "true") return;
					img.dataset.broken = "true";
					img.setAttribute("title", t("imageBroken"));
					const alt = img.getAttribute("alt") || "";
					const label = document.createElement("span");
					label.className = "sy-imgbroken";
					label.textContent = "🖼 " + t("imageBroken") + (alt ? " · " + alt : "");
					if (img.parentNode) img.parentNode.insertBefore(label, img.nextSibling);
				};
				for (const img of host.querySelectorAll("img")) {
					if (img.dataset.bound === "true") continue;
					img.dataset.bound = "true";
					const onError = () => markBroken(img);
					img.addEventListener("error", onError);
					bound.push({ img, onError });
					// 缓存里已记着失败（complete 但没有像素）的图不会再触发 error，这里补一刀。
					if (img.complete && img.naturalWidth === 0) markBroken(img);
				}
				return () => {
					for (const row of bound) {
						row.img.removeEventListener("error", row.onError);
						// 标记也要清掉：下一轮 effect 可能是同一批 DOM 节点（比如只有 t 变了），
						// 留着标记就会跳过重绑，那张图的失败再也没人接。
						delete row.img.dataset.bound;
					}
				};
			}, [previewHtml, view, t]);
			const indentClass = indentOn ? "sy-preview sy-indent" : "sy-preview";
			const dirty = doc ? doc.text !== doc.savedText || Boolean(doc.pendingSave) : false;
			const charCount = countText(doc ? doc.text : "");
			/** True while a counted edit is in flight, so `input` knows whether to record it. */
			const pendingInputRef = useRef(false);
			/**
			 * Typing-speed meter for THIS column.
			 *
			 * Each column is a separate place to write, so it gets its own meter: typing in one
			 * column must not inflate the other column's figure.
			 */
			const meterRef = useRef(null);
			if (meterRef.current === null) meterRef.current = typingMeter();
			/** Characters per minute, refreshed once a second so an idle pause visibly decays. */
			const [typingRate, setTypingRate] = useState(0);

			/**
			 * Record net characters for real keystrokes only.
			 *
			 * `beforeinput` carries the `inputType`, which is the only reliable way to tell typing
			 * apart from a paste or from the toolbar rewriting the buffer. The character delta is
			 * measured from the buffer before and after the edit, so deletions reduce the rate.
			 */
			/**
			 * 把一个文本段的监听挂上（首行缩进 / 打字计量 / 输入法 / 粘贴 / 高度自适应），
			 * 返回卸载函数。
			 *
			 * 分段之后每个文本段都有自己的 textarea，所以这里是**逐段挂卸**。监听里只碰 ref
			 * （indentRef / meterRef / commitSegmentRef / queueUploadRef），因此这份闭包长期有效，
			 * 不会因为重渲染而过期。
			 */
			const attachTextarea = useCallback((ta, index) => {
				if (!ta) return () => {};
				// The whole buffer, not just its length: the first-line-indent rule has to know
				// whether the caret's line was blank before this edit.
				let beforeText = ta.value;
				let beforeKind = "";
				let composedFrom = null;
				/** Guards the nested input event that our own indent write fires. */
				let indenting = false;
				/** 段高随内容长：整篇滚动交给外层容器，textarea 自己不出滚动条。 */
				const grow = () => {
					if (typeof ta.scrollHeight !== "number" || typeof ta.style === "undefined") return;
					ta.style.height = "auto";
					// textarea 会把**段尾的换行**显示成空行；分段之后每段末尾几乎总有换行
					// （块与块之间用 "\n\n" 连接），不裁掉的话图片卡片正上方会凭空多出 1–2 行
					// 空白 —— 用户看到的就是"图片上面一大片空白"。
					// 裁掉的只是视觉高度：内容与光标仍然完整（overflow:hidden 只是不显示多余空行）。
					const trailing = (String(ta.value).match(/\n+$/) || [""])[0].length;
					let lineHeight = 0;
					try {
						lineHeight = Number.parseFloat(getComputedStyle(ta).lineHeight) || 0;
					} catch {
						lineHeight = 0;
					}
					const trim = lineHeight > 0 ? trailing * lineHeight : 0;
					const height = trim > 0 ? Math.max(lineHeight, ta.scrollHeight - trim) : ta.scrollHeight;
					ta.style.height = height + "px";
				};
				// 宽度一变（分屏 ↔ 单栏、面板拖动、窗口缩放），同样的文字会换成不同行数，
				// scrollHeight 也随之变化。只在挂载时算一次的话，会留下大片空白或把文字裁掉。
				/** @type {ResizeObserver | null} */
				let widthObserver = null;
				if (typeof ResizeObserver === "function") {
					let lastWidth = -1;
					widthObserver = new ResizeObserver((entries) => {
						const width = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : -1;
						if (width === lastWidth) return;
						lastWidth = width;
						grow();
					});
					widthObserver.observe(ta);
				}
				const onBeforeInput = (event) => {
					beforeText = ta.value;
					beforeKind = event.inputType;
					// Remember whether this edit counts; the buffer is only measurable afterwards.
					pendingInputRef.current = !suppressTypingCount && isTypingInput(event.inputType);
				};
				/**
				 * Give a freshly typed paragraph its first-line indent.
				 *
				 * Runs inside the browser's own input event so the indent lands as one real edit
				 * (undo covers it) before React renders the value back into the textarea. Returns
				 * the characters it inserted, so the meter can leave them out of the rate.
				 */
				const indentTyped = (base, kind, composing) => {
					// `indenting` stops the nested input event of our own write from recursing;
					// `suppressTypingCount` is raised around that write by `replaceRange`.
					if (indenting || suppressTypingCount) return 0;
					if (!indentRef.current) return 0;
					indenting = true;
					try {
						// React's change listener is attached at the root, so this element-level
						// listener runs first: the indent lands before React renders the value back.
						const inserted = autoIndentTextarea(ta, base, { indent: true, kind, composing });
						// 写回的是「这一段」，不是整篇：缓冲区在 commitSegment 里重组。
						if (inserted > 0) commitSegmentRef.current(index, ta.value);
						return inserted;
					} finally {
						indenting = false;
					}
				};
				const onInput = (event) => {
					const counts = pendingInputRef.current;
					pendingInputRef.current = false;
					const previous = beforeText;
					const kind = beforeKind;
					// An input method owns the buffer while it composes; indenting then would fight
					// the candidate window, so that path waits for `compositionend`.
					const inserted = indentTyped(previous, kind, event.isComposing);
					grow();
					if (!counts) return;
					const delta = ta.value.length - previous.length - inserted;
					if (delta !== 0) meterRef.current.add(delta);
				};
				const onCompositionStart = () => {
					composedFrom = ta.value;
				};
				/**
				 * Committing a Chinese candidate replaces the composing text while the buffer still
				 * reports `isComposing`, so the indent is applied once the input method let go.
				 */
				const onCompositionEnd = () => {
					const base = composedFrom === null ? ta.value : composedFrom;
					composedFrom = null;
					grow();
					if (!indentRef.current) return;
					setTimeout(() => indentTyped(base, "insertReplacementText", false), 0);
				};
				/**
				 * 粘贴：只有剪贴板里真的带图片文件时才接管（粘截图是最高频的插图路径）。
				 * 纯文本粘贴一律不拦，浏览器的默认行为与原生撤销栈原样保留。
				 */
				const onPaste = (event) => {
					const data = event.clipboardData;
					if (!data) return;
					const files = [];
					for (const item of data.items || []) {
						if (item.kind !== "file" || !/^image\//i.test(item.type || "")) continue;
						const file = item.getAsFile();
						if (file) files.push(file);
					}
					// 有些浏览器只把截图放在 files 里，items 是空的。
					if (files.length === 0) {
						for (const file of data.files || []) if (/^image\//i.test(file.type || "")) files.push(file);
					}
					if (files.length === 0) return;
					event.preventDefault();
					queueUploadRef.current(files);
				};
				/** 记下这一段的焦点，applyEdit / 格式化 / 查找都以它为「当前光标所在段」。 */
				const onFocus = () => {
					activeSegmentRef.current = { index, ta };
				};
				ta.addEventListener("beforeinput", onBeforeInput);
				ta.addEventListener("input", onInput);
				ta.addEventListener("compositionstart", onCompositionStart);
				ta.addEventListener("compositionend", onCompositionEnd);
				ta.addEventListener("paste", onPaste);
				ta.addEventListener("focus", onFocus);
				grow();
				return () => {
					ta.removeEventListener("beforeinput", onBeforeInput);
					ta.removeEventListener("input", onInput);
					ta.removeEventListener("compositionstart", onCompositionStart);
					ta.removeEventListener("compositionend", onCompositionEnd);
					ta.removeEventListener("paste", onPaste);
					ta.removeEventListener("focus", onFocus);
					if (widthObserver !== null) {
						widthObserver.disconnect();
						widthObserver = null;
					}
				};
			}, []);

			/**
			 * 逐段挂监听：每段给一个**稳定**的 ref 回调（按段序号缓存），
			 * 于是节点挂上时装监听、卸载时清掉，普通重渲染不会反复挂卸。
			 */
			const segmentCleanupsRef = useRef(new Map());
			const segmentRefCallbacks = useRef(new Map());
			const segmentNodeRef = (index) => {
				const cache = segmentRefCallbacks.current;
				if (!cache.has(index)) {
					cache.set(index, (node) => {
						const previous = segmentCleanupsRef.current.get(index);
						if (previous) {
							previous();
							segmentCleanupsRef.current.delete(index);
						}
						if (!node) {
							segmentNodesRef.current.delete(index);
							return;
						}
						segmentNodesRef.current.set(index, node);
						segmentCleanupsRef.current.set(index, attachTextarea(node, index));
					});
				}
				return cache.get(index);
			};
			/** 整个面板卸载时兜底清理（正常路径由 ref 回调的 null 分支负责）。 */
			useEffect(
				() => () => {
					for (const off of segmentCleanupsRef.current.values()) off();
					segmentCleanupsRef.current.clear();
				},
				[],
			);

			/**
			 * Refresh the displayed rate once a second.
			 *
			 * The meter is time-based, so nothing changes the value on its own while the user is
			 * idle; a tick is what makes the number fall back to zero after a pause.
			 */
			useEffect(() => {
				const timer = setInterval(() => setTypingRate(meterRef.current.rate()), 1000);
				return () => clearInterval(timer);
			}, []);

			/** "3/17": which match the caret is on, and how many there are. */
			const findLabel = findQuery ? (findMatches.length === 0 ? t("findNone") : t("findCount", { n: Math.min(findIndex, findMatches.length - 1) + 1, total: findMatches.length })) : "";

			/** In-document find: Ctrl+F opens it, Enter / Shift+Enter walk the matches. */
			const findBar =
				!findOpen || view === "preview"
					? null
					: h(
							"div",
							{ className: "sy-findbar" },
							h("input", {
								ref: findRef,
								type: "search",
								value: findQuery,
								placeholder: t("findPlaceholder"),
								"aria-label": t("find"),
								onChange: (event) => {
									setFindQuery(event.target.value);
									setFindIndex(0);
								},
								onKeyDown: (event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										setFindOpen(false);
										return;
									}
									if (event.key === "Enter") {
										event.preventDefault();
										goToMatch(event.shiftKey ? -1 : 1);
									}
								},
							}),
							h("span", { className: "sy-findcount" }, findLabel),
							h("button", { type: "button", className: "sy-iconbtn", title: t("findPrev"), onClick: () => goToMatch(-1) }, "↑"),
							h("button", { type: "button", className: "sy-iconbtn", title: t("findNext"), onClick: () => goToMatch(1) }, "↓"),
							h("button", { type: "button", className: "sy-iconbtn", title: t("close"), onClick: () => setFindOpen(false) }, "✕"),
						);

			if (!doc || !doc.id) {
				return h(
					"section",
					{ className: "sy-main" },
					h(
						"div",
						{ className: "sy-empty" },
						h("strong", null, t("paneEmpty")),
						h("span", null, t("paneEmptyHint")),
					),
				);
			}
			if (doc.loading) {
				return h("section", { className: "sy-main" }, h("div", { className: "sy-empty" }, t("loading")));
			}

			/** Paragraphs still missing the first-line indent; gates the sweep button. */
			const indentBare = doc ? bareParagraphLines(doc.text).length : 0;
			/** 只统计能收成卡片的图片，代码里的示例不应一直触发「重排」。 */
			const imageCards = segmentsRef.current.rows.filter((row) => row.kind === "image").length;
			const canResplit = splitEditorSegments(doc.text).filter((row) => row.kind === "image").length > imageCards;
			/** 图片段的换行原样保留：重组必须逐字节，别把 CRLF 写成 LF。 */
			const eolOf = (syntax) => {
				const text = String(syntax ?? "");
				if (text.endsWith("\r\n")) return "\r\n";
				return text.endsWith("\n") ? "\n" : "";
			};

			/** 改写第 index 个图片段（整篇替换 + 重切分：卡片立刻反映新宽度/新说明）。 */
			const rewriteImage = (index, syntax) => {
				const current = docRef.current;
				const rows = segmentsRef.current.rows;
				const segment = rows[index];
				if (!current || !segment || segment.kind !== "image") return;
				const text = replaceSegmentText(current.text, rows, index, syntax);
				update({ text });
				resplit(text, index);
			};

			const imageWidthOf = (segment) => (segment && segment.kind === "image" ? parseImageIal(segment.ial).width : null);

			/** 改说明：写回 `![alt](path)`，`]` 与换行照旧要转义。 */
			const setImageAlt = (index, rawAlt) => {
				const segment = segmentsRef.current.rows[index];
				if (!segment) return;
				const alt = String(rawAlt ?? "")
					.replace(/[\r\n]+/g, " ")
					.replace(/\\/g, "\\\\")
					.replace(/[\[\]]/g, "\\$&")
					.trim();
				if (alt === segment.alt) return; // 未改说明时保留原标题、IAL 和换行，不重写源码。
				rewriteImage(index, imageSyntaxWithWidth(segment.assetPath, alt, imageWidthOf(segment)) + eolOf(segment.syntax));
			};

			/** 宽度预设：写回 `{: style="width: …" }`；「原始」= 去掉 IAL。 */
			const setImageWidth = (index, width) => {
				const segment = segmentsRef.current.rows[index];
				if (!segment) return;
				rewriteImage(index, imageSyntaxWithWidth(segment.assetPath, segment.alt, width) + eolOf(segment.syntax));
			};

			/** 删除该图：整行（含它的换行）拿掉，光标落到原位置。 */
			const removeImage = (index) => {
				const current = docRef.current;
				const rows = segmentsRef.current.rows;
				const segment = rows[index];
				if (!current || !segment) return;
				const text = replaceSegmentText(current.text, rows, index, "");
				update({ text });
				resplit(text);
				pendingCaretRef.current = { offset: segment.start };
			};

			/** 一张图片卡片：缩略图（点击新标签打开原图）+ 文件名/行号 + 操作条。 */
			const imageCard = (segment, index) =>
				h(
					"div",
					{ className: "sy-imgcard", key: "seg-" + index, "data-seg": index },
					h(
						"div",
						{ className: "sy-imgcard-head" },
						h("span", { className: "sy-imgcard-name", title: segment.assetPath }, assetDisplayName(segment.assetPath)),
						h("span", { className: "sy-imgcard-line" }, t("imageLine", { n: segment.line + 1 })),
					),
					h(
						"div",
						{ className: "sy-imgcard-shot", key: segment.assetPath },
						h("img", {
							className: "sy-imgcard-img",
							src: assetPreviewUrl(segment.assetPath),
							alt: imageAltText(segment.alt),
							loading: "lazy",
							decoding: "async",
							title: t("imageOpen"),
							onError: (event) => { event.currentTarget.parentElement.dataset.broken = "true"; },
							onLoad: (event) => { delete event.currentTarget.parentElement.dataset.broken; },
							onClick: () => {
								if (typeof window !== "undefined" && typeof window.open === "function") window.open(assetPreviewUrl(segment.assetPath), "_blank", "noopener");
							},
						}),
						// 默认隐藏；只有本卡片收到加载失败事件才显示，成功加载后恢复。
						h("div", { className: "sy-imgcard-broken" }, "🖼 " + t("imageBroken") + (segment.alt ? " · " + imageAltText(segment.alt) : "")),
					),
					h(
						"div",
						{ className: "sy-imgcard-actions" },
						h("input", {
							key: "seg-" + index + "-alt",
							className: "sy-imgcard-alt",
							defaultValue: imageAltText(segment.alt),
							placeholder: t("imageAlt"),
							"aria-label": t("imageAlt"),
							onBlur: (event) => setImageAlt(index, event.target.value),
							onKeyDown: (event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								event.currentTarget.blur();
							},
						}),
						h("span", { className: "sy-imgcard-label" }, t("imageWidth")),
						IMAGE_WIDTH_PRESETS.map((preset) =>
							h(
								"button",
								{
									key: preset.key,
									type: "button",
									className: "sy-mem-btn",
									"data-on": imageWidthOf(segment) === preset.width ? true : undefined,
									onClick: () => setImageWidth(index, preset.width),
								},
								t(preset.label),
							),
						),
						h("button", { type: "button", className: "sy-mem-btn", onClick: () => removeImage(index) }, t("imageDelete")),
						h(
							"button",
							{
								type: "button",
								className: "sy-mem-btn",
								"data-on": sourceIndex === index ? true : undefined,
								onClick: () => setSourceIndex((prev) => (prev === index ? -1 : index)),
							},
							sourceIndex === index ? t("imageSourceHide") : t("imageSource"),
						),
					),
					sourceIndex === index
						? h("textarea", {
								key: "seg-" + index + "-src",
								className: "sy-imgcard-src",
								defaultValue: segment.syntax,
								spellCheck: false,
								"aria-label": t("imageSource"),
								onBlur: (event) => {
									const value = event.target.value;
									// 手改源码也允许写多行：提交后按新内容重排
									rewriteImage(index, segment.syntax.endsWith("\n") && !value.endsWith("\n") ? value + eolOf(segment.syntax) : value);
								},
							})
						: null,
				);

			/** 一个文本段：textarea 按内容长高；整篇滚动交给外层容器。 */
			const textSegment = (segment, index) =>
				h("textarea", {
					key: "seg-" + index,
					ref: segmentNodeRef(index),
					className: "sy-seg-text",
					"data-seg": index,
					"aria-label": t("placeholder"),
					spellCheck: false,
					placeholder: index === 0 ? t("placeholder") : undefined,
					value: segment.text,
					onChange: (event) => commitSegment(index, event.target.value),
					onFocus: () => {
						activeSegmentRef.current = { index, ta: segmentNodesRef.current.get(index) || null };
					},
					onSelect: (event) => reportCaret(event.currentTarget, index),
					onKeyUp: (event) => {
						reportCaret(event.currentTarget, index);
						const hit = textareaSelection();
						if (hit !== null) showSelectionBar(event, hit);
						else if (event.key === "Escape") hideSelectionBar();
					},
					onClick: (event) => reportCaret(event.currentTarget, index),
					onMouseUp: (event) => showSelectionBar(event, textareaSelection()),
					onMouseDown: () => hideSelectionBar(),
					onKeyDown: handleKeyDown,
				});


			const toolbar = h(
				"div",
				{ className: "sy-toolbar" },
				h("span", { className: "sy-doc-title", title: doc.title }, doc.title || t("untitled")),
				h(
					"span",
					{ className: "sy-row", style: { gap: 4 } },
					h(
						"button",
						{ type: "button", className: "sy-btn", "data-tone": "accent", disabled: doc.saving || !dirty, onClick: () => void save() },
						// The label keeps its slot: inside this wrapping toolbar a wider "保存中…" could
						// push a following button onto a new row, which moves the editor while it saves.
						h("span", { className: "sy-btn-label" }, doc.saving ? t("saving") : t("save")),
					),
					h(
						"button",
						{ type: "button", className: "sy-btn", onClick: onReload, title: t("reloadHint") },
						t("reload"),
					),
				),
				h("span", { className: "sy-spacer" }),
				h(
					"div",
					{ className: "sy-tabs", role: "tablist", style: { marginRight: 6 } },
					h("button", { type: "button", role: "tab", "data-active": view === "edit" ? true : undefined, onClick: () => setView("edit") }, t("edit")),
					h("button", { type: "button", role: "tab", "data-active": view === "split" ? true : undefined, onClick: () => setView("split") }, t("split")),
					h("button", { type: "button", role: "tab", "data-active": view === "preview" ? true : undefined, onClick: () => setView("preview") }, t("preview")),
				),
				onNative ? h("button", { type: "button", className: "sy-btn", disabled: doc.saving || dirty || Boolean(doc.pendingSave), title: "先保存当前修改，再试用思源原生编辑器", onClick: onNative }, "原生编辑（试用）") : null,
				h(
					"label",
					{ className: "sy-check", title: t("autoSave") },
					h("input", { type: "checkbox", checked: autoSave, onChange: (event) => setAutoSave(event.target.checked) }),
					t("autoSave"),
				),
				h(
					"button",
					{
						type: "button",
						className: "sy-btn",
						"data-tone": "ghost",
						"data-active": indentOn ? true : undefined,
						title: t("indentHint"),
						onClick: toggleIndent,
					},
					(indentOn ? "✓ " : "") + t("indent"),
					// Only offered while it would do something: a one-click sweep over the
					// paragraphs that still lack the indent, next to the switch that governs
					// future paragraphs.
					indentBare > 0
						? h(
								"button",
								{
									type: "button",
									className: "sy-btn",
									"data-tone": "ghost",
									title: t("indentFillHint"),
									onClick: applyIndentAll,
								},
								t("indentFill", { n: indentBare }),
							)
						: null,
				),

				h("span", { className: "sy-div" }),
				h("button", { type: "button", className: "sy-btn", "data-tone": "ghost", onClick: onRename }, t("rename")),
				h("button", { type: "button", className: "sy-btn", "data-tone": "ghost", onClick: onRemove }, t("remove")),
			);

			const formatBar = h(
				"div",
				{ className: "sy-toolbar", style: { paddingTop: 2, paddingBottom: 6 } },
				h(ToolButton, { label: t("h1"), onClick: () => prefixLines("# ") }, "H1"),
				h(ToolButton, { label: t("h2"), onClick: () => prefixLines("## ") }, "H2"),
				h(ToolButton, { label: t("h3"), onClick: () => prefixLines("### ") }, "H3"),
				h("span", { className: "sy-div" }),
				h(ToolButton, { label: t("bold"), onClick: () => applyFormat("bold") }, h("b", null, "B")),
				h(ToolButton, { label: t("italic"), onClick: () => applyFormat("italic") }, h("i", null, "I")),
				h(ToolButton, { label: t("underline"), onClick: () => applyFormat("underline") }, h("u", null, "U")),
				h(ToolButton, { label: t("strike"), onClick: () => applyFormat("strike") }, h("s", null, "S")),
				h(ToolButton, { label: t("highlight"), onClick: () => applyFormat("highlight") }, "=="),
				h(ToolButton, { label: t("code"), onClick: () => applyFormat("code") }, "</>"),
				h("span", { className: "sy-div" }),
				h(ToolButton, { label: t("quoteBlock"), onClick: () => prefixLines("> ") }, "❝"),
				h(ToolButton, { label: t("bullets"), onClick: () => prefixLines("- ") }, "•"),
				h(ToolButton, { label: t("numbers"), onClick: () => prefixLines("1. ") }, "1."),
				h(ToolButton, { label: t("tasks"), onClick: () => prefixLines("- [ ] ") }, "☑"),
				h("span", { className: "sy-div" }),
				h(ToolButton, { label: t("insertLink"), onClick: () => applyFormat("link") }, "🔗"),
				// 图片：上传中置忙并换文案，避免连点插出重复的图。
				h(
					ToolButton,
					{
						label: uploadPending > 0 ? t("uploading") : t("insertImage"),
						onClick: pickImage,
						disabled: uploadPending > 0,
					},
					uploadPending > 0 ? "⏳" : "🖼",
				),
				h(ToolButton, { label: t("insertCode"), onClick: () => insertBlock("```\n\n```") }, "{ }"),
				h(
					ToolButton,
					{
						label: t("insertTable"),
						onClick: () => insertBlock("| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |"),
					},
					"▦",
				),
				h(ToolButton, { label: t("divider"), onClick: () => insertBlock("---") }, "—"),
				// 正文里出现了「像图片但还不是卡片」的行时才出现：打字不会自动收成卡片，
				// 这里给用户一个明确的「现在收」的开关（比如刚手写完一行图片语法）。
				canResplit ? h(ToolButton, { label: t("imageResplitHint"), onClick: resplitNow }, "🖼↻") : null,
			);

			/**
			 * 选文件的隐藏 input：只由工具栏按钮 `.click()` 触发。放在面板内部（而不是
			 * body）是为了随面板一起卸载，分屏多栏各有一份，互不干扰。
			 */
			const imagePicker = h("input", {
				type: "file",
				accept: "image/*",
				multiple: true,
				ref: fileInputRef,
				style: { display: "none" },
				"aria-hidden": true,
				onChange: (event) => {
					const files = Array.from(event.target.files || []);
					event.target.value = ""; // 复位，连着选同一个文件也能再次触发
					queueUpload(files);
				},
			});

			const notice = doc.error ? h("div", { className: "sy-notice", "data-tone": "err" }, t("saveFailed", { msg: doc.error })) : null;
			const staleBar = stale
				? h(
						"div",
						{ className: "sy-notice", "data-tone": "warn" },
						h("span", null, t("paneStale")),
						h("span", { className: "sy-spacer" }),
						h("button", { type: "button", className: "sy-btn", onClick: onReload }, t("paneStaleReload")),
					)
				: null;

			/**
			 * 外部变更闸门的提示条（design §11）。
			 *
			 * 复用 staleBar 的那套视觉与位置：同一条 `.sy-notice[data-tone=warn]`，就挨着它渲染。
			 * 默认动作是「重新读取」；「仍要保存」是覆盖，必须用户自己点。
			 */
			const guardBar =
				guard === null
					? null
					: h(
							"div",
							{ className: "sy-notice", "data-tone": "warn" },
							h("span", null, guard.reason === "external" ? t("changeExternal") : t("changeUnverified", { msg: guard.message || "" })),
							h("span", { className: "sy-spacer" }),
							guard.reason === "external"
								? h("button", { type: "button", className: "sy-btn", onClick: reloadAfterExternal }, t("changeReload"))
								: h("button", { type: "button", className: "sy-btn", onClick: retryAfterUnverified }, t("changeRetry")),
							guard.reason !== "unconfirmed" ? h(
								"button",
								{
									type: "button",
									className: "sy-btn",
									"data-tone": "danger",
									// 两个分支走**两个**处理函数（两件事：覆盖外部改动 / 放弃检测），
									// 别把它们并成一个标记——见 overwriteOnceRef 上的注释。
									onClick: guard.reason === "external" ? overwriteAfterExternal : skipCheckAfterUnverified,
								},
								guard.reason === "external" ? t("changeOverwrite") : t("changeSkipCheck"),
							) : null,
						);

			return h(
				"section",
				{
					className: "sy-main",
					/**
					 * 拖拽插图：只有真的拖进了文件才拦默认行为 —— 否则浏览器会导航到那个文件，
					 * 或把路径当文字塞进正文。在文字里拖动选中的段落属于原生编辑行为，不碰。
					 */
					onDragOver: (event) => {
						const types = Array.from((event.dataTransfer && event.dataTransfer.types) || []);
						if (!types.includes("Files")) return;
						event.preventDefault();
						if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
					},
					onDrop: (event) => {
						const data = event.dataTransfer;
						if (!data || !Array.from(data.types || []).includes("Files")) return;
						event.preventDefault(); // 非图片文件也不交给浏览器：别把路径写进书稿
						queueUpload(data.files);
					},
				},
				selectionBarNode,
				imagePicker,
				toolbar,
				view !== "preview" ? formatBar : null,
				view !== "preview" ? findBar : null,
				staleBar,
				guardBar,
				notice,
				h(
					"div",
					{ className: "sy-workarea" },
					view === "preview"
						? h("article", {
								className: indentClass,
								"data-only": true,
								ref: previewRef,
								dangerouslySetInnerHTML: { __html: previewHtml },
								onMouseUp: (event) => showSelectionBar(event, previewSelection()),
								onMouseDown: () => hideSelectionBar(),
								onScroll: () => hideSelectionBar(),
							})
						: h(
								"div",
								{ className: "sy-editorwrap" },
								h(
									"div",
									{
										className: "sy-segments",
										ref: segmentsHostRef,
										onScroll: () => {
											hideSelectionBar();
											syncEditorToPreview(segmentsHostRef.current, previewRef.current);
										},
									},
									segmentsRef.current.rows.map((segment, index) => (segment.kind === "image" ? imageCard(segment, index) : textSegment(segment, index))),
								),
								view === "split"
									? h("article", {
										className: indentClass,
										ref: previewRef,
										dangerouslySetInnerHTML: { __html: previewHtml },
										onMouseUp: (event) => showSelectionBar(event, previewSelection()),
										onMouseDown: () => hideSelectionBar(),
										onScroll: (event) => {
											hideSelectionBar();
											syncPreviewToEditor(event.currentTarget, segmentsHostRef.current);
										},
									})
									: null,
							),
				),
				h(
					"div",
					{ className: "sy-statusbar" },
					h("span", null, t("markdown")),
					h("span", null, t("charCount", { n: charCount.chars })),
					h("span", null, t("chineseCount", { n: charCount.chinese })),
					h("span", null, t("blockCount", { n: (doc.blocks || []).length })),
					h("span", null, t("typingRate", { n: typingRate })),
					h("span", { className: "sy-spacer" }),
					dirty ? h(Badge, { tone: "warn" }, t("unsaved")) : h(Badge, { tone: "ok" }, t("saved")),
					doc.savedAt ? h("span", null, t("savedAt", { time: timeOf(doc.savedAt) })) : null,
				),
			);
		}

		function timeOf(timestamp) {
			try {
				return new Date(timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
			} catch {
				return "";
			}
		}
		// #endregion

		// #region panel
		function ConnectCard({ t, initialBaseUrl, onConnected, notice }) {
			const [baseUrl, setBaseUrl] = useState(initialBaseUrl || "http://127.0.0.1:6806");
			const [token, setToken] = useState("");
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(notice ?? null);
			useEffect(() => {
				if (initialBaseUrl) setBaseUrl(initialBaseUrl);
			}, [initialBaseUrl]);
			const submit = async () => {
				setBusy(true);
				setError(null);
				try {
					const trimmed = baseUrl.trim().replace(/\/+$/, "");
					if (!/^https?:\/\//i.test(trimmed)) throw new Error("URL 需要以 http:// 或 https:// 开头");
					await bridge.saveConfig(trimmed, token.trim());
					const next = await bridge.state();
					onConnected(next);
				} catch (err) {
					setError(err && err.message ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			};
			return h(
				"section",
				{ className: "sy-main" },
				h(
					"div",
					{ className: "sy-connect" },
					h(
						"div",
						{ className: "sy-card" },
						h("h2", null, t("connectTitle")),
						h("p", null, t("connectHint")),
						h(
							"div",
							{ className: "sy-field" },
							h("label", { htmlFor: "sy-base" }, t("baseUrl")),
							h("input", {
								id: "sy-base",
								value: baseUrl,
								placeholder: "http://127.0.0.1:6806",
								onChange: (event) => setBaseUrl(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter") void submit();
								},
							}),
						),
						h(
							"div",
							{ className: "sy-field" },
							h("label", { htmlFor: "sy-token" }, t("token")),
							h("input", {
								id: "sy-token",
								type: "password",
								value: token,
								placeholder: "••••••",
								onChange: (event) => setToken(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter") void submit();
								},
							}),
						),
						error ? h("div", { className: "sy-notice", "data-tone": "err", style: { border: 0, padding: 0 } }, error) : null,
						h(
							"div",
							{ className: "sy-row", style: { justifyContent: "flex-end" } },
							h("button", { type: "button", className: "sy-btn", "data-tone": "accent", disabled: busy, onClick: () => void submit() }, busy ? t("connecting") : t("connect")),
						),
					),
				),
			);
		}

		/** One pane: its open tabs and which of them is showing. */
		/**
		 * One editor column. `view`, `autoSave` and `indentOn` belong to the *column*, not
		 * to the panel: splitting the editor creates a second place to write, and a
		 * toolbar click, a view switch or a writing mode in one column must not reach
		 * into the other one.
		 */
		/** The editor's view modes, in toolbar order. */
		const VIEW_MODES = ["edit", "split", "preview"];

		/**
		 * One editor column. `view`, `autoSave` and `indentOn` belong to the *column*, not
		 * to the panel: splitting the editor creates a second place to write, and a
		 * toolbar click, a view switch or a writing mode in one column must not reach
		 * into the other one.
		 *
		 * @param {number} key column key.
		 * @param {object} [extra] the flags to inherit from the column this was split from.
		 * @param {Array<object>} [tabs] tabs to restore (layout restore only).
		 * @param {number} [active] active tab index (layout restore only).
		 */
		function makePane(key, extra, tabs, active) {
			// Only the three flags are inherited. Spreading the caller's object would let a
			// source pane hand over its key, its tabs and its active index as well.
			const flags = extra || {};
			const restored = Array.isArray(tabs) ? tabs.slice() : [];
			const wanted = typeof active === "number" ? Math.trunc(active) : 0;
			return {
				key,
				tabs: restored,
				active: restored.length === 0 ? -1 : Math.min(Math.max(0, wanted), restored.length - 1),
				view: VIEW_MODES.indexOf(flags.view) === -1 ? "split" : flags.view,
				autoSave: flags.autoSave === true,
				indentOn: flags.indentOn !== false,
			};
		}

		function makeTab(key, target) {
			return {
				key,
				id: target.id,
				title: target.title,
				hpath: target.hpath || "",
				text: "",
				savedText: "",
				baselineLoaded: false,
				pendingSave: null,
				blocks: [],
				loading: true,
				saving: false,
				error: null,
				savedAt: null,
				stamp: 0,
			};
		}

		/** Append a tab and show it. */
		function withTabAdded(pane, tab) {
			return { ...pane, tabs: [...pane.tabs, tab], active: pane.tabs.length };
		}

		/**
		 * Drop one tab and keep a valid selection: the surviving neighbour becomes
		 * active, or the pane ends up empty with `active: -1`.
		 */
		function withTabClosed(pane, tabKey) {
			const index = pane.tabs.findIndex((tab) => tab.key === tabKey);
			if (index === -1) return pane;
			const tabs = pane.tabs.filter((tab) => tab.key !== tabKey);
			if (tabs.length === 0) return { ...pane, tabs, active: -1 };
			const active = pane.active === index ? Math.min(index, tabs.length - 1) : pane.active > index ? pane.active - 1 : pane.active;
			return { ...pane, tabs, active: Math.max(0, active) };
		}

		/** Drop a document from every pane at once (its file no longer exists). */
		function withoutDoc(panes, docId) {
			return panes.map((pane) => {
				const tabs = pane.tabs.filter((tab) => tab.id !== docId);
				if (tabs.length === pane.tabs.length) return pane;
				return { ...pane, tabs, active: tabs.length === 0 ? -1 : Math.min(pane.active, tabs.length - 1) };
			});
		}

		/**
		 * The layout to remember: which documents were open, in which column, and how each
		 * column was set up. Buffers are deliberately left out — they are working state, and
		 * a half-typed paragraph must never be restored as if it had been saved.
		 * @param {Array<object>} panes the editor columns.
		 * @param {number} activePaneKey which column was focused.
		 * @param {object} [expanded] the document tree's expansion state.
		 * @returns {object} payload accepted by the host's `/siyuan/layout` route.
		 */
		function layoutSnapshot(panes, activePaneKey, expanded) {
			const activePane = Math.max(0, panes.findIndex((pane) => pane.key === activePaneKey));
			return {
				version: 1,
				panes: panes.map((pane) => ({
					tabs: pane.tabs
						.map((tab) => ({ docId: tab.id, title: tab.title, hpath: tab.hpath || "" }))
						.filter((tab) => typeof tab.docId === "string" && tab.docId !== ""),
					active: pane.active,
					view: pane.view || "split",
					// Only the two flags that shape a column's layout; transient state stays out.
					autoSave: pane.autoSave === true,
					indentOn: pane.indentOn !== false,
				})),
				activePane: activePane === -1 ? 0 : activePane,
				// The tree's open folders: without this the sidebar collapses on every
				// visit, so the open document is no longer visible in it.
				expanded: expansionSnapshot(expanded),
			};
		}

		/**
		 * Merge a restored layout with the columns that are already on screen.
		 *
		 * The restore is asynchronous: the user can open a document while it is still
		 * fetching, and replacing the columns outright would silently swallow that click.
		 * Restored columns win, and documents the restore does not know about are appended
		 * to the first column so they stay reachable.
		 *
		 * Such documents all land on the first column, whatever column the user clicked in.
		 * That is deliberate: the window is a few hundred milliseconds, and rebuilding the
		 * "which restored column was this click meant for" mapping would cost more than the
		 * rare misplacement. The document is open and visible either way.
		 *
		 * @param {Array<object>} restored columns rebuilt from the remembered layout.
		 * @param {Array<object>} current columns currently on screen.
		 * @returns {Array<object>} the columns to render.
		 */
		function mergeRestoredPanes(restored, current) {
			const known = new Set();
			for (const pane of restored) for (const tab of pane.tabs) known.add(tab.id);
			const extraTabs = [];
			for (const pane of current || []) {
				for (const tab of pane.tabs || []) {
					if (typeof tab.id === "string" && tab.id !== "" && !known.has(tab.id)) extraTabs.push(tab);
				}
			}
			if (extraTabs.length === 0) return restored;
			return restored.map((pane, index) => {
				if (index !== 0) return pane;
				const tabs = [...pane.tabs, ...extraTabs];
				// The document the user opened while the restore was still loading is newer
				// than anything the restore remembers: it has to be the one on screen, or the
				// click looks like it was swallowed even though the tab survived.
				return { ...pane, tabs, active: extraTabs.length > 0 ? pane.tabs.length : pane.active };
			});
		}

		/**
		 * Rebuild the editor columns from a remembered layout.
		 *
		 * Only the shape is restored here; the documents themselves are reopened
		 * afterwards, one call each, because their content has to come from the kernel.
		 * Keys continue from the caller's counters so restored tabs can never collide
		 * with tabs opened later.
		 * @param {any} layout value from `/siyuan/layout`.
		 * @param {number} nextPaneKey last used column key.
		 * @param {number} nextTabKey last used tab key.
		 * @returns {{ panes: Array<object>, activePaneKey: number, paneKey: number, tabKey: number } | null}
		 */
		function layoutToPanes(layout, nextPaneKey, nextTabKey) {
			if (layout === null || layout === undefined || typeof layout !== "object") return null;
			if (!Array.isArray(layout.panes) || layout.panes.length === 0) return null;
			let paneSeq = nextPaneKey;
			let tabSeq = nextTabKey;
			const panes = layout.panes.slice(0, 3).map((rawPane) => {
				const pane = rawPane !== null && typeof rawPane === "object" ? rawPane : {};
				const tabs = (Array.isArray(pane.tabs) ? pane.tabs : [])
					.filter((tab) => tab !== null && typeof tab === "object" && typeof tab.docId === "string" && tab.docId !== "")
					.map((tab) =>
						makeTab("t" + ++tabSeq, {
							id: tab.docId,
							title: typeof tab.title === "string" ? tab.title : "",
							hpath: typeof tab.hpath === "string" ? tab.hpath : "",
						}),
					);
				return makePane(++paneSeq, { view: pane.view, autoSave: pane.autoSave, indentOn: pane.indentOn }, tabs, pane.active);
			});
			const wantedPane = typeof layout.activePane === "number" ? Math.trunc(layout.activePane) : 0;
			const activeIndex = Math.min(Math.max(0, wantedPane), panes.length - 1);
			// The remembered tree expansion, as a lookup the tree can use directly.
			const expanded = {};
			if (Array.isArray(layout.expanded)) {
				for (const key of layout.expanded) {
					if (typeof key === "string" && key.includes("::")) expanded[key] = true;
				}
			}
			return { panes, activePaneKey: panes[activeIndex].key, paneKey: paneSeq, tabKey: tabSeq, expanded };
		}

		/**
		 * The notebook and storage path of a document, from its id.
		 *
		 * The tree's expansion keys are `notebookId::path`, and a document's storage path
		 * is its ancestry (`/a.sy/b.sy/c.sy`), so this is what reveals a document in the
		 * tree. Returns null when the row is unknown (deleted, or the query failed).
		 * @param {string} docId
		 * @returns {Promise<{ box: string, path: string } | null>}
		 */
		async function documentLocation(client, docId) {
			if (typeof docId !== "string" || docId === "") return null;
			try {
				const rows = await client.api("/api/query/sql", {
					stmt: "SELECT box, path FROM blocks WHERE type = 'd' AND id = '" + docId.replace(/'/g, "''") + "' LIMIT 1",
				});
				const row = Array.isArray(rows) ? rows[0] : null;
				if (!row || typeof row.box !== "string" || typeof row.path !== "string") return null;
				return { box: row.box, path: row.path };
			} catch {
				return null;
			}
		}

		/**
		 * Ancestor folders a document lives under, as tree expansion keys.
		 *
		 * `/a.sy/b.sy/c.sy` yields the notebook root plus `/a.sy` and `/a.sy/b.sy` — every
		 * folder that has to be open for `c` to be visible. The document itself is not a
		 * folder, so its own path is excluded.
		 * @param {string} box notebook id.
		 * @param {string} path document storage path.
		 * @returns {Array<string>} keys in `notebookId::path` form, outermost first.
		 */
		function revealKeys(box, path) {
			if (typeof box !== "string" || box === "" || typeof path !== "string" || path === "") return [];
			const parts = path.split("/").filter((part) => part !== "");
			const keys = [box + "::/"];
			let current = "";
			// Every part except the last one is a folder the document is nested under.
			for (let index = 0; index < parts.length - 1; index++) {
				current += "/" + parts[index];
				keys.push(box + "::" + current);
			}
			return keys;
		}

		/**
		 * Add the folders on the way to every open document, so the document is visible in
		 * the sidebar even in a profile where nothing was ever expanded by hand.
		 * @param {Array<{id: string}>} tabs the documents that are open.
		 * @param {(docId: string) => Promise<{ box: string, path: string } | null>} locate
		 * @param {Set<string>} [known] locations already resolved, to avoid repeat queries.
		 * @returns {Promise<{ expanded: object, located: Map<string, object> }>}
		 */
		async function withRevealedDocuments(tabs, locate, known) {
			const expanded = {};
			const located = new Map(known || []);
			for (const tab of tabs) {
				if (!tab || typeof tab.id !== "string" || tab.id === "") continue;
				let where = located.get(tab.id);
				if (where === undefined) {
					where = await locate(tab.id);
					located.set(tab.id, where);
				}
				if (!where) continue;
				for (const key of revealKeys(where.box, where.path)) expanded[key] = true;
			}
			return { expanded, located };
		}

		/** The tree's expansion keys, so the panel can remember and restore them. */
		function expansionSnapshot(expanded) {
			if (!expanded || typeof expanded !== "object") return [];
			return Object.keys(expanded)
				.filter((key) => expanded[key] === true)
				.sort()
				.slice(0, 200);
		}

		function PanelPage(props) {
			const t = props.t;
			const { renderFactorySlot, SessionProvider } = props;
			const composer = useComposerBridge();
			// The order of these `useState` calls is the panel's state contract: the tests
			// seed state by slot index (see `exports.__stateSlots`). Adding a hook here shifts
			// every later slot, so that export must be kept in step — a mismatch shows up as a
			// confusing render failure rather than a clear one.
			const [connection, setConnection] = useState({ phase: "probing" });
			// One entry per open editor column; each column keeps its own tabs, so two
			// documents can be edited side by side without sharing a buffer.
			const [panes, setPanes] = useState(() => [makePane(1)]);
			const [activePaneKey, setActivePaneKey] = useState(1);
			const [stamps, setStamps] = useState({});
			/**
			 * Document-tree expansion, owned here rather than inside the tree so it can be
			 * remembered: without it the sidebar collapses on every visit, and the document
			 * that is open is no longer visible in it.
			 */
			const [expanded, setExpanded] = useState({});
			/** True once the remembered expansion has been applied (or found to be empty). */
			const [expandedReady, setExpandedReady] = useState(false);
			// Outline clicks publish a caret target; the active pane consumes it.
			const [caretRequest, setCaretRequest] = useState(null);
			// One conversation surface at a time: a closable right column, or a floating
			// window that collapses to an edge tab. Off leaves the editor full width.
			const [chatSurface, setChatSurface] = useState("side");
			const [floatCollapsed, setFloatCollapsed] = useState(false);
			// null = the default bottom-right anchor; once dragged, an explicit pixel box.
			const [floatBox, setFloatBox] = useState(null);
			const rootRef = useRef(null);
			const floatRef = useRef(null);
			const floatGestureRef = useRef(null);
			// The conversation panel unmounts while this panel is active, so remember the
			// session that was showing and keep using it for the embedded conversation.
			const retainedSessionId = props.useSessions((state) => {
				const summaries = state && state.byId ? Object.values(state.byId) : [];
				const retained = summaries.find((summary) => ((summary && summary.retainedBy && summary.retainedBy.mainView) || 0) > 0);
				if (retained) return retained.id;
				const ids = state && Array.isArray(state.ids) ? state.ids : [];
				return ids.length > 0 ? ids[0] : undefined;
			});
			// Selectors must return a stable reference or useSyncExternalStore re-renders
			// forever, so these hand back the store's own snapshots and the rows are
			// derived below.
			const sessionIds = props.useSessions((state) => (state && Array.isArray(state.ids) ? state.ids : EMPTY_IDS));
			const sessionById = props.useSessions((state) => (state && state.byId ? state.byId : EMPTY_MAP));
			const sessionIdsRef = useRef(sessionIds);
			sessionIdsRef.current = sessionIds;
			// null = follow the app's current conversation; set once the user picks one here.
			const [sessionOverride, setSessionOverride] = useState(null);
			const [historyOpen, setHistoryOpen] = useState(false);
			const lastSessionRef = useRef(undefined);
			if (retainedSessionId !== undefined) lastSessionRef.current = retainedSessionId;
			const sessionId = sessionOverride !== null ? sessionOverride : retainedSessionId !== undefined ? retainedSessionId : lastSessionRef.current;
			// The embedded conversation binds through a *retained session reference*
			// ({sessionId, binding}); handing the provider a bare id leaves it without a
			// binding and the subtree fails. Held for as long as the panel shows it.
			const [sessionRefState, setSessionRefState] = useState(null);
			useEffect(() => {
				if (sessionId === undefined || !props.sessions || typeof props.sessions.retain !== "function") {
					setSessionRefState(null);
					return undefined;
				}
				let reference;
				try {
					reference = props.sessions.retain(sessionId, { source: "sidebarView" });
				} catch {
					reference = undefined;
				}
				setSessionRefState(reference ?? null);
				return () => {
					try {
						reference?.release?.();
					} catch {
						/* the controller already dropped it */
					}
					setSessionRefState(null);
				};
			}, [sessionId, props.sessions]);

			const [notice, setNotice] = useState(null);
			const [dialog, setDialog] = useState(null);
			const nativePendingActionRef = useRef(false);
			const prepareNativeTabs = useCallback((tabs, next) => {
				const active = tabs.filter((tab) => tab && nativeControllers.has(tab.key));
				if (active.length === 0) { next(); return; }
				if (nativePendingActionRef.current) return;
				nativePendingActionRef.current = true;
				void Promise.all(active.map((tab) => nativeControllers.get(tab.key).flush())).then(next)
					.catch((error) => setNotice({ tone: "err", text: error.message }))
					.finally(() => { nativePendingActionRef.current = false; });
			}, []);
			useEffect(() => {
				if (typeof window.addEventListener !== "function") return;
				const beforeUnload = (event) => {
					if (panesRef.current.some((pane) => pane.tabs.some((tab) => tab.nativePending))) { event.preventDefault(); event.returnValue = ""; }
				};
				window.addEventListener("beforeunload", beforeUnload);
				return () => window.removeEventListener("beforeunload", beforeUnload);
			}, []);

			const panesRef = useRef(panes);
			panesRef.current = panes;
			const activePaneKeyRef = useRef(activePaneKey);
			activePaneKeyRef.current = activePaneKey;
			const expandedRef = useRef(expanded);
			expandedRef.current = expanded;
			const stampsRef = useRef(stamps);
			stampsRef.current = stamps;
			const paneKeyRef = useRef(1);
			const tabSeqRef = useRef(0);
			/** Restore runs once per panel mount, however many probes fire. */
			const restoredRef = useRef(false);
			/**
			 * Document locations (notebook + storage path) resolved so far, keyed by doc id.
			 * Used to reveal a document in the tree without repeating the query.
			 */
			const locatedRef = useRef(new Map());
			/**
			 * True while the layout is being restored and its documents are still loading.
			 * Separate from `restoredRef`, which only says the restore was *started*: the
			 * save effect needs to know whether the screen is still the empty skeleton.
			 */
			const restoringRef = useRef(false);

			const client = useMemo(
				() => ({
					async api(path, payload) {
						return bridge.api(path, payload);
					},
					uploadAsset: (file) => bridge.uploadAsset(file),
				}),
				[],
			);

			const probe = useCallback(async () => {
				setConnection({ phase: "probing" });
				try {
					const state = await bridge.state();
					if (state && state.hasToken) {
						setConnection({ phase: "ready", ...state });
						void restoreLayout();
					} else setConnection({ phase: "needConfig", ...state });
				} catch (err) {
					setConnection({ phase: "needConfig", baseUrl: "http://127.0.0.1:6806", error: err && err.message ? err.message : String(err) });
				}
			}, []);


			useEffect(() => {
				if (!notice) return;
				const timer = setTimeout(() => setNotice(null), 4200);
				return () => clearTimeout(timer);
			}, [notice]);

			/** Patch one tab, addressed by pane and tab key so an async load lands in the right place. */
			const patchTab = useCallback((paneKey, tabKey, next) => {
				setPanes((prev) =>
					prev.map((pane) => {
						if (pane.key !== paneKey) return pane;
						let touched = false;
						const tabs = pane.tabs.map((tab) => {
							if (tab.key !== tabKey) return tab;
							touched = true;
							return typeof next === "function" ? next(tab) : next;
						});
						return touched ? { ...pane, tabs } : pane;
					}),
				);
			}, []);
			/**
			 * Reopen the documents the user left behind.
			 *
			 * The columns are restored first so the panel looks like it did, then each
			 * document is read from the kernel. A document that no longer exists (deleted
			 * or renamed away) is dropped from its column instead of leaving a broken tab,
			 * and the rest of the layout still comes back.
			 *
			 * Two things can happen while this is in flight, and both are handled below:
			 * the user may open a document (it must survive the merge), and the debounced
			 * save may fire (it must not persist the still-empty columns).
			 */
			const restoreLayout = useCallback(async () => {
				if (restoredRef.current) return;
				restoredRef.current = true;
				// Saving is blocked until every restored tab has finished loading; otherwise
				// the empty skeleton would be written over the layout being restored.
				restoringRef.current = true;
				let layout = null;
				try {
					const value = await bridge.loadLayout();
					layout = value && value.layout ? value.layout : null;
				} catch {
					layout = null;
				}
				if (layout === null) {
					restoringRef.current = false;
					setExpandedReady(true);
					return;
				}
				const restored = layoutToPanes(layout, paneKeyRef.current, tabSeqRef.current);
				if (restored === null) {
					restoringRef.current = false;
					setExpandedReady(true);
					return;
				}
				// A layout whose only content is empty columns is not worth restoring.
				if (restored.panes.every((pane) => pane.tabs.length === 0) && restored.panes.length === 1) {
					restoringRef.current = false;
					setExpandedReady(true);
					return;
				}
				paneKeyRef.current = restored.paneKey;
				tabSeqRef.current = restored.tabKey;
				// Merge, do not replace: a document the user opened while the layout was
				// still loading must not be silently thrown away. Restored columns win on
				// the active index, but any tab they do not know about is appended.
				setPanes((prev) => mergeRestoredPanes(restored.panes, prev));
				setActivePaneKey(restored.activePaneKey);
				// The sidebar must come back the way it was left: the same folders open, and
				// every folder on the way to an open document visible.
				const tabs = restored.panes.flatMap((pane) => pane.tabs);
				const revealed = await withRevealedDocuments(tabs, (id) => documentLocation(client, id), locatedRef.current);
				locatedRef.current = revealed.located;
				const remembered = restored.expanded && Object.keys(restored.expanded).length > 0 ? { ...restored.expanded, ...revealed.expanded } : revealed.expanded;
				setExpanded(remembered);
				setExpandedReady(true);
				const wanted = [];
				for (const pane of restored.panes) {
					for (const tab of pane.tabs) wanted.push({ paneKey: pane.key, tabKey: tab.key, id: tab.id, title: tab.title, hpath: tab.hpath });
				}
				// Reopen the documents in parallel; each one fills its own tab.
				await Promise.all(
					wanted.map(async (target) => {
						try {
							const { blocks, text } = await readDocumentText(client, target.id);
							patchTab(target.paneKey, target.tabKey, (tab) => ({
								...tab,
								text,
								savedText: text,
								baselineLoaded: true,
								pendingSave: null,
								blocks,
								loading: false,
								savedAt: null,
								stamp: stampsRef.current[target.id] || 0,
							}));
							void client
								.api("/api/filetree/getHPathByID", { id: target.id })
								.then((hpath) => {
									if (typeof hpath === "string" && hpath) patchTab(target.paneKey, target.tabKey, (tab) => ({ ...tab, hpath }));
								})
								.catch(() => {});
						} catch {
							// The document is gone: drop the tab rather than keep a broken one.
							setPanes((prev) =>
								prev.map((pane) => (pane.key !== target.paneKey ? pane : withTabClosed(pane, target.tabKey))),
							);
						}
					}),
				);
				restoringRef.current = false;
			}, [client, patchTab]);

			useEffect(() => {
				void probe();
			}, [probe]);

			/**
			 * Remember the layout whenever it changes, debounced.
			 *
			 * Saves are skipped while the restore is still running (otherwise the empty
			 * columns would overwrite the very layout being restored) and while any document
			 * is still loading (a half-filled column is not the layout to remember).
			 */
			useEffect(() => {
				if (!restoredRef.current) return;
				// The restore has started but has not finished loading its documents: what is
				// on screen is still the empty skeleton, which must not be written down.
				if (restoringRef.current) return;
				if (connection.phase !== "ready") return;
				// The tree has not applied its remembered expansion yet: saving now would store
				// the pre-restore (collapsed) state over it.
				if (!expandedReady) return;
				if (panes.some((pane) => pane.tabs.some((tab) => tab.loading))) return;
				const timer = setTimeout(() => {
					void bridge.saveLayout(layoutSnapshot(panesRef.current, activePaneKeyRef.current, expandedRef.current)).catch(() => {});
				}, 600);
				return () => clearTimeout(timer);
			}, [connection.phase, panes, activePaneKey, expanded, expandedReady]);

			/** Update one column's own flags: view, auto-save, first-line indent. */
			const setPaneFlag = useCallback((paneKey, patch) => {
				setPanes((prev) => prev.map((pane) => (pane.key === paneKey ? { ...pane, ...patch } : pane)));
			}, []);

			const focusTab = useCallback((paneKey, index) => {
				const pane = panesRef.current.find((item) => item.key === paneKey);
				prepareNativeTabs(pane && pane.active >= 0 ? [pane.tabs[pane.active]] : [], () => {
					setActivePaneKey(paneKey);
					caretRef.current = { line: 0, totalLines: 0, selection: null };
					setPanes((prev) => prev.map((item) => (item.key === paneKey ? { ...item, active: index } : item)));
				});
			}, [prepareNativeTabs]);

			const confirmCloseTabs = useCallback((tabs) => {
				if (tabs.some((tab) => tab.saving)) {
					setNotice({ tone: "warn", text: t("closeSaving") });
					return false;
				}
				const unsaved = tabs.filter((tab) => tab.text !== tab.savedText || tab.pendingSave);
				if (unsaved.length === 0) return true;
				return typeof window.confirm === "function" && window.confirm(t("closeUnsaved", { titles: unsaved.map((tab) => tab.title || t("untitled")).join("、") }));
			}, [t, setNotice]);

			const closeTab = useCallback((paneKey, tabKey) => {
				const pane = panesRef.current.find((item) => item.key === paneKey);
				const tab = pane && pane.tabs.find((item) => item.key === tabKey);
				if (!tab) return;
				prepareNativeTabs([tab], () => {
					if (!confirmCloseTabs([tab])) return;
					setPanes((prev) => prev.map((item) => (item.key === paneKey ? withTabClosed(item, tabKey) : item)));
				});
			}, [confirmCloseTabs, prepareNativeTabs]);

			/**
			 * Insert one quote into whichever composer is mounted.
			 * @returns whether the composer accepted it.
			 */
			const insertQuote = useCallback(
				(payload) => {
					const bridgeState = composerBridge.get();
					const actions = bridgeState === undefined ? undefined : bridgeState.actions;
					if (!actions || typeof actions.captureInsertion !== "function" || typeof actions.insertText !== "function") return false;
					const lines = String(payload.text || "")
						.split("\n")
						.filter((line, index, all) => line.trim() !== "" || all.length === 1);
					const header =
						t("quoteSource") +
						"《" +
						(payload.title || t("untitled")) +
						"》" +
						(payload.line > 1 ? "（" + t("quoteLine", { n: payload.line }) + "）" : "");
					const body = lines.map((line) => "> " + line).join("\n");
					const source = /^\d{14}-[a-z0-9]{7}$/.test(payload.blockId || "") ? " · 块 " + payload.blockId : "";
					const block = "> " + header + source + "\n" + body + "\n\n";
					let span = actions.captureInsertion();
					let ok = actions.insertText(block, span);
					if (!ok) {
						// The draft moved between capture and insert; retry once with a fresh span.
						span = actions.captureInsertion();
						ok = actions.insertText(block, span);
					}
					return ok;
				},
				[t],
			);

			/**
			 * Quote the editor's selection into the conversation.
			 *
			 * A composer only exists while a chat surface is mounted, so quoting with the
			 * chat closed opens one and retries once it has mounted — pressing 引用 should
			 * never look like it did nothing.
			 */
			const onQuote = useCallback(
				async (payload) => {
					if (insertQuote(payload)) {
						setNotice({ tone: "ok", text: t("quoteDone") });
						return;
					}
					setChatSurface((current) => (current === "off" ? "side" : current));
					setNotice({ tone: "ok", text: t("quoteOpening") });
					setTimeout(() => {
						const ok = insertQuote(payload);
						setNotice(ok ? { tone: "ok", text: t("quoteDone") } : { tone: "err", text: t("quoteFailed") });
					}, 140);
				},
				[insertQuote, t],
			);

			// --- editor context pushed to the Host so the agent knows what the user sees
			const caretRef = useRef({ line: 1, totalLines: 1, selection: null });
			const contextTimer = useRef(null);
			const pushContext = useCallback(
				(delay) => {
					if (contextTimer.current !== null) clearTimeout(contextTimer.current);
					contextTimer.current = setTimeout(async () => {
						contextTimer.current = null;
						const pane = panesRef.current.find((item) => item.key === activePaneKeyRef.current);
						const tab = pane && pane.active >= 0 ? pane.tabs[pane.active] : null;
						const body = tab
							? {
									docId: tab.id,
									title: tab.title,
									hpath: tab.hpath || "",
									cursorLine: caretRef.current.line,
									totalLines: caretRef.current.totalLines,
									selection: caretRef.current.selection,
								view: tab.nativeMode ? "native" : pane.view || "split",
								...(tab.nativeMode ? { blockId: caretRef.current.blockId || null, pending: Boolean(tab.nativePending) } : {}),
									tabs: pane.tabs.map((item) => ({ docId: item.id, title: item.title })),
									activeTabIndex: pane.active,
									updatedAt: Date.now(),
								}
							: { docId: null, updatedAt: Date.now() };
						try {
							await callHost("/context", body);
						} catch {
							/* context is best-effort: the editor keeps working without it */
						}
					}, delay === undefined ? 400 : delay);
				},
				// No dependencies: the body reads the live panes, so it always reports the
				// active column's own view rather than a captured one.
				[],
			);

			const onCaret = useCallback(
				(payload) => {
					caretRef.current = payload;
					pushContext(500);
				},
				[pushContext],
			);

			/** Switch this chat to another conversation. */
			const pickSession = useCallback((id) => {
				setHistoryOpen(false);
				setSessionOverride(id);
			}, []);

			/**
			 * Start a new conversation.
			 *
			 * `sessions.create` is the quiet path (it does not navigate the app); when the
			 * service face does not expose it, fall back to the workspace UI's own New
			 * Session action and adopt whichever id the list gains.
			 */
			const startConversation = useCallback(async () => {
				setHistoryOpen(false);
				const api = props.sessions;
				if (api && typeof api.create === "function") {
					try {
						const created = await api.create();
						if (typeof created === "string" && created !== "") {
							setSessionOverride(created);
							return;
						}
					} catch (error) {
						console.error("[dsh-siyuan-notes] sessions.create failed", error);
					}
				}
				const ui = props.uiWorkspace;
				if (ui && typeof ui.startSession === "function") {
					const known = new Set(sessionIdsRef.current);
					try {
						ui.startSession();
					} catch (error) {
						console.error("[dsh-siyuan-notes] startSession failed", error);
						setNotice({ tone: "err", text: t("chatNewFailed") });
						return;
					}
					// The list updates asynchronously; adopt the first id we had not seen.
					setTimeout(() => {
						const fresh = sessionIdsRef.current.find((id) => !known.has(id));
						if (fresh !== undefined) setSessionOverride(fresh);
					}, 400);
					return;
				}
				setNotice({ tone: "err", text: t("chatNewFailed") });
			}, [props.sessions, props.uiWorkspace, t]);

			/** Keep a floating box inside the panel. */
			const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

			/** Start dragging (mode "move") or resizing (mode "resize") the floating chat. */
			const beginFloatGesture = (mode) => (event) => {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				// The header carries buttons; let them be buttons.
				if (event.target && typeof event.target.closest === "function" && event.target.closest("button")) return;
				const root = rootRef.current;
				const box = floatRef.current;
				if (!root || !box) return;
				const rootRect = root.getBoundingClientRect();
				const boxRect = box.getBoundingClientRect();
				floatGestureRef.current = {
					mode,
					dx: event.clientX - boxRect.left,
					dy: event.clientY - boxRect.top,
					rootRect,
					width: boxRect.width,
					height: boxRect.height,
					left: boxRect.left - rootRect.left,
					top: boxRect.top - rootRect.top,
				};
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {
					/* capture is a nicety; the move/up handlers are bound either way */
				}
				event.preventDefault();
			};

			const moveFloatGesture = (event) => {
				const gesture = floatGestureRef.current;
				if (!gesture) return;
				const { rootRect } = gesture;
				if (gesture.mode === "move") {
					const left = clampNumber(event.clientX - rootRect.left - gesture.dx, 0, Math.max(0, rootRect.width - gesture.width));
					const top = clampNumber(event.clientY - rootRect.top - gesture.dy, 0, Math.max(0, rootRect.height - gesture.height));
					setFloatBox({ left, top, width: gesture.width, height: gesture.height });
					return;
				}
				const width = clampNumber(event.clientX - rootRect.left - gesture.left, 280, Math.max(280, rootRect.width - gesture.left));
				const height = clampNumber(event.clientY - rootRect.top - gesture.top, 220, Math.max(220, rootRect.height - gesture.top));
				setFloatBox({ left: gesture.left, top: gesture.top, width, height });
			};

			const endFloatGesture = (event) => {
				floatGestureRef.current = null;
				try {
					event.currentTarget.releasePointerCapture(event.pointerId);
				} catch {
					/* capture was never taken */
				}
			};

			const floatHeadProps = {
				onPointerDown: beginFloatGesture("move"),
				onPointerMove: moveFloatGesture,
				onPointerUp: endFloatGesture,
				onPointerCancel: endFloatGesture,
			};

			const floatResizeProps = {
				onPointerDown: beginFloatGesture("resize"),
				onPointerMove: moveFloatGesture,
				onPointerUp: endFloatGesture,
				onPointerCancel: endFloatGesture,
			};

			const floatStyle =
				floatBox === null
					? undefined
					: {
							left: floatBox.left + "px",
							top: floatBox.top + "px",
							right: "auto",
							bottom: "auto",
							width: floatBox.width + "px",
							height: floatBox.height + "px",
						};

			const openDoc = useCallback(
				async (target, paneKeyInput) => {
					setNotice(null);
					const key = paneKeyInput === undefined ? activePaneKeyRef.current : paneKeyInput;
					const pane = panesRef.current.find((item) => item.key === key) || panesRef.current[0];
					const existing = pane.tabs.findIndex((tab) => tab.id === target.id);
					if (existing !== -1) {
						focusTab(pane.key, existing);
						return;
					}
					const departing = pane.active >= 0 ? pane.tabs[pane.active] : null;
					const native = departing && nativeControllers.get(departing.key);
					if (native) {
						try { await native.flush(); }
						catch (error) { setNotice({ tone: "err", text: error.message }); return; }
					}
					const tabKey = "t" + ++tabSeqRef.current;
					// Show the document in the sidebar: open every folder on the way to it.
					void revealInTree(target.id);
					setPanes((prev) => prev.map((item) => (item.key === pane.key ? withTabAdded(item, makeTab(tabKey, target)) : item)));
					setActivePaneKey(pane.key);
					try {
						const { blocks, text } = await readDocumentText(client, target.id);
						patchTab(pane.key, tabKey, (tab) => ({
							...tab,
							text,
							savedText: text,
							baselineLoaded: true,
							pendingSave: null,
							blocks,
							loading: false,
							savedAt: null,
							stamp: stampsRef.current[target.id] || 0,
						}));
						// The display path is a separate call; the agent uses it to name the document.
						void client
							.api("/api/filetree/getHPathByID", { id: target.id })
							.then((hpath) => {
								if (typeof hpath === "string" && hpath) patchTab(pane.key, tabKey, (tab) => ({ ...tab, hpath }));
							})
							.catch(() => {});
					} catch (err) {
						const message = err && err.message ? err.message : String(err);
						patchTab(pane.key, tabKey, (tab) => ({ ...tab, loading: false, error: message }));
						setNotice({ tone: "err", text: t("loadFailed", { msg: message }) });
					}
				},
				[client, focusTab, patchTab, t],
			);

			/**
			 * Open every folder on the way to this document, so the sidebar shows it.
			 * Best effort: a document whose location cannot be resolved still opens.
			 */
			const revealInTree = useCallback(
				async (docId) => {
					let where = locatedRef.current.get(docId);
					if (where === undefined) {
						where = await documentLocation(client, docId);
						locatedRef.current.set(docId, where);
					}
					if (!where) return;
					const keys = revealKeys(where.box, where.path);
					setExpanded((prev) => {
						let changed = false;
						const next = { ...prev };
						for (const key of keys) {
							if (next[key] !== true) {
								next[key] = true;
								changed = true;
							}
						}
						return changed ? next : prev;
					});
				},
				[client],
			);



			/** Bump the document's revision so every other pane showing it can warn. */
			const onSaved = useCallback(
				(docId, paneKey, tabKey) => {
					const next = (stampsRef.current[docId] || 0) + 1;
					stampsRef.current = { ...stampsRef.current, [docId]: next };
					setStamps(stampsRef.current);
					patchTab(paneKey, tabKey, (tab) => (tab.id === docId ? { ...tab, stamp: next } : tab));
				},
				[patchTab],
			);

			const splitPane = useCallback(() => {
				if (panesRef.current.length >= 3) {
					setNotice({ tone: "warn", text: t("splitLimit") });
					return;
				}
				const current = panesRef.current.find((pane) => pane.key === activePaneKeyRef.current);
				const sourceTab = current && current.active >= 0 ? current.tabs[current.active] : null;
				const key = ++paneKeyRef.current;
				// Carry the current document into the new column, exactly like a split view.
				// A document that is still loading (or failed) is not copied: the copy would
				// never run its own fetch and would sit on the loading state forever.
				const copyable = sourceTab && sourceTab.id && !sourceTab.loading && !sourceTab.error ? sourceTab : null;
				const copied = copyable ? { ...copyable, key: "t" + ++tabSeqRef.current, stamp: copyable.stamp || 0 } : null;
				// The new column starts with the settings of the one it was split from,
				// then owns them: changing them here no longer touches the other column.
				const inherited = current ? { view: current.view, autoSave: current.autoSave, indentOn: current.indentOn } : undefined;
				setPanes((prev) => [...prev, makePane(key, inherited)]);
				setActivePaneKey(key);
			}, [t]);

			const closePane = useCallback((paneKey) => {
				const remaining = panesRef.current.filter((pane) => pane.key !== paneKey);
				if (remaining.length === 0) return;
				const closing = panesRef.current.find((pane) => pane.key === paneKey);
				if (!closing) return;
				prepareNativeTabs(closing.tabs, () => {
					if (!confirmCloseTabs(closing.tabs)) return;
					setPanes((prev) => prev.filter((pane) => pane.key !== paneKey));
					if (activePaneKeyRef.current === paneKey) setActivePaneKey(remaining[0].key);
				});
			}, [confirmCloseTabs, prepareNativeTabs]);

			const reloadTab = useCallback(
				async (paneKey, tabKey) => {
					const pane = panesRef.current.find((item) => item.key === paneKey);
					const tab = pane ? pane.tabs.find((item) => item.key === tabKey) : null;
					if (!tab) return;
					if (tab.saving) return;
					if ((tab.text !== tab.savedText || tab.pendingSave) && !window.confirm(t("reloadHint"))) return;
					patchTab(paneKey, tabKey, (item) => ({ ...item, loading: true, error: null }));
					try {
						const { blocks, text } = await readDocumentText(client, tab.id);
						patchTab(paneKey, tabKey, (item) => ({
							...item,
							text,
							savedText: text,
							baselineLoaded: true,
							pendingSave: null,
							blocks,
							loading: false,
							error: null,
							stamp: stampsRef.current[tab.id] || 0,
						}));
					} catch (err) {
						patchTab(paneKey, tabKey, (item) => ({ ...item, loading: false }));
						setNotice({ tone: "err", text: t("loadFailed", { msg: err && err.message ? err.message : String(err) }) });
					}
				},
				[client, patchTab, t],
			);

			const openNotebook = useCallback(
				async (notebookId) => {
					try {
						await client.api("/api/notebook/openNotebook", { notebook: notebookId });
						setNotice({ tone: "ok", text: t("openNotebook") });
					} catch (err) {
						setNotice({ tone: "err", text: err && err.message ? err.message : String(err) });
					}
				},
				[client, t],
			);

			const confirmRename = useCallback(async () => {
				if (!dialog || dialog.kind !== "rename") return;
				const title = String(dialog.value || "").trim();
				if (!title) return;
				try {
					await client.api("/api/filetree/renameDocByID", { id: dialog.docId, title });
					patchTab(dialog.paneKey, dialog.tabKey, (tab) => ({ ...tab, title }));
					setDialog(null);
					setNotice({ tone: "ok", text: t("rename") });
				} catch (err) {
					setDialog(null);
					setNotice({ tone: "err", text: err && err.message ? err.message : String(err) });
				}
			}, [client, dialog, patchTab, t]);

			const confirmRemove = useCallback(async () => {
				if (!dialog || dialog.kind !== "remove") return;
				const docId = dialog.docId;
				try {
					await client.api("/api/filetree/removeDocByID", { id: docId });
					setDialog(null);
					setPanes((prev) => withoutDoc(prev, docId));
					setNotice({ tone: "ok", text: t("remove") });
				} catch (err) {
					setDialog(null);
					setNotice({ tone: "err", text: err && err.message ? err.message : String(err) });
				}
			}, [client, dialog, t]);

			const activePane = panes.find((pane) => pane.key === activePaneKey) || panes[0];
			const activeTab = activePane && activePane.active >= 0 ? activePane.tabs[activePane.active] : null;

			useEffect(() => {
				pushContext(0);
			}, [activeTab && activeTab.id, activeTab && activeTab.title, activeTab && activeTab.nativeMode, activeTab && activeTab.nativePending, activePaneKey, activePane && activePane.view, panes.length, pushContext]);

			// The conversation is rendered through its own factory, bound to the remembered
			// session: that is the real composer (model picker, permissions, send) rather
			// than a look-alike, and it keeps working while this panel owns the centre column.
			const canEmbedChat =
				sessionRefState !== null && sessionRefState !== undefined && typeof SessionProvider === "function" && typeof renderFactorySlot === "function";
			const chatBody = canEmbedChat
				? h(
						"div",
						{ className: "sy-chat-fill" },
						h(
							PanelBoundary,
							{ label: t("chat"), hint: t("chatBrokenHint") },
							h(SessionProvider, { session: sessionRefState }, renderFactorySlot("conversation.content", chatFactoryProps())),
						),
					)
				: h("div", { className: "sy-chat-fallback" }, t("chatUnavailable"));

			const historyRows = historyOpen ? sessionHistoryItems(sessionIds, sessionById, sessionId, t, 30) : [];
			const historyNode = historyOpen
				? h(
						"div",
						{ className: "sy-chatmenu", onMouseDown: (event) => event.stopPropagation() },
						historyRows.length === 0
							? h("div", { className: "sy-chatmenu-empty" }, t("chatHistoryEmpty"))
							: historyRows.map((row) =>
									h(
										"button",
										{
											key: row.id,
											type: "button",
											className: "sy-chatmenu-row",
											"data-current": row.current ? true : undefined,
											title: row.label,
											onClick: () => pickSession(row.id),
										},
										h("span", { className: "sy-chatmenu-title" }, row.label),
										row.running ? h("span", { className: "sy-chatmenu-tag" }, t("chatRunning")) : null,
										row.current ? h("span", { className: "sy-chatmenu-tag" }, t("chatCurrent")) : null,
									),
								),
					)
				: null;

			const { sideChat, floatChat, floatTab } = buildChatSurfaces(chatSurface, floatCollapsed, chatBody, t, {
				onClose: () => setChatSurface("off"),
				onCollapse: () => setFloatCollapsed(true),
				onExpand: () => setFloatCollapsed(false),
				headProps: floatHeadProps,
				resizeProps: floatResizeProps,
				style: floatStyle,
				containerRef: floatRef,
				onHistory: () => setHistoryOpen((open) => !open),
				onNew: () => void startConversation(),
				historyNode,
			});
			if (connection.phase === "probing") {
				return h("section", { className: "sy-root" }, h("div", { className: "sy-empty" }, t("connecting")));
			}

			if (connection.phase !== "ready") {
				return h(
					"section",
					{ className: "sy-root" },
					h(ConnectCard, {
						t,
						initialBaseUrl: connection.baseUrl,
						notice: connection.error,
						onConnected: (state) => {
							if (state && state.hasToken) setConnection({ phase: "ready", ...state });
							else setConnection({ phase: "needConfig", ...(state || {}) });
						},
					}),
				);
			}

			return h(
				"section",
				{ className: "sy-root", ref: rootRef },
				h(
					"header",
					{ className: "sy-header" },
					h("span", { className: "sy-dot", "data-on": true }),
					h("h1", null, t("title")),
					h("span", { className: "sy-sub" }, connection.version ? t("version") + " " + connection.version : t("connected")),
					h("span", { className: "sy-spacer" }),
					h("span", { className: "sy-sub", title: connection.baseUrl }, connection.baseUrl),
					h(
						"button",
						{
							type: "button",
							className: "sy-btn",
							"data-tone": "ghost",
							onClick: () => setConnection({ phase: "needConfig", baseUrl: connection.baseUrl }),
						},
						t("reconnect"),
					),
					h(
						"button",
						{
							type: "button",
							className: "sy-iconbtn",
							"data-active": chatSurface === "side" ? true : undefined,
							title: t("chatSideHint"),
							onClick: () => setChatSurface(chatSurface === "side" ? "off" : "side"),
						},
						"▥",
					),
					h(
						"button",
						{
							type: "button",
							className: "sy-iconbtn",
							"data-active": chatSurface === "float" ? true : undefined,
							title: t("chatFloatHint"),
							onClick: () => {
								setChatSurface(chatSurface === "float" ? "off" : "float");
								setFloatCollapsed(false);
							},
						},
						"▣",
					),
				),
				notice
					? h("div", { className: "sy-notice sy-toast", "data-tone": notice.tone === "err" ? "err" : notice.tone === "warn" ? "warn" : "ok" }, notice.text)
					: null,
				h(
					"div",
					{ className: "sy-body" },
					h(PanelBoundary, { label: t("title") },
					h(TreePane, {
						t,
						client,
						state: activeTab,
						activeDocId: activeTab ? activeTab.id : null,
						onOpenDoc: (target) => void openDoc(target),
						onNotebookOpen: (notebookId) => void openNotebook(notebookId),
						onOutlineJump: (line) => setCaretRequest({ line }),
						expanded,
						setExpanded,
						expandedReady,
					}),
					h(
						"div",
						{ className: "sy-column" },
						h(
							"div",
							{ className: "sy-panes" },
						panes.map((pane) => {
							const tab = pane.active >= 0 ? pane.tabs[pane.active] : null;
							const isActivePane = pane.key === activePaneKey;
							return h(
								"div",
								{
									key: pane.key,
									className: "sy-pane",
									"data-active": isActivePane ? true : "false",
									onMouseDownCapture: () => {
										if (!isActivePane) setActivePaneKey(pane.key);
									},
								},
								h(
									"div",
									{ className: "sy-pane-head" },
									h(
										"div",
										{ className: "sy-tabstrip" },
										pane.tabs.map((item, index) =>
											h(
												"div",
												{
													key: item.key,
													className: "sy-tabpill",
													"data-active": index === pane.active ? true : undefined,
													title: item.title,
													onClick: () => focusTab(pane.key, index),
												},
												h("span", { className: "sy-tab-name" }, item.title || t("untitled")),
												(stamps[item.id] || 0) !== (item.stamp || 0) ? h("span", { className: "sy-tab-dot", title: t("paneStale") }) : null,
												h(
													"span",
													{
														className: "sy-tab-x",
														title: t("closeTab"),
														onClick: (event) => {
															event.stopPropagation();
															closeTab(pane.key, item.key);
														},
													},
													"✕",
												),
											),
										),
									),
									h("span", { className: "sy-spacer" }),
									h(
										"div",
										{ className: "sy-pane-actions" },
										h(
											"button",
											{ type: "button", className: "sy-iconbtn", title: t("splitPane"), onClick: splitPane, disabled: panes.length >= 3 },
											"◫",
										),
										panes.length > 1
											? h(
													"button",
													{ type: "button", className: "sy-iconbtn", title: t("closePane"), onClick: () => closePane(pane.key) },
													"⊟",
												)
											: null,
									),
								),
								tab && tab.nativeMode ? h(NativeEditorPane, {
									key: "native-" + tab.key, doc: tab, client,
									setDoc: (next) => patchTab(pane.key, tab.key, next),
									onQuote: (payload) => void onQuote(payload),
									onCaret: (payload) => { if (activePaneKeyRef.current === pane.key) onCaret(payload); },
									onActivate: () => { activePaneKeyRef.current = pane.key; setActivePaneKey(pane.key); },
									onNotice: setNotice,
									onSaved: (id) => onSaved(id, pane.key, tab.key),
									onExit: async () => {
										const fresh = await readDocumentText(client, tab.id);
										patchTab(pane.key, tab.key, (old) => ({ ...old, text: fresh.text, savedText: fresh.text, blocks: fresh.blocks, baselineLoaded: true, pendingSave: null, nativeMode: false, nativePending: false }));
										caretRef.current = { line: 1, totalLines: fresh.text.split("\n").length, selection: null };
									},
								}) : h(EditorPane, {
									key: tab ? tab.key : "empty",
									t,
									client,
									doc: tab,
									stale: tab ? (stamps[tab.id] || 0) !== (tab.stamp || 0) : false,
									setDoc: (next) => patchTab(pane.key, tab ? tab.key : "", next),
									view: pane.view || "split",
									setView: (next) => setPaneFlag(pane.key, { view: next }),
									autoSave: pane.autoSave === true,
									setAutoSave: (next) => setPaneFlag(pane.key, { autoSave: next }),
									indentOn: pane.indentOn !== false,
									onIndentChange: (next) => setPaneFlag(pane.key, { indentOn: next }),
									onQuote: (payload) => void onQuote(payload),
									onCaret,
									caretRequest: isActivePane ? caretRequest : null,
									onNative: () => {
										if (!tab || tab.loading || tab.saving || tab.pendingSave || tab.text !== tab.savedText) return;
										caretRef.current = { line: 0, totalLines: 0, selection: null, blockId: null };
										patchTab(pane.key, tab.key, (old) => ({ ...old, nativeMode: true }));
									},
									onNotice: setNotice,
									onSaved: (docId) => tab && onSaved(docId, pane.key, tab.key),
									onReload: () => tab && void reloadTab(pane.key, tab.key),
									onRename: () =>
										tab && setDialog({ kind: "rename", paneKey: pane.key, tabKey: tab.key, docId: tab.id, title: tab.title, value: tab.title }),
									onRemove: () => tab && setDialog({ kind: "remove", paneKey: pane.key, tabKey: tab.key, docId: tab.id, title: tab.title }),
								}),
							);
						}),
						),
					),
					),
					sideChat,
				),
				floatChat,
				floatTab,
				dialog && dialog.kind === "remove"
					? h(
							"div",
							{ className: "sy-modal" },
							h(
								"div",
								{ className: "sy-card" },
								h("h2", null, t("remove")),
								h("p", null, t("confirmRemove", { title: dialog.title })),
								h(
									"div",
									{ className: "sy-row", style: { justifyContent: "flex-end" } },
									h("button", { type: "button", className: "sy-btn", onClick: () => setDialog(null) }, t("cancel")),
									h("button", { type: "button", className: "sy-btn", "data-tone": "danger", onClick: () => void confirmRemove() }, t("remove")),
								),
							),
						)
					: null,
				dialog && dialog.kind === "rename"
					? h(
							"div",
							{ className: "sy-modal" },
							h(
								"div",
								{ className: "sy-card" },
								h("h2", null, t("rename")),
								h(
									"div",
									{ className: "sy-field" },
									h("label", { htmlFor: "sy-rename" }, t("rename")),
									h("input", {
										id: "sy-rename",
										value: dialog.value,
										autoFocus: true,
										onChange: (event) => setDialog({ ...dialog, value: event.target.value }),
										onKeyDown: (event) => {
											if (event.key === "Enter") void confirmRename();
											if (event.key === "Escape") setDialog(null);
										},
									}),
								),
								h(
									"div",
									{ className: "sy-row", style: { justifyContent: "flex-end" } },
									h("button", { type: "button", className: "sy-btn", onClick: () => setDialog(null) }, t("cancel")),
									h("button", { type: "button", className: "sy-btn", "data-tone": "accent", onClick: () => void confirmRename() }, t("rename")),
								),
							),
						)
					: null,
			);

		}

		/**
		 * Input props for the embedded conversation factory.
		 *
		 * `phase` is not cosmetic: the composer sits at the END of the conversation's
		 * scroll body and only becomes a sticky bottom seat when the body carries
		 * `data-content-phase="active"`. Omitting it leaves the input box scrolled out
		 * of view — the transcript fills the surface and no composer is ever visible.
		 *
		 * @returns {{ variant: "embedded", phase: "active", hero: false }}
		 */
		function chatFactoryProps() {
			return { variant: "embedded", phase: "active", hero: false };
		}

		/**
		 * Build the chat surfaces for one state. Pure: the panel decides *which* surface,
		 * this decides what each looks like, so the three states are testable without a DOM.
		 *
		 * @param surface "off" | "side" | "float"
		 * @param collapsed whether the floating window is folded to its edge tab
		 * @param body the conversation element (or a fallback notice)
		 * @param t translator
		 * @param onClose dismiss the chat
		 * @param onCollapse fold the floating window
		 * @param onExpand unfold it
		 * @returns {{ sideChat: any, floatChat: any, floatTab: any }}
		 */
		function buildChatSurfaces(surface, collapsed, body, t, handlers) {
			const { onClose, onCollapse, onExpand, headProps, resizeProps, style, containerRef, onHistory, onNew, historyNode } = handlers;

			// Both surfaces share one header: title, then the conversation controls.
			const head = (extra) =>
				h(
					"div",
					{ className: "sy-float-head", ...headProps },
					h("span", null, t("chat")),
					h("span", { className: "sy-spacer" }),
					h("button", { type: "button", className: "sy-iconbtn", title: t("chatHistory"), onClick: onHistory }, "⟲"),
					h("button", { type: "button", className: "sy-iconbtn", title: t("chatNewHint"), onClick: onNew }, "＋"),
					extra,
					h("button", { type: "button", className: "sy-iconbtn", title: t("chatClose"), onClick: onClose }, "✕"),
				);
			const sideChat =
				surface === "side"
					? h(
							"aside",
							{ className: "sy-sidechat" },
							head(null),
							historyNode,
							h("div", { className: "sy-sidechat-body" }, body),
						)
					: null;

			const floatChat =
				surface === "float"
					? h(
							"div",
							{
								className: "sy-float",
								"data-collapsed": collapsed ? true : undefined,
								style,
								ref: containerRef,
							},
							head(h("button", { type: "button", className: "sy-iconbtn", title: t("chatCollapse"), onClick: onCollapse }, "—")),
							historyNode,
							h("div", { className: "sy-float-body" }, body),
							h("div", { className: "sy-float-resize", title: t("chatResize"), ...resizeProps }),
						)
					: null;

			const floatTab =
				surface === "float" && collapsed
					? h("button", { type: "button", className: "sy-float-tab", title: t("chatExpand"), onClick: onExpand }, t("chat"))
					: null;

			return { sideChat, floatChat, floatTab };
		}

		// #endregion

		/** Shared frozen empties so the session selectors keep a stable identity. */
		const EMPTY_IDS = Object.freeze([]);
		const EMPTY_MAP = Object.freeze({});

		// #region plugin
		// `sessions` is needed to retain a session reference for the embedded
		// conversation: the factory's scope provider takes a reference, not an id.
		const inject = ["slots", "locale", "sessions"];

		/** Translate with the plugin dictionary; the slot-provided `t` wins when present. */
		const PALETTE = {
			preference: "ok",
			fact: undefined,
			decision: "warn",
			state: "err",
		};
		const MEMORY_TYPE_LABEL = {
			preference: "memoryTypePref",
			fact: "memoryTypeFact",
			decision: "memoryTypeDecision",
			state: "memoryTypeState",
		};
		const MEMORY_STATUS_LABEL = {
			active: "memoryStatusActive",
			candidate: "memoryStatusCandidate",
			superseded: "memoryStatusSuperseded",
			revoked: "memoryStatusRevoked",
		};

		/**
		 * 条目自带的工作区能不能直接用。
		 *
		 * 迁移来的旧条目 workspace 是空串或 unassigned：这种候选**不能**一键确认
		 * （服务端会回 workspace_required / invalid_project），必须先选范围。
		 */
		function hasUsableWorkspace(entry) {
			const value = typeof entry?.workspace === "string" ? entry.workspace : "";
			return value !== "" && value !== "unassigned";
		}

		/** 时间戳 `yyyyMMddHHmmss` → `MM-DD HH:mm`，读不出来就原样返回。 */
		function memoryStamp(value) {
			const text = typeof value === "string" ? value : "";
			if (!/^\d{14}$/.test(text)) return text;
			return `${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}`;
		}

		function MemoryIcon({ size, active }) {
			const stroke = "currentColor";
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: size || 18,
					height: size || 18,
					"aria-hidden": true,
					style: { display: "block", opacity: active ? 1 : 0.82 },
				},
				h("path", { d: "M12 3.4c-4 0-7 2.6-7 6 0 1.5.6 2.6.6 3.6 0 1-.5 1.7-.5 2.6 0 1.4 1.2 2.3 2.6 2.3.6 0 1 .2 1.3.6.5.7 1.4 1.6 3 1.6s2.5-.9 3-1.6c.3-.4.7-.6 1.3-.6 1.4 0 2.6-.9 2.6-2.3 0-.9-.5-1.6-.5-2.6 0-1 .6-2.1.6-3.6 0-3.4-3-6-7-6z", fill: "none", stroke, strokeWidth: 1.6, strokeLinejoin: "round" }),
				h("path", { d: "M9.2 10.2h5.6M9.2 13.4h3.8", fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round" }),
				h("path", { d: "M18.6 4.6 20 3.2M19.4 7.4 21.2 7", fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round" }),
			);
		}

		/**
		 * 记忆面板：列表 + 筛选 + 展开正文 + 撤销/恢复。
		 *
		 * 它有意做成只读视图——改正文的正规入口是思源本身。这里只负责两件在思源里
		 * 做起来别扭的事：**跨类型地看全貌**、以及在会话里**一键撤销**刚记错的东西。
		 */
		function MemoryPage({ t }) {
			const [overview, setOverview] = useState(null);
			const [entries, setEntries] = useState([]);
			const [loading, setLoading] = useState(true);
			const [error, setError] = useState(null);
			const [type, setType] = useState("");
			const [status, setStatus] = useState("");
			const [project, setProject] = useState("");
			const [openId, setOpenId] = useState("");
			const [notice, setNotice] = useState(null);
			// 交接卡：**最后**一个 state slot——测试按位置预置状态，插在中间会错位。
			const [handoff, setHandoff] = useState(null);
			const [manager, setManager] = useState({ approval: null, selected: [], body: "", recoveries: null, inspection: null, confirmedMissing: false });
			// 主题漂移的二次确认（同样追加在最后：测试按位置预置 state，插在中间会错位）。
			const [drift, setDrift] = useState(null);

			const load = useCallback(async () => {
				setLoading(true);
				setError(null);
				try {
					const params = new URLSearchParams({ view: "entries", limit: "200" });
					const recording = await callHost("/memory?view=recording");
					setManager(previous => ({ ...previous, recording }));
					if (type) params.set("type", type);
					if (status) params.set("status", status);
					if (project.trim()) params.set("project", project.trim());
					if (manager.workspace?.trim()) params.set("workspace", manager.workspace.trim());
					// 概览与列表一起取：v5 这里还带了一个 /memory?refresh=1（宿主没有这个分支，
					// 属于死参数），v6 去掉；列表请求本身就是重新读取。
					const [head, listed] = await Promise.all([
						callHost("/memory"),
						callHost("/memory?" + params.toString()),
					]);
					setOverview(head);
					setEntries(Array.isArray(listed.entries) ? listed.entries : []);
					if (listed.complete === false) setNotice({ tone: "warn", text: t("memoryPartial") });
				} catch (failure) {
					setError(failure && failure.message ? failure.message : String(failure));
				} finally {
					setLoading(false);
				}
			}, [type, status, project, manager.workspace]);

			useEffect(() => {
				void load();
			}, [load]);

			const act = useCallback(
				async (action, id) => {
					try {
						const entry = entries.find(item => item.id === id);
						await callHost("/memory", { action, id, expectedRevision: entry?.revision }, "POST");
						setNotice({ tone: "ok", text: t(action === "approve" ? "memoryApproved" : action === "revoke" ? "memoryRevoked" : "memoryRestored") });
						await load();
					} catch (failure) {
						const message = failure && failure.message ? failure.message : String(failure);
						setNotice({ tone: "err", text: t("memoryActionFailed", { message }) });
					}
				},
				[load, t, entries],
			);
			const beginApproval = async entry => {
				try {
					const approval = await callHost("/memory?view=approval&id=" + encodeURIComponent(entry.id));
					const target = approval.selection || approval.candidate;
					// 旧候选没有归属工作区时，用面板上已经填的工作区兜底，并把 comparisonDirty 置真：
					// 「确认合并并生效」必须先点一次「重新比较范围与主题」，让服务端校验这个范围，
					// 而不是直接提交去撞 invalid_project。
					const fallback = hasUsableWorkspace(target) ? "" : (manager.workspace || "").trim();
					setManager(previous => ({ ...previous, approval, selected: approval.conflicts.map(item => item.id), body: approval.candidate.body,
						approvalProject: target.project, approvalWorkspace: hasUsableWorkspace(target) ? target.workspace : fallback,
						approvalGlobal: target.workspace === "*", approvalTopicId: target.topicId || "", comparisonDirty: fallback !== "" }));
				} catch (failure) { setNotice({ tone: "err", text: failure.message }); }
			};
			const approvalChoice = () => ({ project: manager.approvalProject ?? manager.approval?.candidate.project,
				workspace: manager.approvalWorkspace ?? manager.approval?.candidate.workspace,
				global: manager.approvalGlobal ?? (manager.approval?.candidate.workspace === "*"),
				...(manager.approvalTopicId ? { topicId: manager.approvalTopicId } : {}) });
			const compareApproval = async () => {
				try {
					const params = new URLSearchParams({ view: "approval", id: manager.approval.candidate.id });
					for (const [key, item] of Object.entries(approvalChoice())) if (item !== undefined) params.set(key, String(item));
					const approval = await callHost("/memory?" + params.toString());
					setManager(previous => ({ ...previous, approval, selected: approval.conflicts.map(item => item.id), comparisonDirty: false,
						approvalProject: approval.selection.project, approvalWorkspace: approval.selection.workspace,
						approvalTopicId: approval.selection.topicId || "", approvalGlobal: approval.selection.workspace === "*" }));
				} catch (failure) { setNotice({ tone: "err", text: failure.message }); }
			};
			const confirmApproval = async () => {
				const current = manager.approval;
				if (!current || manager.comparisonDirty) return;
				try {
					await callHost("/memory", { action: "approve", id: current.candidate.id, expectedRevision: current.candidate.revision,
						...approvalChoice(), body: manager.body, supersedes: manager.selected, expectedRevisions: Object.fromEntries(current.conflicts.filter(item => manager.selected.includes(item.id)).map(item => [item.id, item.revision])) }, "POST");
					setManager(previous => ({ ...previous, approval: null })); setNotice({ tone: "ok", text: t("memoryApproved") }); await load();
				} catch (failure) { setNotice({ tone: "err", text: failure.message }); }
			};
			const loadRecoveries = async () => {
				try { const result = await callHost("/memory?view=receipts"); setManager(previous => ({ ...previous, recoveries: result.entries, inspection: null, confirmedMissing: false })); }
				catch (failure) { setNotice({ tone: "err", text: failure.message }); }
			};
			const recover = async (item, operation) => {
				try {
					const result = await callHost("/memory", { action: "recover", key: item.key, operation, expectedVersion: manager.inspection?.version ?? item.version, confirmedMissing: manager.confirmedMissing }, "POST");
					if (operation === "inspect") setManager(previous => ({ ...previous, inspection: { ...result, key: item.key }, confirmedMissing: false }));
					else { setNotice({ tone: "ok", text: "已完成核对与恢复" }); await loadRecoveries(); await load(); }
				} catch (failure) { setNotice({ tone: "err", text: failure.message }); }
			};

			const loadHandoff = useCallback(async () => {
				try {
					const params = new URLSearchParams({ view: "handoff" });
					if (project.trim()) params.set("project", project.trim());
					if (manager.workspace?.trim()) params.set("workspace", manager.workspace.trim());
					const card = await callHost("/memory?" + params.toString());
					setHandoff(typeof card?.markdown === "string" ? card.markdown : "");
				} catch (failure) {
					const message = failure && failure.message ? failure.message : String(failure);
					setNotice({ tone: "err", text: t("memoryFailed", { message }) });
				}
			}, [t, project, manager.workspace]);
			useEffect(() => { setHandoff(null); setManager(previous => ({ ...previous, checkup: null })); }, [project, manager.workspace]);
			const loadCheckup = async () => {
				try {
					const params = new URLSearchParams({ view: "checkup" });
					if (project.trim()) params.set("project", project.trim());
					if (manager.workspace?.trim()) params.set("workspace", manager.workspace.trim());
					const checkup = await callHost("/memory?" + params.toString());
					setManager(previous => ({ ...previous, checkup }));
				} catch (failure) { setNotice({ tone: "err", text: failure.message }); }
			};

			/**
			 * 主题漂移收敛：只保留最新那条，把更旧的标成「已被取代」。
			 *
			 * 这里是**用户点两次才动手**的数据变更，所以先在面板上把将作废的 id 与主题列出来，
			 * 确认足迹看得见再发请求；正文不会被删除，思源里仍能回看。
			 */
			const collapseDrift = async target => {
				try {
					const result = await callHost("/memory", { action: "collapse-topic-drift", project: target.project, workspace: target.workspace, keepId: target.keepId }, "POST");
					const count = Array.isArray(result?.superseded) ? result.superseded.length : 0;
					setNotice({ tone: "ok", text: count
						? "已收敛 " + count + " 条旧状态" + (result?.skipped ? "（另有 " + result.skipped + " 条受取代链上限保护，本次未动）" : "")
						: "这一组已经只有一条有效状态，无需收敛" });
					setDrift(null);
					await loadCheckup();
				} catch (failure) {
					const message = failure && failure.message ? failure.message : String(failure);
					setNotice({ tone: "err", text: message });
				}
			};
			// keepId 取组内 created 最大的主题；只有「比它更旧」的才可能被作废——与存储层同一条规则。
			const driftGroups = (manager.checkup?.topicDrift || []).map(group => {
				const topics = [...(group.topics || [])].sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
				const keep = topics[0];
				const stale = topics.slice(1).filter(item => item && keep && String(item.created || "") < String(keep.created || ""));
				return { project: group.project, workspace: group.workspace, topics, keep, stale };
			});

			useEffect(() => {
				if (notice === null) return undefined;
				const timer = setTimeout(() => setNotice(null), 2600);
				return () => clearTimeout(timer);
			}, [notice]);

			const chips = [];
			const typeOptions = ["", "preference", "fact", "decision", "state"];
			for (const value of typeOptions) {
				chips.push(
					h(
						"button",
						{
							key: "type:" + value,
							type: "button",
							className: "sy-mem-chip",
							"data-on": type === value ? true : undefined,
							onClick: () => setType(value),
						},
						value === "" ? t("memoryAll") : t(MEMORY_TYPE_LABEL[value]),
					),
				);
			}
			const statusOptions = ["", "candidate", "active", "superseded", "revoked"];
			const statusChips = statusOptions.map((value) =>
				h(
					"button",
					{
						key: "status:" + value,
						type: "button",
						className: "sy-mem-chip",
						"data-on": status === value ? true : undefined,
						onClick: () => setStatus(value),
					},
					value === "" ? t("memoryAll") : t(MEMORY_STATUS_LABEL[value]),
				),
			);

			// 最近 24 小时内生效的条目单独列在最上面：自动整理直接生效之后，「刚记了什么、记错了一键撤」比逐条事前确认更顺手。
			const recentRows = entries.filter(entry => {
				if (entry.status !== "active" || !/^\d{14}$/.test(entry.created || "")) return false;
				const c = entry.created;
				return Date.now() - new Date(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8), +c.slice(8, 10), +c.slice(10, 12), +c.slice(12, 14)).getTime() < 86400000;
			});
			const rows = entries.map((entry) => {
				const isOpen = openId === entry.id;
				const bodyText = typeof entry.body === "string" && entry.body !== "" ? entry.body : entry.statement;
				return h(
					"div",
					{ key: entry.id, "data-open": isOpen ? true : undefined },
					h(
						"button",
						{
							type: "button",
							className: "sy-mem-row",
							"data-open": isOpen ? true : undefined,
							onClick: () => setOpenId(isOpen ? "" : entry.id),
						},
						h("div", { className: "sy-mem-title" }, entry.statement),
						h(
							"div",
							{ className: "sy-mem-meta" },
							h(Badge, { tone: PALETTE[entry.type] }, t(MEMORY_TYPE_LABEL[entry.type] ?? "memoryTypeFact")),
							h("span", { title: entry.workspace || "旧条目未绑定工作区" }, (entry.project || "*") + (entry.topic ? " / " + entry.topic : "")),
							h("span", null, entry.confidence === "verified" ? "已核实" : entry.confidence === "stated" ? "用户表达" : "推断"),
							h("span", null, memoryStamp(entry.created)),
							// 被读过几次——一直是 0 的条目可能是噪音，这条信息让「记忆体有没有在起作用」可见。
							entry.refcount > 0
								? h("span", { title: t("memoryRefcountHint") }, t("memoryRefcount", { n: entry.refcount }))
								: null,
							entry.status !== "active"
								? h(Badge, { tone: "err" }, t(MEMORY_STATUS_LABEL[entry.status] ?? entry.status))
								: null,
							String(entry.source || "").startsWith("distill:") ? h("span", null, "自动整理") : null,
								entry.fresh ? h("span", null, "刚写入") : null,
						),
					),
					isOpen
						? h(
								"div",
								null,
								h("pre", { className: "sy-mem-body" }, bodyText),
								h("div", { className: "sy-mem-note" }, "来源：" + (entry.source || "未记录") + (entry.evidence ? "；依据：" + entry.evidence : "")),
								h("div", { className: "sy-mem-note" }, "适用范围：" + (entry.workspace === "*" ? "所有工作区" : entry.workspace || "待归属") + "；来源声明：" + (entry.confidence || "inferred") + "；记录于：" + memoryStamp(entry.created)),
								h(
									"div",
									{ className: "sy-mem-actions" },
									// 候选主按钮：条目自带可用范围就一键确认（沿用条目自己的项目与范围）；
									// 旧条目没有工作区时一键必然失败，同一个按钮改为打开确认弹窗（先选范围再确认）。
									entry.status === "candidate"
										? h("button", {
												type: "button",
												className: "sy-mem-btn",
												onClick: () => (hasUsableWorkspace(entry) ? void act("approve", entry.id) : void beginApproval(entry)),
											}, hasUsableWorkspace(entry) ? "确认生效" : "选范围后确认")
										: null,
									// 已经能一键确认的条目才需要第二个入口（改范围/正文、合并旧状态）；
									// 缺范围的条目，上面那个按钮已经打开了同一个弹窗。
									entry.status === "candidate" && hasUsableWorkspace(entry) ? h("button", { type: "button", className: "sy-mem-btn", onClick: () => void beginApproval(entry) }, t("memoryApprove")) : null,
									entry.status === "revoked"
										? h(
												"button",
												{ type: "button", className: "sy-mem-btn", onClick: () => void act("restore", entry.id) },
												t("memoryRestore"),
											)
										: h(
												"button",
												{ type: "button", className: "sy-mem-btn", onClick: () => void act("revoke", entry.id) },
												t("memoryRevoke"),
											),
									h(
										"button",
										{
											type: "button",
											className: "sy-mem-btn",
											onClick: () => {
												try {
													void navigator.clipboard?.writeText(entry.id);
													setNotice({ tone: "ok", text: t("memoryCopied") });
												} catch {
													/* 剪贴板不可用就算了，id 就在正文里 */
												}
											},
										},
										t("memoryCopyId"),
									),
								),
							)
						: null,
				);
			});

			return h(
				"div",
				{ className: "sy-mem" },
				h(
					"div",
					{ className: "sy-mem-head" },
					h("h2", null, t("memoryTitle")),
					h("button", { type: "button", className: "sy-mem-btn", onClick: () => void loadCheckup() }, "体检"),
					h("button", { type: "button", className: "sy-mem-btn", onClick: () => manager.recoveries === null ? void loadRecoveries() : setManager(previous => ({ ...previous, recoveries: null, inspection: null })) }, "写入恢复"),
					overview ? h(Badge, null, t("memoryCount", { n: entries.length })) : null,
					h(
						"button",
						{
							type: "button",
							className: "sy-mem-btn",
							onClick: () => {
								if (handoff === null) void loadHandoff();
								else setHandoff(null);
							},
						},
						handoff === null ? t("memoryHandoff") : t("memoryHandoffClose"),
					),
					h(
						"button",
						{ type: "button", className: "sy-mem-btn", onClick: () => void load(), disabled: loading },
						t("memoryRefresh"),
					),
				),
				h("div", { className: "sy-mem-filters" }, chips),
				h("div", { className: "sy-mem-filters" }, statusChips),
				h(
					"div",
					{ className: "sy-mem-filters" },
					h("input", {
						className: "sy-mem-input",
						placeholder: t("memoryProject"),
						value: project,
						onChange: (event) => setProject(event.target.value),
					}),
					h("input", { className: "sy-mem-input", "aria-label": "工作区范围", placeholder: "工作区路径（留空为全部工作区）", value: manager.workspace || "", onChange: event => setManager(previous => ({ ...previous, workspace: event.target.value })) }),
				),
				h("div", { className: "sy-mem-note" }, "范围：" + (manager.workspace || "全部工作区") + "；" + (project || "全部项目") + "。交接卡与体检沿用此范围。"),
				h("div", { className: "sy-mem-note" }, "记忆写入即生效；自动整理出来的条目带「自动整理」标记。记错了在这里一键撤销，改正文请到思源。"),
					// 会话级「不记录」必须看得见、撤得回：否则一句被误解的话会让整场会话悄悄不再记录。
					(manager.recording?.sessions || []).map(item => h("div", { key: "blocked:" + item.sessionId, className: "sy-mem-note", "data-tone": "warn" },
						h("span", null, "会话 " + (item.title || item.sessionId.slice(0, 8)) + " 已停止记录（" + (item.blockedBy === "panel" ? "在面板里暂停" : "对话里要求不记录") + "）。"),
						h("button", { type: "button", className: "sy-mem-btn", onClick: async () => { try { const result = await callHost("/memory", { action: "session-recording", sessionId: item.sessionId, enabled: true }, "POST"); setManager(previous => ({ ...previous, recording: { ...previous.recording, sessions: result.sessions } })); setNotice({ tone: "ok", text: "已恢复该会话的记录" }); } catch (failure) { setNotice({ tone: "err", text: failure.message }); } } }, "恢复记录"))),
					recentRows.length ? h("section", { className: "sy-mem-body", "aria-label": "最近新记" },
						h("strong", null, "最近 24 小时新记（" + recentRows.length + "）"),
						recentRows.slice(0, 8).map(entry => h("div", { key: "recent:" + entry.id, className: "sy-mem-meta" },
							String(entry.source || "").startsWith("distill:") ? h(Badge, null, "自动整理") : null,
							h("span", { style: { flex: "1 1 auto", minWidth: 0 } }, entry.statement),
							h("button", { type: "button", className: "sy-mem-btn", onClick: () => void act("revoke", entry.id) }, "撤销")))) : null,
				manager.checkup ? h("section", { className: "sy-mem-body", "aria-label": "记忆体检" },
					h("h3", null, "记忆体检"), h("p", null, "已检查 " + manager.checkup.total + " 条，其中 " + manager.checkup.active + " 条有效。" + (manager.checkup.complete === false ? "仅检查最近 " + manager.checkup.scannedLimit + " 条，结果不完整。" : "")),
					[["重复条目", "duplicates"], ["疑似相似", "similar"], ["过期状态", "staleStates"], ["取代关系异常", "brokenChains"], ["可归档", "archiveCandidates"]].map(([label, key]) => h("div", { key },
						h("strong", null, label + "：" + (manager.checkup[key]?.length || 0)), (manager.checkup[key] || []).map((item, index) => h("p", { key: index }, (item.statement || item.leftText || item.id || "") + (item.reason ? "；" + item.reason : "")))))) : null,
				manager.checkup && driftGroups.length ? h("section", { className: "sy-mem-body", "aria-label": "主题漂移" },
					h("h3", null, "主题漂移（" + driftGroups.length + " 组）"),
					h("p", null, "同一个项目里有多条有效状态、主题却不止一个：常驻注入与召回会同时看到它们。收敛只作废「比保留项更旧」的状态，更新的不动，正文也不会删除。"),
					driftGroups.map(group => h("div", { key: "drift:" + group.project + ":" + group.workspace, className: "sy-mem-note", "data-tone": "warn" },
						h("strong", null, (group.project || "*") + "（" + group.topics.length + " 个主题）"),
						h("div", null, "保留最新：" + (group.keep?.topic || "未命名") + "（" + memoryStamp(group.keep?.created) + "）"),
						group.stale.length
							? h("div", null,
								group.stale.map(item => h("p", { key: "stale:" + item.id }, "将作废：" + (item.topic || "未命名") + " · " + String(item.statement || "").slice(0, 40))),
								drift && drift.confirming && drift.project === group.project && drift.workspace === group.workspace
									? h("div", null,
										h("p", null, "确认后会把 " + drift.stale.length + " 条旧状态标为「已被取代」：" + drift.stale.map(item => item.topic || item.id).join("、") + "。正文保留在思源里，可随时回看或恢复。"),
										h("button", { type: "button", className: "sy-mem-btn", onClick: () => void collapseDrift(drift) }, "确认收敛（" + drift.stale.length + " 条）"),
										h("button", { type: "button", className: "sy-mem-btn", onClick: () => setDrift(null) }, "取消"))
									: h("button", { type: "button", className: "sy-mem-btn", onClick: () => setDrift({ confirming: true, project: group.project, workspace: group.workspace, keepId: group.keep.id, stale: group.stale }) }, "只保留最新"))
							: h("div", null, "只有一条更新的主题，无需收敛。")
					))) : null,
				notice ? h("div", { className: "sy-mem-note", "data-tone": notice.tone }, notice.text) : null,
				manager.approval ? h("section", { className: "sy-mem-body", "aria-label": "比较并确认记忆" },
					h("h3", null, manager.approval.candidate.type === "state" ? "比较并确认状态" : "核对记忆与适用范围"),
					h("p", null, "请核对正文、原始依据和适用范围；选择旧条目时保留尚未完成的事项。"),
					h("p", null, "来源：" + (manager.approval.candidate.source || "未知") + "；依据：" + (manager.approval.candidate.evidence || "尚未提供")),
					h("div", { className: "sy-mem-review-fields" },
					h("label", null, h("input", { type: "checkbox", checked: approvalChoice().global, onChange: event => setManager(previous => ({ ...previous, approvalGlobal: event.target.checked, comparisonDirty: true, approvalTopicId: "" })) }), "适用于所有工作区"),
					h("label", null, "项目", h("input", { "aria-label": "记忆项目", value: manager.approvalProject ?? manager.approval.candidate.project, disabled: approvalChoice().global,
						onChange: event => setManager(previous => ({ ...previous, approvalProject: event.target.value, comparisonDirty: true, approvalTopicId: "" })) })),
					h("label", null, "工作区路径", h("input", { "aria-label": "记忆工作区", value: manager.approvalWorkspace ?? manager.approval.candidate.workspace ?? "", disabled: approvalChoice().global,
						onChange: event => setManager(previous => ({ ...previous, approvalWorkspace: event.target.value, comparisonDirty: true, approvalTopicId: "" })) })),
					manager.approval.candidate.type === "state" ? h("label", null, "任务主题", h("select", { "aria-label": "记忆任务主题", value: manager.approvalTopicId || "",
						onChange: event => setManager(previous => ({ ...previous, approvalTopicId: event.target.value, comparisonDirty: true })) },
						h("option", { value: "" }, "保留当前主题：" + manager.approval.candidate.topic),
						(manager.approval.topics || []).map(item => h("option", { key: item.id, value: item.id }, item.topic)))) : null),
					manager.comparisonDirty ? h("button", { type: "button", className: "sy-mem-btn", onClick: () => void compareApproval() }, "重新比较范围与主题") : null,
					manager.approval.conflicts.map(item => h("div", { key: item.id },
						h("label", null, h("input", { type: "checkbox", checked: manager.selected.includes(item.id), onChange: event => setManager(previous => ({ ...previous, selected: event.target.checked ? [...previous.selected, item.id] : previous.selected.filter(id => id !== item.id) })) }), "取代这条旧状态"),
						h("pre", null, item.body))),
					h("label", null, "确认后的正文", h("textarea", { value: manager.body, rows: 7, style: { width: "100%", boxSizing: "border-box" }, onChange: event => setManager(previous => ({ ...previous, body: event.target.value })) })),
					h("button", { type: "button", className: "sy-mem-btn", disabled: manager.comparisonDirty === true, onClick: () => void confirmApproval() }, "确认合并并生效"),
					h("button", { type: "button", className: "sy-mem-btn", onClick: () => setManager(previous => ({ ...previous, approval: null })) }, "取消")) : null,
				manager.recording ? h("div", { className: "sy-mem-note" },
					h("span", null, "自动整理与工具写入：" + (manager.recording.enabled ? "已开启" : "已关闭") + (manager.recording.locked ? "（环境变量控制）" : "")),
					h("button", { type: "button", className: "sy-mem-btn", disabled: manager.recording.locked, onClick: async () => { try { const recording = await callHost("/memory", { action: "recording", enabled: !manager.recording.enabled }, "POST"); setManager(previous => ({ ...previous, recording })); setNotice({ tone: "ok", text: recording.enabled ? "已开启记录；明确要求不记录的会话仍保持关闭" : "已停止记录并取消尚未执行的写入" }); } catch (failure) { setNotice({ tone: "err", text: failure.message }); } } }, manager.recording.enabled ? "关闭记录" : "开启记录"),
					manager.recording.error ? h("span", null, manager.recording.error) : null) : null,
				manager.recoveries !== null ? h("section", { className: "sy-mem-body", "aria-label": "写入恢复" },
					h("h3", null, "未完成写入"),
					manager.recoveries.length ? manager.recoveries.map(item => h("div", { key: item.key },
						h("p", null, (item.project || "历史记忆") + " · " + (item.id || "尚未确认落盘")),
						h("button", { type: "button", className: "sy-mem-btn", onClick: () => void recover(item, "inspect") }, "检查当前结果"),
						manager.inspection?.key === item.key ? h("div", null,
							h("p", null, manager.inspection.message || "已读取当前状态；可以核对完成或恢复旧属性。"),
							!manager.inspection.legacy && manager.inspection.matches?.length ? h("button", { type: "button", className: "sy-mem-btn", onClick: () => void recover(item, "resume") }, "核对并继续") : null,
							item.kind === "mutation" ? h("button", { type: "button", className: "sy-mem-btn", onClick: () => void recover(item, "rollback") }, "恢复修改前状态") : null,
							!item.id && item.kind !== "mutation" && !manager.inspection.matches?.length ? h("div", null,
								h("label", null, h("input", { type: "checkbox", checked: manager.confirmedMissing, onChange: event => setManager(previous => ({ ...previous, confirmedMissing: event.target.checked })) }), "我已在思源确认这次内容没有写入"),
								h("button", { type: "button", className: "sy-mem-btn", disabled: !manager.confirmedMissing, onClick: () => void recover(item, "forget") }, "解除本次重试限制")) : null) : null)) : h("p", null, "没有待处理的写入。"),
					h("button", { type: "button", className: "sy-mem-btn", onClick: async () => { try { const result = await callHost("/memory", { action: "cleanup-receipts" }, "POST"); setNotice({ tone: "ok", text: "已清理 " + result.removed + " 份已同步的完成凭据" }); await loadRecoveries(); } catch (failure) { setNotice({ tone: "err", text: failure.message }); } } }, "清理已完成凭据")) : null,
				handoff !== null
					? h(
							"div",
							{ className: "sy-mem-filters" },
							h("div", { className: "sy-mem-meta" }, t("memoryHandoffHint")),
							h(
								"button",
								{
									type: "button",
									className: "sy-mem-btn",
									onClick: () => {
										try {
											void navigator.clipboard?.writeText(handoff);
											setNotice({ tone: "ok", text: t("memoryCopied") });
										} catch {
											/* 剪贴板不可用就手动选中复制 */
										}
									},
								},
								t("memoryHandoffCopy"),
							),
						)
					: null,
				handoff !== null ? h("pre", { className: "sy-mem-body" }, handoff) : null,
				error !== null
					? h("div", { className: "sy-mem-note", "data-tone": "err" }, t("memoryFailed", { message: error }))
					: null,
				loading
					? h("div", { className: "sy-mem-note" }, t("memoryLoading"))
					: rows.length === 0
						? h("div", { className: "sy-mem-note" }, t("memoryEmpty"))
						: h("div", { className: "sy-mem-list" }, rows),
			);
		}

		/**
		 * 记忆面板的宿主：和编辑器面板一样用 boundary 兜住渲染异常——
		 * 一个区域炸掉不应该让整个 slot 变成空白。
		 */
		function MemoryHost(props) {
			const label = typeof props.t === "function" ? props.t("memory") : "Memory";
			return h(PanelBoundary, { label }, h(MemoryPage, props));
		}

		function makeTranslate(provided) {
			if (typeof provided === "function") return provided;
			return (key, params) => {
				let template = zh[key] ?? key;
				if (params) template = template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
				return template;
			};
		}

		function apply(ctx) {
			ctx.effect(() => {
				try {
					return ctx.locale.register(NS, { zh, en });
				} catch {
					return () => {};
				}
			}, "siyuan-notes: locale");
			installStyles(ctx);

			let t = makeTranslate(null);
			try {
				t = ctx.locale.bind(NS);
			} catch {
				t = makeTranslate(null);
			}

			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: PANEL_ID,
						locale: NS,
						// Optional access keeps this working even if a hot reload preserved the
						// pre-existing inject list: cordis throws on an uninjected service read.
						inject: () => ({
							sessions: typeof ctx.get === "function" ? ctx.get("sessions") : undefined,
							// The workspace UI owns "new conversation"; optional so the panel still
							// works on a profile without it.
							uiWorkspace: typeof ctx.get === "function" ? ctx.get("uiWorkspace") : undefined,
						}),
						// Declaring one session-scoped child is what makes the renderer hand this
						// entry a `SessionProvider`; the panel uses it to bind the embedded
						// conversation to a session without owning one itself.
						children: {
							"siyuan.notes.anchor": {
								kind: "list",
								scope: "session",
							},
						},
					},
					PanelHost,
				),
			);

			// Publishes the composer's actions from inside whichever conversation is
			// mounted (the embedded one below the editor), so the toolbar can quote into it.
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.input.dock",
						id: "siyuan-notes-composer-bridge",
						order: 900,
					},
					ComposerBridge,
				),
			);

			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 20,
						locale: NS,
						label: () => t("panel"),
					},
					SidebarIcon,
				),
			);

			// 记忆面板：独立的侧栏入口与主面板，和编辑器面板互不干扰。
			// 它刻意不声明 `children`——记忆体不需要会话，也不该绑上一个。
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: MEMORY_PANEL_ID,
						locale: NS,
					},
					MemoryHost,
				),
			);
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: MEMORY_PANEL_ID,
						order: 21,
						locale: NS,
						label: () => t("memory"),
					},
					MemoryIcon,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		// Pure helpers and the pane components, exposed for the bundle's own node-based checks.
		exports.__test = { splitKramdown, splitMarkdown, planSync, markdownToHtml, cleanBlockText, outlineOf, createdBlockId, indentParagraphs, unindentParagraphs, bareParagraphLines, autoIndentParagraph, autoIndentTextarea, typingIndentPlan, caretAfterIndent, isParagraphLine, normalizeText, trimEdges, locateQuote, selectionBarPosition, INDENT_UNIT, continueOnEnter, stripBlockMark, changeIndent, hotkeyOf, HOTKEYS, INLINE_FORMATS, AUTO_PAIRS, wrapSelection, autoPairAction, diffRange, replaceRange, scrollSyncTop, countText, lineRange, isTypingInput, typingMeter, revealKeys, hasLeadingSpace, restoreFirstLead, readDocumentText, firstBlockLead, expansionSnapshot, withRevealedDocuments, documentLocation, documentUnchanged, assetPreviewUrl, parseImageIal, filenameToAlt, imageLineOf, splitEditorSegments, editorSegments, joinEditorSegments, replaceSegmentText, withSegmentText, segmentIndexForLine, segmentIndexForOffset, nearestTextSegment, assetDisplayName, imageSyntaxWithWidth, IMAGE_WIDTH_PRESETS };

		exports.__panes = { EditorPane, NativeEditorPane, nativeControllers, acceptNativeMessage, TreePane, ConnectCard, PanelPage, PanelHost, ComposerBridge, composerBridge, PanelBoundary, buildChatSurfaces, chatFactoryProps, sessionHistoryItems, MemoryPage, MemoryHost, MemoryIcon, memoryStamp };
		/**
		 * PanelPage state slots, in  call order. Tests seed state by index, so this
		 * is the contract between the panel and its render tests; keep it in step.
		 */
		exports.__stateSlots = {
			connection: 0,
			panes: 1,
			activePaneKey: 2,
			stamps: 3,
			expanded: 4,
			expandedReady: 5,
			caretRequest: 6,
			chatSurface: 7,
			floatCollapsed: 8,
			floatBox: 9,
			sessionOverride: 10,
			historyOpen: 11,
			sessionRefState: 12,
			notice: 13,
			dialog: 14,
		};
		exports.__paneModel = { makePane, makeTab, withTabAdded, withTabClosed, withoutDoc, layoutSnapshot, layoutToPanes, mergeRestoredPanes };
		exports.__dicts = { zh, en };
		return module.exports;
	},
});
