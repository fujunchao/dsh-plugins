// P2a「修订 A」的**独立**边界用例（task-8）。
//
// 为什么要另写一份而不复用 test/external-change.test.mjs：
//   1. 那个文件是 client-image 的写范围，我要做的是**独立复核**，共用同一套 harness 等于
//      用它自己的尺子量它自己 —— 如果它的 harness 本身有偏差（例如 doc.blocks 的构造方式），
//      我照抄就一起错了；
//   2. 修订 A 的语义是"读失败时能不能写"，这条分支的判定依据是 `doc.blocks`（面板上次已知块表）
//      与 `overwriteOnceRef`（用户是否明确点过），**两者的组合**才是要害，值得换一套装法验一遍。
// 所以这里的 harness 是按 EditorPane 的 props 契约重新写的（真 useState + effect 重放），
// 断言全部落在"内核写调用的次数与参数 / 渲染树上的提示 / 通知痕迹"上。
//
// 本文件只读 lib/client.js，不改它。

import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const SRC = new URL("../lib/client.js", import.meta.url);

// 面板里的"每秒刷新打字速率"会留一个活着的 setInterval，让 node --test 跑完不退出。
// 本文件不测打字计量，直接掐掉（与 client-image 那份的处理一致，但这是**独立**决定：
// 任何驱动真实 effect 的用例都必须处理它）。
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

// ---------------------------------------------------------------- 最小 React（真状态 + effect 重放）

/** @type {Array<{ value: unknown, queue: Array<unknown> }>} */
let stateSlots = [];
/** @type {Array<{ current: unknown }>} */
let refSlots = [];
let slotCursor = 0;
let needsRender = false;
/** @type {Array<{ slot: number, fn: () => unknown, deps: unknown[] }>} */
let pendingEffects = [];
/** @type {Array<{ deps: unknown[], cleanup: (() => void) | undefined }>} */
let effectMemory = [];

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
		const index = slotCursor++;
		if (stateSlots[index] === undefined) {
			stateSlots[index] = { value: typeof initial === "function" ? initial() : initial, queue: [] };
		}
		const slot = stateSlots[index];
		while (slot.queue.length > 0) {
			const next = slot.queue.shift();
			slot.value = typeof next === "function" ? next(slot.value) : next;
		}
		return [
			slot.value,
			(next) => {
				slot.queue.push(next);
				// 任何 setState 都要触发一次重渲染（提示条的出现/消失靠它）
				dirty = true;
				needsRender = true;
			},
		];
	},
	useRef(initial) {
		const index = slotCursor++;
		if (refSlots[index] === undefined) refSlots[index] = { current: initial };
		return refSlots[index];
	},
	useMemo: (factory) => factory(),
	useCallback: (fn) => fn,
	useEffect(fn, deps) {
		const slot = slotCursor++;
		pendingEffects.push({ slot, fn, deps: Array.isArray(deps) ? deps : [] });
	},
	useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

let bundle = null;
globalThis.window = {
	__ModuleLoader__: {
		load({ id, factory }) {
			bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) };
		},
	},
};
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { EditorPane } = bundle.exports.__panes;
const { splitKramdown } = bundle.exports.__test;
if (typeof EditorPane !== "function") throw new Error("client bundle 没有导出 EditorPane");

// ---------------------------------------------------------------- 树工具

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

/** 树上任意节点的文本子节点里出现这段文案（子串匹配：带插值的文案会被 t() 拼上参数）。 */
const hasText = (text) => findAll(tree, (node) => (node.children ?? []).some((child) => typeof child === "string" && child.includes(text))).length > 0;

/** 提示条上的动作按钮：按 `data-tone` 或文案找。 */
function buttons() {
	return findAll(tree, (node) => node.type === "button");
}
function buttonWithTone(tone) {
	return buttons().find((node) => node.props?.["data-tone"] === tone);
}
/** 工具栏的保存按钮（accent）。 */
function saveButton() {
	return buttonWithTone("accent");
}

// ---------------------------------------------------------------- 环境与假内核

const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);

let doc = null;
let tree = null;
let notices = [];
let reloads = 0;
let dirty = false;
const harness = { client: null, autoSave: false, readFails: false };

/** 会真的记账的假内核：写入后改自己的块表，读回就能收敛。 */
function makeKernel(kramdown) {
	const blocks = splitKramdown(kramdown)
		.filter((block) => block.id != null)
		.map((block) => ({ id: block.id, text: block.text }));
	return {
		blocks,
		reads: 0,
		asKramdown() {
			return this.blocks.map((block) => `${block.text}\n{: id="${block.id}"}`).join("\n\n");
		},
	};
}

