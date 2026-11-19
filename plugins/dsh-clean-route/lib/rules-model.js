/**
 * 规则模型：设置页用的 JSON 形态 ⇄ 规则对象 ⇄ YAML 文本。
 *
 * 设置页表单编辑的是 `model`（好用的扁平形态），随手的 YAML 编辑走原文直写；
 * 两种入口都落到同一个文件，不让「谁是真源」出现歧义。
 *
 * @module dsh-clean-route/rules-model
 */

import { stringify } from "yaml";
import { DEFAULT_RULES, parseRules } from "./config.js";

/** 把规则对象摊平成设置页表单用的模型。 */
export function toModel(rules) {
  return {
    routes: (rules.routes ?? []).map((route) => ({ provider: route.provider, model: route.model ?? "" })),
    dropSections: [...(rules.sections?.drop ?? [])],
    replaceSections: Object.entries(rules.sections?.replace ?? {}).map(([name, text]) => ({ name, text })),
    appendSections: (rules.sections?.append ?? []).map((entry) => ({ name: entry.name, text: entry.text })),
    dropContexts: [...(rules.contexts?.drop ?? [])],
    carrierPath: rules.carrier ?? "",
    textRules: (rules.textRules ?? []).map((rule) => ({
      pattern: rule.pattern,
      replacement: rule.replacement,
      regex: rule.regex === true,
      flags: rule.flags ?? "",
    })),
  };
}

/** 表单模型 → 规则对象（交给 parseRules 校验前的原始形态）。 */
export function fromModel(model) {
  const routes = (model.routes ?? [])
    .map((route) => ({ provider: String(route.provider ?? "").trim(), model: String(route.model ?? "").trim() }))
    .filter((route) => route.provider.length > 0)
    .map((route) => (route.model.length > 0 ? route : { provider: route.provider }));
  const replace = {};
  for (const entry of model.replaceSections ?? []) {
    const name = String(entry.name ?? "").trim();
    if (name.length > 0) replace[name] = String(entry.text ?? "");
  }
  const append = (model.appendSections ?? [])
    .map((entry) => ({ name: String(entry.name ?? "").trim(), text: String(entry.text ?? "") }))
    .filter((entry) => entry.text.length > 0)
    .map((entry) => (entry.name.length > 0 ? entry : { text: entry.text }));
  const textRules = (model.textRules ?? [])
    .map((rule) => ({
      pattern: String(rule.pattern ?? ""),
      replacement: String(rule.replacement ?? ""),
      ...(rule.regex === true ? { regex: true } : {}),
      ...(rule.regex === true && String(rule.flags ?? "").length > 0 ? { flags: String(rule.flags) } : {}),
    }))
    .filter((rule) => rule.pattern.length > 0);

  return {
    version: 1,
    routes,
    sections: { drop: model.dropSections ?? [], replace, append },
    contexts: { drop: model.dropContexts ?? [] },
    carrier: String(model.carrierPath ?? "").trim().length > 0 ? String(model.carrierPath).trim() : null,
    textRules,
  };
}

const HEADER = `# dsh-clean-route 规则表
#
# 由设置页（设置 → 插件 → clean-route）或手改维护，改完即生效。
# 设置页保存会重写本文件的注释头；在「高级（YAML）」里直接编辑可保留你自己的注释。
`;

/** 规则对象 → YAML 文本（带标准注释头）。 */
export function toYaml(rules) {
  return HEADER + "\n" + stringify(rules, { lineWidth: 0 });
}

/** 表单模型 → YAML 文本；先过一遍校验，非法就抛错（不写盘）。 */
export function modelToYaml(model) {
  const { rules, warnings } = parseRules(toYaml(fromModel(model)));
  return { yaml: toYaml(rules), rules, warnings };
}

/** 默认模型的 YAML（给「恢复默认」按钮用）。 */
export function defaultYaml() {
  return toYaml(DEFAULT_RULES);
}
