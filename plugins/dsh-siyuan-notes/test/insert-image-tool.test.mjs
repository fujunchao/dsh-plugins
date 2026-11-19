/**
 * dsh-siyuan-notes — 宿主工具 `siyuan_note_insert_image` 的离线测试。
 *
 * 做法：用 `createImageInsertTool(deps)` 注入假内核 / 假文件系统 / 假快照，
 * 不跑 DSH、不连思源、不碰用户库。断言集中在三件"错了会静默出事"的地方：
 *   1. 参数与边界（种类 / 扩展名 / 大小 / 宽度 / 路径穿越）在**碰内核之前**就被挡住；
 *   2. 写入顺序：**快照成功才写**，快照失败必须 0 次写；
 *   3. 锚点解析不许"随便挑一个"（多命中必须报错）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IMAGE_TOOL_LIMITS,
  IMAGE_TOOL_NAME,
  assetPathFromUpload,
  createImageInsertTool,
  imageAltFromFileName,
  imageFileParts,
  imageMarkdown,
  insertedBlockId,
  locateAnchorInKramdown,
  normalizeImageWidth,
} from "../lib/index.js";

// ---------------------------------------------------------------- 纯函数

test("imageFileParts 拆文件名与扩展名（大小写归一、无扩展名返回空串）", () => {
  assert.deepEqual(imageFileParts("D:\\pics\\cover.PNG"), { name: "cover.PNG", ext: ".png" });
  assert.deepEqual(imageFileParts("/tmp/a.b.jpeg"), { name: "a.b.jpeg", ext: ".jpeg" });
  assert.deepEqual(imageFileParts("README"), { name: "README", ext: "" });
  assert.deepEqual(imageFileParts("  /tmp/x.svg  "), { name: "x.svg", ext: ".svg" });
  assert.equal(imageFileParts(""), null);
  assert.equal(imageFileParts("   "), null);
  assert.equal(imageFileParts(".."), null);
  assert.equal(imageFileParts(42), null);
});

test("imageAltFromFileName 去扩展名、转义 ]、折换行、截断 200", () => {
  assert.equal(imageAltFromFileName("照片 1.png"), "照片 1");
  assert.equal(imageAltFromFileName("a.b.png"), "a.b", "按最后一个点去扩展名");
  assert.equal(imageAltFromFileName("README"), "README");
  assert.equal(imageAltFromFileName("a]b.png"), "a\\]b", "右方括号必须转义，否则截断 markdown");
  assert.equal(imageAltFromFileName("a\nb.png"), "a b");
  assert.equal(imageAltFromFileName("x".repeat(300) + ".png").length, IMAGE_TOOL_LIMITS.maxAltLength);
});

test("normalizeImageWidth 只收正数或百分比", () => {
  assert.deepEqual(normalizeImageWidth(560), { ok: true, value: "560px" });
  assert.deepEqual(normalizeImageWidth(560.4), { ok: true, value: "560px" });
  assert.deepEqual(normalizeImageWidth("560"), { ok: true, value: "560px" });
  assert.deepEqual(normalizeImageWidth("100%"), { ok: true, value: "100%" });
  assert.deepEqual(normalizeImageWidth(" 80% "), { ok: true, value: "80%" });
  assert.deepEqual(normalizeImageWidth(undefined), { ok: true, value: null });
  assert.deepEqual(normalizeImageWidth(""), { ok: true, value: null });

  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "10rem", "calc(100% - 10px)", "-10px", "abc", "100 px"]) {
    const result = normalizeImageWidth(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} 必须被拒`);
    assert.equal(result.error.code, "invalid_width");
    assert.ok(result.error.message.length > 0, "必须给中文说明");
  }
});

test("imageMarkdown 的宽度串带分号（思源 IAL 的写法）", () => {
  assert.equal(imageMarkdown("assets/a.png", "图", null), "![图](assets/a.png)");
  assert.equal(imageMarkdown("assets/a.png", "图", "560px"), '![图](assets/a.png){: style="width: 560px;"}');
  assert.equal(imageMarkdown("assets/a.png", "图", "100%"), '![图](assets/a.png){: style="width: 100%;"}');
});

test("insertedBlockId 从事务里取新块 id，形状不对就返回 null", () => {
  assert.equal(insertedBlockId({ code: 0, data: [{ doOperations: [{ action: "insert", id: "20261109100000-abcdefg" }] }] }), "20261109100000-abcdefg");
  assert.equal(insertedBlockId({ code: 0, data: [{ doOperations: [{ action: "delete", id: "x" }] }] }), null);
  assert.equal(insertedBlockId({ code: 0, data: [] }), null);
  assert.equal(insertedBlockId({}), null);
  assert.equal(insertedBlockId(null), null);
});

test("assetPathFromUpload 优先 succMap，退化到 succFiles", () => {
  const envelope = { code: 0, data: { succMap: { "cover.png": "assets/cover-1.png" }, succFiles: [{ path: "assets/other.png" }] } };
  assert.equal(assetPathFromUpload(envelope, "cover.png"), "assets/cover-1.png");
  assert.equal(assetPathFromUpload({ code: 0, data: { succFiles: [{ path: "assets/x.png" }] } }, "cover.png"), "assets/x.png");
  assert.equal(assetPathFromUpload({ code: 0, data: {} }, "cover.png"), "");
  assert.equal(assetPathFromUpload(null, "cover.png"), "");
});

test("工具的注册名与上限是冻结的", () => {
  assert.equal(IMAGE_TOOL_NAME, "siyuan_note_insert_image");
  assert.equal(IMAGE_TOOL_LIMITS.maxBytes, 20 * 1024 * 1024);
  assert.deepEqual([...IMAGE_TOOL_LIMITS.extensions], [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
});

test("模型看到的工具定义：名字、必需参数、枚举与额外属性都收紧", () => {
  const { tool } = makeHarness();
  assert.equal(tool.name, IMAGE_TOOL_NAME);
  assert.equal(typeof tool.description, "string");
  assert.ok(tool.description.length > 40, "描述要够模型判断何时用它");
  const schema = tool.parameters;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["source"], "只有 source 是必需的");
  assert.equal(schema.additionalProperties, false, "多余参数应被拒，而不是静默忽略");
  assert.equal(schema.properties.source.type, "object");
  assert.deepEqual(schema.properties.source.required, ["kind", "value"]);
  assert.deepEqual(schema.properties.source.properties.kind.enum, ["path", "asset"]);
  assert.equal(schema.properties.source.additionalProperties, false);
  // width 故意不写 type：模型可能给数字（像素）或字符串（百分比），两种都要收。
  assert.equal(schema.properties.width.type, undefined);
  assert.equal(typeof tool.execute, "function");
  // render 是模型看到的结果渲染：必须是无损 JSON 的字符串。
  const rendered = tool.output.render({}, { ok: true, docId: "d" });
  assert.equal(Array.isArray(rendered), true);
  assert.equal(rendered[0].type, "text");
  assert.match(rendered[0].text, /docId/);
});

// ---------------------------------------------------------------- 假内核 / 假依赖

const DOC = "20261109100000-doc0001";
const NEW_BLOCK = "20261109100001-newblk1";
const WHOLE = "第一段\n{: id=\"b1\"}\n\n第二段\n{: id=\"b2\"}\n\n显式锚点\n{: id=\"20260101120000-abcdefg\"}";

/**
 * 一套可控的依赖。`kernel(apiPath, payload)` 返回内核信封（`{code,msg,data}`）或转发层失败。
 */