/** 渲染一次，并按 deps 变化重放 effect（与 React 的语义一致）。 */
function render() {
	slotCursor = 0;
	pendingEffects = [];
	tree = EditorPane({
		t,
		client: harness.client,
		doc,
		setDoc: (next) => {
			doc = typeof next === "function" ? next(doc) : next;
			dirty = true;
		},
		onReload: () => {
			reloads++;
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
	for (const effect of pendingEffects) {
		const memory = effectMemory[effect.slot];
		const same =
			memory !== undefined &&
			memory.deps.length === effect.deps.length &&
			memory.deps.every((value, index) => value === effect.deps[index]);
		if (same) continue;
		if (memory && typeof memory.cleanup === "function") memory.cleanup();
		const cleanup = effect.fn();
		effectMemory[effect.slot] = { deps: effect.deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
	}
}

/** 推微任务，顺便在状态变化时重渲染。 */
async function flush(rounds = 80) {
	for (let i = 0; i < rounds; i++) {
		await Promise.resolve();
		if (dirty) {
			dirty = false;
			render();
		}
	}
}

/** 等一条保存的 async 链跑完。 */
async function settle() {
	await flush();
	await new Promise((resolve) => setTimeout(resolve, 5));
	await flush();
}

/**
 * 等到这一栏真的不在"保存中"为止。
 *
 * 为什么需要它：保存成功后还要做一次校验读（最多 6 次 × 250 ms）。读失败时这 6 次会全部
 * 抛错并重试，整条链要 ~1.3 s 才结束；期间 `saving === true`，任何新的 save() 都会被
 * `if (!current || current.saving) return;` 直接挡回。用例如果只 `settle()` 5 ms 就继续点，
 * 得到的"没写"是**假的**（保存还在飞），不是被测行为。
 */
async function waitUntilSettled(maxMs = 4000) {
	const started = Date.now();
	while (Date.now() - started < maxMs) {
		await settle();
		if (!doc || doc.saving !== true) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("保存链一直没有结束（saving 卡在 true）");
}

/**
 * 挂一栏编辑器。
 *
 * @param {{ text: string, savedText?: string, disk: string, baseline?: "disk" | "none", autoSave?: boolean, readFails?: boolean }} options
 *   `disk` 决定假内核里有什么；`baseline` 决定 `doc.blocks`（面板上次已知块表）是否有内容 ——
 *   修订 A 的要害正是"有没有这份基线"。
 */
function mount(options) {
	stateSlots = [];
	refSlots = [];
	effectMemory = [];
	slotCursor = 0;
	needsRender = false;
	dirty = false;
	notices = [];
	reloads = 0;
	harness.autoSave = options.autoSave === true;
	harness.readFails = options.readFails === true;

	const writes = [];
	const kernel = makeKernel(options.disk ?? "");
	harness.client = {
		async api(path, payload) {
			if (path === "/api/block/getBlockKramdown") {
				if (harness.readFails) throw new Error("内核超时");
				kernel.reads++;
				return { kramdown: kernel.asKramdown() };
			}
			if (path === "/api/query/sql") return [];
			if (path === "/api/block/updateBlock") {
				const row = kernel.blocks.find((block) => block.id === payload.id);
				if (row) row.text = payload.data;
				writes.push({ path, payload });
				return [{ doOperations: [{ action: "update", id: payload.id }] }];
			}
			if (path === "/api/block/insertBlock" || path === "/api/block/prependBlock") {
				writes.push({ path, payload });
				return [{ doOperations: [{ action: "insert", id: "new-block" }] }];
			}
			if (path === "/api/block/deleteBlock") {
				kernel.blocks = kernel.blocks.filter((block) => block.id !== payload.id);
				writes.push({ path, payload });
				return {};
			}
			return {};
		},
	};

	// 面板上次已知块表：`baseline: "none"` 模拟"从没成功读到过这篇文档"（例如刚打开就断网）。
	const baselineBlocks = options.baseline === "none" ? [] : kernel.blocks.map((block) => ({ id: block.id, text: block.text }));
	doc = {
		id: "doc1",
		title: "文档",
		text: options.text,
		savedText: options.savedText === undefined ? options.text : options.savedText,
		blocks: baselineBlocks,
		loading: false,
		saving: false,
		error: null,
		savedAt: null,
		stamp: 0,
	};
	render();
	return { writes: () => writes, kernel };
}

/** 单测里没有宿主：挡掉 /siyuan/backup 的 fetch。 */
async function withoutHost(run) {
	const original = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { file: "test-backup.md" } }) });
	try {
		await run();
	} finally {
		globalThis.fetch = original;
	}
}

/** 点一下"仍要保存（…）"那个危险按钮。 */
function clickSaveAnyway() {
	const node = buttonWithTone("danger");
	assert.ok(node, "提示条上应该有「仍要保存（…）」按钮");
	node.props.onClick();
}

/** 点保存。 */
function clickSave() {
	const node = saveButton();
	assert.ok(node, "工具栏里应该有保存按钮");
	node.props.onClick();
}

const ONE_BLOCK_DISK = '第一段\n{: id="b1"}';
const TWO_BLOCK_DISK = '第一段\n{: id="b1"}\n\n![图](assets/ai.png)\n{: id="b2"}';

// ---------------------------------------------------------------- 1. 最危险的分支：无基线 + 读失败 + 点跳过 → 必须 0 写

test("修订A 边界：无已知块表 + 读失败 + 点「跳过检测」→ 仍然 0 次写内核", async () => {
	await withoutHost(async () => {
		const { writes } = mount({ text: "刚写的一段", savedText: "旧基线", disk: "", baseline: "none", readFails: true });
		clickSave();
		await settle();

		assert.deepEqual(writes(), [], "读失败且没有基线：一次都不许写（planSync([], next) 会把整篇当新增重复插一遍）");
		assert.equal(hasText("changeUnverified"), true, "应该停在「无法确认」，而不是报成外部改动");
		assert.equal(hasText("changeExternal"), false, "不能误报成外部改动");

		clickSaveAnyway(); // 用户明确点了「仍要保存（跳过检测）」
		await settle();

		assert.deepEqual(writes(), [], "**关键**：没有基线时，点跳过检测也不能写（按钮不能承诺做不到的事）");
		assert.equal(hasText("changeUnverified"), true, "仍然停在「无法确认」，让用户可以重试");
		assert.equal(
			notices.some((row) => String(row.text).startsWith("changeSkipped")),
			false,
			"既然没写，就不该留「跳过检测保存了」的痕迹",
		);
	});
});

// ---------------------------------------------------------------- 2. 有基线 + 读失败 + 点跳过 → 恰好 1 次写，基线来自已知表

test("修订A 边界：有已知块表 + 读失败 + 点「跳过检测」→ 恰好 1 次写，基线是已知表的块 id", async () => {
	await withoutHost(async () => {
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: ONE_BLOCK_DISK, readFails: true });
		clickSave();
		await settle();
		assert.deepEqual(writes(), [], "不点按钮不会写");

		clickSaveAnyway();
		await settle();

		const all = writes();
		assert.equal(all.length, 1, "明确点过之后写一次，且只写一次");
		assert.equal(all[0].path, "/api/block/updateBlock");
		assert.equal(all[0].payload.id, "b1", "基线用的是面板上次已知的块（不是空表，否则会变成 insert）");
		assert.equal(all[0].payload.data, "第一段改", "写的是用户的缓冲区");

		const skipped = notices.filter((row) => String(row.text).startsWith("changeSkipped"));
		assert.equal(skipped.length, 1, "跳过检测必须留痕（一条 warn）");
		assert.equal(skipped[0].tone, "warn", "留痕的级别是 warn，不是普通提示");
		assert.ok(String(skipped[0].text).includes("内核超时"), "留痕里要带上读失败的原因");
	});
});

