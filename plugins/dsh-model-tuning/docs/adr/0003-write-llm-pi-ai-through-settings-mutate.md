# `llm-pi-ai` 的设置只走 `settings.mutate`，不用 `configEditor.edit`

插件要写的是 `providers.<route>.models[].reasoningEfforts`、`compat`、`modelOverrides`、`defaultContextWindow/defaultMaxTokens/defaultInput`、`thinkingBudgets`、`reasoning` 这些字段。

上游有两条可写 seam，行为差别很大：

- `settings.mutate(ns, ops, expectedRevision)`：路径级 `{op:'set'|'unset', path[]}` 操作，带乐观锁，只接受 **volatile** 路径，冲突返回 `settings/conflict` 并附 `expected`/`actual`。
- `configEditor.edit(entry, change)`：整段 `config` 替换，无 revision 围栏，任何字段都能写。

`llm-pi-ai` 的 `providers` 整棵声明为 `.volatile()`（`dsh-llm-pi-ai/src/config.ts:384`），因此 `settings.mutate` 写它是**热生效**：不重载插件，route set 变化走 `registration.replace()`。

## Considered Options

- **`configEditor.edit` 整段写**：能干，但要自己读-改-写整段配置；任何并发改动（另一个标签页、用户手改 `cordis.patch.yml`）都会被静默吞掉，且 `unset` 的「回退继承值」语义要自己实现。
- **客户端直连 `remote.settings.mutate`**：可行（浏览器 principal 是 owner，无按插件的 Remote 授权），但宿主半反正要存在，两种写路径并存会让 revision 归属变复杂。
- **宿主半统一用 `settings.mutate`**（采纳）：路径级合并、乐观锁、volatile 热生效，一次都不用碰 loader 配置语义。

## Consequences

- 写入失败分两类：`settings/conflict`（revision 变了）与 `settings/rejected`（schema 或 volatile 校验失败）。两者都**报错给用户、载入最新值让人重试**，不做自动重试——配置类写入的静默重试等于「把我的改动悄悄丢掉」。
- `agent-team` 与 `agent-default-model` 都不写（见 ADR 0002），因此本插件**不调用 `configEditor`**，不承担「改 loader 配置导致插件重挂」的风险。
- 客户端不声明 `remote.settings`／`configForms`／`settingsSchema`：档位全集等选项由宿主半算好、随插件自己的 HTTP 路由下发，客户端只做界面。
