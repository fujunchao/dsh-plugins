import assert from "node:assert/strict";
import { test } from "node:test";
import { createImageInsertTool } from "../lib/index.js";

const DOC = "20261109120000-doc0001";
const BLOCK = "20261109120000-block01";
const OTHER = "20261109120000-other01";
const NEW = "20261109120000-new0001";
const source = { kind: "asset", value: "assets/test.png" };

function fixture({ noWrite = false, wrongContent = false, quoted = false, visibleDelay = 0 } = {}) {
  const blocks = [{ id: BLOCK, text: "锚点正文" }];
  const writes = [];
  const reads = [];
  const backups = [];
  let visibleAt = 0;
  let previousID = "";
  const tool = createImageInsertTool({
    editorContext: () => ({ docId: DOC }),
    call: async (path, payload) => {
      let data;
      if (path.endsWith("/getBlockInfo")) data = { rootID: payload.id === OTHER ? "20261109120000-doc0002" : DOC };
      else if (path.endsWith("/getBlockRelevantIDs")) data = { parentID: DOC, previousID, nextID: "" };
      else if (path.endsWith("/getBlockKramdown")) {
        reads.push(payload.id);
        const visible = blocks.filter((b) => b.id !== NEW || Date.now() >= visibleAt);
        const rows = payload.id === DOC ? visible : visible.filter((b) => b.id === payload.id);
        let kramdown = rows.map((b) => `${b.text}\n{: id="${b.id}"}`).join("\n\n");
        if (quoted && payload.id === DOC) kramdown = kramdown.split("\n").map((line) => "> " + line).join("\n");
        data = { kramdown };
      } else if (path.endsWith("/insertBlock") || path.endsWith("/appendBlock")) {
        writes.push(payload);
        previousID = payload.previousID ?? "";
        visibleAt = Date.now() + visibleDelay;
        if (!noWrite) blocks.push({ id: NEW, text: wrongContent ? "不是图片" : payload.data });
        data = [{ doOperations: [{ action: "insert", id: NEW }] }];
      } else throw new Error(`未预期调用 ${path}`);
      return { ok: true, value: { code: 0, data } };
    },
    backup: async (input) => { backups.push(input); return { ok: true, value: { file: "snapshot.md" } }; },
  });
  return { tool, writes, reads, backups };
}

test("图片锚点必须属于目标文档，跨文档块不得写入", async () => {
  const f = fixture();
  const result = await f.tool.execute({ source, doc: DOC, after: OTHER });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_anchor");
  assert.deepEqual(f.writes, []);
});

test("目标必须是文档，不能把普通段落 ID 当文档", async () => {
  const f = fixture();
  const result = await f.tool.execute({ source, doc: BLOCK });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_document");
  assert.deepEqual(f.writes, []);
});

test("文档 ID 不能作为同级插入锚点", async () => {
  const f = fixture();
  const result = await f.tool.execute({ source, doc: DOC, after: DOC });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_anchor");
  assert.deepEqual(f.writes, []);
});

test("内核仅返回新 ID 但未落盘时，不得报告插图成功", async () => {
  const f = fixture({ noWrite: true });
  const result = await f.tool.execute({ source, doc: DOC, after: BLOCK });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "insert_unconfirmed");
  assert.equal(f.writes.length, 1, "确认过程不得重放写入");
});

test("读回有块但内容不是目标图片时，不得报告成功", async () => {
  const f = fixture({ wrongContent: true });
  const result = await f.tool.execute({ source, doc: DOC, after: BLOCK });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "insert_unconfirmed");
});

test("正确文档中的图片经过读回确认后才成功", async () => {
  const f = fixture();
  const result = await f.tool.execute({ source, doc: DOC, after: BLOCK });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.blockId, NEW);
  assert.ok(f.reads.length > 1);
  assert.equal(f.backups[0].docId, DOC);
  assert.equal(f.writes.length, 1);
});

test("引用容器内的图片和延迟索引不会被误判失败", async () => {
  const f = fixture({ quoted: true, visibleDelay: 500 });
  const result = await f.tool.execute({ source, doc: DOC, after: BLOCK });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.writes.length, 1);
  assert.ok(f.reads.includes(NEW), "校验独立图片块，不能假定整篇没有引用前缀");
});
