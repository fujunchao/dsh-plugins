// End-to-end check of the plugin's save planner against the live kernel:
// read a real document, plan a sync, apply it, and verify nothing was damaged.
import fs from "node:fs";
import { api, kramdown } from "../../tools/siyuan.mjs";

const BASE = process.env.SY_BASE || "http://127.0.0.1:6806";
const NB = process.env.SY_NB || "20251122094407-b4g4hhx";

// Load the bundle's pure helpers through the same harness the unit test uses.
	class StubComponent {
		constructor(props) { this.props = props ?? {}; this.state = {}; }
		setState(next) { this.state = { ...this.state, ...(typeof next === "function" ? next(this.state) : next) }; }
	}

const ReactStub = {
	Component: StubComponent,
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (v) => ({ current: v }),
};
let bundle = null;
globalThis.window = { __ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory(() => ReactStub) }; } } };
new Function("window", fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"))(globalThis.window);
const { splitKramdown, splitMarkdown, planSync } = bundle.exports.__test;

const log = (...args) => console.log(...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
function check(ok, label, extra) {
	if (ok) log("  PASS " + label);
	else {
		failures++;
		log("  FAIL " + label + (extra ? " :: " + extra : ""));
	}
}

/** One raw read of the document's top-level blocks. */
async function readBlocks(docId) {
	return splitKramdown(await kramdown(docId)).filter((b) => b.id != null);
}

/** Read until the block list stops changing: the kernel index settles a beat late. */
async function settledBlocks(docId, expected) {
	let previous = null;
	let stable = 0;
	for (let attempt = 0; attempt < 14; attempt++) {
		const blocks = await readBlocks(docId);
		const signature = blocks.map((b) => b.id + "|" + b.text).join("\u0000");
		if (signature === previous) {
			stable++;
			if (stable >= 2 && (expected === undefined || blocks.length === expected)) return blocks;
		} else {
			stable = 0;
			previous = signature;
		}
		await sleep(250);
	}
	return readBlocks(docId);
}

async function applyPlan(docId, steps) {
	let previousId = null;
	for (const step of steps) {
		if (step.op === "keep") {
			previousId = step.id;
			continue;
		}
		if (step.op === "update") {
			const r = await api("/api/block/updateBlock", { id: step.id, dataType: "markdown", data: step.text });
			if (r.code !== 0) throw new Error("updateBlock: " + r.msg);
			previousId = step.id;
			continue;
		}
		if (step.op === "insert") {
			const r = previousId
				? await api("/api/block/insertBlock", { previousID: previousId, dataType: "markdown", data: step.text })
				: await api("/api/block/prependBlock", { parentID: docId, dataType: "markdown", data: step.text });
			if (r.code !== 0) throw new Error("insert: " + r.msg);
			const id = r.data?.[0]?.doOperations?.find?.((op) => op.action === "insert")?.id;
			if (id) previousId = id;
			continue;
		}
		if (step.op === "delete") {
			const r = await api("/api/block/deleteBlock", { id: step.id });
			if (r.code !== 0) throw new Error("deleteBlock: " + r.msg);
		}
	}
}

(async () => {
	log("live save-planner E2E against " + BASE);

	const created = await api("/api/filetree/createDocWithMd", {
		notebook: NB,
		path: "/DSH-E2E-" + Date.now(),
		markdown:
			"# 一级标题\n\n第一段正文\n\n## 二级标题\n\n- 列表A\n- 列表B\n\n```js\nconsole.log(1)\n```\n\n| 列1 | 列2 |\n| --- | --- |\n| a | b |\n",
	});
	const docId = created.data;
	log("scratch doc: " + docId);

	try {
		const blocks0 = await settledBlocks(docId, 6);
		check(blocks0.length === 6, "parsed 6 top-level blocks", "got " + blocks0.length);
		const texts0 = blocks0.map((b) => b.text);
		log("  texts: " + JSON.stringify(texts0));

		// (a) no-op save must produce zero writes.
		const steps0 = planSync(blocks0, splitMarkdown(texts0.join("\n\n")));
		check(steps0.every((s) => s.op === "keep"), "unmodified document plans no writes", JSON.stringify(steps0.map((s) => s.op)));

		// (b) edit one paragraph: exactly one update, every other id preserved.
		const edited = texts0.slice();
		edited[1] = "改过的第一段";
		const steps1 = planSync(blocks0, splitMarkdown(edited.join("\n\n")));
		check(steps1.filter((s) => s.op === "update").length === 1, "one paragraph edit -> one update");
		check(steps1.filter((s) => s.op !== "keep" && s.op !== "update").length === 0, "no collateral inserts/deletes");
		await applyPlan(docId, steps1);

		const blocks1 = await settledBlocks(docId, 6);
		check(
			blocks1.map((b) => b.id).join(",") === blocks0.map((b) => b.id).join(","),
			"all block ids preserved after a paragraph edit",
		);
		check(blocks1[1].text === "改过的第一段", "edited paragraph landed", blocks1[1].text);
		check(
			JSON.stringify(blocks1.map((b) => b.text)) === JSON.stringify(splitMarkdown(edited.join("\n\n"))),
			"read-back equals what was written",
			JSON.stringify(blocks1.map((b) => b.text)),
		);

		// (c) insert a paragraph in the middle: neighbours' ids survive.
		const withInsert = blocks1.map((b) => b.text);
		withInsert.splice(2, 0, "插入的新段落");
		const steps2 = planSync(blocks1, splitMarkdown(withInsert.join("\n\n")));
		check(steps2.filter((s) => s.op === "insert").length === 1, "insertion plans one insert");
		await applyPlan(docId, steps2);
		const blocks2 = await settledBlocks(docId, 7);
		check(blocks2.length === blocks1.length + 1, "document grew by exactly one block", "got " + blocks2.length);
		check(blocks2[2].text === "插入的新段落", "inserted block landed at index 2", blocks2[2].text);
		check(
			blocks1.every((b) => blocks2.some((c) => c.id === b.id)),
			"every pre-existing block id survived the insertion",
		);

		// (d) delete a block: only that id disappears.
		const remaining = blocks2.filter((_, i) => i !== 2);
		const steps3 = planSync(blocks2, splitMarkdown(remaining.map((b) => b.text).join("\n\n")));
		check(steps3.filter((s) => s.op === "delete").length === 1, "deletion plans one delete");
		await applyPlan(docId, steps3);
		const blocks3 = await settledBlocks(docId, 6);
		check(blocks3.length === blocks2.length - 1, "document shrank by exactly one block", "got " + blocks3.length);
		check(!blocks3.some((b) => b.id === blocks2[2].id), "deleted block is gone");
		check(
			blocks3.map((b) => b.id).join(",") === remaining.map((b) => b.id).join(","),
			"other ids untouched",
		);

		// (e) rewriting every paragraph keeps ids (updates, not delete+insert).
		//     Fenced blocks are left alone: appending text to a closing fence breaks it,
		//     which is a property of the test edit, not of the planner.
		const rewritten = blocks3.map((b, i) => (b.text.startsWith("```") ? b.text : b.text + "（改" + i + "）"));
		const steps4 = planSync(blocks3, splitMarkdown(rewritten.join("\n\n")));
		check(
			steps4.every((s) => s.op === "update" || s.op === "keep"),
			"full rewrite plans only updates (plus keeps for untouched blocks)",
			JSON.stringify(steps4.map((s) => s.op)),
		);
		await applyPlan(docId, steps4);
		const blocks4 = await settledBlocks(docId, 6);
		check(blocks4.map((b) => b.id).join(",") === blocks3.map((b) => b.id).join(","), "ids survive a full rewrite");

		// (f) A real first-line indent round-trips as exactly one indent: the plugin
		//     writes the real characters, and reading back peels off only the
		//     synthesized pair that the kernel's document serializer adds.
		await api("/api/block/updateBlock", { id: blocks4[1].id, dataType: "markdown", data: "\u3000\u3000带缩进的写入" });
		const afterIndent = await settledBlocks(docId, 6);
		check(
			afterIndent[1].text === "\u3000\u3000带缩进的写入",
			"a real first-line indent is kept as exactly one indent",
			JSON.stringify(afterIndent[1].text),
		);

		// (f2) Saving the same indented content again must not double it.
		const { indentParagraphs } = bundle.exports.__test;
		const indentedBuffer = indentParagraphs(afterIndent.map((b) => b.text).join("\n\n"));
		await applyPlan(docId, planSync(afterIndent, splitMarkdown(indentedBuffer)));
		const afterSecondSave = await settledBlocks(docId, 6);
		check(
			JSON.stringify(afterSecondSave.map((b) => b.text)) === JSON.stringify(splitMarkdown(indentedBuffer)),
			"a second save of the indented document changes nothing (no doubling)",
			JSON.stringify(afterSecondSave.map((b) => b.text)),
		);
		const stepsAgain = planSync(afterSecondSave, splitMarkdown(indentedBuffer));
		check(
			stepsAgain.every((s) => s.op === "keep"),
			"re-saving the same indented buffer plans no writes",
			JSON.stringify(stepsAgain.map((s) => s.op)),
		);

		// (g) a list block keeps its identity when an item is added.
		const listBlock = afterIndent.find((b) => b.text.startsWith("- 列表A"));
		check(listBlock !== undefined, "list block is present");
		await api("/api/block/updateBlock", { id: listBlock.id, dataType: "markdown", data: "- 列表A\n- 列表B\n- 列表C" });
		const afterList = await settledBlocks(docId, 6);
		const listAfter = afterList.find((b) => b.text.startsWith("- 列表A"));
		check(listAfter && listAfter.text === "- 列表A\n- 列表B\n- 列表C", "list update keeps the block and gains the item", JSON.stringify(listAfter && listAfter.text));
	} finally {
		await api("/api/filetree/removeDocByID", { id: docId });
		log("scratch doc removed: " + docId);
	}

	log(failures === 0 ? "\nE2E: OK" : "\nE2E: " + failures + " FAILURES");
	process.exit(failures === 0 ? 0 : 1);
})();
