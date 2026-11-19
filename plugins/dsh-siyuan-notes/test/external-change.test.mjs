// 外部变更闸门（design §11 / task-5）的行为用例。
//
// 为什么必须有这道闸：面板的保存是「planSync 比对 buffer 与上次读回的块」，文档被外部改过
// （AI 插图工具、思源端编辑、另一个面板）时，外部新增的块会被算成「多余块」删掉。
//
// 这些用例**只看行为**：驱动真实 EditorPane 的 save()，数内核写调用的次数与参数、
// 看提示条有没有出现、按钮点下去之后到底写没写。不查源码字符串。
//
// 装载方式与 test/autosave-stability.test.mjs 一致（stub React + mock fetch），
// 但这里的 stub React 带**真的 useState 与重渲染**：「点按钮 → 提示条出现/消失」
// 必须经过真实渲染才有意义。下面的假内核会**真的记账**（写入后改自己的块表），
// 所以保存后的校验读回能立刻收敛，不需要等 250ms 的轮询。
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const SRC = new URL("../lib/client.js", import.meta.url);

// 这个宿主会真的跑 effect（否则看不到「点按钮 → 提示条变化」），而面板里那个「每秒刷新
// 打字速率」的 setInterval 会一直活着、让 node --test 跑完也不退出。本文件不测打字计量，
// 直接掐掉它；只掐 setInterval，setTimeout 保持真实（用例 6 会临时换成 mock timers）。
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

// ---------------------------------------------------------------- 最小 React（真状态 + 重渲染）
const hooks = [];
let cursor = 0;
let dirty = false;
let registered = null;
let effectSlots = [];
let renderedEffects = [];

class StubComponent {
	constructor(props) {
		this.props = props ?? {};
		this.state = this.state ?? {};
	}
	setState(next) {
		this.state = { ...this.state, ...(typeof next === "function" ? next(this.state) : next) };
	}
}

const ReactStub = {
	Component: StubComponent,
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState(initial) {
		const index = cursor++;
		if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial, queue: [] };
		const slot = hooks[index];
		if (slot.queue.length > 0) {
			for (const next of slot.queue) slot.value = typeof next === "function" ? next(slot.value) : next;
			slot.queue = [];
		}
		return [
			slot.value,
			(next) => {
				slot.queue.push(next);
				dirty = true;
			},
		];
	},
	useRef(value) {
		const index = cursor++;
		if (!hooks[index]) hooks[index] = { current: value };
		return hooks[index];
	},
	useMemo: (factory) => factory(),
	useCallback: (fn) => fn,
	useEffect(fn, deps) {
		renderedEffects.push({ index: cursor++, fn, deps });
	},
	useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

globalThis.window = {
	__ModuleLoader__: {
		load({ id, factory }) {
			registered = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) };
		},
	},
};
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { EditorPane } = registered.exports.__panes;
const { documentUnchanged, splitMarkdown, splitKramdown } = registered.exports.__test;

const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);

// ---------------------------------------------------------------- harness
function findAll(node, hit, out = []) {
	if (node === null || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const child of node) findAll(child, hit, out);
		return out;
	}
	if (hit(node)) out.push(node);
	for (const child of node.children ?? []) findAll(child, hit, out);
	return out;
}

let lastTree = null;
let doc = null;
let notices = [];

/**
 * 树上任意位置出现这段文案（提示条的文字是 span，动作是 button）。
 *
 * 匹配口径：全等，或 `键{"参数":…}` 这种**带插值**的文案（t 是 stub，插值会产生
 * `changeUnverified{"msg":"内核超时"}`）。刻意不用裸 `includes`：那样 `changeReload`
 * 会被 `changeReloadXxx` 之类的前缀键误满足。当前字典里 change* 六键互不为前缀，
 * 但把口径收紧在这儿，将来加键也不会悄悄放松断言。
 */
const hasText = (text) =>
	findAll(lastTree, (node) => (node.children ?? []).some((child) => typeof child === "string" && (child === text || child.startsWith(text + "{")))).length > 0;
