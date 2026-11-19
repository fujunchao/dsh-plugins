/**
 * dsh-siyuan-notes — 契约 v10 面板（2026-11-19）
 *
 * 面板侧这六件事，浏览器里点一遍很慢、很容易漏，所以在这里用假 React + 假 fetch 直接跑：
 *   1. 候选区块：按 topicId 分组，只有最新那条给「确认生效（作废其余 N-1 条）」，其余标「将被一并作废」；
 *   2. 状态 chip 带 byStatus 真值（候选（推断）7 / 有效 300 / 全部 397）；
 *   3. 搜索框只在已加载条目里过滤，一个请求都不发；
 *   4. 分页：「加载更多」按 offset += 200，「已显示 M / N 条」与「已全部加载」；
 *   5. 输入 300ms 防抖（连打 5 个键只发 1 次）+ datalist + 失败保留列表；
 *   6. 详情「改归属」走 reproject，以及「距上次确认 N 天」。
 *
 * 全部在内存里：不 POST 真实宿主，不碰真实库。
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { test } from 'node:test';

const SOURCE = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

/** 面板文案走 t()：这里只给用得上的键，其余原样返回（与真实字典同义）。 */
const ZH = {
	memoryTitle: '记忆',
	memoryAll: '全部',
	memoryStatusActive: '有效',
	memoryStatusCandidate: '候选（推断）',
	memoryStatusSuperseded: '已被取代',
	memoryStatusRevoked: '已撤销',
	memoryTypePref: '偏好',
	memoryTypeFact: '事实',
	memoryTypeDecision: '决策',
	memoryTypeState: '状态',
	memoryEmpty: '还没有记忆',
	memoryLoading: '正在读取记忆…',
	memoryFailed: '读取失败：{message}',
	memoryPartial: '仅展示最新的部分条目，请缩小筛选范围。',
	memoryApproved: '已确认生效',
	memoryApprovedShort: '确认生效',
	memoryRevoked: '已撤销',
	memoryRestored: '已恢复',
	memoryActionFailed: '动作失败：{message}',
	memoryRefresh: '刷新',
	memoryProject: '项目',
	memoryApprove: '调整范围或正文后确认',
	memoryRevoke: '撤销',
	memoryRestore: '恢复',
	memoryCopyId: '复制 ID',
	memoryCopied: '已复制',
	memoryCount: '{n} 条',
	memoryCountWindowed: '{n} 条 · 仅显示 {shown}',
	memoryHandoff: '交接卡',
	memoryHandoffClose: '收起交接卡',
	memoryHandoffHint: '把这段贴给下一个会话。',
	memoryHandoffCopy: '复制交接卡',
	memoryRefcount: '被读过 {n} 次',
	memoryRefcountHint: '被召回几次',
};

