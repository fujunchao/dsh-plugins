import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS } from "../lib/config.js";
import { executeFind, keepRecords, scopeFilters } from "../lib/find.js";
import { LensError } from "../lib/errors.js";
import { createExec, createFixtureContext, createFixtureStore, eventTextOf } from "./support/fixture-store.js";
import { hasCorpus, listBuckets, pickSessions } from "./support/corpus.js";

/**
 * 桶名是真实 cwd 的编码（冒号与反斜杠变成短横线），所以从语料里取，不写死：
 * 本机换目录、CI 上没有语料，都不会把维护者的路径带进这个包。
 */
const bucketEnding = (suffix) => listBuckets().find((name) => name.endsWith(suffix));
const CZ = bucketEnding("-cz--");
const DH = bucketEnding("-dh--");

const available = hasCorpus() && CZ !== undefined && DH !== undefined;
const config = { ...DEFAULTS };

const czSessions = available ? pickSessions(CZ, { limit: 3 }) : [];
const dhSessions = available ? pickSessions(DH, { limit: 4 }) : [];

const textOf = (sessions) =>
  sessions
    .flatMap((session) => session.events.map(eventTextOf))
    .join("\n")
    .toLowerCase();

const czText = textOf(czSessions);
const dhText = textOf(dhSessions);

/** 找一个只出现在 dh、不出现在 cz 的长词，用来验证“跨区才搜得到”。 */
const dhOnlyToken = (() => {
  const tokens = dhText.match(/[a-z0-9_.\-]{12,}/g) ?? [];
  return tokens.find((token) => !czText.includes(token)) ?? "";
})();

const allSessions = [...czSessions, ...dhSessions];
const store = available ? createFixtureStore(allSessions) : undefined;
const ctx = available ? createFixtureContext(store) : undefined;
const caller = czSessions[0]?.header;
const exec = caller === undefined ? undefined : createExec(caller);

test("scopeFilters：默认按 cwd 收口，all 才放开", () => {
  assert.deepEqual(scopeFilters("workspace", "D:\\a"), [{ kind: "cwd", values: ["D:\\a"] }]);
  assert.deepEqual(scopeFilters("all", "D:\\a"), []);
});

test("keepRecords 排除调用方自己与（默认）子会话", () => {
  const records = [
    { header: { id: "me", origin: undefined } },
    { header: { id: "child", origin: "subagent" } },
    { header: { id: "other", origin: undefined } },
  ];
  assert.deepEqual(
    keepRecords(records, { callerId: "me", includeSubagents: false }).map((entry) => entry.header.id),
    ["other"],
  );
  assert.deepEqual(
    keepRecords(records, { callerId: "me", includeSubagents: true }).map((entry) => entry.header.id),
    ["child", "other"],
  );
});

test("默认作用域搜不到别的项目", { skip: !available || dhOnlyToken === "" }, async () => {
  const output = await executeFind(ctx, config, { query: dhOnlyToken }, exec);
  assert.ok(output.startsWith("没有命中"), output);
  assert.ok(output.includes("scope=workspace"), output);
});

test("scope=all 才跨到别的项目", { skip: !available || dhOnlyToken === "" }, async () => {
  const output = await executeFind(ctx, config, { query: dhOnlyToken, scope: "all", include_subagents: true }, exec);
  assert.ok(output.includes("scope=all"), output);
  assert.ok(output.includes(dhSessions[0].header.cwd), output);
  assert.ok(output.includes("ref=dsh-session:"), output);
  assert.ok(output.includes("session_read("), output);
});

test("子会话默认被排除，可用 include_subagents 打开", { skip: !available || dhOnlyToken === "" }, async () => {
  const withoutChildren = await executeFind(ctx, config, { query: dhOnlyToken, scope: "all" }, exec);
  const withChildren = await executeFind(
    ctx,
    config,
    { query: dhOnlyToken, scope: "all", include_subagents: true },
    exec,
  );
  const dhChildren = dhSessions.filter((session) => session.header.origin === "subagent").length;
  if (dhChildren === dhSessions.length) {
    assert.ok(withoutChildren.startsWith("没有命中"), withoutChildren);
    assert.ok(withoutChildren.includes("include_subagents"), withoutChildren);
  }
  assert.ok(withChildren.includes("session_read("), withChildren);
});

test("调用方自己的会话不出现在命中里", { skip: !available || dhOnlyToken === "" }, async () => {
  const asChild = createExec({ ...dhSessions[0].header });
  const output = await executeFind(ctx, config, { query: dhOnlyToken, scope: "all", include_subagents: true }, asChild);
  assert.ok(!output.includes(dhSessions[0].header.id), output);
});

test("limit 被收口", { skip: !available }, async () => {
  await assert.rejects(
    executeFind(ctx, config, { query: "session", limit: 999 }, exec),
    (error) => error instanceof LensError && error.code === "SESSION_LENS_BAD_ARGS",
  );
});

test("搜索后端不可用时给出原错误码", () => {
  const failing = createFixtureStore(allSessions.length === 0 ? [] : allSessions, { failSearch: true });
  const failingCtx = createFixtureContext(failing);
  return assert.rejects(
    executeFind(failingCtx, config, { query: "x" }, createExec(caller ?? { id: "s", cwd: "D:\\a" })),
    (error) => error instanceof LensError && error.code === "SESSION_QUERY_SEARCH_DISABLED",
  );
});

test("没有 cwd 的调用方拿到解释而不是空结果", async () => {
  const noCwdStore = createFixtureStore([]);
  const noCwdCtx = createFixtureContext(noCwdStore);
  const output = await executeFind(noCwdCtx, config, { query: "x" }, createExec({ id: "s-1", cwd: undefined }));
  assert.ok(output.includes('scope: "all"'), output);
});