function makeHarness(options = {}) {
  const calls = { kernel: [], upload: [], readFile: [], backup: [] };
  let targetDoc;
  let storedDocument = null;
  let insertedText = "";
  let insertedPrevious = "";
  const kernel =
    options.kernel ??
    ((apiPath) => {
      if (apiPath === "/api/block/getBlockKramdown") return { code: 0, msg: "", data: { kramdown: WHOLE } };
      if (apiPath === "/api/block/appendBlock" || apiPath === "/api/block/insertBlock") {
        return { code: 0, msg: "", data: [{ doOperations: [{ action: "insert", id: NEW_BLOCK }] }] };
      }
      if (apiPath === "/api/query/sql") return { code: 0, msg: "", data: [] };
      return { code: 0, msg: "", data: null };
    });
  const deps = {
    call: async (apiPath, payload) => {
      calls.kernel.push({ apiPath, payload });
      if (apiPath === "/api/block/getBlockInfo") {
        targetDoc ??= payload.id;
        return { ok: true, value: { code: 0, data: { rootID: targetDoc } } };
      }
      if (apiPath === "/api/block/getBlockRelevantIDs") return { ok: true, value: { code: 0, data: { parentID: targetDoc, previousID: insertedPrevious, nextID: "" } } };
      if (apiPath === "/api/block/getBlockKramdown" && payload.id === NEW_BLOCK && insertedText) return { ok: true, value: { code: 0, data: { kramdown: `${insertedText}\n{: id="${NEW_BLOCK}"}` } } };
      if (apiPath === "/api/block/getBlockKramdown" && storedDocument !== null) return { ok: true, value: { code: 0, data: { kramdown: storedDocument } } };
      const envelope = kernel(apiPath, payload);
      if (apiPath === "/api/block/getBlockKramdown" && envelope.code === 0 && typeof envelope.data?.kramdown === "string") storedDocument = envelope.data.kramdown;
      const created = insertedBlockId(envelope);
      if ((apiPath === "/api/block/appendBlock" || apiPath === "/api/block/insertBlock") && envelope.code === 0 && created) {
        insertedText = payload.data;
        insertedPrevious = payload.previousID ?? "";
        const row = `${payload.data}\n{: id="${created}"}`;
        const marker = `{: id="${payload.previousID}"}`;
        const at = payload.previousID ? storedDocument.indexOf(marker) : -1;
        storedDocument = at < 0 ? `${storedDocument}\n\n${row}` : storedDocument.slice(0, at + marker.length) + `\n\n${row}` + storedDocument.slice(at + marker.length);
      }
      return envelope && envelope.transport === "fail" ? { ok: false, error: envelope.error } : { ok: true, value: envelope };
    },
    upload: async (input) => {
      calls.upload.push(input);
      return options.upload
        ? options.upload(input)
        : {
            ok: true,
            value: {
              code: 0,
              msg: "",
              // succMap 按上传时的原文件名做 key，succFiles 是无条件兜底 —— 内核两种都给。
              data: { succMap: { "cover.png": "assets/cover-20261109-abc.png" }, succFiles: [{ path: "assets/cover-20261109-abc.png" }] },
            },
          };
    },
    readFile: async (filePath) => {
      calls.readFile.push(filePath);
      if (options.readFile) return options.readFile(filePath);
      return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    },
    // 注意：`undefined` 表示"用默认（有打开文档）"，`null` 表示"面板没打开任何文档"。
    editorContext: () => (options.editorContext === undefined ? { docId: DOC, title: "第一章" } : options.editorContext),
    backup: async (input) => {
      calls.backup.push(input);
      return options.backup ? options.backup(input) : { ok: true, value: { file: "2026-11-09-snapshot.md" } };
    },
  };
  return { tool: createImageInsertTool(deps), calls };
}

