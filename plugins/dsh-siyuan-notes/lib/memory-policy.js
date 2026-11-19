import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export class MemoryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const memoryFailure = error => ({ ok: false, error: { code: error?.code || 'memory_unavailable', message: error?.message || String(error) } });
// 思源 kramdown 会在内联代码旁加入不可见分隔符，SQL 导出不会；正文、版本与指纹共用此规范化。
export const readableMemory = text => String(text ?? '').replace(/[\u200b\ufeff]/gu, '').replace(/<br\s*\/?>/giu, '\n').replace(/\r\n?/gu, '\n').replace(/\n?\{:[^\n]*\}\s*$/u, '').trim();
export const scopePath = value => {
  const text = String(value ?? '').replaceAll('\\', '/').replace(/\/$/u, '');
  return /^[a-z]:\//iu.test(text) ? text.toLowerCase() : text;
};
export const canonicalTopic = value => String(value ?? '').trim().toLowerCase().replace(/[ _\t-]+/gu, '-');
export const memoryTopicId = entry => entry.topicId || 'topic-' + createHash('sha256').update(JSON.stringify([
  scopePath(entry.workspace), entry.project, canonicalTopic(entry.topic),
])).digest('hex').slice(0, 24);
export const memoryRevision = entry => createHash('sha256').update(JSON.stringify([
  readableMemory(entry.body), entry.type, entry.project, entry.workspace ?? '', entry.topic ?? '',
  entry.status, entry.confidence, entry.supersedes ?? '', entry.supersededBy ?? '',
  entry.source ?? '', entry.evidence ?? '', entry.approvalHash ?? '', entry.approvedAt ?? '', entry.approvedBy ?? '',
  entry.proposedSupersedes ?? '',
  entry.topicId ?? '',
])).digest('hex');
// 确认绑定语义内容、依据和适用范围；撤销/取代等历史状态变动不抹去这次确认。
export const memoryApprovalHash = entry => createHash('sha256').update(JSON.stringify([
  readableMemory(entry.body), entry.type, entry.project, entry.workspace ?? '', entry.topic ?? '',
  entry.confidence, entry.source ?? '', entry.evidence ?? '',
  entry.topicId ?? '',
])).digest('hex');
export const MEMORY_REVIEW_DAYS = Object.freeze({ state: 30, fact: 90, decision: 180, preference: 365 });
// 2026-11-11：复核不再是「能不能用」的条件。历史条目一律照常有效，不再因为没有确认哈希
// 被踢出常驻注入；时间衰减也只作体检报告里的信息，不再把条目打回待复核。
export function assessMemory(entry, now = Date.now()) {
  const trust = !entry.approvalHash ? 'legacy' : entry.approvalHash === memoryApprovalHash(entry) ? 'confirmed' : 'changed';
  const stamp = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u.exec(entry.approvedAt || entry.created || '');
  const markedAt = stamp ? new Date(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]).getTime() : NaN;
  const days = MEMORY_REVIEW_DAYS[entry.type] ?? 30;
  const stale = Number.isFinite(markedAt) && now - markedAt >= days * 86_400_000;
  return { trust, stale, reviewRequired: false, reviewReason: '', reviewAfterDays: days };
}
export const memoryFingerprint = entry => createHash('sha256').update(JSON.stringify([
  entry.workspace, entry.project, entry.topic, entry.type, readableMemory(entry.body).normalize('NFKC').replace(/\s+/gu, ' '),
])).digest('hex');

