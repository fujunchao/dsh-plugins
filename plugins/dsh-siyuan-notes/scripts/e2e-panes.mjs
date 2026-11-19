// Verifies the multi-pane scenario end to end against the live kernel:
// two documents edited "simultaneously" keep independent buffers, and saving
// one must not disturb the other's block ids.
import fs from "node:fs";
import { api, kramdown } from "../../tools/siyuan.mjs";

const NB = process.env.SY_NB || "20251122094407-b4g4hhx";
const BASE = process.env.SY_BASE || "http://127.0.0.1:6806";

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

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra) => {
	if (ok) log("  PASS " + label);
	else {
		failures++;
		log("  FAIL " + label + (extra ? " :: " + extra : ""));
	}
};

async function settled(docId, expected) {
	let prev = null;
	let stable = 0;
	for (let i = 0; i < 14; i++) {
		const blocks = splitKramdown(await kramdown(docId)).filter((b) => b.id != null);
		const sig = blocks.map((b) => b.id + "|" + b.text).join("\u0000");
		if (sig === prev) {
			stable++;
			if (stable >= 2 && (expected === undefined || blocks.length === expected)) return blocks;
		} else {
			stable = 0;
			prev = sig;
		}
		await sleep(250);
	}
	return splitKramdown(await kramdown(docId)).filter((b) => b.id != null);
}

async function applyPlan(docId, steps) {
	let previousId = null;
	for (const step of steps) {
		if (step.op === "keep") {
			previousId = step.id;
			continue;
		}
		if (step.op === "update") {
			await api("/api/block/updateBlock", { id: step.id, dataType: "markdown", data: step.text });
			previousId = step.id;
			continue;
		}
		if (step.op === "insert") {
			const r = previousId
				? await api("/api/block/insertBlock", { previousID: previousId, dataType: "markdown", data: step.text })
				: await api("/api/block/prependBlock", { parentID: docId, dataType: "markdown", data: step.text });
			const id = r.data?.[0]?.doOperations?.find?.((op) => op.action === "insert")?.id;
			if (id) previousId = id;
			continue;
		}
		if (step.op === "delete") await api("/api/block/deleteBlock", { id: step.id });
	}
}

/** The editor's own read path: kramdown -> blocks -> buffer text. */
async function loadBuffer(docId) {
	const k = await kramdown(docId);
	const blocks = splitKramdown(k).filter((b) => b.id != null);
	return { blocks, text: blocks.map((b) => b.text).join("\n\n") };
}

(async () => {
	log("two-pane editing E2E against " + BASE);

	const docA = (
		await api("/api/filetree/createDocWithMd", {
			notebook: NB,
			path: "/DSH-PANE-A-" + Date.now(),
			markdown: "# A 文档\n\nA 的第一段\n\nA 的第二段\n",
		})
	).data;
	const docB = (
		await api("/api/filetree/createDocWithMd", {
			notebook: NB,
			path: "/DSH-PANE-B-" + Date.now(),
			markdown: "# B 文档\n\nB 的第一段\n\nB 的第二段\n",
		})
	).data;
	log("docA=" + docA + " docB=" + docB);

	try {
		// Both panes load their document up front — exactly what opening two panes does.
		const paneA = await loadBuffer(docA);
		const paneB = await loadBuffer(docB);
		check(paneA.blocks.length === 3 && paneB.blocks.length === 3, "both documents loaded into their own pane");
		check(paneA.text.includes("A 的第一段") && !paneA.text.includes("B 的"), "pane A buffer only holds document A");
		check(paneB.text.includes("B 的第一段") && !paneB.text.includes("A 的"), "pane B buffer only holds document B");
		const idsA = paneA.blocks.map((b) => b.id);
		const idsB = paneB.blocks.map((b) => b.id);

		// Edit both buffers independently, then save A first.
		const textA = paneA.text.replace("A 的第二段", "A 的第二段（在左栏改的）");
		const textB = paneB.text.replace("B 的第二段", "B 的第二段（在右栏改的）");
		check(textA !== paneA.text && textB !== paneB.text, "each buffer carries its own edit");

		await applyPlan(docA, planSync(paneA.blocks, splitMarkdown(textA)));
		const afterA = await settled(docA, 3);
		check(afterA[2].text === "A 的第二段（在左栏改的）", "pane A's edit landed in document A");
		check(afterA.map((b) => b.id).join() === idsA.join(), "document A's block ids survive the edit");

		// Saving A must leave B untouched — the point of independent panes.
		const untouchedB = await settled(docB, 3);
		check(
			JSON.stringify(untouchedB.map((b) => b.text)) === JSON.stringify(paneB.blocks.map((b) => b.text)),
			"document B is byte-identical after saving A",
			JSON.stringify(untouchedB.map((b) => b.text)),
		);
		check(untouchedB.map((b) => b.id).join() === idsB.join(), "document B's block ids are untouched");

		// Now save B; A must remain as saved.
		await applyPlan(docB, planSync(paneB.blocks, splitMarkdown(textB)));
		const afterB = await settled(docB, 3);
		check(afterB[2].text === "B 的第二段（在右栏改的）", "pane B's edit landed in document B");
		check(afterB.map((b) => b.id).join() === idsB.join(), "document B's block ids survive the edit");
		const finalA = await settled(docA, 3);
		check(finalA[2].text === "A 的第二段（在左栏改的）", "document A still holds the left pane's edit");

		// The same document in two panes: a save from one pane must be visible as a
		// revision bump the other pane can detect (the stale badge).
		const shared1 = await loadBuffer(docA);
		const shared2 = await loadBuffer(docA);
		const sharedEdit = shared1.text.replace("A 的第一段", "A 的第一段（左栏）");
		await applyPlan(docA, planSync(shared1.blocks, splitMarkdown(sharedEdit)));
		const reread = await settled(docA, 3);
		check(reread.some((b) => b.text === "A 的第一段（左栏）"), "shared-document save is visible on re-read");
		check(
			JSON.stringify(shared2.blocks.map((b) => b.text)) !== JSON.stringify(reread.map((b) => b.text)),
			"the other pane's stale buffer differs from the server, so the badge would show",
		);
	} finally {
		await api("/api/filetree/removeDocByID", { id: docA });
		await api("/api/filetree/removeDocByID", { id: docB });
		log("scratch docs removed");
	}

	log(failures === 0 ? "\nPANE E2E: OK" : "\nPANE E2E: " + failures + " FAILURES");
	process.exit(failures === 0 ? 0 : 1);
})();