// ---------------------------------------------------------------- 3. 「跳过检测」与「覆盖」是两套独立标记

test("修订A 边界：用过一次「覆盖」之后，下一次读失败不会被自动放行（两个标记互相独立且各只用一次）", async () => {
	await withoutHost(async () => {
		// 先走一遍外部改动 → 用户点「覆盖」→ 写成功
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: TWO_BLOCK_DISK });
		clickSave();
		await settle();
		assert.deepEqual(writes(), [], "外部改动：先不写");
		assert.equal(hasText("changeExternal"), true);

		clickSaveAnyway(); // 这次是「仍要保存（覆盖）」
		await settle();
		assert.equal(writes().length > 0, true, "用户确认后写了");

		// 再制造一次"读失败"：此时 overwrite 标记必须已经被消费掉，不能顺延成"跳过检测"的许可
		harness.readFails = true;
		doc = { ...doc, text: "第一段改2" };
		render();
		const before = writes().length;
		clickSave();
		await settle();

		assert.equal(writes().length, before, "**关键**：一次「覆盖」不能变成「读失败也能写」的长期许可");
		assert.equal(hasText("changeUnverified"), true, "读失败走「无法确认」这条路");
		assert.equal(hasText("changeExternal"), false, "不该报成外部改动");
	});
});