// 只拦截有明确结构的凭据，不能宣称能识别全部敏感信息。
export function hasCredential(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}|(?:api[_ -]?key|access[_ -]?token|password|密码|密钥)\s*[:=：]\s*["']?[A-Za-z0-9_\-/.+=]{12,}/iu.test(String(text));
}
// 「不记录」只认明确指向本次对话或记忆体的说法。开发中常见的「不要记住密码」「别保存 cookie」
// 「这个函数别记忆化」「I don't remember…」都不是对记忆功能的指令，误判一次整场会话就不再记录。
const NEG = '(?:不要|别|禁止|不许|不准|不用|无需)';
const CONV = '(?:对话|会话|聊天|讨论|交流|谈话)';
const THIS = '(?:这段|这次|这轮|这场|这个|本次|本轮|本|当前|我们的|刚才的|以上|上面的?)';
const SAVE = '(?:记住|记下|记录|保存|存储|记忆|记)';
const END = '\\s*(?:了|吧|哦|啊)?\\s*(?:$|[，。！？!?,.;；\\n])';
const OPT_OUT_PATTERNS = [
  // 不要记录这次对话 / 别保存聊天内容（后面不能再跟「到日志」「cookie」这类别的对象）
  new RegExp(NEG + '(?:再)?' + SAVE + '(?:下来)?' + THIS + '?(?:的)?' + CONV + '(?:(?:的)?(?:任何|所有|全部)?(?:内容|记录|东西|信息))?' + END, 'iu'),
  // 这次对话不要记录
  new RegExp(THIS + CONV + '(?:的?内容)?[^。！？\\n，,]{0,6}' + NEG + '(?:再)?' + SAVE + '(?:下来)?' + END, 'iu'),
  // 这段不要记录（只认「记」类动词；「这次不要保存」多半在说文件）
  new RegExp('(?:这段|这次|这轮|这场|本次|本轮)(?:的?(?:内容|话))?' + NEG + '(?:再)?(?:记住|记下来?|记录|记忆|记)' + END, 'iu'),
  // 不要把这个写进记忆体
  new RegExp(NEG + '(?:把|将)[^。！？\\n]{0,24}(?:写入|存入|记入|放进|加入|记到|存到|写进|存进|记进|保存到|保存进|记录到|写到)(?:长期)?记忆(?:体|库)?', 'iu'),
  // 不要写记忆 / 别用长期记忆
  new RegExp(NEG + '(?:再)?(?:写入?|使用|用|更新|调用|动|开启|启用)?(?:长期)?记忆(?:体|库|功能)?' + END, 'iu'),
  // 整句只有「别记」「这个不要记住」
  new RegExp('^\\s*(?:这个|这些|这条|这句)?' + NEG + '(?:再)?(?:记住|记下来?|记)(?:了|它|这个|这些|这条)?\\s*[。！!.]*\\s*$', 'iu'),
  /(?<!\b(?:i|we|you|they|it)\s)\b(?:do not|don't|never)\s+(?:remember|memorize|store|save|record|keep)\s+(?:this|that|our|the|any of this)\s+(?:conversation|chat|session|discussion)\b/iu,
  /(?<!\b(?:i|we|you|they|it)\s)\b(?:do not|don't|never)\s+(?:remember|memorize)\s+(?:this|that|any of this|it)\s*(?:$|[.,!;\n])/iu,
  /\b(?:do not|don't|never)\s+(?:write|save|add|store|put)\s+(?:this|that|it|anything)\s+(?:to|in|into)\s+(?:your\s+|the\s+)?(?:long[- ]term\s+)?memory\b/iu,
];
/** 返回触发「不记录」的用户消息原文；面板恢复记录时用它来忽略这些话。 */
export function optOutMessages(messages) {
  const matched = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== 'user' || message.source?.kind === 'runtime-context') continue;
    const text = (Array.isArray(message.content) ? message.content : []).filter(part => part?.type === 'text').map(part => part.text).join('\n');
    if (OPT_OUT_PATTERNS.some(pattern => pattern.test(text))) matched.push(text);
  }
  return matched;
}
export function memoryOptOut(messages, ignored) {
  return optOutMessages(messages).some(text => !ignored?.has(text));
}
export function applicableMemory(entry, scope) {
  if (entry.project === '*' && (!entry.workspace || entry.workspace === '*')) return true;
  if (!scope || !entry.workspace) return false;
  if (entry.project === '*') return scopePath(entry.workspace) === scopePath(scope.workspace);
  const root = scope.projectRoots?.[entry.project];
  return Boolean(root && scopePath(root) === scopePath(entry.workspace) &&
    (scope.project === '*' || scope.project === entry.project));
}

export function validateMemory(input, { maxChars = 4000 } = {}) {
  const type = input?.type;
  if (!['preference', 'fact', 'decision', 'state'].includes(type)) throw new MemoryError('invalid_type', 'type 必须是 preference / fact / decision / state');
  let body = readableMemory(input.body ?? input.text ?? input.statement);
  if (type === 'state') body = body.replace(/^[ \t]*[-*•][ \t]*(下一步|待决)[ \t]*[:：][ \t]*(\S[^\n]*)$/gmu, '- $1：$2');
  if (!body) throw new MemoryError('empty_statement', '正文第一行（一句话结论）不能为空');
  if (body.length > maxChars) throw new MemoryError('body_too_long', `正文最多 ${maxChars} 个字符，请先精简`);
  if (hasCredential(body)) throw new MemoryError('sensitive_content', '正文包含疑似凭据，不能写入长期记忆');
  if (input.recordingDisabled) throw new MemoryError('recording_disabled', '当前会话已设置不记录记忆');
  const project = String(input.project ?? input.scope?.project ?? '*').trim() || '*';
  const projects = input.scope?.projects ?? input.allowedProjects;
  if (project.length > 200 || /[\r\n\0]/u.test(project) || (Array.isArray(projects) && !projects.includes(project))) throw new MemoryError('invalid_project', '项目不在当前工作区的真实项目列表中' + (Array.isArray(projects) ? '；可选：' + projects.join('、') : ''));
  // 默认按「用户明确表达」处理：写入即生效。模型自己的猜测必须显式传 inferred，
  // 否则每条随手写入都会变成候选，等于把记忆系统变成待办清单。
  const confidence = input.confidence ?? 'stated';
  if (!['verified', 'stated', 'inferred'].includes(confidence)) throw new MemoryError('invalid_confidence', '可信度必须是 verified / stated / inferred');
  const source = String(input.source ?? '').trim();
  if (!source || source.length > 300) throw new MemoryError('invalid_source', '必须提供不超过 300 字的记忆来源');
  const evidence = String(input.evidence ?? '').trim();
  if (confidence === 'verified' && !evidence) throw new MemoryError('missing_evidence', '已核实记忆必须填写 evidence：代码位置或验证结果');
  if (evidence.length > 800 || hasCredential(evidence) || hasCredential(source)) throw new MemoryError('invalid_evidence', '来源或依据过长，或包含疑似凭据');
  const topic = canonicalTopic(input.topic);
  if (topic.length > 120 || /[\r\n\0]/u.test(topic)) throw new MemoryError('invalid_topic', '任务主题必须是单行且不超过 120 字');
  if (type === 'state' && (!topic || !/^.+\n[\s\S]*^- 下一步：\S.*/mu.test(body) || !/^- 待决：\S.*/mu.test(body))) {
    throw new MemoryError('invalid_state', '状态必须指定 topic，并包含结论、- 下一步：和- 待决：三段非空内容');
  }
  const workspace = project === '*' ? (input.global === true ? '*' : scopePath(input.scope?.workspace || input.workspace || 'unassigned')) :
    scopePath(input.scope?.projectRoots?.[project] ?? input.workspace ?? '');
  const status = confidence === 'inferred' || input.status === 'candidate' ? 'candidate' : 'active';
  const entry = { type, body, statement: body.split('\n')[0].slice(0, 200), project, workspace, topic, confidence, source, evidence, status };
  if (type === 'state') entry.topicId = memoryTopicId({ ...entry, topicId: input.topicId });
  return entry;
}

/** 用真实项目根目录定位项目；源码子目录不会被误当作独立项目。 */
export async function resolveMemoryScope(cwd) {
  const fallback = { workspace: '', project: '*', projects: ['*'], projectRoots: {} };
  if (typeof cwd !== 'string' || !cwd.trim()) return fallback;
  let root;
  try { root = await fs.realpath(cwd); if (!(await fs.stat(root)).isDirectory()) return fallback; } catch { return fallback; }
  const isProject = async dir => {
    for (const marker of ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
      try { await fs.stat(path.join(dir, marker)); return true; } catch {}
    }
    return false;
  };
  let projectRoot = root;
  while (!(await isProject(projectRoot))) {
    const parent = path.dirname(projectRoot);
    if (parent === projectRoot) { projectRoot = null; break; }
    projectRoot = parent;
  }
  if (projectRoot) {
    const name = path.basename(projectRoot);
    return { workspace: scopePath(projectRoot), project: name, projects: ['*', name], projectRoots: { [name]: scopePath(projectRoot) } };
  }
  const projectRoots = {};
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const dir = path.join(root, entry.name);
    if (await isProject(dir)) projectRoots[entry.name] = scopePath(await fs.realpath(dir));
  }
  return { workspace: scopePath(root), project: '*', projects: ['*', ...Object.keys(projectRoots)], projectRoots };
}