function translate(key, params) {
	const template = ZH[key] ?? key;
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** MemoryPage 的 useState 槽位顺序：测试按位置预置状态，所以这里也照位置写。 */
const SLOT = {
	overview: 0, entries: 1, loading: 2, error: 3, type: 4, status: 5, project: 6, openId: 7,
	notice: 8, handoff: 9, manager: 10, listing: 11, query: 12, scopes: 13,
};

function seedStates(overrides = {}) {
	const states = [
		{ catalog: [] }, [], false, null, '', '', '', '', null, null,
		{ approval: null, selected: [], body: '', recoveries: null, inspection: null, confirmedMissing: false },
		{ candidates: [], byStatus: null, offset: 0, hasMore: undefined, stale: false },
		'',
		{ workspaces: [], projects: [] },
	];
	for (const [slot, value] of Object.entries(overrides)) states[Number(slot)] = value;
	return states;
}

/** 默认回包：只实现这一轮用到的分支，其余给空对象。 */
function baseReply(extra = {}) {
	return (call) => {
		if (call.init?.method === 'POST') return extra.post ? extra.post(call) : { value: {} };
		if (call.url.includes('view=recording')) return { value: { enabled: true, locked: false, sessions: [] } };
		if (call.url.includes('view=entries')) return extra.entries ? extra.entries(call) : { value: { entries: [], complete: true } };
		if (call.url.includes('view=scopes')) return { value: { workspaces: [], projects: [] } };
		if (call.url.includes('view=receipts')) return { value: { entries: [] } };
		if (call.url.includes('view=approval')) return { value: { candidate: {}, conflicts: [], selection: {} } };
		return { value: { catalog: [] } };
	};
}

/** 递归把节点树里的文字拼起来：面板文案分布在多层 span 里。 */
function textOf(node) {
	if (typeof node === 'string') return node;
	if (typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(textOf).join(' ');
	if (!node || typeof node !== 'object') return '';
	return textOf(node.children ?? []);
}

/** 按钮的字面标签（都是直接子字符串）。 */
const labelOf = (button) => (button.children ?? []).filter((child) => typeof child === 'string').join('');

const flatten = (children) => (children ?? []).flat(Infinity).filter((child) => child && typeof child === 'object');

async function waitFor(predicate, label) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('等待超时：' + label);
}

/**
 * 用假 React + 假 fetch 渲染 MemoryPage。
 *
 * useState 与 useRef 的槽位都跨渲染保留（真 React 就是这样）：防抖定时器与请求序号
 * 只有 ref 稳定时才测得出来；预置状态也才能像真面板一样被后续请求改写。
 */
async function renderPanel(options = {}) {
	const states = options.states ?? seedStates();
	const refs = [];
	let stateCursor = 0;
	let refCursor = 0;
	let exports;
	const calls = [];
	const React = {
		Component: class {},
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
		useState: (initial) => {
			const slot = stateCursor++;
			if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
			return [states[slot], (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }];
		},
		useEffect: () => {},
		useLayoutEffect: () => {},
		useMemo: (factory) => factory(),
		useCallback: (fn) => fn,
		useRef: (value) => {
			const slot = refCursor++;
			if (!(slot in refs)) refs[slot] = { current: value };
			return refs[slot];
		},
		useSyncExternalStore: (_subscribe, get) => get(),
	};
	const reply = options.reply ?? baseReply();
	const fetch = async (url, init) => {
		const call = { url: String(url), init };
		calls.push(call);
		const planned = reply(call) ?? { value: {} };
		// reply 也可以返回 { wait: Promise<{ value } | { fail }> }：把一次响应压在手里，
		// 用来验证「过期响应必须丢弃」——两个请求同时在飞时，后到的旧响应不能覆盖新结果。
		const answered = planned.wait ? await planned.wait : planned;
		if (answered.fail !== undefined) {
			return { ok: false, status: 500, text: async () => JSON.stringify({ ok: false, error: { code: 'test', message: answered.fail } }) };
		}
		const value = answered.value === undefined ? {} : answered.value;
		return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value }) };
	};
	new Function('window', 'document', 'fetch', SOURCE)(
		{ __ModuleLoader__: { load({ factory }) { exports = factory((name) => (name === 'react' ? React : {})); } } },
		{ createElement: () => ({ dataset: {} }), head: { appendChild() {} }, querySelector: () => null },
		fetch,
	);
	let nodes = [];
	let root = null;
	const render = () => {
		stateCursor = 0;
		refCursor = 0;
		nodes = [];
		const visit = (node) => {
			if (Array.isArray(node)) return node.forEach(visit);
			if (!node || typeof node !== 'object') return;
			nodes.push(node);
			visit(node.children);
		};
		root = exports.__panes.MemoryPage({ t: translate });
		visit(root);
		return nodes;
	};
	render();
	const entriesCalls = () => calls.filter((call) => call.url.includes('view=entries'));
	return {
		states,
		calls,
		render,
		entriesCalls,
		nodes: () => nodes,
		buttons: () => nodes.filter((node) => node.type === 'button'),
		rows: () => nodes.filter((node) => node.props.className === 'sy-mem-row'),
		input: (marker) => nodes.find((node) => node.type === 'input' && (node.props['aria-label'] === marker || node.props.placeholder === marker)),
		text: () => textOf(root),
	};
}

// ---------------------------------------------------------------- 样例数据

/**
 * 三条同主题（包管理）的 state 候选 + 一条同主题但类型是 fact 的候选 + 一条别的主题的候选。
 *
 * 形状照着真实宿主来：宿主的 entries 回包里 topicId 往往是空的（只有 state 类条目会存），
 * 所以「同主题」得靠 workspace + project + topic 拼键；而 fact 候选确认时不会作废谁，
 * 面板不能把它并进同主题那一组（否则「作废其余 2 条」就是一句空话）。
 */
