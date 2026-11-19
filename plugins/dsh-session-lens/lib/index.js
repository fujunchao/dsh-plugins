/**
 * dsh-session-lens — 跨项目只读会话浏览（模型工具）。
 *
 * 三个工具：`session_projects`（项目目录）、`session_find`（跨区检索）、`session_read`（按层/轮次阅读）。
 * 默认作用域是调用方所在工作区，跨区必须显式 `scope: "all"`。
 *
 * 本包只依赖 node: 内置模块：宿主插件经 link 装进 profile 后，裸导入
 * `@deepseek-ai/*` 会因 realpath 解析落到工作区而失败，所以参数 schema 手写成标准
 * JSON Schema，配置也手写校验（同 `dsh-siyuan-notes` 的做法）。
 *
 * @module dsh-session-lens
 */

import { normalizeConfig } from "./config.js";
import { TOOLS } from "./tools.js";
import { PROMPT_TEXT } from "./prompt.js";
import { executeProjects } from "./projects.js";
import { executeFind } from "./find.js";
import { executeRead } from "./read.js";

export const name = "session-lens";

/**
 * 硬依赖：工具注册表、提示词注册表、会话查询服务。
 * `workspaceRegistry` 走可选读取（`ctx.get`）——没有它时退化成“按 cwd 分组”，而不是整插件不加载。
 */
export const inject = ["tools", "systemPrompt", "sessionQuery"];

const TEXT_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

/**
 * 挂载三个工具与一段模型指引。
 * @param {import("@deepseek-ai/cordis").Context} ctx 插件上下文。
 * @param {unknown} rawConfig profile patch 里这一行的 config（可缺省）。
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);

  ctx.systemPrompt.section({
    name: "tool:session-lens",
    order: ctx.systemPrompt.getSectionOrder("TOOL_SESSION_QUERY") + 1,
    text: PROMPT_TEXT,
  });

  /** @type {Record<string, (args: any, exec: any) => Promise<string>>} */
  const handlers = {
    session_projects: (args, exec) => executeProjects(ctx, config, args, exec),
    session_find: (args, exec) => executeFind(ctx, config, args, exec),
    session_read: (args, exec) => executeRead(ctx, config, args, exec),
  };

  for (const spec of TOOLS) {
    ctx.tools.register({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: TEXT_OUTPUT,
      timeoutMs: spec.name === "session_find" ? config.searchTimeoutMs : undefined,
      // 注册表按 `(args) => boolean` 调用它，传字面量 true 会在执行期炸。
      isConcurrencySafe: () => spec.isConcurrencySafe === true,
      execute: handlers[spec.name],
    });
  }
}