/** 按文案找按钮（按钮文案不带插值，用全等，避免误匹配）。 */
const buttonByText = (text) => findAll(lastTree, (node) => node.type === "button" && (node.children ?? []).includes(text))[0];
/** 保存按钮：工具栏里那个 accent 按钮（文案包在 span 里，不能按文字找）。 */
const saveButton = () => findAll(lastTree, (node) => node.type === "button" && node.props && node.props["data-tone"] === "accent")[0];

/** 点一个按钮，并且把「找不到」说清楚（否则只会得到一句 TypeError）。 */
function click(text) {
	const node = buttonByText(text);
	assert.ok(node, `当前界面上找不到按钮「${text}」——提示条没出现？`);
	node.props.onClick();
}

function clickSave() {
	const node = saveButton();
	assert.ok(node, "工具栏里找不到保存按钮");
	node.props.onClick();
}

function render() {
	cursor = 0;
	renderedEffects = [];
	lastTree = EditorPane({
		t,
		client: harness.client,
		doc,
		setDoc: (next) => {
			doc = typeof next === "function" ? next(doc) : next;
			dirty = true;
		},
		onReload: () => {
			harness.reloads++;
		},
		onRename: () => {},
		onRemove: () => {},
		view: "split",
		setView: () => {},
		autoSave: harness.autoSave,
		setAutoSave: () => {},
		onNotice: (payload) => notices.push(payload),
		stale: false,
		onSaved: () => {},
		indentOn: false,
		onIndentChange: () => {},
		onQuote: () => {},
		onCaret: () => {},
		caretRequest: null,
	});
	// effect：deps 变了才重跑（与 React 一致）
	for (const effect of renderedEffects) {
		const slot = effectSlots[effect.index];
		const same =
			slot &&
			Array.isArray(slot.deps) &&
			Array.isArray(effect.deps) &&
			slot.deps.length === effect.deps.length &&
			slot.deps.every((value, index) => value === effect.deps[index]);
		if (same) continue;
		if (slot && typeof slot.cleanup === "function") slot.cleanup();
		const cleanup = effect.fn();
		effectSlots[effect.index] = { deps: effect.deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
	}
}

/** 推微任务（mock 了 setTimeout 的用例里只能用这个）。 */
async function flush(rounds = 60) {
	for (let i = 0; i < rounds; i++) {
		await Promise.resolve();
		if (dirty) {
			dirty = false;
			render();
		}
	}
}

/** 微任务 + 一个真实 macrotask：等一条保存的 async 链跑完。 */
async function settle() {
	await flush();
	await new Promise((resolve) => setTimeout(resolve, 5));
	await flush();
}

/** 等一段真实时间（自动保存那条用例要跨过 2.2 秒的定时器）。 */
async function sleep(ms) {
	await new Promise((resolve) => setTimeout(resolve, ms));
	await flush();
}

const harness = { client: null, autoSave: false, reloads: 0 };

/** 假内核：一份块表 + kramdown 渲染，写调用会**真的改动块表**。 */
function makeKernel(kramdown) {
	const blocks = splitKramdown(kramdown)
		.filter((block) => block.id != null)
		.map((block) => ({ id: block.id, text: block.text }));
	return {
		blocks,
		reads: 0,
		asKramdown() {
			return this.blocks.map((block) => block.text + "\n" + '{: id="' + block.id + '"}').join("\n\n");
		},
		update(id, text) {
			const row = this.blocks.find((block) => block.id === id);
			if (row) row.text = text;
		},
		insertAfter(previousId, text) {
			const at = this.blocks.findIndex((block) => block.id === previousId);
			const id = "new-" + (this.blocks.length + 1);
			this.blocks.splice(at === -1 ? this.blocks.length : at + 1, 0, { id, text });
			return id;
		},
		prepend(text) {
			const id = "new-" + (this.blocks.length + 1);
			this.blocks.unshift({ id, text });
			return id;
		},
		remove(id) {
			this.blocks = this.blocks.filter((block) => block.id !== id);
		},
	};
}

/**
 * 挂一栏编辑器。
 * @param {{text:string, savedText?:string, disk:string, autoSave?:boolean, failReads?:boolean}} options
 *   `text` 面板缓冲区，`savedText` 上次保存点，`disk` 内核此刻的 kramdown。
 */
function mount(options) {
	hooks.length = 0;
	effectSlots = [];
	cursor = 0;
	dirty = false;
	notices = [];
	harness.reloads = 0;
	harness.autoSave = options.autoSave === true;
	const calls = [];
	const kernel = makeKernel(options.disk ?? "");
	harness.kernel = kernel;
	// 读失败用一个**开关**控制，而不是替换掉整个 client：替换会绕开下面这份记账，
	// 「重试之后写没写」就数不出来了（这条用例一开始就是这么红的）。
	harness.readFailure = options.failReads === true;
	harness.client = {
		async api(path, payload) {
			calls.push({ path, payload });
			if (path === "/api/block/getBlockKramdown") {
				if (harness.readFailure) throw new Error("内核超时");
				kernel.reads++;
				return { kramdown: kernel.asKramdown() };
			}
			if (path === "/api/query/sql") return [];
			if (path === "/api/block/updateBlock") {
				kernel.update(payload.id, payload.data);
				return [{ doOperations: [{ action: "update", id: payload.id }] }];
			}
			if (path === "/api/block/insertBlock") {
				const id = kernel.insertAfter(payload.previousID, payload.data);
				return [{ doOperations: [{ action: "insert", id }] }];
			}
			if (path === "/api/block/prependBlock") {
				const id = kernel.prepend(payload.data);
				return [{ doOperations: [{ action: "insert", id }] }];
			}
			if (path === "/api/block/deleteBlock") {
				kernel.remove(payload.id);
				return {};
			}
			return {};
		},
	};
	doc = {
		id: "doc1",
		title: "文档",
		text: options.text,
		savedText: options.savedText === undefined ? options.text : options.savedText,
		// 面板上次已知的块表（真实面板打开文档时就是这样带进来的）：
		// 「读失败 + 跳过检测」那条路径要靠它当基线。
		blocks: kernel.blocks.map((block) => ({ id: block.id, text: block.text })),
		loading: false,
		saving: false,
		error: null,
		savedAt: null,
		stamp: 0,
	};
	render();
	const writes = () => ({
		updateBlock: calls.filter((row) => row.path === "/api/block/updateBlock"),
		insertBlock: calls.filter((row) => row.path === "/api/block/insertBlock"),
		prependBlock: calls.filter((row) => row.path === "/api/block/prependBlock"),
		deleteBlock: calls.filter((row) => row.path === "/api/block/deleteBlock"),
		all: calls.filter((row) => /block\/(update|insert|prepend|delete)Block$/.test(row.path)),
	});
	return { calls, writes, kernel };
}

/** 用隔离的成功快照替代真实宿主，备份失败由专门用例覆盖。 */
async function withNoHost(run) {
	const original = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { file: "test-backup.md" } }) });
	try {
		await run();
	} finally {
		globalThis.fetch = original;
	}
}

