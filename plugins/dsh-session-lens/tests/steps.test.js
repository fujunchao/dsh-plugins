import test from "node:test";
import assert from "node:assert/strict";

import {
  lastSeqOf,
  stepLabel,
  stepOfSeq,
  stepSpan,
  stepStartSeqs,
  stepWindow,
  turnOfSeq,
  turnStartSeqs,
} from "../lib/steps.js";

const records = [
  { seq: 0, type: "permission/preset" },
  { seq: 4, type: "turn/start" },
  { seq: 6, type: "step/start" },
  { seq: 9, type: "step/start" },
  { seq: 10, type: "turn/start" },
  { seq: 12, type: "step/start" },
  { seq: 20, type: "turn/end" },
];

test("stepStartSeqs / turnStartSeqs 各自只认自己的事件", () => {
  assert.deepEqual(stepStartSeqs(records), [6, 9, 12]);
  assert.deepEqual(turnStartSeqs(records), [4, 10]);
  assert.deepEqual(stepStartSeqs([]), []);
});

test("stepOfSeq 把第一步之前的一切算作 s0", () => {
  const starts = stepStartSeqs(records);
  assert.equal(stepOfSeq(starts, 0), 0);
  assert.equal(stepOfSeq(starts, 5), 0);
  assert.equal(stepOfSeq(starts, 6), 1);
  assert.equal(stepOfSeq(starts, 8), 1);
  assert.equal(stepOfSeq(starts, 9), 2);
  assert.equal(stepOfSeq(starts, 99), 3);
});

test("turnOfSeq 仍然用于显示分组", () => {
  const starts = turnStartSeqs(records);
  assert.equal(turnOfSeq(starts, 5), 1);
  assert.equal(turnOfSeq(starts, 10), 2);
});

test("stepWindow 给出闭区间 seq 窗口", () => {
  const starts = stepStartSeqs(records);
  const last = lastSeqOf(records);
  assert.equal(last, 20);
  assert.deepEqual(stepWindow(starts, last, 2, 2), { lowSeq: 9, highSeq: 11, from: 2, to: 2, total: 3 });
  assert.deepEqual(stepWindow(starts, last, 0, 1), { lowSeq: 0, highSeq: 8, from: 0, to: 1, total: 3 });
  assert.deepEqual(stepWindow(starts, last, 3, 3), { lowSeq: 12, highSeq: 20, from: 3, to: 3, total: 3 });
});

test("没有步时窗口退化成整段", () => {
  assert.deepEqual(stepWindow([], 42, 0, 9), { lowSeq: 0, highSeq: 42, from: 0, to: 0, total: 0 });
});

test("标签", () => {
  assert.equal(stepLabel(0), "s0");
  assert.equal(stepSpan(3, 3), "s3");
  assert.equal(stepSpan(3, 5), "s3–5");
});