const CANDIDATES = [
	{ id: 'c-old', statement: '旧候选：继续用 pnpm', type: 'state', project: 'p', workspace: '/w/p', topic: '包管理', created: '20261110090000', revision: 'r-old', status: 'candidate' },
	{ id: 'c-mid', statement: '中间候选：改用 bun', type: 'state', project: 'p', workspace: '/w/p', topic: '包管理', created: '20261111090000', revision: 'r-mid', status: 'candidate' },
	{ id: 'c-new', statement: '新候选：改用 npm', type: 'state', project: 'p', workspace: '/w/p', topic: '包管理', created: '20261111120000', revision: 'r-new', status: 'candidate' },
	{ id: 'c-fact', statement: '事实候选：包管理器统一用 npm', type: 'fact', project: 'p', workspace: '/w/p', topic: '包管理', created: '20261111130000', revision: 'r-fact', status: 'candidate' },
	{ id: 'c-solo', statement: '单条候选：提交前先跑测试', type: 'state', project: 'p', workspace: '/w/p', topic: '测试', created: '20261112090000', revision: 'r-solo', status: 'candidate' },
];

const BY_STATUS = { active: 300, candidate: 7, superseded: 40, revoked: 50 };
const LISTING = { candidates: CANDIDATES, byStatus: BY_STATUS, offset: 0, hasMore: false, stale: false };

const TWO_ENTRIES = [
	{ id: 'e-1', statement: '面板默认显示全部条目', body: '面板默认显示全部条目', type: 'fact', project: 'p', workspace: '/w/p', status: 'active', confidence: 'verified', created: '20261110120000' },
	{ id: 'e-2', statement: '检索按二元组展开', body: '检索按二元组展开', type: 'decision', project: 'p', workspace: '/w/p', status: 'active', confidence: 'stated', created: '20261110120000' },
];

// ---------------------------------------------------------------- 1. 候选分组

test('v10 面板：同主题候选分组，只有最新那条给「确认生效（作废其余 N-1 条）」', async () => {
	const panel = await renderPanel({ states: seedStates({ [SLOT.entries]: [], [SLOT.loading]: false, [SLOT.listing]: LISTING }) });
	const text = panel.text();
	assert.ok(text.includes('同主题 3 条候选'), '组头要写清同主题几条：' + text);
	assert.ok(text.includes('候选（推断）7 条'), '区块标题用 byStatus 的真值：' + text);
	assert.equal(text.split('同主题 3 条候选').length - 1, 1, '只有一个组头：' + text);
	const labels = panel.buttons().map(labelOf);
	assert.equal(labels.filter((label) => label === '确认生效（作废其余 2 条）').length, 1, '主按钮只能有一个：' + labels.join(' | '));
	assert.equal(labels.filter((label) => label === '确认生效').length, 2, '单条候选（fact 与独立 state）都用「确认生效」：' + labels.join(' | '));
	assert.equal(text.split('将被一并作废').length - 1, 2, '组内其余两条要被标出来：' + text);
	// 组内按 created 降序：最新那条在最前。
	const order = ['新候选', '中间候选', '旧候选'].map((name) => text.indexOf(name));
	assert.ok(order.every((index) => index >= 0), '三条都在：' + order.join(','));
	assert.ok(order[0] < order[1] && order[1] < order[2], '组内要按 created 降序：' + order.join(','));
	// fact 候选与它们同主题，但宿主不会一起作废，所以必须留在组外（排在组的后面）。
	assert.ok(text.indexOf('事实候选') > order[2], 'fact 候选不许并进同主题组：' + text);
});

test('v10 面板：确认最新那条只发一次 approve，提示「已作废 N 条同主题候选」', async () => {
	let posted = null;
	const panel = await renderPanel({
		states: seedStates({ [SLOT.entries]: [], [SLOT.loading]: false, [SLOT.listing]: LISTING }),
		reply: baseReply({ post: (call) => { posted = JSON.parse(call.init.body); return { value: { supersededCandidates: ['c-old', 'c-mid'], skippedCandidates: 2 } }; } }),
	});
	const main = panel.buttons().find((node) => labelOf(node) === '确认生效（作废其余 2 条）');
	assert.ok(main, '主按钮要落在最新那条上：' + panel.buttons().map(labelOf).join(' | '));
	main.props.onClick();
	await waitFor(() => posted !== null, 'approve 请求');
	assert.deepEqual(posted, { action: 'approve', id: 'c-new', expectedRevision: 'r-new' }, '确认要带用户看到的版本号');
	await waitFor(() => panel.entriesCalls().length > 0, '确认后刷新列表');
	panel.render();
	const text = panel.text();
	assert.ok(text.includes('已作废 2 条同主题候选'), '作废了几条要如实说：' + text);
	assert.ok(text.includes('另有 2 条超出上限未处理'), '超出上限的部分不能装作不存在：' + text);
});

