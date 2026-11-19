/**
 * 净化引擎：把一条组装好的系统提示词按规则改写。纯函数，不碰 IO。
 *
 * 设计要点：
 *  - 只对「净化路由」生效；其它路由原样返回，连对象都不重建；
 *  - section / context 都按名字剔，不按文本猜；
 *  - textRules 在 section 文本上按顺序应用（section 之间用空行连接，跨段的规则请拆成两条）；
 *  - 任何一步出错都由调用方退回原 assembly —— prompt 路径不允许抛错。
 *
 * @module dsh-clean-route/scrub
 */

/** 替换文本里出现 {{ 时会被 renderPrompt 当成插值；命中就钉成字面量。 */
const INTERPOLATION_MARK = "{{";

/**
 * @param {object} assembly 组装结果 { sections, contexts, variables }
 * @param {object|undefined} context 组装上下文（含 modelSelection）
 * @param {object} compiled compileRules() 的产物
 * @returns {{ applied: boolean, assembly: object, hits: object }}
 */
export function scrubAssembly(assembly, context, compiled) {
  const hits = {
    droppedSections: [],
    replacedSections: [],
    droppedContexts: [],
    textRuleHits: [],
    carrierApplied: false,
    appendedSections: [],
  };
  const selection = context?.modelSelection;
  if (selection === undefined || selection === null) return { applied: false, assembly, hits };
  if (!compiled.match(selection.provider, selection.model)) return { applied: false, assembly, hits };

  const sections = [];
  if (compiled.carrierText !== null) {
    hits.carrierApplied = true;
    sections.push({ name: "clean-route:carrier", text: compiled.carrierText, interpolate: false });
  } else {
    for (const section of assembly.sections) {
      if (compiled.dropSections.has(section.name)) {
        hits.droppedSections.push(section.name);
        continue;
      }
      let text = section.text;
      let interpolate = section.interpolate;
      if (compiled.replaceSections.has(section.name)) {
        text = compiled.replaceSections.get(section.name);
        interpolate = false;
        hits.replacedSections.push(section.name);
      }
      const scrubbed = applyTextRules(text, compiled.textRules, hits.textRuleHits);
      if (scrubbed !== text) {
        text = scrubbed;
        if (interpolate !== false && text.includes(INTERPOLATION_MARK)) interpolate = false;
      }
      const unchanged = text === section.text && interpolate === section.interpolate;
      sections.push(unchanged ? section : { ...section, text, ...(interpolate === undefined ? {} : { interpolate }) });
    }
  }

  for (const entry of compiled.appendSections) {
    sections.push({ name: entry.name, text: entry.text, interpolate: false });
    hits.appendedSections.push(entry.name);
  }

  const contexts = [];
  for (const entry of assembly.contexts) {
    if (compiled.dropContexts.has(entry.name)) {
      hits.droppedContexts.push(entry.name);
      continue;
    }
    contexts.push(entry);
  }

  return { applied: true, assembly: { ...assembly, sections, contexts }, hits };
}

/** 按顺序应用文本规则，并累加命中计数（供设置页展示）。 */
function applyTextRules(text, rules, hitLog) {
  let current = text;
  for (const rule of rules) {
    const next = rule.regex === null || rule.regex === undefined
      ? current.split(rule.pattern).join(rule.replacement)
      : current.replace(rule.regex, rule.replacement);
    if (next === current) continue;
    rule.count += 1;
    hitLog.push({ pattern: rule.pattern, regex: rule.regex !== null && rule.regex !== undefined });
    current = next;
  }
  return current;
}

/** 渲染后的 system 文本（与 renderPrompt 的 join 语义一致）。 */
export function renderScrubbedSections(sections) {
  return sections
    .map((section) => section.text)
    .filter((text) => typeof text === "string" && text.length > 0)
    .join("\n\n");
}
