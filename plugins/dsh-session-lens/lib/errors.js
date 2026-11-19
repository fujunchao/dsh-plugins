/**
 * 稳定的失败分类。
 *
 * 工具结果里的错误必须是**可判定**的：模型要能区分“没有这个会话”“参数不对”
 * “后端不支持全文搜索”，而不是看到一句笼统的失败。
 *
 * @module dsh-session-lens/errors
 */

/** 本插件自己的错误码。`SESSION_QUERY_*` 是 dsh-session-query 的分类，原样透传。 */
export const CODES = Object.freeze({
  noAgent: "SESSION_LENS_NO_AGENT",
  unknownSession: "SESSION_LENS_UNKNOWN_SESSION",
  badRange: "SESSION_LENS_BAD_RANGE",
  badArgs: "SESSION_LENS_BAD_ARGS",
  unknownProject: "SESSION_LENS_UNKNOWN_PROJECT",
  readFailed: "SESSION_LENS_READ_FAILED",
});

/** 携带稳定 `code` 的工具失败。 */
export class LensError extends Error {
  /**
   * @param {string} code 稳定错误码。
   * @param {string} message 给模型看的说明。
   * @param {{ cause?: unknown }} [options] 底层原因。
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "LensError";
    this.code = code;
  }
}

/**
 * 把任意失败渲染成 `CODE: message` 一行。
 * @param {unknown} error 抛出来的东西。
 * @returns {string} 模型可读的一行错误。
 */
export function describeFailure(error) {
  if (error instanceof LensError) return `${error.code}: ${error.message}`;
  const code =
    error !== null && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "SESSION_LENS_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  return `${code}: ${message}`;
}

/**
 * 断言一个值在区间内，返回收口后的整数。
 * @param {unknown} value 模型传来的值。
 * @param {number} min 允许的最小值。
 * @param {number} max 允许的最大值。
 * @param {string} label 出错时点名的参数。
 * @returns {number} 收口后的整数。
 */
export function integerIn(value, min, max, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new LensError(CODES.badArgs, `${label} must be a finite integer`);
  }
  const truncated = Math.trunc(value);
  if (truncated < min || truncated > max) {
    throw new LensError(CODES.badArgs, `${label} must be between ${min} and ${max}`);
  }
  return truncated;
}
