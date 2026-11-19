/**
 * dsh-resume — 会话中断状态的纯折叠。
 *
 * 只读会话日志（`SessionEvent[]`），产出"这一轮是不是被中断了、为什么、还剩什么活"。
 * 这里不碰任何 Cordis 服务，方便直接单测：`node --test test/`。
 *
 * 判据来自 `TurnEndReasonMap`（dsh-agent）：
 *   completed | aborted{reason} | blocked | error{error} | max-tokens | interrupted | forked
 *
 * @module dsh-resume/state
 */

/** 一次折叠的产出结构版本；字段变了就 +1（客户端会据此丢弃旧形状）。 */
export const STATE_VERSION = 1;

/** 默认"值得给一个 ▶"的终止原因。`blocked` 不在内：预检拒绝，继续会被同一个插件再拒一次。 */
export const DEFAULT_ELIGIBLE_REASONS = Object.freeze(['error', 'aborted', 'interrupted', 'max-tokens']);

/** `aborted.reason.kind` → 稳定的原因码。 */
const ABORT_CODES = Object.freeze({
  user: 'USER_STOP',
  parent: 'PARENT_STOP',
  hook: 'HOOK_STOP',
  disposed: 'PLUGIN_UNLOAD',
  legacy: 'LEGACY_ABORT',
});

/** 折叠窗口上限：超大会话也只从尾部读这么多事件（中断状态永远在尾部附近）。 */
const DEFAULT_TAIL_LIMIT = 8000;

/** @returns {number} 正的整数，或回退值。 */
function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 截断长文本，避免把 20KB 的上游错误塞进状态里。 */
export function truncate(text, max) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * 把 `turn/end.reason` 归一成 `{ code, detail, message, cause }`。
 * @param {object|null} reason
 * @param {number} messageLimit
 */
export function classifyReason(reason, messageLimit = 400) {
  if (reason === null || typeof reason !== 'object') {
    return { kind: null, code: null, message: null, cause: null };
  }
  switch (reason.kind) {
    case 'error': {
      const error = reason.error ?? {};
      return {
        kind: 'error',
        code: typeof error.code === 'string' && error.code !== '' ? error.code : 'LLM_ERROR',
        message: typeof error.message === 'string' ? truncate(error.message, messageLimit) : null,
        cause: null,
        status: typeof error.status === 'number' ? error.status : undefined,
      };
    }
    case 'aborted': {
      const cause = reason.reason ?? {};
      return {
        kind: 'aborted',
        code: ABORT_CODES[cause.kind] ?? 'ABORTED',
        message: typeof cause.reason === 'string' ? truncate(cause.reason, messageLimit) : null,
        cause: typeof cause.kind === 'string' ? cause.kind : null,
      };
    }
    case 'interrupted':
      return { kind: 'interrupted', code: 'PROCESS_EXIT', message: null, cause: null };
    case 'max-tokens':
      return { kind: 'max-tokens', code: 'MAX_TOKENS', message: null, cause: null };
    case 'blocked':
      return { kind: 'blocked', code: 'BLOCKED', message: null, cause: null };
    case 'forked':
      return { kind: 'forked', code: 'FORKED', message: null, cause: null };
    case 'completed':
      return { kind: 'completed', code: null, message: null, cause: null };
    default:
      return { kind: typeof reason.kind === 'string' ? reason.kind : 'unknown', code: 'UNKNOWN', message: null, cause: null };
  }
}

/** 统计一份 todo 列表。 */
export function summarizeTodos(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return null;
  let pending = 0;
  let inProgress = 0;
  let done = 0;
  for (const todo of todos) {
    const status = todo && typeof todo === 'object' ? todo.status : undefined;
    if (status === 'completed') done += 1;
    else if (status === 'in_progress') inProgress += 1;
    else pending += 1;
  }
  return { pending, inProgress, done, total: todos.length, open: pending + inProgress };
}

/** 从 `goal/change` 事件里取当前目标。 */
export function summarizeGoal(change) {
  const goal = change && typeof change === 'object' ? change.goal ?? change : null;
  if (goal === null || typeof goal !== 'object') return null;
  const phase = typeof goal.phase === 'string' ? goal.phase : 'active';
  return {
    phase,
    objective: typeof goal.objective === 'string' ? truncate(goal.objective, 200) : null,
    roundsStarted: Number.isFinite(Number(goal.roundsStarted)) ? Number(goal.roundsStarted) : 0,
    maxGoalRounds: Number.isFinite(Number(goal.maxGoalRounds)) ? Number(goal.maxGoalRounds) : null,
    active: phase === 'active',
  };
}

/**
 * 折叠一段会话事件。
 *
 * @param {readonly object[]} events 会话事件（`{type, seq, time, data}`）
 * @param {object} [options]
 * @param {readonly string[]} [options.eligibleReasons] 视为"中断"的终止原因
 * @param {readonly string[]} [options.ignoreErrorCodes] 永不给 ▶ 的错误码
 * @param {boolean} [options.includeCompleted] 正常结束但仍有未完成待办时也可继续
 * @param {number} [options.tailLimit] 最多回看多少条事件
 * @returns {object} 中断状态快照
 */
