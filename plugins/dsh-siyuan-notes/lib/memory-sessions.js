import { DISTILL_LIMITS, renderTranscript, runDistill } from './distill.js';
import { applicableMemory, memoryOptOut, optOutMessages, resolveMemoryScope } from './memory-policy.js';
import { recallLine } from './memory.js';
import { createHash } from 'node:crypto';

const statementOf = entry => String(entry?.statement || String(entry?.body ?? '').split('\n')[0] || '').trim();
const TYPE_LABELS = { preference: '偏好', fact: '事实', decision: '决策', state: '状态' };
/** 已在常驻索引里的命中，用这个标记与"新命中"区分。 */
const INDEX_MARK = '索引内';

/**
 * 「这条就在常驻索引里」的一行提示。
 *
 * 常驻索引里只有结论、没有 id，模型无法 memory_read；召回把"已经在索引里"的条目整块丢掉时，
 * 最强的那条就彻底消失了。这里只补一行 id + 60 字结论，回答"你要找的是哪一条"。
 */
const indexHintLine = entry => {
  const type = TYPE_LABELS[entry?.type] ?? String(entry?.type ?? '');
  const project = String(entry?.project ?? '').slice(0, 24);
  const statement = String(entry?.statement ?? '');
  return '- ' + String(entry?.id ?? '') + ' [' + type + '·' + project + ' · ' + INDEX_MARK + '] ' +
    statement.slice(0, 60) + (statement.length > 60 ? '…' : '');
};
const userText = message => (Array.isArray(message?.content) ? message.content : [])
  .filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n').trim();

/**
 * 宿主把上下文也塞成 role=user 的消息，它们不是人说的话。
 *
 * 实测（2026-11-11，真实宿主）：一个模型步骤里依次入栈 `user`(原话) / `runtime-context` /
 * `skill-catalog`(3.9k 字) / `time-context`(时间戳)。v5 只排除了 runtime-context，
 * 于是被动召回拿 time-context 当用户发言去查——每轮都返回同一组无关条目。
 */
const INJECTED_KINDS = new Set(['runtime-context', 'skill-catalog', 'time-context']);
/** kind 缺失时的内容兜底：这些开头只可能来自注入消息。 */
const INJECTED_PREFIXES = ['<system-reminder>', 'Current runtime context', 'Time sampled while preparing'];
/** 同一条文本最多重试几次被动召回；超过就放弃，等用户说下一句再查。 */
const RECALL_MAX_ATTEMPTS = 3;

/**
 * 判断一条消息是否「真人发言」。
 *
 * 不用 `kind === 'user'` 的严格白名单：老适配器可能根本不带 kind，
 * 也兼容团队/子代理消息这类未知 kind（只有已知注入 kind 才排除）。
 *
 * @param {any} message
 * @returns {boolean}
 */
export function isHumanUserMessage(message) {
  if (message?.role !== 'user') return false;
  const kind = message?.source?.kind;
  if (typeof kind === 'string' && kind !== '') {
    if (INJECTED_KINDS.has(kind) || kind.includes('session-title')) return false;
  }
  const text = userText(message);
  if (!text) return true;
  return !INJECTED_PREFIXES.some(prefix => text.startsWith(prefix));
}

/**
 * 判断一条消息是否「用户本人直接说的」——比 isHumanUserMessage 更严。
 *
 * 只认 `source.kind === 'user'`（或完全没带 kind、且内容不以注入前缀开头的老适配器）。
 * 团队/子代理消息（实测宿主用 `subagent-settled`、`agent-message` 等 kind，role 同样是 user）
 * 一律不算：它们只是转述，不能替用户关闭记忆记录。
 *
 * 用途不同，别合并：
 * - 召回与整理（capture）用宽松的 isHumanUserMessage —— 团队消息里也常带有效上下文；
 * - 「不记录」这种会**停止整场会话记录**的判定只用这个严格版。
 *
 * @param {any} message
 * @returns {boolean}
 */
export function isDirectUserMessage(message) {
  if (message?.role !== 'user') return false;
  const kind = message?.source?.kind;
  if (typeof kind === 'string' && kind !== '') return kind === 'user';
  const text = userText(message);
  if (!text) return true;
  return !INJECTED_PREFIXES.some(prefix => text.startsWith(prefix));
}