/** 数一下"写内核"的调用（insertBlock / appendBlock）。 */
function writeCalls(calls) {
  return calls.kernel.filter((item) => item.apiPath === "/api/block/insertBlock" || item.apiPath === "/api/block/appendBlock");
}

// ---------------------------------------------------------------- 参数校验

test("source 不是对象 / kind 不认 / value 为空 → invalid_source，且不碰内核", async () => {
  const cases = [undefined, null, "assets/a.png", 42, { kind: "url", value: "x" }, { kind: "path", value: "   " }, { kind: "path" }];
  for (const source of cases) {
    const { tool, calls } = makeHarness();
    const result = await tool.execute({ source });
    assert.equal(result.ok, false, JSON.stringify(source));
    assert.equal(result.error.code, "invalid_source", JSON.stringify(source));
    assert.ok(typeof result.error.message === "string" && result.error.message.length > 0);
    assert.equal(calls.kernel.length, 0, "参数不对时不该打内核");
  }
});

test("width 非法 → invalid_width，且在碰内核之前就返回", async () => {
  const { tool, calls } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, width: "10rem" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_width");
  assert.equal(calls.kernel.length, 0);
  assert.equal(calls.upload.length, 0);
});

// ---------------------------------------------------------------- 目标文档

test("doc 缺省 → 用面板当前打开的文档；没有打开的文档 → no_open_document 且什么都不做", async () => {
  {
    const { tool, calls } = makeHarness();
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.docId, DOC);
    assert.equal(calls.backup.length, 1, "写前要落快照");
  }
  {
    const { tool, calls } = makeHarness({ editorContext: null });
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "no_open_document");
    assert.equal(calls.upload.length, 0);
    assert.equal(writeCalls(calls).length, 0);
  }
});