export function inspectSession(events, options = {}) {
  const eligibleReasons = new Set(options.eligibleReasons ?? DEFAULT_ELIGIBLE_REASONS);
  const ignoreErrorCodes = new Set(options.ignoreErrorCodes ?? []);
  const includeCompleted = options.includeCompleted === true;
  const tailLimit = positiveInt(options.tailLimit, DEFAULT_TAIL_LIMIT);
  const messageLimit = positiveInt(options.messageLimit, 400);

  const list = Array.isArray(events) ? events : [];
  const from = Math.max(0, list.length - tailLimit);

  let lastTurnStart = null;
  let lastTurnEnd = null;
  let lastAssistant = null;
  let lastTodoWrite = null;
  let lastGoalChange = null;
  let lastStep = null;
  const openJobs = new Set();

  for (let i = from; i < list.length; i += 1) {
    const event = list[i];
    if (event === null || typeof event !== 'object') continue;
    const type = event.type;
    if (type === 'turn/start') {
      lastTurnStart = event;
      lastStep = null;
    } else if (type === 'turn/end') lastTurnEnd = event;
    else if (type === 'step/start') lastStep = event;
    else if (type === 'assistant/message') lastAssistant = event;
    else if (type === 'todo/write') lastTodoWrite = event;
    else if (type === 'goal/change') lastGoalChange = event;
    else if (type === 'job/registered') {
      const jobId = event.data && typeof event.data.jobId === 'string' ? event.data.jobId : null;
      if (jobId !== null) openJobs.add(jobId);
    } else if (type === 'job/settled') {
      const jobId = event.data && typeof event.data.jobId === 'string' ? event.data.jobId : null;
      if (jobId !== null) openJobs.delete(jobId);
    }
  }

  const remaining = {
    todos: lastTodoWrite ? summarizeTodos(lastTodoWrite.data && lastTodoWrite.data.todos) : null,
    goal: lastGoalChange ? summarizeGoal(lastGoalChange.data) : null,
    jobs: openJobs.size,
  };

  const base = {
    version: STATE_VERSION,
    turn: null,
    step: null,
    seq: null,
    at: null,
    reason: null,
    assistantInterrupted: false,
    remaining,
    eligible: false,
    code: null,
    open: false,
  };

  if (lastTurnStart === null && lastTurnEnd === null) {
    return { ...base, status: 'empty', detail: 'no-turn' };
  }

  // 尾部悬空：有 turn/start 但之后没有 turn/end（进程还没恢复到能补收尾）。
  const isOpen = lastTurnEnd === null || Number(lastTurnStart.seq) > Number(lastTurnEnd.seq);
  if (isOpen) {
    const turn = Number(lastTurnStart.data && lastTurnStart.data.turn);
    return {
      ...base,
      status: 'interrupted',
      turn: Number.isFinite(turn) ? turn : null,
      step: null,
      seq: Number(lastTurnStart.seq),
      at: Number(lastTurnStart.time),
      reason: { kind: 'interrupted', code: 'PROCESS_EXIT', message: null, cause: null },
      code: 'PROCESS_EXIT',
      open: true,
      eligible: !ignoreErrorCodes.has('PROCESS_EXIT'),
      detail: 'open-turn',
    };
  }

  const turnEnd = lastTurnEnd;
  const reason = classifyReason(turnEnd.data && turnEnd.data.reason, messageLimit);
  const assistantInterrupted = Boolean(lastAssistant && lastAssistant.data && lastAssistant.data.interrupted === true);
  const turn = Number(turnEnd.data && turnEnd.data.turn);
  const step = lastStep && Number(lastStep.data && lastStep.data.step) > 0 ? Number(lastStep.data.step) : null;

  let eligible = eligibleReasons.has(reason.kind);
  let code = reason.code;
  let status = eligible ? 'interrupted' : 'completed';

  // 流被截断（assistant/message.interrupted）但回合"正常"收尾：仍然算中断。
  if (!eligible && reason.kind === 'completed' && assistantInterrupted) {
    eligible = true;
    code = 'TRUNCATED';
    status = 'interrupted';
  }

  // 正常结束，但确实还有没干完的活：按配置也算可继续。
  if (!eligible && reason.kind === 'completed' && includeCompleted) {
    const leftover = (remaining.todos !== null && remaining.todos.open > 0) || (remaining.goal !== null && remaining.goal.active) || remaining.jobs > 0;
    if (leftover) {
      eligible = true;
      code = 'LEFTOVER_WORK';
      status = 'interrupted';
    }
  }

  if (code !== null && ignoreErrorCodes.has(code)) eligible = false;
  if (eligible === false) status = reason.kind === 'completed' ? 'completed' : 'idle';

  return {
    ...base,
    status,
    turn: Number.isFinite(turn) ? turn : null,
    step,
    seq: Number(turnEnd.seq),
    at: Number(turnEnd.time),
    reason,
    assistantInterrupted,
    eligible,
    code,
    detail: reason.kind,
  };
}

/** 一句话原因（给 tooltip / 提示用，不含语言）。 */
export function describeCode(code) {
  switch (code) {
    case 'RATE_LIMIT': return 'rate-limit';
    case 'ACCOUNT_QUOTA': return 'quota';
    case 'TIMEOUT': return 'timeout';
    case 'PROCESS_EXIT': return 'process-exit';
    case 'USER_STOP': return 'user-stop';
    case 'PARENT_STOP': return 'parent-stop';
    case 'PLUGIN_UNLOAD': return 'plugin-unload';
    case 'MAX_TOKENS': return 'max-tokens';
    case 'TRUNCATED': return 'truncated';
    case 'LEFTOVER_WORK': return 'leftover';
    default: return 'error';
  }
}
