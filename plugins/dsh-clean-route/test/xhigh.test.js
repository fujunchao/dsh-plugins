import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { archiveForm, readText, replaceEntryText, walkFiles } from "../lib/asar.js";
import { EDITS, applyCommand, inspect, mountedArchive, patchSource } from "../lib/xhigh.js";

/** 未打补丁的 google-shared 片段（三处锚点都在）。 */
const SNIPPET = [
  "const GOOGLE_SDK_THINKING_LEVEL_MAP = {",
  "    THINKING_LEVEL_UNSPECIFIED: GoogleSdkThinkingLevel.THINKING_LEVEL_UNSPECIFIED,",
  "    MINIMAL: GoogleSdkThinkingLevel.MINIMAL,",
  "    LOW: GoogleSdkThinkingLevel.LOW,",
  "    MEDIUM: GoogleSdkThinkingLevel.MEDIUM,",
  "    HIGH: GoogleSdkThinkingLevel.HIGH,",
  "};",
  "export function resolveGoogleThinkingLevel(model, level) {",
  "    const mapped = model.thinkingLevelMap?.[level];",
  "    const resolvedLevel = typeof mapped === \"string\" ? mapped.toLowerCase() : level;",
  "    switch (resolvedLevel) {",
  "        case \"minimal\":",
  "        case \"low\":",
  "        case \"medium\":",
  "        case \"high\":",
  "            return resolvedLevel;",
  "        default:",
  "            throw new Error(\"Unsupported\");",
  "    }",
  "}",
  "export function toGoogleThinkingLevel(level) {",
  "    switch (level) {",
  "        case \"minimal\":",
  "            return \"MINIMAL\";",
  "        case \"low\":",
  "            return \"LOW\";",
  "        case \"medium\":",
  "            return \"MEDIUM\";",
  "        case \"high\":",
  "            return \"HIGH\";",
  "    }",
  "}",
  "export const TAIL = \"tail-entry\";",
  "",
].join("\n");

/** 造一个最小 asar：一个目标条目 + 一个紧随其后的条目。 */
function makeArchive(dir, targetContent) {
  const entries = [
    { path: "dsh/a/google-shared.js", content: targetContent },
    { path: "dsh/b/after.js", content: "export const AFTER = \"after-entry\";\n" },
  ];
  const now = new Date().toISOString();
  const header = { files: { dsh: { files: {} } } };
  let offset = 0;
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = header;
    for (const part of parts.slice(0, -1)) {
      node.files[part] ??= { files: {} };
      node = node.files[part];
    }
    const buffer = Buffer.from(entry.content, "utf8");
    node.files[parts.at(-1)] = { size: buffer.length, offset: String(offset) };
    offset += buffer.length;
  }
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const pad = (4 - (json.length % 4)) % 4;
  const paddedJson = pad === 0 ? json : Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(4 + 4 + paddedJson.length, 4);
  prefix.writeUInt32LE(4 + paddedJson.length, 8);
  prefix.writeUInt32LE(json.length, 12);
  const archive = join(dir, "app.asar");
  writeFileSync(archive, Buffer.concat([prefix, paddedJson, ...entries.map((entry) => Buffer.from(entry.content, "utf8"))]));
  return { archive, now };
}

test("patchSource 三处锚点各命中一次，且幂等", () => {
  const first = patchSource(SNIPPET);
  assert.equal(first.changed, true);
  assert.equal(first.applied.length, 3);
  assert.ok(first.source.includes('XHIGH: "XHIGH"'));
  assert.ok(first.source.includes('case "xhigh":'));
  const second = patchSource(first.source);
  assert.equal(second.changed, false);
});

test("锚点漂移时停手，不产生半截改动", () => {
  const drifted = SNIPPET.replace('        case "high":\n            return resolvedLevel;', '        case "high":\n                return resolvedLevel;');
  assert.throws(() => patchSource(drifted), /resolveGoogleThinkingLevel.*命中 0 次/);
});