test("doc 给 hpath：零命中 doc_not_found、多命中 ambiguous_doc，都不写", async () => {
  {
    const { tool, calls } = makeHarness({ kernel: (apiPath) => (apiPath === "/api/query/sql" ? { code: 0, msg: "", data: [] } : { code: 0, msg: "", data: { kramdown: WHOLE } }) });
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, doc: "/不存在的路径" });
    assert.equal(result.error.code, "doc_not_found");
    assert.equal(writeCalls(calls).length, 0);
  }
  {
    const { tool, calls } = makeHarness({ kernel: (apiPath) => (apiPath === "/api/query/sql" ? { code: 0, msg: "", data: [{ id: "a" }, { id: "b" }] } : { code: 0, msg: "", data: { kramdown: WHOLE } }) });
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, doc: "/同名文档" });
    assert.equal(result.error.code, "ambiguous_doc");
    assert.match(result.error.message, /2/);
    assert.equal(writeCalls(calls).length, 0);
  }
});

test("doc 给块 id 形状 → 核实为文档后使用", async () => {
  const { tool } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, doc: "20260101120000-abcdefg" });
  assert.equal(result.ok, true);
  assert.equal(result.docId, "20260101120000-abcdefg");
});

// ---------------------------------------------------------------- 取图

test("asset kind：走白名单校验，且**不调用上传**", async () => {
  const { tool, calls } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/已有图片.png" } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.assetPath, "assets/已有图片.png");
  assert.equal(calls.upload.length, 0, "asset kind 不该再上传一次");
  assert.equal(calls.readFile.length, 0, "也不该读本地文件");
});

test("asset kind 的穿越与非 assets 前缀被白名单拒绝（不碰内核）", async () => {
  for (const bad of ["assets/../etc/passwd", "/etc/passwd", "http://evil/x.png", "assets/a.png?x=1", "pics/a.png"]) {
    const { tool, calls } = makeHarness();
    const result = await tool.execute({ source: { kind: "asset", value: bad } });
    assert.equal(result.ok, false, bad);
    assert.equal(result.error.code, "invalid_asset_path", bad);
    assert.equal(writeCalls(calls).length, 0);
  }
});

