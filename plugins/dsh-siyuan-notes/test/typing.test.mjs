// Typing speed: a rolling one-minute rate over NET new characters.
//
// Design notes this probe pins down:
//   * Only real user input may count. Toolbar actions (indent, bold, 「补齐全篇」) and
//     programmatic loads also fire onChange, and counting them would show a burst of
//     hundreds of "characters per minute" for a single click.
//   * The rate is net new characters: deletions count against it, because the number is
//     meant to answer "how fast am I producing text", not "how many keys did I press".
//   * One minute of samples is kept, and the window is weighted by elapsed time so the
//     number is stable while typing and decays after a pause.
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const SRC = new URL("../lib/client.js", import.meta.url);

let bundle = null;
const ReactStub = {
	Component: class { constructor(props) { this.props = props ?? {}; this.state = {}; } setState() {} },
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useCallback: (fn) => fn,
	useRef: (v) => ({ current: v }),
	useSyncExternalStore: (a, b) => b(),
};
globalThis.window = { __ModuleLoader__: { load({ id, factory }) { bundle = { id, exports: factory((spec) => (spec === "react" ? ReactStub : {})) }; } } };
new Function("window", fs.readFileSync(SRC, "utf8"))(globalThis.window);

const { typingMeter, isTypingInput } = bundle.exports.__test;

test("isTypingInput: only real keystrokes and typing-like IME edits count", () => {
	// Real typing.
	for (const kind of ["insertText", "insertLineBreak", "insertParagraph", "deleteContentBackward", "deleteContentForward", "insertCompositionText"]) {
		assert.equal(isTypingInput(kind), true, kind + " is typing");
	}
	// Paste and drop are not typing speed.
	for (const kind of ["insertFromPaste", "insertFromDrop", "insertFromYank", "deleteByCut", "historyUndo", "historyRedo"]) {
		assert.equal(isTypingInput(kind), false, kind + " is not typing");
	}
	assert.equal(isTypingInput(""), false);
	assert.equal(isTypingInput(undefined), false);
});

test("isTypingInput: an IME commit counts as typing", () => {
	// Committing a Chinese candidate on Windows replaces the composing text and reports
	// insertReplacementText. Classifying it as paste made the rate stay 0 for Chinese input,
	// which is what the user actually hit.
	assert.equal(isTypingInput("insertReplacementText"), true, "IME commit on Windows");
	assert.equal(isTypingInput("insertFromComposition"), true, "IME commit variant");
	assert.equal(isTypingInput("insertCompositionText"), true, "IME while composing");
	// The clipboard and history paths must stay excluded.
	assert.equal(isTypingInput("insertFromPaste"), false, "paste is not typing");
	assert.equal(isTypingInput("insertFromDrop"), false, "drop is not typing");
	assert.equal(isTypingInput("deleteByCut"), false, "cut is not typing");
	assert.equal(isTypingInput("historyUndo"), false, "undo is not typing");
	assert.equal(isTypingInput("historyRedo"), false, "redo is not typing");
});
test("typingMeter: net new characters, weighted over the elapsed run", () => {
	const meter = typingMeter({ windowMs: 60000 });
	// Nothing typed yet.
	assert.equal(meter.rate(1000), 0);

	// Two characters per second over half a minute: 60 characters in 30s => 120 cpm.
	for (let second = 0; second < 30; second++) meter.add(2, second * 1000);
	// While still typing, the meter reports the actual production rate.
	const whileTyping = meter.rate(29000);
	assert.ok(whileTyping >= 118 && whileTyping <= 130, "about 120 characters per minute while typing, got " + whileTyping);

	// After 31 idle seconds the same samples are older, so the rolling figure drops. This is
	// the decay the meter is supposed to have, not a defect.
	const afterPause = meter.rate(60000);
	assert.ok(afterPause < whileTyping, "an idle minute lowers the rolling rate: " + whileTyping + " -> " + afterPause);
	assert.ok(afterPause > 0, "the sample is still inside the one-minute window");

	// A single character in the first second is scaled up, but the ceiling keeps it sane.
	const burst = typingMeter({ windowMs: 60000 });
	burst.add(1, 0);
	const first = burst.rate(1000);
	assert.ok(first > 0 && first <= 1200, "a lone keystroke reports a small positive rate, got " + first);
});

test("typingMeter: deletions count against the rate", () => {
	// Two characters per second for half a minute, then a burst of deletions.
	const meter = typingMeter({ windowMs: 60000 });
	for (let second = 0; second < 30; second++) meter.add(2, second * 1000);
	const before = meter.rate(29000);
	meter.add(-40, 29000);
	const after = meter.rate(29000);
	assert.ok(after < before, "removing text lowers the rate (net new characters): " + before + " -> " + after);
	assert.ok(after >= 0, "the rate never goes negative");
});

test("typingMeter: a pause decays the rate to zero", () => {
	const meter = typingMeter({ windowMs: 60000 });
	meter.add(60, 0);
	assert.ok(meter.rate(0) > 0);
	// Two minutes later the sample is outside the window entirely.
	assert.equal(meter.rate(120000), 0, "the window empties");
	// And it never reports a negative number, even after net deletions.
	meter.add(10, 130000);
	meter.add(-500, 131000);
	assert.equal(meter.rate(131000) >= 0, true, "the rate is never negative");
});