const EXTERNAL_DISK = '第一段\n{: id="b1"}\n\n![图](assets/ai.png)\n{: id="b2"}';
const PLAIN_DISK = '第一段\n{: id="b1"}';

test("图片上传尚未结束时切标签或卸载，不得改写任一文档正文", async () => {
	for (const scenario of ["switch", "unmount", "switch-back"]) {
		mount({ text: "A原文", savedText: "A原文", disk: 'A原文\n{: id="b1"}' });
		let release;
		harness.client.uploadAsset = () => new Promise((resolve) => { release = resolve; });
		render();
		findAll(lastTree, (node) => node.type === "input" && node.props.type === "file")[0].props.onChange({ target: { files: [{ name: "a.png", type: "image/png", size: 10 }], value: "" } });
		await flush();
		const a = doc;
		if (scenario !== "switch") for (const slot of effectSlots) slot?.cleanup?.();
		if (scenario !== "unmount") {
			doc = { ...a, id: "B", text: "B原文", savedText: "B原文" };
			render();
			if (scenario === "switch-back") { doc = a; render(); }
		}
		release("assets/a.png");
		await settle();
		assert.equal(a.text, "A原文");
		assert.equal(doc.text, scenario === "switch" ? "B原文" : "A原文");
		assert.ok(notices.some((notice) => notice.text === "uploadCancelled"));
	}
});

