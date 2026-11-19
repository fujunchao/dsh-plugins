/**
 * 配置归一化。
 *
 * 插件的 config 来自 profile patch 的 insert 行，可能缺字段、传错类型、或者留着上一版
 * 的字段名。这里做的是**保守收口**而不是抛异常：插件加载失败会让三个工具一起消失，
 * 比“配置写错了但插件还在跑”更糟。
 *
 * 注意：本包不导出 Cordis `Config`（schemastery）——手写 plain schema 曾导致冷启动
 * 崩溃（见 2026-11-06 的 dsh-resume 事故），所以校验全部放在运行时。
 *
 * @module dsh-session-lens/config
 */

/** 缺省配置。所有键都在这里有一份唯一真源。 */
export const DEFAULTS = Object.freeze({
  /** 是否对外来内容里的凭据打码。关掉它等于让秘密自由进入上下文。 */
  redactSecrets: true,
  /** 单次 `session_read` 返回正文的字节上限（UTF-8 字节，不是字符数）。 */
  maxReadBytes: 64 * 1024,
  /** `session_find` 一次最多返回多少个会话命中。 */
  maxFindResults: 10,
  /** `session_find` / `session_read` 是否需要显式 `includeSubagents` 才下钻子会话。 */
  includeSubagentsDefault: false,
  /** `session_projects` 一次最多列多少个项目。 */
  maxProjects: 40,
  /** 列出单个项目的会话时最多返回多少个。 */
  maxSessionsPerProject: 12,
  /** 大纲最多列多少行（超了就换更粗的粒度，再超就分页）。 */
  maxOutlineLines: 120,
  /** 搜索工具的协作式截止时间（毫秒）。 */
  searchTimeoutMs: 30_000,
});

/** 每个数值字段的合法区间；越界按最近的边界收口，而不是报错。 */
const RANGES = Object.freeze({
  maxReadBytes: [4 * 1024, 1024 * 1024],
  maxFindResults: [1, 50],
  maxProjects: [1, 200],
  maxSessionsPerProject: [1, 100],
  maxOutlineLines: [10, 500],
  searchTimeoutMs: [1_000, 120_000],
});

/**
 * 把一个原始配置对象收口成完整、类型正确的配置。
 * @param {unknown} raw profile patch 传进来的 config。
 * @returns {typeof DEFAULTS} 归一化后的配置（冻结）。
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  /** @type {any} */
  const out = { ...DEFAULTS };

  for (const key of Object.keys(RANGES)) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const [min, max] = RANGES[key];
      out[key] = Math.trunc(Math.min(max, Math.max(min, value)));
    }
  }
  for (const key of ["redactSecrets", "includeSubagentsDefault"]) {
    if (typeof source[key] === "boolean") out[key] = source[key];
  }
  return Object.freeze(out);
}