test('v10 面板：状态 chip 带 byStatus 真值计数', async () => {
	const panel = await renderPanel({ states: seedStates({ [SLOT.loading]: false, [SLOT.listing]: LISTING }) });
	const text = panel.text();
	for (const expected of ['全部 397', '候选（推断） 7', '有效 300', '已被取代 40', '已撤销 50']) {
		assert.ok(text.includes(expected), 'chip 上要写「' + expected + '」：' + text);
	}
});

// ---------------------------------------------------------------- 2. 搜索

test('v10 面板：搜索只在已加载条目里过滤，一个请求都不发', async () => {
	const latin = { id: 'e-3', statement: 'Sequelize 迁移脚本要跑两遍', body: 'Sequelize 迁移脚本要跑两遍', type: 'fact', project: 'p', workspace: '/w/p', status: 'active', created: '20261110120000' };
	const panel = await renderPanel({
		states: seedStates({ [SLOT.entries]: [...TWO_ENTRIES, latin], [SLOT.loading]: false, [SLOT.listing]: { candidates: [], byStatus: BY_STATUS, offset: 0, hasMore: false } }),
	});
	assert.equal(panel.rows().length, 3, '先有三行');
	const search = panel.input('搜索记忆');
	assert.ok(search, '要有搜索框');
	search.props.onChange({ target: { value: '二元组' } });
	assert.equal(panel.entriesCalls().length, 0, '搜索不许发请求');
	panel.render();
	assert.equal(panel.rows().length, 1, '只留命中的那一条');
	const text = panel.text();
	assert.ok(text.includes('检索按二元组展开'), text);
	assert.equal(text.includes('面板默认显示全部条目'), false, '没命中的不能留着：' + text);
	// 大小写不敏感：小写关键词要能命中大写正文。
	panel.input('搜索记忆').props.onChange({ target: { value: 'sequelize' } });
	panel.render();
	assert.equal(panel.rows().length, 1, '大小写不该影响命中：' + panel.text());
	assert.ok(panel.text().includes('Sequelize 迁移脚本要跑两遍'), panel.text());
});

// ---------------------------------------------------------------- 3. 分页

test('v10 面板：「加载更多」按 offset=200 续读，底部显示已显示 M / N 条与已全部加载', async () => {
	// 宿主只在第一页带 candidates：续读响应里没有它，面板必须保留上一份。
	const listing = { candidates: [CANDIDATES[3]], byStatus: BY_STATUS, offset: 0, hasMore: true };
	const panel = await renderPanel({
		states: seedStates({ [SLOT.entries]: [TWO_ENTRIES[0]], [SLOT.loading]: false, [SLOT.listing]: listing }),
		reply: baseReply({ entries: () => ({ value: { entries: [TWO_ENTRIES[0], TWO_ENTRIES[1]], complete: false, offset: 200, hasMore: false, byStatus: BY_STATUS } }) }),
	});
	assert.ok(panel.text().includes('已显示 1 / 397 条'), 'N 取 byStatus 合计：' + panel.text());
	const more = panel.buttons().find((node) => labelOf(node) === '加载更多');
	assert.ok(more, 'hasMore 为真时要有「加载更多」：' + panel.buttons().map(labelOf).join(' | '));
	more.props.onClick();
	await waitFor(() => panel.calls.some((call) => call.url.includes('offset=200')), 'offset=200 请求');
	assert.ok(panel.calls.some((call) => call.url.includes('limit=200')), '一页 200 条');
	await waitFor(() => panel.states[SLOT.entries].length === 2, '续读结果写回列表');
	panel.render();
	assert.equal(panel.rows().length, 2, '续读是追加，不是替换');
	assert.ok(panel.text().includes('候选（推断）'), '续读不该把候选区块清掉：' + panel.text());
	assert.ok(panel.text().includes('已全部加载'), '到底要说「已全部加载」：' + panel.text());
	assert.equal(panel.buttons().some((node) => labelOf(node) === '加载更多'), false, '到底后按钮要消失');
});