test("path kind：扩展名白名单 / 空文件 / 超大 / 读不到，都不上传不写", async () => {
  {
    const { tool, calls } = makeHarness();
    const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/evil.exe" } });
    assert.equal(result.error.code, "unsupported_image");
    assert.equal(calls.upload.length, 0);
    assert.equal(writeCalls(calls).length, 0);
  }
  {
    const { tool, calls } = makeHarness();
    const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/notes.txt" } });
    assert.equal(result.error.code, "unsupported_image");
    assert.equal(calls.upload.length, 0);
  }
  {
    const { tool, calls } = makeHarness({ readFile: () => Buffer.alloc(0) });
    const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/empty.png" } });
    assert.equal(result.error.code, "file_not_found");
    assert.equal(calls.upload.length, 0);
  }
  {
    const { tool, calls } = makeHarness({ readFile: () => Buffer.alloc(IMAGE_TOOL_LIMITS.maxBytes + 1) });
    const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/huge.png" } });
    assert.equal(result.error.code, "image_too_large");
    assert.equal(calls.upload.length, 0, "超限不该把 20MB 传给内核");
  }
  {
    const { tool, calls } = makeHarness({ readFile: () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); } });
    const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/none.png" } });
    assert.equal(result.error.code, "file_not_found");
    assert.equal(calls.upload.length, 0);
  }
});

test("path kind：上传成功 → 从 succMap 取路径；上传丢路径 → upload_failed", async () => {
  {
    const { tool, calls } = makeHarness();
    const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/cover.png" } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.assetPath, "assets/cover-20261109-abc.png");
    assert.equal(calls.upload.length, 1);
    const uploaded = calls.upload[0];
    assert.match(uploaded.contentType, /^multipart\/form-data; boundary=/);
    assert.ok(Buffer.isBuffer(uploaded.body) && uploaded.body.length > 0, "要转发真实字节");
  }
  {
    const { tool, calls } = makeHarness({ upload: () => ({ ok: true, value: { code: 0, msg: "", data: {} } }) });
    const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/cover.png" } });
    assert.equal(result.error.code, "upload_failed");
    assert.equal(writeCalls(calls).length, 0, "没拿到资源路径就不能写文档");
  }
});

test("path kind：上传层失败原样冒出来（upstream_unreachable / bad_upstream_response）", async () => {
  const { tool } = makeHarness({ upload: () => ({ ok: false, error: { code: "upstream_unreachable", message: "无法连接思源内核" } }) });
  const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/cover.png" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "upstream_unreachable");
});

// ---------------------------------------------------------------- 写前快照

test("快照失败 → backup_failed，且**一次写都没有**", async () => {
  const { tool, calls } = makeHarness({ backup: () => ({ ok: false, error: { code: "backup_write_failed", message: "磁盘满了" } }) });
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "backup_failed");
  assert.match(result.error.message, /写入前的快照失败/);
  assert.equal(calls.backup.length, 1);
  assert.equal(writeCalls(calls).length, 0, "没有快照就不许写文档");
});

test("快照拿到的是整篇 kramdown，且发生在写入之前", async () => {
  const { tool, calls } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
  assert.equal(result.ok, true);
  assert.equal(calls.backup.length, 1);
  assert.deepEqual(calls.backup[0], { docId: DOC, title: "第一章", kramdown: WHOLE });
  const order = calls.kernel.map((item) => item.apiPath);
  assert.ok(order.indexOf("/api/block/getBlockKramdown") < order.indexOf("/api/block/appendBlock"), "读全文 + 快照要早于写入");
});

// ---------------------------------------------------------------- 插入位置

test("after 缺省 → appendBlock（parentID = 文档 id）", async () => {
  const { tool, calls } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
  assert.equal(result.ok, true);
  const writes = writeCalls(calls);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].apiPath, "/api/block/appendBlock");
  assert.deepEqual(writes[0].payload, { parentID: DOC, dataType: "markdown", data: "![a](assets/a.png)" });
  assert.equal(result.after, undefined, "没给锚点时不该有 after 字段");
});

