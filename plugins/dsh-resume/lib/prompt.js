/**
 * dsh-resume — 续跑指令与摘要文案。
 *
 * 设计原则（抄 Codex 的精华，丢掉它的缺陷）：
 *  - 不重放上一条用户消息（那会重复已经成功的工具调用）；
 *  - 把"中断在哪、为什么、还剩什么"作为事实写进模型上下文；
 *  - 三条护栏：先核实现场、不重做已完成、半途操作要显式对账。
 *
 * 纯函数，可单测。
 *
 * @module dsh-resume/prompt
 */

/** 折叠行摘要的硬上限（与 dsh-llm 的 CONTEXT_SUMMARY_MAX_CHARS 对齐）。 */
export const SUMMARY_MAX_CHARS = 120;

const MAX_MODEL_CHARS = 12000;

/** 原因码 → 一句话原因。 */
const CAUSE_TEXT = Object.freeze({
  zh: {
    RATE_LIMIT: '上游限流（429）',
    ACCOUNT_QUOTA: '账户额度或余额不足',
    TIMEOUT: '请求超时',
    PROCESS_EXIT: 'DSH 进程在这一轮结束前退出',
    USER_STOP: '用户手动停止',
    PARENT_STOP: '父会话中断了它',
    HOOK_STOP: '插件中断了它',
    PLUGIN_UNLOAD: '插件卸载导致中断',
    LEGACY_ABORT: '这一轮被中断',
    MAX_TOKENS: '输出达到长度上限被截断',
    TRUNCATED: '回复被截断',
    LEFTOVER_WORK: '上一轮已结束，但仍有未完成的工作',
    BLOCKED: '这一步被插件拒绝',
    DEFAULT: '上一轮异常中断',
  },
  en: {
    RATE_LIMIT: 'upstream rate limit (429)',
    ACCOUNT_QUOTA: 'account quota or balance exhausted',
    TIMEOUT: 'the request timed out',
    PROCESS_EXIT: 'the DSH process exited before the turn finished',
    USER_STOP: 'the user stopped the turn',
    PARENT_STOP: 'the parent session interrupted it',
    HOOK_STOP: 'a plugin interrupted it',
    PLUGIN_UNLOAD: 'a plugin unload interrupted it',
    LEGACY_ABORT: 'the turn was interrupted',
    MAX_TOKENS: 'the reply hit the output token cap',
    TRUNCATED: 'the reply was cut off',
    LEFTOVER_WORK: 'the turn ended while work remained',
    BLOCKED: 'a plugin rejected the step',
    DEFAULT: 'the previous turn ended abnormally',
  },
});

/** @returns {'zh'|'en'} */
export function normalizeLanguage(language, fallbackLocale) {
  if (language === 'zh' || language === 'en') return language;
  const source = typeof fallbackLocale === 'string' ? fallbackLocale.toLowerCase() : '';
  return source.startsWith('zh') ? 'zh' : 'en';
}

/** 一句话原因（不含上游原文）。 */
export function causeText(code, language) {
  const table = CAUSE_TEXT[language] ?? CAUSE_TEXT.en;
  return table[code] ?? table.DEFAULT;
}

/** 折叠行的一行摘要（≤120 字符）。 */
export function continuationSummary(state, language) {
  const zh = language === 'zh';
  const parts = [causeText(state.code, language)];
  if (state.turn !== null && state.turn !== undefined) parts.push(zh ? `第 ${state.turn} 轮` : `turn ${state.turn}`);
  const todos = state.remaining && state.remaining.todos;
  if (todos && todos.open > 0) parts.push(zh ? `待办 ${todos.open} 项未完成` : `${todos.open} todos left`);
  else {
    const goal = state.remaining && state.remaining.goal;
    if (goal && goal.active) parts.push(zh ? '目标进行中' : 'goal active');
    else if (state.remaining && state.remaining.jobs > 0) parts.push(zh ? `${state.remaining.jobs} 个后台任务` : `${state.remaining.jobs} jobs running`);
  }
  let summary = parts.join(' · ');
  if (summary.length > SUMMARY_MAX_CHARS) summary = `${summary.slice(0, SUMMARY_MAX_CHARS - 1)}…`;
  return summary;
}

