# dsh-model-tuning 实施方案（v1）

> 定契依据：本目录 `docs/adr/0001`–`0008`，词汇见工作区 `GLOSSARY.md`。

## v2 增补（2026-11-18）：供应商管理

上游 rc.3 的 Models 设置页已经能新增手写供应商（含"高级"折叠里的档位编辑器），但**目录路由的模型永远没有档位控件**，而本机三条供应商里 `deepseek` 与 `google` 都是目录路由（见 ADR 0007 与 ADR 0008）。v2 因此补四件事：

| 能力 | 做法 |
|---|---|
| 新建供应商 | 插件页内联表单：「家族模板」预填 `api`/`baseURL`/档位模板，填 route id、显示名、密钥与**至少一个模型**，一次 `settings.mutate` 原子写入（空供应商会被 schema 拒） |
| 给供应商加模型 | 整段替换该路由的 `models`；纯目录路由写 `modelOverrides.<id>`（ADR 0008） |
| 删除 | 自建/用户层路由可删（判定同原生 `removable`：user 层有、base 层没有）；删最后一个模型 = 删整条供应商；要求键入 id 并列出影响面 |
| 验证与兜底 | 「检测连通」复用 `ctx.llm.discoverModels`；「试跑一次」真发最小请求并明示计费；结构变更前快照 `providers` 子树到 `~/.dsh/model-tuning-backups/`，保留 10 份，可撤销；检测到 cc-switch 在管这份配置时显示一行提示 |

不做：改 route id（只能删了重建）、导入/导出、插手 composer 的排序与标记、解析 cc-switch 数据库。界面仍只有 `plugins.row.config` 一个落点（ADR 0004 修订）。

## v3 增补（2026-11-19）：就地编辑与默认档位

两个缺口：供应商区块的模型行只有「删除」；「添加模型」表单无法表达"这个模型默认用哪一档"。定契见 `docs/adr/0009-edit-and-default-effort.md`。

| 能力 | 做法 |
|---|---|
| 编辑模型 | 行内展开、按行保存；可改显示名 / 上下文窗口 / 最大输出 / 输入模态 / 思考等级声明 / 默认档位与锁定 / id（id 改动一次原子写，并迁移插件状态里指向旧 id 的「插件默认」） |
| 编辑供应商 | 显示名 / baseURL / 协议 `api` / 密钥内容；route id 与 `apiKeyEnv` 引用名只读；改 baseURL 或协议后必须先过「检测连通」 |
| 检测连通 | 已存在的供应商也提供（此前只活在新建表单里），ADR 0007 的"保存后必须有一次显式校验"由此落地 |
| 供应商默认档位 | 写 `provider.reasoning`（上游原生，整条供应商一个值）：请求兜底与 composer 换模型时的预填都认 |
| 模型默认档位 + 锁定 | 写插件状态 `modelEfforts`；留空继承供应商默认档位；锁定时被选中即套用，压过「档位跨模型保持」 |
| 撤销 | 合并为「撤销上一次写入」，编辑也落快照；整条覆盖前复核当前值是否仍等于上次写入后的值 |
| 与原生页的边界 | 自本条起接受字段重叠：两边同写 `llm-pi-ai`，按 revision 报冲突 |

不做（v3 明确否决）：给模型造私有的"默认档位"配置字段、请求级改档（显示与实际不一致）、接管 composer 模型槽、自定义 `apiKeyEnv` 引用名、两个撤销按钮、编辑用弹窗、冲突时字段级自动合并。

交付顺序：先把 v2 真机验证跑掉（等宿主重启）→ 第一批「编辑」（纯 UI 与写入层）→ 第二批「默认档位」（动 hooks，需验新会话首用 / 会话内切模型 / 锁定压过保持）。

### v3 第一批（编辑）实施状态（2026-11-19）