// ---------------------------------------------------------------- 4. 防抖

test('v10 面板：工作区/项目输入 300ms 防抖，连打 5 个键只发 1 次请求', async () => {
	const panel = await renderPanel({ states: seedStates() });
	const input = panel.input('项目');
	assert.ok(input, '要有项目输入框');
	for (const value of ['a', 'ab', 'abc', 'abcd', 'abcde']) input.props.onChange({ target: { value } });
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.equal(panel.entriesCalls().length, 0, '300ms 内一个请求都不该发');
	await waitFor(() => panel.entriesCalls().length === 1, '防抖后的唯一请求');
	await new Promise((resolve) => setTimeout(resolve, 400));
	assert.equal(panel.entriesCalls().length, 1, '只发一次：' + panel.calls.map((call) => call.url).join(' | '));
	assert.ok(panel.entriesCalls()[0].url.includes('project=abcde'), '发的是最后一次键入的值：' + panel.entriesCalls()[0].url);
});

// ---------------------------------------------------------------- 5. 失败不清空

test('v10 面板：读取失败保留列表，只说「显示的可能不是最新内容」，不渲染空态', async () => {
	const panel = await renderPanel({
		states: seedStates({ [SLOT.entries]: TWO_ENTRIES, [SLOT.loading]: false }),
		reply: baseReply({ entries: () => ({ fail: '网络断了' }) }),
	});
	assert.equal(panel.rows().length, 2, '先有两行');
	panel.buttons().find((node) => labelOf(node) === '刷新').props.onClick();
	await waitFor(() => panel.states[SLOT.error] !== null, '失败写进 error');
	await waitFor(() => panel.states[SLOT.listing]?.stale === true, '失败标记进 listing');
	panel.render();
	assert.equal(panel.rows().length, 2, '失败不许清空列表');
	const text = panel.text();
	assert.ok(text.includes('显示的可能不是最新内容'), text);
	assert.equal(text.includes('还没有记忆'), false, '不能说成空库：' + text);
	assert.ok(text.includes('网络断了'), '失败原因要写出来：' + text);
	const warning = panel.nodes().find((node) => (node.children ?? []).some((child) => typeof child === 'string' && child.includes('显示的可能不是最新内容')));
	assert.equal(warning?.props?.['data-tone'], 'warn', '提示行要是 warn 色：' + JSON.stringify(warning?.props));
});

test('v10 面板：过期响应被丢弃，不会覆盖后发请求的结果', async () => {
	const first = { id: 'slow-1', statement: '慢请求里的旧结果', type: 'fact', project: 'p', workspace: '/w/p', status: 'active', created: '20261110120000' };
	const second = { id: 'fast-2', statement: '新请求里的新结果', type: 'fact', project: 'p', workspace: '/w/p', status: 'active', created: '20261110110000' };
	let releaseSlow;
	const gate = new Promise((resolve) => { releaseSlow = resolve; });
	let issued = 0;
	const panel = await renderPanel({
		states: seedStates({ [SLOT.entries]: [first], [SLOT.loading]: false }),
		reply: (call) => {
			if (!call.url.includes('view=entries')) return baseReply()(call);
			issued += 1;
			// 第一次请求压在手里，第二次立刻返回：回来的顺序与发出的顺序相反。
			return issued === 1 ? { wait: gate.then(() => ({ value: { entries: [first], complete: true } })) } : { value: { entries: [second], complete: true } };
		},
	});
	const refresh = () => panel.buttons().find((node) => labelOf(node) === '刷新').props.onClick();
	refresh();
	refresh();
	await waitFor(() => panel.states[SLOT.entries][0]?.id === 'fast-2', '后发请求先落地');
	releaseSlow();
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(panel.states[SLOT.entries][0]?.id, 'fast-2', '过期的慢响应把列表改回去了：' + JSON.stringify(panel.states[SLOT.entries].map((entry) => entry.id)));
	panel.render();
	assert.equal(panel.rows().length, 1, panel.text());
	assert.ok(panel.text().includes('新请求里的新结果'), panel.text());
	assert.equal(panel.text().includes('慢请求里的旧结果'), false, panel.text());
});

// ---------------------------------------------------------------- 6. 改归属

