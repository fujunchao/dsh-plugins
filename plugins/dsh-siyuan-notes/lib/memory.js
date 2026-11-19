/**
 * dsh-siyuan-notes — 记忆体（Host 半边）。
 *
 * 记忆存成一个独立思源笔记本里的普通段落块：正文是人可读的 Markdown，结构化字段挂
 * `custom-mem-*` 自定义属性。之所以不用思源数据库（AV），见 `notes/memory-design.md` §13.1。
 *
 * 本模块只依赖 node: builtins 与注入进去的 `call`，不 import 任何 Cordis 类型，因此
 * `node --test` 可以用一个假内核驱动它。副作用点只有 `call`。
 *
 * 两条实测约束（`notes/memory-design.md` §14.3）决定了这里的形状：
 * 1. SQL 侧索引最多滞后 ~2.4 秒（`attributes` 表与 `blocks.ial` 都会），而
 *    `/api/attr/getBlockAttrs` 是即时直读。所以写入后要进「写穿缓存」，否则会出现
 *    「我明明记了却搜不到」——那是记忆系统最伤信任的 bug。
 * 2. `blocks_fts` 索引 `ial` 列且中文按字/二元组切词，所以正文与属性值都能全文召回；
 *    但单字查询会命中上万条，因此检索强制 ≥2 字。
 *
 * @module dsh-siyuan-notes/memory
 */

/** 记忆笔记本的默认名字。 */
import { MemoryError, memoryFailure, readableMemory, validateMemory, memoryFingerprint, memoryRevision, memoryApprovalHash, assessMemory, canonicalTopic, memoryTopicId, applicableMemory, resolveMemoryScope, scopePath } from "./memory-policy.js";
import { createHash } from 'node:crypto';

export const MEMORY_NOTEBOOK_NAME = "AI 记忆体";

/** 四类记忆。按半衰期分，不按项目分（见设计文档 §4）。 */
export const MEMORY_TYPES = Object.freeze(["preference", "fact", "decision", "state"]);

/** 条目状态。永不删除，只改状态（见设计文档 §5.4）。 */
export const MEMORY_STATUSES = Object.freeze(["candidate", "active", "superseded", "revoked"]);

/** 置信度。常驻注入列出全部有效条目；inferred 默认落候选，交接卡只取 verified / stated。 */
export const MEMORY_CONFIDENCES = Object.freeze(["verified", "stated", "inferred"]);

/** 每类记忆落在哪一篇文档里。文档名 = 主题，条目 = 段落块。 */
export const MEMORY_DOCS = Object.freeze({
  preference: "偏好",
  fact: "事实",
  decision: "决策",
  state: "状态",
});

/** 属性名常量，避免各处散落字符串。 */
export const MEMORY_ATTRS = Object.freeze({
  type: "custom-mem-type",
  project: "custom-mem-project",
  status: "custom-mem-status",
  confidence: "custom-mem-confidence",
  source: "custom-mem-source",
  created: "custom-mem-created",
  refcount: "custom-mem-refcount",
  lastread: "custom-mem-lastread",
  supersedes: "custom-mem-supersedes",
  supersededBy: "custom-mem-superseded-by",
  workspace: "custom-mem-workspace",
  topic: "custom-mem-topic",
  topicId: 'custom-mem-topic-id',
  evidence: "custom-mem-evidence",
  fingerprint: "custom-mem-fingerprint",
  approvalHash: 'custom-mem-approval-hash',
  approvedAt: 'custom-mem-approved-at',
  approvedBy: 'custom-mem-approved-by',
  proposedSupersedes: 'custom-mem-proposed-supersedes',
  /** 思源入库会改写部分写法（成对波浪线、双下划线等）；这里存「读回正文」的指纹，供同文查重。 */
  echo: 'custom-mem-echo',
});

/** 硬上限。全部在这里收口，调用方不能绕过。 */
export const MEMORY_LIMITS = Object.freeze({
  /** 一次检索最多返回多少条。 */
  maxSearchLimit: 25,
  /** 一次检索默认返回多少条。 */
  defaultSearchLimit: 8,
  /** 一次 `memory_read` 最多取多少个 id。 */
  maxReadIds: 20,
  /** 面板一次最多列多少条。 */
  maxListLimit: 200,
  /** 写穿缓存保留最近多少条。 */
  ringSize: 20,
  /** 写穿缓存仅用于跨越索引延迟，最长保留十秒。 */
  ringMaxAgeMs: 10_000,
  /** 常驻注入的字符预算（汉字计）。 */
  sectionMaxChars: 1500,
  /** 单条检索词最长字符数。 */
  maxQueryChars: 120,
  /** 检索词每个词元的最小字符数——中文单字会命中上万条。 */
  minTokenChars: 2,
  /** 一次写入正文的最大字符数。 */
  maxBodyChars: 4000,
  /** 一次 `memory_write` 最多作废多少个旧条目。 */
  maxSupersedes: 5,
});

/**
 * SQL 字符串字面量转义。
 *
 * 思源的 `/api/query/sql` **没有参数绑定**（`WHERE id=?` 会报 "not enough args"），
 * 所以单引号必须自己转义。这条已经在 `notes/siyuan-api-facts.md` §6.1 验证过。
 *
 * @param {unknown} value 任意值，非字符串会被安全地转成字符串。
 * @returns {string} 可放进 SQL 单引号字面量的内容（不含外层引号）。
 */
export function escapeSqlString(value) {
  return String(value ?? "").replaceAll("'", "''");
}

/**
 * 把一个值渲染成 SQL 单引号字面量。
 * @param {unknown} value
 * @returns {string}
 */
export function sqlString(value) {
  return `'${escapeSqlString(value)}'`;
}

/**
 * 去掉 FTS5 有语法含义的字符，把每个词元包成短语。
 *
 * 直接把用户输入塞进 `MATCH` 会让 `-`、`*`、`"` 这些字符变成语法并抛错，所以这里
 * 每个词元都包成 `"…"` 短语，内部的 `"` 加倍转义。
 *
 * `operator` 决定词元之间的关系：
 * - `"and"`（默认）：全部命中，最精确
 * - `"or"`：任一命中，用于 `"and"` 落空后的放宽
 *
 * 放宽是必需的：模型的检索词往往比条目本身更宽（例如用「笔记本 内核 版本」去找一条
 * 只写了「内核」「笔记本」的记忆），纯 AND 会把明明相关的条目判成不存在。
 *
 * @param {unknown} query 用户检索词。
 * @param {"and" | "or"} [operator]
 * @returns {string | null} 可放进 `MATCH '<expr>'` 的表达式；没有可用词元时返回 null。
 */
export function ftsExpression(query, operator = "and") {
  const text = typeof query === "string" ? query.trim().slice(0, MEMORY_LIMITS.maxQueryChars) : "";
  if (text === "") return null;
  const tokens = text
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => [...token].length >= MEMORY_LIMITS.minTokenChars);
  if (tokens.length === 0) return null;
  const quoted = tokens.map((token) => `"${token.replaceAll('"', '""')}"`);
  return quoted.join(operator === "or" ? " OR " : " ");
}

/**
 * 取正文的第一行作为「一句话结论」。
 *
 * 约定（设计文档 §5.2）：正文第一行必须是结论，因为它会被检索结果和常驻注入直接展示。
 *
 * @param {unknown} text 条目正文。
 * @returns {string} 去掉首尾空白的结论行，最多 200 字。
 */
export function conclusionLine(text) {
  const body = readableMemory(text);
  const first = body.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";
  return first.trim().slice(0, 200);
}

/**
 * 把结构化的记忆条目渲染成正文 Markdown。
 *
 * @param {{ statement: string, reason?: string, rejected?: string }} input
 * @returns {string} 以结论行开头的 Markdown。
 */
export function entryMarkdown(input) {
  const statement = String(input?.statement ?? "").trim();
  const lines = [statement.slice(0, MEMORY_LIMITS.maxBodyChars)];
  const reason = String(input?.reason ?? "").trim();
  if (reason !== "") lines.push(`- 理由：${reason.slice(0, MEMORY_LIMITS.maxBodyChars)}`);
  const rejected = String(input?.rejected ?? "").trim();
  if (rejected !== "") lines.push(`- 否决：${rejected.slice(0, MEMORY_LIMITS.maxBodyChars)}`);
  return lines.join("\n").slice(0, MEMORY_LIMITS.maxBodyChars);
}

/**
 * 把一段可读的 Markdown 压成「一个段落块」。
 *
 * 实测（3.8.3，`notes/memory-design.md` §14.4）：`appendBlock` 收到含 `- ` 列表的多行
 * Markdown 时会把它拆成**多个段落块**，而 `setBlockAttrs` 只能标记其中一个——这样一来
 * 「一条记忆 = 一个块」的假设就破了，属性与正文会分家。用 `<br>` 连接可以保证始终只有
 * 一个 `p` 块，而读回的 `content` 仍然是真实换行（`理由` / `否决` 行都还在）。
 *
 * @param {unknown} text 原始 Markdown。
 * @returns {string} 单块安全的 Markdown。
 */
export function singleBlockMarkdown(text) {
  const body = typeof text === "string" ? text.trim() : "";
  if (body === "") return "";
  return body.replace(/\r\n?/gu, "\n").replace(/\n/gu, "<br>");
}

/**
 * 生成一条记忆的 `custom-mem-*` 属性表。
 *
 * 只放短枚举与短标识，长文本一律写在正文里——不是技术限制（属性值其实也进全文索引），
 * 而是属性面板里那一长串你根本不想读（设计文档 §8.3）。
 *
 * @param {{ type: string, project: string, confidence?: string, source?: string, created: string }} spec
 * @returns {Record<string, string>} 可直接交给 `/api/attr/setBlockAttrs` 的属性表。
 */
export function entryAttributes(spec) {
  const type = MEMORY_TYPES.includes(spec?.type) ? spec.type : "fact";
  const confidence = MEMORY_CONFIDENCES.includes(spec?.confidence) ? spec.confidence : "inferred";
  const project = String(spec?.project ?? "*").trim().slice(0, 200) || "*";
  const attributes = {
    [MEMORY_ATTRS.type]: type,
    [MEMORY_ATTRS.project]: project,
    [MEMORY_ATTRS.status]: confidence === "inferred" || spec.status === "candidate" ? "candidate" : "active",
    [MEMORY_ATTRS.confidence]: confidence,
    [MEMORY_ATTRS.created]: String(spec?.created ?? ""),
  };
  const source = String(spec?.source ?? "").trim().slice(0, 300);
  if (source !== "") attributes[MEMORY_ATTRS.source] = source;
  for (const key of ["workspace", "topic", "topicId", "evidence", "fingerprint", "supersedes", "approvalHash", "approvedAt", "approvedBy", "proposedSupersedes"]) {
    if (typeof spec[key] === "string") attributes[MEMORY_ATTRS[key]] = spec[key];
  }
  return attributes;
}

/** SQL 先限定作用域再 LIMIT，避免其他工作区的最新条目挤掉本项目。 */
function memoryFilters(input) {
  const filters = [];
  const attr = (key) => `COALESCE((SELECT value FROM attributes WHERE block_id = b.id AND name = ${sqlString(MEMORY_ATTRS[key])}), '')`;
  if (input.scope) {
    const choices = [`(p.value = '*' AND ${attr("workspace")} IN ('', '*'))`];
    if (input.scope.workspace) choices.push(`(p.value = '*' AND ${attr("workspace")} = ${sqlString(input.scope.workspace)})`);
    for (const [project, root] of Object.entries(input.scope.projectRoots ?? {})) {
      if (input.scope.project !== '*' && input.scope.project !== project) continue;
      choices.push(`(p.value = ${sqlString(project)} AND ${attr("workspace")} = ${sqlString(root)})`);
    }
    filters.push(`  AND (${choices.join(' OR ')})`);
  }
  if (input.trusted) filters.push("  AND c.value IN ('verified', 'stated')");
  if (input.projects?.length) filters.push(`  AND p.value IN (${input.projects.map(sqlString).join(', ')})`);
  if (input.fingerprint) filters.push(`  AND ${attr("fingerprint")} = ${sqlString(input.fingerprint)}`);
  if (input.workspace !== undefined) filters.push(`  AND ${attr('workspace')} = ${sqlString(input.workspace)}`);
  if (input.topic !== undefined) {
    let topic = `LOWER(REPLACE(REPLACE(TRIM(${attr('topic')}), '_', '-'), ' ', '-'))`;
    topic = `REPLACE(${topic}, CHAR(9), '-')`;
    for (let n = 0; n < 7; n++) topic = `REPLACE(${topic}, '--', '-')`;
    const matches = `${topic} = ${sqlString(canonicalTopic(input.topic))}`;
    filters.push(`  AND (${input.topicId ? `${attr('topicId')} = ${sqlString(input.topicId)} OR (${attr('topicId')} = '' AND ${matches})` : matches})`);
  } else if (input.topicId) filters.push(`  AND ${attr('topicId')} = ${sqlString(input.topicId)}`);
  if (input.excludeIds?.length) filters.push(`  AND b.id NOT IN (${input.excludeIds.map(sqlString).join(', ')} )`);
  return filters;
}

const extraSelect = () => ["workspace", "topic", "topicId", "evidence", "fingerprint", "supersedes", "supersededBy", "source", "approvalHash", "approvedAt", "approvedBy", "proposedSupersedes", "echo"].map(key =>
  `COALESCE((SELECT value FROM attributes WHERE block_id = b.id AND name = ${sqlString(MEMORY_ATTRS[key])}), '') AS ${key}`).join(", ");
const memoryOrder = input => input.scope ? `ORDER BY CASE WHEN p.value <> '*' THEN 0 WHEN COALESCE((SELECT value FROM attributes WHERE block_id = b.id AND name = ${sqlString(MEMORY_ATTRS.workspace)}), '') NOT IN ('', '*') THEN 1 ELSE 2 END, b.created DESC, b.id DESC` : 'ORDER BY b.created DESC, b.id DESC';
const scopeRank = (entry, scope) => !scope ? 0 : entry.project !== '*' ? 0 : entry.workspace && entry.workspace !== '*' ? 1 : 2;
const compareEntries = scope => (a, b) => scopeRank(a, scope) - scopeRank(b, scope) || String(b.created).localeCompare(String(a.created)) || b.id.localeCompare(a.id);

/**
 * 把 `attributes` 查询结果折成 `{name: value}`。
 * @param {ReadonlyArray<{ name?: unknown, value?: unknown }>} rows
 * @returns {Record<string, string>}
 */
export function attributesToMap(rows) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = typeof row?.name === "string" ? row.name : "";
    if (name === "") continue;
    map[name] = typeof row?.value === "string" ? row.value : String(row?.value ?? "");
  }
  return map;
}

/**
 * 检索语句（全文召回，带类型/项目/状态过滤）。
 *
 * @param {{ box: string, expression: string, type?: string, project?: string, limit: number }} input
 * @returns {string}
 */
export function buildFtsSearchStatement(input) {
  const filters = [];
  if (input.type) filters.push(`  AND t.value = ${sqlString(input.type)}`);
  if (input.project) filters.push(`  AND p.value = ${sqlString(input.project)}`);
  return [
    "SELECT b.id AS id, b.content AS content, b.markdown AS markdown, b.created AS created,",
    `       t.value AS type, p.value AS project, s.value AS status, c.value AS confidence, ${extraSelect()}`,
    "FROM blocks_fts",
    "JOIN blocks b ON b.id = blocks_fts.id",
    `JOIN attributes t ON t.block_id = b.id AND t.name = ${sqlString(MEMORY_ATTRS.type)}`,
    `JOIN attributes p ON p.block_id = b.id AND p.name = ${sqlString(MEMORY_ATTRS.project)}`,
    `JOIN attributes s ON s.block_id = b.id AND s.name = ${sqlString(MEMORY_ATTRS.status)}`,
    `JOIN attributes c ON c.block_id = b.id AND c.name = ${sqlString(MEMORY_ATTRS.confidence)}`,
    `WHERE blocks_fts MATCH ${sqlString(input.expression)}`,
    `  AND b.box = ${sqlString(input.box)}`,
    input.status ? `  AND s.value = ${sqlString(input.status)}` : "  AND s.value IN ('active', 'candidate')",
    ...filters,
    ...memoryFilters(input),
    memoryOrder(input),
    `LIMIT ${Math.max(1, Math.min(MEMORY_LIMITS.maxSearchLimit, input.limit))};`,
  ].join("\n");
}

/**
 * LIKE 兜底检索（全文词元不足 2 字时用，或 FTS 抛错时退让）。
 * @param {{ box: string, needle: string, type?: string, project?: string, limit: number }} input
 * @returns {string}
 */
export function buildLikeSearchStatement(input) {
  const filters = [];
  if (input.type) filters.push(`  AND t.value = ${sqlString(input.type)}`);
  if (input.project) filters.push(`  AND p.value = ${sqlString(input.project)}`);
  return [
    "SELECT b.id AS id, b.content AS content, b.markdown AS markdown, b.created AS created,",
    `       t.value AS type, p.value AS project, s.value AS status, c.value AS confidence, ${extraSelect()}`,
    "FROM blocks b",
    `JOIN attributes t ON t.block_id = b.id AND t.name = ${sqlString(MEMORY_ATTRS.type)}`,
    `JOIN attributes p ON p.block_id = b.id AND p.name = ${sqlString(MEMORY_ATTRS.project)}`,
    `JOIN attributes s ON s.block_id = b.id AND s.name = ${sqlString(MEMORY_ATTRS.status)}`,
    `JOIN attributes c ON c.block_id = b.id AND c.name = ${sqlString(MEMORY_ATTRS.confidence)}`,
    "WHERE 1 = 1",
    `  AND b.box = ${sqlString(input.box)}`,
    input.status ? `  AND s.value = ${sqlString(input.status)}` : "  AND s.value IN ('active', 'candidate')",
    `  AND (b.content LIKE ${sqlString(`%${input.needle}%`)} OR b.markdown LIKE ${sqlString(`%${input.needle}%`)})`,
    ...filters,
    ...memoryFilters(input),
    memoryOrder(input),
    `LIMIT ${Math.max(1, Math.min(MEMORY_LIMITS.maxSearchLimit, input.limit))};`,
  ].join("\n");
}