test("空文档被外部增加正文和图片后，保存不得覆盖或删除任何块", async () => {
	await withNoHost(async () => {
		const { writes } = mount({ text: "本地新正文", savedText: "", disk: EXTERNAL_DISK });
		doc = { ...doc, blocks: [], baselineLoaded: true };
		render();
		clickSave();
		await settle();
		assert.deepEqual(writes().all, []);
		assert.equal(hasText("changeExternal"), true);
		assert.equal(doc.savedText, "");
	});
});

test("校验不一致保留未保存状态，修复网络后重试不会重复插入", async () => {
	await withNoHost(async () => {
		const { kernel, writes } = mount({ text: "第一段改", savedText: "第一段", disk: PLAIN_DISK });
		const realUpdate = kernel.update.bind(kernel);
		kernel.update = () => {};
		clickSave();
		await sleep(1400);
		assert.equal(doc.savedText, "第一段");
		assert.notEqual(doc.text, doc.savedText);
		assert.ok(doc.error, "校验失败不能只剩一条会消失的提示");
		assert.equal(notices.some((n) => n.tone === "ok"), false);
		kernel.update = realUpdate;
		clickSave();
		await settle();
		assert.equal(doc.savedText, "第一段改");
		assert.equal(writes().insertBlock.length + writes().prependBlock.length, 0);
	});
});

test("写入成功但校验断网后，重试只确认落盘，不重复追加", async () => {
	await withNoHost(async () => {
		const { kernel, writes } = mount({ text: "第一段\n\n追加段", savedText: "第一段", disk: PLAIN_DISK });
		const api = harness.client.api;
		let failVerify = true;
		harness.client.api = async (path, payload) => {
			if (path.endsWith("/getBlockKramdown") && kernel.reads > 0 && failVerify) throw new Error("校验时断网");
			return api(path, payload);
		};
		clickSave();
		await settle();
		assert.equal(doc.savedText, "第一段");
		assert.equal(notices.some((n) => n.tone === "ok"), false);
		const written = writes().all.length;
		failVerify = false;
		clickSave();
		await settle();
		assert.equal(writes().all.length, written, "已落盘的插入不能重放");
		assert.equal(doc.savedText, doc.text);
		assert.equal(doc.error, null);
	});
});

test("备份失败时不得修改内核，并给出可重试错误", async () => {
	await withNoHost(async () => {
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: PLAIN_DISK });
		globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ ok: false, error: { code: "backup_failed", message: "磁盘已满" } }) });
		clickSave();
		await settle();
		assert.deepEqual(writes().all, []);
		assert.equal(doc.savedText, "第一段");
		assert.match(doc.error, /磁盘已满/);
		assert.equal(notices.some((n) => n.tone === "ok"), false);
	});
});

test("未确认保存期间继续输入，重试只写新增内容", async () => {
	await withNoHost(async () => {
		const { kernel, writes } = mount({ text: "第一段\n\n第二段", savedText: "第一段", disk: PLAIN_DISK });
		const api = harness.client.api;
		let failVerify = true;
		harness.client.api = async (path, payload) => {
			if (path.endsWith("/getBlockKramdown") && kernel.reads > 0 && failVerify) throw new Error("读回断网");
			return api(path, payload);
		};
		clickSave();
		await settle();
		doc = { ...doc, text: doc.text + "\n\n第三段" };
		render();
		failVerify = false;
		clickSave();
		await settle();
		assert.deepEqual(kernel.blocks.map((block) => block.text), ["第一段", "第二段", "第三段"]);
		assert.equal(writes().insertBlock.length, 2);
		assert.equal(doc.savedText, doc.text);
	});
});