| 项 | 状态 | 证据 |
|---|---|---|
| `lib/providers.js`：`PROVIDER_FIELDS`、`normalizeProviderEdit`、`buildProviderFieldOps`、`buildModelRenameOps` | 完成 | `test/providers.test.js` |
| `lib/snapshots.js`：快照加 `after` 子树、`attachAfter` 事后补写 | 完成 | `test/snapshots.test.js` |
| `lib/tune.js`：`write` 支持改 id（显式 models 元素替换 / 目录路由 set 新键 + unset 旧键）、`editProvider`、`discoveryRequest`（端点可被显式覆盖）、`undoStructure` 的 `after` 复核 | 完成 | `test/tune.test.js` |
| `lib/routes.js`：`/model` 透传 `modelId` + `defaultsMigrated`、新端点 `/provider/edit`、`/discover` 支持 `{route, baseURL?, api?}`、`/provider/undo` 透传 `force`（`stale` 双形状） | 完成 | `test/routes.test.js` |
| `lib/client.js`：模型行与供应商头就地编辑、已有供应商「检测连通」（带表单值覆盖）、撤销改「撤销上一次写入」+ `stale` 二次确认 + slug→人话 | 完成 | `test/client.test.js` |
| 测试 | **152 例全绿**（v2 结束时 106） | `node --test` |
| 真机验证 | **待宿主重启** | 见下面的清单 |

第一批真机验收（重启宿主后）：
1. 模型行「编辑」→ 改显示名保存 → 列表即时更新；「撤销上一次写入」→ 提示「已撤销：编辑模型（cli）」。
2. 模型行「编辑」→ 改 id 保存 → 老 id 消失、新 id 出现；若它正好是「插件默认」，区块里的默认模型跟着变（`defaultsMigrated`）。
3. 供应商头「编辑」→ 只改 baseURL 直接保存 → 弹「还没检测连通，仍要保存吗？」；取消则不写。
4. 同一表单点「检测连通」→ 探的是**表单里**的地址（故意填错应报错，改对后报「连通，N 个模型」）。
5. 只改显示名或只改密钥 → 保存不弹确认。

## 0. 实施状态（2026-11-17）

已实现并装上 desktop profile，54 个 `node --test` 全绿；宿主路由在运行中的宿主上实测通过：

| 项 | 状态 | 证据 |
|---|---|---|
| 状态文件 + 原子写 | 完成 | `test/state.test.js` |
| 设置读取/写入（含 revision 冲突翻译） | 完成 | `test/tune.test.js`、`test/routes.test.js`；真机 `POST /model` 返回 200 且同值写入零 YAML 漂移 |
| 新会话默认模型 + 团队默认钩子 | 完成 | `test/hooks.test.js`（过滤表、team root 判定、lastApply） |
| 档位跨模型保持 | 完成 | `test/hooks.test.js`（补正 / 去重 / 开关 / 显式挑档不干预） |
| 团队任务先行提示（可选 systemPrompt） | 完成 | `test/task-first.test.js`（默认关、非团队会话不注入、isEnabled 抛错降级） |
| 插件页 UI（四块） | 完成 | `test/client.test.js`（接线）；页面渲染由客户端半自身空壳渲染自测覆盖 |
| xhigh 补丁检测/应用/回滚 | 完成 | `test/xhigh.test.js`（19 例，含真实源码行为 harness） |
| 真机补丁写入 | **待重启后执行** | 宿主运行时 `rename` 必 EPERM；已实测失败路径不留下 staging/备份垃圾 |
| clean-route 的 xhigh 退役 | 完成 | 其 43 个测试仍全绿；`/clean-route/xhigh/apply` 返回 410 |

### v2（2026-11-18）实施状态

| 项 | 状态 | 证据 |
|---|---|---|
| `lib/providers.js`：校验/op 生成/模板/派生规则 | 完成 | `test/providers.test.js`（21 例） |
| `lib/snapshots.js`：结构快照与保留策略 | 完成 | `test/snapshots.test.js`（7 例） |
| `tune.js`：create/delete provider、add/remove model、undo、`modelOverrides` 分支 | 完成 | `test/tune.test.js`、`test/routes.test.js` |
| `routes.js`：`/provider`、`/model/add`、`/model/remove`、`/discover`、`/provider/undo` | 完成 | `test/routes.test.js`（新增 15 例） |
| 客户端「供应商」区块 | 完成 | `test/client.test.js`（接线 + 字典键对齐 + 空壳渲染 + **信封/插件状态的回归**） |
| 修 `/state` 信封被当成插件状态的旧 bug | 完成 | 三个开关"勾了又变回没勾"、默认模型首次打开为空、摘要行恒显示"未设置"，同源。`payloadState()` 收口 + 回归用例 |
| 真机验证（热生效，不重启） | **完成（2026-11-19，宿主重启后）** | 接口层：`/providers` 已带 `protocols`/`templates`、`/state` 信封与三个开关回归正常、写路径护栏 400/409 正确且 revision 零漂移；人工链路：新建供应商 → composer 立即出现模型、加模型、撤销、删最后一个模型升级为删供应商并清掉 `.credentials.yaml` 里的派生引用（2026-11-19 用 `probe-v2` 走 API 复验，revision 5→8，验完已清理） |