/**
 * 纯过滤检索（不带文字条件）。
 *
 * 用户没给检索词时是「浏览」而不是「搜索」：不该生成 `LIKE '%%'` 这种既慢又语义含糊的
 * 条件，直接按类型/项目把 active 条目按时间倒序列出来。
 *
 * @param {{ box: string, type?: string, project?: string, limit: number }} input
 * @returns {string}
 */
export function buildFilterStatement(input) {
  const filters = [];
  if (input.type) filters.push(`  AND t.value = ${sqlString(input.type)}`);
  if (input.project) filters.push(`  AND p.value = ${sqlString(input.project)}`);
  return [
    "SELECT b.id AS id, b.content AS content, b.markdown AS markdown, b.created AS created,",
    `       t.value AS type, p.value AS project, s.value AS status, c.value AS confidence, ${extraSelect()}`,
    "FROM blocks b",
    `JOIN attributes t ON t.block_id = b.id AND t.name = ${sqlString(MEMORY_ATTRS.type)}`,
    `JOIN attributes p ON p.block_id = b.id AND p.name = ${sqlString(MEMORY_ATTRS.project)}`,
    `JOIN attributes s ON s.block_id = b.id AND s.name = ${sqlString(MEMORY_ATTRS.status)}`,
    `JOIN attributes c ON c.block_id = b.id AND c.name = ${sqlString(MEMORY_ATTRS.confidence)}`,
    "WHERE 1 = 1",
    `  AND b.box = ${sqlString(input.box)}`,
    input.status ? `  AND s.value = ${sqlString(input.status)}` : "  AND s.value IN ('active', 'candidate')",
    ...filters,
    ...memoryFilters(input),
    memoryOrder(input),
    `LIMIT ${Math.max(1, Math.min(MEMORY_LIMITS.maxSearchLimit, input.limit))};`,
  ].join("\n");
}

/**
 * 面板用的列表查询：可以按状态过滤（包括 superseded / revoked）。
 *
 * 和 `search` 的区别：`search` 只返回 active（那是给模型用的），面板要看见全貌，
 * 包括已被取代和被撤销的条目——「为什么改过」本身就是记忆的一部分。
 *
 * @param {{ box: string, type?: string, project?: string, status?: string, limit: number }} input
 * @returns {string}
 */
export function buildListStatement(input) {
  const filters = [];
  if (input.type) filters.push(`  AND t.value = ${sqlString(input.type)}`);
  if (input.project) filters.push(`  AND p.value = ${sqlString(input.project)}`);
  if (input.status) filters.push(`  AND s.value = ${sqlString(input.status)}`);
  return [
    "SELECT b.id AS id, b.content AS content, b.markdown AS markdown, b.created AS created,",
    "       t.value AS type, p.value AS project, s.value AS status, c.value AS confidence,",
    "       COALESCE(src.value, '') AS source,",
    "       COALESCE(rc.value, '0') AS refcount,",
    "       COALESCE(lr.value, '') AS lastread,",
    "       COALESCE(sup.value, '') AS supersedes,",
    `       COALESCE(supby.value, '') AS supersededBy, ${extraSelect()}`,
    "FROM blocks b",
    `JOIN attributes t ON t.block_id = b.id AND t.name = ${sqlString(MEMORY_ATTRS.type)}`,
    `JOIN attributes p ON p.block_id = b.id AND p.name = ${sqlString(MEMORY_ATTRS.project)}`,
    `JOIN attributes s ON s.block_id = b.id AND s.name = ${sqlString(MEMORY_ATTRS.status)}`,
    `JOIN attributes c ON c.block_id = b.id AND c.name = ${sqlString(MEMORY_ATTRS.confidence)}`,
    `LEFT JOIN attributes src ON src.block_id = b.id AND src.name = ${sqlString(MEMORY_ATTRS.source)}`,
    `LEFT JOIN attributes rc ON rc.block_id = b.id AND rc.name = ${sqlString(MEMORY_ATTRS.refcount)}`,
    `LEFT JOIN attributes lr ON lr.block_id = b.id AND lr.name = ${sqlString(MEMORY_ATTRS.lastread)}`,
    `LEFT JOIN attributes sup ON sup.block_id = b.id AND sup.name = ${sqlString(MEMORY_ATTRS.supersedes)}`,
    `LEFT JOIN attributes supby ON supby.block_id = b.id AND supby.name = ${sqlString(MEMORY_ATTRS.supersededBy)}`,
    `WHERE b.box = ${sqlString(input.box)}`,
    ...filters,
    ...memoryFilters(input),
    memoryOrder(input),
    `LIMIT ${Math.max(1, Math.min(MEMORY_LIMITS.maxListLimit, input.limit))};`,
  ].join("\n");
}

/**
 * 记忆目录统计语句：每类多少条 active、最近一条什么时候。
 * @param {{ box: string }} input
 * @returns {string}
 */
export function buildCatalogStatement(input) {
  return [
    "SELECT t.value AS type, COUNT(*) AS n, MAX(b.created) AS latest",
    "FROM blocks b",
    `JOIN attributes t ON t.block_id = b.id AND t.name = ${sqlString(MEMORY_ATTRS.type)}`,
    `JOIN attributes s ON s.block_id = b.id AND s.name = ${sqlString(MEMORY_ATTRS.status)} AND s.value = 'active'`,
    `WHERE b.box = ${sqlString(input.box)}`,
    "GROUP BY t.value;",
  ].join("\n");
}

/**
 * 批量取条目全文（含属性）。
 *
 * 用 `IN (...)` 一次取完，避免 N 次往返。id 已经过校验，这里仍逐个转义。
 *
 * @param {{ ids: readonly string[] }} input
 * @returns {string}
 */
export function buildReadStatement(input) {
  const ids = (Array.isArray(input.ids) ? input.ids : [])
    .filter((id) => typeof id === "string" && id !== "")
    .slice(0, MEMORY_LIMITS.maxReadIds);
  const list = ids.map((id) => sqlString(id)).join(", ");
  return [
    "SELECT b.id AS id, b.content AS content, b.markdown AS markdown, b.created AS created,",
    Object.entries(MEMORY_ATTRS).map(([key, attribute]) =>
      `       COALESCE((SELECT value FROM attributes WHERE block_id = b.id AND name = ${sqlString(attribute)}), '') AS ${key}`).join(",\n"),
    "FROM blocks b",
    `WHERE b.id IN (${list})${input.box ? ` AND b.box = ${sqlString(input.box)}` : ""}`,
    `LIMIT ${Math.max(1, ids.length)};`,
  ].join("\n");
}

/**
 * 在记忆笔记本里按标题找文档（用于 `ensure()`）。
 * @param {{ box: string, title: string }} input
 * @returns {string}
 */
export function buildDocLookupStatement(input) {
  return [
    "SELECT id, content, hpath",
    "FROM blocks",
    "WHERE type = 'd'",
    `  AND box = ${sqlString(input.box)}`,
    `  AND (content = ${sqlString(input.title)} OR hpath = ${sqlString(`/${input.title}`)})`,
    "LIMIT 1;",
  ].join("\n");
}

/**
 * 从 `blocks`/`attributes` 查询行拼出一条记忆视图对象。
 * @param {{ id: string, content?: string, markdown?: string, created?: string }} row
 * @param {Record<string, string>} attrs
 * @returns {{
 *   id: string, statement: string, type: string, project: string, status: string,
 *   confidence: string, created: string, source: string, fresh: boolean
 * }}
 */
export function toMemoryEntry(row, attrs) {
  const body = readableMemory(row?.markdown || row?.content);
  return {
    id: String(row?.id ?? ""),
    statement: conclusionLine(body),
    type: attrs[MEMORY_ATTRS.type] ?? "",
    project: attrs[MEMORY_ATTRS.project] ?? "",
    status: attrs[MEMORY_ATTRS.status] ?? "",
    confidence: attrs[MEMORY_ATTRS.confidence] ?? "",
    created: String(row?.created ?? attrs[MEMORY_ATTRS.created] ?? ""),
    source: attrs[MEMORY_ATTRS.source] ?? "",
    ...Object.fromEntries(["workspace", "topic", "topicId", "evidence", "fingerprint", "supersedes", "supersededBy", "approvalHash", "approvedAt", "approvedBy", "proposedSupersedes", "echo"].map(key => [key, attrs[MEMORY_ATTRS[key]] ?? ""])),
    fresh: false,
  };
}

/**
 * 把常驻注入的文本裁到预算内。
 *
 * 按行累加，超预算就停——宁可少列一条，也不让 system prompt 膨胀。
 *
 * @param {string[]} lines
 * @param {number} [budget]
 * @returns {string}
 */
export function clampSectionLines(lines, budget = MEMORY_LIMITS.sectionMaxChars) {
  const kept = [];
  let total = 0;
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = String(line ?? "");
    if (text === "") continue;
    if (total + text.length + 1 > budget) break;
    kept.push(text);
    total += text.length + 1;
  }
  return kept.join("\n");
}

const RECALL_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'not', 'are', 'was', 'you', 'can', 'but', 'what', 'how', 'why', 'when', 'please', 'help', 'need', 'want', 'should', 'would', 'could', 'into', 'about', 'there', 'then', 'them', 'some', 'just', 'like', 'make', 'does', 'will', 'http', 'https', 'www', 'com']);
const RECALL_STOP_GRAMS = new Set(['我们', '你们', '他们', '这个', '那个', '这些', '那些', '一个', '一下', '什么', '怎么', '为什么', '可以', '是否', '需要', '现在', '然后', '但是', '因为', '所以', '如果', '还是', '已经', '没有', '不是', '就是', '还有', '这样', '那样', '时候', '的话', '帮我', '请你', '看看', '一些', '以及', '或者', '并且', '进行', '问题', '看一', '一看', '是不', '不要', '是的', '好的', '能不', '不能', '有没', '没有']);
/**
 * 通用词：出现频率极高、对"定位到某一条记忆"毫无区分度，直接丢弃（不进检索式，也不参与打分）。
 *
 * 实测（.local/memory-v5-review-20261111/recall-ux.md）：`windows`/`html`/`工作区` 这类词
 * 会把完全无关的条目拉进来——「dsh-resume 在 Windows 上杀掉进程算什么退出码」曾命中
 * 「记住登录 30 天（Windows DPAPI）」。
 */
/** 召回候选池上限：调用方要先按常驻索引去重再取前 3，池子太小会把强匹配筛掉。 */
const RECALL_POOL_LIMIT = 12;
/**
 * 常驻注入里最后一条被截断时至少保留多少字正文。
 *
 * v6 是 60；v7 调到 50 的唯一原因是真实库那句话：分组省下的字只够再多放一条 57 字的事实，
 * 而 60 的下限把它挡在门外，位置反而被决策类的第 4 条（69 字）占走。50 仍然是一句完整的话，
 * 再低就会变成没有信息量的半截。
 */
const MIN_TRUNCATED_BODY = 50;
/** 元数据奖励：项目名/主题出现在用户这句话里时的加分。 */
const RECALL_META_BONUS = 3;
/** 没有标识符命中时，中文词元要凑够的总分。 */
const RECALL_MIN_SCORE = 3;
const RECALL_GENERIC_WORDS = new Set(['windows', 'win32', 'linux', 'darwin', 'html', 'json', 'yaml', 'profile', 'cordis', 'patch', 'config', 'setting', 'settings', 'file', 'files', 'dir', 'dirs', 'code', 'test', 'tests', 'work', 'workspace', 'project', 'projects', 'error', 'errors', 'bug', 'bugs', 'api', 'app', 'node', 'module', 'import', 'export']);
const RECALL_GENERIC_GRAMS = new Set(['工作', '作区', '项目', '文件', '目录', '配置', '使用', '支持', '问题', '功能', '内容', '数据', '一致', '情况', '地方', '东西', '方式', '方法', '时间', '部分']);
/** 纯指代词：整句话只有这些，没有可定位的实体，查了只会误召回。 */
const RECALL_PRONOUN_WORDS = ['那个', '这个', '那些', '这些', '上次', '刚才', '前面', '之前', '继续', '接着', '还有', '另外', '别的', '一样', '同上', '好的', '可以', '了解', '收到', '帮我', '请你', '看看', '弄', '搞', '它', '了', '的', '吧', '呢', '啊', '吗', '对', '行', '嗯'];

/**
 * 这句话是不是只剩指代词（没有任何项目名/文件名/专有名词可定位）。
 *
 * @param {unknown} text
 * @returns {boolean} 没有任何可用实体时返回 true（被动召回应当直接静默）
 */
export function isPronounOnlyText(text) {
  const source = String(typeof text === 'string' ? text : '').trim().toLowerCase();
  let rest = source.replace(/[\s\p{P}\p{S}]+/gu, '');
  if (!rest) return true;
  for (const word of [...RECALL_PRONOUN_WORDS].sort((a, b) => b.length - a.length)) rest = rest.split(word).join('');
  return rest === '';
}

/**
 * 从用户的一句话里抽被动召回用的关键词。
 *
 * 英文/标识符按词取（至少 3 个字符，权重 3）；中文没有空格，按连续汉字切二元组（权重 1）。
 * 通用词直接丢弃；数量上限优先保留标识符——文件名、函数名、项目名比常用汉字更能定位到一条记忆。
 *
 * @param {unknown} text
 * @returns {Array<{ text: string, weight: number }>}
 */
export function recallTerms(text) {
  const source = String(typeof text === 'string' ? text : '').slice(-2000).toLowerCase();
  // 只有「继续/那个/好的」这类指代词：不抽词，调用方也就不会发查询。
  if (isPronounOnlyText(source)) return [];
  const words = new Map(), grams = new Map();
  for (const match of source.matchAll(/[a-z_][a-z0-9_.-]{2,39}/gu)) {
    const word = match[0].replace(/[.-]+$/u, '');
    if (word.length >= 3 && !RECALL_STOP_WORDS.has(word) && !RECALL_GENERIC_WORDS.has(word) && !words.has(word)) words.set(word, { text: word, weight: 3 });
  }
  // 先把虚词挖掉再切二元组，否则会切出「看为」「为什」这种跨词的碎片，白白占名额还引来误命中。
  let cjk = source;
  for (const word of [...RECALL_STOP_GRAMS].sort((a, b) => b.length - a.length)) cjk = cjk.replaceAll(word, ' ');
  cjk = cjk.replace(/[的了吗呢吧啊是在和与或就也都把被给让很我你他她它这那]/gu, ' ');
  for (const run of cjk.match(/[\u4e00-\u9fff]{2,}/gu) ?? []) {
    for (let index = 0; index + 1 < run.length; index++) {
      const gram = run.slice(index, index + 2);
      if (RECALL_GENERIC_GRAMS.has(gram)) continue;
      if (!grams.has(gram)) grams.set(gram, { text: gram, weight: 1 });
    }
  }
  return [...[...words.values()].slice(0, 8), ...[...grams.values()].slice(-12)].slice(0, 16);
}

/** 召回行里的类型中文名（与每步提示里的一致）。 */
const RECALL_TYPE_LABELS = Object.freeze({ preference: '偏好', fact: '事实', decision: '决策', state: '状态' });

/**
 * 把一条召回结果渲染成一行提示文本（带 id / 类型 / 项目 / 状态 / 日期）。
 *
 * id 让模型可以直接 memory_read；状态和日期让人一眼看出这条还作不作数。
 * 一行最多 100 字：提示是每步都要付的固定成本，不能让长结论挤爆上下文。
 *
 * @param {{ id?: string, type?: string, project?: string, topic?: string, status?: string, created?: string, statement?: string }} entry
 * @param {number} [maxChars]
 * @returns {string}
 */
export function recallLine(entry, maxChars = 100) {
  const label = RECALL_TYPE_LABELS[entry?.type] ?? String(entry?.type ?? '');
  const project = String(entry?.project ?? '').slice(0, 24);
  const parts = [label + '·' + project];
  parts.push(String(entry?.status ?? 'active') || 'active');
  const created = String(entry?.created ?? '');
  if (/^\d{8}/u.test(created)) parts.push(created.slice(0, 4) + '-' + created.slice(4, 6) + '-' + created.slice(6, 8));
  const prefix = '- ' + String(entry?.id ?? '') + ' [' + parts.join(' · ') + '] ';
  const statement = String(entry?.statement ?? '');
  const room = Math.max(8, maxChars - prefix.length);
  return prefix + (statement.length > room ? statement.slice(0, Math.max(1, room - 1)) + '…' : statement);
}

/**
 * 把一段文本切成字符二元组集合。
 *
 * 中文没有空格，按词切需要分词器；记忆条目的结论行很短，二元组足够区分「同一条被写了
 * 两遍」和「两条不同的结论」。这也是 SiYuan 自己的 FTS 对中文的做法。
 *
 * @param {unknown} text
 * @returns {Set<string>}
 */
export function charBigrams(text) {
  const body = String(typeof text === "string" ? text : "").replace(/\s+/gu, "");
  const grams = new Set();
  if (body.length === 1) grams.add(body);
  for (let index = 0; index + 1 < body.length; index += 1) grams.add(body.slice(index, index + 2));
  return grams;
}

/**
 * 两条结论的相似度（二元组 Jaccard，0..1）。
 * @param {unknown} left
 * @param {unknown} right
 * @returns {number}
 */