test("部分落盘后重试先确认冲突，用户覆盖后仅补缺失段落", async () => {
	await withNoHost(async () => {
		const { kernel, writes } = mount({ text: "第一段\n\n第二段\n\n第三段", savedText: "第一段", disk: PLAIN_DISK });
		const api = harness.client.api;
		let insertCalls = 0;
		harness.client.api = async (path, payload) => {
			if (path.endsWith("/insertBlock") && ++insertCalls === 2) throw new Error("第二次写入失败");
			return api(path, payload);
		};
		clickSave();
		await settle();
		assert.equal(doc.savedText, "第一段");
		clickSave();
		await settle();
		assert.equal(hasText("changeExternal"), true);
		assert.equal(writes().insertBlock.length, 1);
		click("changeOverwrite");
		await settle();
		assert.deepEqual(kernel.blocks.map((block) => block.text), ["第一段", "第二段", "第三段"]);
		assert.equal(writes().insertBlock.length, 2);
		assert.equal(doc.savedText, doc.text);
	});
});

// ---------------------------------------------------------------- 1. 纯函数：块级比较
test("documentUnchanged：按块比较，版面差异不算外部改动", () => {
	assert.equal(documentUnchanged([{ id: "b1", text: "第一段" }], "第一段"), true, "一致");
	assert.equal(documentUnchanged([{ id: "b1", text: "第一段" }], "第一段\n\n"), true, "尾随空行不算改动（内核没有这个块）");
	assert.equal(documentUnchanged([{ id: "b1", text: "第一段" }], "第一段\n\n\n\n第二段"), false, "真的多了内容就是改动");
	assert.equal(documentUnchanged([{ id: "b1", text: "第一段" }, { id: "b2", text: "AI 插的图" }], "第一段"), false, "外部插了一个块就是改动");
	assert.equal(documentUnchanged([{ id: "b1", text: "改过的" }], "第一段"), false, "外部把内容改了也算");
	assert.equal(documentUnchanged([{ id: "b1", text: "第一段" }], ""), false, "已读取的空文档也是有效基线，外部新增必须被识别");
	assert.equal(splitMarkdown("第一段\n\n").length, 1, "口径自检：splitMarkdown 只看块");
});

// ---------------------------------------------------------------- 2. 冲突：一个字都不写
test("外部改动：保存不写内核，并浮出冲突提示条", async () => {
	await withNoHost(async () => {
		// 面板上次读入的是「第一段」；磁盘现在多了 AI 插进来的图；用户本地改成了「第一段改」。
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: EXTERNAL_DISK });
		const save = saveButton();
		assert.ok(save, "保存按钮在（工具栏 accent 按钮）");
		clickSave();
		await settle();

		assert.deepEqual(writes().all, [], "冲突时 0 次写内核（updateBlock/insertBlock/prependBlock/deleteBlock 都不许有）");
		assert.equal(doc.saving, false, "不留在「保存中」状态");
		assert.equal(hasText("changeExternal"), true, "提示条出现：文档已被外部修改");
		assert.ok(buttonByText("changeOverwrite"), "提供「仍要保存（覆盖）」");
		assert.ok(buttonByText("changeReload"), "提供「重新读取」");
	});
});

// ---------------------------------------------------------------- 3. 覆盖必须用户点，且点了才写
test("点「仍要保存（覆盖）」之后这次真的写，且提示条消失", async () => {
	await withNoHost(async () => {
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: EXTERNAL_DISK });
		clickSave();
		await settle();
		assert.deepEqual(writes().all, [], "先确认这一轮没写");

		click("changeOverwrite");
		await settle();

		const written = writes();
		assert.equal(written.updateBlock.length, 1, "用户确认后写了一次 updateBlock");
		assert.equal(written.updateBlock[0].payload.id, "b1", "改的是原先那一块");
		assert.equal(written.updateBlock[0].payload.data, "第一段改", "写的是用户的缓冲区");
		assert.equal(written.deleteBlock.length, 1, "外部那份与缓冲区不一致的块按「覆盖」语义删掉");
		assert.equal(hasText("changeExternal"), false, "写成功后提示条消失");
		assert.equal(doc.savedText, "第一段改", "保存点更新为刚写的缓冲区");
	});
});

// ---------------------------------------------------------------- 4. 无外部改动：照常保存
test("磁盘等于保存点：直接保存，不弹提示", async () => {
	await withNoHost(async () => {
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: PLAIN_DISK });
		clickSave();
		await settle();

		const written = writes();
		assert.equal(written.updateBlock.length, 1, "没有冲突就直接写");
		assert.equal(written.updateBlock[0].payload.data, "第一段改");
		assert.equal(written.deleteBlock.length, 0, "不许删任何块");
		assert.equal(hasText("changeExternal"), false, "不弹冲突提示");
		assert.equal(hasText("changeUnverified"), false, "也不弹「无法确认」");
	});
});