test("after 是块 id → insertBlock（previousID = 那个块）", async () => {
  const { tool, calls } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, after: "20260101120000-abcdefg" });
  assert.equal(result.ok, true);
  const writes = writeCalls(calls);
  assert.equal(writes[0].apiPath, "/api/block/insertBlock");
  assert.deepEqual(writes[0].payload.previousID, "20260101120000-abcdefg");
  assert.equal(result.after, "20260101120000-abcdefg");
  assert.match(result.summary, /之后/);
});

test("after 是唯一文本 → 在 kramdown 里定位后 insertBlock；全程 0 次 SQL", async () => {
  const { tool, calls } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, after: "第二段" });
  assert.equal(result.ok, true, JSON.stringify(result));
  const writes = writeCalls(calls);
  assert.equal(writes[0].apiPath, "/api/block/insertBlock");
  assert.equal(writes[0].payload.previousID, "b2", "WHOLE 里「第二段」那一块的 IAL id 就是 b2");
  // 这条断言现在证明的是"**不依赖 blocks 索引**"本身：大库里索引要 3.5 秒才就绪，
  // 走 SQL 会让"刚建好的文档插不进图"，所以正文锚点必须只看已经读到的 kramdown。
  const sqlCalls = calls.kernel.filter((item) => item.apiPath === "/api/query/sql").length;
  assert.equal(sqlCalls, 0, "正文锚点定位不该查 SQL（索引异步，大库里要等 3.5 秒）");
});

test("after 文本命中不同块 → ambiguous_anchor（不许随便挑一个），0 次写", async () => {
  const ambiguous = "第一段\n{: id=\"b1\"}\n\n另一段也提第一段\n{: id=\"b2\"}";
  const { tool, calls } = makeHarness({
    kernel: (apiPath) => {
      if (apiPath === "/api/block/getBlockKramdown") return { code: 0, msg: "", data: { kramdown: ambiguous } };
      return { code: 0, msg: "", data: [{ doOperations: [{ action: "insert", id: NEW_BLOCK }] }] };
    },
  });
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, after: "第一段" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ambiguous_anchor");
  assert.match(result.error.message, /2/);
  assert.equal(writeCalls(calls).length, 0);
  assert.equal(calls.kernel.filter((item) => item.apiPath === "/api/query/sql").length, 0);
});

test("after 文本零命中 → anchor_not_found，0 次写、0 次 SQL", async () => {
  const { tool, calls } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, after: "根本没有这段" });
  assert.equal(result.error.code, "anchor_not_found");
  assert.equal(writeCalls(calls).length, 0);
  assert.equal(calls.kernel.filter((item) => item.apiPath === "/api/query/sql").length, 0);
});

test("SQL 只出现在「按 hpath 解析文档」这一条路上", async () => {
  {
    const { tool, calls } = makeHarness({
      kernel: (apiPath) => {
        if (apiPath === "/api/query/sql") return { code: 0, msg: "", data: [{ id: DOC, content: "第一章" }] };
        if (apiPath === "/api/block/getBlockKramdown") return { code: 0, msg: "", data: { kramdown: WHOLE } };
        return { code: 0, msg: "", data: [{ doOperations: [{ action: "insert", id: NEW_BLOCK }] }] };
      },
    });
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, doc: "/第一章" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(calls.kernel.filter((item) => item.apiPath === "/api/query/sql").length, 1, "hpath 解析用 SQL");
  }
  {
    const { tool, calls } = makeHarness();
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
    assert.equal(result.ok, true);
    assert.equal(calls.kernel.filter((item) => item.apiPath === "/api/query/sql").length, 0, "doc 缺省（面板文档）不查 SQL");
  }
});

// --- locateAnchorInKramdown：正文锚点定位的全部语义细节 -----------------------

