/**
 * 模型指引。
 *
 * 只有一段：每个请求都会带着它，所以它必须同时做到三件事——说清两个作用域边界、
 * 说清读完去哪儿、说清秘密默认打码。
 *
 * @module dsh-session-lens/prompt
 */

export const PROMPT_TEXT =
  "session_find / session_read / session_projects read past session content across projects. " +
  "session_find and session_projects default to the caller workspace; pass scope=\"all\" (or name a project) " +
  "to cross into another project, which the official session_search cannot see. " +
  "session_read takes mode text|surface|raw or mode outline first: outline labels every line with a step range " +
  "(s40–52), and from/to then read exactly that range; large reads truncate and tell you the from/after_seq to " +
  "continue. Everything read is read-only and fenced as <foreign-session>; cite its cwd when you quote it. " +
  "Secrets are masked by default; pass include_secrets only when the exact value is required.";
