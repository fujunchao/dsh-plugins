/**
 * 秘密脱敏。
 *
 * 目标不是“防越权”（bash 本来就能读原件），而是**防意外扩散**：秘密一旦进入上下文，
 * 就有机会被写进笔记、被蒸馏进长期记忆、被提交进 git。
 *
 * 三条硬规则：
 * 1. **保留类型与长度**（`<redacted: password, 12 chars>`），模型仍能判断“这里有个 key、
 *    它多长、属于哪一类”，从而做结构级的工作；光秃秃的 `<redacted>` 会让它误判原文缺失。
 * 2. **只替换值，不碰结构**：引号、前缀（`--password `）、换行、缩进一律原样保留，
 *    否则打码会把命令行“改成”另一条命令。
 * 3. **幂等**：已经打过码的位置再跑一遍不产生二次替换。
 *
 * @module dsh-session-lens/redact
 */

/**
 * 打码标记。
 * @param {string} kind 凭据类别。
 * @param {number} length 原值字符数。
 * @returns {string} 形如 `<redacted: api-key, 51 chars>` 的标记。
 */
export function redactionMarker(kind, length) {
  return `<redacted: ${kind}, ${length} chars>`;
}

/** 已被打过码的片段：再次处理时原样放行，保证幂等。 */
const ALREADY = /^<?redacted[: ]/;

/**
 * 把匹配到的值替换成标记，保留原引号与句尾标点。
 * @param {string} kind 凭据类别。
 * @param {string} raw 原始值（可能带引号、可能带句尾标点）。
 * @returns {string} 带同样引号的标记。
 */
