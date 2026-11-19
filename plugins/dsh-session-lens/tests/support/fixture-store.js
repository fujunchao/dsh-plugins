/**
 * 测试用的 `ctx.sessionQuery` 假实现（仅测试用）。
 *
 * 只实现本插件真正用到的方法子集，行为对齐 `dsh-session-query` 的公开契约：
 * `listSessions` / `filterSessions` / `readTitleSnapshots` / `listEvents` /
 * `readSurface` / `readSession` / `searchSessions`。
 *
 * 表层折叠是**近似**的（不做 compaction replacement），因为插件只消费服务给出的结果，
 * 不自己折叠；近似只影响 fixture 数据的形状，不影响被测逻辑。
 */

import { SURFACE_TYPES } from "./corpus.js";

/**
 * 取一条消息事件的可搜索文本。
 * @param {any} event 会话事件。
 * @returns {string} 文本。
 */
export function eventTextOf(event) {
  const payload = event?.data;
  const message = event?.type === "user/message" ? payload : payload?.message;
  if (!message || !Array.isArray(message.content)) return "";
  const parts = [];
  for (const block of message.content) {
    if (block?.type === "text") parts.push(String(block.text ?? ""));
    else if (block?.type === "reasoning") parts.push(String(block.text ?? ""));
    else if (block?.type === "tool-call") parts.push(`${block.name} ${block.arguments ?? ""}`);
  }
  return parts.join("\n");
}

/**
 * 造一个只读的 sessionQuery 假实现。
 * @param {{header: any, events: any[]}[]} sessions 会话。
 * @param {{failSearch?: boolean}} [options] 选项。
 * @returns {any} 服务假实现。
 */
export function createFixtureStore(sessions, options = {}) {
  const byId = new Map(sessions.map((session) => [session.header.id, session]));
  const records = sessions
    .map((session) => ({ header: session.header, live: false, persisted: true }))
    .sort((left, right) => (right.header.createdAt ?? 0) - (left.header.createdAt ?? 0));

  const requireSession = (id) => {
    const session = byId.get(id);
    if (session === undefined) {
      const error = new Error(`session ${id} not found`);
      error.code = "SESSION_QUERY_SESSION_NOT_FOUND";
      throw error;
    }
    return session;
  };

  return {
    async listSessions() {
      return records.map((record) => ({ ...record, header: { ...record.header } }));
    },

    async filterSessions(filters = []) {
      const matches = records.filter((record) =>
        filters.every((filter) => {
          switch (filter.kind) {
            case "id":
              return filter.values.includes(record.header.id);
            case "cwd":
              return filter.values.includes(record.header.cwd ?? null);
            case "parent":
              return filter.values.includes(record.header.parentSession ?? null);
            case "availability":
              return filter.values.includes("persisted");
            default:
              return true;
          }
        }),
      );
      return matches.map((record) => ({ ...record, header: { ...record.header } }));
    },

    async readTitleSnapshots(ids) {
      return ids.map((sessionId) => {
        const session = byId.get(sessionId);
        if (session === undefined) {
          return { sessionId, status: "rejected", reason: new Error("missing") };
        }
        const titleEvent = [...session.events].reverse().find((event) => event.type === "session/title");
        const title =
          titleEvent === undefined
            ? undefined
            : {
                title: titleEvent.data.title,
                messageSeqs: titleEvent.data.messageSeqs ?? [],
                source: titleEvent.data.source ?? { kind: "fallback" },
                eventSeq: titleEvent.seq,
                updatedAt: titleEvent.time,
              };
        return {
          sessionId,
          status: "fulfilled",
          value: { session: session.header, title },
        };
      });
    },

    async readTitle(sessionId) {
      const session = byId.get(sessionId);
      if (session === undefined) return undefined;
      const titleEvent = [...session.events].reverse().find((event) => event.type === "session/title");
      if (titleEvent === undefined) return undefined;
      return {
        title: titleEvent.data.title,
        messageSeqs: titleEvent.data.messageSeqs ?? [],
        source: titleEvent.data.source ?? { kind: "fallback" },
        eventSeq: titleEvent.seq,
        updatedAt: titleEvent.time,
      };
    },

    async listEvents(sessionId) {
      const session = requireSession(sessionId);
      return session.events.map((event) => ({
        sessionId,
        seq: event.seq,
        type: event.type,
        time: event.time,
        surface: SURFACE_TYPES.has(event.type) ? "current" : "log-only",
      }));
    },

    async readSurface(sessionId) {
      const session = requireSession(sessionId);
      const events = session.events
        .filter((event) => SURFACE_TYPES.has(event.type))
        .map((event) => ({ ...event, surfaceOp: "append" }));
      return {
        session: session.header,
        inheritedEventCount: 0,
        capturedThroughSeq: session.events.at(-1)?.seq ?? null,
        events,
      };
    },

    async readSession(sessionId) {
      const session = requireSession(sessionId);
      return { session: session.header, inheritedEventCount: 0, events: session.events };
    },

    async searchSessions(request = {}) {
      if (options.failSearch === true) {
        const error = new Error("full-text search is disabled");
        error.code = "SESSION_QUERY_SEARCH_DISABLED";
        throw error;
      }
      const needle = String(request.query ?? "").toLowerCase();
      const cwdFilter = (request.sessionFilters ?? []).find((filter) => filter.kind === "cwd");
      const hits = [];
      for (const record of records) {
        if (needle === "") continue;
        if (cwdFilter !== undefined && !cwdFilter.values.includes(record.header.cwd ?? null)) continue;
        const session = byId.get(record.header.id);
        let bestMatch;
        for (const event of session.events) {
          if (!SURFACE_TYPES.has(event.type)) continue;
          const text = eventTextOf(event);
          const at = text.toLowerCase().indexOf(needle);
          if (at < 0) continue;
          bestMatch = {
            sessionId: record.header.id,
            seq: event.seq,
            type: event.type,
            time: event.time,
            surface: "current",
            snippet: text.slice(Math.max(0, at - 40), at + needle.length + 80),
          };
          break;
        }
        if (bestMatch !== undefined) hits.push({ ...record, bestMatch });
        if (hits.length >= (request.limit ?? 10)) break;
      }
      return { items: hits };
    },
  };
}

/**
 * 包一层 `ctx`，只提供本插件用到的服务。
 * @param {any} sessionQuery 服务假实现。
 * @param {{registry?: {path: string, title: string}[]}} [options] 选项。
 * @returns {any} 假上下文。
 */
export function createFixtureContext(sessionQuery, options = {}) {
  const workspaceRegistry =
    options.registry === undefined
      ? undefined
      : {
          list: () => options.registry.map((entry) => ({ ...entry, sessionIds: [] })),
        };
  return {
    sessionQuery,
    get: (name) => (name === "workspaceRegistry" ? workspaceRegistry : undefined),
  };
}

/**
 * 造一个调用方执行上下文。
 * @param {any} header 调用方会话 header。
 * @param {AbortSignal} [signal] 取消信号。
 * @returns {any} 工具执行上下文。
 */
export function createExec(header, signal) {
  return {
    agent: { id: header.id, session: { id: header.id, header } },
    signal: signal ?? new AbortController().signal,
  };
}