/** 只留用户本人的直接发言（其余角色原样保留），供 opt-out 判定使用。 */
const directOnly = messages => (Array.isArray(messages) ? messages : [])
  .filter(message => message?.role !== 'user' || isDirectUserMessage(message));


/** 会话运行状态与共享存储分离。所有异步结果都检查实例身份，释放后不得回填。 */
export function createMemorySessions(options) {
  const states = new Map();
  const now = options.now ?? Date.now;
  const scopeOf = options.resolveScope ?? resolveMemoryScope;
  let disposed = false;
  const service = name => { try { return options.getService?.(name); } catch { return undefined; } };
  const get = agent => states.get(agent?.session?.id);
  const live = state => !disposed && states.get(state.id) === state && state.store === options.store();
  const messagesOf = agent => { try { return agent.session.deriveMessages(); } catch { return []; } };
  /** 最后一条真人发言的文本；没有就返回空串。召回取词与「这一行是不是上一轮的」共用。 */
  const lastHumanText = agent => {
    const messages = messagesOf(agent);
    for (let index = messages.length - 1; index >= 0; index--) {
      if (!isHumanUserMessage(messages[index])) continue;
      const text = userText(messages[index]);
      if (text) return text;
    }
    return '';
  };
  const cwdOf = agent => agent?.session?.header?.cwd ?? agent?.session?.cwd;
  const snapshotRetryMs = options.snapshotRetryMs ?? 30_000;
  const isRoot = agent => {
    if (options.isRoot) return options.isRoot(agent);
    const registry = service('agents');
    if (typeof registry?.roots === 'function') return [...registry.roots()].some(root => root === agent || (agent.id && root.id === agent.id));
    return !agent?.parentAgent;
  };

  // 每步同步保存尚未整理的片段；压缩之后绝不再从会话重新读取。
  function capture(state, messages, discard = false) {
    if (discard) { state.queue = []; state.queuedChars = 0; state.backlogFull = false; }
    let added = '';
    const projection = messages.map(message => createHash('sha256').update(renderTranscript([message], Number.MAX_SAFE_INTEGER)).digest('hex'));
    // 当前宿主消息携带稳定 id。兼容无 id 的适配器时，投影替换开启新代次，宁可重新核对也不漏掉纠正。
    if (state.projection && !state.projection.every((key, index) => projection[index] === key)) state.projectionEpoch++;
    state.projection = projection;
    for (const [index, message] of messages.entries()) {
      // 注入上下文（runtime-context / skill-catalog / time-context …）不是人说的话，不进整理队列：
      // 否则每轮白送 4k 字噪声，还可能被蒸馏成「这个会话有这些技能」之类的垃圾记忆。
      if (message?.role === 'user' && !isHumanUserMessage(message)) continue;
      const rendered = renderTranscript([message], Number.MAX_SAFE_INTEGER);
      if (!rendered) continue;
      const digest = projection[index];
      const stableId = message.id ?? message.source?.id;
      const identity = typeof stableId === 'string' && stableId ? 'message:' + stableId : `projection:${state.projectionEpoch}:${index}`;
      const text = rendered.replace(/^\[1\]/u, '[' + (index + 1) + ']');
      for (let offset = 0; offset < text.length; offset += 11000) {
        const key = identity + ':' + digest + ':' + offset;
        if (state.seen.has(key)) continue;
        if (discard) { state.seen.add(key); continue; }
        const part = text.slice(offset, offset + 11000);
        if (state.queuedChars + part.length > 2_000_000) { state.backlogFull = true; continue; }
        state.seen.add(key); state.queue.push({ key, text: part }); state.queuedChars += part.length; added += part;
      }
    }
    if (added) state.distill.failures = 0;
    return added;
  }
  // 最近的内容优先：「把这次聊的记下来」首先要覆盖刚说完的话，更早的内容留给后续批次。
  function latestBatch(pool) {
    const selected = []; let size = 0;
    for (let index = pool.length - 1; index >= 0; index--) {
      const item = pool[index];
      if (size + item.text.length + (selected.length ? 2 : 0) > DISTILL_LIMITS.maxTranscriptChars) break;
      selected.unshift(item); size += item.text.length + (selected.length > 1 ? 2 : 0);
    }
    return { items: selected, text: selected.map(item => item.text).join('\n\n') };
  }

  function loadSnapshot(state) {
    state.loading = true; state.snapshotAttempt = now();
    state.ready = (async () => {
      const scope = await state.scopeReady;
      if (!live(state)) return null;
      const text = await state.store.sectionText({ scope, force: true, timeoutMs: 3000 });
      // 只认存储自己生成的不可用提示；记忆正文里出现这几个字不算。
      if (live(state)) { state.section = text; state.available = !/^\[记忆\] (?:长期记忆体暂时不可用|正在读取)/u.test(text); }
      return state;
    })().catch(error => { if (live(state)) { state.available = false; state.section = '[记忆] 长期记忆体暂时不可用：' + error.message; } return state; })
      .finally(() => { state.loading = false; });
    return state.ready;
  }

  // 被动召回：每轮按「用户刚说的话」查一次记忆，把命中的两三条放进每步提示。
  // 取词只认真人发言（isHumanUserMessage）——宿主的 runtime-context / skill-catalog / time-context
  // 也是 role=user，v5 就是拿它们去查的，所以召回内容与话题无关。
  // 失败不缓存 key：同一文本最多试 RECALL_MAX_ATTEMPTS 次，成功才记 key；同 key 的并发查询合并成一次
  // （宿主每个模型步骤会对同一个提示求值多次，不能每次都发一遍网络请求）。
  async function refreshRecall(state) {
    if (!live(state) || typeof state.store.recall !== 'function') return;
    const text = lastHumanText(state.agent);
    const recall = state.recall;
    if (!text) { recall.key = null; recall.text = ''; recall.lines = []; recall.shownKey = ''; return; }
    const key = createHash('sha256').update(text).digest('hex');
    // 换了用户发言：先清掉上一句的召回行，避免模型看到已经不对题的旧内容。
    if (recall.shownKey !== key) { recall.lines = []; recall.shownKey = key; recall.attempts = { key, count: 0 }; }
    if (recall.key === key) return;
    if (recall.pending && recall.pendingKey === key) return recall.pending;
    if (recall.attempts.key === key && recall.attempts.count >= RECALL_MAX_ATTEMPTS) return;
    const token = {};
    recall.pendingKey = key; recall.token = token;
    recall.pending = (async () => {
      const scope = await state.scopeReady;
      let result;
      // 先取一池（12 条）再按常驻索引去重、取前 3：只取 6 条会把最强的那几条筛掉、只剩第二梯队。
      try { result = await state.store.recall({ text, scope, limit: 12, timeoutMs: options.recallTimeoutMs ?? 1200 }); }
      catch (error) { result = { ok: false, error: { message: String(error?.message ?? error) } }; }
      if (!live(state) || recall.token !== token) return;
      if (result?.ok !== true) {
        // 失败不写 key，下一步还会重试；次数用尽后放弃，等用户说下一句再查。
        recall.failures += 1;
        recall.attempts = { key, count: (recall.attempts.key === key ? recall.attempts.count : 0) + 1 };
        recall.lastError = String(result?.error?.message ?? '召回失败').slice(0, 200);
        return;
      }
      recall.key = key; recall.text = text; recall.failures = 0; recall.lastError = ''; recall.attempts = { key, count: 0 };
      // 命中项分两拨：不在索引里的（fresh，按原格式最多 3 行）+ 在索引里的（只补一行 id 指路）。
      // 只取 fresh 会把"最强的那条恰好在索引里"的情况变成整块不显示，模型就不知道要读哪一条。
      const hits = result.value.entries.filter(entry => entry?.statement);
      const inIndex = entry => state.section.includes(entry.statement.slice(0, 30));
      const fresh = hits.filter(entry => !inIndex(entry)).slice(0, 3);
      const slots = Math.max(0, 3 - fresh.length);
      const indexed = slots > 0 ? hits.filter(inIndex).slice(0, slots) : [];
      const lines = [...fresh.map(entry => recallLine(entry)), ...indexed.map(entry => indexHintLine(entry))];
      recall.lines = lines.length ? ['[相关记忆] 以下历史记忆可能与本轮有关，仅供参考，当前要求优先；全文用 memory_read：', ...lines] : [];
    })().finally(() => { if (recall.token === token) { recall.pending = null; recall.pendingKey = null; recall.token = null; } });
    return recall.pending;
  }

  async function prepare(agent) {
    const ready = start(agent);
    let timer;
    try { return await Promise.race([(async () => { const state = await ready; if (state) await Promise.all([refreshExternal(state), refreshRecall(state).catch(() => {})]); return state; })(),
      new Promise(resolve => { timer = setTimeout(() => resolve(get(agent)), options.snapshotWaitMs ?? 1500); })]); }
    finally { clearTimeout(timer); }
  }

  async function start(agent) {
    const session = agent?.session;
    if (disposed || typeof session?.id !== 'string') return null;
    if (states.has(session.id)) return states.get(session.id).ready;
    const state = { id: session.id, agent, store: options.store(), scope: null,
      section: '[记忆] 正在读取本会话的记忆索引，必要时使用 memory_search。',
      pressure: { ratio: 0, wroteThisTurn: false, probes: 0, meterFound: false, hadSession: true, lastRaw: null },
      distill: { lastRunAt: 0, runs: 0, skipped: 0, lastResult: null, failures: 0, retryAt: 0 }, queue: [], seen: new Set(), queuedChars: 0, backlogFull: false,
      projection: null, projectionEpoch: 0,
      watched: new Set(), checkedAt: now(), checking: null,
      revision: options.store().revision(), captured: '', pending: null, controller: null, writeController: new AbortController(),
      blocked: false, blockedBy: '', ignoredOptOuts: new Set(), corrections: new Map(), shown: new Set(), missedChanges: false,
      recall: { key: null, text: '', lines: [], shownKey: '', failures: 0, lastError: '', attempts: { key: '', count: 0 }, pending: null, pendingKey: null, token: null } };
    states.set(session.id, state);
    state.scopeReady = Promise.resolve().then(() => scopeOf(cwdOf(agent))).then(scope => { if (live(state)) state.scope = scope; return scope; });
    return loadSnapshot(state);
  }

  function recording(agent, messages) {
    const state = get(agent);
    const current = messages ?? messagesOf(agent);
    // 「不记录」只认用户本人的直接发言：技能目录、子代理完成通知里的例句（Do not remember…）
    // 都可能命中英文祈使句正则，但它们只是转述，不能替用户关掉整场会话的记录。
    const explicit = memoryOptOut(directOnly(current), state?.ignoredOptOuts);
    const disabled = options.recordingDisabled?.() === true;
    if (state && explicit && !state.blocked) { state.blocked = true; state.blockedBy = 'user'; }
    if (state && (disabled || state.blocked || state.globallyDisabled)) capture(state, current, true);
    if (state) state.globallyDisabled = disabled;
    if (state && (disabled || state.blocked)) { state.captured = ''; state.controller?.abort(); state.writeController.abort(); }
    else if (state?.writeController.signal.aborted) state.writeController = new AbortController();
    return !disabled && !explicit && state?.blocked !== true;
  }

  /** 面板用：手动暂停或恢复某个会话的记录。恢复时忽略此前触发停止的那几句话。 */
  function setSessionRecording(id, enabled) {
    const state = states.get(id);
    if (!state) return null;
    if (enabled) {
      for (const text of optOutMessages(directOnly(messagesOf(state.agent)))) state.ignoredOptOuts.add(text);
      state.blocked = false; state.blockedBy = '';
    } else { state.blocked = true; state.blockedBy = 'panel'; }
    recording(state.agent);
    return { sessionId: id, recording: !state.blocked, blockedBy: state.blockedBy };
  }

  function measure(state) {
    const meter = service('tokenMeter');
    let raw;
    try { raw = meter?.contextPressure?.(state.agent.session); } catch {}
    const window = Number(raw?.contextWindow), used = Number(raw?.pressureTokens);
    const ratio = window > 0 && Number.isFinite(used) ? used / window : 0;
    // peak：本轮见过的最高压力。压缩发生在轮中，轮末再量时压力已经回落，不能只看最后一次。
    Object.assign(state.pressure, { ratio, peak: Math.max(state.pressure.peak ?? 0, ratio),
      probes: state.pressure.probes + 1, meterFound: !!meter, lastRaw: raw ?? null });
  }

  function launch(state, force = false) {
    if (!live(state) || !recording(state.agent)) return Promise.resolve({ ok: false, written: 0, reason: '当前会话已禁止记录记忆' });
    if (state.pending) return state.pending;
    if (!force && !isRoot(state.agent)) return Promise.resolve({ ok: true, written: 0, reason: '子代理不自动整理' });
    if (!state.queue.length) return Promise.resolve({ ok: true, written: 0, reason: '没有新增内容' });
    const route = state.agent.session.requestHeader?.()?.config;
    const llm = service('llm');
    if (!llm?.stream || !route?.provider || !route?.model) return Promise.resolve({ ok: false, written: 0, reason: '当前宿主没有可用的模型路由' });
    const retry = state.distill.failures > 0 && state.distill.failures < 3 && now() >= state.distill.retryAt;
    if (!force && !retry && state.distill.lastRunAt > 0 && now() - state.distill.lastRunAt < DISTILL_LIMITS.cooldownMs) { state.distill.skipped++; return Promise.resolve({ ok: true, written: 0, reason: 'cooldown' }); }
    if (!force && state.distill.failures >= 3) return Promise.resolve({ ok: false, written: 0, reason: '自动重试已达上限，可手动整理重试' });
    const controller = new AbortController();
    state.controller = controller;
    const timer = setTimeout(() => controller.abort(), DISTILL_LIMITS.requestTimeoutMs);
    timer.unref?.();
    // 转录在调用 launch 前同步捕获，后续绝不从已压缩的会话重新读取。
    const capturedKeys = new Set(state.queue.map(item => item.key));
    state.captured = latestBatch(state.queue).text;
    state.distill.lastRunAt = now(); state.distill.runs++;
    const accepted = [], dropped = []; let written = 0;
    const remaining = () => state.queue.filter(item => capturedKeys.has(item.key));
    state.pending = (async () => {
      await state.scopeReady;
      if (!live(state)) return { ok: false, written: 0, reason: '会话已释放或连接已切换' };
      const listed = await state.store.list({ limit: 40, scope: state.scope });
      if (!listed.ok) return { ok: false, written: 0, reason: listed.error.message };
      const topics = typeof state.store.topics === 'function' ? await state.store.topics({ scope: state.scope }) : null;
      controller.signal.throwIfAborted();
      for (let batchIndex = 0; batchIndex < 3 && remaining().length; batchIndex++) {
        const batch = latestBatch(remaining());
        if (!batch.items.length) break;
        const result = await runDistill({ provider: route.provider, model: route.model, sessionId: state.id,
          transcript: batch.text, projects: state.scope.projects, scope: state.scope, signal: controller.signal,
          topics: topics?.value?.topics ?? [],
          existing: [...listed.value.entries.map(entry => `[${entry.project}/${entry.topic ?? ''} ${entry.status}] ${entry.statement}`),
            ...accepted.map(entry => `[${entry.project}/${entry.topic ?? ''} ${entry.status}] ${entry.statement}`)],
          stream: input => llm.stream(input),
          write: spec => live(state) && recording(state.agent) && !controller.signal.aborted ? state.store.write({ ...spec, signal: controller.signal,
            canWrite: () => live(state) && recording(state.agent), originSessionId: state.id }) :
            Promise.resolve({ ok: false, error: { code: 'cancelled', message: '会话已释放、连接已切换或记忆记录已关闭' } }),
        });
        written += result.written ?? 0; accepted.push(...(result.entries ?? [])); dropped.push(...(result.dropped ?? []));
        if (!result.ok) return { ...result, written, entries: accepted, dropped };
        controller.signal.throwIfAborted();
        if (!live(state)) return { ok: false, written, reason: '会话已释放或连接已切换' };
        const done = new Set(batch.items.map(item => item.key));
        state.queue = state.queue.filter(item => !done.has(item.key)); state.queuedChars = state.queue.reduce((sum, item) => sum + item.text.length, 0);
      }
      return { ok: true, written, entries: accepted, dropped, remainingChunks: state.queue.length };
    })().catch(error => ({ ok: false, written, entries: accepted, dropped, reason: error.message })).then(result => {
      if (live(state)) {
        state.distill.lastResult = { ...result, at: now() };
        state.distill.failures = result.ok ? 0 : state.distill.failures + 1;
        state.distill.retryAt = result.ok ? 0 : now() + 30_000 * state.distill.failures;
      }
      return result;
    }).finally(() => { clearTimeout(timer); state.pending = null; state.controller = null; });
    return state.pending;
  }

  function section(context) {
    const agent = context?.agent;
    if (!agent?.session) return '';
    if (!get(agent)) void start(agent);
    return get(agent)?.section ?? '';
  }

  function refreshExternal(state) {
    if (!live(state) || typeof state.store.reconcile !== 'function' || !state.watched.size) return Promise.resolve();
    if (state.checking) return state.checking;
    if (now() - state.checkedAt < (options.externalCheckMs ?? 30_000)) return Promise.resolve();
    state.checkedAt = now();
    state.checking = state.store.reconcile([...state.watched].slice(-20)).catch(() => {})
      .finally(() => { state.checking = null; });
    return state.checking;
  }

  // 冻结索引里列着、但已经失效的条目：提醒要一直留着，否则模型下一轮又会照旧索引引用它。
  const pinned = (state, change) => ['revoked', 'superseded'].includes(change.status) && !!statementOf(change) &&
    state.section.includes(statementOf(change).slice(0, 40));

  // 宿主每个模型步骤会对同一个提示求值多次（assemble、waterfall、发请求前的 refreshContext），
  // 最后一次才是发给模型的文本。所以这里只读不清：提醒保留到本轮结束，由 stop() 统一收走。
  function hint(state, allowed = recording(state.agent)) {
    if (!live(state)) return '';
    const changes = state.store.changesSince(state.revision);
    for (const change of changes.entries) {
      if (!state.scope || !applicableMemory(change, state.scope)) continue;
      if (change.originSessionId === state.id && ['active', 'candidate'].includes(change.status)) continue;
      if (change.status === 'uncertain' || change.status === 'candidate') continue;
      state.corrections.delete(change.id); state.corrections.set(change.id, change);
    }
    state.revision = changes.revision;
    state.missedChanges ||= !changes.complete;
    while (state.corrections.size > 20) { state.corrections.delete(state.corrections.keys().next().value); state.missedChanges = true; }
    const lines = [];
    if (!allowed) lines.push('[记忆] 本会话已停止记录；不要调用 memory_write 或 memory_distill。');
    if (allowed && state.pressure.ratio >= .6) lines.push(`[记忆] 上下文使用已达 ${state.pressure.ratio >= .75 ? '75%' : '60%'} 档。${state.pressure.wroteThisTurn ? '本轮已写入记忆。' : '有明确决定或用户纠正时，请及时调用 memory_write 保存。'}`);
    if (state.backlogFull) lines.push('[记忆] 待整理内容积压，请主动保存重要结论，自动整理可能未覆盖全部内容。');
    if (state.missedChanges) lines.push('[记忆] 历史索引可能包含已撤销内容，使用前请 memory_search / memory_read 重新核实。');
    for (const change of [...state.corrections.values()].slice(-5)) {
      state.shown.add(change.id);
      const quote = statementOf(change).slice(0, 60);
      const label = quote ? `「${quote}」（${change.id}）` : change.id;
      lines.push(change.status === 'revoked' ? `[记忆更新] ${label} 已被撤销；索引里的这一条已失效，不要再引用。` :
        change.status === 'superseded' ? `[记忆更新] ${label} 已被新记忆取代；索引里的这一条已失效，需要时 memory_search 查最新版本。` :
        `[记忆更新] 新增或更新：${label}；全文用 memory_read。`);
    }
    // 召回行只对「当前这条用户发言」有效：新一轮第一步时 deriveMessages 可能还没带上
    // 新消息，refreshRecall 会按旧 key 提前返回，若这里无条件追加就会把上一轮的召回
    // 当成这一轮的相关记忆发给模型（实测：用户说「已经完成重启」，提示里还挂着上一轮
    // 关于自动蒸馏的条目）。文本不一致就丢弃，等下一次 refreshRecall 重查。
    // v9：召回连续失败要说出来——否则「没有相关记忆」和「召回坏了」在模型眼里没区别。
    // 成功一次就清零，所以这条只在真的坏掉时出现，不是每轮都念一遍。
    if (state.recall.failures >= 2) {
      const reason = String(state.recall.lastError ?? '').trim();
      lines.push('[记忆] 被动召回连续失败 ' + state.recall.failures + ' 次' + (reason ? '（' + reason.slice(0, 80) + '）' : '') + '；本轮可能漏掉相关记忆，需要时请用 memory_search 主动查。');
    }
    const humanText = lastHumanText(state.agent);
    if (humanText && humanText === state.recall.text) lines.push(...state.recall.lines);
    else if (state.recall.lines.length) state.recall.lines = [];
    return lines.join('\n');
  }

  function context(input) {
    const agent = input?.agent;
    const state = get(agent);
    if (!state) { if (agent?.session) void start(agent); return ''; }
    void refreshExternal(state);
    if (!state.available && !state.loading && now() - state.snapshotAttempt >= snapshotRetryMs) void loadSnapshot(state);
    measure(state);
    const messages = messagesOf(agent);
    const allowed = recording(agent, messages);
    if (allowed && isRoot(agent)) capture(state, messages);
    return hint(state, allowed);
  }

  async function stop(agent) {
    // 转录必须在第一次 await 之前取得，轮末返回后不能再从会话读取它。
    const messages = messagesOf(agent);
    if (!get(agent)) void start(agent);
    const state = get(agent);
    if (!state) return;
    const allowedBefore = !memoryOptOut(directOnly(messages), state.ignoredOptOuts) && !state.blocked;
    if (allowedBefore && isRoot(agent)) capture(state, messages);
    // 本轮已经送达过的一次性提醒到此收走；索引里仍列着的失效条目继续保留。
    for (const id of state.shown) { const change = state.corrections.get(id); if (change && !pinned(state, change)) state.corrections.delete(id); }
    state.shown.clear();
    await state.scopeReady;
    measure(state);
    // 自动整理：未整理内容攒够一定量，或上下文逼近压缩时才跑；第一轮的寒暄不会触发。
    // 模型本轮自己写过记忆且压力不高时让一让，避免同一结论被换个说法再记一遍。
    const nearCompaction = Math.max(state.pressure.ratio, state.pressure.peak ?? 0) >= DISTILL_LIMITS.minRatio;
    const due = state.queuedChars >= DISTILL_LIMITS.minQueuedChars || nearCompaction;
    if (!state.pending && allowedBefore && recording(agent, messages) && isRoot(agent) && state.queue.length && due &&
        (nearCompaction || !state.pressure.wroteThisTurn)) void launch(state);
    state.pressure.wroteThisTurn = false; state.pressure.peak = 0;
  }

  function remove(agent) { const state = get(agent); if (state) { state.controller?.abort(); state.writeController.abort(); states.delete(state.id); } }
  function reset() { for (const state of states.values()) { state.controller?.abort(); state.writeController.abort(); } states.clear(); }
  return { start, prepare, section, context, stop, remove, reset, recording, setSessionRecording,
    hint: context => { const state = get(context?.agent); return state ? hint(state) : ''; },
    watch: (agent, ids) => { const state = get(agent); if (state) { for (const id of ids ?? []) state.watched.add(id); while (state.watched.size > 20) state.watched.delete(state.watched.values().next().value); } },
    refreshRecording: () => { for (const state of states.values()) recording(state.agent); },
    signal: agent => get(agent)?.writeController.signal,
    scope: async agent => { if (!get(agent)) void start(agent); return await get(agent)?.scopeReady ?? await scopeOf(cwdOf(agent)); },
    wrote: agent => { const state = get(agent); if (state) state.pressure.wroteThisTurn = true; },
    distill: async agent => { if (!get(agent)) void start(agent); const state = get(agent); if (!state) return { ok: false, written: 0, reason: '没有可用会话' }; if (!recording(agent)) return { ok: false, written: 0, reason: '当前会话已关闭记录' }; capture(state, messagesOf(agent)); return launch(state, true); },
    idle: id => states.get(id)?.pending ?? Promise.resolve(),
    /** 被会话级指令或面板停止记录的会话；全局开关另算。 */
    blockedSessions: () => [...states.values()].filter(state => state.blocked).map(state => ({ sessionId: state.id, blockedBy: state.blockedBy || 'user',
      title: String(state.agent?.session?.header?.title ?? state.agent?.session?.title ?? '').slice(0, 60) })),
    diagnostics: id => { const state = states.get(id); return state ? { sessionId: id, scope: state.scope, section: state.section, pressure: { ...state.pressure }, distill: { ...state.distill }, queuedChars: state.queuedChars, recall: { lines: [...state.recall.lines], key: state.recall.key ?? null, failures: state.recall.failures ?? 0, lastError: state.recall.lastError ?? '' }, recording: !state.blocked && !options.recordingDisabled?.(), blockedBy: state.blockedBy } : null; },
    dispose: () => { disposed = true; reset(); },
  };
}
