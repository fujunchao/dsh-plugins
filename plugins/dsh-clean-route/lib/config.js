/**
 * 规则表：加载、校验、热重载、路由匹配。
 *
 * 规则表是唯一真源（YAML）。三条硬约束：
 *  1. 解析或校验失败 → 保留上一份有效配置，prompt 路径绝不抛错；
 *  2. 规则表不存在 → 用内置默认规则（等于已验证过的默认行为）；
 *  3. 改文件 → 下一个 step 生效，无需重启。
 *
 * @module dsh-clean-route/config
 */

import { readFileSync, watch as fsWatch } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/** 默认规则表位置。 */
export const DEFAULT_RULES_PATH = resolve(homedir(), ".dsh", "gemini-clean.yml");

/** 插件名，用于日志前缀。 */
export const PLUGIN_NAME = "clean-route";

/** 内置默认规则：与 2026-11-17 实测验证过的默认行为一致。 */
export const DEFAULT_RULES = Object.freeze({
  version: 1,
  routes: Object.freeze([{ provider: "google" }]),
  sections: Object.freeze({
    drop: Object.freeze(["harness:identity", "harness:source", "app:web-surface"]),
    replace: Object.freeze({ "deployment:persona-prefix": "你是一个在用户本机运行的编码助手，用中文回答。" }),
    append: Object.freeze([]),
  }),
  contexts: Object.freeze({ drop: Object.freeze(["harness:source", "app:web-surface"]) }),
  carrier: null,
  textRules: Object.freeze([]),
});

const TEXT_RULE_KEYS = new Set(["pattern", "replacement", "regex", "flags"]);

/** 把 YAML 文本校验成规则；无效条目只报警告，不整体拒绝。 */
export function parseRules(source, { label = "规则表" } = {}) {
  const warnings = [];
  let raw;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new TypeError(`${label} 不是合法 YAML：${error.message}`);
  }
  if (raw === null || raw === undefined) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new TypeError(`${label} 顶层必须是映射`);

  const known = new Set(["version", "routes", "sections", "contexts", "carrier", "textRules"]);
  for (const key of Object.keys(raw)) if (!known.has(key)) warnings.push(`未知字段 ${key}（忽略）`);
  if (raw.version !== undefined && raw.version !== 1) throw new TypeError(`${label} 只支持 version: 1`);

  return {
    rules: {
      version: 1,
      routes: normalizeRoutes(raw.routes, warnings, label),
      sections: normalizeSections(raw.sections, warnings, label),
      contexts: normalizeContexts(raw.contexts, warnings, label),
      carrier: normalizeCarrier(raw.carrier, warnings),
      textRules: normalizeTextRules(raw.textRules, warnings),
    },
    warnings,
  };
}

function normalizeRoutes(value, warnings, label) {
  if (value === undefined) return [...DEFAULT_RULES.routes];
  if (!Array.isArray(value)) throw new TypeError(`${label} 的 routes 必须是数组`);
  const routes = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry === "string" && entry.length > 0) {
      routes.push({ provider: entry });
      continue;
    }
    if (entry === null || typeof entry !== "object") {
      warnings.push(`routes[${index}] 不是字符串或映射（忽略）`);
      continue;
    }
    if (typeof entry.provider !== "string" || entry.provider.length === 0) {
      warnings.push(`routes[${index}] 缺少 provider（忽略）`);
      continue;
    }
    if (entry.model !== undefined && typeof entry.model !== "string") {
      warnings.push(`routes[${index}].model 必须是字符串（忽略该 model，按整个 provider 处理）`);
      routes.push({ provider: entry.provider });
      continue;
    }
    routes.push(entry.model === undefined ? { provider: entry.provider } : { provider: entry.provider, model: entry.model });
  }
  return routes;
}

