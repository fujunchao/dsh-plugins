/**
 * 调用方身份与目标会话 id。
 *
 * 授权信息来自**调用方**，绝不来自模型参数：模型只能选“读哪一个已存在的会话”，
 * 不能声明“我是谁”。调用方身份取自工具执行的 `exec.agent`；拿不到 header 时回退到
 * `ctx.sessionQuery.filterSessions`，而不是猜。
 *
 * @module dsh-session-lens/caller
 */

import { CODES, LensError } from "./errors.js";

/** 规范 URI 前缀，与 `dsh-session-reference` 保持一致。 */
export const REF_SCHEME = "dsh-session:";

/**
 * 把一个会话 id 编成可粘贴的规范 URI。
 * @param {string} sessionId 会话 id。
 * @returns {string} `dsh-session:<base64url>`。
 */
export function sessionRef(sessionId) {
  return `${REF_SCHEME}${Buffer.from(String(sessionId), "utf8").toString("base64url")}`;
}

/**
 * 解析模型给的会话标识：接受裸 id，也接受 `dsh-session:<base64url>`。
 * @param {unknown} value 模型参数。
 * @returns {string} 会话 id。
 */
export function parseSessionId(value) {
  const text = String(value ?? "").trim();
  if (text === "") throw new LensError(CODES.badArgs, "session_id must be a non-empty string");
  if (!text.startsWith(REF_SCHEME)) return text;
  const encoded = text.slice(REF_SCHEME.length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    if (decoded === "") throw new Error("empty");
    return decoded;
  } catch {
    throw new LensError(CODES.badArgs, `session_id is not a valid ${REF_SCHEME} reference`);
  }
}

/**
 * 解析调用方会话。
 * @param {any} ctx 插件上下文。
 * @param {any} exec 工具执行上下文。
 * @param {AbortSignal} [signal] 取消信号。
 * @returns {Promise<{id: string, header: any, cwd: string | undefined}>} 调用方身份。
 */
export async function resolveCaller(ctx, exec, signal) {
  const agent = exec?.agent;
  if (agent === undefined || agent === null) {
    throw new LensError(CODES.noAgent, "session lens tools require an agent-bound caller");
  }
  const id = agent.session?.id ?? agent.id;
  if (typeof id !== "string" || id === "") {
    throw new LensError(CODES.noAgent, "the calling agent has no session identity");
  }
  let header = agent.session?.header;
  if (header === undefined || header === null) {
    const records = await ctx.sessionQuery.filterSessions([{ kind: "id", values: [id] }], signal);
    header = records[0]?.header;
  }
  if (header === undefined || header === null) {
    throw new LensError(CODES.unknownSession, `caller session ${id} is not readable`);
  }
  return { id, header, cwd: header.cwd };
}

/**
 * 一个会话是否属于调用方所在工作区（cwd 字符串精确相等）。
 * @param {string | undefined} callerCwd 调用方 cwd。
 * @param {string | undefined} targetCwd 目标 cwd。
 * @returns {boolean} 是否同区。
 */
export function sameWorkspace(callerCwd, targetCwd) {
  return callerCwd !== undefined && targetCwd !== undefined && callerCwd === targetCwd;
}
