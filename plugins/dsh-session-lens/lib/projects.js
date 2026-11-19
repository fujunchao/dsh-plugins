/**
 * 项目目录：这台机器上有哪些项目、每个项目里有哪些会话。
 *
 * “项目”有两个来源，本模块把它们的差异显式化：
 * - **注册项目**（`workspaceRegistry`）：你亲手建的分组，带名字，侧栏看到的就是它；
 * - **cwd 桶**（会话 header 里的路径）：机器记录的事实，进程在哪儿跑就在哪儿落盘。
 *
 * 列表跟着人的组织走（未注册目录默认折叠），检索跟着机器的事实走（`session_find`
 * 覆盖全部落盘会话）。两者覆盖面不同是刻意的。
 *
 * @module dsh-session-lens/projects
 */

import { CODES, LensError } from "./errors.js";
import { resolveCaller } from "./caller.js";
import { formatTime } from "./render.js";

/**
 * 路径归一化，只用于**匹配**，不用于展示。大小写与分隔符归一，去掉尾部反斜杠。
 * @param {string} value 路径。
 * @returns {string} 归一化后的键。
 */
export function normalizePath(value) {
  return String(value ?? "")
    .replaceAll("/", "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

/**
 * 把注册表与会话记录合成项目索引。
 * @param {readonly {path: string, title: string}[]} workspaces 注册项目（注册表顺序）。
 * @param {readonly {header: any, live: boolean, persisted: boolean}[]} records 全部会话记录。
 * @returns {{
 *   registered: {path: string, title: string, sessions: any[]}[],
 *   unregistered: {path: string, sessions: any[]}[],
 *   sessionCount: number,
 * }} 项目索引；`registered` 保持注册表顺序，`unregistered` 按会话数降序。
 */
export function buildProjectIndex(workspaces, records) {
  /** @type {Map<string, {path: string, title: string, sessions: any[]}>} */
  const registered = new Map();
  for (const workspace of workspaces) {
    const key = normalizePath(workspace.path);
    if (registered.has(key)) continue;
    registered.set(key, { path: workspace.path, title: workspace.title, sessions: [] });
  }

  /** @type {Map<string, {path: string, sessions: any[]}>} */
  const unregistered = new Map();
  let sessionCount = 0;

  for (const record of records) {
    const cwd = record?.header?.cwd;
    if (typeof cwd !== "string" || cwd === "") continue;
    sessionCount += 1;
    const key = normalizePath(cwd);
    const project = registered.get(key);
    if (project !== undefined) {
      project.sessions.push(record);
      continue;
    }
    let bucket = unregistered.get(key);
    if (bucket === undefined) {
      bucket = { path: cwd, sessions: [] };
      unregistered.set(key, bucket);
    }
    bucket.sessions.push(record);
  }

  const byNewest = (left, right) => (right?.header?.createdAt ?? 0) - (left?.header?.createdAt ?? 0);
  const registeredList = [...registered.values()].map((project) => {
    project.sessions.sort(byNewest);
    return project;
  });
  const unregisteredList = [...unregistered.values()]
    .map((bucket) => {
      bucket.sessions.sort(byNewest);
      return bucket;
    })
    .sort((left, right) => right.sessions.length - left.sessions.length);

  return { registered: registeredList, unregistered: unregisteredList, sessionCount };
}

/**
 * 统计每个主会话派生了多少子会话。
 * @param {readonly {header: any}[]} records 全部会话记录。
 * @returns {Map<string, number>} 父会话 id → 子会话数。
 */
export function subagentCounts(records) {
  const counts = new Map();
  for (const record of records) {
    const parent = record?.header?.parentSession;
    if (typeof parent !== "string" || parent === "") continue;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return counts;
}

/**
 * 按标题或路径子串挑项目。同名或同子串命中多个时返回全部，由调用方展示。
 * @param {readonly {path: string, title?: string}[]} projects 项目。
 * @param {string} query 用户/模型给的项目名或路径片段。
 * @returns {{path: string, title?: string}[]} 命中的项目。
 */
export function matchProjects(projects, query) {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return projects.filter((project) => {
    const title = String(project.title ?? "").toLowerCase();
    const path = String(project.path ?? "").toLowerCase();
    return title.includes(needle) || path.includes(needle);
  });
}

/**
 * 渲染项目目录。
 * @param {{registered: any[], unregistered: any[], sessionCount: number}} index 项目索引。
 * @param {{maxProjects: number, includeUnregistered: boolean, callerCwd?: string, totalSessions: number}} options 渲染选项。
 * @returns {string} 目录文本。
 */
export function renderProjectDirectory(index, options) {
  const lines = [];
  const header =
    `本机 ${options.totalSessions} 个会话 · ${index.registered.length} 个注册项目` +
    (options.callerCwd === undefined ? "" : ` · 当前工作区 ${options.callerCwd}`);
  lines.push(header);

  const shown = index.registered.slice(0, options.maxProjects);
  if (shown.length === 0) {
    lines.push("（注册表为空：这台机器上没有已登记的项目，直接用 session_find 检索即可。）");
  }
  for (const project of shown) {
    const latest = project.sessions[0]?.header?.createdAt;
    const stamp = latest === undefined ? "无会话" : `最近 ${formatTime(latest)}`;
    lines.push(`- ${project.title} (${project.path}) — ${project.sessions.length} 个会话 · ${stamp}`);
  }
  if (index.registered.length > shown.length) {
    lines.push(`（只列前 ${options.maxProjects} 个注册项目）`);
  }

  if (options.includeUnregistered && index.unregistered.length > 0) {
    lines.push("");
    lines.push("未注册目录（有会话落盘、但不在注册表里）：");
    for (const bucket of index.unregistered) {
      const latest = bucket.sessions[0]?.header?.createdAt;
      lines.push(`- ${bucket.path} — ${bucket.sessions.length} 个会话 · ${latest === undefined ? "" : `最近 ${formatTime(latest)}`}`);
    }
  } else if (index.unregistered.length > 0) {
    const sessions = index.unregistered.reduce((sum, bucket) => sum + bucket.sessions.length, 0);
    lines.push(
      `另有 ${index.unregistered.length} 个未注册目录（${sessions} 个会话）未列出：` +
        "加 include_unregistered: true 展开。",
    );
  }
  return lines.join("\n");
}

/**
 * 渲染单个项目的会话列表。
 * @param {{path: string, title: string, sessions: any[]}} project 项目。
 * @param {{maxSessionsPerProject: number}} options 渲染选项。
 * @param {Map<string, number>} subagents 父会话 → 子会话数。
 * @param {Map<string, string>} titles 会话 id → 标题。
 * @returns {string} 会话列表文本。
 */
export function renderProjectSessions(project, options, subagents, titles) {
  const lines = [`${project.title} (${project.path}) — ${project.sessions.length} 个会话`];
  const shown = project.sessions.slice(0, options.maxSessionsPerProject);
  for (const record of shown) {
    const header = record.header;
    const title = titles.get(header.id) ?? "(无标题)";
    const children = subagents.get(header.id) ?? 0;
    const childNote = children > 0 ? ` · ${children} 个子会话` : "";
    lines.push(
      `- ${title} · ${header.id} · ${formatTime(header.createdAt)}${childNote}` +
        (header.origin === "subagent" ? " · 子会话" : ""),
    );
  }
  if (project.sessions.length > shown.length) {
    lines.push(`（只列最近 ${options.maxSessionsPerProject} 个）`);
  }
  if (shown.length === 0) lines.push("（这个项目下没有会话记录）");
  return lines.join("\n");
}

/**
 * `session_projects` 的完整执行。
 * @param {any} ctx 插件上下文。
 * @param {any} config 归一化配置。
 * @param {any} args 模型参数。
 * @param {any} exec 工具执行上下文。
 * @returns {Promise<string>} 工具结果文本。
 */
export async function executeProjects(ctx, config, args, exec) {
  const signal = exec?.signal;
  const caller = await resolveCaller(ctx, exec, signal);
  const registry = ctx.get("workspaceRegistry");
  const workspaces =
    registry === undefined
      ? []
      : registry.list().map((workspace) => ({ path: workspace.path, title: workspace.title }));
  const records = await ctx.sessionQuery.listSessions(signal);
  const index = buildProjectIndex(workspaces, records);
  const includeUnregistered = args?.include_unregistered === true;
  const query = typeof args?.project === "string" ? args.project : "";

  if (query.trim() !== "") {
    const candidates = [
      ...index.registered,
      ...index.unregistered.map((bucket) => ({ ...bucket, title: bucket.path })),
    ];
    const matches = matchProjects(candidates, query);
    if (matches.length === 0) {
      throw new LensError(
        CODES.unknownProject,
        `no project matches ${JSON.stringify(query)}; call session_projects without "project" to list them`,
      );
    }
    const titles = await readTitles(ctx, records, signal);
    const subagents = subagentCounts(records);
    return matches
      .slice(0, 3)
      .map((project) => renderProjectSessions(project, config, subagents, titles))
      .join("\n\n");
  }

  return renderProjectDirectory(index, {
    maxProjects: config.maxProjects,
    includeUnregistered,
    callerCwd: caller.cwd,
    totalSessions: records.length,
  });
}

/**
 * 批量读标题；单个会话失败不影响其余。
 * @param {any} ctx 插件上下文。
 * @param {readonly {header: any}[]} records 会话记录。
 * @param {AbortSignal} [signal] 取消信号。
 * @returns {Promise<Map<string, string>>} 会话 id → 标题。
 */
export async function readTitles(ctx, records, signal) {
  const ids = records.map((record) => record.header.id);
  /** @type {Map<string, string>} */
  const titles = new Map();
  if (ids.length === 0) return titles;
  const observations = await ctx.sessionQuery.readTitleSnapshots(ids, signal);
  for (const observation of observations) {
    if (observation.status !== "fulfilled") continue;
    const title = observation.value?.title?.title;
    if (typeof title === "string" && title !== "") titles.set(observation.sessionId, title);
  }
  return titles;
}
