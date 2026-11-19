# 界面落在插件页的行配置槽，不新建设置页

本插件的功能是「配置 + 一次性的部署动作」（模型字段、新会话默认、团队默认、asar 补丁三态），不是每天要看的东西。

上游给了三个落点：`settings.section`（新建设置页）、`settings.models.footer` / `settings.models.provider-card`（挂进官方 Models 页）、`plugins.row.config`（插件页里本插件那一行的配置页，key `<包名>#<row id>`）。

## Considered Options

- **`settings.section`**：最显眼，但会在设置导航里多一个与「模型」「插件」并列的入口，而这个插件的语义就是「某个插件的配置」。
- **挂进官方 Models 页**：字段多（compat / thinkingBudgets / modelOverrides）、还要配生效说明与补丁状态，会把官方页面撑变形，且官方页随时可能改版。
- **插件页行配置**（采纳）：入口语义正确（"这是这个插件的配置"），与应用里所有其它插件一致；缺点是深一层（插件页 → 本插件行 → 配置），可接受——配置完不常打开。

## Consequences

- 页面内分四块：**模型高级字段**（按提供商 → 模型两级，含 `reasoningEfforts` 与 xhigh）／**新会话默认**（模型 + 档位 + 团队默认开关，旁边只读显示 DSH 当前默认供对照）／**档位跨模型保持**（见 ADR 0005）／**宿主补丁状态**（在位、被升级冲掉、待重启，含备份路径与一键重打）。
- ~~`settings.models.provider-card` / `settings.models.footer` 两个席位也一并登记，作为「在模型页顺手跳过来」的补救入口~~ —— **已作废（2026-11-18 修订）**：这两个席位在代码里从未注册过，只有一句文案在声称它们存在；`package.json` 里为此声明的 `@deepseek-ai/dsh-client-ui-settings-models` 客户端依赖也是空转。修订后本插件的界面**只有** `plugins.row.config` 一个落点，理由是原生 Models 页自身已承担"供应商 CRUD"的门面（ADR 0007），在它上面再放一行"跳过来"没有信息量。该依赖在下次改动 `package.json` 时一并摘除。
- 客户端半沿用本工作区既有形态（手写 `__ModuleLoader__` 模块 + 同源 `fetch` 到宿主 `webServer.register` 的前缀路由），不引入 typert `@Remote`。
