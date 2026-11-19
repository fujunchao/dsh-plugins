# 新会话的默认模型与团队开关走 `agent/created` 钩子，不写上游配置

需求是「新开会话时用我设定的模型与档位」和「新开会话默认开启智能体团队」，而不是「改变整个部署的默认」或「强制所有会话」。

上游为此提供的两条配置路都有代价：

- `agent-default-model`（`provider`/`model`/`reasoningEffort`）是进程级默认，但**任何一次 composer 或 `/model` 的模型切换都会在后台 `saveSelection()` 改写它**（`dsh-api-session-controller/src/commands.ts:180`），所以「设好就不再变」无法用配置表达。
- `agent-team.defaultEnabled` 能对新会话自动开团队，但它的 Config **没有 volatile 字段**，改一次就要重载 `agent-team` 那一行；重载会重建 projection 注册与 journal 串行队列，in-flight 的团队任务受影响，还会连带重启 `dsh-tool-agent-team`。

而 `agent/created` 是 `serial` 且被 `await` 的事件，发生在 maintenance 阶段、第一次 prompt 组装之前（`dsh-agent-loop/src/index.ts:622-651`），从这里写入的选择一定先于首个请求生效。

## Considered Options

- **写 `agent-default-model` + 写 `agent-team.defaultEnabled`**：语义最"正"，但前者会被静默改写（等于没设），后者要重载插件行。
- **只在 UI 里引导用户手改 patch**：等于没做插件。
- **钩子实现**（采纳）：`agent.model.select(...)` 写会话内 `model/selection`（优先于 `agentDefaultModel`），`ctx.agentTeams.setEnabled(agent, true)` 写 `team/mode`，两者都只作用于新会话。

## Consequences

- 插件自己的默认值（provider/model/思考等级、团队是否默认开）存在插件自有状态文件 `~/.dsh/model-tuning.json`，**不写** `agent-default-model`，从而与上游「最近一次选择」互不干扰；插件页把「DSH 当前默认（只读）」与「插件默认」并排显示，并写明「会话内换模型会改写前者，不会改写后者」。
- 团队默认开关**装好后默认关闭**：安装本插件不改变任何现有行为，用户在插件页打开一次后才对新会话生效；开关旁标明「会让新会话写入 `team/mode` 事件，旧版 DSH 无法读取」。
- 钩子必须过滤：`source === 'startup'`、`session.header.origin !== 'subagent'`、非 seeded（fork 出来的会话不覆盖父会话的选择）。
- 会话内仍然可以随意改模型与档位（composer 原生能力），改的是会话，不是插件默认。
- 插件被停用后行为立即回到 DSH 原生语义，不留配置残渣。
