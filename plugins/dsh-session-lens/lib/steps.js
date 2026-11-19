/**
 * 步（step）寻址。
 *
 * 为什么是步：DSH 的一次模型调用 + 它触发的工具批次就是一个 `step`，它是日志里唯一
 * 既**足够细**（cz 中位数 97 步/会话，最大 1034）、又**机械无歧义**（`step/start` 事件
 * 自带 seq）的边界。
 *
 * 为什么不是轮次：turn 是 agent 处理周期，不是人提问的单位。实测 cz 48 个会话共 212 轮
 * 却跑了 7,174 步（单会话最多 1,034 步），dh 9 个会话全部只有 1 轮——按轮切等于没有导航。
 *
 * 为什么不是“人类消息分段”：人类消息中位数只有 1 条每会话（注入的 runtime-context、
 * skill-catalog 等 user 角色消息不是人说的），同样切不开。
 *
 * 轮次仍然保留，但只用于**大纲的显示分组**，不参与寻址。
 *
 * @module dsh-session-lens/steps
 */

/**
 * 取出所有步起点 seq，升序。
 * @param {readonly {type: string, seq: number}[]} records `listEvents` 记录。
 * @returns {number[]} 每步起始 seq。
 */
export function stepStartSeqs(records) {
  const starts = [];
  for (const record of records) {
    if (record.type === "step/start") starts.push(record.seq);
  }
  return starts.sort((left, right) => left - right);
}

/**
 * 取出所有轮次起点 seq，升序（只用于显示分组）。
 * @param {readonly {type: string, seq: number}[]} records `listEvents` 记录。
 * @returns {number[]} 每轮起始 seq。
 */
export function turnStartSeqs(records) {
  const starts = [];
  for (const record of records) {
    if (record.type === "turn/start") starts.push(record.seq);
  }
  return starts.sort((left, right) => left - right);
}

/**
 * 判断一个 seq 落在第几步。第一个 `step/start` 之前的一切归 s0（prologue）。
 * @param {readonly number[]} starts `stepStartSeqs` 的结果。
 * @param {number} seq 事件 seq。
 * @returns {number} 步号；0 表示 prologue。
 */
export function stepOfSeq(starts, seq) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (starts[mid] <= seq) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * 同上，用于轮次。
 * @param {readonly number[]} starts `turnStartSeqs` 的结果。
 * @param {number} seq 事件 seq。
 * @returns {number} 轮次号；0 表示 prologue。
 */
export function turnOfSeq(starts, seq) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (starts[mid] <= seq) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * 把“第 from 步…第 to 步”换算成闭区间 seq 窗口。`from: 0` 表示把 prologue 一起读。
 * @param {readonly number[]} starts `stepStartSeqs` 的结果。
 * @param {number} lastSeq 日志里最后一个 seq。
 * @param {number} from 起始步号（0 表示含 prologue）。
 * @param {number} to 结束步号（含）。
 * @returns {{lowSeq: number, highSeq: number, from: number, to: number, total: number}} 闭区间窗口。
 */
export function stepWindow(starts, lastSeq, from, to) {
  const total = starts.length;
  const first = Math.max(0, Math.min(total, from));
  const last = Math.max(first, Math.min(total, to));
  if (total === 0) return { lowSeq: 0, highSeq: lastSeq, from: 0, to: 0, total: 0 };
  const lowSeq = first === 0 ? 0 : starts[first - 1];
  const highSeq = last >= total ? lastSeq : starts[last] - 1;
  return { lowSeq, highSeq, from: first, to: last, total };
}

/**
 * 日志里最大的 seq；空日志返回 0。
 * @param {readonly {seq: number}[]} events 事件。
 * @returns {number} 最大 seq。
 */
export function lastSeqOf(events) {
  let last = 0;
  for (const event of events) {
    if (event.seq > last) last = event.seq;
  }
  return last;
}

/**
 * 步标签。prologue 用 `s0`。
 * @param {number} step 步号。
 * @returns {string} 形如 `s40` 的标签。
 */
export function stepLabel(step) {
  return `s${step}`;
}

/**
 * 步的显示区间，例如 `s40`、`s40–52`。
 * @param {number} from 起始步号。
 * @param {number} to 结束步号。
 * @returns {string} 区间标签。
 */
export function stepSpan(from, to) {
  return from === to ? stepLabel(from) : `${stepLabel(from)}–${to}`;
}

/**
 * 轮次标签（仅显示用）。
 * @param {number} turn 轮次号。
 * @returns {string} 形如 `t3` 的标签。
 */
export function turnLabel(turn) {
  return `t${turn}`;
}