function maskedValue(kind, raw) {
  const quoted =
    raw.length >= 2 &&
    ((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'"));
  const unquoted = quoted ? raw.slice(1, -1) : raw;
  // 正则的字符类会把句末的 "." / "," 一起吞掉；它们不属于凭据，原样留在标记外面。
  const trailing = unquoted.match(/[.,;:!?]+$/)?.[0] ?? "";
  const inner = trailing === "" ? unquoted : unquoted.slice(0, unquoted.length - trailing.length);
  if (ALREADY.test(inner)) return raw;
  const marker = redactionMarker(kind, [...inner].length);
  const body = `${marker}${trailing}`;
  return quoted ? `${raw[0]}${body}${raw[0]}` : body;
}

/**
 * 一条脱敏规则：先整块匹配，再把捕获到的“值”换成标记。
 * @typedef {{
 *   kind: string,
 *   pattern: RegExp,
 *   rebuild: (match: string, groups: (string | undefined)[]) => string | undefined,
 * }} RedactionRule
 */

/**
 * 值看起来像不像凭据。用于“裸词 + 值”这类规则，避免把 `token generation` 打码。
 * @param {string} value 候选值。
 * @returns {boolean} 是否像凭据。
 */
export function looksSecretValue(value) {
  return /[0-9]/.test(value) || value.length >= 24;
}

/** @type {readonly RedactionRule[]} */
export const RULES = Object.freeze([
  {
    kind: "private-key",
    // PEM 私钥：整块替换，连头带尾一起收走。
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    rebuild: (match) => redactionMarker("private-key", match.length),
  },
  {
    kind: "api-key",
    // OpenAI 风格的 sk- 键。
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    rebuild: (match) => maskedValue("api-key", match),
  },
  {
    kind: "api-key",
    // 其他常见带前缀的 token。
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}\b/g,
    rebuild: (match) => maskedValue("api-key", match),
  },
  {
    kind: "auth-token",
    // Authorization: Token <value>（SiYuan 等）以及其他 scheme；只保留 scheme 名。
    pattern: /\b(Authorization:\s*(?:Token|Bearer|Basic|Digest|ApiKey|Api-Key)\s+)([A-Za-z0-9._~+/=-]{8,})/gi,
    rebuild: (_match, [prefix, value]) => `${prefix}${maskedValue("auth-token", value ?? "")}`,
  },
  {
    kind: "auth-token",
    // 裸 scheme：`-H 'Authorization: ...'` 之外还可能直接写 `Bearer abc…`、`Token abc123`、`ApiKey …`。
    pattern: /\b(Bearer|Token|Basic|Digest|ApiKey|Api-Key)\s+([A-Za-z0-9._~+/=-]{8,}=*)/g,
    rebuild: (match, [scheme, value]) =>
      looksSecretValue(value ?? "") ? `${scheme} ${maskedValue("auth-token", value ?? "")}` : undefined,
  },
  {
    kind: "secret",
    // 散文里的 “token demo-7f3a91” / “password hunter2”：只在值像凭据时才打码。
    pattern:
      /\b(token|password|passwd|secret|api[- _]?key|access[- _]?key)\s+(?=[`"'(]?)([A-Za-z0-9._~+/=-]{8,})/gi,
    rebuild: (match, [word, value]) =>
      looksSecretValue(value ?? "") ? `${word} ${maskedValue("secret", value ?? "")}` : undefined,
  },
  {
    kind: "password",
    // URL 里的 user:password@host
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)([^\s/@]+)@/gi,
    rebuild: (_match, [prefix, value]) => `${prefix}${maskedValue("password", value ?? "")}@`,
  },
  {
    kind: "password",
    // --password <value> / --password=<value>
    pattern: /(--password[=\s]+)("[^"]*"|'[^']*'|[^\s"']{4,})/gi,
    rebuild: (_match, [prefix, value]) => `${prefix}${maskedValue("password", value ?? "")}`,
  },
  {
    kind: "password",
    // password= / password: / passwd=
    pattern: /\b(password|passwd|pwd)\s*([=:])\s*("[^"]*"|'[^']*'|[^\s"',;]{4,})/gi,
    rebuild: (_match, [name, separator, value]) =>
      `${name}${separator}${maskedValue("password", value ?? "")}`,
  },
  {
    kind: "env-secret",
    // DEEPSEEK_API_KEY=... / GITHUB_TOKEN=... / AWS_SECRET_ACCESS_KEY=...
    pattern:
      /\b([A-Z][A-Z0-9_]*(?:API_KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|ACCESS_KEY|PRIVATE_KEY))\s*([=:])\s*("[^"]*"|'[^']*'|[^\s"',;]{6,})/g,
    rebuild: (_match, [name, separator, value]) =>
      `${name}${separator}${maskedValue("env-secret", value ?? "")}`,
  },
  {
    kind: "json-secret",
    // {"apiKey": "..."} / {"token": "..."}
    pattern: /("(?:api[_-]?key|apikey|token|secret|password|access[_-]?token)"\s*:\s*)"([^"]{6,})"/gi,
    rebuild: (_match, [prefix, value]) => `${prefix}"${maskedValue("json-secret", value ?? "")}"`,
  },
  {
    kind: "secret",
    // 兜底：形如 xxx_secret: <长串>、xxx_key = <长串> 的赋值（含中文键名右侧的习惯写法）。
    pattern: /\b([A-Za-z0-9_.-]*(?:secret|token|credential)[A-Za-z0-9_.-]*\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"',;]{12,})/gi,
    rebuild: (_match, [prefix, value]) => `${prefix}${maskedValue("secret", value ?? "")}`,
  },
]);

/**
 * 对一段文本执行全部脱敏规则。
 * @param {string} text 原始文本（会话正文、工具参数、命令行输出都可能）。
 * @returns {string} 打码后的文本；未命中时原样返回。
 */
export function redactSecrets(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let output = text;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, (match, ...rest) => {
      // `replace` 的回调尾部还带着 offset 与整个输入串，必须切掉，否则会被当成捕获组。
      const groups = rest.slice(0, Math.max(0, rest.length - 2));
      const rebuilt = rule.rebuild(match, groups);
      return rebuilt === undefined ? match : rebuilt;
    });
  }
  return output;
}
