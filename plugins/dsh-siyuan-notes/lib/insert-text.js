import { randomBytes } from "node:crypto";

const ID = /^\d{14}-[a-z0-9]{7}$/;
const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message }, ...extra });
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function newBlockID() {
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].map((x, i) => i ? String(x).padStart(2, "0") : String(x)).join("");
  return date + "-" + randomBytes(7).toString("hex").slice(0, 7);
}

// 只新增一个纯文本段落。显式 doc/after 或当前原生块定位，不覆盖用户已有内容。
export function createTextInsertTool({ call, backup, editorContext }) {
  const api = async (path, payload) => {
    const result = await call(path, payload);
    if (!result.ok || result.value?.code !== 0) throw new Error(result.error?.message || result.value?.msg || "思源请求失败");
    return result.value.data;
  };
  return {
    name: "siyuan_note_insert_text",
    description: "向思源文档新增一个纯文本段落，不替换、不删除任何已有内容。text 内换行保留，Markdown 标记作为普通文字。doc 省略时使用当前文档；after 是同文档内容块 ID，省略时追加到文档末尾。需要插在当前光标块后时，先用 siyuan_note_context 读取 blockId，再显式传 after。写前备份、写后确认；返回未确认时先读取返回的 blockId，不要重复调用。只在用户要求写入笔记时使用。",
    parameters: { type: "object", properties: { text: { type: "string", description: "新增段落的纯文本，最多 20000 字符" }, doc: { type: "string", description: "目标文档 ID，省略使用当前文档" }, after: { type: "string", description: "插入位置前一个内容块的 ID，省略追加到末尾" } }, required: ["text"], additionalProperties: false },
    output: { schema: { type: "object", additionalProperties: true }, render: (_args, result) => [{ type: "text", text: result.ok ? `已向思源文档插入文字，块 ID：${result.blockId}` : `插入未完成：${result.error?.message}` }] },
    async execute(args) {
      const context = editorContext?.();
      const docId = args?.doc || context?.docId;
      const after = args?.after || "";
      const text = args?.text;
      if (!ID.test(docId || "")) return fail("invalid_document", "请指定有效文档 ID，或先在面板打开文档");
      if (typeof text !== "string" || !text.trim() || text.length > 20000 || text.includes("\0")) return fail("invalid_text", "text 需要 1–20000 字符的非空文本");
      if (after && (!ID.test(after) || after === docId)) return fail("invalid_anchor", "after 必须是文档内的内容块 ID");
      if (context?.docId === docId && context?.view === "native" && context.pending) return fail("editor_busy", "当前原生编辑还未确认保存，请保存完成后再插入");
      let blockId;
      let started = false;
      try {
        if ((await api("/api/block/getBlockInfo", { id: docId })).rootID !== docId) return fail("invalid_document", "目标不是文档");
        if (after && (await api("/api/block/getBlockInfo", { id: after })).rootID !== docId) return fail("invalid_anchor", "锚点不属于目标文档");
        const before = await api("/api/block/getBlockKramdown", { id: docId });
        const receipt = await backup({ docId, title: context?.docId === docId ? context.title : "AI 插入文字", kramdown: before.kramdown });
        if (!receipt.ok) return fail("backup_failed", receipt.error?.message || "备份失败，未插入文字");
        blockId = newBlockID();
        const content = escape(text.replace(/\r\n?/g, "\n")).replaceAll("\n", "<br>");
        const dom = `<div data-node-id="${blockId}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">${content}</div></div>`;
        started = true;
        await api(after ? "/api/block/insertBlock" : "/api/block/appendBlock", { ...(after ? { previousID: after } : { parentID: docId }), dataType: "dom", data: dom });
        for (let attempt = 0; attempt < 8; attempt++) {
          if (attempt) await new Promise(r => setTimeout(r, 250));
          const info = await api("/api/block/getBlockInfo", { id: blockId }).catch(() => null);
          if (info?.rootID !== docId) continue;
          const read = await api("/api/block/getBlockDOM", { id: blockId }).catch(() => null);
          const relative = await api("/api/block/getBlockRelevantIDs", { id: blockId }).catch(() => null);
          if (read?.dom?.includes(content) && relative && (after ? relative.previousID === after : relative.parentID === docId)) {
            return { ok: true, docId, blockId, text, ...(after ? { after } : {}) };
          }
        }
        return fail("insert_unconfirmed", "写入尚未确认，请读取返回块 ID 核对，勿重复插入", { docId, blockId });
      } catch (error) {
        return fail(started ? "insert_unconfirmed" : "insert_failed", error.message, started ? { docId, blockId } : {});
      }
    },
  };
}
