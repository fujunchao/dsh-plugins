// A rename that leaves a stale reference behind compiles fine and throws the moment
// the user clicks — which is exactly how 引用 broke: `setChatOpen` outlived `chatOpen`,
// so every quote click died with a ReferenceError before it could insert anything.
// There is no type checker on this bundle, so the cheap net is static:
//   1. names we know we retired must not come back,
//   2. an unqualified `setX(...)` must resolve to a binding in this file,
//   3. every `t("key")` needs an entry in both dictionaries,
//   4. every CSS class the code renders must exist in the stylesheet.
import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** Slice one object literal by brace matching, so a growing file cannot truncate it. */
function objectBlock(declaration) {
	const start = source.indexOf(declaration);
	if (start === -1) throw new Error("declaration not found: " + declaration);
	const open = source.indexOf("{", start);
	let depth = 0;
	for (let index = open; index < source.length; index++) {
		const char = source[index];
		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) return source.slice(open, index + 1);
		}
	}
	throw new Error("unterminated literal: " + declaration);
}

// ---------------------------------------------------------------- 1. retired names
const RETIRED = ["chatOpen", "setChatOpen", "chatArea", "sy-chat-body", "chatHint"];
for (const name of RETIRED) {
	assert.equal(new RegExp(`\\b${name}\\b`).test(source), false, `retired identifier "${name}" is still referenced — a rename left it behind`);
}

// ---------------------------------------------------------------- 2. setters resolve
const declared = new Set(["setTimeout", "setInterval", "setImmediate", "setState"]);
for (const match of source.matchAll(/\[(\w+)\s*,\s*(\w+)\]\s*=\s*useState\(/g)) {
	declared.add(match[1]);
	declared.add(match[2]);
}
for (const match of source.matchAll(/function\s+\w*\s*\(([^)]{0,800})\)/g)) {
	for (const part of match[1].split(",")) {
		const name = part.trim().split(/[\s=:]/)[0];
		if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
	}
}
for (const match of source.matchAll(/\(([^()]{0,400})\)\s*=>/g)) {
	for (const part of match[1].split(",")) {
		const name = part.trim().split(/[\s=:]/)[0];
		if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
	}
}
for (const match of source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=/g)) declared.add(match[1]);

// Only unqualified calls count; `x.setFoo()` and `x?.setFoo()` are methods.
const called = new Set();
for (const match of source.matchAll(/(^|[^.?.\w$])(set[A-Z]\w*)\s*\(/g)) called.add(match[2]);
const unresolved = [...called].filter((name) => !declared.has(name)).sort();
assert.deepEqual(unresolved, [], `these setters are called but never declared in this file: ${unresolved.join(", ")}`);

// ---------------------------------------------------------------- 3. translation keys
const zhBlock = objectBlock("const zh = {");
const enBlock = objectBlock("const en = {");
const used = new Set();
for (const match of source.matchAll(/\bt\("([A-Za-z][A-Za-z0-9]*)"\)/g)) used.add(match[1]);
assert.ok(used.size > 40, `expected many translation lookups, found ${used.size}`);
const missingKeys = [...used]
	.filter((key) => !new RegExp(`(^|[{,\\s])${key}\\s*:`).test(zhBlock) || !new RegExp(`(^|[{,\\s])${key}\\s*:`).test(enBlock))
	.sort();
assert.deepEqual(missingKeys, [], `translation keys missing from a dictionary: ${missingKeys.join(", ")}`);

// ---------------------------------------------------------------- 4. duplicate keys
// A duplicated key in an object literal is silent: the later definition wins, so the
// UI quietly shows the wrong word (the view tab read "在右侧拆分" for exactly this
// reason). The check above proves a key EXISTS; this proves it exists only once.
for (const [label, dictionary] of [["zh", zhBlock], ["en", enBlock]]) {
	const keys = [...dictionary.matchAll(/\n\t*([A-Za-z_][\w]*):/g)].map((match) => match[1]);
	const duplicated = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))].sort();
	assert.deepEqual(duplicated, [], `duplicate ${label} translation keys (the later one silently wins): ${duplicated.join(", ")}`);
	assert.ok(keys.length > 40, `expected many ${label} keys, found ${keys.length}`);
}