## 1. 一句话

给 DSH 补三个它有能力但没界面的东西：**每个模型的思考等级（含 Gemini 的 xhigh）**、**新会话的默认模型/档位**、**新会话默认开启智能体团队**；外加一个**档位跨模型保持**的修正。界面落在插件页的本插件行配置槽里。

## 2. 包结构（零构建纯 ESM，沿用本工作区惯例）

```
dsh-model-tuning/
├── package.json          # dsh.bundle.patch + dsh.client(platform:web, inject:[locale, plugin-manager])
├── cordis.patch.yml      # insert: { id: model-tuning, name: dsh-model-tuning, config: {...} }
├── lib/
│   ├── index.js          # 宿主半：apply(ctx, config)
│   ├── state.js          # ~/.dsh/model-tuning.json 读写（原子替换）
│   ├── routes.js         # /model-tuning/* 前缀路由
│   ├── tune.js           # 读写 llm-pi-ai 的 settings.mutate 封装（路径 op + revision）
│   ├── hooks.js          # agent/created 默认注入 + session/event 档位补正
│   ├── asar.js           # 从 dsh-clean-route 移植：readHeader/walkFiles/readEntry/replaceEntryText
│   ├── xhigh.js          # 补丁检测/应用/回滚/校验
│   └── client.js         # 客户端半：__ModuleLoader__.load({ id, factory })
├── docs/adr/             # 已写 0001–0005
├── docs/plan.md          # 本文
└── test/                 # node:test，fixture asar 复用 dsh-clean-route/scripts/build-fixture.mjs
```

## 3. 状态文件 `~/.dsh/model-tuning.json`

```json
{
  "version": 1,
  "defaults": { "provider": "deepseek", "model": "deepseek-v4.1-flash", "reasoningEffort": "max" },
  "teamDefaultEnabled": false,
  "carryEffort": true,
  "lastApply": { "at": "2026-11-17T21:40:00+08:00", "sessionId": "…", "ok": true, "error": null }
}
```

- 写：临时文件 + `rename` 原子替换，权限 0600；读失败/损坏 → 用默认值并记 warn，不阻塞启动。
- **不写** `agent-default-model`、**不写** `agent-team`（ADR 0002）。
- `defaults` 的合法性在写入前用 `ctx.llm.resolveModelInfo(provider, model)` 校验；不支持则拒绝并回错误文案。

## 4. 宿主半

### 4.1 依赖

```js
export const name = 'model-tuning'
export const inject = ['webServer']            // 必需
// 可选能力一律 ctx.get / ctx.inject 探测：settings、agentTeams、llm、configEditor(不用)
```

`agent/created` 与 `session/event` 的监听不需要 inject（根 ctx 无 scope 标签 → 收全部会话）。

### 4.2 新会话默认（ADR 0002）

```
ctx.on('agent/created', async ({ agent, source, signal }) => {
  if (source !== 'startup') return                      // resume/clear/compact 不动
  if (agent.session.header.origin === 'subagent') return
  if (agent.session.header.isSeeded) return             // fork 出来的会话保留父选择
  agent.model.select(defaults)                          // 同步、写 model/selection，优先于 agentDefaultModel
  if (state.teamDefaultEnabled && ctx.subagents.rootOf(agent) === agent)
    await ctx.agentTeams.setEnabled(agent, true, signal) // 与上游 defaultEnabled 同构
})
```
失败只记 `lastApply` + warn，绝不阻断会话创建。

### 4.3 档位跨模型保持（ADR 0005）

```
ctx.on('session/event', (session, event) => {
  if (!state.carryEffort || event.type !== 'model/selection') return
  …在微任务里：查 resolveModelInfo → 命中"看起来是自动重置"→ append 一次修正的 model/selection
})
```
- 去重键 `session.id + 目标 provider/model + 上一档`；同键只补一次。
- 判定不成立即静默返回；只有 `agent.model.select()` 抛错才记 warn（2026-11-19 核对：原文档写的"补正后仍等于默认档 → 记 warn 并放弃"从未实现）。
- 开关关闭时监听器直接 return，行为与原生一致。