// ---------------------------------------------------------------- 5. 读失败 ≠ 外部改动
test("读失败：不算外部改动、也不静默写；重试成功后照常保存", async () => {
	await withNoHost(async () => {
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: PLAIN_DISK, failReads: true });
		clickSave();
		await settle();

		assert.deepEqual(writes().all, [], "读不出来就不写（既不能误报冲突，也不能拿空 original 去 planSync）");
		assert.equal(hasText("changeExternal"), false, "不能报成「文档已被外部修改」");
		assert.equal(hasText("changeUnverified"), true, "要给「无法确认」的提示（含原因）");
		assert.ok(buttonByText("changeRetry"), "并给出可重试的动作");
		assert.ok(buttonByText("changeSkipCheck"), "也允许用户明确跳过检测再写");

		// 读数恢复、磁盘仍是保存点 → 重试后正常写入
		harness.readFailure = false;
		click("changeRetry");
		await settle();
		assert.equal(writes().updateBlock.length, 1, "重试后按正常路径写入");
		assert.equal(writes().updateBlock[0].payload.data, "第一段改", "写的是用户的缓冲区");
		assert.equal(hasText("changeUnverified"), false, "写成功后提示消失");
	});
});

// ---------------------------------------------------------------- 6. 自动保存也过闸
// 刻意**不用 MockTimers**：它在 node --test 里是把全局 setTimeout 换掉，一旦用例中途
// 失败没恢复，整个测试进程的调度（包括运行器自己的超时）就废了——全量跑会挂在那个文件上。
// 这里用真实等待跨过 2.2 秒的自动保存延迟，代价是这条用例约 5 秒，换来的是「不会挂住」。
test("自动保存遇到冲突会停下来，不会 2.2 秒后静默覆盖", async () => {
	await withNoHost(async () => {
		const { writes, kernel } = mount({ text: "第一段改", savedText: "第一段", disk: EXTERNAL_DISK, autoSave: true });

		await sleep(2400); // 自动保存该触发了
		assert.deepEqual(writes().all, [], "自动保存这一轮一个字都没写");
		assert.equal(hasText("changeExternal"), true, "冲突照样浮出来给用户看");
		assert.equal(kernel.reads, 1, "它确实去读了磁盘（做了检测）");

		await sleep(2400); // 冲突还挂着，再来一个自动保存周期
		assert.equal(kernel.reads, 1, "冲突未处理期间不再反复去读、更不会写（自动保存已暂停）");

		// 用户处理完（覆盖）之后，保存可以重新工作
		click("changeOverwrite");
		await settle();
		assert.equal(writes().updateBlock.length, 1, "用户确认后写了一次");
		assert.equal(hasText("changeExternal"), false, "提示条消失");
	});
});

// ---------------------------------------------------------------- 7. 与 P1 分段编辑器协作
test("冲突期间不动缓冲区；「重新读取」走既有的重载逻辑", async () => {
	await withNoHost(async () => {
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: EXTERNAL_DISK });
		const before = doc.text;
		clickSave();
		await settle();
		assert.equal(doc.text, before, "冲突态期间缓冲区一个字都不动（不重切分、不打断光标）");

		click("changeReload");
		await settle();
		assert.equal(harness.reloads, 1, "「重新读取」调用既有的 onReload");
		assert.equal(hasText("changeExternal"), false, "点了之后提示条收起");
		assert.deepEqual(writes().all, [], "重新读取本身不写内核");
	});
});

// ---------------------------------------------------------------- 8. 没有基线时不拦
test("没有保存基线的草稿（savedText 为空）不参与检测，既有保存路径不变", async () => {
	await withNoHost(async () => {
		const { writes } = mount({ text: "刚写的第一段", savedText: "", disk: "" });
		clickSave();
		await settle();
		assert.equal(writes().insertBlock.length + writes().prependBlock.length, 1, "新草稿按既有路径插入");
		assert.equal(hasText("changeExternal"), false, "不为草稿弹冲突");
	});
});

