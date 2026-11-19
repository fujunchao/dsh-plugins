# 供应商由本插件主持生命周期，密钥只经凭据服务落地

上游（DSH 0.2.2-rc.3）的 Models 设置页已经能新增一条手写供应商：填 route id、显示名、baseURL、协议、密钥与至少一个模型，一次 `set ['providers', route]` 原子写入；每个模型行的"高级"折叠区里也有 `reasoningEfforts` 编辑器。所以本插件不再需要"造一条 route 的机制"，需要的是**把原生够不着的地方补上**：目录路由的模型永远没有档位控件（`ProviderEditor.tsx:257` 以 `declared === true` 为条件），而用户现有的三条供应商里 `deepseek` 与 `google` 恰好都是目录路由；此外原生把档位藏在一个供应商 N 个模型就是 N 次展开的折叠里，也没有任何家族模板。

因此本插件自己承担供应商的**新建、改字段、加删模型、删除**，落点仍是插件页（ADR 0004），与原生页写同一个 `llm-pi-ai` 命名空间、同一把 revision 锁。

## Considered Options

- **只做"补空白"、把新增交给原生页**：否决。原生页对目录路由无档位控件，用户的主用路由正好是这一类，跳来跳去等于功能没落地。
- **整页接管原生 Models 页**：否决。要跟着上游改版跑，且上游那份已经处理了凭据写入、route 唯一性竞态与行级校验。
- **重新引入 `ownedRoutes` 记录"谁建的"**：否决。用户经原生页建的供应商会被本插件判成"外部手写路由"→ 一个入口能删、另一个不能删。改用与原生同源的判定：**`user` 配置层有该 provider 路径、`base` 层没有 → 可删可改**（原生 `store.ts:255-258` 的 `removable`）。

## Consequences

- 供应商与它的**首个模型必须一次原子写入**：`llm-pi-ai` 对手写路由要求 `api` + `baseURL` + 非空 `models`，否则 `settings.mutate` 在 `assertServiceable` 处直接拒写，先建空壳再补模型这条路不存在。
- 密钥只经 `ctx.credentials.set(ref, value)` 写入（落 `~/.dsh/.credentials.yaml` 的 `refs`），profile 里只留 `apiKeyEnv`。引用名沿用上游惯例 `<ROUTE>_API_KEY`（`deriveKeyRef`）。**绝不**把明文密钥写进 `headers`——redactor 看不到它。
- 写了 `apiKeyEnv` 却解析不到凭据时，`llm-pi-ai` **不回落**到别的环境变量，而是让该路由的 `listModels` 返回空数组：表现在界面上是"供应商静默消失"，不是报错。因此保存后必须有一次显式校验（"检测连通"），并把"凭据已配置/未配置"直接显示在列表里。
- 删除供应商 = `unset ['providers', <route>]` **且**删除它派生的凭据引用；删掉某供应商的最后一个模型等同删除该供应商，确认文案合并为一次。
- 所有结构变更（新建/删除供应商、增删模型）前把 `providers` 子树快照到 `~/.dsh/model-tuning-backups/`，保留最近 10 份，界面提供"撤销上一次结构变更"。快照只含引用名，不含密钥。
- 外部工具 cc-switch 也在改写这份 profile 的 `providers`（`liveConfigManaged`）。本插件不解析它的数据库，只在检测到它存在时在区块顶部显示一行提示，避免"我加的供应商怎么没了"这类无从归因的事故。
- 两个入口并发写同一命名空间，冲突一律靠 revision 判 `settings/conflict` 并让用户重试，不自动重试、不静默覆盖。