### 4.4 路由（前缀 `/model-tuning`，同源 fetch，无鉴权层——与既有插件一致）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/state` | 插件状态 + DSH 当前默认（只读）+ 档位全集 + **补丁三态** + app 版本 + 能力探测 + 外部管理者标记（补丁没有独立的 GET 端点，2026-11-19 核对） |
| POST | `/defaults` | 写 `defaults`（先校验 provider/model/档位） |
| POST | `/team-default` | 切 `teamDefaultEnabled` |
| POST | `/carry-effort` | 切 `carryEffort` |
| GET | `/providers` | 提供商与模型清单：来自 `ctx.settings.describe()` 的 `llm-pi-ai` 视图（value/base 合并后），加上 `reasoningEfforts`→档位展示；每条另带 `userOwned`（可删可改）、`modelsExplicit`（决定档位写到哪层，ADR 0008） |
| POST | `/model` | `settings.mutate('llm-pi-ai', ops, revision)`；冲突返回 `{code:'conflict', expected, actual}` |
| POST | `/provider` | 新建一条供应商：`{route, displayName, api, baseURL, key, models[], revision}`；先写 profile（含 `apiKeyEnv`）再写凭据，任一步失败都要点名 |
| DELETE | `/provider` | 删除供应商：`unset ['providers', route]` + 删派生凭据；返回被一并删掉的模型数 |
| POST | `/model/add` \| `/model/remove` | 加/删一个模型行；删掉最后一个模型时升级为删整条供应商并在响应里说明 |
| POST | `/discover` | 调 `ctx.llm.discoverModels('llm-pi-ai', {provider\|baseURL, api, apiKey})`，返回候选模型 |
| POST | `/provider/undo` | 用最近一份结构快照恢复 `providers` 子树 |
| ~~GET~~ | ~~`/patch`~~ | **不存在**：补丁三态由上面的 `/state` 带出（2026-11-19 实测 404） |
| POST | `/patch/apply` \| `/patch/rollback` | 打补丁 / 回滚（都要求随后重启应用） |

`/providers` 与 `/model` 的字段范围（ADR 0003 / Q10 定契）：**模型级** `reasoningEfforts`、`compat.*`（精选：`supportsReasoningEffort`/`thinkingFormat`/`maxTokensField`/`supportsDeveloperRole`/`supportsStore`）、`modelOverrides.<id>`；**提供商级** `defaultContextWindow`/`defaultMaxTokens`/`defaultInput`、`thinkingBudgets`、`reasoning`。不编辑 ~~`contextWindow`/`maxTokens`/`input`~~（**v3 起改**：这三项在供应商区块的编辑表单里可改，接受与原生页重叠，见 ADR 0009），不编辑 `retryPolicy`/`timeoutMs`/`headers`（运维级，官方页或 patch 层）。

### 4.5 补丁（ADR 0001）

- 目标：`…/resources/app.asar` 内 `dsh/node_modules/@earendil-works/pi-ai/dist/api/google-shared.js`。
- 检测：读该条目，判断 Google 档位表是否含 `xhigh` 分支（不只看字符串命中，要校验结构与既有补丁标记）。
- 应用：备份原 asar → 条目级替换 → 校验（重读比对）→ 提示重启。
- 回滚：从备份还原该条目。
- **不做**运行时注入、不自建 adapter、不改协议（ADR 0001 的否决项）。

## 5. 客户端半

落点：`plugins.row.config`，key `dsh-model-tuning#model-tuning`（ADR 0004）。页面五块：

