import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectIndex,
  matchProjects,
  normalizePath,
  renderProjectDirectory,
  renderProjectSessions,
  subagentCounts,
} from "../lib/projects.js";

const record = (id, cwd, createdAt, parentSession) => ({
  header: { id, cwd, createdAt, parentSession },
  live: false,
  persisted: true,
});

const workspaces = [
  { path: "D:\\work\\cz", title: "cz" },
  { path: "D:\\work\\dh", title: "dh" },
];

const records = [
  record("s-cz-1", "D:\\work\\cz", 300),
  record("s-cz-2", "D:\\work\\CZ", 200),
  record("s-dh-1", "D:\\work\\dh", 400),
  record("s-other", "D:\\tool-cache-temp", 100),
  record("s-child", "D:\\work\\cz", 150, "s-cz-1"),
  record("s-nocwd", undefined, 50),
];

test("normalizePath 归一分隔符、大小写与尾部反斜杠", () => {
  assert.equal(normalizePath("D:/Work/CZ/"), "d:\\work\\cz");
  assert.equal(normalizePath("D:\\work\\cz"), "d:\\work\\cz");
});

test("注册项目按注册表顺序，大小写变体仍算同区", () => {
  const index = buildProjectIndex(workspaces, records);
  assert.equal(index.registered.length, 2);
  assert.equal(index.registered[0].title, "cz");
  assert.equal(index.registered[0].sessions.length, 3); // 含 1 个子会话与 1 个大小写变体
  assert.equal(index.registered[1].sessions.length, 1);
  assert.equal(index.unregistered.length, 1);
  assert.equal(index.unregistered[0].path, "D:\\tool-cache-temp");
  assert.equal(index.sessionCount, 5); // 无 cwd 的不计入
});

test("会话按创建时间倒序", () => {
  const index = buildProjectIndex(workspaces, records);
  const ids = index.registered[0].sessions.map((entry) => entry.header.id);
  assert.deepEqual(ids, ["s-cz-1", "s-cz-2", "s-child"]);
});

test("一个 cwd 出现在多个注册项目时不重复分配", () => {
  const duplicated = [...workspaces, { path: "D:/work/cz/", title: "cz-dup" }];
  const index = buildProjectIndex(duplicated, records);
  assert.equal(index.registered.length, 2);
});

test("subagentCounts 数出每个父会话派生了几个子会话", () => {
  const counts = subagentCounts(records);
  assert.equal(counts.get("s-cz-1"), 1);
  assert.equal(counts.size, 1);
});

test("matchProjects 按标题或路径子串匹配", () => {
  const projects = [{ path: "D:\\work\\dh", title: "dh" }, { path: "D:\\work\\cz", title: "cz" }];
  assert.equal(matchProjects(projects, "DH").length, 1);
  assert.equal(matchProjects(projects, "work").length, 2);
  assert.equal(matchProjects(projects, "  ").length, 0);
});

test("目录默认折叠未注册目录，显式展开时列出它们", () => {
  const index = buildProjectIndex(workspaces, records);
  const collapsed = renderProjectDirectory(index, {
    maxProjects: 40,
    includeUnregistered: false,
    callerCwd: "D:\\work\\cz",
    totalSessions: records.length,
  });
  assert.ok(collapsed.includes("2 个注册项目"), collapsed);
  assert.ok(collapsed.includes("- cz (D:\\work\\cz) — 3 个会话"), collapsed);
  assert.ok(collapsed.includes("未列出"), collapsed);
  assert.ok(!collapsed.includes("D:\\tool-cache-temp"), collapsed);

  const expanded = renderProjectDirectory(index, {
    maxProjects: 40,
    includeUnregistered: true,
    totalSessions: records.length,
  });
  assert.ok(expanded.includes("D:\\tool-cache-temp"), expanded);
});

test("单项目视图列出标题、id 与子会话数", () => {
  const index = buildProjectIndex(workspaces, records);
  const project = index.registered[0];
  const text = renderProjectSessions(
    project,
    { maxSessionsPerProject: 12 },
    subagentCounts(records),
    new Map([["s-cz-1", "记忆插件 v7"]]),
  );
  assert.ok(text.startsWith("cz (D:\\work\\cz) — 3 个会话"), text);
  assert.ok(text.includes("记忆插件 v7 · s-cz-1"), text);
  assert.ok(text.includes("1 个子会话"), text);
  assert.ok(text.includes("(无标题) · s-cz-2"), text);
});
