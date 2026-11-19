# dsh-model-tuning · 模型调校

给 DeepSeekRuntime 补几件它有能力、但没有界面（或界面够不着）的东西，外加两处修正：

| 能力 | 现状 | 本插件做什么 |
|---|---|---|
| 供应商与模型的增删 | 原生 Models 页能新建手写供应商，但档位编辑器藏在模型行的「高级」折叠里，且**目录路由永远没有档位控件** | 插件页「供应商」区块：新建（家族模板预填）、加/删模型、删供应商，档位一屏摆开 |
| 每个模型的思考等级 | `llm-pi-ai` 支持 `reasoningEfforts`，但设置页只对**手写路由**渲染编辑器；`deepseek`/`google` 这类目录路由没有控件 | 在插件页按「提供商 → 模型」编辑，含 Gemini 的 `xhigh`（并托管 pi-ai 的 asar 补丁） |
| 新会话默认模型与档位 | 只有 `agent-default-model` 配置，且会被任意一次会话内切换静默改写 | 插件页设「插件默认」，新会话创建时生效；会话内仍可随意改 |
| 新会话默认开启智能体团队 | 只有 `agent-team.defaultEnabled` 配置，没有 UI | 插件页开关（默认关），新会话创建时打开 |
| 换模型时保持档位 | 换模型会把档位重置成目标模型的默认档 | 只在「上游自动重置」时把上一档带回来（可关） |
| 团队任务板先建后用 | 上游 `TEAM_POLICY` 没要求 Lead 先建任务，子智能体常看到空板 | 可选的一段 systemPrompt：「派活前先建任务，空板就报告」（默认关） |

## 装

**从市场安装（推荐）**：DSH 插件页 → 发现 → 添加索引源，索引地址

```text
https://fujunchao.github.io/dsh-plugins/index.json
```

然后在「模型与供应商」分类里安装 `dsh-model-tuning`。装完刷新页面；宿主半要重启一次 DSH。

**在仓库里开发时**，用包里的 install 脚本（幂等；`--dry-run` 先看它要做什么）：

```powershell
node scripts/install.mjs
```

它做三件事：给 profile 建 `dsh-model-tuning` 的 junction；往 profile `package.json`
的 `dependencies` 加 `link:`、往 `dsh.profile.bundles` 加包名。**不往
`cordis.patch.yml` 插行**——本包自带 bundle patch，两处都插同一个 id 会让这行变成
「不可寻址行」，`plugin_manager` 就再也开关不了它。

装完若插件页看不到新行：重启一次 DSH。

入口：**插件页 → dsh-model-tuning → 配置**（`plugins.row.config`，key `dsh-model-tuning#model-tuning`）。

## 页面里有什么

1. **供应商**：列表（目录路由/手写路由、模型数、密钥引用、是否可删）→ 每个供应商可展开看模型行、删模型、加模型；「+ 添加供应商」内联表单（家族模板 → route id → 显示名/baseURL/协议/密钥 → 至少一行模型，含档位勾选）；「检测连通」调宿主的模型发现接口；底部「撤销上一次结构变更」。
2. **新会话默认**：provider / model / 档位；并排只读显示「DSH 当前默认」；三个开关——团队默认、档位保持、**团队任务先行提示**（默认关；开启后只对团队模式已开启的会话注入一段 systemPrompt，会改变提示词前缀，指纹敏感的中转站请自行评估）。
3. **模型高级字段**：模型级 `reasoningEfforts`、`compat`（精选 5 个键）、`modelOverrides`；提供商级 `defaultContextWindow`/`defaultMaxTokens`/`defaultInput`/`thinkingBudgets`/`reasoning`。
4. **宿主补丁状态**：在位 / 被升级冲掉 / 待重启 / 结构不识别，含 app 版本、归档路径、备份路径与「打补丁」「回滚」。宿主安装目录不写死，按运行中进程的 `resources` 路径推导；要指向别处的安装，设环境变量 `DSH_MODEL_TUNING_INSTALL_DIR`（或在 CLI 上用 `--install-dir`）。

## 状态与写入

- 插件状态：`~/.dsh/model-tuning.json`（原子写，0600）。**不写** `agent-default-model`、**不写** `agent-team` 的 loader 配置。
- 模型字段写入：`settings.mutate('llm-pi-ai', ops, revision)`——路径级操作 + 乐观锁，`providers` 整棵 volatile，因此**热生效**。
- 供应商/模型的增删：同样走 `settings.mutate`，但**供应商与它的首个模型必须一次原子写入**（手写路由没有非空 `models` 会被宿主拒写）。
- 密钥：只经宿主凭据服务写入，配置里留 `apiKeyEnv` 引用名（`<ROUTE>_API_KEY`）。删供应商时连带删它派生的那条引用。
- 档位写到哪一层：配置层有显式 `models` → 写 `models`；纯目录路由 → 写 `modelOverrides.<id>`（避免把整张目录抄进配置）。见 `docs/adr/0008`。
- 结构变更前快照 `providers` 子树到 `~/.dsh/model-tuning-backups/`（保留 10 份，0600），可一键撤销。
- 冲突与失败一律报错让用户重试，不自动重试。

## 文档

- `docs/plan.md`：实施方案（包结构、路由、验收、风险）
- `docs/adr/0001` xhigh 补丁托管迁到这里
- `docs/adr/0002` 新会话默认走 `agent/created` 钩子而非写配置
- `docs/adr/0003` 只走 `settings.mutate`
- `docs/adr/0004` 界面落在插件页行配置槽（2026-11-18 修订：不再注册 `settings.models.*` 席位）
- `docs/adr/0005` 档位跨模型保持的口径
- `docs/adr/0006` 团队任务先行提示（可选提示词，默认关）
- `docs/adr/0007` 供应商生命周期与密钥（谁可删、密钥只经凭据服务）
- `docs/adr/0008` 档位写到哪一层（`models` vs `modelOverrides`）
- `docs/adr/0009` 供应商区块就地编辑、默认档位分两层

## 测试

```powershell
npm test               # 152 例：状态 / 设置写入 / 供应商校验 / 快照 / 钩子 / 路由 / 补丁 / 客户端接线
```