test('v10 面板：详情「改归属」提交 reproject（带 revision），失败把原因写进提示行', async () => {
	const entry = { id: 'm-1', statement: '一条记忆', body: '一条记忆', type: 'fact', project: 'p', workspace: '/w/p', status: 'active', confidence: 'stated', created: '20261110120000', revision: 'viewed-rev' };
	let posted = null;
	let failing = false;
	const panel = await renderPanel({
		states: seedStates({ [SLOT.entries]: [entry], [SLOT.loading]: false, [SLOT.openId]: entry.id }),
		reply: (call) => {
			if (call.init?.method === 'POST') {
				posted = JSON.parse(call.init.body);
				return failing ? { fail: '工作区里没有这个项目' } : { value: { id: entry.id, project: 'p', workspace: '/w/p' } };
			}
			return baseReply({ entries: () => ({ value: { entries: [entry], complete: true } }) })(call);
		},
	});
	const save = panel.buttons().find((node) => labelOf(node) === '保存归属');
	assert.ok(save, '展开区要有「保存归属」：' + panel.buttons().map(labelOf).join(' | '));
	assert.ok(panel.input('改归属项目') && panel.input('改归属工作区'), '展开区要有项目与工作区两个输入');
	save.props.onClick();
	await waitFor(() => posted !== null, 'reproject 请求');
	assert.deepEqual(posted, { action: 'reproject', id: 'm-1', project: 'p', workspace: '/w/p', expectedRevision: 'viewed-rev' });
	await waitFor(() => panel.entriesCalls().length > 0, '成功后刷新');
	failing = true;
	panel.render();
	panel.buttons().find((node) => labelOf(node) === '保存归属').props.onClick();
	await waitFor(() => Boolean(panel.states[SLOT.manager]?.placeError), '失败写进提示行');
	panel.render();
	assert.ok(panel.text().includes('改归属失败：工作区里没有这个项目'), panel.text());
});

// ---------------------------------------------------------------- 7. 距上次确认

test('v10 面板：详情显示「距上次确认 N 天」，不再出现「待复核」', async () => {
	const days = Math.max(0, Math.floor((Date.now() - new Date(2026, 10, 10, 12, 0, 0).getTime()) / 86400000));
	const stale = { id: 's-1', statement: '旧状态', body: '旧状态', type: 'state', project: 'p', workspace: '/w/p', status: 'active', confidence: 'stated', created: '20261110120000', stale: true };
	const panel = await renderPanel({ states: seedStates({ [SLOT.entries]: [stale], [SLOT.loading]: false, [SLOT.openId]: stale.id }) });
	assert.ok(panel.text().includes('距上次确认 ' + days + ' 天'), '要说清多久没确认：' + panel.text());
	assert.equal(panel.text().includes('待复核'), false, '复核入口早就下线了：' + panel.text());
	const fresh = await renderPanel({ states: seedStates({ [SLOT.entries]: [{ ...stale, id: 's-2', stale: false }], [SLOT.loading]: false, [SLOT.openId]: 's-2' }) });
	assert.equal(fresh.text().includes('距上次确认'), false, '没过期的条目不用提这一行');
});

// ---------------------------------------------------------------- 8. datalist

test('v10 面板：工作区/项目输入挂 datalist，选项来自 view=scopes', async () => {
	const panel = await renderPanel({ states: seedStates({ [SLOT.loading]: false, [SLOT.scopes]: { workspaces: ['/w/a', '/w/b'], projects: ['proj-a', 'proj-b'] } }) });
	const lists = panel.nodes().filter((node) => node.type === 'datalist')
		.map((node) => ({ id: node.props.id, values: flatten(node.children).map((option) => option.props.value) }));
	assert.deepEqual(lists.map((item) => item.id).sort(), ['sy-mem-projects', 'sy-mem-workspaces']);
	assert.deepEqual(lists.find((item) => item.id === 'sy-mem-projects').values, ['proj-a', 'proj-b']);
	assert.deepEqual(lists.find((item) => item.id === 'sy-mem-workspaces').values, ['/w/a', '/w/b']);
	assert.equal(panel.input('项目').props.list, 'sy-mem-projects', '项目输入要绑定自己的 datalist');
	assert.equal(panel.input('工作区范围').props.list, 'sy-mem-workspaces', '工作区输入要绑定自己的 datalist');
});
