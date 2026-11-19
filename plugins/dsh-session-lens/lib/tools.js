/**
 * 三个工具的定义。
 *
 * 描述的第一句**必须是可判定的作用域边界**（“本工作区” vs “本机每个项目”）——这是
 * 模型区分本插件与官方 `session_*` 五件套的唯一可靠依据，名字前缀做不到这件事。
 *
 * 参数 schema 手写成标准 JSON Schema（`type` / `properties` / `required` /
 * `additionalProperties` / `enum`），因为这层不导入任何 `@deepseek-ai/*` 包。
 *
 * @module dsh-session-lens/tools
 */

/** @type {readonly any[]} */
export const TOOLS = Object.freeze([
  {
    name: "session_projects",
    description:
      "List the projects on this machine and the sessions inside them. " +
      "Scope: EVERY project on this machine, not just the caller workspace. " +
      "Use it when you do not know which project some work lives in, or when the question names a different " +
      "project. Directories that hold sessions but are not registered projects stay folded unless " +
      "include_unregistered is true. Pass project (a title or path fragment) to expand one project's sessions.",
    isConcurrencySafe: false,
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Project title or path fragment. Omit it to list every project.",
        },
        include_unregistered: {
          type: "boolean",
          description: "Also list cwd buckets that hold sessions but are not registered projects.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "session_find",
    description:
      "Search the text of past session content. " +
      'Scope: the caller workspace ONLY by default; pass scope="all" to search EVERY project on this machine, ' +
      "which the official session_search cannot see. Each hit names the session, its project, the step number and a " +
      "snippet, so a session_read call can open exactly that step range. Excludes the caller session and, by default, " +
      "subagent sessions.",
    isConcurrencySafe: false,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Literal text to match (case-insensitive substring scan, not semantic search).",
        },
        scope: {
          type: "string",
          enum: ["workspace", "all"],
          description: '"workspace" (default) only searches the caller workspace; "all" searches every project.',
        },
        include_subagents: {
          type: "boolean",
          description: "Also search subagent sessions (half of all sessions on a busy machine).",
        },
        limit: {
          type: "integer",
          description: "Maximum number of sessions to return.",
        },
        include_secrets: {
          type: "boolean",
          description: "Return snippets unmasked. Off by default; only when the exact value is required.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "session_read",
    description:
      "Read one session on this machine, including sessions from other projects. " +
      "modes: outline (a directory: one line per step, paragraph or turn, each line naming the step range, " +
      "user question, tool counts and size), text (user + assistant " +
      "words only), surface (what that session's model actually saw, including tool calls and results; default), " +
      "raw (unabridged event log). Reads that exceed the budget truncate and return the from/after_seq to continue; " +
      "a whole session that does not fit returns its outline first. Read-only: nothing is resumed, forked, renamed " +
      "or deleted. Secrets are masked unless include_secrets is true.",
    isConcurrencySafe: true,
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session id or dsh-session: reference. Omit to read the calling session.",
        },
        mode: {
          type: "string",
          enum: ["outline", "text", "surface", "raw"],
          description: "Reading depth. Defaults to surface.",
        },
        from: {
          type: "integer",
          description: "First step to read (0 includes the prologue before the first step). Omit to start at the beginning.",
        },
        to: {
          type: "integer",
          description: "Last step to read, inclusive. Omit to read to the end.",
        },
        after_seq: {
          type: "integer",
          description: "Resume after this event seq (the continuation hint returns it). Omit for a fresh read.",
        },
        include_secrets: {
          type: "boolean",
          description: "Return credential values unmasked. Off by default; only when the exact value is required.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
]);
