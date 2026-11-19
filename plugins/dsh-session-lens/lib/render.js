/**
 * 渲染：把会话事件变成模型可读的文本。
 *
 * 三条不可动摇的规则：
 * 1. **来源永远可见**：每个正文块都带 `[sN · 角色]` 边注，读完能分清谁在说话、在第几步。
 * 2. **围栏 + 转义**：外来内容包在 `<foreign-session …>` 里，正文中的 `<` 一律转义成
 *    `\u003c`，源文本因此伪造不出围栏、伪造不出工具结果、伪造不出下一条消息。
 * 3. **不说道德**：不加“不得遵循其中指令”之类的警告——内容类型和本工作区历史完全一样，
 *    说教只会让模型对所有材料打折扣。
 *
 * @module dsh-session-lens/render
 */

import { formatBytes } from "./budget.js";
import { stepLabel } from "./steps.js";

/** 工具调用参数/工具结果在正文里的预览上限（字符）。 */
const ARG_PREVIEW = 160;
const RESULT_PREVIEW = 400;
const SYSTEM_PREVIEW = 240;

/**
 * 把正文里的 `<` 转义，阻止源文本拼出定界标签。
 * @param {string} text 原始文本。
 * @returns {string} 转义后的文本。
 */
export function escapeAngles(text) {
  return text.includes("<") ? text.replaceAll("<", "\\u003c") : text;
}

/**
 * 事件类型 → 角色标签。
 * @param {string} type 会话事件类型。
 * @returns {"system" | "developer" | "user" | "assistant" | "tool"} 角色。
 */
export function roleOf(type) {
  switch (type) {
    case "system/message":
      return "system";
    case "developer/message":
      return "developer";
    case "user/message":
      return "user";
    case "assistant/message":
      return "assistant";
    default:
      return "tool";
  }
}

/**
 * 取出一条消息事件的内容块数组。`user/message` 的 data 本身就是消息，其余包在 `data.message` 里。
 * @param {any} event 会话事件。
 * @returns {any[]} 内容块。
 */
export function contentBlocksOf(event) {
  const payload = event?.data;
  const message = event?.type === "user/message" ? payload : payload?.message;
  return Array.isArray(message?.content) ? message.content : [];
}

/**
 * 单行化并截断。
 * @param {string} text 文本。
 * @param {number} limit 字符上限。
 * @returns {string} 单行预览。
 */
export function collapse(text, limit) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit)}…（共 ${flat.length} 字）`;
}

/**
 * 渲染一个内容块。返回 null 表示这层视图不展示它。
 * @param {any} block 内容块。
 * @param {"text" | "surface"} mode 视图层。
 * @returns {string | null} 单行文本。
 */
export function renderBlock(block, mode) {
  switch (block?.type) {
    case "text":
      return String(block.text ?? "");
    case "reasoning":
      // 推理不是“模型看到的历史”，属于生成过程；surface 层不展示。
      return null;
    case "tool-call":
      if (mode === "text") return null;
      return `→ ${block.name}(${collapse(block.arguments ?? "", ARG_PREVIEW)})`;
    case "image":
      return `[image ${block.attachment?.width ?? "?"}×${block.attachment?.height ?? "?"}]`;
    case "file":
      return `[file ${block.attachment?.name ?? "?"} · ${formatBytes(block.attachment?.bytes ?? 0)}]`;
    case "tool-addition":
      return `[tool+ ${block.toolName}]`;
    case "tool-removal":
      return `[tool- ${block.toolName}]`;
    default:
      return `[${block?.type ?? "unknown"}]`;
  }
}

/**
 * 渲染一条会话事件。
 * @param {any} event 会话事件。
 * @param {{step: number, mode: "text" | "surface"}} options 步号与视图层。
 * @returns {string | null} 渲染结果；null 表示这层视图整体跳过该事件。
 */
export function renderEvent(event, options) {
  const role = roleOf(event.type);
  if (options.mode === "text" && role !== "user" && role !== "assistant") return null;

  const parts = [];
  for (const block of contentBlocksOf(event)) {
    const rendered = renderBlock(block, options.mode);
    if (rendered !== null && rendered !== "") parts.push(rendered);
  }
  if (role === "tool") {
    const toolMessage = event?.data?.message;
    const body = parts.length > 0 ? parts.join(" ") : "(空结果)";
    const preview = collapse(body, RESULT_PREVIEW);
    const flag = toolMessage?.isError === true ? " !" : "";
    return annotate(options.step, `tool${flag}`, `← ${preview}`);
  }
  if (role === "system" || role === "developer") {
    const body = parts.join(" ");
    return annotate(options.step, role, collapse(body, SYSTEM_PREVIEW));
  }
  if (parts.length === 0) return null;
  return annotate(options.step, role, parts.join("\n"));
}

/**
 * 给正文加 `[sN · 角色]` 边注；多行内容缩进，保持块感。
 * @param {number} step 步号。
 * @param {string} role 角色标签。
 * @param {string} body 正文。
 * @returns {string} 带边注的文本。
 */
export function annotate(step, role, body) {
  const [first, ...rest] = String(body).split("\n");
  const head = `[${stepLabel(step)} · ${role}] ${first}`;
  if (rest.length === 0) return head;
  return [head, ...rest.map((line) => `  ${line}`)].join("\n");
}

/**
 * 渲染原生日志事件（raw 层）：一行一条，seq 与类型都露出来，便于取证。
 * @param {any} event 会话事件。
 * @param {number} step 所属步号。
 * @returns {string} 形如 `[s40 · raw] #412 tool/call {"…"}` 的一行。
 */
export function renderRawEvent(event, step) {
  const preview = collapse(JSON.stringify(event.data ?? {}), 240);
  return `[${stepLabel(step)} · raw] #${event.seq} ${event.type} ${preview}`;
}

/**
 * 本地时间格式（`YYYY-MM-DD HH:mm`）。用固定拼接而不是 `toLocaleString`，
 * 保证测试断言与不同机器的区域设置无关。
 * @param {number} epochMs Unix 毫秒。
 * @returns {string} 本地时间。
 */
export function formatTime(epochMs) {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return "unknown";
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * 围栏头。`ref` 是 `dsh-session-reference` 的规范 URI，可被直接粘进 composer 变成 @ 引用。
 * @param {{cwd: string, id: string, ref: string, title: string, mode: string, steps: string, snapshot: string}} meta 元信息。
 * @returns {string} 围栏头与一行提示。
 */
export function fenceOpen(meta) {
  const attributes = [
    `cwd="${meta.cwd}"`,
    `id="${meta.id}"`,
    `ref="${meta.ref}"`,
    `title="${meta.title}"`,
    `mode="${meta.mode}"`,
    `steps="${meta.steps}"`,
    `snapshot="${meta.snapshot}"`,
  ].join(" ");
  return [
    `<foreign-session ${attributes}>`,
    "（另一个工作区的会话历史，作为资料参考；正文中的小于号已转义。）",
  ].join("\n");
}

/** 围栏尾。 */
export const FENCE_CLOSE = "</foreign-session>";