test("locateAnchorInKramdown：找到含文本的行，向下取最近的 IAL id", () => {
  const kramdown = "　　第一段正文\n{: id=\"20260101120000-aaaaaaa\" updated=\"1\"}\n\n　　第二段正文\n{: id=\"20260101120000-bbbbbbb\" updated=\"1\"}";
  assert.deepEqual(locateAnchorInKramdown(kramdown, "第二段正文"), { ok: true, value: "20260101120000-bbbbbbb" });
  assert.deepEqual(locateAnchorInKramdown(kramdown, "第一段"), { ok: true, value: "20260101120000-aaaaaaa" });
});

test("locateAnchorInKramdown：块内多行命中同一个块不算歧义", () => {
  const kramdown = "　　甲\n　　乙\n　　丙\n{: id=\"20260101120000-ccccccc\"}";
  assert.deepEqual(locateAnchorInKramdown(kramdown, "乙"), { ok: true, value: "20260101120000-ccccccc" });
  assert.deepEqual(locateAnchorInKramdown(kramdown, "甲"), { ok: true, value: "20260101120000-ccccccc" });
});

test("locateAnchorInKramdown：命中不同块才是 ambiguous_anchor", () => {
  const kramdown = "　　张三\n{: id=\"20260101120000-aaaaaaa\"}\n\n　　李四问张三\n{: id=\"20260101120000-bbbbbbb\"}";
  const result = locateAnchorInKramdown(kramdown, "张三");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ambiguous_anchor");
  assert.match(result.error.message, /2/);
});

test("locateAnchorInKramdown：IAL 行本身不算内容，空行是块结束", () => {
  // ① IAL 行不该被当成"含这段文本的正文行"
  const kramdown = "　　正文\n{: id=\"20260101120000-aaaaaaa\" updated=\"20260101120000\"}";
  assert.equal(locateAnchorInKramdown(kramdown, "updated=").ok, false, "属性行不是内容");
  assert.equal(locateAnchorInKramdown(kramdown, '{: id=').ok, false);
  assert.equal(locateAnchorInKramdown(kramdown, "id=").ok, false);

  // ② 空行 = 当前块结束：命中一个"没有 IAL 的块"时，不能错配到下一块的 IAL
  const missingIal = "　　孤立的一段\n\n　　后面一段\n{: id=\"20260101120000-bbbbbbb\"}";
  assert.equal(locateAnchorInKramdown(missingIal, "孤立的一段").ok, false, "空行之后就不该再往下找 IAL");
  assert.equal(locateAnchorInKramdown(missingIal, "孤立的一段").error.code, "anchor_not_found");
  // 而真正属于后面那一块的文本仍然定位得到
  assert.deepEqual(locateAnchorInKramdown(missingIal, "后面一段"), { ok: true, value: "20260101120000-bbbbbbb" });
});

test("locateAnchorInKramdown：缩进的 IAL 也认（列表内层块）", () => {
  const kramdown = "- 列表项\n  {: id=\"20260101120000-inner1\"}\n  - 子项\n    {: id=\"20260101120000-inner2\"}";
  assert.deepEqual(locateAnchorInKramdown(kramdown, "列表项"), { ok: true, value: "20260101120000-inner1" });
  assert.deepEqual(locateAnchorInKramdown(kramdown, "子项"), { ok: true, value: "20260101120000-inner2" });
});

test("locateAnchorInKramdown：文本不在文档里 → anchor_not_found；空文本 → invalid_source", () => {
  const kramdown = "　　正文\n{: id=\"20260101120000-aaaaaaa\"}";
  const missing = locateAnchorInKramdown(kramdown, "不存在");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "anchor_not_found");
  const empty = locateAnchorInKramdown(kramdown, "");
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "invalid_source");
  assert.equal(locateAnchorInKramdown("", "任意").error.code, "anchor_not_found");
  // 纯函数不 trim：只有空串算"没给锚点"。工具那边 `after.trim()` 之后才调用，
  // 所以"全是空格"进不到这里；这里把它当作"找不到这段文本"处理，不假装是参数错误。
  assert.equal(locateAnchorInKramdown(kramdown, "   ").error.code, "anchor_not_found");
});