test("修订A 边界：自动保存永远不会自己点「跳过检测」（读失败时 0 写、无 changeSkipped 痕迹）", async () => {
	await withoutHost(async () => {
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: ONE_BLOCK_DISK, readFails: true, autoSave: true });
		await new Promise((resolve) => setTimeout(resolve, 2400)); // 跨过 2.2 秒的自动保存延迟
		await flush();

		assert.deepEqual(writes(), [], "自动保存遇到读失败：一个字都不写");
		assert.equal(hasText("changeUnverified"), true, "把「无法确认」浮给用户看");
		assert.equal(
			notices.some((row) => String(row.text).startsWith("changeSkipped")),
			false,
			"自动路径绝不能自己留下「跳过检测」的痕迹（那等于替用户做了决定）",
		);
	});
});

// ---------------------------------------------------------------- 4. 「跳过检测」只生效一次

test("修订A 边界：「跳过检测」只生效一次 —— 外部又改之后，第二次保存必须重新过闸且 0 写", async () => {
	await withoutHost(async () => {
		const { writes, kernel } = mount({ text: "第一段改", savedText: "第一段", disk: ONE_BLOCK_DISK, readFails: true });
		clickSave();
		await settle();
		clickSaveAnyway(); // 读失败下点「跳过检测」：带已知基线写一次
		await waitUntilSettled();
		const afterFirst = writes().length;
		assert.equal(afterFirst, 1, "第一次跳过检测写了一次");

		// (a) 读数**仍然**失败：这一次没有新的用户点击，绝不能靠上一次的许可写下去。
		//     这一条专门盯"一次性标记被实现成永久豁免"这个坑（把标记的复位去掉就会红）。
		doc = { ...doc, text: "第一段改2" };
		render();
		clickSave();
		await waitUntilSettled();
		assert.equal(writes().length, afterFirst, "**关键**：没有新的点击，读失败时不能再写（许可只用一次）");
		assert.equal(hasText("changeUnverified"), true, "回到「无法确认」，等用户决定");

		// (b) 读数恢复、但磁盘已被外部改过：必须重新走外部改动闸门。
		harness.readFails = false;
		kernel.blocks.push({ id: "b2", text: "外部又插的" });
		doc = { ...doc, text: "第一段改3" };
		render();
		clickSave();
		await waitUntilSettled();

		assert.equal(writes().length, afterFirst, "一次跳过不能变成永久豁免，第二次保存必须重新过闸且不写");
		assert.equal(hasText("changeExternal"), true, "冲突提示重新出现");
	});
});

// ---------------------------------------------------------------- 5. 过期基线不会删掉外部新插的块

test("修订A 边界：基线过期时，「跳过检测」这条路径永远不会删掉外部新插的块", async () => {
	await withoutHost(async () => {
		// 面板上次已知块表只有 b1；磁盘上其实已经有 b1 + b2（b2 是外部插的，面板不知道）。
		const { writes } = mount({ text: "第一段改", savedText: "第一段", disk: TWO_BLOCK_DISK, readFails: true });
		clickSave();
		await settle();
		clickSaveAnyway();
		await waitUntilSettled();

		// 这条路径的 delete 只能针对基线里存在的 id（= b1）；b2 不在基线里，
		// 所以"过期基线"的最坏后果是写失败/漏写，而不是把外部内容删掉。
		const deleted = writes().filter((row) => row.path === "/api/block/deleteBlock").map((row) => row.payload.id);
		assert.deepEqual(deleted.filter((id) => id !== "b1"), [], `不许删基线之外的块，实际删了：${JSON.stringify(deleted)}`);
	});
});

// ---------------------------------------------------------------- 6. i18n：留痕文案中英都在

test("修订A：changeSkipped 中英字典都有（否则提示条会露出原始 key）", () => {
	const dicts = bundle.exports.__dicts;
	assert.ok(dicts && dicts.zh && dicts.en, "bundle 要导出中英字典");
	for (const [label, dict] of [
		["zh", dicts.zh],
		["en", dicts.en],
	]) {
		assert.equal(typeof dict.changeSkipped, "string", `${label} 缺 changeSkipped`);
		assert.ok(dict.changeSkipped.length > 0, `${label}.changeSkipped 不能为空`);
	}
	// 留痕文案要说清"没有备份"与"按已知内容为基线"这两件事，否则用户不知道风险。
	assert.match(dicts.zh.changeSkipped, /备份|基线/, "中文文案要提到备份或基线");
	// 两个「仍要保存」必须是**两个不同**的文案，否则用户分不清自己在同意什么。
	assert.notEqual(dicts.zh.changeOverwrite, dicts.zh.changeSkipCheck, "覆盖与跳过检测必须是两句不同的话");
	assert.notEqual(dicts.en.changeOverwrite, dicts.en.changeSkipCheck);
});
