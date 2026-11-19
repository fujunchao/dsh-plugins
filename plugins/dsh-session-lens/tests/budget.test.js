import test from "node:test";
import assert from "node:assert/strict";

import { byteLength, fitBlocks, formatBytes } from "../lib/budget.js";

test("byteLength 按 UTF-8 计", () => {
  assert.equal(byteLength("abc"), 3);
  assert.equal(byteLength("中"), 3);
});

test("装得下就全给", () => {
  const blocks = [{ text: "aa" }, { text: "bb" }];
  const fitted = fitBlocks(blocks, 100);
  assert.equal(fitted.kept.length, 2);
  assert.equal(fitted.truncated, false);
  assert.equal(fitted.omitted, 0);
});

test("装不下就截断并报告未读条数", () => {
  const blocks = [{ text: "x".repeat(50) }, { text: "y".repeat(50) }];
  const fitted = fitBlocks(blocks, 60);
  assert.equal(fitted.kept.length, 1);
  assert.equal(fitted.truncated, true);
  assert.equal(fitted.omitted, 1);
});

test("单块超预算也不返回空", () => {
  const fitted = fitBlocks([{ text: "x".repeat(200) }], 10);
  assert.equal(fitted.kept.length, 1);
  assert.equal(fitted.truncated, false);
});

test("formatBytes 的档位", () => {
  assert.equal(formatBytes(812), "812 B");
  assert.equal(formatBytes(3200), "3.1 KB");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
});