test("source: the typing rate is always rendered, including at zero", () => {
	const raw = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	const source = raw.replace(/\s+/g, " ");

	// Rendered unconditionally: hiding it at zero made the feature look missing.
	assert.equal(
		source.includes('h("span", null, t("typingRate", { n: typingRate })),'),
		true,
		"the rate is rendered unconditionally",
	);
	assert.equal(
		source.includes('typingRate > 0 ? h("span", null, t("typingRate"'),
		false,
		"it is no longer gated on a positive rate",
	);

	// The label must exist in both dictionaries, or the bar would show a raw key.
	assert.equal(source.includes('typingRate: "{n} 字/分"'), true, "zh label present");
	assert.equal(source.includes('typingRate: "{n} cpm"'), true, "en label present");
});
test("source: the typing listeners are attached to whichever textarea exists", () => {
	const raw = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	const normalised = raw.replace(/\s+/g, " ");

	// The component early-returns while loading, so at the first commit there is no textarea.
	assert.equal(
		normalised.includes("if (doc.loading) {"),
		true,
		"the loading early-return is still why the attach point matters",
	);
	// 分段编辑后，监听不再由一个 effect 按 deps 重跑挂上，而是**每个文本段 textarea 在挂载时
	// 由稳定的 ref 回调直接挂上**（卸载时清掉）。这条比旧的 deps 断言更强：不再依赖
	// 「effect 恰好因为 loading/view 变化而重跑」，而是「只要节点存在就一定挂过」。
	assert.equal(
		normalised.includes("segmentCleanupsRef.current.set(index, attachTextarea(node, index));"),
		true,
		"a textarea node gets its listeners the moment it mounts",
	);
	assert.equal(
		normalised.includes("const previous = segmentCleanupsRef.current.get(index);"),
		true,
		"and the previous attachment for that segment is torn down first",
	);
	// ref 回调按段序号缓存：普通重渲染不会反复挂卸监听（否则输入法/粘贴会在中途被拆掉）。
	assert.equal(normalised.includes("const cache = segmentRefCallbacks.current;"), true, "the ref callback is cached per segment index");
	// 旧的「整篇一个 textarea + deps 表」接线必须彻底不在，免得两套机制并存。
	assert.equal(
		normalised.includes("}, [doc && doc.id, doc && doc.loading, view]);"),
		false,
		"the old dependency-driven attach is gone",
	);
	assert.equal(normalised.includes("const ta = textareaRef.current;"), false, "no single whole-document textarea ref is left behind");
});
test("source: the typing listeners follow the view mode", () => {
	const raw = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	const source = raw.replace(/\s+/g, " ");

	// 文本段只在非预览模式下渲染；切到预览再切回来会重建这批节点。旧实现靠 `view` 当依赖
	// 让 effect 重跑；新实现由节点自己的 ref 回调负责挂卸，所以「切回编辑区一定有监听」这条
	// 性质仍然成立，而且不再依赖依赖数组：
	assert.equal(
		source.includes("segmentCleanupsRef.current.set(index, attachTextarea(node, index));"),
		true,
		"listeners follow the nodes, so switching views cannot leave a column without them",
	);

	// The guard must still bail out when there is no textarea, rather than throwing.
	assert.equal(source.includes("const attachTextarea = useCallback((ta, index) => { if (!ta) return () => {};"), true, "a missing textarea is tolerated");
});
test("source: programmatic writes are wrapped so they cannot be counted as typing", () => {
	const raw = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	// Collapse whitespace so the assertions do not depend on exact line breaks or indentation.
	const source = raw.replace(/\s+/g, " ");

	// The flag exists and the beforeinput handler consults it.
	assert.equal(source.includes("let suppressTypingCount = false;"), true, "the flag exists");
	assert.equal(
		source.includes("pendingInputRef.current = !suppressTypingCount && isTypingInput(event.inputType);"),
		true,
		"the beforeinput handler consults the flag",
	);

	// Every programmatic write path goes through the helper.
	assert.equal(
		source.includes('withoutTypingCount(() => document.execCommand("insertText", false, text));'),
		true,
		"execCommand is wrapped",
	);
	assert.equal(
		source.includes("withoutTypingCount(() => { textarea.value = wanted; });"),
		true,
		"the direct-assignment fallback is wrapped",
	);

	// The flag is restored even when the wrapped call throws.
	assert.equal(
		source.includes("} finally { suppressTypingCount = previous; }"),
		true,
		"the flag is restored in a finally block",
	);

	// Exactly one place raises the flag, so a second caller cannot forget it silently.
	const raisers = raw.match(/suppressTypingCount = true;/g) || [];
	assert.equal(raisers.length, 1, "only withoutTypingCount raises the flag");
});
test("typingMeter: one huge burst does not scale out of control", () => {
	// Pasting is filtered out before it reaches the meter, but a bulk edit inside a very
	// short interval would otherwise divide by almost zero. The floor keeps it sane.
	const meter = typingMeter({ windowMs: 60000 });
	meter.add(500, 1000);
	const rate = meter.rate(1001);
	assert.ok(Number.isFinite(rate), "finite");
	assert.ok(rate <= 1200, "clamped to a plausible ceiling, got " + rate);
});