// ---------------------------------------------------------------- 5. parameterised lookups
// t("key", {...}) is the other half of the dictionary contract; the check above only
// matched t("key"), so a key that always takes parameters could go missing unnoticed.
const parameterised = new Set();
for (const match of source.matchAll(/\bt\("([A-Za-z][A-Za-z0-9]*)",/g)) parameterised.add(match[1]);
const missingParameterised = [...parameterised]
	.filter((key) => !new RegExp(`(^|[{,\\s])${key}\\s*:`).test(zhBlock) || !new RegExp(`(^|[{,\\s])${key}\\s*:`).test(enBlock))
	.sort();
assert.deepEqual(missingParameterised, [], `parameterised translation keys missing from a dictionary: ${missingParameterised.join(", ")}`);

// ---------------------------------------------------------------- 4. css classes
const styled = new Set();
for (const match of source.matchAll(/\.(sy-[a-z0-9-]+)\s*[,{:>]/g)) styled.add(match[1]);
const rendered = new Set();
for (const match of source.matchAll(/className:\s*"([^"]+)"/g)) {
	for (const name of match[1].split(/\s+/)) if (name.startsWith("sy-")) rendered.add(name);
}
const unstyled = [...rendered].filter((name) => !styled.has(name)).sort();
assert.deepEqual(unstyled, [], `rendered but never styled: ${unstyled.join(", ")}`);

// ---------------------------------------------------------------- 6. duplicate props
// A props object with the same key twice is silent — the later one wins — and that is
// exactly the shape a mechanical edit leaves behind (an insert that forgot to remove the
// old lines). One such leftover referenced an identifier that no longer existed, so the
// panel threw on every render and the region went blank. This check needs no rendering,
// so it cannot be defeated by a state a render test happens not to cover.
/** Top-level `key:` names of an object literal body, skipping strings and nested values. */
function staticKeys(block) {
	const keys = [];
	let depth = 0;
	let quote = null;
	let current = "";
	const flush = () => {
		const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(current.trim());
		if (match) keys.push(match[1]);
		current = "";
	};
	for (let i = 0; i < block.length; i++) {
		const char = block[i];
		if (quote !== null) {
			current += char;
			if (char === "\\") { current += block[++i] ?? ""; continue; }
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") { quote = char; current += char; continue; }
		if (char === "{" || char === "(" || char === "[") depth++;
		else if (char === "}" || char === ")" || char === "]") depth--;
		else if (char === "," && depth === 0) { flush(); continue; }
		current += char;
	}
	flush();
	return keys;
}

/** Index of the `}` matching the `{` at `open`, skipping over quoted strings. */
function matchBrace(text, open) {
	let depth = 0;
	let quote = null;
	for (let i = open; i < text.length; i++) {
		const char = text[i];
		if (quote !== null) {
			if (char === "\\") { i++; continue; }
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") { quote = char; continue; }
		if (char === "{") depth++;
		else if (char === "}") { depth--; if (depth === 0) return i; }
	}
	return -1;
}

// Covers both `h(Component, {` and `h("div", {`: a duplicated key is a bug shape either
// way, and the string-tag form is where the first version of this check was blind.
const propsLiterals = [...source.matchAll(/h\(\s*(?:"[a-z][\w-]*"|[A-Za-z_$][\w$]*)\s*,\s*\{/g)];
const duplicatedProps = [];
for (const match of propsLiterals) {
	const open = match.index + match[0].length - 1;
	const end = matchBrace(source, open);
	if (end === -1) continue;
	const keys = staticKeys(source.slice(open + 1, end));
	const duplicated = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
	if (duplicated.length > 0) duplicatedProps.push(`${match[0].replace(/\s+/g, " ").trim()} -> ${duplicated.join(", ")}`);
}
assert.deepEqual(duplicatedProps, [], `duplicate keys in a component's props (the later one wins): ${duplicatedProps.join(" | ")}`);
assert.ok(propsLiterals.length >= 5, `expected several props literals, found ${propsLiterals.length}`);

console.log(`client hygiene: ${called.size} setters resolved, ${used.size} translation keys present, ${rendered.size} classes styled`);