0. **供应商管理**（v2）：供应商列表（可删的带「自建」标记与删除按钮）→ 展开看模型行（可加/删/改档位）→ 顶部「+ 添加供应商」内联表单（家族模板 + route id + 显示名 + baseURL + 协议 + 密钥 + 至少一个模型行）；每块都有「检测连通」，保存前显示将写入的层（`models` 还是 `modelOverrides`），底部有「撤销上一次结构变更」。
1. **新会话默认**：provider → model → 档位三级选择；旁边灰字显示「DSH 当前默认」；开关「新会话默认开启智能体团队」（默认关，附降级提示）；开关「换模型时保持档位」（默认开）。
2. **模型高级字段**：提供商列表 → 模型列表 → 展开编辑 `reasoningEfforts`（档位下拉 × API 参数值，支持 `off: null`；Gemini 路由给 xhigh 时显示警告：宿主补丁不在位则请求会失败）与上述 `compat`/`modelOverrides`；提供商级的三个默认值与 `thinkingBudgets`。保存走 `/model`，冲突时提示"已被外部改动，已载入最新值，请重试"。
3. **宿主补丁状态**：三态徽标 + app 版本 + 目标路径 + 备份路径 + 「打补丁」「回滚」，成功后提示必须重启应用。
4. **额外席位**：`settings.models.footer` 与 `settings.models.provider-card` 各注册一行「在 dsh-model-tuning 里编辑思考等级」的跳转，不做重逻辑。

## 6. dsh-clean-route 的收尾

- 设置页 xhigh 区块改为只读提示 + 跳转本插件；`xhigh` 相关 config 默认关闭。
- 代码保留（asar 读写模块仍被本插件移植使用），但**不再执行补丁写入**。
- 其 ADR `0003-xhigh-patch-custody.md` 标注被本插件 ADR 0001 取代。

## 7. 验收（人工 + 自动）

自动（`node --test`）：
1. 状态文件读写/损坏回退/原子性；
2. `agent/created` 过滤表：startup×seeded×subagent×resume 四种组合；
3. 补丁检测：干净 asar / 已打 / 补丁被冲掉 三个 fixture；
4. settings 路径 op 生成与 `unset` 回退语义；
5. 档位补正的幂等与防循环（构造事件序列）；
6. v2：供应商草稿校验（route 正则/撞车/空模型/行号）、`off` 可为 null 其余必须非空、删最后一个模型升级为删供应商、`diffProviderOps` 的增改删、快照的保留与坏文件跳过、五个新端点的状态码与 op 形状、zh/en 字典键对齐。

人工（装到 desktop profile 后）：
1. 插件页设默认 → 新建会话首次请求即为该模型与档位；
2. 会话内换模型 → 档位保持（目标支持时）；关掉开关后不再保持；
3. 团队开关打开 → 新会话自带 `team_task_*` 工具；关掉 → 回到现状；
4. 插件页改某模型 `reasoningEfforts` → **不重启**，composer 档位菜单立即变化；
5. Gemini 路由声明 xhigh → 三态显示「待打补丁」→ 打补丁 + 重启 → 请求成功、不再抛 `Unsupported Google thinking level mapping`；
6. fork 一个会话 → 不被插件默认覆盖；
7. 停用插件 → 一切回到 DSH 原生行为，`~/.dsh/model-tuning.json` 保留但不生效。
8. v2：插件页新建一个中转站供应商（模板=中转站）→ 保存后 composer 模型菜单**不重启就出现**该模型；
9. v2：给一条**继承目录**（配置层没有显式 `models`）的路由改档位 → 落到 `modelOverrides`，`cordis.patch.yml` 里 `models` 没有被物化。（2026-11-19 实测：本机 `cli`/`deepseek`/`google` 三条都已有显式 `models`，所以这条手工验收在当前配置下**无法执行**——改由 `test/tune.test.js` 的 `modelOverrides` 分支覆盖；要手工验须临时造一条继承目录的路由。）
10. v2：删掉一条供应商的最后一个模型 → 供应商一起消失，`~/.dsh/.credentials.yaml`（注意是点开头的文件）里对应引用也被删；
11. v2：故意填错 baseURL → 「检测连通」报错；填对后能拉到候选模型并勾选加行；
12. v2：新建后点「撤销上一次结构变更」→ 供应商消失、revision 前进。

## 8. 已知风险

| 风险 | 缓解 |
|---|---|
| 档位补正改写上游提交流程 | 单独开关（默认开）+ 幂等去重 + 失败即放弃 + 可退化为客户端实现（ADR 0005） |
| asar 补丁被 app 升级冲掉 | 常驻检测 + 三态展示 + 一键重打；不静默 |
| `settings.mutate` revision 跨重启归零 | 冲突时总是重新 describe 再提示重试，不自动重写 |
| `team/mode` 使旧版 DSH 读不了会话 | 团队开关默认关 + 开关旁明示 |
| 补丁写入期间文件被占用 | 明确报错 + 保留备份路径，不重试 |