export function similarity(left, right) {
  const a = charBigrams(left);
  const b = charBigrams(right);
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * 解析思源时间戳 `yyyyMMddHHmmss`（本地时间）。
 * @param {unknown} value
 * @returns {number | null} epoch 毫秒；解析不了返回 null。
 */
export function parseStamp(value) {
  const text = typeof value === "string" ? value : "";
  if (!/^\d{14}$/u.test(text)) return null;
  const parts = [
    Number(text.slice(0, 4)),
    Number(text.slice(4, 6)) - 1,
    Number(text.slice(6, 8)),
    Number(text.slice(8, 10)),
    Number(text.slice(10, 12)),
    Number(text.slice(12, 14)),
  ];
  const date = new Date(...parts);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** `yyyyMMddHHmmss`，思源自己用的时间戳格式，便于和 `blocks.created` 对齐。 */
export function siyuanStamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

/**
 * 创建记忆存储。
 *
 * @param {{
 *   call: (apiPath: string, payload: unknown) => Promise<{ ok: true, value: any } | { ok: false, error: { code: string, message: string } }>,
 *   now?: () => number,
 *   notebookName?: string,
 *   logger?: { warn?: (message: string) => void }
 * }} options
 */
export function createMemoryStore(options) {
  let disposed = false;
  const unavailable = () => ({ ok: false, error: { code: "connection_changed", message: "思源连接已切换，请在新连接上重试" } });
  // 转发层成功只说明收到了 JSON；所有记忆操作必须在同一个边界校验内核业务码。
  const call = async (apiPath, payload, requestOptions) => {
    if (disposed) return unavailable();
    try {
      const result = await options.call(apiPath, payload, requestOptions);
      if (disposed) return unavailable();
      if (result?.ok !== true) return result ?? { ok: false, error: { code: "kernel_error", message: "内核未返回结果" } };
      if (result.value?.code !== 0) return { ok: false, outcome: typeof result.value?.code === 'number' ? 'rejected' : 'unknown', error: { code: "kernel_error", message: `${apiPath}：${result.value?.msg || "内核返回失败或无效响应"}` } };
      return result;
    } catch (error) {
      return { ok: false, error: { code: "kernel_error", message: error instanceof Error ? error.message : String(error) } };
    }
  };
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? {};
  const notebookName = options.notebookName ?? MEMORY_NOTEBOOK_NAME;

  /** @type {string | null} */
  let box = null;
  /** @type {Map<string, string>} 类型 -> 文档 id。 */
  const docIds = new Map();
  /** @type {Map<string, Promise<string | null>>} 类型 -> 正在进行的查找/创建任务。 */
  const docTasks = new Map();
  /** @type {Array<Record<string, any>>} 写穿缓存：最近写入的条目。 */
  const ring = [];
  // 未被索引确认的状态承担唯一性约束，不能随展示缓存的容量或十秒期限淘汰。
  const pendingStates = new Map();
  const stateCheckedAt = new Map();
  const absentIds = new Set();
  const externalEntries = new Map();
  const observedEntries = new Map();
  const pendingEntries = () => [...new Map([...pendingStates.values(), ...ring, ...externalEntries.values()].map(entry => [entry.id, entry])).values()];
  const pendingAt = new Map();
  /** 已索引条目的状态修改仍要暂时遮住旧索引；不依赖正文是否还在环形缓存。 */
  const pendingAttrs = new Map();
  /** 按作用域保存的不可变快照；会话另持有自己的文本。 */
  const snapshots = new Map();
  let mutationTail = Promise.resolve();
  const receipts = new Map();
  const clearReceipt = async key => { if (options.receipts?.delete) await options.receipts.delete(key); else await options.receipts?.set?.(key, null); receipts.delete(key); };
  const mutationReceipts = new Map();
  const changes = [];
  let revision = 0;
  const changed = (entry) => { changes.push({ ...entry, revision: ++revision }); if (changes.length > 200) changes.shift(); };
  const view = entry => {
    if (!observedEntries.has(entry.id)) { observedEntries.set(entry.id, { ...entry }); if (observedEntries.size > 1024) observedEntries.delete(observedEntries.keys().next().value); }
    return { ...entry, ...assessMemory(entry, now()), revision: memoryRevision(entry) };
  };
  // 2026-11-11：不再要求确认哈希；可信度声明本身决定它能否进入常驻注入与交接卡。
  const trusted = entry => ['verified', 'stated'].includes(entry.confidence);
  const serialize = operation => (...args) => { const task = mutationTail.then(() => operation(...args)); mutationTail = task.catch(() => {}); return task; };

  const warn = (message) => {
    try {
      logger.warn?.(message);
    } catch {
      /* 日志坏了不影响主流程 */
    }
  };

  /** 一次 SQL 查询，返回行数组；失败抛出带错误码的异常，由入口统一转换。 */
  async function query(stmt, requestOptions) {
    const result = await call("/api/query/sql", { stmt }, requestOptions);
    if (result.ok !== true) {
      warn(`记忆体 SQL 失败：${result.error?.message ?? "unknown"}`);
      throw new MemoryError(result.error?.code ?? "kernel_error", result.error?.message ?? "记忆查询失败");
    }
    const data = result.value?.data;
    if (result.value?.truncated === true) throw new MemoryError('incomplete_query', '思源截断了查询结果，尚不能确认记忆是否存在，请缩小读取范围');
    if (!Array.isArray(data)) {
      // 语法错误时思源返回字符串而不是数组，必须当成失败而不是空结果。
      throw new MemoryError("invalid_response", "记忆体 SQL 返回了非数组 data");
    }
    pruneRing();
    // 必须比较原始 SQL 版本，不能把本地遮罩覆盖后的行当成索引已同步。
    confirmIndexed(data);
    return data.filter((row) => {
      if (absentIds.has(row?.id)) return false;
      const pending = pendingAttrs.get(row?.id);
      if (!pending) return true;
      const values = pending.values;
      // read() 的属性按行返回，在组装前更新对应字段。
      for (const [key, value] of Object.entries(values)) {
        if (row.name === MEMORY_ATTRS[key]) row.value = value;
      }
      if (row.name !== undefined) return true;
      if (Object.entries(values).every(([key, value]) => row[key] === value)) pendingAttrs.delete(row.id);
      else Object.assign(row, values);
      return true;
    });
  }

  /** 解析 `lsNotebooks` 的返回，按名字找笔记本。 */
  function findNotebook(notebooks) {
    for (const notebook of Array.isArray(notebooks) ? notebooks : []) {
      if (notebook?.name === notebookName && typeof notebook?.id === "string") return notebook.id;
    }
    return null;
  }

  /** 正在进行的「查找同名笔记本」任务，用于把并发调用收敛成一次。 */
  /** @type {Promise<string | null> | null} */
  const lookupTasks = new Map();
  /** 正在进行的「创建笔记本」任务，同上。 */
  /** @type {Promise<string | null> | null} */
  let createTask = null;

  /** 只查不建：在 `lsNotebooks` 里按名字找。 */
  async function lookupNotebook(requestOptions) {
    const listed = await call("/api/notebook/lsNotebooks", {}, requestOptions);
    if (listed.ok !== true) {
      throw new MemoryError(listed.error?.code ?? "kernel_error", listed.error?.message ?? "记忆笔记本不可达");
    }
    return findNotebook(listed.value?.data?.notebooks);
  }

  /** 建一次；成功后写进 `box`。 */
  async function createNotebookOnce() {
    const created = await call("/api/notebook/createNotebook", { name: notebookName });
    const id = created.ok === true ? created.value?.data?.notebook?.id : undefined;
    if (typeof id !== "string" || id === "") {
      warn(`记忆体建笔记本失败：${created.error?.message ?? JSON.stringify(created.value ?? {}).slice(0, 200)}`);
      return null;
    }
    box = id;
    return box;
  }

  /**
   * 解析记忆笔记本的 box id。
   *
   * **读路径绝不创建**（`create` 默认 false）：早期版本让预热注入文本也走「找不到就建」，
   * 结果每次 `apply()`（含 HMR 重载）都可能建一个空笔记本，实测一次留下三个。
   * 现在只有真正写入才允许创建，并且查找/创建各自收敛成单一 in-flight 任务，避免并发重复建。
   *
   * @param {{ create?: boolean }} [options]
   * @returns {Promise<string | null>}
   */
  async function resolveNotebook(options = {}) {
    if (box !== null) return box;
    const key = options.timeoutMs ?? 'default';
    if (!lookupTasks.has(key)) lookupTasks.set(key, lookupNotebook(options).finally(() => lookupTasks.delete(key)));
    const found = await lookupTasks.get(key);
    if (found !== null) {
      box = found;
      return box;
    }
    if (options.create !== true) return null;
    if (createTask === null) {
      createTask = createNotebookOnce().finally(() => {
        createTask = null;
      });
    }
    return createTask;
  }

  /**
   * 找到（必要时创建）某一类记忆的文档。
   * @param {string} type
   * @returns {Promise<string | null>}
   */
  /**
   * 找到（必要时创建）某一类记忆的文档。
   *
   * 同一类型只允许一个 in-flight 任务：并发写入时若各自查一遍、各自建一篇，就会在同一篇
   * 文档标题下建出多个文档（和笔记本那个 bug 同源）。
   *
   * @param {string} type
   * @returns {Promise<string | null>}
   */
  function resolveDoc(type) {
    const cached = docIds.get(type);
    if (cached !== undefined) return Promise.resolve(cached);
    const running = docTasks.get(type);
    if (running !== undefined) return running;
    const task = findOrCreateDoc(type).finally(() => {
      docTasks.delete(type);
    });
    docTasks.set(type, task);
    return task;
  }

  /**
   * @param {string} type
   * @returns {Promise<string | null>}
   */
  async function findOrCreateDoc(type) {
    const notebook = await resolveNotebook({ create: true });
    if (notebook === null) return null;
    const title = MEMORY_DOCS[type] ?? type;
    const rows = await query(buildDocLookupStatement({ box: notebook, title }));
    const found = rows?.[0]?.id;
    if (typeof found === "string" && found !== "") {
      docIds.set(type, found);
      return found;
    }
    const created = await call("/api/filetree/createDocWithMd", {
      notebook,
      path: `/${title}`,
      markdown: `# ${title}\n\n${MEMORY_NOTEBOOK_NAME} 的「${title}」分区。条目由插件按时间追加，也可以在思源里直接改。`,
    });
    const id = created.ok === true ? created.value?.data : undefined;
    if (typeof id !== "string" || id === "") {
      warn(`记忆体建文档失败（${title}）：${created.error?.message ?? "unknown"}`);
      return null;
    }
    docIds.set(type, id);
    return id;
  }

  /** 把一条记录推进写穿缓存（环形，最旧先出）。 */
  function remember(entry) {
    const existing = ring.findIndex(item => item.id === entry.id);
    if (existing !== -1) ring.splice(existing, 1);
    ring.push(entry);
    if (entry.type === 'state') { pendingStates.set(entry.id, { ...entry }); stateCheckedAt.set(entry.id, now()); }
    pendingAt.set(entry.id, now());
    while (ring.length > MEMORY_LIMITS.ringSize) pendingAt.delete(ring.shift().id);
  }

  function forgetPending(id) {
    const index = ring.findIndex((entry) => entry.id === id);
    if (index !== -1) ring.splice(index, 1);
    pendingAt.delete(id);
  }

  function pruneRing() {
    for (const entry of [...ring]) {
      if (now() - (pendingAt.get(entry.id) ?? 0) >= MEMORY_LIMITS.ringMaxAgeMs) forgetPending(entry.id);
    }
    for (const [id, pending] of pendingAttrs) if (now() - pending.at >= MEMORY_LIMITS.ringMaxAgeMs) pendingAttrs.delete(id);
  }

  function rememberAttrs(id, values) {
    pendingAttrs.set(id, { values: { ...pendingAttrs.get(id)?.values, ...values }, at: now() });
    if (pendingStates.has(id)) Object.assign(pendingStates.get(id), values);
  }

  /** 数据库已确认当前版本时退出缓存；外部修改最多只受十秒索引过渡窗口影响。 */
  function confirmIndexed(rows) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const cached = externalEntries.get(row?.id) ?? ring.find((entry) => entry.id === row?.id) ?? pendingStates.get(row?.id);
      if (!cached) continue;
      const fields = ['type', 'project', 'workspace', 'topic', 'topicId', 'status', 'confidence', 'fingerprint', 'supersedes', 'supersededBy', 'source', 'evidence', 'approvalHash', 'approvedAt', 'approvedBy', 'proposedSupersedes'];
      if (readableMemory(row.markdown || row.content) === readableMemory(cached.body) && fields.every(key =>
          Object.hasOwn(row, key) && String(row[key] ?? '') === String(cached[key] ?? ''))) {
        forgetPending(cached.id); pendingStates.delete(cached.id); stateCheckedAt.delete(cached.id); externalEntries.delete(cached.id);
      }
    }
  }

  /** 兼容旧调用方；会话快照不再因写入而失效。 */
  function invalidateSnapshot() {
    // 内容冻结由会话控制；写入只影响后续新快照，不修改已有快照。
  }

  /**
   * 写入一条记忆。
   *
   * 两步写（`appendBlock` → `setBlockAttrs`）是刻意的：E0 实验证明把自定义属性写进
   * 内联 IAL 会被解析器丢掉（`attributes` 表为空、`blocks.ial` 为 null），所以不走一次写。
   *
   * @param {{
   *   type: string, project: string, statement: string, reason?: string, rejected?: string,
   *   confidence?: string, source?: string, supersedes?: readonly string[]
   * }} spec
   * @returns {Promise<{ ok: true, value: { id: string, docId: string, superseded: string[] } } | { ok: false, error: { code: string, message: string } }>}
   */
  async function directEntry(id) {
    if (!/^[0-9]{14}-[a-z0-9]{7}$/u.test(id)) throw new MemoryError("invalid_id", "条目 id 形状不对");
    const notebook = await resolveNotebook();
    if (!notebook) throw new MemoryError("not_found", "记忆笔记本尚未初始化");
    const attrsResult = await call("/api/attr/getBlockAttrs", { id });
    if (!attrsResult.ok) throw new MemoryError(/not found|不存在/iu.test(attrsResult.error.message) ? 'not_found' : attrsResult.error.code, attrsResult.error.message);
    const attrs = attrsResult.value?.data;
    if (!attrs || !MEMORY_TYPES.includes(attrs[MEMORY_ATTRS.type])) throw new MemoryError("not_memory", "目标不是记忆条目");
    const info = await call("/api/block/getBlockInfo", { id });
    if (!info.ok) throw new MemoryError(info.error.code, info.error.message);
    if (info.value?.data?.box !== notebook) throw new MemoryError("wrong_notebook", "条目不属于当前记忆笔记本");
    const content = await call("/api/block/getBlockKramdown", { id });
    if (!content.ok) throw new MemoryError(content.error.code, content.error.message);
    const body = readableMemory(content.value?.data?.kramdown);
    const entry = { ...toMemoryEntry({ id, markdown: body }, attrs), body };
    return view(entry);
  }

  // 唯一性约束不能按时间丢弃；索引长期未确认时，用内核直读确定删除、迁移或修改。
  async function reconcilePending() {
    for (const [id, old] of pendingStates) {
      if (now() - (stateCheckedAt.get(id) ?? 0) < MEMORY_LIMITS.ringMaxAgeMs) continue;
      try {
        const current = await directEntry(id);
        pendingStates.set(id, current); stateCheckedAt.set(id, now());
        const cached = ring.find(entry => entry.id === id); if (cached) Object.assign(cached, current);
        pendingAttrs.delete(id); absentIds.delete(id);
        if (memoryRevision(old) !== current.revision) changed(current);
      } catch (error) {
        if (!['not_found', 'not_memory', 'wrong_notebook'].includes(error.code)) throw error;
        pendingStates.delete(id); stateCheckedAt.delete(id); pendingAttrs.delete(id); forgetPending(id); absentIds.add(id);
        changed({ ...old, status: 'revoked', reason: '内核确认条目已删除或已离开记忆库' });
      }
    }
  }
  const reconcileBeforeRead = serialize(reconcilePending);

  /** 核对会话实际引用的少量条目；外部变化通过同一个变更流通知冻结快照。 */
  async function reconcile(ids = []) {
    const results = [];
    for (const id of [...new Set(ids)].slice(0, MEMORY_LIMITS.maxReadIds)) {
      const old = observedEntries.get(id);
      try {
        const current = await directEntry(id);
        absentIds.delete(id); externalEntries.set(id, current); observedEntries.set(id, current);
        if (!old || memoryRevision(old) !== current.revision) {
          changed(current);
          if (old && (old.workspace !== current.workspace || old.project !== current.project)) changed({ ...old, status: 'revoked' });
        }
        results.push(current);
      } catch (error) {
        if (!['not_found', 'not_memory', 'wrong_notebook'].includes(error.code)) {
          throw error;
        }
        absentIds.add(id); externalEntries.delete(id); pendingStates.delete(id); stateCheckedAt.delete(id); pendingAttrs.delete(id); forgetPending(id);
        if (old) changed({ ...old, status: 'revoked' });
      }
    }
    return { ok: true, value: { entries: results } };
  }

  async function patchEntry(id, values) {
    // undefined 一律落成空串：早期版本曾把 undefined 写成字面量 "undefined"，让财产属性变成
    // truthy 的脏值，revision 与缓存随之不一致（写后任何 expectedRevision 都判冲突）。
    const attrs = Object.fromEntries(Object.entries(values).map(([key, value]) => [MEMORY_ATTRS[key], value == null ? "" : String(value)]));
    const result = await call("/api/attr/setBlockAttrs", { id, attrs });
    if (!result.ok) throw new MemoryError(result.error.code, result.error.message);
    const confirmed = await call("/api/attr/getBlockAttrs", { id });
    if (!confirmed.ok || Object.entries(attrs).some(([key, value]) => String(confirmed.value?.data?.[key] ?? "") !== value)) {
      throw new MemoryError("verification_failed", `条目 ${id} 的属性尚未确认写入，请重试相同操作`);
    }
    rememberAttrs(id, values);
    const cached = ring.find(entry => entry.id === id);
    if (cached) { Object.assign(cached, values); pendingAt.set(id, now()); }
    else {
      // 新状态可能尚未进入 SQL 的 WHERE 条件；仅改属性遮罩无法补回被索引排除的行。
      const entry = await directEntry(id);
      remember({ ...entry, ...values, fresh: true });
    }
  }

  // 每次属性修改之前持久化旧值，确认读取失败也属于可能已提交的修改。
  function mutation(action, input, persistWrite) {
    const key = createHash('sha256').update(JSON.stringify(['mutation', action, input.id, input.expectedRevision, input.supersedes ?? [], input.status ?? ''])).digest('hex');
    const records = [];
    const save = async phase => {
      if (persistWrite) return persistWrite({ phase, mutations: records });
      const receipt = { kind: 'mutation', action, id: input.id, phase, records, updatedAt: now(), complete: phase === 'complete' };
      mutationReceipts.set(key, receipt);
      await options.receipts?.set?.(key, receipt);
    };
    return {
      key, records,
      async patch(id, values) {
        input.signal?.throwIfAborted();
        if (input.canWrite && !input.canWrite()) throw new MemoryError('cancelled', '当前写入已被取消');
        let record = records.find(item => item.id === id);
        const current = await call('/api/attr/getBlockAttrs', { id });
        if (!current.ok) throw new MemoryError(current.error.code, current.error.message);
        if (!record) { record = { id, before: {}, after: {} }; records.push(record); }
        for (const [field, value] of Object.entries(values)) {
          if (!Object.hasOwn(record.before, field)) record.before[field] = String(current.value?.data?.[MEMORY_ATTRS[field]] ?? '');
          record.after[field] = String(value);
        }
        await save('applying');
        input.signal?.throwIfAborted();
        if (input.canWrite && !input.canWrite()) throw new MemoryError('cancelled', '当前写入已被取消');
        await patchEntry(id, values);
      },
      async rollback() {
        const failed = [];
        for (const record of [...records].reverse()) {
          try {
            const current = await call('/api/attr/getBlockAttrs', { id: record.id });
            if (!current.ok) throw new Error('无法核对当前属性');
            if (Object.entries(record.before).every(([field, value]) => String(current.value?.data?.[MEMORY_ATTRS[field]] ?? '') === value)) continue;
            if (Object.entries(record.before).some(([field, value]) => {
              const actual = String(current.value?.data?.[MEMORY_ATTRS[field]] ?? '');
              return actual !== value && actual !== record.after[field];
            })) throw new Error('属性已被外部修改，不能覆盖');
            await patchEntry(record.id, record.before);
            try { changed(await directEntry(record.id)); } catch {}
          } catch {
            failed.push(record.id); forgetPending(record.id); pendingAttrs.delete(record.id);
            changed({ id: record.id, project: '*', workspace: '*', status: 'uncertain' });
          }
        }
        try { await save(failed.length ? 'rollback_needed' : 'rolled_back'); } catch { /* 原先已落盘的旧值仍可核对 */ }
        if (!failed.length && !persistWrite) { mutationReceipts.delete(key); try { await options.receipts?.delete?.(key); } catch {} }
        return failed;
      },
      async commit() {
        await save('complete');
        if (!persistWrite) { mutationReceipts.delete(key); try { await options.receipts?.delete?.(key); } catch {} }
      },
    };
  }

  const sameSubject = (a, b) => a.workspace === b.workspace && a.project === b.project && a.type === b.type && (a.type !== "state" || memoryTopicId(a) === memoryTopicId(b));
  const idsOf = value => String(value ?? "").split(",").filter(Boolean);

  async function validateTargets(entry, targets, expected, retryId, confirmedCandidates = []) {
    if (targets.length && entry.status !== "active") throw new MemoryError("candidate_cannot_supersede", "候选记忆不能取代有效记忆");
    const oldEntries = [];
    for (const id of targets) {
      const old = await directEntry(id);
      if (!sameSubject(entry, old)) throw new MemoryError("scope_mismatch", "只能取代同工作区、同项目、同类型和同任务主题的记忆");
      if (retryId && old.status === "superseded" && old.supersededBy === retryId) { oldEntries.push(old); continue; }
      if (old.status !== "active" && !(old.status === 'candidate' && confirmedCandidates.includes(id))) throw new MemoryError("state_conflict", `旧条目 ${id} 已不是有效状态，请重新读取`);
      // revision 可选：传了就校验（防止覆盖外部刚改过的版本），不传以当前版本为准。
      if (expected?.[id] && expected[id] !== old.revision) throw new MemoryError("revision_conflict", `旧条目 ${id} 已变化，请 memory_read 后携带最新 revision 重试`);
      oldEntries.push(old);
    }
    return oldEntries;
  }

  /** 同一任务主题当前有效的状态条目 id（含尚未进索引的）。 */
  async function activeStates(entry) {
    const local = pendingEntries().filter(old => old.type === 'state' && sameSubject(entry, old));
    const notebook = await resolveNotebook();
    const rows = notebook ? await query(buildListStatement({ box: notebook, type: 'state', project: entry.project,
      workspace: entry.workspace, topic: entry.topic, topicId: memoryTopicId(entry), status: 'active', limit: MEMORY_LIMITS.maxSupersedes + 1 })) : [];
    const inactive = new Set(local.filter(old => old.status !== 'active').map(old => old.id));
    return [...new Set([...local.filter(old => old.status === 'active').map(old => old.id),
      ...rows.filter(row => row.status === 'active' && sameSubject(entry, row)).map(row => row.id)])].filter(id => !inactive.has(id));
  }

  async function checkStateConflict(entry, excluded = []) {
    if (entry.type !== "state" || entry.status !== "active") return;
    const local = pendingEntries().filter(old => sameSubject(entry, old));
    const skip = [...new Set([...excluded, ...local.filter(old => old.status !== 'active').map(old => old.id)])];
    const notebook = await resolveNotebook();
    const rows = notebook ? await query(buildListStatement({ box: notebook, type: 'state', project: entry.project,
      workspace: entry.workspace, topic: entry.topic, topicId: memoryTopicId(entry), status: 'active', excludeIds: skip, limit: 1 })) : [];
    if ([...local, ...rows].some(old => old.status === 'active' && sameSubject(entry, old) && !excluded.includes(old.id))) {
      throw new MemoryError("state_conflict", "同一任务主题已有有效状态，请先读全文，合并未完成待办后明确指定 supersedes 和 expectedRevisions");
    }
  }

  async function write(spec, authority = {}) {
    const checkAllowed = () => {
      if (spec?.signal?.aborted || (typeof spec?.canWrite === 'function' && !spec.canWrite())) throw new MemoryError('cancelled', '会话已取消、释放或停止记录，尚未开始的记忆写入已终止');
    };
    checkAllowed();
    let selectedTopic;
    if (spec?.type === 'state' && spec.topicId && authority.recovered !== true) {
      const directory = await topics({ scope: spec.scope, project: spec.project, workspace: spec.workspace });
      const known = directory.value.topics.find(topic => topic.id === spec.topicId && topic.project === (spec.project ?? spec.scope?.project));
      if (!known) throw new MemoryError('invalid_topic', 'topicId 不属于当前范围，请先查询 memory_topics 并复用已有主题');
      selectedTopic = known;
      spec = { ...spec, topic: known.topic };
    }
    const body = typeof spec?.body === "string" ? spec.body : entryMarkdown(spec);
    // 2026-11-11：写入即生效。只有显式 inferred（模型自己的推断）落候选，其余直接有效，
    // 不再要求第二次 memory_confirm 调用，也不再绑定确认哈希。
    const entry = validateMemory({ ...spec, body });
    if (selectedTopic && (selectedTopic.workspace !== entry.workspace || selectedTopic.project !== entry.project)) throw new MemoryError('invalid_topic', '主题的项目或工作区与写入范围不同，请重新选择');
    const requestedTargets = [...new Set(Array.isArray(spec?.supersedes) ? spec.supersedes : [])];
    if (requestedTargets.length > MEMORY_LIMITS.maxSupersedes || requestedTargets.some(id => !/^[0-9]{14}-[a-z0-9]{7}$/u.test(id))) throw new MemoryError("invalid_targets", "supersedes 最多包含 5 个合法条目 ID");
    let targets = entry.status === 'candidate' ? [] : requestedTargets;
    let expectedRevisions = spec?.expectedRevisions;
    let autoTargets = false;
    if (requestedTargets.length && !targets.length) {
      await validateTargets({ ...entry, status: 'active' }, requestedTargets, spec.expectedRevisions);
      entry.proposedSupersedes = requestedTargets.join(',');
    }
    const fingerprint = memoryFingerprint(entry);
    let receipt = receipts.get(fingerprint) ?? await options.receipts?.get?.(fingerprint);
    if (entry.status === 'active' && receipt?.spec?.approvalHash === memoryApprovalHash(entry)) {
      for (const key of ['approvalHash', 'approvedAt', 'approvedBy']) entry[key] = receipt.spec[key];
    }
    if (receipt && !receipt.id) throw new MemoryError('append_uncertain', '上次追加是否落盘尚未确认，已停止自动重试；请在记忆笔记本核对后处理该写入凭据');
    // 同文判断：正文指纹一致；或属性里的写入指纹一致，且正文自写入后没被人改过（读回指纹仍相符）。
    const sameText = current => memoryFingerprint(current) === fingerprint ||
      (current.fingerprint === fingerprint && !!current.echo && memoryFingerprint(current) === current.echo);
    // 宿主对工具结果做无损 JSON 校验，任何 undefined 属性都会让整个结果被拒，所以没有值就不放键。
    const withDoc = value => (receipt?.docId ? { ...value, docId: receipt.docId } : value);
    // 候选里记着的取代意图（写 inferred 时带了 supersedes）在升级这一步兑现。
    // 2026-11-11 v6：面板 approve() 一直会应用 proposedSupersedes，而工具路径只清属性不应用，
    // 于是「推断 + 取代 → 再写一次 stated」会让旧结论永久留在 active（write-ux 实测 R5–R7）。
    // 这里把两条路对齐，同时不让升级被历史残留卡死：
    // 目标已经不在有效状态（被别人取代、被撤销、块没了）就跳过；目标换了范围才报错。
    const promotePlan = async current => {
      const stored = idsOf(current.proposedSupersedes);
      const targetsToApply = [];
      for (const oldId of [...new Set(stored)].filter(id => /^[0-9]{14}-[a-z0-9]{7}$/u.test(id) && id !== current.id)) {
        let old;
        try { old = await directEntry(oldId); }
        catch (error) { if (['not_found', 'not_memory', 'wrong_notebook'].includes(error.code)) continue; throw error; }
        if (!sameSubject(entry, old)) throw new MemoryError('scope_mismatch', '候选记录的取代目标与当前条目不是同一个工作区、项目、类型和任务主题，请读取后重新确认');
        if (old.status !== 'active') continue;
        targetsToApply.push(oldId);
      }
      return { stored, targets: targetsToApply };
    };
    const duplicateResult = async current => {
      // 2026-11-11：同文再写一次、并且这次明确 stated / verified，就把候选升级为有效——
      // 否则「先存成推断、后来确认」这条路会撞上查重，永远停在候选。
      if (current.status === 'candidate' && entry.status === 'active' && targets.length === 0) {
        const plan = await promotePlan(current);
        const olds = await validateTargets({ ...entry, status: 'active' }, plan.targets, spec?.expectedRevisions, current.id);
        await checkStateConflict({ ...entry, status: 'active' }, [current.id, ...plan.targets]);
        const transaction = mutation('promote', { id: current.id, expectedRevision: current.revision, supersedes: plan.targets, signal: spec?.signal, canWrite: spec?.canWrite });
        try {
          await transaction.patch(current.id, { status: 'active', confidence: entry.confidence, source: entry.source || current.source || '', evidence: entry.evidence || current.evidence || '', fingerprint,
            // proposedSupersedes 一律清空：已经兑现，或者已经不再适用；留着下次还会重算一遍。
            ...(plan.stored.length ? { proposedSupersedes: '', ...(plan.targets.length ? { supersedes: [...new Set([...idsOf(current.supersedes), ...plan.targets])].join(',') } : {}) } : {}) });
          for (const oldId of plan.targets) await transaction.patch(oldId, { status: 'superseded', supersededBy: current.id });
          await transaction.commit();
        } catch (error) {
          const failed = await transaction.rollback();
          return { ok: false, error: { code: failed.length ? 'chain_incomplete' : error.code ?? 'promote_failed', message: `候选升级未完成：${error.message}${failed.length ? '；需核对：' + failed.join('、') : '；已恢复原状态，可重试'}` }, ...(failed.length ? { recovery: { key: transaction.key, ids: failed } } : {}) };
        }
        // 提醒里要引用「被取代的那一条」自己的结论，不能用升级后条目的正文冒充。
        for (const old of olds) changed({ ...old, status: 'superseded', supersededBy: current.id });
        changed({ ...current, status: 'active', confidence: entry.confidence });
        return { ok: true, value: withDoc({ id: current.id, status: 'active', promoted: true, superseded: plan.targets, duplicate: false }) };
      }
      if (targets.some(id => !idsOf(current.supersedes).includes(id))) throw new MemoryError('duplicate_requires_review', `同文条目 ${current.id} 已存在，但未完成所请求的取代；请读取后确认`);
      return { ok: true, value: withDoc({ id: current.id, status: current.status,
        superseded: idsOf(current.supersedes), duplicate: true,
        disposition: current.status === 'candidate' ? 'candidate_exists' : 'active_exists' }) };
    };
    if (receipt?.complete) {
      let current;
      try { current = await directEntry(receipt.id); }
      catch (error) { if (!['not_found', 'not_memory'].includes(error.code)) throw error; }
      if (current && sameText(current) && ['active', 'candidate'].includes(current.status)) return await duplicateResult(current);
      await clearReceipt(fingerprint); receipt = null;
    }
    // 未完成的重试沿用首次自动选定的取代目标，否则会被判成「重试目标不一致」。
    if (receipt?.autoTargets && !requestedTargets.length) { targets = receipt.targets ?? []; expectedRevisions = receipt.expectedRevisions; autoTargets = true; }
    if (receipt && JSON.stringify(receipt.targets ?? []) !== JSON.stringify(targets)) throw new MemoryError('retry_mismatch', '重试必须保留原来的取代目标；请先处理未完成写入');
    // 用全文指纹查重，核实阶段不因模型换了措辞之外的元数据而重复追加。
    if (!receipt) {
      const notebook = await resolveNotebook();
      const cached = pendingEntries().find(item => item.fingerprint === fingerprint && ['active', 'candidate'].includes(item.status));
      let duplicate = cached;
      if (!duplicate && notebook) {
        const rows = await query(buildListStatement({ box: notebook, fingerprint, limit: 25 }));
        for (const row of rows.filter(row => row.fingerprint === fingerprint && ['active', 'candidate'].includes(row.status))) {
          try { const current = await directEntry(row.id); if (sameText(current) && ['active', 'candidate'].includes(current.status)) { duplicate = current; break; } }
          catch (error) { if (!['not_found', 'not_memory'].includes(error.code)) throw error; }
        }
      }
      if (duplicate) return await duplicateResult(duplicate);
    }
    if (receipt?.id) {
      let committed;
      try {
        const current = await directEntry(receipt.id);
        if (sameText(current) && current.status === entry.status && current.confidence === entry.confidence &&
            current.fingerprint === fingerprint && current.supersedes === targets.join(',')) {
          const previous = await Promise.all(targets.map(directEntry));
          if (previous.every(old => old.status === 'superseded' && old.supersededBy === current.id)) committed = current;
        }
      } catch { /* 尚未标记的新块继续补齐，不把读取失败当作完成 */ }
      if (committed) {
        const completed = { ...receipt, complete: true, phase: 'complete', completedAt: now() };
        try { await options.receipts?.set?.(fingerprint, completed); receipts.set(fingerprint, completed); }
        catch (error) { return { ok: false, error: { code: 'receipt_pending', message: '记忆已生效，但完成凭据尚未保存：' + error.message }, partial: { id: receipt.id, committed: true } }; }
        return { ok: true, value: withDoc({ id: receipt.id, status: committed.status, superseded: targets, duplicate: true }) };
      }
    }
    // 同一任务主题只留一条有效状态：没指定 supersedes 时自动取代旧状态，
    // 不再要求模型先 memory_topics / memory_read 拿 revision 才能更新进度。
    if (!receipt && entry.type === 'state' && entry.status === 'active' && !targets.length) {
      const previous = await activeStates(entry);
      if (previous.length) { targets = previous.slice(0, MEMORY_LIMITS.maxSupersedes); expectedRevisions = undefined; autoTargets = true; }
    }
    await validateTargets(entry, targets, expectedRevisions, receipt?.id, spec?.confirmedCandidates);
    await checkStateConflict(entry, [...targets, ...(receipt ? [receipt.id] : [])]);
    const docId = receipt?.docId ?? await resolveDoc(entry.type);
    if (!docId) throw new MemoryError("memory_unavailable", "记忆笔记本不可用");
    checkAllowed();
    if (!receipt) {
      const { body: _body, statement: _statement, ...metadata } = entry;
      const intent = { kind: 'write', phase: 'intent', id: null, docId, created: siyuanStamp(new Date(now())), createdAt: now(), spec: metadata,
        ...(expectedRevisions ? { expectedRevisions } : {}), confirmedCandidates: spec?.confirmedCandidates, targets, ...(autoTargets ? { autoTargets: true } : {}), complete: false };
      await options.receipts?.set?.(fingerprint, intent);
      receipts.set(fingerprint, intent);
      try { checkAllowed(); } catch (error) { await clearReceipt(fingerprint); throw error; }
      const appended = await call("/api/block/appendBlock", { parentID: docId, dataType: "markdown", data: singleBlockMarkdown(entry.body) });
      const id = appended.ok ? appended.value?.data?.[0]?.doOperations?.[0]?.id : undefined;
      if (typeof id !== "string" || !id) {
        docIds.delete(entry.type);
        if (appended.outcome === 'rejected') await clearReceipt(fingerprint);
        return { ok: false, error: { code: "append_failed", message: `${appended.error?.message ?? "appendBlock 没返回新块 id"}；${appended.outcome === 'rejected' ? '内核明确拒绝，可重试。' : '落盘状态不确定，请在记忆面板的写入恢复中核对。'}` }, ...(appended.outcome !== 'rejected' ? { recovery: { key: fingerprint } } : {}) };
      }
      receipt = { ...intent, id };
      receipts.set(fingerprint, receipt);
    }
    const { id, created } = receipt;
    const superseded = [];
    const transaction = mutation('write', { ...spec, id }, async progress => {
      receipt = { ...receipt, ...progress, complete: false };
      receipts.set(fingerprint, receipt);
      await options.receipts?.set?.(fingerprint, receipt);
    });
    try {
      checkAllowed();
      await options.receipts?.set?.(fingerprint, receipt);
      checkAllowed();
      const attrs = entryAttributes({ ...entry, status: targets.length ? 'candidate' : entry.status, created, fingerprint, supersedes: targets.join(",") });
      const tagged = await call("/api/attr/setBlockAttrs", { id, attrs });
      if (!tagged.ok) throw new MemoryError("tag_failed", tagged.error.message);
      const checked = await call("/api/attr/getBlockAttrs", { id });
      if (!checked.ok || Object.entries(attrs).some(([key, value]) => String(checked.value?.data?.[key] ?? "") !== value)) throw new MemoryError("verification_failed", "新条目属性未确认");
      checkAllowed();
      // 再读一遍旧版本，降低外部编辑与本次写入交错造成误作废的风险。
      const olds = await validateTargets(entry, targets, expectedRevisions, id, spec?.confirmedCandidates);
      for (const oldId of targets) {
        await transaction.patch(oldId, { status: "superseded", supersededBy: id });
        superseded.push(oldId);
        // 提醒里要显示「被取代的那一条」的结论，不能用新条目的正文冒充。
        const old = olds.find(item => item.id === oldId);
        changed({ ...entry, ...(old ? { body: old.body, statement: old.statement } : {}), id: oldId, status: "superseded", supersededBy: id });
      }
      if (targets.length) await transaction.patch(id, { status: entry.status });
      // 思源可能改写了正文：读回后另存一份指纹，下次同文写入才能判重（只在确实被改写时多一次属性请求）。
      let echo = '';
      try {
        const stored = await call("/api/block/getBlockKramdown", { id });
        const storedPrint = stored.ok ? memoryFingerprint({ ...entry, body: readableMemory(stored.value?.data?.kramdown) }) : fingerprint;
        if (storedPrint !== fingerprint) { await patchEntry(id, { echo: storedPrint }); echo = storedPrint; }
      } catch { /* 读回失败只影响以后判重，不影响这次写入 */ }
      remember({ ...entry, id, created, fingerprint, echo, supersedes: targets.join(","), supersededBy: "", fresh: true });
      changed({ ...entry, id, originSessionId: spec.originSessionId });
    } catch (error) {
      // 无事务内核下尽力回滚已改旧条目；失败明示，凭据保留供同内容重试。
      const rollbackFailed = await transaction.rollback();
      if (targets.length) { try { await patchEntry(id, { status: 'candidate' }); } catch {} }
      return { ok: false, error: { code: error.code ?? "write_incomplete", message: `正文已写入块 ${id}，后续步骤未完成：${error.message}。重试相同内容将续写此块，不会重新追加。${rollbackFailed.length ? '未能恢复的旧条目：'+rollbackFailed.join('、') : ''}` }, partial: { id, docId, superseded: rollbackFailed, rollbackFailed } };
    }
    // 属性已完成后，凭据归档失败不能再撤销已经生效的业务状态。
    const completed = { ...receipt, complete: true, phase: 'complete', completedAt: now() };
    try { await options.receipts?.set?.(fingerprint, completed); receipts.set(fingerprint, completed); }
    catch (error) {
      receipts.set(fingerprint, { ...receipt, complete: false, phase: 'committed' });
      return { ok: false, error: { code: 'receipt_pending', message: '记忆和取代关系已生效，完成凭据保存失败；重试将核对现有条目：' + error.message }, partial: { id, docId, committed: true } };
    }
    return { ok: true, value: { id, docId, status: entry.status, superseded, statement: entry.statement, duplicate: false, ...(autoTargets && superseded.length ? { autoSuperseded: true } : {}) } };
  }


  /**
   * 检索记忆。
   *
   * 先查写穿缓存（保证「刚写完就搜」立刻可见），再查 SQL。缓存命中标 `fresh: true`。
   *
   * @param {{ query?: string, type?: string, project?: string, limit?: number }} input
   * @returns {Promise<{ ok: true, value: { results: Array<Record<string, any>>, source: string } } | { ok: false, error: { code: string, message: string } }>}
   */
  const receiptVersion = receipt => createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  async function receiptList() {
    const all = new Map((await options.receipts?.list?.() ?? []).filter(Boolean).map(({ key, ...receipt }) => [key, receipt]));
    for (const [key, receipt] of [...receipts, ...mutationReceipts]) if (receipt) all.set(key, receipt);
    return { ok: true, value: { entries: [...all].filter(([, receipt]) => !receipt.complete).map(([key, receipt]) => ({ key, version: receiptVersion(receipt),
      kind: receipt.kind ?? 'write', phase: receipt.phase ?? (receipt.id ? 'incomplete' : 'uncertain'), id: receipt.id ?? null,
      project: receipt.spec?.project ?? '', type: receipt.spec?.type ?? '', created: receipt.created ?? '', legacy: !receipt.spec && receipt.kind !== 'mutation' })) } };
  }

  async function recoverReceipt(input) {
    if (!/^[a-f0-9]{64}$/u.test(input?.key ?? '')) throw new MemoryError('invalid_receipt', '写入凭据标识不合法');
    const key = input.key;
    let receipt = mutationReceipts.get(key) ?? receipts.get(key) ?? await options.receipts?.get?.(key);
    if (!receipt) return { ok: true, value: { cleared: true, matches: [] } };
    const version = receiptVersion(receipt);
    if (input.action !== 'inspect' && input.expectedVersion !== version) throw new MemoryError('revision_conflict', '凭据已变化，请重新检查后操作');
    if (input.action === 'forget') {
      if (input.confirmedMissing !== true || receipt.id || receipt.kind === 'mutation') throw new MemoryError('confirmation_required', '仅在人工核对没有落盘后，才能清除没有块 ID 的意图凭据');
      if (receipt.spec) {
        const inspected = await recoverReceipt({ key, action: 'inspect' });
        if (inspected.value.matches.length) throw new MemoryError('existing_append', '已找到落盘块，请继续恢复，不应解除限制后重复追加');
      }
      await clearReceipt(key); return { ok: true, value: { cleared: true } };
    }
    if (receipt.kind === 'mutation') {
      const states = [];
      for (const record of receipt.records ?? []) {
        const actual = await call('/api/attr/getBlockAttrs', { id: record.id });
        if (!actual.ok) throw new MemoryError(actual.error.code, actual.error.message);
        const matches = values => Object.entries(values).every(([field, value]) => String(actual.value?.data?.[MEMORY_ATTRS[field]] ?? '') === value);
        states.push({ id: record.id, before: matches(record.before), after: matches(record.after) });
      }
      if (input.action === 'inspect') return { ok: true, value: { key, version, kind: 'mutation', states, matches: states.map(item => item.id) } };
      if (input.action !== 'resume' && input.action !== 'rollback') throw new MemoryError('invalid_action', '请选择检查、核对完成或恢复旧属性');
      if (input.action === 'resume' && !states.every(item => item.after)) throw new MemoryError('recovery_needed', '修改尚未全部完成，请恢复旧属性后重试原操作');
      if (input.action === 'rollback') {
        const transaction = mutation('recover', { id: receipt.id }, async progress => {
          receipt = { ...receipt, phase: progress.phase, records: progress.mutations };
          mutationReceipts.set(key, receipt); await options.receipts?.set?.(key, receipt);
        });
        transaction.records.push(...receipt.records);
        const failed = await transaction.rollback();
        if (failed.length) throw new MemoryError('chain_incomplete', '仍需核对：' + failed.join('、'));
      }
      await clearReceipt(key); mutationReceipts.delete(key);
      return { ok: true, value: { cleared: true, restored: input.action === 'rollback' } };
    }
    const candidates = receipt.id ? [receipt.id] : [];
    if (!receipt.id && receipt.spec) {
      const children = await call('/api/block/getChildBlocks', { id: receipt.docId });
      if (!children.ok || !Array.isArray(children.value?.data)) throw new MemoryError('recovery_unavailable', '无法读取目标文档，不能判定是否落盘');
      for (const child of children.value.data) {
        const content = await call('/api/block/getBlockKramdown', { id: child.id });
        if (!content.ok) throw new MemoryError(content.error.code, content.error.message);
        if (memoryFingerprint({ ...receipt.spec, body: readableMemory(content.value?.data?.kramdown) }) !== key) continue;
        const attrs = await call('/api/attr/getBlockAttrs', { id: child.id });
        if (!attrs.ok) throw new MemoryError(attrs.error.code, attrs.error.message);
        if (!['revoked', 'superseded'].includes(attrs.value?.data?.[MEMORY_ATTRS.status])) candidates.push(child.id);
      }
    }
    if (input.action === 'inspect') return { ok: true, value: { key, version, kind: 'write', matches: candidates, legacy: !receipt.spec,
      message: !receipt.spec ? '旧凭据缺少恢复元数据，请用原内容重试，或到思源核对该块' : candidates.length === 1 ? '找到可核对的块，可继续完成原写入' : '尚不能确定唯一落盘结果，请到思源核对后再操作' } };
    if (input.action !== 'resume' || !receipt.spec || candidates.length !== 1) throw new MemoryError('append_uncertain', '没有找到唯一可恢复的块，停止自动追加');
    const content = await call('/api/block/getBlockKramdown', { id: candidates[0] });
    if (!content.ok) throw new MemoryError(content.error.code, content.error.message);
    receipt = { ...receipt, id: candidates[0] }; await options.receipts?.set?.(key, receipt); receipts.set(key, receipt);
    const recovered = { ...receipt.spec, body: readableMemory(content.value?.data?.kramdown), supersedes: receipt.targets, expectedRevisions: receipt.expectedRevisions, confirmedCandidates: receipt.confirmedCandidates };
    return write(recovered, { recovered: true, approvedBy: receipt.spec?.approvedBy, confirmed: receipt.spec?.status === 'active' && receipt.spec?.approvalHash === memoryApprovalHash(recovered) });
  }

  async function cleanupReceipts() {
    const stored = await options.receipts?.list?.() ?? [];
    let removed = 0, retained = 0;
    for (const receipt of stored) {
      if (!receipt?.complete || !receipt.id || now() - (receipt.completedAt ?? parseStamp(receipt.created) ?? now()) < 86_400_000) { retained++; continue; }
      if (removed >= 100) { retained++; continue; }
      const notebook = await resolveNotebook();
      const rows = notebook ? await query(buildListStatement({ box: notebook, fingerprint: receipt.key, limit: 25 })) : [];
      if (!rows.some(row => row.id === receipt.id && row.fingerprint === receipt.key)) { retained++; continue; }
      const current = await directEntry(receipt.id);
      if (memoryFingerprint(current) !== receipt.key) { retained++; continue; }
      await clearReceipt(receipt.key); removed++;
    }
    return { ok: true, value: { removed, retained } };
  }

  async function search(input = {}) {
    const requestOptions = input.timeoutMs ? { timeoutMs: input.timeoutMs } : undefined;
    const limit = Math.max(1, Math.min(MEMORY_LIMITS.maxSearchLimit, Math.trunc(Number(input.limit) || MEMORY_LIMITS.defaultSearchLimit)));
    const needle = typeof input.query === 'string' ? input.query.trim().slice(0, MEMORY_LIMITS.maxQueryChars) : '';
    const type = MEMORY_TYPES.includes(input.type) ? input.type : undefined;
    const project = typeof input.project === 'string' && input.project.trim() ? input.project.trim() : undefined;
    const status = MEMORY_STATUSES.includes(input.status) ? input.status : undefined;
    const accepts = entry => (!status ? ['active', 'candidate'].includes(entry.status) : entry.status === status) &&
      (!type || entry.type === type) && (!project || entry.project === project) &&
      (!input.scope || applicableMemory(entry, input.scope)) && (!input.trusted || trusted(entry)) && (!input.currentOnly || !assessMemory(entry, now()).reviewRequired);
    let tokens = needle.toLowerCase().split(/\s+/u).filter(token => [...token].length >= MEMORY_LIMITS.minTokenChars);
    if (!tokens.length && needle) tokens = [needle.toLowerCase()];
    const candidates = pendingEntries().filter(accepts);
    const matches = (entry, relaxed = false) => {
      const text = readableMemory(entry.body || entry.markdown || entry.content || entry.statement).toLowerCase();
      return !tokens.length || (relaxed ? tokens.some(token => text.includes(token)) : tokens.every(token => text.includes(token)));
    };
    let fresh = candidates.filter(entry => matches(entry));
    let rows, source = 'filter', availability = 'available';
    try {
      const notebook = await resolveNotebook(requestOptions);
      if (!notebook) { rows = []; availability = 'uninitialized'; }
      else {
        const base = { box: notebook, type, project, status, limit, scope: input.scope, trusted: input.trusted };
        const expression = ftsExpression(needle);
        if (!needle) rows = await query(buildFilterStatement(base), requestOptions);
        else if (expression) {
          try {
            source = 'fts'; rows = await query(buildFtsSearchStatement({ ...base, expression }), requestOptions);
            const relaxed = ftsExpression(needle, 'or');
            if (!rows.length && !fresh.length && relaxed !== expression) {
              source = 'fts-or'; rows = await query(buildFtsSearchStatement({ ...base, expression: relaxed }), requestOptions);
              fresh = candidates.filter(entry => matches(entry, true));
            }
          } catch { source = 'like'; rows = await query(buildLikeSearchStatement({ ...base, needle }), requestOptions); }
        } else { source = 'like'; rows = await query(buildLikeSearchStatement({ ...base, needle }), requestOptions); }
      }
    } catch (error) {
      if (!fresh.length) fresh = candidates.filter(entry => matches(entry, true));
      if (!fresh.length) throw error;
      return { ok: true, value: { results: fresh.slice(0, limit).map(entry => searchView({ ...entry, fresh: true })), source: 'cache', complete: false, availability: 'partial', warning: error.message } };
    }
    const merged = new Map(fresh.map(entry => [entry.id, searchView({ ...entry, fresh: true })]));
    for (const row of rows) {
      const cached = externalEntries.get(row.id) ?? ring.find(entry => entry.id === row.id) ?? pendingStates.get(row.id);
      const entry = cached ?? { ...row, body: readableMemory(row.markdown || row.content), status: row.status ?? 'active', fresh: false };
      if (!merged.has(row.id) && accepts(entry)) merged.set(row.id, searchView(entry));
    }
    const ordered = [...merged.values()].sort(compareEntries(input.scope));
    return { ok: true, value: { results: ordered.slice(0, limit), source, availability, complete: true } };
  }

  /**
   * 被动召回：从一段自然语言里抽关键词，找出最相关的几条有效记忆。
   *
   * 和 search 的区别：输入是用户的整句话而不是检索词；宁缺毋滥——**至少命中一个标识符**
   * （weight 3），或中文词元总分 ≥3，才算相关。任何失败都返回空结果，绝不影响对话。
   *
   * limit 默认放到 12：调用方（每步提示）要先按常驻索引去重、再取前 3，
   * 只取 6 条会把最相关的那几条筛掉、只剩第二梯队。
   */
  async function recall(input = {}) {
    const terms = recallTerms(input.text);
    if (!terms.length) return { ok: true, value: { entries: [], terms } };
    const requestOptions = input.timeoutMs ? { timeoutMs: input.timeoutMs } : undefined;
    const limit = Math.max(1, Math.min(RECALL_POOL_LIMIT, Math.trunc(Number(input.limit) || 3)));
    const source = String(input.text ?? '').toLowerCase();
    const pool = new Map(pendingEntries().filter(entry => entry.status === 'active' && (!input.scope || applicableMemory(entry, input.scope))).map(entry => [entry.id, entry]));
    const notebook = await resolveNotebook(requestOptions);
    if (notebook) {
      const expression = terms.map(term => `"${term.text.replaceAll('"', '""')}"`).join(' OR ');
      const rows = await query(buildFtsSearchStatement({ box: notebook, expression, status: 'active', scope: input.scope, limit: MEMORY_LIMITS.maxSearchLimit }), requestOptions);
      for (const row of rows) if (!pool.has(row.id)) pool.set(row.id, { ...row, body: readableMemory(row.markdown || row.content) });
    }
    const scored = [];
    for (const entry of pool.values()) {
      const text = readableMemory(entry.body || entry.statement).toLowerCase();
      const hits = terms.filter(term => text.includes(term.text));
      if (!hits.length) continue;
      let score = hits.reduce((sum, term) => sum + term.weight, 0);
      // 元数据奖励：用户这句话里出现了这条记忆的项目名/主题，说明问的就是它的范围。
      const meta = [entry.project, entry.topic].filter(value => typeof value === 'string' && value.trim() !== '' && value !== '*').map(value => value.trim().toLowerCase());
      if (meta.some(value => value.length >= 3 && source.includes(value))) score += RECALL_META_BONUS;
      // 门槛：至少一个标识符命中，或中文词元总分够 3。单靠一个普通二元组不再算相关。
      if (!hits.some(term => term.weight >= 2) && score < RECALL_MIN_SCORE) continue;
      scored.push({ score, entry });
    }
    scored.sort((a, b) => b.score - a.score || String(b.entry.created).localeCompare(String(a.entry.created)));
    return { ok: true, value: { terms: terms.map(term => term.text), entries: scored.slice(0, limit).map(({ entry, score }) => ({ id: entry.id, type: entry.type ?? '', project: entry.project ?? '',
      topic: entry.topic ?? '', status: entry.status ?? 'active', created: entry.created ?? '', statement: conclusionLine(entry.body || entry.statement), score })) } };
  }

  function searchView(entry) {
    const assessment = view(entry);
    return { id: entry.id, statement: conclusionLine(entry.body || entry.statement || entry.markdown || entry.content),
      type: entry.type ?? '', project: entry.project ?? '', workspace: entry.workspace ?? '', topic: entry.topic ?? '', topicId: entry.type === 'state' ? memoryTopicId(entry) : '',
      status: entry.status ?? '', confidence: entry.confidence ?? '', created: entry.created ?? '', fresh: entry.fresh === true,
      stale: assessment.stale };
  }


  /**
   * 取若干条目的全文，并顺带累加引用计数（失败不影响返回）。
   * @param {readonly string[]} ids
   * @returns {Promise<{ ok: true, value: { entries: Array<Record<string, any>> } }>}
   */
  async function read(ids) {
    pruneRing();
    const wanted = (Array.isArray(ids) ? ids : [])
      .filter((id) => typeof id === "string" && id !== "")
      .slice(0, MEMORY_LIMITS.maxReadIds);
    if (wanted.length === 0) return { ok: true, value: { entries: [] } };
    const previouslyAbsent = wanted.filter(id => absentIds.has(id));
    if (previouslyAbsent.length) await serialize(reconcile)(previouslyAbsent);

    /** @type {Map<string, { attrs: Record<string, string>, row: Record<string, any> }>} */
    const grouped = new Map();
    for (const id of wanted) grouped.set(id, { attrs: {}, row: { id } });

    const notebook = await resolveNotebook();
    if (!notebook) return { ok: true, value: { entries: [], missing: wanted, availability: "uninitialized", complete: true } };
    const rows = await query(buildReadStatement({ ids: wanted, box: notebook }));
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = typeof row?.id === "string" ? row.id : "";
      const bucket = grouped.get(id);
      if (bucket === undefined) continue;
      // 一个 id 会返回多行：一条带正文，其余每行一个属性。只有真正带正文的行才更新
      // 正文槽位——否则后到的属性行会把 content 覆盖成 undefined，读出来就是空条目。
      if (row.content !== undefined || row.markdown !== undefined) {
        bucket.row = { id, content: row.content, markdown: row.markdown, created: row.created };
      }
      if (typeof row.name === "string" && row.name.startsWith("custom-mem-")) {
        bucket.attrs[row.name] = typeof row.value === "string" ? row.value : String(row.value ?? "");
      }
      if (row.name === undefined) {
        for (const [key, attribute] of Object.entries(MEMORY_ATTRS)) {
          if (Object.hasOwn(row, key)) bucket.attrs[attribute] = String(row[key] ?? '');
        }
      }
    }
    const entries = [];
    for (const [id, bucket] of grouped) {
      const cached = externalEntries.get(id) ?? ring.find((entry) => entry.id === id) ?? pendingStates.get(id);
      if (cached !== undefined) {
        // SQL 还没索引到（写入后最多 2.4 秒）——用写穿缓存顶上，而不是告诉模型「不存在」。
        entries.push(view({ ...cached, body: readableMemory(cached.body), fresh: true }));
        continue;
      }
      if (!bucket.attrs[MEMORY_ATTRS.type]) continue;
      const mapped = toMemoryEntry(bucket.row, bucket.attrs);
      const body = typeof bucket.row.markdown === "string" && bucket.row.markdown.trim() !== ""
        ? bucket.row.markdown
        : String(bucket.row.content ?? "");
      const entry = { ...mapped, body: readableMemory(body) };
      entries.push(view(entry));
      // 引用计数是"锦上添花"：失败只记日志，绝不拖累这次读取。
      const stamp = siyuanStamp(new Date(now()));
      void call("/api/attr/setBlockAttrs", {
        id,
        attrs: {
          [MEMORY_ATTRS.refcount]: String(Number(bucket.attrs[MEMORY_ATTRS.refcount] ?? 0) + 1),
          [MEMORY_ATTRS.lastread]: stamp,
        },
      }).catch(() => {});
    }
    return { ok: true, value: { entries, missing: wanted.filter(id => !entries.some(entry => entry.id === id)), complete: true } };
  }

  /**
   * 读记忆目录：每类多少条 active、最近一条的时间。
   *
   * SQL 索引会滞后最多 ~2.4 秒，所以这里把写穿缓存里**尚未进索引**的条目补上——
   * 否则会话刚写完一条就会在注入里看到「有决策、但目录显示 0 条」的自相矛盾。
   *
   * @returns {Promise<{ ok: true, value: { catalog: Array<{ type: string, count: number, latest: string }>, box: string | null } }>}
   */
  async function catalog() {
    pruneRing();
    const notebook = await resolveNotebook();
    /** @type {Map<string, { type: string, count: number, latest: string }>} */
    const byType = new Map();
    const active = ring.filter((entry) => entry.status === "active");

    /** @type {Set<string>} */
    let indexed = new Set();
    if (notebook !== null) {
      const rows = await query(buildCatalogStatement({ box: notebook }));
      for (const row of Array.isArray(rows) ? rows : []) {
        const type = typeof row?.type === "string" ? row.type : "";
        if (!MEMORY_TYPES.includes(type)) continue;
        byType.set(type, { type, count: Number(row?.n ?? 0), latest: String(row?.latest ?? "") });
      }
      if (active.length > 0) {
        const ids = active.map((entry) => sqlString(entry.id)).join(", ");
        const seen = await query(`SELECT id FROM blocks WHERE box = ${sqlString(notebook)} AND id IN (${ids});`);
        indexed = new Set(
          (Array.isArray(seen) ? seen : []).map((row) => row?.id).filter((id) => typeof id === "string"),
        );
      }
    }
    for (const entry of active) {
      if (indexed.has(entry.id)) continue;
      const current = byType.get(entry.type) ?? { type: entry.type, count: 0, latest: "" };
      current.count += 1;
      if (String(entry.created ?? "") > current.latest) current.latest = String(entry.created ?? "");
      byType.set(entry.type, current);
    }
    return { ok: true, value: { catalog: [...byType.values()], box: notebook, availability: notebook ? "available" : "uninitialized" } };
  }

  /**
   * 面板用：列出记忆条目（含 superseded / revoked）。
   *
   * @param {{ type?: string, project?: string, status?: string, limit?: number }} [input]
   * @returns {Promise<{ ok: true, value: { entries: Array<Record<string, any>>, box: string | null } }>}
   */
  async function list(input = {}) {
    pruneRing();
    const requestOptions = input.timeoutMs ? { timeoutMs: input.timeoutMs } : undefined;
    const notebook = await resolveNotebook(requestOptions);
    const type = MEMORY_TYPES.includes(input.type) ? input.type : undefined;
    const status = MEMORY_STATUSES.includes(input.status) ? input.status : undefined;
    const project = typeof input.project === "string" && input.project.trim() !== "" ? input.project.trim() : undefined;
    const requested = Number(input.limit);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(MEMORY_LIMITS.maxListLimit, Math.trunc(requested))) : MEMORY_LIMITS.maxListLimit;

    /** @type {Array<Record<string, any>>} */
    let entries = [];
    let complete = true;
    if (notebook !== null) {
      const rows = await query(buildListStatement({ box: notebook, type, project, status, limit, scope: input.scope, trusted: input.trusted, workspace: input.workspace, topic: input.topic, topicId: input.topicId, projects: input.projects }), requestOptions);
      if (rows.length >= limit) complete = false;
      for (const row of Array.isArray(rows) ? rows : []) {
        if (pendingEntries().some((entry) => entry.id === row.id)) continue;
        const body =
          typeof row.markdown === "string" && row.markdown.trim() !== "" ? row.markdown : String(row.content ?? "");
        entries.push({
          id: String(row.id ?? ""),
          statement: conclusionLine(body),
          body: readableMemory(body),
          workspace: row.workspace ?? "", topic: row.topic ?? "", topicId: row.topicId ?? '', evidence: row.evidence ?? "", fingerprint: row.fingerprint ?? "",
          approvalHash: row.approvalHash ?? '', approvedAt: row.approvedAt ?? '', approvedBy: row.approvedBy ?? '', proposedSupersedes: row.proposedSupersedes ?? '', echo: row.echo ?? '',
          type: row.type ?? "",
          project: row.project ?? "",
          status: row.status ?? "",
          confidence: row.confidence ?? "",
          created: String(row.created ?? ""),
          source: row.source ?? "",
          refcount: Number(row.refcount ?? 0),
          lastread: String(row.lastread ?? ""),
          supersedes: String(row.supersedes ?? ""),
          supersededBy: String(row.supersededBy ?? ""),
          fresh: false,
        });
      }
    }
    // 写穿缓存里还没进索引的条目补在最前面，否则面板上「刚记的」会消失两秒。
    const seen = new Set(entries.map((entry) => entry.id));
    for (const cached of pendingEntries().reverse()) {
      if (seen.has(cached.id)) continue;
      if (type && cached.type !== type) continue;
      if (project && cached.project !== project) continue;
      if (status && cached.status !== status) continue;
      if (input.scope && !applicableMemory(cached, input.scope)) continue;
      if (input.trusted && !trusted(cached)) continue;
      entries.unshift({ ...cached, fresh: true });
      seen.add(cached.id);
    }
    entries = entries.filter(entry => (!type || entry.type === type) && (!project || entry.project === project) && (!status || entry.status === status) &&
      (!input.scope || applicableMemory(entry, input.scope)) && (!input.trusted || trusted(entry)) && (!input.currentOnly || !assessMemory(entry, now()).reviewRequired) &&
      (input.workspace === undefined || entry.workspace === input.workspace) && (input.topic === undefined || (input.topicId ? memoryTopicId(entry) === input.topicId : canonicalTopic(entry.topic) === canonicalTopic(input.topic))) &&
      (!input.topicId || memoryTopicId(entry) === input.topicId) && (!input.projects || input.projects.includes(entry.project)));
    entries.sort(compareEntries(input.scope));
    return { ok: true, value: { entries: entries.slice(0, limit).map(view), box: notebook, complete: complete && entries.length <= limit, limit, availability: notebook ? "available" : "uninitialized" } };
  }

  /**
   * 改一条记忆的状态（撤销 / 恢复 / 标记被取代）。永不删除，只改状态。
   *
   * `supersededBy` 只在 `status === "superseded"` 时有意义：它补上「被谁取代」这一半，
   * 否则取代链就是断的（体检会把断链单独列出来）。
   *
   * @param {{ id: string, status: string, supersededBy?: string }} input
   * @returns {Promise<{ ok: true, value: { id: string, status: string } } | { ok: false, error: { code: string, message: string } }>}
   */
  async function setStatus(input) {
    if (!MEMORY_STATUSES.includes(input?.status)) throw new MemoryError("invalid_status", `status 必须是 ${MEMORY_STATUSES.join(" / ")}`);
    const entry = await directEntry(String(input.id ?? '').trim());
    if (input.expectedRevision && input.expectedRevision !== entry.revision) throw new MemoryError("revision_conflict", "条目已变化，请重新读取");
    if (input.status === 'active' && entry.status === 'candidate') throw new MemoryError('confirmation_required', '候选记忆必须通过核对入口生效');
    const transaction = mutation('status', input);
    const apply = async patches => {
      try { for (const [id, values] of patches) await transaction.patch(id, values); }
      catch (error) {
        const failed = await transaction.rollback();
        return { ok: false, error: { code: failed.length ? 'chain_incomplete' : error.code ?? 'status_failed', message: `${error.message}${failed.length ? '；需核对：'+failed.join('、') : '；已恢复原状态'}` }, ...(failed.length ? { recovery: { key: transaction.key, ids: failed } } : {}) };
      }
      let warning;
      try { await transaction.commit(); } catch { warning = '状态已生效，恢复记录尚待归档'; }
      for (const [id] of patches) { try { changed(await directEntry(id)); } catch {} }
      return { ok: true, value: { id: entry.id, status: patches.at(-1)[1].status, ...(warning ? { warning } : {}) } };
    };
    if (input.status === 'superseded') {
      const next = await directEntry(String(input.supersededBy ?? ''));
      if (next.id === entry.id || next.status !== 'active' || !sameSubject(entry, next)) throw new MemoryError('scope_mismatch', '取代目标必须是同一主题的另一条有效记忆');
      if (!input.expectedRevision || input.expectedRevision !== entry.revision) throw new MemoryError('revision_conflict', '取代前必须读取旧记忆并携带 revision');
      const predecessors = [...new Set([...idsOf(next.supersedes), entry.id])];
      if (predecessors.length > MEMORY_LIMITS.maxSupersedes) throw new MemoryError('invalid_targets', '取代关系最多包含 5 个前驱');
      return apply([[next.id, { supersedes: predecessors.join(',') }], [entry.id, { status: 'superseded', supersededBy: next.id }]]);
    }
    let status = input.status;
    if (status === 'active' && !trusted(entry)) status = 'candidate';
    if (status === 'active') await checkStateConflict({ ...entry, status }, [entry.id]);
    const patches = [];
    if (entry.supersededBy && status !== 'superseded') {
      const next = await directEntry(entry.supersededBy);
      if (status === 'active' && next.status === 'active') throw new MemoryError('state_conflict', '取代它的新记忆仍有效，请先撤销新条目再恢复');
      patches.push([next.id, { supersedes: idsOf(next.supersedes).filter(id => id !== entry.id).join(',') }]);
    }
    patches.push([entry.id, { status, supersededBy: '' }]);
    return apply(patches);
  }

  async function approvalSelection(entry, input = {}, preview = false) {
    let project = entry.project, workspace = entry.workspace;
    if (input.global === true) { project = '*'; workspace = '*'; }
    else if ((input.project !== undefined && input.project !== project) || (input.workspace !== undefined && input.workspace !== workspace) || (input.global === false && workspace === '*')) {
      const scope = await resolveMemoryScope(input.workspace);
      project = input.project ?? project;
      if (!scope.workspace || !scope.projects.includes(project)) throw new MemoryError('invalid_project', '更改范围时请提供包含该项目的真实工作区路径');
      workspace = project === '*' ? scope.workspace : scope.projectRoots[project];
    }
    if (!preview && (!workspace || workspace === 'unassigned')) throw new MemoryError('invalid_project', '请先为候选选择真实工作区或明确全局范围');
    const subjectChanged = project !== entry.project || workspace !== entry.workspace || Boolean(input.topicId && input.topicId !== memoryTopicId(entry));
    if (subjectChanged && (entry.supersedes || entry.supersededBy)) throw new MemoryError('linked_entry', '有历史取代关系的条目不能在确认时改换主题或范围');
    let topic = entry.topic, topicId = subjectChanged ? undefined : entry.topicId;
    if (input.topicId && input.topicId !== memoryTopicId(entry)) {
      const known = (await topics({ project, workspace })).value.topics.find(item => item.id === input.topicId);
      if (!known) throw new MemoryError('invalid_topic', '请选择该范围中已有的任务主题');
      topic = known.topic; topicId = known.id;
    }
    return { project, workspace, topic, ...(entry.type === 'state' ? { topicId: memoryTopicId({ project, workspace, topic, topicId }) } : {}), subjectChanged };
  }

  async function approvalContext(id, input = {}) {
    const candidate = await directEntry(id);
    if (candidate.status !== 'candidate' && !(candidate.status === 'active' && candidate.reviewRequired)) throw new MemoryError('invalid_status', '该条目无需重新确认，请重新读取');
    const selection = await approvalSelection(candidate, input, true);
    const target = { ...candidate, ...selection };
    const conflicts = candidate.type === 'state' ? (await list({ type: 'state', project: target.project, workspace: target.workspace,
      topic: target.topic, topicId: memoryTopicId(target), status: 'active', limit: 10 })).value.entries.filter(entry => entry.id !== candidate.id) : [];
    for (const oldId of idsOf(candidate.proposedSupersedes)) {
      const old = await directEntry(oldId);
      if (old.status === 'active' && sameSubject(target, old) && !conflicts.some(entry => entry.id === oldId)) conflicts.push(old);
    }
    const directory = candidate.type === 'state' ? await topics({ project: target.project, workspace: target.workspace }) : null;
    return { ok: true, value: { candidate, conflicts, selection, topics: directory?.value.topics ?? [] } };
  }

  async function approve(input, authority = {}) {
    const checkAllowed = () => {
      if (authority.signal?.aborted || (typeof authority.canWrite === 'function' && !authority.canWrite())) throw new MemoryError('cancelled', '确认已取消或记录已关闭，尚未执行的修改已停止');
    };
    checkAllowed();
    const entry = await directEntry(String(input.id ?? ''));
    if (!input.expectedRevision || input.expectedRevision !== entry.revision) throw new MemoryError('revision_conflict', '请重新读取候选全文后确认当前版本');
    if (entry.status !== 'candidate' && !(entry.status === 'active' && entry.reviewRequired)) throw new MemoryError('invalid_status', '只有候选或待复核记忆可以确认');
    if (!['stated', 'verified'].includes(input.confidence)) throw new MemoryError('invalid_confidence', '确认时必须明确 stated 或 verified');
    const { project, workspace, topic, topicId, subjectChanged } = await approvalSelection(entry, input);
    const validated = validateMemory({ ...entry, ...input, project, workspace, topic, topicId, status: 'active', source: entry.source || authority.source, body: input.body ?? entry.body });
    const targets = [...new Set(input.supersedes ?? [])];
    if (targets.length > MEMORY_LIMITS.maxSupersedes || targets.some(id => !/^[0-9]{14}-[a-z0-9]{7}$/u.test(id))) throw new MemoryError('invalid_targets', '一次最多取代 5 个合法条目 ID');
    if (validated.body !== entry.body) {
      if (subjectChanged) throw new MemoryError('scope_mismatch', '请先确认新的范围或主题，再通过新候选修改正文');
      if (targets.length >= MEMORY_LIMITS.maxSupersedes) throw new MemoryError('invalid_targets', '合并正文时最多选择 4 条旧记忆，另保留当前候选的历史');
      return write({ ...validated, supersedes: [...targets, entry.id], confirmedCandidates: [entry.id],
        signal: authority.signal, canWrite: authority.canWrite, originSessionId: input.originSessionId,
        expectedRevisions: { ...input.expectedRevisions, [entry.id]: entry.revision } }, { ...authority, confirmed: true });
    }
    await validateTargets(validated, targets, input.expectedRevisions);
    await checkStateConflict(validated, [...targets, entry.id]);
    const transaction = mutation('approve', input);
    try {
      checkAllowed();
      await transaction.patch(entry.id, { confidence: validated.confidence, evidence: validated.evidence,
        source: validated.source,
        project: validated.project, workspace: validated.workspace, topic: validated.topic, topicId: validated.topicId ?? '', fingerprint: memoryFingerprint(validated),
        proposedSupersedes: '',
        supersedes: [...new Set([...idsOf(entry.supersedes), ...targets])].join(',') });
      await validateTargets(validated, targets, input.expectedRevisions);
      for (const old of targets) {
        checkAllowed();
        await transaction.patch(old, { status: 'superseded', supersededBy: entry.id });
      }
      checkAllowed();
      await transaction.patch(entry.id, { status: 'active' });
    } catch (error) {
      const failed = await transaction.rollback();
      return { ok: false, error: { code: failed.length ? 'chain_incomplete' : error.code ?? 'approve_failed', message: `确认未完成：${error.message}${failed.length ? '；需复核条目：'+failed.join('、') : '；已恢复原状态，可重试'}` }, ...(failed.length ? { recovery: { key: transaction.key, ids: failed } } : {}) };
    }
    for (const old of targets) changed({ ...entry, id: old, status: 'superseded', supersededBy: entry.id });
    if (subjectChanged) changed({ ...entry, status: 'revoked' });
    changed({ ...entry, ...validated, status: 'active', originSessionId: input.originSessionId });
    let warning;
    try { await transaction.commit(); } catch { warning = '确认已生效，但恢复记录尚未完成归档；可在写入恢复中核对'; }
    return { ok: true, value: { id: entry.id, status: 'active', approvedBy: validated.approvedBy, superseded: targets, ...(warning ? { warning } : {}) } };
  }

  /** 给模型和确认面板复用的主题目录；不按语义相似度擅自合并。 */
  async function topics(input = {}) {
    const listed = await list({ ...input, type: 'state', limit: 200 });
    const groups = new Map();
    for (const entry of listed.value.entries) {
      if (!['active', 'candidate'].includes(entry.status) || !entry.topic) continue;
      const id = memoryTopicId(entry);
      const item = groups.get(id) ?? { id, topic: canonicalTopic(entry.topic), project: entry.project, workspace: entry.workspace, activeIds: [], candidateIds: [] };
      item[entry.status === 'active' ? 'activeIds' : 'candidateIds'].push(entry.id); groups.set(id, item);
    }
    return { ok: true, value: { topics: [...groups.values()], complete: listed.value.complete } };
  }


  /**
   * 生成一张交接卡：把当前 active 的记忆压成一段可读、可粘贴的 Markdown。
   *
   * 说清楚它是什么：这是**记忆快照**，不是「这次会话发生了什么」。后者只有模型知道
   * （它在会话里，而且已经有 `memory_write`）。所以这里不假装能自动蒸馏，只做一件
   * 确定性的事——把「换个会话接手时需要立刻知道的东西」按结构拼出来。
   *
   * @returns {Promise<{ ok: true, value: { markdown: string, counts: Record<string, number> } }>}
   */
  async function handoff(input = {}) {
    const selection = { scope: input.scope, projects: input.project ? [...new Set([input.project, '*'])] : undefined };
    const [states, decisions, facts, preferences] = await Promise.all([
      list({ ...selection, type: "state", status: "active", trusted: true, limit: 3 }),
      list({ ...selection, type: "decision", status: "active", trusted: true, limit: 10 }),
      list({ ...selection, type: "fact", status: "active", trusted: true, limit: 10 }),
      list({ ...selection, type: "preference", status: "active", trusted: true, limit: 5 }),
    ]);
    const pick = (result) => result.value.entries;
    const stateEntries = pick(states);
    const decisionEntries = pick(decisions);
    const factEntries = pick(facts);
    const preferenceEntries = pick(preferences);

    const lines = ["# 会话交接卡", ""];
    lines.push(`> 生成于 ${siyuanStamp(new Date(now()))}，取自「${notebookName}」里当前有效的记忆条目。`);
    lines.push("> 这是**记忆快照**，不是本次会话的流水；会话细节用 session_search 查。");
    lines.push(`> 范围：${input.scope?.workspace || '全部工作区'}；${input.project ? '项目 ' + input.project + ' 及适用全局条目' : '范围内全部项目'}。`);
    const complete = [states, decisions, facts, preferences].every(result => result.value.complete);
    if (!complete) lines.push('> 内容按分类数量截取，结果不完整；未列出不代表没有其他记忆。');

    const section = (title, entries, render) => {
      if (entries.length === 0) return;
      lines.push("", `## ${title}`, "");
      for (const entry of entries) lines.push(render(entry));
    };

    section("当前状态与待办", stateEntries, (entry) => `- [${entry.project}/${entry.topic || "旧状态"} · ${entry.id}] ${entry.body.replace(/\n/gu, "\n  ")}`);
    section("工作方式", preferenceEntries, (entry) => `- [${entry.project} · ${entry.id}] ${entry.statement}`);
    section("最近决策", decisionEntries, (entry) => `- [${entry.project} · ${entry.id}] ${entry.statement}`);
    section("已知的坑与硬约束", factEntries, (entry) => `- [${entry.project} · ${entry.id}] ${entry.statement}`);

    if (![stateEntries, preferenceEntries, decisionEntries, factEntries].some(entries => entries.length)) {
      lines.push("", "_记忆体里还没有可交接的条目。_");
    }

    return {
      ok: true,
      value: {
        complete,
        markdown: lines.join("\n"),
        counts: {
          state: stateEntries.length,
          preference: preferenceEntries.length,
          decision: decisionEntries.length,
          fact: factEntries.length,
        },
      },
    };
  }

  /**
   * 记忆体检：找重复、找疑似矛盾、找过期状态、找断掉的取代链、找可以归档的条目。
   *
   * 全部是**确定性**检查，不猜语义——它给的是「值得人看一眼的地方」，不是裁决。
   * 尤其「疑似矛盾」只是高相似度配对：到底是不是矛盾，只有人（或模型读完正文）能判断。
   *
   * @param {{ now?: number, staleStateDays?: number, idleDays?: number }} [options]
   * @returns {Promise<{ ok: true, value: {
   *   total: number,
   *   active: number,
   *   duplicates: Array<{ statement: string, ids: string[] }>,
   *   similar: Array<{ left: string, right: string, score: number }>,
   *   staleStates: Array<{ id: string, statement: string, ageDays: number }>,
   *   brokenChains: Array<{ id: string, statement: string, reason: string }>,
   *   archiveCandidates: Array<{ id: string, statement: string, refcount: number, reason: string }>,
   *   topicDrift: Array<{ project: string, workspace: string, topics: Array<{ id: string, topic: string, created: string, statement: string }> }>
   * } }>}
   */
  async function checkup(options = {}) {
    const at = Number.isFinite(options.now) ? options.now : now();
    const staleStateMs = (Number.isFinite(options.staleStateDays) ? options.staleStateDays : 30) * 86_400_000;
    const idleMs = (Number.isFinite(options.idleDays) ? options.idleDays : 90) * 86_400_000;

    const listed = await list({ limit: MEMORY_LIMITS.maxListLimit, scope: options.scope, project: options.project });
    const entries = listed.value.entries;
    const active = entries.filter((entry) => entry.status === "active");

    // 1) 完全重复：同 project + 同结论，且都还 active。
    /** @type {Map<string, Array<Record<string, any>>>} */
    const byKey = new Map();
    for (const entry of active) {
      const key = `${entry.workspace}\u0000${entry.project}\u0000${entry.type}\u0000${entry.topic}\u0000${entry.statement.replace(/\s+/gu, "")}`;
      const bucket = byKey.get(key);
      if (bucket === undefined) byKey.set(key, [entry]);
      else bucket.push(entry);
    }
    const duplicates = [...byKey.values()]
      .filter((bucket) => bucket.length > 1)
      .map((bucket) => ({ statement: bucket[0].statement, ids: bucket.map((entry) => entry.id) }));

    // 2) 疑似重复/矛盾：高相似但不等价的配对。只比对同一 project 的条目。
    const similar = [];
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const left = active[i];
        const right = active[j];
        if (left.workspace !== right.workspace || left.project !== right.project || left.type !== right.type) continue;
        if (left.statement === right.statement) continue;
        const score = similarity(left.statement, right.statement);
        if (score >= 0.72) {
          similar.push({ left: left.id, right: right.id, leftText: left.statement, rightText: right.statement, score: Number(score.toFixed(2)) });
        }
      }
    }
    similar.sort((a, b) => b.score - a.score);

    // 3) 过期状态：state 类条目太久没更新。
    const staleStates = [];
    for (const entry of active) {
      if (entry.type !== "state") continue;
      const created = parseStamp(entry.approvedAt) ?? parseStamp(entry.created);
      if (created === null) continue;
      const ageDays = Math.floor((at - created) / 86_400_000);
      if (at - created >= staleStateMs) staleStates.push({ id: entry.id, statement: entry.statement, ageDays });
    }

    // 4) 断链：标了 superseded 却没有 superseded-by，或反过来。
    const brokenChains = [];
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    for (const entry of entries) {
      if (entry.status === "superseded" && entry.supersededBy === "") {
        brokenChains.push({ id: entry.id, statement: entry.statement, reason: "状态是「已被取代」，但没有记录被谁取代" });
      }
      if (entry.supersededBy !== "" && entry.status === "active") {
        brokenChains.push({ id: entry.id, statement: entry.statement, reason: "记录了被取代，但状态还是「有效」" });
      }
      if (entry.supersededBy) {
        const next = byId.get(entry.supersededBy);
        if (next && !sameSubject(entry, next)) brokenChains.push({ id: entry.id, statement: entry.statement, reason: '历史取代关系跨工作区、项目、类型或主题，需人工核对归属' });
        if (next && !idsOf(next.supersedes).includes(entry.id)) brokenChains.push({ id: entry.id, statement: entry.statement, reason: "后继条目缺少反向取代链接" });
        else if (!next && listed.value.complete) brokenChains.push({ id: entry.id, statement: entry.statement, reason: "取代目标已不存在" });
      }
      for (const oldId of idsOf(entry.supersedes)) {
        const old = byId.get(oldId);
        if ((old && old.supersededBy !== entry.id) || (!old && listed.value.complete)) brokenChains.push({ id: entry.id, statement: entry.statement, reason: "前驱条目不存在或未链接回当前条目" });
      }
    }

    // 5) 归档候选：长期没被读过、且不是 active 的条目。
    const archiveCandidates = [];
    for (const entry of entries) {
      if (entry.status === "active") continue;
      const last = parseStamp(entry.lastread) ?? parseStamp(entry.created);
      if (last === null) continue;
      if (at - last < idleMs) continue;
      archiveCandidates.push({
        id: entry.id,
        statement: entry.statement,
        refcount: entry.refcount,
        reason: `非有效状态且 ${Math.floor((at - last) / 86_400_000)} 天未被读过`,
      });
    }

    // 6) 主题漂移：同 project + workspace 下有多条 active state，但主题不止一个。
    //    只报告、不自动合并——合并要同时改取代链两端，属于用户决策。
    const stateGroups = new Map();
    for (const entry of active) {
      if (entry.type !== 'state') continue;
      const key = entry.workspace + '\u0000' + entry.project;
      const bucket = stateGroups.get(key);
      if (bucket === undefined) stateGroups.set(key, [entry]);
      else bucket.push(entry);
    }
    const topicDrift = [];
    for (const bucket of stateGroups.values()) {
      const topics = new Map();
      for (const entry of bucket) {
        const topicId = memoryTopicId(entry);
        if (!topics.has(topicId)) topics.set(topicId, entry);
      }
      if (topics.size <= 1) continue;
      topicDrift.push({ project: bucket[0].project, workspace: bucket[0].workspace,
        topics: [...topics.values()].map(entry => ({ id: entry.id, topic: entry.topic ?? '', created: entry.created ?? '', statement: entry.statement })) });
    }

    return {
      ok: true,
      value: {
        complete: listed.value.complete,
        scannedLimit: MEMORY_LIMITS.maxListLimit,
        total: entries.length,
        active: active.length,
        duplicates,
        similar: similar.slice(0, 20),
        staleStates,
        brokenChains,
        archiveCandidates,
        topicDrift,
      },
    };
  }

  /**
   * 主题漂移收敛：把一个项目里「同主题只留一条有效状态」这件事一次做完。
   *
   * 背景（v7-A）：`checkup().topicDrift` 只报告不改数据——合并要同时改取代链两端，
   * 属于用户决策。面板上「只保留最新」按下去之后走这里。
   *
   * 规则（有意保守）：
   * - keep 必须是**有效且有 topic 的 state**；项目与工作区从 keep 自身取值，
   *   请求里带了就必须一致（防止面板拿着过期分组收敛错项目）。
   * - 只有同 project + workspace 的 active state 会被看；组内主题去重后 ≤1 条 → `noDrift`，
   *   一个字节都不改（幂等，面板连点两次不会报错）。
   * - 只作废 **比 keep 更旧**（created 更小）的 active 状态；比它新的不动，
   *   免得把「最新」误标掉。一次最多 `maxSupersedes` 条，并且给 keep 的 supersedes
   *   留出位置——取代链超过上限宁可不收敛，也不写单向链接。
   * - 旧条目与 keep 的属性修改在同一个 `mutation('collapse')` 事务里，失败按记录逆向回滚。
   *
   * @param {{ project?: string, workspace?: string, keepId: string, expectedRevision?: string, signal?: AbortSignal, canWrite?: () => boolean }} input
   * @returns {Promise<{ ok: true, value: { id: string, kept: { id: string, topic: string }, superseded: string[], noDrift?: true, skipped?: number } } | { ok: false, error: { code: string, message: string } } | { ok: false, error: { code: string, message: string }, recovery?: { key: string, ids: string[] } }>}
   */
  async function collapseTopicDrift(input = {}) {
    const keepId = String(input?.keepId ?? '').trim();
    if (!/^[0-9]{14}-[a-z0-9]{7}$/u.test(keepId)) throw new MemoryError('invalid_keep', '要保留的条目 id 形状不对');
    const keep = await directEntry(keepId);
    if (keep.type !== 'state') throw new MemoryError('invalid_keep', '只能收敛 state（当前状态）类记忆');
    if (keep.status !== 'active') throw new MemoryError('invalid_keep', '要保留的条目必须仍然有效');
    if (!keep.topic) throw new MemoryError('invalid_keep', '要保留的状态没有任务主题，无法判断哪些是同一任务');
    if (input?.expectedRevision && input.expectedRevision !== keep.revision) throw new MemoryError('revision_conflict', '保留条目已变化，请重新读取体检结果');
    if (input?.project && input.project !== keep.project) throw new MemoryError('scope_mismatch', '保留条目的项目与请求不一致，请重新读取体检结果');
    if (input?.workspace && scopePath(input.workspace) !== scopePath(keep.workspace)) throw new MemoryError('scope_mismatch', '保留条目的工作区与请求不一致，请重新读取体检结果');
    const kept = { id: keep.id, topic: keep.topic };
    const listed = await list({ type: 'state', status: 'active', project: keep.project, limit: MEMORY_LIMITS.maxListLimit });
    const siblings = listed.value.entries.filter(entry => entry.type === 'state' && entry.status === 'active' &&
      entry.project === keep.project && scopePath(entry.workspace) === scopePath(keep.workspace));
    const topics = new Set(siblings.map(entry => memoryTopicId(entry)));
    if (topics.size <= 1) return { ok: true, value: { id: keep.id, kept, superseded: [], noDrift: true } };
    // created 属性缺失时用 id 前缀兜底：思源的块 id 前 14 位就是创建时间戳，迁移来的老条目可能没写属性。
    const stampOf = entry => {
      const created = String(entry.created ?? '');
      if (created !== '') return created;
      const id = String(entry.id ?? '');
      return /^[0-9]{14}/u.test(id) ? id.slice(0, 14) : '';
    };
    const keepStamp = stampOf(keep);
    const older = siblings
      .filter(entry => entry.id !== keep.id && keepStamp !== '' && stampOf(entry) !== '' && stampOf(entry) < keepStamp)
      .sort((a, b) => stampOf(a).localeCompare(stampOf(b)));
    // 取代链本身有上限：给 keep 已经记着的前驱留出位置，宁可少收敛也不写单向链接。
    const room = Math.max(0, MEMORY_LIMITS.maxSupersedes - idsOf(keep.supersedes).length);
    const stale = older.slice(0, Math.min(room, MEMORY_LIMITS.maxSupersedes));
    if (!stale.length) return { ok: true, value: { id: keep.id, kept, superseded: [], ...(older.length ? { skipped: older.length } : {}) } };
    const transaction = mutation('collapse', { id: keep.id, expectedRevision: input?.expectedRevision, supersedes: stale.map(entry => entry.id), signal: input?.signal, canWrite: input?.canWrite });
    try {
      for (const old of stale) await transaction.patch(old.id, { status: 'superseded', supersededBy: keep.id });
      await transaction.patch(keep.id, { supersedes: [...new Set([...idsOf(keep.supersedes), ...stale.map(entry => entry.id)])].join(',') });
      await transaction.commit();
    } catch (error) {
      const failed = await transaction.rollback();
      return { ok: false, error: { code: failed.length ? 'chain_incomplete' : error.code ?? 'collapse_failed', message: `主题漂移收敛未完成：${error.message}${failed.length ? '；需核对：' + failed.join('、') : '；已恢复原状态，可重试'}` }, ...(failed.length ? { recovery: { key: transaction.key, ids: failed } } : {}) };
    }
    // 让别的会话看到「这些旧状态已经失效」；保留项本身没变内容，不必再播一条。
    for (const old of stale) changed({ ...old, status: 'superseded', supersededBy: keep.id });
    return { ok: true, value: { id: keep.id, kept, superseded: stale.map(entry => entry.id), ...(older.length > stale.length ? { skipped: older.length - stale.length } : {}) } };
  }

  /**
   * 改一条记忆的 project。
   *
   * 存在的理由很具体：蒸馏的提示词再好，模型偶尔也会编出一个不存在的项目名
   * （实测编出过 `dsh-siyuan-memory`），而那些错值一旦进库，就会顺着「候选列表」
   * 一路传染。所以需要一个能批量修正的入口，而不是只能撤销重写。
   *
   * @param {{ id: string, project: string }} input
   * @returns {Promise<{ ok: true, value: { id: string, project: string } } | { ok: false, error: { code: string, message: string } }>}
   */
  async function migrateLegacy(input) {
    const mappings = input?.entries;
    if (!Array.isArray(mappings) || !mappings.length || mappings.length > 200 || new Set(mappings.map(item => item.id)).size !== mappings.length) throw new MemoryError('invalid_migration', '一次迁移需要 1 至 200 个不重复条目');
    const roots = new Map(), before = new Map(), after = new Map(), legacyLinks = [];
    for (const mapping of mappings) {
      const entry = await directEntry(mapping.id);
      if (mapping.expectedRevision !== entry.revision) throw new MemoryError('revision_conflict', `条目 ${entry.id} 已变化，迁移前请重新核对`);
      let workspace = entry.workspace, project = entry.project;
      if (mapping.project !== '*') {
        if (!roots.has(mapping.workspace)) roots.set(mapping.workspace, await resolveMemoryScope(mapping.workspace));
        const scope = roots.get(mapping.workspace);
        if (!scope.projectRoots[mapping.project]) throw new MemoryError('invalid_project', '迁移目标不是已核实的真实项目目录');
        workspace = scopePath(scope.projectRoots[mapping.project]); project = mapping.project;
        if (entry.workspace && (scopePath(entry.workspace) !== workspace || entry.project !== project)) throw new MemoryError('already_bound', `条目 ${entry.id} 已绑定其它范围，不能作为旧数据自动迁移`);
      } else if (entry.project !== '*') throw new MemoryError('invalid_migration', '不能把旧项目记忆自动改为全局记忆');
      const topic = entry.type === 'state' ? String(mapping.topic ?? entry.topic).trim() : entry.topic;
      if (entry.type === 'state' && (!topic || topic.length > 120 || /[\r\n\0]/u.test(topic))) throw new MemoryError('invalid_topic', '旧状态必须明确绑定稳定主题');
      before.set(entry.id, entry); after.set(entry.id, { ...entry, workspace, project, topic });
    }
    const linked = async id => after.get(id) ?? await directEntry(id);
    for (const entry of after.values()) {
      if (entry.supersededBy) {
        const next = await linked(entry.supersededBy);
        if (entry.status !== 'superseded') throw new MemoryError('chain_conflict', `条目 ${entry.id} 的既有取代状态不一致`);
        if (!sameSubject(entry, next)) {
          if (!input.preserveLegacyLinks) throw new MemoryError('chain_conflict', `条目 ${entry.id} 的既有取代关系跨范围或状态不一致`);
          legacyLinks.push({ id: entry.id, next: next.id, reason: '既有跨范围取代关系保留，未增删链接，需人工核对' });
          continue;
        }
        if (!idsOf(next.supersedes).includes(entry.id)) {
          if (!input.repairLinks || !after.has(next.id)) throw new MemoryError('linked_entry', '需要把同一取代链放在同一迁移批次中');
          next.supersedes = [...new Set([...idsOf(next.supersedes), entry.id])].join(',');
        }
      }
      for (const oldId of idsOf(entry.supersedes)) {
        const old = await linked(oldId);
        if (!sameSubject(entry, old) || old.status !== 'superseded' || (old.supersededBy && old.supersededBy !== entry.id)) throw new MemoryError('chain_conflict', '旧条目的取代去向存在冲突，不能猜测迁移');
        if (!old.supersededBy) {
          if (!input.repairLinks || !after.has(old.id)) throw new MemoryError('linked_entry', '缺少可核对的反向取代关系');
          old.supersededBy = entry.id;
        }
      }
      if (idsOf(entry.supersedes).length > MEMORY_LIMITS.maxSupersedes) throw new MemoryError('invalid_targets', '历史取代关系超过支持的前驱数量，需要人工整理');
    }
    const occupied = new Set();
    for (const entry of after.values()) if (entry.type === 'state' && entry.status === 'active') {
      const key = JSON.stringify([entry.workspace, entry.project, entry.topic]);
      if (occupied.has(key)) throw new MemoryError('state_conflict', '迁移后同主题会有多个有效状态，请先核对主题');
      occupied.add(key); await checkStateConflict(entry, [...after.keys()]);
    }
    const transaction = mutation('migration', { id: mappings[0].id, expectedRevision: createHash('sha256').update(JSON.stringify(mappings)).digest('hex') });
    try {
      for (const entry of after.values()) {
        const original = before.get(entry.id);
        if ((await directEntry(entry.id)).revision !== original.revision) throw new MemoryError('revision_conflict', '迁移期间条目被外部修改，已停止并恢复');
        const values = { project: entry.project, workspace: entry.workspace, topic: entry.topic, fingerprint: memoryFingerprint(entry), supersedes: entry.supersedes, supersededBy: entry.supersededBy };
        await transaction.patch(entry.id, values);
      }
    } catch (error) {
      const failed = await transaction.rollback();
      return { ok: false, error: { code: failed.length ? 'chain_incomplete' : error.code ?? 'migration_failed', message: error.message + (failed.length ? '；待恢复：' + failed.join('、') : '；已恢复原属性') }, recovery: { key: transaction.key, ids: failed } };
    }
    for (const entry of after.values()) { changed({ ...before.get(entry.id), status: 'revoked' }); changed(entry); }
    let warning; try { await transaction.commit(); } catch { warning = '迁移已完成，恢复记录尚待归档'; }
    return { ok: true, value: { migrated: after.size, ids: [...after.keys()], legacyLinks, ...(warning ? { warning } : {}) } };
  }

  async function setProject(input) {
    const entry = await directEntry(String(input?.id ?? '').trim());
    if (!input.expectedRevision || input.expectedRevision !== entry.revision) throw new MemoryError('revision_conflict', '绑定项目之前请重新读取条目并提供版本');
    if (entry.supersededBy || entry.supersedes) throw new MemoryError('linked_entry', '条目存在取代关系，请先处理取代链再迁移项目');
    const scope = await resolveMemoryScope(input.workspace);
    if (!scope.workspace || !scope.projects.includes(input.project)) throw new MemoryError('invalid_project', 'workspace 必须指向包含该项目的真实目录');
    const workspace = input.project === '*' ? '*' : scopePath(scope.projectRoots[input.project]);
    const next = { ...entry, project: input.project, workspace };
    await checkStateConflict(next, [entry.id]);
    await patchEntry(entry.id, { project: next.project, workspace, fingerprint: memoryFingerprint(next) });
    changed({ ...entry, status: 'revoked' });
    changed(next);
    return { ok: true, value: { id: entry.id, project: next.project, workspace } };
  }

  /**
   * 生成常驻注入的快照文本。
   *
   * 冻结语义：一旦生成，仅在新会话显式 force 或 refreshSnapshot 时重建，
   * 否则返回同一份字符串——这样 system prompt 在会话内保持稳定，不打掉 prompt cache，
   * 也不让 `systemPrompt.project()` 反复往 surface 尾部追 system 节点。
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<string>}
   */
  async function sectionText(options = {}) {
    if (disposed) return '';
    try { await reconcileBeforeRead(); } catch { return '[记忆] 长期记忆体暂时不可用，待同步状态尚未核对，请稍后重试。'; }
    const key = JSON.stringify(options.scope ?? null);
    if (options.force !== true && snapshots.has(key)) return snapshots.get(key);
    const text = await buildSnapshotText(options.scope, options.timeoutMs);
    if (disposed) return '';
    if (snapshots.size >= 64) snapshots.delete(snapshots.keys().next().value);
    snapshots.set(key, text);
    return text;
  }

  async function buildSnapshotText(scope, timeoutMs) {
    const effectiveScope = scope ?? { project: '*', projectRoots: {} };
    const projects = scope?.project === '*' ? scope.projects?.filter(name => name !== '*').join(' / ') : scope?.project;
    const lines = ['[记忆] 历史资料，当前要求优先；要全文用 memory_search / memory_read，新结论用 memory_write 记下来。',
      '当前项目：' + (projects || '仅全局').slice(0, 100) + '；通用内容填 *。'];
    try {
      const kinds = ['state', 'preference', 'decision', 'fact'];
      const [lists, directory] = await Promise.all([
        Promise.all(kinds.map(type => list({ type, scope: effectiveScope, timeoutMs, status: 'active', limit: 200 }))),
        list({ scope: effectiveScope, timeoutMs, limit: 200 }),
      ]);
      const count = type => directory.value.entries.filter(entry => entry.type === type && entry.status === 'active').length;
      const candidates = directory.value.entries.filter(entry => entry.status === 'candidate');
      lines.push(`目录${directory.value.complete ? '' : '（最近200条）'}：事实 ${count('fact')} · 决策 ${count('decision')} · 状态 ${count('state')} · 候选 ${candidates.length}。`);
      if (lists.some(result => !result.value.complete)) lines.push('目录达到扫描上限，按需检索可查其他条目。');
      const uninitialized = lists.every(result => result.value.availability === 'uninitialized');
      // 事实最多，不能全列：被读过的（证明有用）优先两条，其余按当前项目优先、时间倒序补足。
      const facts = lists[3].value.entries;
      const proven = [...facts].filter(entry => entry.refcount > 0).sort((a, b) => b.refcount - a.refcount).slice(0, 2);
      const picks = [lists[0].value.entries, lists[1].value.entries, lists[2].value.entries, [...proven, ...facts.filter(entry => !proven.includes(entry))]];
      const labels = ['待办', '偏好', '最近决策', '踩过的坑与事实'], quota = [3, 6, 4, 4];
      const tail = '其他项目和历史条目请按需检索；未命中不代表从未记录。';
      const candidateBlock = candidates.length ? '候选（未核实）：\n' + candidates.slice(0, 2).map(entry => `- [${entry.project.slice(0, 24)} | ${entry.confidence}] ${entry.statement.slice(0, 50)}`).join('\n') : '';
      // 结尾提示、候选摘要先留出预算；条目每类轮流分配，任务状态先获得空间；标题每类只写一次。
      let budget = MEMORY_LIMITS.sectionMaxChars - lines.reduce((sum, line) => sum + line.length + 1, 0) - tail.length - 1 -
        (candidateBlock ? candidateBlock.length + 1 : 0) - (uninitialized ? 12 : 0);
      // v7-C：每个类目内按项目分组——项目名只在组头写一次，条目行只留主题/可信度。
      // 真实库里 14 条条目的项目名原来重复占了 227 字；省下来的预算让事实类能多进一条。
      const chosen = labels.map(() => []);
      const grouped = labels.map(() => new Set());
      // 分配顺序：待办 → 偏好 → 事实 → 决策。
      // 待办排第一是既定语义（任务状态先获得空间）；事实排在决策之前是有意的——
      // 事实池最大（真实库 41 条 vs 决策 19 条）却被挤到只剩 3 条，而分组省下的字
      // 原先正好被决策的第 4 条吃掉。决策的半衰期更长但复用率更低，让事实先拿这条位置。
      const order = [0, 1, 3, 2];
      for (let offset = 0; offset < 6; offset++) for (const index of order) {
        const entry = offset < quota[index] ? picks[index][offset] : undefined;
        if (!entry) continue;
        const project = String(entry.project || '*').slice(0, 24);
        // 方括号里只留主题与（非默认的）可信度：项目名已经在组头上，不必每行重复。
        const badge = [entry.topic ? entry.topic.slice(0, 24) : '', entry.confidence && entry.confidence !== 'stated' ? entry.confidence : ''].filter(Boolean);
        const head = '  - ' + (badge.length ? '[' + badge.join(' | ') + '] ' : '');
        const labelCost = chosen[index].length ? 0 : labels[index].length + 2;
        const heading = grouped[index].has(project) ? 0 : ('- ' + project).length + 1;
        let body = entry.statement.slice(0, 80) + (entry.statement.length > 80 ? '…' : '');
        let cost = labelCost + heading + head.length + body.length + 1;
        if (cost > budget) {
          // 剩余预算还够一句话就截断收录这一条，而不是整条丢掉、把预算空在那里。
          const room = budget - labelCost - heading - head.length - 1;
          if (room < MIN_TRUNCATED_BODY) continue;
          body = entry.statement.slice(0, room - 1) + '…';
          cost = labelCost + heading + head.length + body.length + 1;
          if (cost > budget) continue;
        }
        if (heading) { chosen[index].push('- ' + project); grouped[index].add(project); }
        chosen[index].push(head + body);
        budget -= cost;
      }
      for (const [index, label] of labels.entries()) if (chosen[index].length) lines.push(label + '：\n' + chosen[index].join('\n'));
      if (candidateBlock) lines.push(candidateBlock);
      lines.push(tail);
      if (uninitialized) lines.push('记忆笔记本尚未初始化。');
    } catch {
      return '[记忆] 长期记忆体暂时不可用，无法确认已有记忆。需要时调用 memory_search 重试。';
    }
    return clampSectionLines(lines);
  }


  const guardConnection = (operation) => async (...args) => {
    if (disposed) return unavailable();
    pruneRing();
    try { await reconcileBeforeRead(); const result = await operation(...args); return disposed ? unavailable() : result; }
    catch (error) { return memoryFailure(error); }
  };
  const reset = () => {
    box = null;
    docIds.clear();
    docTasks.clear();
    lookupTasks.clear();
    createTask = null;
    ring.length = 0;
    pendingStates.clear();
    stateCheckedAt.clear(); absentIds.clear();
    externalEntries.clear(); observedEntries.clear();
    pendingAt.clear();
    pendingAttrs.clear();
    snapshots.clear();
    receipts.clear();
    mutationReceipts.clear();
    changes.length = 0;
    revision = 0;
  };

  return {
    write: guardConnection(serialize(write)),
    reconcile: guardConnection(serialize(reconcile)),
    topics: guardConnection(topics),
    recall: guardConnection(recall),
    receiptList: guardConnection(receiptList),
    recoverReceipt: guardConnection(serialize(recoverReceipt)),
    cleanupReceipts: guardConnection(serialize(cleanupReceipts)),
    search: guardConnection(search),
    read: guardConnection(read),
    catalog: guardConnection(catalog),
    list: guardConnection(list),
    setStatus: guardConnection(serialize(setStatus)),
    setProject: guardConnection(serialize(setProject)),
    migrateLegacy: guardConnection(serialize(migrateLegacy)),
    approve: guardConnection(serialize(approve)),
    approvalContext: guardConnection(approvalContext),
    revision: () => revision,
    changesSince: (since) => ({ revision, complete: !changes.length || since >= changes[0].revision - 1, entries: changes.filter(entry => entry.revision > since) }),
    handoff: guardConnection(handoff),
    checkup: guardConnection(checkup),
    collapseTopicDrift: guardConnection(serialize(collapseTopicDrift)),
    sectionText,
    invalidateSnapshot,
    /**
     * 丢掉快照，让下一次 `sectionText()` 一定重建。
     *
     * 这是「会话起点」该做的事：新会话第一次装配 system prompt 时重新拉一次记忆目录，
     * 之后整场会话都复用同一份冻结文本。挂在 `agent/created` 上。
     */
    refreshSnapshot: () => {
      snapshots.clear();
    },
    /** 供测试与调试：当前写穿缓存快照。 */
    peekRing: () => { pruneRing(); return ring.slice(); },
    /** 供测试：把内部缓存清空（换内核/换笔记本时用）。 */
    reset,
    /** 换连接时永久停用旧实例，未完成请求不得回填或继续写入。 */
    dispose: () => { disposed = true; reset(); },
    /** 供测试与面板：解析出的笔记本 id。 */
    peekBox: () => box,
  };
}