// ---------------------------------------------------------------- 9. 跳过检测只生效一次
test("「仍要保存」只生效一次：下一次保存必须重新过闸", async () => {
	await withNoHost(async () => {
		const { writes, kernel } = mount({ text: "第一段改", savedText: "第一段", disk: EXTERNAL_DISK });
		clickSave();
		await settle();
		assert.deepEqual(writes().all, [], "第一次冲突不写");

		// 用户明确选择覆盖
		click("changeOverwrite");
		await settle();
		assert.equal(writes().updateBlock.length, 1, "覆盖时写了这一次");
		assert.equal(hasText("changeExternal"), false, "处理后提示条收起");

		// 之后外部又改了、用户也又改了一版：闸门必须重新生效
		kernel.insertAfter("b1", "外部又插的");
		doc = { ...doc, text: "第一段改2" };
		render();
		const written = writes().all.length;
		clickSave();
		await settle();
		assert.equal(writes().all.length, written, "一次覆盖不能变成永久豁免：第二次保存必须重新过闸且一个字不写");
		assert.equal(hasText("changeExternal"), true, "冲突提示重新出现");
	});
});

// ---------------------------------------------------------------- 11. 没有基线就没有「跳过检测」
test("读失败且面板没有已知块表时，点「跳过检测」也必须拒绝写（不能拿空表去 planSync）", async () => {
	await withNoHost(async () => {
		// disk 为空 → 面板上次读到的块表也是空的 → 这条路径没有可用基线
		const { writes } = mount({ text: "刚写的一段", savedText: "", disk: "", failReads: true });
		doc = { ...doc, savedText: "第一段", text: "第一段改" }; // 造出「有本地改动、但没有可信基线」
		render();
		clickSave();
		await settle();
		assert.equal(hasText("changeUnverified"), true, "先进入「无法确认」");

		click("changeSkipCheck");
		await settle();
		assert.deepEqual(writes().all, [], "没有基线时跳过检测也不能写：planSync([], next) 会把整篇当新增重复插一遍");
		assert.equal(hasText("changeUnverified"), true, "仍然停在「无法确认」，提示可以重试");
	});
});

// ---------------------------------------------------------------- 13. 过期基线的安全边界
test("读失败 + 跳过检测：基线过期时只会「写失败」或「漏写」，绝不会删掉外部新插的块", async () => {
	await withNoHost(async () => {
		// 面板已知块表是 [b1]；磁盘此刻被外部插了一张图（b2），但读不出来。
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: EXTERNAL_DISK, failReads: true });
		clickSave();
		await settle();
		click("changeSkipCheck");
		await settle();

		// 安全性质：deleteBlock 只可能针对基线里存在的 id（b1），外部新插的 b2 不在基线里，
		// 因此这条路径**永远不会删掉外部块**。过期的代价只可能是写失败/漏写，不是数据丢失。
		for (const call of writes().deleteBlock) {
			assert.equal(call.payload.id, "b1", `不许删基线之外的块（实际删了 ${call.payload.id}）`);
		}
		// 并且确实留了痕，用户知道这次是没有确认就写的。
		assert.ok(
			notices.some((row) => row.tone === "warn" && String(row.text).startsWith("changeSkipped")),
			"跳过检测必须留痕",
		);
	});
});

test("读失败 + 用户点「跳过检测」：按上次已知块表写入，并留下 warn 痕迹", async () => {
	await withNoHost(async () => {
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: PLAIN_DISK, failReads: true });
		clickSave();
		await settle();
		assert.deepEqual(writes().all, [], "不点按钮就不会写");

		click("changeSkipCheck");
		await settle();
		assert.equal(writes().updateBlock.length, 1, "用户明确跳过检测后写入一次");
		assert.equal(writes().updateBlock[0].payload.id, "b1", "基线用的是面板上次已知的块（不是空表）");
		assert.equal(writes().updateBlock[0].payload.data, "第一段改");
		assert.ok(
			notices.some((row) => row.tone === "warn" && String(row.text).startsWith("changeSkipped")),
			"跳过检测必须留痕（warn 提示里带原因）",
		);
	});
});