test("asar round-trip：替换长内容后目标与后续条目都完好", () => {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-asar-"));
  const { archive } = makeArchive(dir, SNIPPET);
  const before = readText(archive, "dsh/a/google-shared.js");
  assert.equal(before, SNIPPET);

  const patched = patchSource(before).source;
  const result = replaceEntryText(archive, "dsh/a/google-shared.js", patched, { backup: false });
  assert.equal(result.form, "archive");
  assert.ok(result.delta > 0);

  assert.equal(readText(archive, "dsh/a/google-shared.js"), patched);
  assert.equal(readText(archive, "dsh/b/after.js"), 'export const AFTER = "after-entry";\n');
});

test("asar round-trip：变短也要保持后续条目偏移正确", () => {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-asar-short-"));
  const { archive } = makeArchive(dir, SNIPPET);
  const shorter = SNIPPET.replace("export const TAIL = \"tail-entry\";\n", "");
  const result = replaceEntryText(archive, "dsh/a/google-shared.js", shorter, { backup: false });
  assert.ok(result.delta < 0);
  assert.equal(readText(archive, "dsh/a/google-shared.js"), shorter);
  assert.equal(readText(archive, "dsh/b/after.js"), 'export const AFTER = "after-entry";\n');
});

test("目录形态直接写普通文件并留备份", () => {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-dir-"));
  const archive = join(dir, "app.asar");
  const file = join(archive, "dsh/a/google-shared.js");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, SNIPPET, "utf8");
  const result = replaceEntryText(archive, "dsh/a/google-shared.js", "patched", { backup: true });
  assert.equal(result.form, "directory");
  assert.ok(result.backup !== null);
  assert.equal(readFileSync(file, "utf8"), "patched");
  assert.equal(readFileSync(result.backup, "utf8"), SNIPPET);
});

test("形态判断：Electron 里 .asar 是挂载点，纯 Node 里同名目录就是目录", () => {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-form-"));
  const fakeArchiveDir = join(dir, "app.asar");
  mkdirSync(fakeArchiveDir, { recursive: true });
  writeFileSync(join(fakeArchiveDir, "inside.txt"), "x", "utf8");

  assert.equal(archiveForm(fakeArchiveDir, { electron: true }), "mounted", "Electron 下 .asar 是挂载点");
  assert.equal(archiveForm(fakeArchiveDir, { electron: false }), "directory", "纯 Node 下同名目录是真的目录");
  assert.equal(archiveForm(join(dir, "missing.asar"), { electron: true }), "missing");

  const file = join(dir, "plain.asar");
  writeFileSync(file, "not really an archive", "utf8");
  assert.equal(archiveForm(file, { electron: true }), "archive", "文件形态一律当归档");
});

test("挂载态写入会被拒绝，并带出可执行命令", () => {
  const dir = mkdtempSync(join(tmpdir(), "clean-route-mounted-"));
  const fakeArchiveDir = join(dir, "app.asar");
  mkdirSync(join(fakeArchiveDir, "dsh"), { recursive: true });
  writeFileSync(join(fakeArchiveDir, "dsh", "x.js"), "x", "utf8");
  assert.throws(
    () => replaceEntryText(fakeArchiveDir, "dsh/x.js", "y", { electron: true }),
    (error) => error.code === "ASAR_MOUNTED" && /挂载状态/.test(error.message),
  );
});

test("inspect 给出形态、是否挂载与补丁命令", () => {
  const status = inspect();
  assert.equal(typeof status.patched, "boolean");
  assert.ok(["archive", "mounted", "directory", "missing"].includes(status.form));
  assert.equal(typeof status.archiveMounted, "boolean");
  assert.match(status.command, /xhigh\.mjs/);
  assert.match(status.command, /apply$/);
  assert.equal(typeof mountedArchive().form, "string");
  assert.match(applyCommand(), /xhigh\.mjs/);
});