/** 「剩余工作」的几行事实；没有就整行省略（宁缺勿编）。 */
export function remainingLines(state, language) {
  const zh = language === 'zh';
  const lines = [];
  const remaining = state.remaining ?? {};
  const todos = remaining.todos;
  if (todos && todos.total > 0) {
    lines.push(
      zh
        ? `- 待办：${todos.pending} 项待处理、${todos.inProgress} 项进行中、${todos.done} 项已完成（共 ${todos.total} 项）`
        : `- Todos: ${todos.pending} pending, ${todos.inProgress} in progress, ${todos.done} done (of ${todos.total}).`,
    );
  }
  const goal = remaining.goal;
  if (goal && goal.active) {
    const round = goal.maxGoalRounds ? `${goal.roundsStarted}/${goal.maxGoalRounds}` : String(goal.roundsStarted);
    const objective = goal.objective ? ` — ${JSON.stringify(goal.objective)}` : '';
    lines.push(zh ? `- 目标：进行中（第 ${round} 轮）${objective}` : `- Goal: active (round ${round})${objective}`);
  }
  if (remaining.jobs > 0) {
    lines.push(zh ? `- 后台任务：${remaining.jobs} 个仍未结束` : `- Background jobs: ${remaining.jobs} still registered.`);
  }
  return lines;
}

/**
 * 续跑指令。模型看到的就是这段（转录里默认折叠）。
 *
 * @param {object} state `inspectSession()` 的产出
 * @param {object} [options]
 * @param {'zh'|'en'} [options.language]
 * @param {number} [options.maxChars]
 * @returns {string}
 */
export function continuationPrompt(state, options = {}) {
  const language = normalizeLanguage(options.language, undefined);
  const zh = language === 'zh';
  const maxChars = Math.max(200, Math.min(Number(options.maxChars) || 1200, MAX_MODEL_CHARS));

  const cause = causeText(state.code, language);
  const rawMessage = state.reason && typeof state.reason.message === 'string' ? state.reason.message.trim() : '';
  const where = state.turn === null || state.turn === undefined
    ? ''
    : zh
      ? `第 ${state.turn} 轮${state.step ? `、第 ${state.step} 步` : ''}`
      : `turn ${state.turn}${state.step ? `, step ${state.step}` : ''}`;

  const head = zh
    ? [
        '<resume_after_interruption>',
        '状态：上一轮被中断，并未完成。',
        where ? `中断位置：${where}。` : null,
        `中断原因：${cause}${rawMessage ? ` —— ${JSON.stringify(rawMessage)}` : ''}`,
      ]
    : [
        '<resume_after_interruption>',
        'Status: the previous turn was interrupted before it finished.',
        where ? `Interrupted at: ${where}.` : null,
        `Cause: ${cause}${rawMessage ? ` — ${JSON.stringify(rawMessage)}` : ''}`,
      ];

  const facts = remainingLines(state, language);
  const rules = zh
    ? [
        '继续规则：',
        '1. 以当前工作区、工具输出和会话里的持久状态为准；先核实，不要把之前的叙述当成现状。',
        '2. 不要重做已经完成的工作。任何有副作用的动作（写文件、跑命令、发消息、起子智能体、调外部接口）在执行或重复执行前，先确认它是否已经生效。',
        '3. 中断时正在进行的操作可能只执行了一半，先显式核对再继续。',
        '4. 一直做到最初的要求被满足为止；结束后验证结果，并简要汇报你改了什么、验证了什么。',
        '如果确实无法继续（例如缺凭据、或同样的错误持续存在），停下来并明确说明卡在哪里。',
        '</resume_after_interruption>',
      ]
    : [
        'Resume rules:',
        '1. The current workspace, tool results, and durable session state are the only authority. Re-read what matters; do not treat earlier narration as current.',
        '2. Do not redo completed work. Before running or repeating any side-effecting action (file writes, shell commands, messages, subagents, external calls), verify whether it already took effect.',
        '3. Work that was interrupted mid-action may be partially applied; reconcile it explicitly before continuing.',
        '4. Continue until the original request is satisfied, then verify the result and report concisely what changed and what you checked.',
        'If continuing is genuinely impossible (a missing credential, or the same error persisting), stop and state exactly what blocks you.',
        '</resume_after_interruption>',
      ];

  const lines = [...head.filter((line) => typeof line === 'string' && line !== ''), ...facts, ...rules];
  let text = lines.join('\n');
  if (text.length > maxChars) {
    // 超长时只压缩事实行与原文引述，护栏完整保留。
    const fallback = [...head.slice(0, 2), zh ? '中断原因：见上一轮的错误信息。' : 'Cause: see the error reported in the previous turn.', ...rules].join('\n');
    text = fallback.length <= maxChars ? fallback : fallback.slice(0, maxChars);
  }
  return text;
}