function normalizeSections(value, warnings, label) {
  if (value === undefined) {
    return { drop: [...DEFAULT_RULES.sections.drop], replace: { ...DEFAULT_RULES.sections.replace }, append: [] };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} 的 sections 必须是映射`);

  const drop = stringList(value.drop, "sections.drop", warnings);
  const replace = {};
  if (value.replace !== undefined) {
    if (value.replace === null || typeof value.replace !== "object" || Array.isArray(value.replace)) {
      warnings.push("sections.replace 必须是「section 名 → 文本」的映射（忽略）");
    } else {
      for (const [name, text] of Object.entries(value.replace)) {
        if (typeof text !== "string") warnings.push(`sections.replace[${name}] 必须是字符串（忽略）`);
        else replace[name] = text;
      }
    }
  }
  const append = [];
  if (value.append !== undefined) {
    if (!Array.isArray(value.append)) warnings.push("sections.append 必须是数组（忽略）");
    else for (const [index, entry] of value.append.entries()) {
      if (typeof entry === "string") append.push({ name: `clean-route:append:${index}`, text: entry });
      else if (entry !== null && typeof entry === "object" && typeof entry.text === "string") {
        append.push({ name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : `clean-route:append:${index}`, text: entry.text });
      } else warnings.push(`sections.append[${index}] 必须是字符串或 { name?, text }（忽略）`);
    }
  }
  return { drop, replace, append };
}

function normalizeContexts(value, warnings, label) {
  if (value === undefined) return { drop: [...DEFAULT_RULES.contexts.drop] };
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} 的 contexts 必须是映射`);
  return { drop: stringList(value.drop, "contexts.drop", warnings) };
}

function normalizeCarrier(value, warnings) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    warnings.push("carrier 必须是文件路径字符串或 null（忽略）");
    return null;
  }
  return value;
}

function normalizeTextRules(value, warnings) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push("textRules 必须是数组（忽略）");
    return [];
  }
  const rules = [];
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== "object") {
      warnings.push(`textRules[${index}] 必须是映射（忽略）`);
      continue;
    }
    for (const key of Object.keys(entry)) if (!TEXT_RULE_KEYS.has(key)) warnings.push(`textRules[${index}].${key} 未知字段（忽略）`);
    if (typeof entry.pattern !== "string" || entry.pattern.length === 0) {
      warnings.push(`textRules[${index}] 缺少 pattern（忽略）`);
      continue;
    }
    if (typeof entry.replacement !== "string") {
      warnings.push(`textRules[${index}] 缺少 replacement（忽略）`);
      continue;
    }
    const regex = entry.regex === true;
    const flags = typeof entry.flags === "string" ? entry.flags : "";
    if (regex) {
      try {
        new RegExp(entry.pattern, flags);
      } catch (error) {
        warnings.push(`textRules[${index}] 正则非法（忽略）：${error.message}`);
        continue;
      }
    }
    rules.push({ pattern: entry.pattern, replacement: entry.replacement, regex, flags });
  }
  return rules;
}

