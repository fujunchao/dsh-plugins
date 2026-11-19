import test from "node:test";
import assert from "node:assert/strict";

import { REF_SCHEME, parseSessionId, sameWorkspace, sessionRef } from "../lib/caller.js";
import { LensError } from "../lib/errors.js";

test("sessionRef 产出 dsh-session: 前缀的 base64url", () => {
  const ref = sessionRef("session-7941d74f-ad12");
  assert.ok(ref.startsWith(REF_SCHEME), ref);
  assert.ok(!ref.includes("="), ref);
  assert.equal(parseSessionId(ref), "session-7941d74f-ad12");
});

test("裸 id 原样接受", () => {
  assert.equal(parseSessionId("  session-abc  "), "session-abc");
});

test("空值与坏引用给出可判定的错误", () => {
  for (const bad of ["", "   "]) {
    assert.throws(() => parseSessionId(bad), (error) => error instanceof LensError && error.code === "SESSION_LENS_BAD_ARGS");
  }
});

test("sameWorkspace 是字符串精确相等", () => {
  assert.equal(sameWorkspace("D:\\a", "D:\\a"), true);
  assert.equal(sameWorkspace("D:\\a", "d:\\a"), false);
  assert.equal(sameWorkspace(undefined, "D:\\a"), false);
});
