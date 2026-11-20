import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS } from "../lib/config.js";
import { executeRead } from "../lib/read.js";
import { LensError } from "../lib/errors.js";
import { createExec, createFixtureContext, createFixtureStore, eventTextOf } from "./support/fixture-store.js";
import { hasCorpus, listBuckets, loadBucket, pickSessions } from "./support/corpus.js";

/** 桶名来自真实 cwd 的编码，跟着语料走，不在包里写死维护者的路径。 */
const bucketEnding = (suffix) => listBuckets().find((name) => name.endsWith(suffix));
const DH = bucketEnding("-dh--");
const CZ = bucketEnding("-cz--");
const available = hasCorpus() && DH !== undefined && CZ !== undefined;
const countSteps = (session) => session.events.filter((event) => event.type === "step/start").length;

const dhAll = available ? loadBucket(DH) : [];
const czSample = available ? pickSessions(CZ, { limit: 3 }) : [];
/** 步数适中的那个会话：验证“按步读”。 */
const multi = [...dhAll].sort((left, right) => countSteps(left) - countSteps(right)).find((session) => countSteps(session) >= 5);
/** 体积最大的那个会话：验证“装不下先给大纲”。 */
const big = [...dhAll].sort((left, right) => right.events.length - left.events.length)[0];
const sessions = available
  ? [multi, big, ...czSample].filter((session, index, list) => session !== undefined && list.findIndex((other) => other?.header.id === session.header.id) === index)
  : [];
const store = available ? createFixtureStore(sessions) : undefined;
const ctx = available ? createFixtureContext(store) : undefined;

const caller = czSample[0]?.header ?? { id: "session-caller", cwd: "D:\\work\\cz", createdAt: 0 };
const exec = createExec(caller);
const config = { ...DEFAULTS };
const read = (args, overrides = {}) => executeRead(ctx, { ...config, ...overrides }, args, exec);
const totalSteps = multi === undefined ? 0 : countSteps(multi);

test("跨工作区读取只靠点名 session_id 就成立", { skip: !available || multi === undefined }, async () => {
  const output = await read({ session_id: multi.header.id, mode: "outline" });
  assert.ok(output.includes(`id="${multi.header.id}"`), output);
  assert.ok(output.includes(`cwd="` + multi.header.cwd + `"`), output);
  assert.ok(output.includes('mode="outline"'), output);
  assert.ok(output.includes('snapshot="persisted'), output);
});

test("大纲的每行都带步号区间，且覆盖到最后一步", { skip: !available || multi === undefined }, async () => {
  const output = await read({ session_id: multi.header.id, mode: "outline" });
  const body = output.split("\n").filter((line) => /s\d+/.test(line));
  assert.ok(body.length > 0, output.slice(0, 400));
  let maxStep = 0;
  for (const line of body) {
    const match = line.match(/s(\d+)(?:–(\d+))?/);
    if (match === null) continue;
    maxStep = Math.max(maxStep, Number(match[2] ?? match[1]));
  }
  assert.equal(maxStep, totalSteps, `大纲应覆盖到第 ${totalSteps} 步`);
});

test("按步读表层，边注与围栏都对得上", { skip: !available || multi === undefined }, async () => {
  const output = await read({ session_id: multi.header.id, mode: "surface", from: 1, to: 1 });
  assert.ok(output.includes('steps="s1"'), output);
  assert.ok(output.includes("[s1 · "), output);
  assert.ok(output.includes("</foreign-session>"), output);
});

test("text 层只留人话", { skip: !available || multi === undefined }, async () => {
  const output = await read({ session_id: multi.header.id, mode: "text", from: 1, to: 1 });
  assert.ok(!output.includes(" · tool"), output);
  assert.ok(output.includes(" · user]") || output.includes(" · assistant]"), output);
});

test("raw 层暴露 seq 与事件类型", { skip: !available || multi === undefined }, async () => {
  const output = await read({ session_id: multi.header.id, mode: "raw", from: 1, to: 1 });
  assert.ok(output.includes(" · raw] #"), output);
  assert.ok(output.includes("step/start") || output.includes("turn/start"), output);
});

test("装不下时先给大纲，而不是硬塞", { skip: !available || big === undefined }, async () => {
  const output = await read({ session_id: big.header.id }, { maxReadBytes: 2048 });
  assert.ok(output.includes("先给大纲"), output.slice(0, 300));
  assert.ok(output.includes('mode="outline"'), output.slice(0, 300));
});

test("显式区间装不下时截断并给出精确续读参数", { skip: !available || multi === undefined }, async () => {
  const first = await read(
    { session_id: multi.header.id, mode: "surface", from: 1, to: totalSteps },
    { maxReadBytes: 1024 },
  );
  assert.ok(first.includes("已截断"), first.slice(0, 300));
  const match = first.match(/from=(\d+), after_seq=(\d+)/);
  assert.ok(match !== null, first.slice(-300));
  const [, from, afterSeq] = match;
  const second = await read({
    session_id: multi.header.id,
    mode: "surface",
    from: Number(from),
    after_seq: Number(afterSeq),
  });
  const firstBodyLine = first.split("\n")[3];
  assert.ok(!second.includes(firstBodyLine), "续读不应重复已读内容");
});

test("读自己：省略 session_id 就回到调用方会话", async () => {
  const single = createFixtureStore([{ header: caller, events: [] }]);
  const output = await executeRead(createFixtureContext(single), config, { mode: "outline" }, createExec(caller));
  assert.ok(output.includes(`id="${caller.id}"`), output);
});

test("不存在的会话有稳定错误码", async () => {
  await assert.rejects(
    executeRead(createFixtureContext(createFixtureStore([])), config, { session_id: "session-nope" }, exec),
    (error) => error instanceof LensError && error.code === "SESSION_LENS_UNKNOWN_SESSION",
  );
});

test("区间反了给出 SESSION_LENS_BAD_RANGE", { skip: !available || multi === undefined }, async () => {
  await assert.rejects(read({ session_id: multi.header.id, from: 2, to: 1 }), (error) => error.code === "SESSION_LENS_BAD_RANGE");
});

test("坏模式被拒绝", { skip: !available || multi === undefined }, async () => {
  await assert.rejects(read({ session_id: multi.header.id, mode: "everything" }), (error) => error.code === "SESSION_LENS_BAD_ARGS");
});

test("秘密默认被打码，include_secrets 才放行", { skip: !available }, async () => {
  const withSecret = sessions.find((session) =>
    session.events.some((event) => /password\s*[=:]/.test(eventTextOf(event))),
  );
  if (withSecret === undefined) return; // 抽样里没有含密会话时跳过
  const masked = await read({ session_id: withSecret.header.id, mode: "raw" });
  assert.ok(!/password\s*[=:]\s*(?!<redacted)/i.test(masked), "打码后的输出里不应残留明文密码");
  const revealed = await read({ session_id: withSecret.header.id, mode: "raw", include_secrets: true });
  assert.ok(revealed.length > 0);
});