function stringList(value, field, warnings) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${field} 必须是字符串数组（忽略）`);
    return [];
  }
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) warnings.push(`${field} 里有非字符串条目（忽略）`);
    else out.push(entry);
  }
  return out;
}

/** 把「provider + 可选 model glob」编译成匹配函数；只支持 *，大小写不敏感。 */
export function compileRoutes(routes) {
  const matchers = routes.map((route) => ({
    provider: route.provider,
    model: route.model === undefined ? null : globToRegExp(route.model),
  }));
  return (provider, model) => matchers.some((matcher) => {
    if (matcher.provider !== "*" && matcher.provider !== provider) return false;
    return matcher.model === null || (typeof model === "string" && matcher.model.test(model));
  });
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/** 规则快照 → 净化器可直接用的形态（正则预编译、carrier 文本已读出）。 */
export function compileRules(rules, { baseDir, readFileText }) {
  const warnings = [];
  const textRules = [];
  for (const rule of rules.textRules) {
    try {
      textRules.push({ ...rule, regex: rule.regex ? new RegExp(rule.pattern, rule.flags ?? "") : null, count: 0 });
    } catch (error) {
      warnings.push(`textRules 正则编译失败（忽略）：${error.message}`);
    }
  }
  let carrierText = null;
  if (rules.carrier !== null) {
    const target = isAbsolute(rules.carrier) ? rules.carrier : resolve(baseDir, rules.carrier);
    try {
      carrierText = readFileText(target);
    } catch (error) {
      warnings.push(`carrier 读取失败（忽略）：${target}：${error.message}`);
    }
  }
  return {
    match: compileRoutes(rules.routes),
    dropSections: new Set(rules.sections.drop),
    replaceSections: new Map(Object.entries(rules.sections.replace)),
    appendSections: rules.sections.append.map((entry) => ({ ...entry })),
    dropContexts: new Set(rules.contexts.drop),
    textRules,
    carrierText,
    warnings,
  };
}

/**
 * 规则表的当前快照，带热重载与「保留上一份有效配置」。
 * `get()` 永远返回可用快照：文件坏掉时退回上一份成功的解析结果。
 */
export class RuleStore {
  #path;
  #watchEnabled;
  #logger;
  #current;
  #watcher;
  #timer;
  #disposed = false;
  #loggedError = null;

  constructor({ path = DEFAULT_RULES_PATH, watch = true, logger } = {}) {
    this.#path = resolve(path);
    this.#watchEnabled = watch !== false;
    this.#logger = logger;
    this.#current = this.#defaultSnapshot("尚未加载");
  }

  get path() {
    return this.#path;
  }

  get() {
    return this.#current;
  }

  async start() {
    await this.reload("初始加载");
    if (this.#watchEnabled) this.#watch();
  }

  dispose() {
    this.#disposed = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    try {
      this.#watcher?.close();
    } catch {
      /* 监听器已随进程退出 */
    }
    this.#watcher = undefined;
  }

  async reload(reason = "重载") {
    if (this.#disposed) return this.#current;
    let text;
    try {
      text = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        this.#current = this.#defaultSnapshot("规则表不存在，使用内置默认规则");
        return this.#current;
      }
      this.#warnOnce(`规则表读取失败（保留上一份有效配置）：${error.message}`);
      return this.#current;
    }
    try {
      const { rules, warnings } = parseRules(text, { label: "规则表" });
      const compiled = compileRules(rules, { baseDir: dirname(this.#path), readFileText: (target) => readFileSync(target, "utf8") });
      for (const warning of [...warnings, ...compiled.warnings]) this.#warn(warning);
      this.#current = { source: "file", path: this.#path, rules, compiled, warnings: [...warnings, ...compiled.warnings], error: null, loadedAt: Date.now(), note: reason };
      this.#loggedError = null;
      return this.#current;
    } catch (error) {
      this.#warnOnce(`规则表无效（保留上一份有效配置）：${error.message}`);
      return this.#current;
    }
  }

  #defaultSnapshot(note) {
    const compiled = compileRules(DEFAULT_RULES, { baseDir: dirname(this.#path), readFileText: (target) => readFileSync(target, "utf8") });
    return { source: "default", path: this.#path, rules: DEFAULT_RULES, compiled, warnings: [], error: null, loadedAt: Date.now(), note };
  }

  #watch() {
    const directory = dirname(this.#path);
    const target = basename(this.#path);
    const schedule = () => {
      if (this.#disposed) return;
      if (this.#timer !== null) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.reload("文件变更");
      }, 120);
      if (typeof this.#timer.unref === "function") this.#timer.unref();
    };
    try {
      this.#watcher = fsWatch(directory, { persistent: false }, (_event, filename) => {
        if (filename === null || filename === undefined || filename.toString() === target) schedule();
      });
      this.#watcher.on("error", (error) => this.#warnOnce(`规则表监听失败（热重载停用）：${error.message}`));
    } catch (error) {
      this.#warnOnce(`规则表监听失败（热重载停用）：${error.message}`);
    }
  }

  #warn(message) {
    try {
      this.#logger?.warn?.(PLUGIN_NAME + "：" + message);
    } catch {
      /* 日志不可用时静默 */
    }
  }

  #warnOnce(message) {
    if (this.#loggedError === message) return;
    this.#loggedError = message;
    this.#warn(message);
  }
}