// ---------------------------------------------------------------- 成功返回与内核异常

test("成功返回含 docId / blockId / assetPath / markdown / summary", async () => {
  const { tool } = makeHarness();
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, alt: "封面", width: 560 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.docId, DOC);
  assert.equal(result.blockId, NEW_BLOCK);
  assert.equal(result.assetPath, "assets/a.png");
  assert.equal(result.markdown, '![封面](assets/a.png){: style="width: 560px;"}');
  assert.match(result.summary, /已在文档/);
  assert.ok(!JSON.stringify(result).includes("undefined"), "工具结果不该带 undefined（DSH 的无损 JSON 检查会拒）");
});

test("alt 缺省时用文件名（去扩展名），显式 alt 也会被同样清洗", async () => {
  {
    const { tool } = makeHarness();
    const result = await tool.execute({ source: { kind: "path", value: "D:/tmp/照片 1.png" } });
    assert.equal(result.markdown, "![照片 1](assets/cover-20261109-abc.png)");
  }
  {
    const { tool } = makeHarness();
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, alt: "带]方括号" });
    assert.equal(result.markdown, "![带\\]方括号](assets/a.png)");
  }
  {
    const { tool } = makeHarness();
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" }, alt: "   " });
    assert.equal(result.markdown, "![a](assets/a.png)", "空白 alt 退回文件名");
  }
});

test("内核信封 code≠0 → kernel_error；写入响应没有新块 id → insert_failed", async () => {
  {
    const { tool, calls } = makeHarness({
      kernel: (apiPath) => {
        if (apiPath === "/api/block/appendBlock") return { code: -1, msg: "tree not found", data: null };
        if (apiPath === "/api/block/getBlockKramdown") return { code: 0, msg: "", data: { kramdown: WHOLE } };
        return { code: 0, msg: "", data: null };
      },
    });
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "kernel_error");
    assert.match(result.error.message, /tree not found/);
    assert.equal(writeCalls(calls).length, 1);
  }
  {
    const { tool } = makeHarness({
      kernel: (apiPath) => {
        if (apiPath === "/api/block/getBlockKramdown") return { code: 0, msg: "", data: { kramdown: WHOLE } };
        if (apiPath === "/api/block/appendBlock") return { code: 0, msg: "", data: [{ doOperations: [{ action: "update" }] }] };
        return { code: 0, msg: "", data: null };
      },
    });
    const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
    assert.equal(result.error.code, "insert_failed");
  }
});

test("读不到正文（空 kramdown）→ doc_not_found，不写", async () => {
  const { tool, calls } = makeHarness({
    kernel: (apiPath) => (apiPath === "/api/block/getBlockKramdown" ? { code: 0, msg: "", data: { kramdown: "" } } : { code: 0, msg: "", data: null }),
  });
  const result = await tool.execute({ source: { kind: "asset", value: "assets/a.png" } });
  assert.equal(result.error.code, "doc_not_found");
  assert.equal(writeCalls(calls).length, 0);
});

test("所有失败都是 {ok:false, error:{code,message}} 且 message 是中文说明", async () => {
  const failures = [
    { args: {}, },
    { args: { source: { kind: "path", value: "D:/tmp/x.exe" } } },
    { args: { source: { kind: "asset", value: "../x.png" } } },
    { args: { source: { kind: "asset", value: "assets/a.png" }, width: "calc(1px)" } },
  ];
  for (const item of failures) {
    const { tool } = makeHarness();
    const result = await tool.execute(item.args);
    assert.equal(result.ok, false, JSON.stringify(item.args));
    assert.equal(typeof result.error?.code, "string");
    assert.ok(/[\u4e00-\u9fa5]/.test(result.error.message), `message 应是中文：${result.error.message}`);
  }
});
