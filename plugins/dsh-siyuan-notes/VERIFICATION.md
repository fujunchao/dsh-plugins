# dsh-siyuan-notes 验证记录

## 2026-11-11：记忆体契约 v5（整理直接生效、被动召回、1500 字索引）

- 用户决定：自动整理产出直接生效；做被动召回；常驻注入 1500 字以内。契约见 [契约 v5](../notes/memory-2026-11-11-contract-v5.md)，实施记录见 [v5 改造记录](../notes/memory-2026-11-11-v5-changes.md)。
- 全量 **531 项通过、0 失败、0 跳过**，在插件目录内连续 5 次全绿（基线 520；新增 `test/memory-v5.test.mjs` 7 项与 `distill` / `memory-sessions` 各 2 项）。
- `test/memory-v5.test.mjs` 按宿主真实求值顺序（assemble → waterfall → refreshContext）驱动 `apply()` 接线，断言最终发给模型的文本：撤销提醒送达且带结论首句、被动召回带 id 且本轮不变、整理产出直接生效、会话级不记录在面板可见可恢复；并用与宿主一致的无损 JSON 校验检查 `memory_write` / `memory_search` / `memory_read` 的每种返回。
- 复查文档 `notes/memory-recheck-2026-11-11.md` 的 F1–F6 均有对应回归；F7 中“可用性靠正文匹配”“预算浪费”“测试偶发失败”已修，取消窗口与交接卡口径未动。
- 真实思源 3.8.3 **只读**探测（`.local/memory-v5-20261111/probe-v5-readonly.mjs`，只放行查询接口，输出只含计数与耗时）：120 条、有效 97、候选 7；新会话索引 1419 / 1481 字，四类标题各 1 次，结尾提示保留，不含条目 id；被动召回 3 句相关的话各带出 2–3 条、2 句无关的话 0 条，单次 20–70 ms。首次运行恰逢内核繁忙，索引与召回均按超时降级（不可用提示、无召回），重跑正常。
- 未做：真实模型调用、真实思源写入、DSH 窗口内的面板操作。运行中的宿主仍是 `memoryContractVersion=4`（只读查询确认），本轮没有改 desktop profile、没有重启 DSH；**重启 DSH 或重新加载插件后 v5 才生效**。
- 过程事故：有两次在工作区根目录执行了 `node --test`，它把 `tools/` 下名字带 `-test` 的一次性补丁脚本和 `.local/siyuan-upstream` 的测试脚本也当成测试执行，改动了 `test/chat|layout|render|typing.test.mjs`。四个文件已用改前快照恢复（被改坏的副本留在 `.local/memory-v5-20261111/accidental/`），其余文件经逐个比对未受影响。以后只在插件目录内跑测试。

## 2026-11-11：记忆体回归「写入即生效」

- 用户决定：先止血（去噪音）+ 回归「写即生效」，候选只留给 inferred，自动整理每天一次。契约见 [memory-2026-11-11-contract.md](../notes/memory-2026-11-11-contract.md)，实施记录见 [改造记录](../notes/memory-2026-11-11-changes.md)。
- 删除 `memory_confirm` / `memory_review` 与 `lib/memory-review.js`；`memory_write` 默认 stated 直接生效，只有 inferred 落候选，同文再写 stated 会把候选升级为有效。复核哈希与时间衰减不再影响注入、搜索与交接。
- 注入去掉「另有 N 条历史记忆待AI复核」，条目行不再带条目 id，候选摘要最多 2 条；每步变更提示只播一次；自动整理冷却改为 24 小时且不再追加第二次模型复核调用。
- 全量 **520 项通过、0 失败、0 跳过**。迁移前的基线为 519 项全绿；本轮新增 1 项候选升级断言。
- 迁移中由测试侧复现并修复一个真实缺陷：`approve()` 仍在 patch 已下线的 `approvalHash/approvedAt/approvedBy`，`patchEntry` 把 `undefined` 落成字符串 "undefined"，使 approve 之后的撤销、恢复、取代全部 `revision_conflict`。修复后 `approve → setStatus revoked → restore → write(supersedes + expectedRevisions)` 整链通过。
- 独立端到端脚本（假内核，未碰真实库）验证：stated/inferred 分流、候选升级、注入不含 14 位 id、search 命中、带版本取代、checkup/handoff。
- 运行宿主：追加 desktop profile 的 `cordis.patch.yml` 注释触发热加载，`GET /siyuan/memory` 返回 `memoryContractVersion=4`；配置值未改，原文件已备份。
- 真实库没有被批量改写：92 条历史条目只是不再被标记待复核，块属性、正文、状态均未变动。

## 2026-11-10：修正确认主体为 AI 自行核对

- 用户明确要求 AI 自行确认记忆，上一轮只提供人工面板确认的设计已修正。流程、原因与验证见 [AI 自行确认记录](../notes/memory-ai-confirm-2026-11-10.md)。
- 新增 memory_review / memory_confirm；memory_write 返回候选、旧状态、证据及本会话核对令牌，对话 AI 可直接完成确认。后台整理提取后再调用 AI 复核，有依据的自动生效；手动面板为可选入口。
- 确认绑定原消息 ID/摘要、当前正文版本和已读旧状态版本；AI 身份记录为 ai:会话ID。工具回显和助手复述不作为独立依据。关闭记录或取消会话会阻止排队确认。
- 当前 DSH 已通过追加 profile 注释触发热加载，运行路由返回契约版本 **3**；原配置已备份，配置值未改，未强制重启。人工面板仅为可选纠正入口。
- 全量 **519 项通过、0 失败、0 跳过**，约 11.00 秒。新增 7 项验收覆盖实际工具接线、版本/证据检查、后台自动生效、旧状态合并、作用域与会话隔离、证据不足暂存和排队取消。
- 真实思源 **3.8.3** 的独立临时笔记本 **6 项检查通过**，核名后清理。包含 AI 确认主体及证据持久化、自动提示、验证依据限制、旧状态合并、历史自行复核、整理后自动生效。模型输出固定用于验证流程，未调用真实付费模型评价语义判断质量。
- 首次全量出现 2 项失败：一项整理摘要文字与既有断言不一致，已修正并补充分别展示已确认/暂存数量的断言；另一项为既有原生登录清理 `.tmp` 文件的偶发用例，定向 75 项及最终全量通过，没有修改或跳过原生登录测试。首次日志保留。

## 2026-11-10：记忆设计优化与五阶段实施

- 下列人工确认限定已经被上节取代；旧记录由 AI 按需自行复核，不要求用户逐条审批。
- 计划、发现映射及实施记录见 [设计优化实施记录](../notes/memory-design-implementation-2026-11-10.md)。当前记忆的写入、确认、范围和时效契约以本节及 README 的设计优化说明为准。
- 最终全量 **512 项通过、0 失败、0 跳过**，10.86 秒。新增 17 项设计回归；另增加一个测试适配器入口。首次全量的工具清单失败已通过明确注册 `memory_topics` 修正，未跳过断言。
- 真实思源 **3.8.3**：独立临时笔记本 **10 项验收通过**，核名后删除。覆盖候选、确认摘要、外部属性移除与正文修改、重新核实、工作区/全局范围、主题 ID 取代、过期历史、删除约束及 20 条跨实例读取。
- 真实内核探测发现裸 Markdown `updateBlock` 会移除自定义属性；验收分别检查“属性移除”和“保留原属性、仅改正文”两条路径。索引可能先看到已写确认字段但状态仍为候选，验收等待确认版本与 active 同时满足。相关首次诊断日志保留。
- 实际 React、当前 MemoryPage 与宿主路由的浏览器验收 **8 项通过、0 脚本异常**。覆盖状态比较、合并待办与双前驱、显式全局确认、历史复核、记录开关、体检、交接卡；已检查完整页面截图并调整确认字段布局。
- 当前运行宿主返回 `memoryContractVersion=2`，列表包含 trust/reviewRequired；项目链接指向本工作区。现有热加载已采用新接口，本轮没有修改 desktop profile，也没有强制重启 DSH。安装包会话源码哈希与已检查版本一致。
- 原有记忆没有被批量改写或自动补确认摘要；历史未绑定条目可检索并标注待复核，确认后才进入自动提示。运行时只读检查当时共 105 条，其中 92 条原 active 记录需要复核；这不是删除数量。
- 材料：`.local/memory-design-implementation-20261110/`，含原件、分阶段失败/通过日志、最终全量、真实内核及浏览器结果、宿主验证、源码清单和默认只预检的回退脚本。
- 真实付费模型语义召回率、长期跨进程并发和任意语义别名自动匹配不在本轮验证范围；同一条目同时改范围/主题及合并正文需要分开处理。

## 2026-11-10：记忆插件五阶段修复与迁移

- 实施方案、问题映射、部署及回滚见 [分阶段修复记录](../notes/memory-staged-fix-plan-2026-11-10.md)。本节保留当时验证结果，后续设计优化见上节。
- 最终全量 **494 项通过、0 失败、0 跳过**；记忆与整理定向 **154 项通过**。保留原生登录清理用例的一次偶发失败日志，单独复跑及最终全量通过，未跳过测试。
- 真实思源 **3.8.3**：独立临时笔记本 10 项验收通过并清理；原库 20 个 ID 完整读回 20 条，含代码记忆版本一致，确认后缓存不会提前消失。
- 浏览器使用实际 React、MemoryPage 和宿主路由，隔离数据验收 8 项通过，覆盖比较合并、双向历史、未确认写入恢复、记录开关、体检和交接卡，无脚本异常。
- 85 条旧项目记忆已按来源会话 cwd 和真实目录绑定；原库仍 100 条，正文、状态、可信度均保持原样，未绑定项目数降为 0。一条原有跨项目取代关系保留并由体检标明，不擅自改写历史含义。
- 当前 DSH 宿主已通过 profile 注释变动触发 HMR 重组合，新记录接口和带范围的交接卡已实测生效，未重启应用。
- 材料目录：`.local/memory-staged-fix-20261110/`，含原件备份、逐步失败/通过回归日志、迁移前后属性、可预检的回滚脚本、最终源码清单。
- 仍不保证多独立宿主同时写入的跨块原子性；真实付费模型长会话未执行，增量整理采用当前宿主接线与可控会话验证。

## 2026-11-09：记忆架构缺陷修复

- 修复计划与实施映射见 [记忆修复记录](../notes/memory-fix-plan-2026-11-09.md)。当前记忆契约以本节和 README 为准，早期记录中的全局快照、轮末压力采样、项目级自动取代已被替换。
- 最终全量 `node --test --test-reporter=tap`：**467 项通过，0 失败、0 跳过**，10.77 秒；七个运行模块均通过语法检查。
- 第一批 7 个回归先确认失败再实施。新增测试覆盖会话独立快照、实时压力、压缩前输入捕获、候选隔离、来源和项目校验、状态主题与版本检查、重复写入、跨实例续写、响应丢失保护、错误语义、完整交接卡和面板确认。
- 真实 SQLite/FTS5 验证“作用域与可信度在 LIMIT 前过滤”；真实 `apply()` 接线验证首次装配、A/B 会话、确认/撤销、按会话诊断和压缩前文本保留。
- 真实思源 **3.8.3** 的 11 项隔离检查全部通过。测试创建独立临时笔记本，按新建 ID 和唯一名称核对后清理，未修改原有用户记忆；索引延迟中发现的确认可见性和缓存重复问题已修复并回归。
- 当前宿主版本 0.2.2-rc.1 的目录来源为 `session.header.cwd`，已核对安装包源码并增加兼容测试。
- 产物：`.local/memory-fix-20261109/tests-final.log`、`live-memory-result.json`、`implementation-manifest.json`，原件备份位于同目录 `before/`。
- 桌面 profile 已链接当前项目，运行中的 Host 需重新加载插件或重启 DSH。本次没有强制重启、没有调用真实模型生成长会话；候选面板用实际组件和模拟网络验收。

## 2026-11-09：记住原生登录 30 天

- 最终全量 `node --test --test-reporter=spec`：**446 项通过，0 失败、0 跳过**，约 11.1 秒；本轮四个运行模块通过语法检查。
- 登录表单默认勾选“记住登录 30 天”，转发 `rememberMe: true`；按服务端 Cookie 有效期保存，最多 30 天。新增原生工具栏“忘记登录”。
- 会话使用 Windows 当前用户 DPAPI 加密，按思源地址与 API token 隔离写入 `%USERPROFILE%\.dsh\siyuan-native-sessions\`。不保存独立密码字段，不向浏览器返回原始会话 Cookie。
- `test/native-session.test.mjs`：Cookie 期限与上限、真实 Windows 加密、独立 Node 进程读取、到期/损坏清理、连接隔离、写入失败恢复、取消记住、忘记登录、服务端撤销、网络故障保留。校验会话的请求只带 Cookie，测试确认没有借用 API token。
- `node scripts/e2e-native-login.mjs`：**7 项浏览器验收通过**。实际登录表单、真实 Windows DPAPI、独立宿主进程；上游为本机模拟思源，密码为虚构值。覆盖默认勾选、加密落盘、重启免登录、忘记、取消勾选、服务端撤销及无脚本异常。未使用用户密码、未写入真实笔记。
- 截图/结果：`.local/siyuan-remember-20261109/remember-login.png`、`remember-login-result.json`；改动前快照：同目录 `before/`。此结果不等于真实思源等待 30 天后的实测，过期分支通过可控时钟验证。
- 新增宿主模块需重启或重新加载 DSH 插件生效。旧版仅进程内的会话不能自动转换成 30 天会话，需在更新后登录一次并保留勾选。

## 2026-11-09：思源原生编辑器试用接入

- 最终全量 `node --test --test-reporter=spec`：**440 项通过，0 失败、0 跳过**，约 11.2 秒；修改的五个运行模块均通过 `node --check`。
- 新增原生网关、临时浏览器桥接、锁屏登录表单、原生编辑视图、块上下文及 `siyuan_note_insert_text`。源代码在当前安装目录所链接的工作区；实施方案见 [原生接入方案](../notes/siyuan-native-implementation-2026-11-09.md)。
- `node scripts/e2e-native-editor.mjs`：**22 项真实浏览器检查通过**。真实 React 和完整 PanelPage 连接当前 3.8.3 内核，用户本人完成锁屏登录；验证原生组合输入、保存、撤销重做、旧块 ID、跨图文引用、AI 文本和图片插入、实时更新、跨文档拒绝、图片粘贴事件、表格编辑、切标签、回退、复用登录及面板卸载时确认保存。
- 本次每轮验收只编辑新建的两篇临时文档；临时图片按本次上传返回路径清理，隔离本地备份目录也已清理。没有向 DSH 模型发消息，没有改写既有笔记。聊天输入为验收载体提供的动作接口，实际执行本插件的完整引用处理。
- 图片粘贴验证使用带真实 File 的 ClipboardEvent；中文输入使用浏览器 CDP 的组合输入及提交事件。没有把这两项等同于人工操作系统剪贴板和系统输入法候选窗验收。
- 浏览器无脚本异常。截图与结果在 `.local/siyuan-native-20261109/native-editor-success.png`、`native-editor-result.json`；离线回归输出在同目录 `tests-final.log`。测试页自身 `/favicon.ico` 的一次 404 不影响编辑器资源与网络链路。
- 原生网关、消息校验、模式切换和写入工具的回归见 `test/native-editor.test.mjs`、`test/layout-panel.test.mjs`。覆盖来源/凭据隔离、WebSocket 握手、布局隔离、会话释放、跨文档拒绝、备份失败、未确认写入只读复核、退出前等待事务及错误时保留标签。
- **实际 DSH 生效边界**：前端已显示试用按钮，运行中 Host 仍为旧模块。设置页提示当前 profile 的 patch 无法唯一定位组件，未成功单独重载；需用户保存工作后重启 DSH。没有声称 DSH 的 `dsh-app://app` 内嵌页面已经验收。

复跑（启动独立 Chrome，由用户本人完成一次锁屏登录）：

```powershell
$env:DSH_NATIVE_INTERACTIVE = '1'
node scripts/e2e-native-editor.mjs
```

该脚本默认复用工作区已有 React 测试运行库与 Codex Playwright；其他机器可用 `DSH_NATIVE_BROWSER_RUNTIME`、`DSH_PLAYWRIGHT_MODULE`、`DSH_NATIVE_CHECK_OUTPUT` 指定对应路径。

## 2026-11-09：图片显示修复后的验证

- 承接原会话最后两处图片问题：正常图片误显示「图未找到」，正文与图片同一行时不出卡片。详见 [修复记录](../notes/dsh-siyuan-image-fix-2026-11-09.md)。
- `npm test`：**434 项通过，0 失败、0 跳过**。图片相关的 71 项覆盖原始复现、同段多图、原文与 CRLF 保留、代码／转义示例、卡片操作及编辑／预览一致性；新增回归在修改前先确认失败。
- `node scripts/e2e-image-display.mjs`：**13 项真实浏览器检查通过**。独立测试页使用真实 React、EditorPane、插件 CSS 和截图对应的两张既有资源，验证成功时无错误提示、两图解码、分栏预览、真实 404 占位、换源恢复、改宽度及删除时保留正文。浏览器无脚本异常。
- 原始图片块在浏览器验证前后重新读取，kramdown 逐字相同；本轮没有写入既有思源笔记。
- 已重新确认安装目录链接到本项目；本轮未强制刷新／重启 DSH，也未将独立测试页的结果当成当前 DSH 窗口热更新已完成。
- 截图、日志、修改前快照及复跑环境变量见上方修复记录。

## 2026-11-09：十项可靠性修复后的验证

本节为当前验证结果；下方早期记录用于保留历史，涉及“空基线不检查”“备份失败继续写”等旧约定已经被本轮修复替代。

- 修复方案与逐项映射：[修复记录](../notes/dsh-siyuan-fix-plan-2026-11-09.md)。
- 最终 `npm test`：**421 项通过，0 失败、0 跳过，约 10 秒**；比审查时增加 27 项。
- 新增测试先在修复前确认失败：客户端空基线／校验／备份／关闭／上传接口，宿主错误信封／缓存／换连接／写盘重试，图片归属与读回确认，蒸馏部分写入错误。
- 真实内核隔离验证 `node scripts/e2e-reliability-live.mjs`：**11 项通过**，包括真实 PNG 上传、普通位置与末尾插入、引用容器内插入、跨文档锚点拒绝、普通段落不得冒充文档、独立备份及清理。本次创建的两篇临时文档、一张资源和本地临时目录均已清理，未修改既有笔记。
- 独立复核补齐了上传期间切换／关闭标签、已索引记忆撤销后的旧索引遮罩、引用容器 kramdown 校验、部分落盘后重试、未确认期间继续输入及蒸馏错误上报。
- 四个变更模块和新增端到端脚本通过 `node --check`；按 Windows CRLF 行尾规则检查修改差异，无新增空白错误或调试日志。
- 未进行真实浏览器人工点击验收；UI 回归使用实际函数组件配合状态、网络模拟。已核实安装目录链接到本项目，运行中的 Host 仍需重新启用插件或重启 DSH 加载新代码；本轮没有强制中断用户会话。
- 修复前快照：`D:\work\cz\.local\dsh-siyuan-fix-20261109-114248`。

> 环境：DSH 桌面版 `0.2.1-rc.5`（Windows 11 x64），profile `desktop`；
> 思源内核 `3.8.3`，`http://127.0.0.1:6806`（Docker，局域网），笔记本 `20251122094407-b4g4hhx`。
> 记录时间：2026-11-03。

## 1. 结论

插件已安装并在运行中的 DSH 里生效：**左侧栏入口 + 主面板都注册成功**，Host 半边路由可用，
保存路径对真实文档零误写。视觉外观未做截图验证（本机页面需要启动令牌，见 §5）。

| 项 | 状态 | 证据 |
|---|---|---|
| 左侧栏入口 | ✅ 已注册且 active | `Slots.listSubTree("sidebar.panellist")` occupants 含 `{id: "siyuan-notes", order: 20, active: true}` |
| 主面板 | ✅ 已注册且 active | `Slots.listSubTree("main")` occupants 含 `{key: "siyuan-notes", active: true}` |
| Host 路由 | ✅ 全部可用 | `GET /siyuan/state`、`POST /siyuan/api`、`POST /siyuan/backup`、`POST /siyuan/config` 实测 |
| 与思源连通 | ✅ | `/siyuan/state` → `{"baseUrl":"http://127.0.0.1:6806","hasToken":true,"version":"3.8.3"}` |
| 块级保存 | ✅ 19 项 E2E 全通过 | `scripts/e2e-save.mjs`，对真实内核建/读/改/插/删/校验/清理 |
| 真实文档零误写 | ✅ | 3 篇用户文档（4 / 129 / 34 块）打开后 `planSync` 全部 `keep`，0 次写入 |
| 面板内对话 + 引用提问 | ✅ 客户端就绪 | 组件树 610 节点无异常；引用/上下文逻辑有单测；**宿主侧需重启后才生效** |
| 首行缩进 | ✅ 单测 + 真实内核 | 缩进变换 26/26（幂等、可逆、跳过结构行）；E2E 验证真实缩进保留且二次保存不翻倍 |
| 分屏双编辑器 | ✅ 状态机 + 真实内核 | 面板模型 25/25；双文档同时编辑 E2E 13/13（保存 A 后 B 字节未变、块 ID 不变） |
| 单元测试 | ✅ 25/25 | `node --test`（Host 22 + 客户端纯函数） |
| 渲染冒烟 | ✅ 506 组件无异常 | `test/render.test.mjs`，覆盖探测中/未连接/空文档/富文档/错误/三视图 |
| 主题令牌 | ✅ 无字面色值 | `lib/client.js` 中 `#hex`/`rgba()` 均为 0 处，全部 `--dsw-alias-*` |
| 无禁用依赖 | ✅ | 不 require `ui-primitives` / `ui-slots`；只 require `react` |

## 2. 安装过程与两个环境坑（值得记住）

1. **pnpm 存储位置不匹配**：profile 的 `node_modules` 由 pnpm 10 链接到
   `D:\tool-cache\pnpm-store\v10`，而 DSH 桌面版内置的 pnpm 11 默认去
   `C:\Users\…\AppData\Local\pnpm\store\v11`，于是每次 `install_bundle` 都报
   `ERR_PNPM_UNEXPECTED_STORE`。
   解法：给 profile 加 `.npmrc` 并让 pnpm 11 也认同一个 store
   （`pnpm config set store-dir D:/tool-cache/pnpm-store --global`，注意写**基础目录**，
   pnpm 自己会拼 `v10`/`v11`）。之后 `install_bundle` 仍走 pnpm 11 会再报 v11 不匹配，
   所以最终用 profile 自带的 pnpm 10 完成链接：
   `package.json` 加 `"dsh-siyuan-notes": "link:D:/work/cz/dsh-siyuan-notes"` → `pnpm install --offline`。
2. **`install_bundle` 拒绝重复安装**：手工链接后它会返回 `already-installed`。
   行（`cordis.patch.yml`）与依赖（`package.json`）都齐了，插件就已生效，
   不需要再走一次管理器安装。

## 3. 思源 API 的坑（已写进实现，避免复发）

| 坑 | 后果 | 实现里的对策 |
|---|---|---|
| 文档 kramdown 的段落带两个全角空格 `　　` | 原样写回会**翻倍**成 4 个 | `cleanBlockText` 只剥一层；`normalizeText` 兜底 |
| `…Doc`（按路径）与 `…DocByID`（按 id） | 传错键返回 `code:0` 且**什么都不做** | 只用 `renameDocByID` / `removeDocByID` |
| `code:0` ≠ 成功 | 删不存在的块、用 docId 当 previousID 都会“成功” | 写入后轮询重读校验，不一致就提示而不是重写 |
| `updateBlock(docId, …)` | 重建全部子块 ID，并静默删掉别人中途追加的块 | **完全不调用**；只做块级增量 |
| 文档列表顺序 | 按创建时间倒序，`sortMode` 入参被忽略，`maxListCount` 静默截断 | 客户端按 `sort` + 名称排序 |
| `blocks.name` 对文档为空 | `WHERE name LIKE` 永远查不到 | 搜索改用 `content` / `hpath` |
| 读模型滞后约 0.3–1.5 s | 写完立刻读会看到旧内容 | 保存后最多轮询 6 次 ×250 ms 再判定 |
| 未知 API 路径 | HTTP 200 + **空 body**（不是 JSON） | Host 半边把非 JSON 一律转成 `{ok:false,error}` |

## 4. 已执行的验证命令

```bash
# 单元测试（离线）
cd dsh-siyuan-notes && node --test            # 24/24 pass

# 渲染冒烟（离线，stub React）
node test/render.test.mjs                     # 506 components, no exceptions

# 真实内核 E2E（建 → 读 → 改 → 插 → 删 → 校验 → 清理）
node scripts/e2e-save.mjs                     # 19 PASS, E2E: OK

# Host 路由（对运行中的 DSH）
curl -s http://127.0.0.1:49358/siyuan/state
curl -s -X POST http://127.0.0.1:49358/siyuan/api -H 'Content-Type: application/json' \
     -d '{"path":"/api/notebook/lsNotebooks","payload":{}}'
```

E2E 覆盖的具体断言：6 个顶层块的解析、无改动时零写入、单段改写只发 1 次 update、
中间插入后邻块 ID 全部存活、删除只消失 1 个块、全篇重写仍保留全部 ID、
`　　` 只剥一层、列表块追加条目后仍是同一个块。

## 4.1 分屏编辑（第二轮需求）的验证

需求：两篇文档同时并排编辑，像思源原生分屏那样。

实现：状态从「一个文档」改成「最多三栏 × 每栏多标签页」；
每栏有自己的缓冲区、保存按钮、Ctrl+S 与标签页；点左侧文档打开到**当前激活栏**。

已执行：

```bash
node test/panes.test.mjs        # 面板状态机：打开/关闭标签、关闭文档、激活索引边界
node test/render.test.mjs       # 577 个组件无异常（含 stale 提示条与两标签页）
node scripts/e2e-panes.mjs      # 对真实内核：13 PASS
```

双文档 E2E 的具体断言：

- 两栏各自装载自己的文档，缓冲区互不串内容；
- 两栏各有各的编辑，保存左栏后**右栏文档字节完全未变、块 ID 全不变**；
- 再保存右栏，左栏内容仍然是左栏那次改的；
- 同一篇文档在两栏打开时，一栏保存后另一栏读到的内容确实已变 ——
  这就是「另一个面板保存了这篇文档」黄点的判定依据。

面板状态机的边界断言：关掉非激活标签时激活项跟随下移、关掉激活标签时相邻标签顶上、
关掉最后一个标签时时栏内清空（`active: -1`）、关掉某文档时从所有栏一起移除、
未受影响的栏保持对象引用不变（避免无谓重渲染）。

**未验证**：分屏在多显示器 / 窄窗口下的实际宽度表现；拖拽分隔条（当前不支持，等分宽度）。

## 4.2 首行缩进（第三轮需求）的验证

需求：写作时要有首行缩进，看着才方便（中文长篇小说习惯）。

**先确认了一个容易搞错的事实**：思源 `getBlockKramdown(docId)` 读出来的每个段落带一对
`　　`（U+3000），但读单个块没有 —— 说明这一对是**文档序列化时合成的**，不在正文里。
所以「缩进」必须作为真实字符写入，读的时候只剥掉那一对合成的，否则会越存越深。

实现：

- 工具栏 **首行缩进** 开关（默认开）；
- 开着时按回车 → 直接开始一个 `　　` 打头的新段落（列表/标题/引用/表格/代码块内保持原样）；
- 点按钮 → 给当前文档所有正文段落一键补缩进（再点移除）；
- 预览用 CSS `text-indent:2em` 渲染。

已执行：

```bash
node test/indent.test.mjs      # 缩进变换：幂等、可逆、跳过标题/列表/代码/引用/表格
node scripts/e2e-save.mjs      # 真实内核 21 项，含缩进往返与不翻倍
```

关键断言：

- `indentParagraphs(unindentParagraphs(x)) === x`，且两者都幂等；
- 代码块内、`#` 标题、`- ` 列表、`> ` 引用、`| ` 表格**不会被加缩进**；
- 写入真实缩进后读回是**恰好一个**缩进（不是零个，也不是两个）；
- 用缩进后的缓冲区**再保存一次**：内容不变、且规划出 **0 次写入**（不翻倍）；
- 打开现有文档（未改任何字）仍然是 **0 次写入**——这条对 3 篇真实文档复测过。

**过程中修掉的一个真 bug**：`String.trim()` 把 U+3000 当空白，导致
(a) 读回时把用户手写的真实缩进也一起删掉；(b) 保存时把缩进写丢。
已改用 `trimEdges()`（只裁 ASCII 空白与零宽字符，保留 U+3000），
并由上面的往返断言锁死。

**未验证**：浏览器里按回车的实际手感（受输入法合成事件影响，已加 `isComposing` 判断跳过）；
Ctrl+Z 撤销由浏览器原生行为处理，程序化插入的段落不保证进撤销栈。

## 4.3 面板内对话与引用提问（第四轮需求）的验证

需求：① 面板最下面保留我们的对话框；② 能引用文档里的内容直接提问；③ 我要能看到用户打开的是哪篇文档、
处于什么位置。

实现分两半，**生效时机不同**：

| 半边 | 做了什么 | 何时生效 |
|---|---|---|
| 浏览器（client.js） | 面板底部内嵌 `conversation.content`（经 `SessionProvider` 绑定会话）、工具栏「引用」、光标/选区上报 | 刷新页面即可（HMR 已加载） |
| 宿主（index.js） | `POST /siyuan/context` 收快照、系统提示里一行摘要、`siyuan_note_context` 工具 | **需要重启桌面应用**（宿主插件在启动时加载） |

已执行：

```bash
node test/context.test.mjs     # 宿主侧：快照校验/摘要/工具载荷/路由
node test/render.test.mjs      # 610 个组件无异常（含内嵌对话的两种分支）
node --test                    # 27 项全通过
```

关键断言：

- 空请求体 = 「没有打开文档」，是合法状态而不是错误；
- 选中的文本超过 `SELECTION_LIMIT`（4000 字）会被截断而不是拒收；
- 只有空白的选区不算选区；行号被钳制为非负整数；
- 摘要一行包含书名号标题、光标 `12/240` 行、选中行范围，且 < 300 字符；没有文档时**不注入**该段落（不打扰模型）；
- 工具载荷可 JSON 序列化，含 `ageSeconds` 供模型判断快照新旧；
- 路由：POST 收快照返回 `accepted`、GET 返回 405、非法类型返回 400。

设计要点：

- 对话区渲染的是 DSH 自己的 `conversation.content`，不是仿写的输入框 —— 模型选择器、权限、排队、工具卡片行为都一致。
- 会话 id 来自 `useSessions`：优先取「主视图仍保留」的会话，切到本面板后它会被卸载，
  于是用 ref 记住最后一个，避免对话区突然变空。
- 输入框的 actions 通过一个挂在 `conversation.input.dock` 的**空组件**发布到模块级小 store ——
  这是唯一能在「面板在编辑区、输入框在会话子树」两端之间搭桥的官方位置。

**未验证（重要）**：内嵌对话在真实浏览器里的渲染与布局、宿主重启后新路由/工具是否如期出现 ——
本回合无法重启桌面应用（会终止当前会话），所以宿主侧只做了离线单测。

## 4.4 事故复盘：405 —— 宿主半边启动即崩（已修复）

**现象**：应用重启后，面板里填完地址点连接，返回 405；所有 `/siyuan/*` 路由
GET 返回 404、POST 返回 405 —— 这是 SPA 静态服务器的行为，说明插件的路由**一个都没注册**。

**根因**：Cordis 的上下文对「读取未 inject 的服务」直接抛错（源码原文：
`cannot get property \"x\" without inject`）。我在第四轮给宿主加了工具注册，写的是：

```js
if (ctx.tools !== undefined && typeof ctx.tools.register === "function") { … }
```

而插件只声明了 `inject = ["webServer"]` —— 于是 `ctx.tools` 这一行本身就抛异常，
`apply()` 整体失败，整行插件不激活，路由自然不存在。

**为什么之前没暴露**：前几轮宿主代码只访问 `ctx.webServer`（已 inject）和 `ctx.effect`，
所以一直正常；只有这一轮引入的工具注册踩到了这个语义。

**修复**：可选服务一律走 `ctx.get("tools")`（返回 undefined 而不是抛错），
这正是 DSH 服务访问文档给出的 optional 形式。

**回归测试**：`test/activation.test.mjs` 用一个**严格的 Cordis 替身**驱动 `apply()`：
任何未 inject 的服务读取都会抛 `cannot get property … without inject`。已验证它确实能抓住这个 bug
（临时改回 `ctx.tools` 时，测试立刻以同一条报错失败），并覆盖：

- 正常装配：路由 / 工具 / 提示词段落都注册成功；
- 缺少 tools 或 systemPrompt 服务时仍能注册路由（不因可选服务缺席而崩）；
- 激活后 `POST /siyuan/context` 真的能应答。

**热修复过程（无需重启应用）**：用 `plugin_manager` 的 `set_plugin` 对 `include:siyuan-notes` 做
disable → enable，Loader 重新 `import` 了 `lib/index.js` 并重跑 `apply()`，
实测路由全部恢复、`siyuan_note_context` 出现在工具列表里。以后修宿主半边都可以这样热加载，
不必重启桌面应用。

**端到端确认**：推送一条快照后，模型侧的系统提示里确实出现了
「思源笔记当前打开：《第一章 红鞋的少女》（…）；光标在第 12/240 行；选中 1 行；共 2 个标签页。」
—— 也就是说「我」真的看得到用户打开的是哪篇、光标在哪。

## 4.5 事故复盘：白屏 —— 内嵌会话拿到了错误类型的参数（已修复）

**现象**：点左侧栏「思源笔记」进去是白屏，什么都没有。

**根因**：`main` 槽的目录写得很清楚 ——「保留键 `conversation` 承载会话；
**其它键不获得 Session 绑定**」。我要在面板里内嵌会话，就必须自己取得绑定；
而 `SessionProvider` 的 `session` 参数要的是一个**会话引用对象**
（`{ sessionId, binding }`，由 `sessions.retain()` 返回），
我上一轮传的是**裸 sessionId 字符串**。provider 内部的
`adapter.bindingSource(props.session)` 会读 `reference.binding`，
拿到 undefined 后绑定失败 —— 渲染期抛异常，整个槽条目被卸载，用户看到的就是白屏。

**修复**：

1. 客户端 `inject` 增加 `sessions`，注册时经 `inject()` 把服务传给面板；
   读取用 `ctx.get("sessions")`（可选访问，热重载保留旧 inject 列表时也不会抛）。
2. 面板在 `useEffect` 里 `sessions.retain(sessionId, { source: "sidebarView" })`，
   把**引用对象**交给 `SessionProvider`，卸载时 `release()`。来源串与右侧栏插件一致。
3. 只有拿到引用才渲染对话区，否则显示「对话暂不可用」的兜底文案。

**顺手补的防线**：新增 `PanelBoundary`（React 错误边界），分别包住
「对话区」和「整个面板主体」。以后任何一处渲染失败只会让**那块区域**显示错误文字，
不会再整片白屏 —— 这次白屏之所以毫无线索，就是因为没有边界。

**测试**：

- `test/render.test.mjs` 新增边界断言：正常时渲染子节点；子节点抛错时渲染
  `sy-boundary` 兜底、带区域名、错误信息与提示语；非 Error 抛出也能转成文本。
- 同一文件断言客户端 `inject` 必含 `sessions/slots/locale`（缺 inject 就会重演 §4.4 那类崩溃）。
- 全部 28 项测试通过；渲染冒烟 610 个组件无异常。

**效果**：即使内嵌对话还有别的问题，面板也能正常显示编辑区，并在对话区给出可读的错误文字，
而不是一片空白。

## 4.6 对话区改为右侧栏 / 悬浮窗（第五轮需求）

**需求原话**：底部的对话框没有出现，出现的是会话内容；而且对话框在下面就没地方显示会话内容了 ——
希望做成**可贴边隐藏的悬浮窗**，以及**可关闭的右侧栏**。

**为什么底部形态不可行**（实测）：会话组件自己管滚动，并用测量出来的 `--dsh-composer-height` 把输入框钉在底部；
我原来给的容器高度是 `44%` 的弹性盒子，内容一长就把输入框顶到了可视区域之外，
于是「只有会话内容、没有输入框」。

**改法**：一个会话实例 + 两种外壳，容器改成**绝对定位填充父级**（`.sy-chat-fill{position:absolute;inset:0}`），
让内置布局拿到确定高度：

| 形态 | 元素 | 行为 |
|---|---|---|
| 右侧栏 | `.sy-sidechat`（384px，位于 `.sy-body` 内） | 标题栏 ✕ 关闭；不占编辑区行高 |
| 悬浮窗 | `.sy-float`（绝对定位于面板右下） | **—** 收起到右边缘 `.sy-float-tab`，点标签展开；**✕** 关闭；CSS `resize` 可调大小 |

两个表面**互斥**：同一会话只有一个输入状态实例，同时挂两份会互相抢草稿。

**测试**：把「三种形态该长什么样」抽成纯函数 `buildChatSurfaces()`，
新增 `test/chat.test.mjs` 覆盖：off 全空；side 渲染 aside + 关闭按钮可用；
float 展开无边缘标签、收起时有标签且点击可展开；无会话时用兜底文案占用同一位置。

**教训**：把 UI 形态抽成纯函数后，既避免了我此前用 `indexOf` 做文本替换
误切到重复锚点（把 `EditorPane` 整段删掉那次），也让这类状态可以离线断言。

## 4.7 输入框不显示 —— 漏传 `phase`（已修复）

**现象**：右侧栏 / 悬浮窗里能看到完整会话（消息、工具卡片、附件、用量页脚），
但**没有输入框**。

**根因**：会话组件把输入框渲染在**滚动容器内部**，作为最后一项；
只有当容器带 `data-content-phase="active"` 时才变成「吸底浮动」的座位
（CSS：`.an3WzG_embeddedBody[data-content-phase=active] .an3WzG_composerSeat{position:sticky;bottom:0}`）。
该属性来自工厂入参 `phase`，而我只传了 `variant` 和 `hero`。
没有它，输入框就老老实实排在长消息的最末尾 —— 被滚到视野之外。

**为什么之前误判为「高度问题」**：我把容器从弹性百分比改成了绝对填充，布局确实更稳了，
但输入框不在视野里的真正原因是**没有吸底**，不是没有高度。教训：先读组件的渲染条件，
再调 CSS。

**修复**：新增 `chatFactoryProps()` 作为唯一来源，
返回 `{ variant: "embedded", phase: "active", hero: false }`，并写明为什么 phase 不能省。
（框架自己的取值来自 `conversationPhase()`：`active | engaging | blank`；
我们在面板里始终是「正在对话」，用 `active` 即正确。）

**测试**：`test/chat.test.mjs` 断言 `variant==="embedded"`、
`phase==="active"`、`hero===false`，且每次返回新对象（避免工厂因同一引用而跳过重渲染）。
全部 29 项测试通过。

## 4.8 引用点了没反应、悬浮窗拖不动（第六轮反馈，已修复）

### (1) 「❝ 引用」点了没反应

**真正的根因**：把对话从底部改成两种外壳时，旧的 `chatOpen/setChatOpen` 被重命名成
`chatSurface/setChatSurface`，但 `onQuote` 里还留着两处 `setChatOpen(true)`。
于是每次点引用都在插入前抛 `ReferenceError: setChatOpen is not defined` ——
**代码能正常加载、面板能正常渲染，只有那一次点击会炸**，所以此前的冒烟测试全都发现不了。

**顺带修掉的第二个原因**：引用读的是 `textarea` 的 `selectionStart/End`，
而面板是「源码 + 渲染预览」并排的，人往往在**渲染出来的那一侧**选中文字。
textarea 的选择区与 DOM 的 `window.getSelection()` 互不相通，
于是选中的内容根本没被读到。现在按**焦点在谁身上**判断：焦点在源码框就用它的选区，
否则用 DOM 选区（预览侧），再把渲染文本回查源码定位行号（新增 `locateQuote()`）。

**第三个改进**：没开对话栏时点引用，现在会**自动打开对话栏**并重试一次，
而不是弹一句「引用失败」——按钮不该看起来像没反应。

### (2) 悬浮窗不能拖动

上一轮我在说明里写了「可拖拽」，但**代码里从来没实现拖动**（只写了 CSS `resize`，
而它在 `overflow:hidden` 的容器上并不生效）。这是我的疏漏：说了没做。

现在用 pointer 事件实现：标题栏 = 拖动（`cursor:move`），右下角 = 缩放（`cursor:nwse-resize`），
带 pointer capture，拖动范围钳制在面板内；拖动后位置/尺寸以像素记在 state 里，
未拖动时仍走 CSS 的右下角默认锚点。

### (3) 顺带发现并修掉的两处

- 桥接清理竞态：切换面板时两个会话实例可能重叠，旧实例卸载时会把新实例刚发布的
  `inputActions` 清空 → 改为 `clearIfOwner(owner)` 只在仍是当前所有者时清理。
- 悬浮窗标题显示成英文的 **chat**：早先一次锚点替换把 `chat` 词条误删了，
  `t("chat")` 便回落成 key 本身。已补回中英两条。

### (4) 新增`test/hygiene.test.mjs`：静态守卫，防止同类问题复发

这次事故的本质是「重命名留下幽灵引用，运行到那一行才炸」，所以加了一层静态检查：

1. **退役名单**（`chatOpen/setChatOpen/chatArea/sy-chat-body/chatHint`）不得再出现；
2. 每个**未限定的** `setX(...)` 调用都必须在本文件里有绑定（方法调用 `a.setX()` 不算）；
3. 每个 `t("key")` 都必须在**中英两个词典**里都有条目；
4. 代码里渲染的每个 `sy-*` class 都必须在样式表里定义。

第 3 条当场又抓出一个真 bug（上面那处 `chat` 词条丢失）。
第 2 条如果早存在，这轮点引用失效在提交前就会被拦下。

**结果**：30 项测试全通过（新增 hygiene），保存/分栏两个内核 E2E 仍通过，
宿主路由 `/siyuan/state`、`/siyuan/context` 线上实测正常。

## 4.9 引用改为选中即浮出的操作条（第七轮需求）

**反馈**：工具栏里那个「❝ 引用」按钮会换行、也不顺手；希望做成 DSH 自己那种
「选中文字后浮出来的操作条」。

**做法**：

- 删掉工具栏末尾那个会换行的引用按钮（`test/hygiene` 会拦下它留下的死代码与孤儿词条）；
- 选中文字即浮出 `.sy-selbar`，一个「❝ 引用到对话」按钮；
- **两侧都能触发**：源码 `textarea` 的 `onMouseUp/onKeyUp`，渲染预览的 `onMouseUp`；
- **在选中那一刻就把原文与行号记下来**，点按钮只是把这份 payload 送出去 ——
  这样焦点移到操作条上也不会丢失选区（此前的实现正是被这个问题绊住）；
- 位置由纯函数 `selectionBarPosition()` 决定：鼠标选中浮在指针上方，
  键盘选中（没有坐标）就停在被读的那一栏右上角；四周都做钳制，贴边也不会飞出屏幕；
- 点击别处、滚动、按 Esc 都会收起。

**测试**：`test/chat.test.mjs` 断言四种定位（常规/贴左/贴上/贴右）与两种无坐标兜底，
全部 30 项测试通过，两个内核 E2E 仍通过。

**说明**：未选中文字时不再引用「光标所在段落」—— 该路径随工具栏按钮一起删除，
避免留一条没入口的死代码。需要引用整段时，选中该段即可（双击或拖选）。

## 4.10 侧边对话栏的两个按钮：历史对话 / 新开对话（第八轮需求）

**需求**：对话栏顶部再加两个按钮 —— 一个切换对话（历史），一个新开对话。

**接口**：只有 `sessions` 服务没有创建会话的能力（其 face 只暴露
`retain/using/retainInfo/refreshProjections/search/fork/scope/binding`），
创建会话归 `uiWorkspace` 管：

| 用途 | 接口 |
|---|---|
| 新开对话（静默，不跳走界面） | `sessions.create(opts?)` → 返回新会话 id（`ISessions` 声明里有） |
| 新开对话（兜底，等同应用自己的「新会话」） | `uiWorkspace.startSession()` |
| 切换对话（会切换主面板，本插件**没用**它） | `uiWorkspace.openSession(target)` |

**实现选择**：

- **切换**只切换本栏显示的会话（面板内 state 覆盖），**不调用** `openSession` ——
  那个接口的描述是「选择会话并显示其 Conversation，作为一个 UI 导航动作」，会把你从笔记面板带走。
- **新开**先试 `sessions.create()`（已经存在则用，不跳界面）；该 face 若没有暴露它，
  再退回 `uiWorkspace.startSession()`，并从会话列表里认领新增的那个 id。两条路都是特性探测，不硬依赖。
- 会话列表来自 `useSessions` 的 `ids/byId` 快照；
  **选择器必须返回稳定引用**（`useSyncExternalStore` 的经典陷阱），
  所以直接返回 store 自带的数组/对象，再在渲染里派生行数据；空值用共享的冻结常量兜底。
- 列表过滤掉子代理会话（`summary.parentId` 存在者），它们不该出现在「切换对话」里；
  标题取 `displayTitle || title || id 前 8 位`，并标出「当前」与「正在回复」。

**测试**：`test/chat.test.mjs` 新增

- 行模型：`displayTitle` 优先、`title` 兜底、只有 id 也不崩；过滤子代理；标出 running/current；
  空/畸形快照返回空数组；纯空白标题回退到 id；`limit` 生效；
- 头部：历史/新开/收起/关闭 四个按钮都在且各自接通；会话列表渲染在**所属表面内部**（跟随悬浮窗一起被裁剪），关闭时不渲染。

全部 30 项测试通过，两个内核 E2E 通过。

## 4.11 编辑器交互升级（第九轮需求）的验证

需求：把「源码 textarea + 渲染预览」的编辑器按思源的行为补齐九项交互 —— F1 Enter 续行/退出、F2 Tab / Shift+Tab 缩进、F3 快捷键、F4 撤销栈、F5 选中浮条、F6 自动配对、F7 大纲跳转、F8 滚动同步、F9 字数统计。

**这一轮由独立指派的验证员执行，实现方与验证方分离**：下面每个数字都是验证方自己跑出来的，没有转抄实现方的报告。探针脚本存放在工作区之外（`D:\tmp\dsh-verify\`），可按文中方法复跑，不会给仓库留痕。

版本标识：插件目录**没有 git 仓库，也没有改前副本**，所以本轮**无法做 diff**，只能审最终文件、并用哈希确认交付的是哪一版。验证过程中版本迭代过多次（`83b045a2…` → `f15a41e1…` → `bbeb462c…` → 最终 `42506a1b…`），**下面所有数字与行号都以最终版为准**。

| 文件 | sha256 | 规模 |
|---|---|---|
| `lib/client.js` | `42506a1b38b0996c92add58366b0171f21b5c3c9b99c5c424050b0366bbf9d93` | 3648 行（本轮起点 3038 行 / `6ca2f29f…`） |
| `test/editor-ux.test.mjs` | `5539fa1bbc5897489633bb02be0d82e6284f8d5fafa31ec748a2afe084f8500d` | 294 行，22 test / 120 断言 |

### 已执行的验证命令与实测数字

```bash
cd dsh-siyuan-notes
node --test                            # 52/52 pass, 0 fail
node --test test/editor-ux.test.mjs    # 22/22 pass
node test/render.test.mjs              # 634 components executed, depth 4, no exceptions
node test/hygiene.test.mjs             # 32 setters resolved / 95 translation keys / 66 classes
grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(' lib/client.js   # 0
node scripts/e2e-save.mjs              # 22 PASS, E2E: OK
node scripts/e2e-panes.mjs             # 13 PASS, PANE E2E: OK
```

与本轮之前对照：单测 30 → **52**；渲染冒烟 589 → **634** 组件；hygiene 28/86/64 → 32/95/66；硬编码颜色 0 → 0。
渲染计数增长与「格式栏新增下划线/高亮两个按钮 + 状态栏字数段」的**量级一致**（冒烟里 `EditorPane` 被渲染 13 次），没有逐项归因，只证明**没有异常**。

E2E 用的是脚本自建的 scratch 文档（`/DSH-E2E-<ts>`、`/DSH-PANE-{A,B}-<ts>`），`finally` 里按 docId 自删；跑完复查 `hpath LIKE '%DSH-%'` 剩余 **0** 篇。两个脚本都不读、不改、不删用户文档。

### 三档结论（逐条）

| 项 | 实现位置（`lib/client.js`） | 结论 | 证据 |
|---|---|---|---|
| F1 Enter 续行/退出 | `continueOnEnter` 788、`stripBlockMark` 826、`handleEnterKey` 1979 | ✅ 已实测 | 纯函数锁定断言 + 独立探针 27 条；**假 DOM 驱动真实 `onKeyDown`**：`- 项目`→`\n- `、`9. 项`→`\n10. `、`正文`→`\n\n　　`、`# 标题`/代码块内不拦截、空任务项退出并清标记 |
| F2 Tab / Shift+Tab | `changeIndent` 845、`indentSelection` 2010 | ✅ 已实测（含发现并修掉的边界反例，见下） | 缩进/反缩进/`from==to`/区间外不动/入参不被改写；假 DOM：`Tab`→`"  abc"` 且光标落在缩进后、`Shift+Tab` 还原、两者都 `preventDefault`（焦点不跳出编辑区）、多行选区逐行缩进 |
| F3 快捷键 | `HOTKEYS` 874、`INLINE_FORMATS` 890、`hotkeyOf` 901、`handleKeyDown` 2109 | ✅ 已实测（键位口径见偏差 1） | 假 DOM：Ctrl+B 包裹且**再按一次取消**、Ctrl+G→反引号、Ctrl+Shift+S→`~~`、**Alt+D→`==`**、普通字母不拦截 |
| F4 撤销栈 | `diffRange` 1008、`replaceRange` 1029、`applyEdit` 1914 | ⚠️ **部分已实测**：路由/回退/区间已实测；**浏览器原生撤销栈未验证** | 见下方 F4 专项 |
| F5 选中浮条 | `INLINE_GLYPHS` 1095、`INLINE_ORDER` 1096、`selectionBar` 2162、`selectionBarNode` 2219、`applyFormat` 1936 | ✅ 已实测 | 无 DOM 驱动（按 `useState` 序号播种状态）：浮条渲染出 **6 个格式键 + 引用**，顺序为 加粗/斜体/下划线/删除线/行内代码/高亮；点「加粗」把 `**加粗**` 写进缓冲区；点引用回传 `{text,line}`；预览侧只出现引用一个按钮、无分隔条 |
| F6 自动配对 | `AUTO_PAIRS` 966、`autoPairAction` 987、`AUTO_PAIR_KEYS` 1085、`EMPHASIS_KEYS` 1092、`pairKey` 2040 | ✅ 已实测 | `(`→`()` 光标居中、next-char-is-closer 跳过、全角 `（【《“`；`*`/`_` **有选区**才包裹、无选区放行原生；`~` 不拦截；**IME `isComposing` 与 `keyCode 229` 两条都实测被拦住** |
| F7 大纲跳转 | `outlineOf` 1377（新增 `line`）、`TreePane` 1519、`onOutlineJump` 1708、`caretRequest` 2671、跳转 effect 1961 | ✅ 已实测（到 `setCaretRequest` 为止） | `line` 为 0 基且跳过围栏代码块；把 TreePane 驱动到 outline 标签页：3 行、点第 1/3 行回传 **line 0 / 6** |
| F8 滚动同步 | `scrollSyncTop` 1062、`syncScroll` 2058、接线 2495 / 2508 | ✅ 已实测（比例函数）＋**观感未验证** | 比例映射 8 条断言（两端夹取、不可滚动源/目标）；重入锁与接线为代码复核，实际跟手程度未验证 |
| F9 字数统计 | `countText` 1075、状态栏 2516 | ✅ 已实测 | `chars` 去空白、CJK 计数、ASCII 单词、U+3000 计为空白；状态栏两段在渲染冒烟里执行无异常 |

补充：`INDENT_UNIT`（772，两个半角空格）已按冻结接口导出、实测值正确；`lineRange` 1099；`exports.__test` 在 3641 行、`exports.__panes` 在 3643 行。

### 本轮验证中发现并修掉的一个真反例：Tab 会多缩进一行（F2）

**修前实测（确实错了）**：选区终点**正好落在行首**时，下一行会被多缩进一行。

| 文本 `"a\nb\nc"` | 选区 | 修前结果 |
|---|---|---|
| 选 `"a\n"`（0..2） | 只覆盖第 1 行 | `"  a\n  b\nc"` ← **b 没被选中却被缩进** |
| 选 `"a\nb\n"`（0..4） | 覆盖第 1–2 行 | `"  a\n  b\n  c"` ← **c 被多缩进** |

触发路径很常见：从行首拖到下一行行首选整行。

**根因**：`to = value.slice(0, end).split("\n").length - 1`，当 `end` 在行首时，切片以换行结尾会多出一个空元素，把**从 `end` 开始的那一行**也算进区间。

**修法（已落地，2 行）**：在 `indentSelection`（2010）里改为
```js
const lineAt = (offset) => value.slice(0, offset).split("\n").length - 1;
const from = lineAt(start);
// 选区终点落在行首时，该行不算被选中
const to = end > start && value[end - 1] === "\n" ? lineAt(end) - 1 : lineAt(end);
```

**修后实测（6 组定点 + 4000 组 fuzz）**：

| 选区 | 期望缩进的行 | 实测 |
|---|---|---|
| 0..2 | 仅第 1 行 | ✅ `"  a\nb\nc"` |
| 0..4 | 第 1–2 行 | ✅ `"  a\n  b\nc"` |
| 0..5（全篇） | 三行 | ✅ `"  a\n  b\n  c"` |
| 4..4（光标在 c） | 仅 c | ✅ `"a\nb\n  c"` |
| 2..4 | 仅第 2 行 | ✅ `"a\n  b\nc"` |
| 1..4 | 第 1–2 行 | ✅ `"  a\n  b\nc"` |

另用 **4000 组随机文本/选区**做 fuzz：按文档规则独立推导「应该缩进哪些行」，与实际输出**逐行精确一致**；`Shift+Tab` 在每一组都能**把文本原样还原**；0 次崩溃；选区未出现反向（`start <= end`）。实现方给出的边界手推（`value[end-1] === "\n"` 时必有 `lineAt(end) - 1 >= lineAt(start)`，故 `to < from` 不可能）与实测一致。

⚠️ **这条边界没有任何纯函数测试覆盖**：`test/editor-ux.test.mjs` 的文件头 Scope 段已明确写出「Tab 选中哪些行（含选区终点落在行首）、原生撤销栈、滚动锁这三类不在纯函数测试范围内」。Tab 边界的唯一行为证据就是本节这组探针。后来者不要误以为 `editor-ux.test.mjs` 证明了 Tab 边界。

### F4 专项：撤销栈（本轮最重要的隐性修复）

**要修的问题**：受控 textarea 走 `update({text})` 会清空浏览器原生撤销历史，任何工具栏/快捷键改写之后 Ctrl+Z 就不再有效。

**实现**：`replaceRange`（1029）用 `document.execCommand("insertText", false, text)` 落地改写；`applyEdit`（1914）是唯一改写入口，先用 `diffRange`（1008）把「旧文本 → 新文本」折成一个最小替换区间，再交给 `replaceRange`（调用点 1925，状态回写 1926）。

**逐项实测**：

- **唯一入口（代码复核）**：全文 `update({ text })` 只有 2 处 —— 1926（在 `applyEdit` → `replaceRange` 之后）与 2482（textarea 原生 `onChange`，本来就该绕过）。程序化改写的 `applyEdit` 调用点共 8 处：1933 格式包裹、1994 + 2005 Enter 续行/退出、2036 Tab 缩进、2053 自动配对、2268 缩进开关、2273 行首块（H1–H3/引用/列表/任务）、2291 插入块（代码块/表格/分割线）。**未发现绕开 `replaceRange` 的路径**；find 跳转（2085）只改光标、不算改写。
- **区间正确性（已实测）**：`diffRange` 用 **20000 组随机串**（含中文、换行、重复字符、空串）验证两条性质 —— 用该区间重建后**逐字节等于目标文本**，且区间**最小**（两端各收一个字符都无法重建）。全部通过。「多段不连续改动折成一个大替换」不会改错文本，反例打了 2 万次没打穿。
- **分支行为（已实测，假 textarea + 假 `document.execCommand`）**：execCommand 成功 → `applied:true` 且光标复位；环境无 `document` → 回退到赋值、`applied:false`；execCommand **抛异常** → 回退且不冒泡；execCommand **返回 false 但 DOM 已经变了** → 判为 applied，**不会二次应用**；返回 false 且没变 → 单次回退；textarea 为 null 不崩。
- **集成证据（已实测）**：用假 DOM 驱动真实 `onKeyDown` 后，F1/F2/F3/F6 的每一处改写都**确实调用了 `execCommand("insertText", false, …)`**（不是给 `.value` 赋值），且插入的是 `diffRange` 算出的最小区间（例：Enter 续行只发一次 `"\n- "`）。
- **未验证（重要）**：**浏览器原生撤销栈是否真的因 `execCommand` 而保留**。本机 `node_modules` 只有 `@deepseek-ai`，没有 jsdom / happy-dom / linkedom，也没有浏览器；这条**无法在无 DOM 环境端到端证明** —— 需要人在面板里实际按一次 Ctrl+Z 才算数。另外 `document.execCommand` 已被标准废弃（Chromium 目前仍支持 `insertText`），这属于实现假设。

### 与任务描述的偏差（照实记录）

1. **F3 键位偏离 T2 的冻结文字**：task-2 写的是「alt 为真时一律 null」，实现里 `Alt+D → highlight`，并用 `e.code`（`KeyD`）兜底 macOS 上 Option 产生死键（`Option+D` 的 `key` 是 `"∂"`）的情况。依据是 T1 的源码调研：思源 `Constants.SIYUAN_KEYMAP` 的真实默认是 `Ctrl+G` 行内代码、`Alt+D` 高亮、`Ctrl+K` 链接、`Ctrl+Shift+S` 删除线；`Ctrl+Shift+C`、`Ctrl+Shift+H` 作为别名保留，另加本插件自己的 `Ctrl+S` 保存（思源没有保存快捷键，因为它即时落库）。已与 `notes/siyuan-editor-facts.md` §3.2 逐条核对一致，并补了 9 条锁定断言。
2. **T2 有两处比 task-2 原文更严**（不是被放宽）：`wrapSelection` 要求「标记被包含在选区内」也拆标记（原文只写「选区两侧正好是标记」）；`autoPairAction` 的「下一字符正好是 closer 就跳过去」原文与测试一致。实现两条都满足。
3. **纯函数能力 > 集成启用范围**：`autoPairAction` 支持 `* _ ~`，但键盘上 `AUTO_PAIR_KEYS`（1085）只放行 `( [ 【 《 " ' （` 与反引号；`*`/`_` 走 `EMPHASIS_KEYS`（1092）且**只在选区非空时**才拦截（无选区时保留 `*` 作为列表标记、`_` 作为普通字符）；`~` 完全不上键盘（单波浪线不是合法 kramdown 构式），**只有 API 可达**。
4. **T2 未被放宽**：120 条 live 断言、0 条被注释掉，没有 `|| true` / 空 `catch` / `skip` / 自己比自己 这类弱化写法，8 个冻结函数全覆盖。收尾时 editor-tests 又做了一次「防止过度声称」的措辞修订（只改 test 名与注释，断言条数与语义未动，哈希因此从 `89611352…` 变为 `5539fa1b…`）：test 名改为「Tab 和 Shift+Tab **解析成 indent/outdent 的 action id**」（它只锁键位映射、不锁缩进行为）、「one literal leading tab」、并在文件头与 `changeIndent` 段头写明 Tab 选区范围 / 原生撤销栈 / 滚动锁**不在纯函数测试覆盖范围内**。这三处修订与本次验证的三档纪律一致，值得保留。

### 边界复查（逐条实测）

| 场景 | 期望 | 实测结果 |
|---|---|---|
| Enter 在代码块内（`inFence`） | 不拦截 | ✅ 放行原生换行 |
| Enter 在标题行 | 不拦截 | ✅ 放行原生换行 |
| Enter 在表格行 | 不拦截 | ✅ 纯函数层 `\| a \| b \|` → `none`，不会注入缩进 |
| Enter 在空列表/空任务项 | 退出列表 | ✅ 标记被清除 |
| IME 组合期 `isComposing` / `keyCode 229` | 完全不改缓冲区 | ✅ 两条都拦住，`execCommand` 0 次 |
| 裸 `*` 无选区 | 放行原生（仍可当列表标记） | ✅ 未拦截 |
| `*` / `_` 有选区 | 包裹选区 | ✅ `*abc*` / `_abc_` |
| `~` | 不上键盘 | ✅ 未拦截（API 可达） |
| Tab 作用在代码块内的行 | —— | ⚠️ **会缩进**，见已知限制 1 |

### 已知限制与未验证（明确不当作已验证）

1. **`changeIndent` 对代码块内的行也会缩进**，与思源原版「Tab 只在列表项内改嵌套层级」不同；它没有围栏感知（与 `indentParagraphs` 不同，后者会跳过标题/列表/代码/引用/表格）。实测：`["```", "code", "```"]` 整体 `+1` 后三行都加了两个空格。这是有意的简化还是缺口，需要产品判断。
2. **「块内含空行」的存量缺陷**：见本节末尾 task-6 登记 —— 对这类真实文档，「改了任意一个字再保存」会重构那些块。
3. **toggle 语义与思源原版不同**：思源的取消条件是「选区内全部文本都带该格式」，我们是「选区两侧或内部正好有标记就拆掉」；部分加粗时我们会拆标记，思源会再加一层。行为可预期，但与原版不一致。
4. **编辑区 ↔ 预览的滚动同步是自创行为**：T1 确认思源里编辑区与预览是**互斥模式**，不存在两边实时同步滚动，没有原版可抄。比例映射函数已单测，但**实际观感（重入锁是否足够、快速滚动是否跟手）未验证**。
5. **F7 只验证到把请求交给编辑区**：textarea 无法把某一行直接滚进视野，实现是按行号比例估算 `scrollTop`，**实际定位准不准未验证**。
6. **所有视觉/手感一律未验证**（没有浏览器）：格式栏在窄窗口是否换行、选中浮条贴边的观感、暗色主题对比度、回车手感。
7. **F4 的原生撤销栈未验证**：见上方 F4 专项最后一条。

### 存量缺陷登记：块内含空行导致的「无编辑重写」（→ task-6）

**现象（已实测，真实内核只读）**：缓冲区用 `blocks.map(b => b.text).join("\n\n")` 拼接，若某个顶层块的 kramdown 自身含空行（典型：有序列表项 + 空行 + 缩进子项/子代码块），`splitMarkdown` 会把一个块读成多个，于是 `planSync` 判出 `update` + `insert`。

按块数取最大的 8 篇真实文档抽样（只读，未调用任何写接口）：

| 文档 | SQL 块数 | 顶层块 → split 后 | 含空行的块 | 未改一字时规划的写入 |
|---|---|---|---|---|
| `20251122094427-6282tin` | 1925 | 562 → 562 | 0 | **0** |
| `20251122094427-zvixuer` | 1615 | 446 → 446 | 0 | **0** |
| `20260119200046-0o1f2vb` | 1188 | 712 → 715 | 7 | 5 |
| `20260119200047-6icjm2n` | 725 | 401 → 402 | 1 | 2 |
| `20260119200047-6rlsgcd` | 660 | 305 → 311 | 1 | 10 |
| `20260119200046-kqcju8q` | 622 | 315 → 315 | 0 | **0** |
| `20260914190443-pao9tze` | 621 | 209 → 209 | 0 | **0** |
| `20260925214255-nnv2vce` | 621 | 209 → 209 | 0 | **0** |

**可见行为保证（已实测 + 代码复核）**：`save()` 的脏检查（1812）与自动保存 effect（1905）都有 `current.text === current.savedText` 早退，所以「**只打开、不编辑**」仍然**零写入**。风险只在**用户改了任意一个字再保存**时：上述含空行的块会被 update + insert 重构，**块 ID 会变**（内容不会丢，写进去的就是缓冲区内容）——块 ID 变化会让指向这些块的**引用/书签失效**。

**归属判断（仅代码复核）**：`splitKramdown` / `splitMarkdown` / `planSync` 是既有保存模型，不在 F1–F9 清单内，实现方也确认本轮未触碰；受影响样例是「有序列表 + 空行 + 缩进子内容」这类一直存在的写法。因此判断为**存量缺陷、非本轮回归**。**但因为没有 git 仓库与改前副本，无法 diff，这条只是逻辑推定，不能算已实测。**

**缓解措施**：保存前自动落快照（`~/.dsh/siyuan-backups/`）；建议对这类文档改完后先在预览里核对再保存。

**后续任务：task-6**（已登记，含修复方向与硬要求）。

### 开发期副作用：HMR 会重置面板状态（已实测）

插件在运行中的 DSH 里是热重载的：`dsh-client-hmr` 每 500ms 轮询 artifact，通过 SSE `/plugins/events` 把 graph 推给浏览器。实测复核：

```bash
curl -sN --max-time 2 http://127.0.0.1:55689/plugins/events   # graph rev 9f79b5b9e175
# 插件 entry: dsh-siyuan-notes → plugins/??dsh-siyuan-notes/client.js&rev=a0d6c1f74061
curl -s "http://127.0.0.1:55689/plugins/??dsh-siyuan-notes/client.js&rev=a0d6c1f74061" -o bundle.js
```

- 取回的 bundle **146972 字节** vs 磁盘 **146899 字节**，差的 73 字节正是 DSH 追加的 `\n;\n//# sourceMappingURL=…&rev=…`；**剥掉后与磁盘文件逐字节一致**。
- bundle 内含 `continueOnEnter`、`handleKeyDown`、`replaceRange`，以及本轮最后的 `const EMPHASIS_KEYS = "*_"` —— 说明**浏览器里跑的确实是最终代码**，不是只改了磁盘。

**副作用**：每 500ms 的轮询在文件变化时会重载插件模块，**面板的 React state 会被重置**。本轮开发期间 `lib/client.js` 被反复写入，如果当时面板里有未保存的改动，可能被重载冲掉。现在文件已定稿不再变化，**刷新一次页面即可回到干净状态**；正式使用时插件代码不会变动，不存在这个问题。

## 4.12 线上问题复查：缩进按钮「失效」与分栏联动（第十轮）

用户报障原话：
1. 「首行缩进的功能是不是失效了」
2. 「同时开两个编辑器，对其中一个操作（比如点首行缩进），两个编辑器都会同步操作……我认为两个编辑器应该分开操作」

**本节仍由独立验证员执行**：数字全部是验证方自己跑出来的；探针放在工作区之外（`D:\tmp\dsh-verify\`），不改 `lib/`、不改 `test/`、不对用户文档做任何写入。

### 版本标识

| 文件 | 验证时实测 sha256 | 规模 |
|---|---|---|
| `lib/client.js` | `2da62a415ab498c65df4005625b14558a269ce259e04b8640d6a15fca2f8db31` | 3728 行 |
| `test/editor-ux.test.mjs` | `e8fff31cc11e9e519b3ffad76415f61862f3adf819a07287d33992b7b06d457e` | 472 行 / 32 test / 146 断言 |
| `test/panes.test.mjs` | `ec3306cbaa6f3a383c98d2aa690187682fc9e5e8247e08e8267f073de3fc377c` | 158 行 / 46 断言 |

⚠️ **验证期间文件在动**：`lib/client.js` 从 `5370a68f…`（3715 行）变成 `2da62a41…`（3728 行，多出来的是 `makePane` 硬化）。两版我都跑过全量探针，结论一致；本节以上表这一版为准。`editor-ux` 也曾从 29 test 增至 32 test。

### 已执行的验证命令与实测数字

```bash
cd dsh-siyuan-notes
node --test                            # 62/62 pass, 0 fail（editor-ux 32、panes 1）
node test/render.test.mjs              # 634 components, depth 4, no exceptions
node test/hygiene.test.mjs             # 33 setters / 96 keys / 66 classes
grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(' lib/client.js   # 0
node scripts/e2e-save.mjs              # 22 PASS, E2E: OK
node scripts/e2e-panes.mjs             # 13 PASS, PANE E2E: OK
```

E2E 用的是脚本自建的 scratch 文档，自删；跑完后复查 `hpath LIKE '%DSH-%'` 为 **0** 篇（注意内核读模型有 0.3–1.5 s 滞后，立刻查会短暂看到刚删掉的那几篇，等一拍再查才是准的）。

### A. 用户文档的根因（只读实测，未写内核）

对用户报障时打开的 `20261028200018-0yxlhji`（`/绝世的笔记本/小说集/奥特曼：光之巨人/第一卷/001 第一章 红鞋的少女`，笔记本 `20251122094407-b4g4hhx`）只读复核：`getBlockKramdown` → `splitKramdown` → 以 `\n\n` 拼接 → 两个缩进函数。**全程没有任何写调用。**

| 指标 | 实测值 |
|---|---|
| 顶层块（`splitKramdown` 且 id 非空） | **82** |
| 缓冲区行数 | **163** |
| 看起来是段落起点的行（`isParagraphLine`） | **82** |
| 已经带 `　　` 缩进的行 | **0** |
| `bareParagraphLines()` | **82** |
| `indentParagraphs()` 会改动的行数 | **82** |
| `unindentParagraphs()` 会改动的行数 | **0** |

**根因成立**：这篇文档一个缩进都没有，而缩进开关**默认开着**。旧逻辑「开着点一下 = 关闭」→ 调用 `unindentParagraphs` → 在这篇文档上**什么都不改**，旧代码在「改不动」时也**不发任何提示**。用户看到的就是「点了没反应 = 失效」。**缩进算法没坏，坏的是按钮语义**：开关状态与文档实际状态矛盾时，点击的含义与用户预期相反。这解释了用户问题 ①。

### B. 缩进按钮的四种状态（已实测，问题 ①）

> ⚠️ **本节记录的是第十轮的「补齐优先」方案，该方案已被撤销**。第十一轮改为「真开关 + 独立的『补齐全篇（N 段）』按钮」，**当前实现不再使用下表的语义**；本节保留作为「当时为什么这么做 / 为什么后来改掉」的历史记录，现状见 §4.13。

新逻辑 `next = !indentOn || bare > 0`：还有段落缺缩进时，点击只做补全、开关保持打开。用**假 DOM + 真实 `onClick`** 驱动：

| 状态 | 期望 | 实测 |
|---|---|---|
| (a) OFF + 有未缩进段落 | ON + 补全 | ✅ `onIndentChange(true)`、写入 `indentParagraphs`、提示 `indentAppliedCount(2)` |
| (b) **ON + 有未缩进段落**（用户撞到的死角） | **保持 ON** + 补全 | ✅ 开关不翻转、写入补全结果、补全后 `bareParagraphLines` 归零、提示带段数 |
| (b2) 补全后再点（ON + 全部已缩进） | OFF + 移除 | ✅ `onIndentChange(false)`、写入 `unindentParagraphs`、提示「已移除」 |
| (c) ON + 全部已缩进 | OFF + 移除 | ✅ 同上 |
| (d) OFF + 全部已缩进 | ON，sweep 无变化 | ✅ 只改开关、**不写文档**、提示 `indentAlreadyOn` |
| 空文档 | 不报错 | ✅ 只改开关、不写、无提示 |

另用用户文档的真实形状（82 段全未缩进）实测：**一次点击补上 82 段**，提示 `indentAppliedCount(82)`，补全后 `bareParagraphLines` 归零，再点即按 (b2) 关闭。文档为空时不抛错。

**验证方的独立判断（对「补齐优先」）——我认为它比纯开关更容易让人困惑，理由如下**：

1. **文档一旦存在未缩进段落，开关就无法一次关闭**。「想去掉勾选」的人点一下，反而会**批量改写整篇**（本例 82 段）并保持勾选；要真正关闭，必须先经历一次全篇改写、再点一次（那次又会移除缩进）。「关闭」这个意图被绑上了两次正文改动。
2. **外观与行为不一致**：按钮仍渲染 `✓ ` 前缀 + `data-active`，长得像复选框（勾选/取消），实际语义是「补齐 / 移除」。没人预期点复选框会改正文。
3. 它确实修掉了「静默无反应」，这点是对的；但代价是把一个**偏好开关**变成了一个**会批量改文档的动作**。

建议（任一）：
- **A（我倾向）**：保持真开关 `next = !indentOn`，但**每次点击都给明确提示**：开启且有未缩进段落时提示「已开启；本文档还有 82 段没有缩进」（并在提示里给一个「补齐」入口），关闭时提示「已关闭；已有段落的缩进未改动，点「移除缩进」可去掉」。这样既不会静默，也不会在用户想关闭时意外改写正文；「补齐全篇」作为独立动作。
- **B**：拆成两个控件 —— 开关（只管以后按回车是否缩进）+「补齐全篇 / 移除全篇」按钮。
- 若保留现状：至少把 `✓ ` 勾选外观改成明确的动作按钮文案，别让 affordance 与行为打架（`indentHint` 已经把行为写清楚了，问题只在按钮长相）。

### C. 每栏独立（已实测数据与渲染，部分仅代码复核，问题 ②）

`view` / `autoSave` / `indentOn` 已从面板级搬进 `panes` 每栏。实测清点 `PanelPage` 的 state，只剩 `connection/panes/activePaneKey/stamps/caretRequest/chatSurface/floatCollapsed/floatBox/sessionOverride/historyOpen/sessionRefState` —— **面板级不再有这三个开关**。

| 断言 | 结论 |
|---|---|
| `makePane(key)` 默认 `view:"split"/autoSave:false/indentOn:true`、`tabs:[]`、`active:-1`，每次返回新对象、不共享 `tabs` 数组 | ✅ 已实测 |
| 只有三个 flag 被继承；`key`/`tabs`/`active` 由工厂决定 —— **把整个源栏对象当 extras 传进来也拿不走 key/tabs/active**（`makePane(9, 整栏)` → `key=9, tabs=[], active=-1`） | ✅ 已实测 |
| `view` 走 `VIEW_MODES` 白名单（非法值回落 `split`）；`autoSave` 只认严格 `true`；`indentOn` 只认显式 `false` | ✅ 已实测 |
| **同一组件用两组 props 渲染，各自只显示自己的状态**：A(indentOn, split, autoSave) 有 `✓`、`split` 标签 active、勾选框勾上、有 textarea；B(indentOn=false, preview, no autosave) 没有 `✓`、`preview` 标签 active、勾选框空、无 textarea | ✅ 已实测 |
| 点 A 的缩进按钮只触发 A 的回调，B 完全不受影响 | ✅ 已实测 |
| 面板渲染时每栏的 `setView/setAutoSave/onIndentChange` 都绑定到 `pane.key` | 🔍 仅代码复核 |
| `pushContext` 报激活栏自己的 `view`（依赖数组 `[]`，函数体从 `panesRef` 读实时值） | 🔍 仅代码复核 |
| `splitPane` 只传三个 flag（不展开源栏） | 🔍 仅代码复核；**且工厂硬化后即使传整栏也安全**（见 E 的 M6） |

**测试覆盖**：`panes.test.mjs` 现在锁住了「整栏当 extras 传入」这个真实回归（`key=9`、`tabs=[]`、`active=-1`、未知键不复制、非法 view 回落），以及 `makePane` 的默认值与继承语义。`splitPane` 本身（组件内闭包）仍无直接测试，但它的失败模式已被工厂堵死。

### D. 预览模式不再毁文档（已实测）

`applyEdit` 在**没有 textarea**（预览视图）时走 `update({ text: result.text })`，不再调用 `replaceRange(null, …)` 拿回 `{text:null}`。

实测（真实组件 + 无 textarea 渲染）：在预览视图下点缩进按钮，写回缓冲区的是 `indentParagraphs(全文)` 的**完整字符串**，不是 `null`、也不是插入片段。上一版「把整篇文档写成 null / 片段」的路径已不可达；`replaceRange(null, …)` 仍返回 `{text:null}`，且 `applyEdit` 在调用它之前就分流了。

### E. `replaceRange` 的新契约与变异测试（回答「测试是加严了还是互相放水」）

新契约：`wanted` 由原文重算 → 试 `execCommand("insertText")`（包 try/catch）→ **`if (textarea.value !== wanted) textarea.value = wanted`** 兜底 → 返回 `{text: wanted, applied: byCommand}`。九条分支实测：

| 场景 | 实测 |
|---|---|
| 浏览器真的执行了 `insertText` | `{text:"aXYc", applied:true}`，DOM 一致，光标按调用方要求复位 |
| **返回 true 但什么都没改**（静默 no-op） | `{text:">>abc", applied:false}`，**文本确实落到位** |
| 命令改错了位置 | 被纠正为 `wanted`，`applied:false`，**只纠正一次** |
| 返回 false 但 DOM 已变 | `applied:true`（撤销栈确实覆盖了） |
| 命令抛异常 / 没有 `document` | 不冒泡，回退赋值 |
| 编辑前后相同 | `applied:false`，不误报 |
| 中文 + 换行 / `textarea` 为 null | 区间正确 / 返回 `{text:null}` |

**变异测试**（在 `D:\tmp\dsh-verify\mut` 的副本上做，仓库零改动；把每个修复逐个改坏，看仓库测试是否变红）：

| 变异 | 结果 | 说明 |
|---|---|---|
| M1 `makePane` 改回 spread extras（当初的分栏 bug） | **被抓住** | `panes.test.mjs` 变红 |
| M2 删掉 `replaceRange` 的兜底赋值 | **被抓住（3 条）** | 含「声称成功但没改」「改错位置」「无 document」 |
| M5 删掉 `bareParagraphLines` 的围栏跳过 | **被抓住** | 一致性测试变红 |
| **M3 删掉 `applyEdit` 的预览分支** | **存活** | 没有任何测试覆盖 → 真实缺口（那条名字叫 preview path 的测试并不调用 `applyEdit`） |
| **M4 缩进按钮改回纯开关 `next = !indentOn`** | **存活** | **本轮用户报障的那个修复本身没有回归测试** |
| M6 `splitPane` 改成 `{...current}`（整栏展开） | 存活但**无害** | 属等价变异：工厂已忽略 `key/tabs/active`，行为不变；真正的锁在 M1 |

**结论**：测试**确实加严了**（M1/M2/M5 三个修复都有真锁，不是互相放水）；但**不是全覆盖**：M3 与 M4 存活，其中 **M4 正是这一轮的核心修复** —— 把它改回旧语义，`node --test` 依然 62/62 全绿。建议补两条测试（用现有的 stub-React harness 直接驱动 `EditorPane` 即可，我的探针可作参考）：
1. 无 textarea 时点缩进/加粗，写回的是完整文档（防 M3）；
2. 缩进按钮四种状态转移，尤其是「ON + 有未缩进段落 → 保持 ON 并补全」（防 M4）。

### F. `bareParagraphLines` 一致性不变量（回答「能否防住漂移」）

- 我用 **3000 组随机文档**（标题/列表/引用/表格/围栏代码块/已缩进/空白行混合）验证：`indentParagraphs` 实际改动的行号 **逐行等于** `bareParagraphLines()`；补全后再扫一次无 bare 且第二次补全是 no-op。全过。
- **判断**：那条一致性测试能防住「单边漂移」（只改了一边、忘了另一边），但不能防「两边一起漂」—— 它比较的是两个实现彼此是否一致，而非是否符合规格；若两者同时漏掉同一类行，测试仍绿。它也只覆盖固定的 7 个样本。真正钉住语义的是 `indent` 系列断言 + 真实文档那 82 段。

### G. 本轮新发现的问题（不在报障范围，但影响用户）

1. **词典重复键导致用户可见文案错误（已实测）**：JSON 对象后写覆盖前写。

| 键 | 前一处 | 生效的后一处 | 后果 |
|---|---|---|---|
| `split`（zh） | 「分栏」 | 「在右侧拆分」 | 视图标签实际显示为 **`编辑 / 在右侧拆分 / 预览`** |
| `split`（en） | 「Split」 | 「Split right」 | `Edit / Split right / Preview` |
| `quote`（zh） | 「引用」 | 「引用并提问」 | 工具栏**引用块**按钮显示成「引用并提问」，与动作不符 |
| `quote`（en） | 「Quote」 | 「Quote & ask」 | 同上 |
| `indentHint`（zh） | 同值重复 | — | 无行为影响，建议删一条 |

> 归属无法判定（无 git、无改前副本），但**当前版本的用户可见文案就是错的**。

2. **「最多三栏」的提示用错了键**：`splitPane` 在已达三栏时 `setNotice({ text: t("split") })`，用户看到的是「在右侧拆分」这种不是提示语的文字；词典里也没有专门的「最多三栏」键。
3. **`hygiene` 的翻译检查有盲区（已实测）**：它只匹配 `t("key")`，**不检查带参数的 `t("key", {…})`**。当前共 **106** 个不同键、其中 **27** 个是带参数形式，hygiene 只数到 96。我逐个核对过：**106 个键在中英词典里都存在**（这一版无缺失），但这个盲区意味着以后新增带参数文案漏翻时抓不到。建议把匹配扩成 `t\("([A-Za-z][\w]*)"\s*[,)]`。

### H. 新增测试的质量审计

- `editor-ux.test.mjs`：146 条 live 断言、0 条被注释、无 `|| true` / 空 `catch` / `skip` / 自我比较。新增的 `replaceRange` 与 `bareParagraphLines` 断言都是真断言，注释也诚实（明确写「今天没有生产调用方走到这里，只是把哨兵钉住」）。
- ⚠️ **一条名不副实的测试**：`preview path: what applyEdit writes back is always string text` **并没有调用 `applyEdit`**，只是对 `wrapSelection`/`autoPairAction` 断言返回字符串。它守的是「改写函数可能返回 null」，有价值，但不能证明预览分支正确（变异 M3 存活即为证）。
- ⚠️ `replaceRange: a real browser edit keeps the undo stack` 只断言了 `applied === true`，撤销栈本身无法在 Node 里验证；建议改名或加注释。
- `panes.test.mjs`：46 条断言、无空洞写法，覆盖了 M1 那个真实回归。

### I. 未验证（明确不当作已验证）

1. **真实浏览器里的手感与撤销栈**：所有交互都在「假 DOM + 假 `execCommand`」里驱动；`Ctrl+Z` 能否撤销「补齐 82 段」这类批量修改，**必须由人在页面上按一次才作数**。
2. **两栏在真实界面里是否真的分开**：数据模型与渲染已实测独立，但 `setPaneFlag`/`splitPane`/`pushContext` 的接线只做了代码复核；「点左栏按钮右栏不动」没有在真实页面上点过。
3. **视觉**：`✓ ` 勾选外观、三栏在窄窗口的布局、提示条长度。
4. 用户文档只做了**只读**复核，没有对任何用户文档执行写入或缩进操作。

### J. 直接回答用户的两个问题

- **为什么「看起来失效」**：这篇文档 82 个段落一个缩进都没有，而开关默认是「开」。旧逻辑「开着点一下 = 关」，于是去执行「移除缩进」—— 没有可移除的，就什么都不发生、也不提示。算法没问题，是按钮在「开关已开 + 文档无缩进」这个自相矛盾的状态下做了看不见的事。
- **现在为什么两栏分开了**：`view`/`autoSave`/`indentOn` 从面板级搬进了每栏，工厂只继承这三项、显式取值不展开；面板不再持有共享开关，所以一栏的点击只改自己那一栏（已验证两栏 props 与回调互不影响）。
- **还没验证什么**：真实浏览器里的 Ctrl+Z、真实点击两栏的观感、以及「补齐优先」在用户手里会不会造成意外批量修改（我倾向于会，建议按 B 节 A/B 方案之一调整）。

## 4.13 最终版复查：撤销「补齐优先」+ 词典与测试修复（第十一轮）

> **先更正 §4.12**：§4.12 的 B 节记录的是第十轮的「补齐优先」方案，**该方案已被撤销**。现行实现是第十一轮改成的「**真开关 + 独立的『补齐全篇（N 段）』动作按钮**」，四态语义与 §4.12 不同（见本节 A）。§4.12 的 A 节根因分析（82 段全未缩进、旧按钮静默无操作）**仍然成立**，只是修复方式变了。

### 版本标识

| 文件 | 验证时实测 sha256 | 规模 |
|---|---|---|
| `lib/client.js` | `e49b3a174fc54ecf857f14a11fef37a1f28898b455f3b1446e6719176b053656` | 3767 行 |
| `test/editor-actions.test.mjs`（新） | `d5203950dfef91872eeda20f163ea73078fccce08d4483cb6183a5f0c41de6a4` | 178 行 / 8 test |
| `test/hygiene.test.mjs` | `eb42415817c1a965a65549be88d9609e64440995902339b04945a781d0eeb5c8` | 105 行 |
| `test/editor-ux.test.mjs` | `e8fff31c…`（未动） | 472 行 / 32 test |
| `test/panes.test.mjs` | `ec3306cb…`（未动） | 158 行 |

### 已执行的验证命令与实测数字

```bash
cd dsh-siyuan-notes
node --test                            # 70/70 pass, 0 fail
node test/render.test.mjs              # 641 components, depth 4, no exceptions
node test/hygiene.test.mjs             # 33 setters / 99 keys / 66 classes
grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(' lib/client.js   # 0
node scripts/e2e-save.mjs              # 22 PASS, E2E: OK
node scripts/e2e-panes.mjs             # 13 PASS, PANE E2E: OK
```

### A. 缩进开关恢复为「纯开关」：四态实测

| 状态 | 期望 | 实测（假 DOM + 真实 `onClick`） |
|---|---|---|
| (a) OFF + 有未缩进段落 | ON + 补全已有段落 | ✅ `onIndentChange(true)`、写入 `indentParagraphs`、提示 `已给 2 个段落补上缩进（开关保持打开）` |
| (b) **ON + 有未缩进段落**（上一轮的死角） | **一次点击即可关闭**、不动正文、明确提示 | ✅ `onIndentChange(false)`、**零次写入**、提示 `段落本来就没有缩进（开关已关闭）` |
| (c) ON + 已全部缩进 | OFF + 移除 | ✅ `onIndentChange(false)`、写入 `unindentParagraphs`、提示「已移除」 |
| (d) OFF + 已全部缩进 | ON，无变化 | ✅ 只改开关、不写、提示 `段落已经都有缩进了` |
| 空文档 | 不报错 | ✅ 只改开关、不写、无提示 |

即：**开关可以一次关闭了**，且关闭时不会顺手改写正文 —— 上一轮我提的两个问题都解决了。

### B. 独立的「补齐全篇（N 段）」动作：实测

- **只在还需要时才出现**：`bareParagraphLines(text).length > 0` 时渲染，标签 `补齐全篇（2 段）`，`title` 为 `indentFillHint`；文档全部缩进后**按钮消失**（用补全后的文本重新渲染实测为 `null`）。
- **点一下 = 补全 + 开关置 ON + 提示段数**：`onIndentChange(true)`、写入 `indentParagraphs(text)`、提示 `已给 3 个段落补上缩进（开关保持打开）`。
- **只补正文段落**：`# 标题 / - 列表项 / > 引用 / | a | b | / ```代码``` ` 全部原样，只有普通段落获得 `　　`。
- **用户真实形状**：82 段全未缩进 → 按钮标签 `补齐全篇（82 段）`，一次点击后提示 82，且 `bareParagraphLines` 归零、按钮随之消失。
- 词典键 `indentFill` / `indentFillHint` 中英齐备，`补齐全篇（7 段）` ↔ `Indent all (7)`。

### C. 预览视图（无 textarea）不再毁文档：实测

`view="preview"` 时工具栏仍在（只有格式栏被 `view !== "preview"` 挡住），所以缩进开关与「补齐全篇」在预览视图里**真实可点**——这正是 `applyEdit` 无 textarea 分支的生产路径。实测：预览视图点「补齐全篇」/ 点开关，写回的是 `indentParagraphs(全文)` 的**完整字符串**，不是 `null`、不是片段；`view="split"` 且无 textarea 时点加粗，同样写回完整文档并带上标记。

### D. i18n 修复：页面实际渲染的文案（用真实中英词典渲染）

| 位置 | 实测显示 | en |
|---|---|---|
| 视图切换标签 | **编辑 / 分栏 / 预览**（不再出现「在右侧拆分」） | Edit / Split / Preview |
| 工具栏「引用块」按钮 | **引用**（不再出现「引用并提问」） | Quote |
| 分栏图标按钮 title | **在右侧拆分** | Split right |
| 三栏上限提示 | **最多只能分成三栏** | Three columns at most |

词典整体：**zh 131 键 / en 131 键、重复 0、两边键集合完全相同**；代码里实际用到 **110** 个键（99 个 `t("k")` + 11 个 `t("k", {…})`），**在中英词典中均无缺失**。

### E. 两个旧测试洞是否真的被补上（变异实测，仓库零改动，副本在 `D:\tmp`）

| 变异 | 结果 |
|---|---|
| **A1** 把 `toggleIndent` 改回「补齐优先」（撤销本轮修复） | **被抓住**：`indent switch: turning it off on an unindented document changes nothing and says so` 变红 |
| **A2** 删掉 `applyEdit` 的 `!ta` 分支（上一版的毁文档 bug） | **被抓住 6 条**（开关 3 条、补齐全篇 2 条、预览写回 1 条） |
| **D1** 往 zh 词典注入重复键 | **被抓住**（`hygiene` 红） |
| **D2** 删掉 zh 里的带参键 `indentFill` | **被抓住**（带参检查红） |
| **D3** 只删 en 里的 `quoteBlock` | **被抓住**（词典缺失检查红） |

上一轮我报的 M4（按钮语义无测试）与 M3（预览分支无测试）**这两个洞都补上了**，新增的 `editor-actions.test.mjs` 是有效的组件级测试（驱动真实 `EditorPane`、断言写回文本/开关/提示/按钮在否），不是装饰。hygiene 的两条新检查也确实咬得住。

### F. 本轮新发现的一个缺口（小，但同类问题曾致用户可见错误）

**`link` 这个词条在中英词典里都不存在，而格式化能力里有它**：`INLINE_FORMATS` 含 `link`（`Ctrl+K`，思源默认键位），`applyFormat` 用**动态** `t(action)` 取占位词。实测：光标处按 `Ctrl+K` 插入的是 **`[link](https://)`** —— 占位词是未翻译的键名 `link`，在中文界面里很突兀（插进去的 Markdown 本身合法，选中文字时不受影响，因为占位词只用于空选区）。

这属于 §4.8「`chat` 词条丢失」同一类：**动态 `t(action)` 不在 hygiene 的两条检查范围内**（它们只匹配字面量 `t("key")` / `t("key",`）。建议二选一：
- 给 `link` 补上中英词条（最小修复）；
- 或在 hygiene 里加一条：遍历 `INLINE_FORMATS` 的键，断言词典里有（`INLINE_FORMATS` 已在 `__test` 导出，测试里可以拿到）。

顺带一提：`quote` 键现在**没有任何引用点**（引用块改用 `quoteBlock`、引用到对话用 `quoteSelected`），是死键，可删可留，不影响行为。

> ✅ **上面这条 `link` 缺口与 `quote` 死键都已在第十二轮修掉**，并补了静态守卫，见 §4.13 的 I 节。

### G. 残余风险（我认为还可以更好，但不是本轮缺陷）

1. **hygiene 的重复键检查依赖格式**：它用 `/\n\t*key:/` 匹配，若将来把词典改成单行或嵌套对象，检查会静默变弱（好在有 `keys.length > 40` 兜底）。带参检查的正则也可能命中注释里的 `t("x",`。
2. **一次「补齐全篇」是一次整篇 bulk 改写**：走 `replaceRange` → `execCommand`，撤销依赖浏览器原生栈；**能否一次 Ctrl+Z 撤销整篇补全仍未在真实浏览器验证**。
3. **`bareParagraphLines(doc.text)` 每次渲染都全量扫一遍**：长篇（163 行）无感，超长文档的性能未测。
4. **工具栏又多了一个按钮**（开关 + 补齐全篇 + 重命名 + 删除）：窄栏下是否换行、观感如何，未做视觉验证。
5. 两栏在真实界面里的点击联动仍未真人点过（数据与渲染层已实测独立）。

### H. 未验证

真实浏览器里的 `Ctrl+Z`（尤其整篇补全后撤销）、两栏真实点击观感、工具栏在窄栏的换行与视觉、超长文档性能。用户文档 `20261028200018-0yxlhji` 全程只读。

### I. 最后一个小 delta（第十二轮）：`link` 词条、死键、以及对应的静态守卫

**这一版只动了两个文件**（其余与上文相同）：`lib/client.js` `80e6b60d…`（3767 行，行数未变）、`test/editor-actions.test.mjs` `5f45b18f…`（+1 test，现 9 test）。

实测：`node --test` **71/71**、`render` **641** 无异常、`hygiene` **33/99/66**、硬编码颜色 **0**。本轮未跑内核 E2E（只动词典与一个按钮的 `onClick`，保存路径未触碰）；E2E 的最近一次实测仍是上一小节的 **22 PASS / 13 PASS**。

1. **`link` 词条已补，且真的渲染出来了**：`zh.link = "链接"`、`en.link = "Link"`。实测光标处 `Ctrl+K` 空选区插入 **`[链接](https://)`**（英文词典下 `[Link](https://)`），不再出现裸键名。
2. **工具栏 🔗 按钮与 `Ctrl+K` 合流**：两者现在都走 `applyFormat("link")`，实测插入的标记与占位词完全一致（都是 `[链接](https://)`）——之前按钮占位词是「插入链接」、快捷键是裸 `link`，两处不一致的问题消失。
3. **死键 `quote` 已删除**（中英各一条）；zh/en 仍各 **131 键**，无重复。
4. **新增静态守卫（第 9 条测试）确实咬得住**——我做了 4 个变异（副本上，仓库零改动）：删 `zh.link` → 红；删 `en.link` → 红；删 `en.quoteBlock` → 红；**只往 zh 加一个键**（制造单边缺失）→ 也红。这条守卫遍历 `INLINE_FORMATS` 断言 `zh/en` 都是非空字符串，并反向断言两边键集合完全相同，正好覆盖了动态 `t(action)` 那个盲区与 §4.8 那次事故的形状。
5. **我按要求做了全量死键审计，结论：还有 20 个，但都不影响行为**。判定标准是「代码里既没有字面量 `t("key")`/`t("key",{…})`，也不属于动态族 `INLINE_FORMATS` 的键」，并用「带引号出现次数为 0」在 `lib/client.js` + `lib/index.js` 双重确认：

   > `backupAt, chatFloat, chatNew, chatSide, create, createDoc, createDocHint, disconnected, editor, emptyDoc, fallbackNotice, insertImage, newTab, noDocHint, noDocSelected, notebooks, panelBrokenHint, retry, subtitle, tip`

   **中英两份清单完全相同**（说明不是单边漏翻，而是历史遗留的未用文案）。它们只是无用字符串，不影响任何行为；且**目前没有自动化的死键检查**（要加的话得先把「动态查找族」写进检查，例如以 `INLINE_FORMATS` 为白名单，再断言「词典键 − 可达键」等于一个冻结的已知死键集合）。
6. **仍未验证/仍存在的风险**：真实浏览器里的 `Ctrl+Z`（尤其整篇「补齐全篇」后能否一次撤销）、窄栏工具栏换行观感、超长文档下每次渲染全量 `bareParagraphLines` 的性能、两栏真人点击联动 —— 与上一小节相同，本轮没有新增未知项。

### J. 结论

用户报的两个问题都已闭环：**「看起来失效」**的根因（82 段全未缩进 + 旧按钮把「关」当成无事可做）已定位，并改成「开关只管以后、动作负责补全」两件事分开——开关一次能关、点击不再静默；**两栏联动**已从面板级 state 搬进每栏、工厂显式取 flag，渲染层实测两栏互不影响。上一轮我指出的两个测试洞与三处文案/检查问题都已修复，且我用变异测试独立确认修复有测试兜底；本节提到的 `link` 词条缺失也在随后的 delta 里补掉并加了静态守卫（见 I 节）。剩下的主要是「真实浏览器里手感/撤销」这一类只能人肉确认的部分。

## 4.14 事故复盘：白屏 —— 每栏 props 接线残留了作用域外标识符（第十二轮）

**用户报障**：「打开思源笔记直接白屏」。

**版本**：`lib/client.js` `d0b3323c…`（3759 行）、新增 `test/panel-render.test.mjs` `4b19c335…`（120 行 / 3 test）；其余测试与 `README` 未变。实测 `node --test` **74/74**、`render` **641** 无异常、`hygiene` **33/99/66**、硬编码颜色 **0**。（纯客户端改动，未跑内核 E2E。）**随后又做了两条测试侧硬化，最终为 76/76 / render 643 / hygiene 33/100/66 —— 见本节末尾「后续补丁」。**

### 根因（已复核成立）

上一轮用**行定位脚本**改 `PanelPage` 里每栏的 props 接线时，一次「替换 1 行」实际插入了 9 行，于是旧的 6 行 props（`setView, / autoSave, / setAutoSave, / indentOn, / onIndentChange: setIndentOn,`）留在了新块下面。结果 `panes.map(...)` 里 `h(EditorPane, {...})` 的对象字面量出现了**重复键**，而残留的 `setView` / `setAutoSave` / `setIndentOn` 在 PanelPage 作用域里**不存在** → 只要有文档打开、`panes.map` 一开始执行，就抛 `ReferenceError`。

**复核过程**：

1. **现状确认**：`panes.map` 里的 `EditorPane` props 现在是**唯一一套**（3494–3515：`doc / stale / setDoc / view / setView / autoSave / setAutoSave / indentOn / onIndentChange / onQuote / onCaret / caretRequest / onNotice / onSaved / onReload / onRename / onRemove`），没有第二套、没有残留；全文件也扫不到 `^\s*(setView|setAutoSave|setIndentOn|autoSave|indentOn),$` 这种悬挂简写。
2. **精确复现**：把上述 5 行残留按原样塞回副本 → `panel-render.test.mjs` **3 条全红，错误正是 `ReferenceError`**。机制判断成立。
3. **为什么是白屏而不是报错**：`PanelBoundary`（1455 行）只包在 **PanelPage 内部**（3414 行，包住 `TreePane` 与编辑列）；`PanelPage` 自身函数体抛错时，那个边界根本没机会渲染。槽注册（3694–3719）直接把 `PanelPage` 交给 `main` 槽，于是渲染失败 → 该注册不可用 → 用户看到空白且没有任何文案。
4. **线上 bundle**：运行中的 GUI 经 SSE 下发的插件 bundle 为 rev `3b2f8333f388`，**与磁盘文件逐字节一致**（152199 vs 152126，差 73 字节正是 DSH 追加的 `;` + sourceMappingURL），且其中**没有悬挂的 `setView,` / `setAutoSave,` / `setIndentOn,`**。
   ⚠️ **`main` 槽当前是否 `active: true` 我无法从 HTTP 侧独立验证** —— 槽状态只存在于 DSH 进程内部，SSE 的 graph 不含 active 标志。这一点依据实现方报告；我能独立证明的是「浏览器拿到的确实是修好的那一版」。

### 为什么 74 条测试没抓住

- `test/render.test.mjs` 确实渲染了 `PanelPage`，但用的是**空栏**状态（`panes = []`）——`panes.map(...)` 的循环体**一次都不执行**，那 9 行接线从来没被跑过。
- `test/editor-actions.test.mjs` 直接调用 `EditorPane`，不经过 `PanelPage`。
- 也就是说：**面板级 props 接线这一层，此前没有任何测试在「有打开文档」的状态下执行过**。这与 §4.8 那次「`chat` 词条丢失」同一性质 —— 不是断言写松了，而是**测试没覆盖真实状态**。

### 新守卫 `test/panel-render.test.mjs` 是不是真测试（4 个变异，副本上做，仓库零改动）

| 变异 | 结果 |
|---|---|
| **M1 把事故那 5 行残留加回去** | **3 条全红，`ReferenceError`**（精确复现事故） |
| M2 把传给 `EditorPane` 的 `onIndentChange` 改名 | 红（handler 必须是 function） |
| M3 让每栏都读 `panes[0].view`（跨栏串味） | 红（两栏 view 断言不等） |
| M4 删掉 `onCaret` 传递 | 红（handler 必须是 function） |

它是真测试：带文档渲染 `PanelPage`、递归走到 `EditorPane` 节点、断言 11 个 handler 都是函数、并断言两栏的 `view / autoSave / indentOn` 各随各栏。

### 补充验证：21 个面板状态全部渲染干净

用「按 `useState` 序号播种」的 harness 把 `PanelPage` 拉到 21 种状态下渲染（空栏 / 1 栏 0 标签 / 1 栏 1 标签 / 1 栏 2 标签 / 2 栏 / 3 栏 / 文档 loading / 文档 error / stale 点 / 大纲 caret 请求 / 对话表面 side·float·float 收起·off / 拖动过的浮窗框 / 历史弹层 / 通知 / 删除对话框 / 重命名对话框 / 连接失败 / `activePaneKey` 指向不存在的栏 / 栏内 active 越界）：**21/21 全部无异常**，每个渲染出的 `EditorPane` 都拿到 11 个函数 handler 与合法的 `view/autoSave/indentOn`。
这回答了「这轮脚本可能不止一处」：**没有发现第二个作用域外标识符**。但这是**动态**证据（跑到才报错），不等于全量静态作用域分析。

### 过程教训

1. **行号定位脚本改多行结构是高危操作**：这次「替换 1 行、实插 9 行」产生的是**同一对象字面量里的重复键**，运行期只表现为「白屏」、没有报错文案；仓库没有 git、没有改前副本，**出事后无法 diff**，只能靠复现。
2. **渲染冒烟只测「空栏」= 没测真实状态**：`panes=[]` 让整个每栏接线分支空转。这是本轮最大的测试设计漏洞，性质与 §4.8 的 `chat` 词条丢失一样 —— 测试覆盖了「能跑起来」，没覆盖「用户会看到的状态」。
3. **能静态抓的错不要留给运行时**：这次的重复键完全可以不渲染就查出来（见建议 3），却一路漏到用户面前。

### 还能怎么防这类问题（按性价比排序）

1. **面板级渲染必须带至少一篇打开的文档**（已落地为 `panel-render.test.mjs`）。底线，成本极低。
2. **把面板状态矩阵固化**：上述 21 个状态可直接表驱动成用例，至少覆盖空栏、1 栏 1 文档、2 栏各 1 文档、文档 loading、文档 error、对话框打开、三栏。渲染冒烟应把「有文档」列为必测而非可选。
3. **加一条静态重复键检查（建议优先）**：这次的残留正是同一对象字面量里 `autoSave`/`setAutoSave`/`indentOn`/`onIndentChange` 各出现两次。ESLint 的 `no-dupe-keys` 可直接抓；不想引依赖的话，`hygiene` 里加一条「传给组件的 props 对象字面量同名键出现两次即失败」也行。**这类检查不需要渲染，也不会因「状态没覆盖」而漏。**
4. **把每栏 props 接线抽成纯函数** `editorPaneProps(pane, tab, ctx)` 并单测：接线只存在一处、可直接断言键集合与来源，`PanelPage` 只写 `h(EditorPane, editorPaneProps(...))` —— 「多一套残留 props」在结构上就不可能出现。
5. **槽注册外层再包一层 `PanelBoundary`**：现在 `PanelPage` 自己是崩溃点，内部边界救不了它。改成注册一个包了边界的包装组件（`() => h(PanelBoundary, { label }, h(PanelPage, props))`），以后面板再抛错，用户看到的是可读错误文案而不是白屏 —— **故障可发现性**与修复本身同等重要。
6. **结构性改动不要用行号脚本**：至少做到改完立刻用「目标键恰好出现一次」自检（`grep -c`），再加一次带文档的面板渲染。

### 未验证

- `main` 槽现在的 `active` 状态（仅实现方报告，HTTP 侧不可见）。
- 真实浏览器里点开文档是否还有其它运行期问题（本节只在 Node 里用 stub React 渲染，没有真实 DOM/浏览器）。
- 「21 个状态」是动态覆盖，不等于静态作用域审计：理论上永不执行的死代码里若引用作用域外标识符，仍不会被发现。

### 后续补丁：静态重复键检查 + 面板入口错误边界（同轮 tail）

**版本**：`lib/client.js` `bd4f8488…`（3773 行）、`test/hygiene.test.mjs` `28ab2175…`（173 行，含扩展后的重复键扫描）、`test/panel-render.test.mjs` `e43b88c2…`（143 行 / **5 test**）、`test/render.test.mjs` `12d6b42f…`（支持类组件）。最终实测 `node --test` **76/76**、`render` **643**（+2：`PanelHost` 与 `PanelBoundary` 现在真的被执行）、`hygiene` **33/100/66**、硬编码颜色 **0**。

1. **静态重复键检查（我建议的第 3 条）已落地并确认有效**。`hygiene` 新增第 6 项检查：扫描 `h(Component, { … })` 的 props 字面量（括号配对、跳过字符串），顶层同名键出现两次即失败。我的三轮变异（最后一轮用的是扩展后的正则）：

   | 变异 | 结果 |
   |---|---|
   | 把事故形状（重复的 `onIndentChange`）塞进 `h(EditorPane, {…})` | **红**，报文 `… h(EditorPane, { -> onIndentChange` |
   | 在 `h(ToolButton, {…})` 里重复 `label` | **红** |
   | 在 `h("span", {…})` 里重复 `className` | **红**（扩展正则后；此前这一条是**存活**的，见下） |

   **范围限制曾在、现已闭合**：第一版扫描只匹配 `h(标识符, {`，我实测发现字符串标签元素（`h("span", {…})`）的重复键会静默通过；随后把正则改为 `h\(\s*(?:"[a-z][\w-]*"|[A-Za-z_$][\w$]*)\s*,\s*\{`，**我重跑同一个变异已变红**（报文 `h("span", { -> className`）。仍未覆盖的只是「文本扫描而非词法分析」这一点：模板字符串/注释里的括号理论上会干扰配对，当前代码未触发。
2. **面板入口已套上错误边界（我建议的第 5 条）**。新增 `PanelHost` = `h(PanelBoundary, { label: t("title"), hint: t("panelBrokenHint") }, h(PanelPage, props))`，`main` 槽注册从 `PanelPage` 换成 `PanelHost`，`__panes` 也导出了它。我实测：
   - 结构：`PanelHost` 返回元素 `type === PanelBoundary`，其唯一子元素是 `PanelPage` —— 所以 PanelPage 渲染期抛错会被父边界接住；
   - 文案来自词典而非硬编码：zh `思源笔记` / `可以刷新页面重试；如果反复出现，把这段错误信息发给我`，en `SiYuan Notes` / `Refresh to retry; …`；没有 locale 时回落到 `SiYuan Notes` / 空串且不崩；
   - **端到端**：在副本里给 PanelPage 函数体首行注入 `throw new ReferenceError("setView is not defined")`，按 React 的边界协议渲染 → 输出 **`div.sy-boundary`**，可见文字是 **「思源笔记 渲染失败 setView is not defined 可以刷新页面重试」**，**不是空白**。非 Error 抛出同样转成文本。
3. **`render.test.mjs` 的类组件支持没有吞异常**：只加了 `if (typeof type.prototype?.render === "function") { const instance = new type(props); … render(instance.render()) }`，**没有 try/catch**，真异常仍会让冒烟失败；顺带让冒烟第一次真正执行到 `PanelHost`/`PanelBoundary`（643 次）。
4. **未做的三条，我同意当前的取舍**：第 2 条（21 状态矩阵）——矩阵的价值在「找出有没有第二个悬挂标识符」，我已做过动态扫描（21/21），全量固化会与内部实现耦合过紧；实际落地的是我建议的折中：`panel-render.test.mjs` 从 3 个状态扩到 **5 个**（新增**三栏**、**删除对话框打开**），这两个都验证过是真断言（三栏断言 3 个编辑器各拿自己的 `doc.id` 且每栏 handler 都接通；对话框断言树里有 1 个 `sy-modal`）。仍可考虑再加「对话三形态」与一次带文档树的 `TreePane` 渲染。第 4 条（`editorPaneProps` 纯函数抽取）——刚修完接线就重构，风险大于收益，记为待办合理。第 6 条（别用行号脚本）——已写进上文「过程教训」，且第 1 条静态检查已经从机制上兜住了这类错误的物理形状。

**这条链是否足够防住同类事故复发？** 我的判断：**基本足够，但不是 100%**。三层是互补的 —— 静态重复键检查直接命中「同一 props 字面量重复键」这个物理形状（不依赖渲染，不怕状态没覆盖，且现在组件与字符串标签都覆盖）；面板级渲染（带文档，5 个状态）命中「作用域外标识符 / 接线漏传 / 跨栏串味」这类必须在真实状态才暴露的问题；变异验证证明前两层真的会红。**仍开着的敞口**：① **事件回调里的作用域外引用**——渲染不会触发，只有点击或真实浏览器才会暴露（本次事故是渲染期，所以被兜住了；回调期的同类错误仍只能靠真人点击或更细的交互测试）；② CI 里的面板状态已从 3 个增到 5 个，但 `TreePane`、对话三形态、连接卡片等分支的渲染覆盖仍薄。若要再加固，优先级：对话三形态 → 带文档的 `TreePane` 渲染 → 再谈交互测试。至于「字符串标签元素的重复键」这一条，已由扩展正则闭合，我重跑变异确认变红。

## 4.15 编辑布局持久化（第十三轮需求）的验证

**用户反馈**：「打开文档后退出去重进，就变回最初模样、文档也关了，能不能保留当前状态」。

**本轮是宿主侧第一次改动**（新增路由 + 新文件 + 新测试）。验证仍由独立验证员执行，探针在 `D:\tmp\dsh-verify\`，不改 `lib/`、不改 `test/`。

### 版本标识（本轮迭代过三次，以最终版为准）

| 文件 | 最终 sha256 | 规模 |
|---|---|---|
| `lib/client.js` | `6c1aa25582dc4038f70d1e81c781a64f2d07e072edb9bdd8393be3427e50cedb` | 3997 行 |
| `lib/host-utils.js` | `5e590d4d577ef23a33faac66e7c34299d0aeba26200899a72d0c6e00fe1080c8` | 738 行 |
| `lib/index.js` | `1fcf3e7df8a0c972e2321dfc4fa16bf310f7a7aebfaa938bbad3e32c92c93d3e` | 783 行 |
| `test/layout.test.mjs` | `82ada85c420cc76a3e2fa3152496b92e50304d43a9b28fe79c8e0cbef1a5f5e8` | 10 test |
| `test/layout-panel.test.mjs`（新） | `b6a90980503366b74d53115cfe54171d98b3ca9abd85f19f7d770d6f3fe37e37` | 3 test / 235 行 |
| `README.md` | `bc5d437d48346a56528f4a37c21d8634716209bcc77630c1ee281792c3b0204a` | 273 行 |

### 已执行的验证命令与实测数字

```bash
cd dsh-siyuan-notes
node --test                              # 89/89 pass, 0 fail
node test/render.test.mjs                # 643 components, depth 4, no exceptions
node test/hygiene.test.mjs               # 33 setters / 100 keys / 66 classes
grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(' lib/client.js   # 0
node scripts/e2e-save.mjs                # E2E: OK（保存路径未受影响）
node scripts/e2e-panes.mjs               # PANE E2E: OK
node ../tools/e2e-layout.mjs             # exit 0（只读探针）
```

### 三档结论

| 项 | 结论 | 证据 |
|---|---|---|
| 纯函数 `layoutSnapshot` / `layoutToPanes` / `mergeRestoredPanes` | ✅ 已实测 | 13 条测试（layout.test 10 + 我独立复算）；**snapshot 不含 `text`**、activePane 跟随、空 id 丢弃、key 续号 `["t41","t42"]`、脏标签跳过、active 越界夹取 |
| 宿主路由 `GET/POST /siyuan/layout` | ✅ 已实测 | 真实临时目录 + 真文件：GET 空→`null`、POST→`saved:true`、再 GET 读回、**布局文件不含 token**、非法 body→400、PUT→405 |
| `normalizeLayout` 全部上限夹取 | ✅ 已实测 | 我逐个打了 10 组边界：`active=-1`→0、`tabs` 非数组→0 标签、`panes` 是字符串/null→回退单空栏、`activePane` 负数/超大→夹取、`view` 非法→`split`、空 `docId`→丢弃、6 栏→3 栏、21 标签→20。**全部正确、无抛错** |
| 真实内核 round-trip（只读） | ✅ 已实测 | `tools/e2e-layout.mjs` exit 0：2 栏 snapshot→restore、`001 第一章` 重开 **82 块 / 4294 字符**、`第一章 红鞋的少女` 0 块、**missing 0**；含死文档的布局只掉那一个标签；**snapshot 无 token、无正文片段、有标题** |
| **竞态 1：恢复窗口内用户打开的文档** | ✅ 已实测（修了两版） | 见下方「两个竞态」 |
| **竞态 2：恢复未完成时写空布局** | ✅ 已实测（已修） | 见下方 |
| `restoringRef` 复位完整性 | ✅ 已实测 | 7 条路径全测，见下 |
| 恢复在真实浏览器里的观感 | ⚠️ **未验证** | 无浏览器；所有交互在 stub React 里驱动 |
| 「不恢复未保存文字」的取舍 | ✅ 判断：**应保持** | 见下方「设计判断」 |

### 两个竞态（本轮最重要的发现）

**竞态 1：恢复期间用户打开的文档会被吞掉。**

我写了一个带 hook 状态 + 重渲染的迷你 React，驱动**真实 PanelPage**，把 `/layout` 请求挂起以构造窗口：

- 控制组（无人干扰）：`/layout` 放行 → 恢复出 docA、`loading=false`、正文 9 字符 ✅（说明恢复链路本身正确）
- 竞态组：`/layout` 挂起 → 用户点开 docB（panes=`[["docB"]]`）→ 放行恢复 → 结果 `[["docA"]]`，**docB 消失**

根因：`restoreLayout` 用 `setPanes(restored.panes)` **整体替换**，而 `probe` 里是 `void restoreLayout()`（不 await），用户完全可能在这段窗口内点开文档。

**第一版修复只保住标签、没保住可见文档** —— 这是本轮最值得记的一件事：
- 实现方改成 `mergeRestoredPanes(restored, current)` 合并后，docB **作为标签保住了**；
- **但 `active` 仍沿用恢复的索引**，于是合并结果 `tabs:["docA","docB"], active:0` —— 用户刚点开的 docB 被切到后台，**屏幕上显示的还是 docA**；
- 我的探针当时只断言「docB 作为 tab 还存在」→ 报 PASS；**实现方新加的 `layout-panel.test.mjs` 用 `docIds()` 读当前可见的 active tab → 报 FAIL**，比我准。
- 最终修法：`active: extraTabs.length > 0 ? pane.tabs.length : pane.active`（第一个 extraTab 的下标），用户在恢复窗口里新开的文档成为可见标签。
- 我把探针同步加严到 active tab 后复现了同一个问题、修复后转 PASS —— **两侧结论现在一致**。

**竞态 2：恢复还没回来时，空栏被写盘覆盖记忆的布局。**

`restoredRef` 在 restore **开头**就置 true（「已发起」），而 `/layout` 还在 await；此时 `panes` 仍是初始空栏、无 loading、`connection.phase === "ready"` → 保存 effect 的守卫全部通过，600ms 后写盘。

实测（`/layout` 挂起超过 600ms）：**修复前写入 1 次 `[[]]`（空布局）**，恢复完成后再写第 2 次正确内容。窗口期若关页面/崩溃，记忆就被清空。
修复后（独立 `restoringRef`）：**保存次数 0**，恢复完成后写 1 次 `[["docA"]]` ✅。

### `restoringRef` 复位完整性（实现方最担心的点，我逐条测了）

静态看 5 处赋值，但真正的风险是「某条路径没复位 → 保存被永久阻塞、布局再也不被记住」。我驱动真实 PanelPage，构造 7 条路径并在事后等过防抖窗口观察是否恢复保存：

| 路径 | `restoringRef` 终值 | 之后能否正常保存 |
|---|---|---|
| `/layout` 正常返回 | false | ✅ 2 次 |
| `/layout` 返回 `null`（无记忆） | false | ✅ 2 次 |
| `/layout` 返回空骨架 | false | ✅ 2 次 |
| `/layout` 请求抛错 | false | ✅ 2 次 |
| `/layout` 返回非 JSON | false | ✅ 2 次 |
| 某篇文档 404（走 catch 掉标签） | false | ✅ 2 次 |
| 所有文档请求都抛错 | false | ✅ 2 次 |

**7/7 全部复位，保存均能恢复。** 补充一点代码复核：`await Promise.all(...)` 外层没有 `try/finally`，若 `setPanes`/`patchTab` 自身抛异常，理论上会跳过最后的复位；但两者都是纯 setState 包装、不会抛，所以当前无实际敞口 —— 若以后在循环体里加可能抛的逻辑，建议改成 `try { ... } finally { restoringRef.current = false }`。

### 设计判断（按你要求直说）

1. **「不恢复未保存文字」应保持**。把未保存草稿当已保存内容恢复，会让用户误以为已落库、下次 Ctrl+S 反而把旧草稿覆盖成新内容；且已有测试用 `"text" in tab === false` 钉死。可选增强（我不建议做）：恢复后给「离开时是脏的标签」加提示条 —— 但那需要额外持久化「脏标记」，又回到记录内容状态的老问题。
2. **`extraTabs` 全堆第一栏**：实测两栏都在恢复窗口内点开文档时，两篇都落在**第一栏**（`tabs:["docA","docC","docD"]`），且只有第一栏的 `active` 指向新文档。**我认为可接受**：这个窗口只有几百毫秒、需要用户恰好连点两栏才触发；按原栏位放置需要额外记录「哪个 pane key 对应哪个恢复栏」的映射，复杂度与收益不成比例。但**建议在 README 或代码注释里写一句这个行为**，避免以后被当成 bug 排查。
3. **`normalizeLayout` 对 `panes` 非数组回退成单空栏**（而不是报 400）——我认同：布局是显示记忆，损坏时「干净开局」比拒绝服务更好；`activePane` 同理夹取而非报错。真正的非法输入（非对象）仍返回 400。

### 与 README 的一致性（逐句核对）

- 「恢复什么」：每栏打开的文档、当前栏、每栏 view/autoSave/indentOn、当前看的文档、**标签顺序保留** → 与 `layoutSnapshot`/`layoutToPanes` 一致 ✅
- 「不恢复什么」：**未保存文字** → 与 `"text" in tab === false` 一致 ✅
- 「文档被删了怎么办」：只掉那个标签 → 与 `withTabClosed` 单标签移除一致，且 e2e-layout 实测 ✅
- 「存到哪 / 不含正文不含 token」：`~/.dsh/siyuan-notes-layout.json`，与含 token 的 `siyuan-notes.json` 分开 → 路由测试断言 `layoutText.includes("token") === false` ✅
- 「什么时候写」：约 0.6s 防抖 → 代码 `setTimeout(..., 600)` ✅

### 未验证（明确不当作已验证）

1. **真实浏览器里的恢复观感**：恢复时是否闪一下、多栏是否同时出现、600ms 防抖在真机上是否可感知 —— 全部在 stub React 里驱动，没有真实 DOM/浏览器。
2. **真实宿主进程的路由**：`/siyuan/layout` 的端到端是**在测试里**用 `createSiYuanRoutes` + 真文件跑通的，没有对运行中的 DSH 发真实 HTTP 请求（那需要重启宿主，本回合做不到）。
3. **`~/.dsh/siyuan-notes-layout.json` 在真实 profile 里的落盘**：测试用 `DSH_SIYUAN_NOTES_HOME` 指向临时目录，没有验证真实用户目录下的写入与权限。
4. **长时间使用后的文件增长/损坏恢复**：只验证了「首次无文件」「正常往返」，没有构造磁盘满、文件被外部改坏等场景（代码有 corrupt→当作无记忆的处理，但未实测）。

### 本轮过程中值得记的两点

1. **我的探针不够严**：竞态 1 只查「标签存在」，实现方的面板测试查「可见的 active tab」。这是本轮唯一一次**实现方测试比验证方探针更严**，并且它抓到了半修。教训：验证「用户点开的东西还在」必须查**可见性**，不能只查数据结构里有没有。
2. **`e2e-layout.mjs` 有一次瞬时失败**：第一次跑抛 `block not found or its encrypted notebook is locked`（内核读模型瞬时状态），重跑即 exit 0。脚本本身只读、无副作用；这类抖动不应算代码回归，但复跑确认过两次。

## 4.16 目录树展开状态持久化 + 自动展开到当前文档（第十四轮需求）

**用户反馈**：「侧边目录栏还是会自动折叠，而不是打开到我当时打开的那个文档的状态」。

**最终版**：`lib/client.js` `3c0a8050…`（4221 行，仅注释）、`lib/host-utils.js` `aea81255…`（752 行，`LAYOUT_LIMITS` 加 `maxExpanded:200` / `maxExpansionKeyLength:700`，`expanded` 去重）、`lib/index.js` 未动（`1fcf3e7d`）、`test/layout.test.mjs` `6e731748…`（**16 test**）、`test/panel-render.test.mjs` `61bd87cc…`（改为按名字 seed）、`test/layout-panel.test.mjs` 未动（`b6a90980`）、`README.md` `3ec2b668…`。

⚠️ 本节结论跨了三版：初版（93 test）→ 把「超长 key 截断」改成「**丢弃**」（94 test）→ 收尾去重（**95 test**）。每一版我都重跑过全部探针，**结论一致**；表中数字为最终版。

### 已执行的验证命令与实测数字

```bash
cd dsh-siyuan-notes
node --test                              # 95/95 pass, 0 fail
node test/render.test.mjs                # 643 components, depth 4, no exceptions
node test/hygiene.test.mjs               # 34 setters / 100 keys / 66 classes
grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(' lib/client.js   # 0
node scripts/e2e-save.mjs                # E2E: OK
node scripts/e2e-panes.mjs               # PANE E2E: OK
node ../tools/e2e-layout.mjs             # exit 0
node ../tools/e2e-tree-reveal.mjs        # 全部 OK（详见下）
```

### 三档结论

| 项 | 结论 | 证据 |
|---|---|---|
| `expansionSnapshot`（只存 `=== true`、排序、上限 200） | ✅ 已实测 | 14 条测试 + 我独立复算 |
| host 侧 `normalizeLayout` 的 `expanded` 归一化 | ✅ 已实测 | 9 组边界（见下），原「重复 key 未去重」的观察项**已在收尾时修复并复核生效** |
| `revealKeys`（祖先目录 key 推导） | ✅ 已实测 | 8 组边界：根文档 1 个、1 层 2 个、深 7 层 7 个、空 box/空 path/null 全返 `[]`、尾斜杠/双斜杠均正确去重 |
| `documentLocation` 失败兜底 | ✅ 已实测 + 代码复核 | 空/非字符串→null；SQL 抛错→catch 返 null；`revealInTree` 里 `if (!where) return`，**不会产生未捕获 rejection**（调用点是 `void revealInTree(...)`，内部全兜底） |
| 真实内核 tree-reveal（只读） | ✅ 已实测 | 用户最深文档**深度 8**，8 个祖先目录逐个 `listDocsByPath` **8/8 OK**（4/9/7/5/2/1/1/2 条）；3 篇同时打开合并出 **13 个目录**；**删除的文档 reveal 出 0 个目录且不抛错** |
| 恢复时同时展开多层（顺序/依赖） | ✅ 已实测 | 见下方「加载顺序」 |
| `expandedReady` 全部置 true 点 | ✅ 已实测 | 6 条路径全测，见下 |
| 保存防抖是否合并 8 次变更 | ✅ 已实测 | **8 次 → 1 次**保存（见下） |
| 状态槽位契约 `__stateSlots` | ✅ 已实测（行为验证） | 15 个槽位按名字 seed 逐一验证命中正确的状态，见下 |
| 真实浏览器里目录树的展开观感 | ⚠️ **未验证** | 无浏览器 |

### 1. 恢复时的加载顺序（实现方最担心的竞态）

TreePane 的恢复 effect 是**一次性发起所有**记住的目录请求（初版注释写的是「父层到达后再发子层」，与代码不符；**收尾时注释已改为准确描述**，见下文「验证后加固」）。实测：

| 场景 | 结果 |
|---|---|
| 同时展开 3 层（root / a.sy / a.sy/b.sy） | 三个请求全部发出，顺序 `["/", "/a.sy", "/a.sy/b.sy"]` ✅ |
| 同上但内核应答慢 30ms | 三个仍全部落地，无失败 ✅ |
| `expandedReady=false` | **不发任何请求**，等待就绪 ✅ |
| 只记住深层 key（父层未记住） | 仍会请求该深层路径 ✅ |

**为什么「父层未先列出」不会失败**：`listDocsByPath` 接收的是**完整路径**，由内核直接解析，不依赖客户端是否已展开父层。所以一次性并发发起是安全的 —— 这也是 e2e-tree-reveal 里 8/8 全 OK 的原因。

### 2. `expandedReady` 的置 true 完整性

静态看有 4 处 `setExpandedReady(true)`：`layout === null` / `layoutToPanes === null` / 空骨架 / 正常完成。我驱动真实 PanelPage 构造 6 条路径实测（含恢复中途抛异常）：

| 路径 | `expandedReady` | 之后能否正常保存 |
|---|---|---|
| `/layout` 正常返回（带 expanded） | true | ✅ 2 次 |
| `/layout` 返回 null | true | ✅ 2 次 |
| `/layout` 返回空骨架 | true | ✅ 2 次 |
| `/layout` 请求抛错 | true | ✅ 2 次 |
| 文档 kramdown 请求全抛错 | true | ✅ 2 次 |
| `documentLocation`（sql）抛错 | true | ✅ 2 次 |

**6/6 全部就绪，树不会永久不加载、保存也不会被永久阻塞。** 另外确认保存的 layout 里确实带 `expanded` 数组（实测 `saved keys: ["version","panes","activePane","expanded"]`）。

### 3. 保存频率：8 次变更 → 1 次写盘

模拟用户展开 7 层目录（8 个 key 依次置 true，每次间隔 25ms，均快于 600ms 防抖）：**基线 1 次、突发期间 1 次、防抖后共 2 次 → 净增 1 次**。防抖确实合并，不会写 8 次。
（注：这条我第一版探针报「8 次」，是因为我的 harness 没执行 effect cleanup；补上 React 的 cleanup 语义后为 1 次。**是我的 harness 错，不是实现问题**。）

### 4. 状态槽位契约 `__stateSlots`（实现方要求重点复核）

声明 15 个槽位（connection:0 … dialog:14）。我做了**行为验证**而不只是核对数字：逐一按名字 seed，然后断言**对应的状态真的变了**：

| 断言 | 结果 |
|---|---|
| 名字集合与索引恰好 0..14、无重复无空洞 | ✅ |
| seed `connection=ready` → 渲染出 ready 主体（不再是 connecting 占位） | ✅ |
| seed `panes` → 渲染出对应数量/文档的编辑器 | ✅ |
| seed `dialog` → 出现 `sy-modal` | ✅ |
| seed `notice` → 出现 `sy-notice` | ✅ |
| seed `chatSurface=off` → 侧边对话不渲染 | ✅ |
| seed `expanded` → **TreePane 真的收到那个 map** | ✅ |
| seed `expandedReady=false` → TreePane 收到 false | ✅ |

**11/11 通过**。关键点：`__stateSlots` 只数 `useState`，而测试 harness 的 `useRef` 不占槽位 —— 两者自洽（真实 React 里 ref 也占槽位，但 harness 不模拟这一点，所以契约只在 harness 内有效）。**未知名字会抛错**，但「顺序错、名字还在」不会抛 —— 所以我用行为验证而非仅核对索引来兜这个风险。

### 5. `expanded` 归一化的边界

| 输入 | 结果 |
|---|---|
| **超长 key（800 字符）** | **整条丢弃**（不是截断）✅ —— 修法正确：被截断的路径不是用户打开的那个目录，拿去请求会失败或开错目录 |
| 恰好 700 字符的 key | 保留 ✅ |
| 701 字符的 key | 丢弃 ✅ |
| 无 `::` 分隔符 | 被丢弃 ✅ |
| 非字符串项（1/null/{}） | 被丢弃 ✅ |
| `expanded` 非数组 | 归 `[]` ✅ |
| 201 个 key | 截到 200 ✅ |
| 带首尾空白 | trim ✅ |
| 重复 key（3 个相同） | **去重为 1 个** ✅（收尾时已修，见下文「验证后加固」） |

9 组边界全部实测通过。**其中「重复 key」原是我的观察项（当时未去重），实现方收尾时已加 `.filter((key, index, list) => list.indexOf(key) === index)` 保序去重并补 1 条测试；我复跑该探针，重复输入现在输出 `["box::/a"]`，原先那条「未去重」断言如预期翻转，证明修复生效。**

### 6. README 一致性

「左侧目录树的**展开状态**也会恢复，并且会自动展开到当前打开的文档所在的层级」——
- 「展开状态会恢复」= `layoutSnapshot` 写入 `expanded` + `layoutToPanes` 还原 ✅
- 「自动展开到当前文档所在层级」= `openDoc` 里 `void revealInTree(target.id)` + `revealKeys` 祖先全置 true ✅（e2e 实测深度 8 的文档 8/8 目录可列）
- 与 §4.15 记的「不含正文、不含 token」一致：`expanded` 只是路径字符串，不含内容 ✅

### 7. 设计判断：折叠记忆 vs 自动展开，谁优先

实现是**合并、revealed 优先**（`{...remembered, ...revealed.expanded}`）。我实测确认：用户上次**折叠**过 `box::/a.sy`（记住的是 `false` 或不在集合里），但只要里面打开了文档，恢复后它**一定是展开的**。

**我的结论：这个取舍正确，不建议改。** 理由：
1. 用户抱怨的原话就是「没有打开到我当时打开的那个文档的状态」——**文档可见性是用户的第一诉求**，比「我记得这个目录是折叠的」更强；
2. 反过来做（折叠记忆优先）会让用户点开文档后侧栏里**看不到它**，这正是当前被投诉的现象；
3. 要正确实现「显式折叠优先」必须额外记录「用户主动折叠过」这一状态（区别于「从未展开」），复杂度显著上升，而收益只是极少数「我折叠了但里面还有打开的文档」的场景。
4. 若确实想兼顾，最小改法是：只在**用户手动折叠该目录**时写一条 `expanded[key] = false` 的显式记录，并在合并时让 `false` 覆盖 revealed 的 `true` —— 但这会引出「打开文档看不见」的新投诉，我不建议。

### 8. 本轮重复发生的事故（必须如实记录）

实现方用**行锚点脚本**做结构编辑时，`drop-duplicate-reveal.mjs` 的「向上找注释」循环**多吃了 170 行**（`onSaved` / `splitPane` / `closePane` / `reloadTab` / `openNotebook` / `confirmRename` / `confirmRemove` 全丢），`node --test` 从 89 掉到 81；后用服务端下发的完整副本做差异定位、按精确行区间原样回插修复。

**这是 §4.14「不要用行号脚本做结构编辑」教训的第二次应验。** 两次事故的形态完全一致（行号/锚点脚本 + 多行结构 + 无 git 无法 diff）。我的建议升级为**硬纪律**：结构性编辑（增删函数、移动代码块）**禁止**用行锚点脚本，改用：① 逐函数替换并立即 `node --test`；② 或先把目标区域导出成独立文件、用编辑器改、再拼回；③ 至少做到改完立刻用「目标符号出现次数」自检。

顺带暴露的**测试脆弱点已修复**：`panel-render.test.mjs` 原来用硬编码槽位索引 seed（`12: dialog`），加 2 个 `useState` 后 dialog 位移到 14 导致红。现在改为**按名字 seed**（`__stateSlots` 翻译 + 未知名字抛错）。我复核了这份契约（见第 4 点），**当前实现与测试一致**。

### 验证后加固（收尾两处，均已被我复核）

验证完成后实现方又落了两处小改动，我全部复核过：

**版本**：`lib/client.js` `3c0a8050…`（4221 行，**仅注释**）、`lib/host-utils.js` `aea81255…`、`test/layout.test.mjs` `6e731748…`（+1 去重测试）。最终实测 `node --test` **95/95**、render **643**、hygiene **34/100/66**、硬编码颜色 **0**；`e2e-save` / `e2e-panes` / `e2e-layout` / `e2e-tree-reveal` 全部通过。

1. **注释与实现不符已修正**：原注释写「深层请求由父层列表到达时再发」，但代码实际是**一次性全部发起**。新注释准确描述了这一点，并说明为什么安全（`listDocsByPath` 收完整路径、内核直接解析、无需父层先列出），同时保留「仍按最外层优先排序以获得更友好的失败模式」。**纯注释，无行为变化** —— 我重跑 `probe-tree-order` 5/5 全过。
2. **`expanded` 重复 key 已去重**：host 侧加了 `.filter((key, index, list) => list.indexOf(key) === index)`（保序去重）。**我原先记为「观察项（未去重）」的条目现在应更新为「已修」**：重跑我的归一化探针，重复输入 `["box::/a","box::/a","box::/a"]` 现在输出 **`["box::/a"]`**（len 1）—— 那条「未去重」断言如预期**翻转失败**，证明修复真的生效。其余 8 组边界（超长丢弃、恰好 700 保留、701 丢弃、无 `::` 丢弃、非字符串丢弃、非数组归零、201 截到 200、trim）仍全部通过。

### 实现方补做的三项验证（我已独立复跑确认）

实现方在收尾时补了三条我没有覆盖的验证：

1. **`tools/verify-state-slots.mjs`**：从源码提取 PanelPage 内全部 `useState` 并与 `__stateSlots` 按顺序比对 → 我复跑得到 **`STATE SLOT CONTRACT OK`**（15/15，`connection:0 … dialog:14`）。这补上了我此前指出的静态盲区 —— 我用的是**行为验证**（seed 后断言状态真的变了），他用的是**源码顺序核对**，两者互补：合起来既保证「顺序对」又保证「名字指向对」。
2. **`tools/e2e-tree-restore-order.mjs`**（只读）：对最深文档的 8 个祖先目录**同时发起**请求 → 8/8 OK；并额外验证**父子可达性**（每个子路径都真的出现在父层 `files` 里）→ 我复跑得到 **`ALL ANCESTORS REACHABLE`**。这比我的探针更进一层：我只验证了「请求成功」，他验证了「树递归真能走到目标节点」。
3. **`tools/probe-expansion-cost.mjs`**：8 次变更快照尺寸单调 1..8、最终 **1 次写盘**；150 层展开 → 150 keys（cap 200 未超）；最长 key **645 字符**（cap 700 未超）。这独立印证了我的「8 次变更 → 1 次写盘」，并补上了我未测的**上限余量**。

**一处实现方自纠（我已复核）**：`tools/e2e-layout.mjs` 的正文泄漏检查原先拿 `rows[0].content`（那是**标题**、本来就该存）比对，误报 `YES — leak`；已改为从真实 kramdown 取最长正文行比对 → `false (expected false)`。这与我的只读复核一致（无正文泄漏）。

### 未验证

1. **真实浏览器里的展开观感**：恢复时目录树是否会闪、逐层展开的视觉节奏、自动展开到深度 8 时是否需要滚动 —— 全部在 stub React 里驱动。
2. **真实宿主进程的 `/siyuan/layout`**（含 `expanded`）落盘：测试用临时目录 + `createSiYuanRoutes`，未对运行中的 DSH 发真实请求。
3. **`expanded` 在超长路径下的键长上限（700）是否够用**：实测最深路径 key 约 200 字符，余量充足，但未构造极端命名。

## 4.17 第一段首行缩进读不回来（第十五轮需求）

**用户反馈**：「为什么第一段的首行缩进就失效呢？」

**版本**：`lib/client.js` `03adf068…`（4297 行）、`test/first-indent.test.mjs`（新）`930f9d17…`（166 行 / 8 test）；`lib/index.js`、`lib/host-utils.js`、`README.md`、其余 test 全部未动。

### 已执行的验证命令与实测数字

```bash
cd dsh-siyuan-notes
node --test                              # 103/103 pass, 0 fail
node test/render.test.mjs                # 643 components, depth 4, no exceptions
node test/hygiene.test.mjs               # 34 setters / 100 keys / 66 classes
grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(' lib/client.js   # 0
node scripts/e2e-save.mjs                # E2E: OK
node scripts/e2e-panes.mjs               # PANE E2E: OK
node ../tools/e2e-layout.mjs             # exit 0
node ../tools/e2e-tree-reveal.mjs        # 全 OK
node ../tools/e2e-first-indent.mjs       # 第一段有缩进、bare=0、两次读一致
node ../tools/e2e-no-phantom-write.mjs   # keep=82 write=0
node ../tools/e2e-first-indent-crosscheck.mjs  # 0 mismatches
```

### 三档结论

| 项 | 结论 | 证据 |
|---|---|---|
| **用户文档现在能正确显示第一段缩进** | ✅ **已实测** | 真实内核：`readDocumentText` → `lead="　　"`，第一段以 `　　` 开头，**82/82 段全部有缩进** |
| **不再产生幽灵写入** | ✅ **已实测** | 同文档 `planSync(original, splitMarkdown(文本))` → **keep=82 write=0**；另 3 篇（空文档 / 标题开头 / 代码块开头）同样 write=0 |
| 「补齐全篇」计数正确 | ✅ 已实测 | `bareParagraphLines` → **0**（修复前为 1） |
| 早退与失败路径 | ✅ 已实测 | 11 项，见「2. 早退路径」 |
| 读取点统一（无第四处旧解析） | ✅ 已实测 | 全文件 `getBlockKramdown` 只剩 **1 处**（在 `readDocumentText` 内）；`splitKramdown` 也只剩 **1 个调用点** |
| 首块是结构型（列表/标题/引用/代码块）时不会被误加缩进 | ✅ 已实测 | 抽样 **61 篇**：57 篇首块是结构型，其中**索引报告缩进的 0 篇**；唯一「段落+真实缩进」正是用户文档 |
| `hasLeadingSpace` 字符集 | ✅ 已实测 | 与 `trimEdges` 实际生效的字符集一致，见「5. 字符集」 |
| 临时测试文档清理 | ✅ 已实测 | 我独立查 `blocks.content LIKE` 五种模式 → **0 篇残留**；最近创建文档仍是 2026-11-03 的旧文档，今天无新建 |
| **写入闭环（点缩进→写→读回→二次保存零写入）** | ⚠️ **实现方闭环，我仅复核逻辑** | 见「6. 未独立复做的部分」 |

### 1. 根因描述的更正（本轮最重要的发现）

实现方记录的机制是：「第一段**原始就是 2 个**全角空格，于是 `cleanBlockText` 那一剥把用户真正的缩进吃掉了」。**实测与这个描述不符。**

我逐字节核对了真实内核的原始响应（用户文档 `20261028200018-0yxlhji`）：

| 通道 | 第一段 | 第二段 |
|---|---|---|
| `getBlockKramdown` **原始行首空格数** | **0 个 U+3000**（首字符直接是 `走` U+8D70） | **4 个 U+3000** |
| `blocks.content` 索引 | lead = `"　　"`（2 个） | lead = `"　　"`（2 个） |
| 插件 `splitKramdown` 产出 | `"走在下班…"`（无缩进） | `"　　“晚上到底…"`（有缩进） |

**真实机制**：思源给**非首段**加一个 INDENT 前缀（4 = 前缀 2 + 真实 2，剥 1 个后正确）；而**首段的缩进在 kramdown 响应里根本不存在**（0 个），既没有前缀、也没有真实缩进。

因此：
- `cleanBlockText` 里 `if (text.startsWith(INDENT))` 对首段**永远不成立**（原文是 0 个），那一行**从未**吃掉首段的缩进 —— 数据是在内核序列化时就丢的；
- 数据丢失发生在**内核的 kramdown 序列化**，不在我们的解析器。

**这不影响修复的正确性**（从索引补回是唯一可行的办法），但有两处需要更正：

1. **`cleanBlockText` 上方的注释不准确**：现在写「SiYuan's document serializer prefixes **every** paragraph with one indent」，实际是「**除首段外**每段」。这条注释是误导性的 —— 后人若照它去「修」 `splitKramdown`（改成「对首段不剥」），结果会是：首段依然没有缩进（本来就没有前缀可剥），**同时把非首段的正确处理弄坏**。建议改成 "every paragraph except the first"。
2. `hasLeadingSpace` 上方的注释（「`getBlockKramdown` trims the start of its whole response」）**是准确的**，与实测一致。

我顺带在 6 篇不同文档上确认：**首行从未出现前缀缩进**（`---` / `## 任务助手示例` / IAL 行 / `==⚠` 全部 0 个），所以「首段不加前缀」是稳定行为，不是这一篇的特例。

### 2. 早退路径（实现方点名要独立构造）

| 情况 | 结果 |
|---|---|
| 首块**已有** lead → 短路 | 记 1 次 `query/sql`；查询确实用首块 id 定位 ✅ |
| 首块**没有** lead（绝大多数文档） | 仍 1 次 `query/sql`（无法避免，见第 4 点）✅ |
| SQL 抛错 | 返回 `lead=""`，82 块照常解析，**不编造缩进、不抛** ✅ |
| 空文档 | 0 块、text 为空、**不发 lead 查询** ✅（本地无空文档，由单测覆盖；我另用「块数 0」的文档验证过不崩） |
| 首块无 id | `firstBlockLead` 直接返回 `""`，不发请求 ✅ |
| `restoreFirstLead` 非数组 / 空数组 | 返回 `[]`，不抛 ✅ |
| `restoreFirstLead` 不改入参 | 已验证（纯函数）✅ |
| `restoreFirstLead` 不重复叠加 | 首块已有 lead 时原样返回 ✅ |
| `lead=""` | 无操作 ✅ |

合计 **11 项全部通过**。

### 3. 读取点是否替换彻底

全文件统计（不是抽样）：

| 项 | 数量 |
|---|---|
| `getBlockKramdown` 调用点 | **1**（`readDocumentText` 内部，第 1189 行） |
| `splitKramdown` 调用点 | **1**（同上，第 1191 行） |
| `readDocumentText` 调用点 | **5**：`save` 的**保存前读**（1991）、`save` 的**校验读**（2041）、`restoreLayout`（3322）、`openDoc`（3633）、`reloadTab`（3735） |

`verified` 在 `save` 里同时用于 ①`sameTexts` 校验、②`notice` 判断（`verifyFailed`）、③写回 `tab.blocks` 与 `savedText` —— 我逐行确认过，**没有第四处仍走旧解析**。这是本轮做得最干净的一点：把所有读通道收敛成一个入口，而不是就地打补丁。

### 4. 额外请求成本

实测三种文档，**每次打开都是 2 个请求**（`block/getBlockKramdown` + `query/sql`）：

| 文档形态 | 请求数 | 恢复的 lead |
|---|---|---|
| 第一段有缩进（用户文档） | 2 | `"　　"` |
| 标题开头 | 2 | `""` |
| 代码块开头 | 2 | `""` |

**结论：可接受，但「短路」在实践中几乎不触发。** 因为首段缩进在 kramdown 里永远是 0（第 1 点），所以 `hasLeadingSpace(raw[0].text)` 对几乎所有文档都是 false → 几乎每次打开都会多一次 `query/sql`。按主键查的本地 SQL，成本很低（毫秒级），我不认为需要优化。

若将来想省：一次 `WHERE id IN (…)` 可以批量补多篇（布局恢复 3 栏 = 省 2 次），或把 lead 缓存进 tab 状态避免重复打开重复查。**都不必现在做**，记为可选优化。

### 5. `hasLeadingSpace` 的字符集

对照 `trimEdges` / `normalizeText` 的实际行为实测：

| 字符 | `hasLeadingSpace` | `trimEdges` 会剥掉 | 能否成为残留 lead |
|---|---|---|---|
| U+3000 全角 | ✅ 认 | ❌ 不剥 | **能** → 必须认 ✅ |
| U+00A0 NBSP | ✅ 认 | ✅ 剥 | 否（已被剥，无害） |
| 半角空格 | ✅ 认 | ✅ 剥 | 否 |
| tab | ✅ 认 | ✅ 剥 | 否 |
| U+FEFF BOM | ❌ 不认 | ✅ 剥 | 否（先被剥掉，不会造成分叉） |
| `\f` / `\v` / `\r` | ❌ 不认 | ✅ 剥 | 否 |
| U+200B 零宽 | ❌ 不认 | ❌ 不剥（但 `normalizeText` 会删） | 否（删掉后两边一致） |

**没有遗漏的危险字符**：能真正留在块文本开头、且不会被 `trimEdges` 剥掉的只有 U+3000，而它被认了。其余字符要么先被剥掉、要么被 `normalizeText` 删掉，都不会造成「kramdown 有、索引没有」的分叉。`firstBlockLead` 用的是同一个字符集，两侧一致。

一处**残余假设**（不影响当前内核）：若某天内核开始在首段也输出缩进，且真实缩进是 4 个全角（>2），则 `cleanBlockText` 剥 2 后剩 2 → `hasLeadingSpace` 为 true → **不再查索引** → 只显示 2 个。即该修复对「首段缩进 >2 且内核开始输出缩进」这一组合会少补。当前内核首段恒为 0，不触发。

### 6. 未独立复做的部分（如实说明）

**写入闭环**（点「补齐全篇」→ 真实写 3 个块 → 重新读取 → 三段 lead 正确 → 二次 `planSync` 零写入）我只**复核了读回与二次比对的逻辑**，没有自己造文档重跑一次。原因：验证员不应写用户数据，而临时代码需要真实写权限、且上一位实现方的清理脚本还出过 `removeDoc` 不生效的问题。**已用两个替代证据补强**：
- 只读侧：未改动文档 `planSync` → `keep=82 write=0`（幽灵写入已消失）；
- 环境侧：我独立确认**临时文档 0 残留**（五种模式查询 + 最近创建文档全部是今天之前）。

### 7. 给用户的行为结论（独立确认）

**用户重新打开那篇文档就应该看到第一段缩进，不需要再点任何按钮。** 依据：索引里第一段本来就有 `lead="　　"`（说明之前点缩进**确实写进去了**，只是读不回来），修复后读路径把它补了回来 —— 我实测该文档 82/82 段全部带缩进，「补齐全篇」计数为 0。

这个判断与 `e2e-first-indent.mjs` 的输出一致（`first paragraph starts with an indent? true`、`bare paragraph lines: 0`）。

### 8. 实现方这轮的两次探针误判（合并成一条教训）

1. `e2e-first-indent.mjs` 第一版把**文档标题（`type='d'`）当成第一段**比对 → 4 处假 MISMATCH；
2. `e2e-first-indent-crosscheck.mjs` 第一版用 `sort = min(sort)` 找首块 → 思源大量块 `sort` 值相同（该文档全是 `sort=10`）→ 拿任意段跟首段比 → 16 个假 MISMATCH。

两次都是「**探针错、实现对**」，与 §4.16 我自纠 `e2e-layout.mjs`、§4.15 实现方自纠正文泄漏检查**属于同一类**。合并教训一条：

> **用真实内核做探针时，先验证「你取的到底是不是你以为的那个对象」** —— 取「第一段」要先排除文档自身（`type='d'`），取「首块」不能依赖 `sort`（会撞值），要比对身份就用 id。凡是出现成批的 MISMATCH（4 个、16 个），先怀疑取数口径，再怀疑被测代码。

### 9. 一处证据强度提示（不阻塞）

实现方的 `e2e-first-indent-crosscheck.mjs` 报「checked 104 documents, **0 with an indented opening paragraph**, mismatches: 0」。问题在于：**这 104 篇里没有一篇的首段带缩进**，所以它实际上没有检验到修复的核心场景 —— 真正的复现样本（用户文档，首段 lead=2）不在这 104 篇里（该笔记本共 64 篇文档，我显式把用户文档加进抽样才命中 1 例）。

「0 不匹配」在一个「全是空样本」的集合上是弱证据。**修复本身我已用用户文档独立验证过**（第 7 点），所以结论不受影响；但建议把该交叉检查改成**显式包含用户文档**，否则它下次也不会发现回归。

### 10. 收尾复核（实现方按第 1、9 点改完后的确认）

**最终版**：`lib/client.js` `7b8f4fff…`，**4305 行**（相对上一版 +8 行，**纯注释**）；`test/first-indent.test.mjs` `930f9d17…` 未动；`lib/index.js` `1fcf3e7d…`、`lib/host-utils.js` `aea81255…`、`README.md` `3ec2b668…` 全部未动。
复跑：`node --test` **103/103**、render **643**、hygiene **34/100/66**、硬编码颜色 **0**；`e2e-save` OK、`e2e-panes` OK、`e2e-tree-reveal` OK、`e2e-first-indent` 与 `e2e-no-phantom-write` 结论不变。

**「纯注释」我核过**：`cleanBlockText` 的注释从 2 行变成 10 行（+8），函数体 `if (text.startsWith(INDENT)) … return normalizeText(…)` 与上一版**逐字一致**；`hasLeadingSpace` / `restoreFirstLead` / `readDocumentText` / `firstBlockLead` 均未改。

**1. 新注释表述准确 ✅**（实现方要求确认的第 1 点）
- 关键句 "prefixes every paragraph **EXCEPT the first**" 与我的字节级实测一致；
- 引用证据 "the second paragraph arrives as four ideographic spaces (prefix + real indent) while the first arrives with none at all" —— 正是我实测的第二段 4 个 / 第一段 0 个，**准确**；
- 「Do not "fix" the first paragraph here … skipping the strip would leave the first paragraph unchanged and corrupt every later one」—— 这句警告写在**最容易被误改的位置**，正好挡住我在第 1 点担心的那种「后人照旧注释去改 `splitKramdown`」的做法。这是本轮最值得保留的一处注释。
- 一处可选微调（不阻塞）：`cleanBlockText` 上方的单行摘要仍写「Strip … and **paragraph indentation**」，字面上可被读成「剥真实段落缩进」。建议改成「…and the serializer's one-indent prefix」。

**2. 加强后的 crosscheck 已够用 ✅**（要求确认的第 2 点）
我此前的批评是「104 篇里 0 篇首段带缩进 = 空跑」。重写后实测：
- `where b.type='d' and substr(c.content,1,1)=char(12288)` 主动找出**首段带缩进**的文档 → **64 篇**；
- 全部强制纳入，再补普通文档 → `documents to check: 144`，`checked 140; **64 had an indented opening paragraph**`，`mismatches: 0`；
- 并且加了**自证断言**：样本里若没有一篇首段带缩进，脚本打印 `FAIL: the sample contained no document with an indented opener — this check proved nothing`。
→ **核心场景覆盖问题已解决**，且加了防退化护栏。

**3. 抖动兜底：可接受，且 save 侧不需要再加重试 ✅**（要求确认的第 3 点）
- **显示侧**：`firstBlockLead` 取空/失败时返回 `""`，退化为「照内核原样显示」，**不会编造缩进** —— 这个兜底是安全的，最坏后果只是某次打开第一段暂时看不到缩进，刷新即恢复。
- **保存校验侧**：`save()` 的校验循环本来就是**整体重读**（`readDocumentText`），因此**已经隐含重试了 lead 查询**（6 次 × 250ms）。索引滞后于写入时，第 N 次重读会拿到新 lead → `sameTexts` 通过。**不需要再单独给 lead 加重试**；只有当索引滞后超过约 1.5 秒才会误报 `verifyFailed`（是提示，不是数据损坏）。
- **一处残余（低危，已实测确认，不建议现在修）**：如果缓冲区是**在索引滞后期间读到旧 lead** 建起来的（例如刚删掉首段缩进就立刻重开），随后用户**改了别的段落**再保存，`planSync` 会把首段的旧缩进当成一次真实改动写回去。我用纯函数复现了：`original=["第一段","第二段"]` + `next=["　　第一段","第二段改过了"]` → `planSync` 产出**两条 update**，其中 `id:"a"` 会把旧缩进写回。触发需要「删缩进→保存→约 1 秒内重开→改别的段→保存」，窗口极窄，且损失只是「多回一个缩进」，不动正文。若要收口，最小改法是在调用 `planSync` 前把「仅前导缩进不同」判为未编辑（用保存时的新 `original` 为准）。

**4. 「瞬时抖动」的真正成因（更正实现方的判断）**

实现方在第 4 点判断抖动来自「内核读模型滞后」。**实测不是这个原因，而是三个 E2E 脚本之间的互相干扰：**

| 观察 | 结果 |
|---|---|
| `e2e-layout.mjs` **单独**运行 | **exit 0**，`reopened 2 documents, missing 0` |
| 先跑 `e2e-save` + `e2e-panes`，紧接着跑 `e2e-layout` | **exit 1**，`MISSING 20261104164233-82w9a89`、`-tkq3klm` 两篇 |
| 这两个 id 是什么 | **今天 16:42:33 由 `e2e-panes` 创建的临时文档**（该脚本 `createDocWithMd` 建 2 篇、结束时 `removeDocByID` 删 2 篇） |
| `e2e-layout` 怎么选文档 | `select … order by updated desc limit 4` —— 正好取到「刚被创建又删除」的临时文档 |

即：写类 E2E 建完就删，删除在索引里传播有延迟，而 `e2e-layout` 按「最近更新」取样，恰好抓到这些将消失的 id → `getBlockKramdown` 返回 `block not found` → 记为 MISSING → `exitCode = 1`。

**这解释了我在 §4.15、§4.16、§4.17 三度遇到的「重跑即过」** —— 每次我都是把三个 E2E 串在一起跑，前面两个刚建删过临时文档。
**影响**：是**测试工具**的问题，不是产品问题；但它会让「按顺序跑 E2E」的场景**稳定假红**，浪费核查时间。
**建议修法**（任选，都只改工具）：① `e2e-layout` 对取到的候选文档**逐个容错**——读不出来就跳过而不是记 MISSING；② 取样时排除 `dsh-`/`dsh-*` 标题或 `created` 为当天的文档；③ 用固定的已知良好文档 id 列表。

### 11. 最后一版收尾（`b21538dd`）：注释微调 + 工具修复的复核

**最终版**：`lib/client.js` `b21538dd7a41d15c84bcfedeb060c970cfed543767c8940e8160cd42053ac0a0`，**4305 行**（行数不变，单行摘要改写）；`test/first-indent.test.mjs` `930f9d17…`、`lib/index.js` `1fcf3e7d…`、`lib/host-utils.js` `aea81255…`、`README.md` `3ec2b668…` 全部未动。
复跑：`node --test` **103/103**、render **643**、hygiene **34/100/66**、硬编码颜色 **0**。

**注释微调确认 ✅**：唯一改动是第 539 行的摘要
`Strip SiYuan's block-attribute noise and paragraph indentation …`
→ `Strip SiYuan's block-attribute noise and the serializer's one-indent prefix from one block's markdown.`
消除了「剥真实段落缩进」的误读，与我第 10 点提的建议一致，函数体未变。

**串行路径已复测为稳定绿 ✅**：我自己跑 `e2e-panes` → `e2e-save` → `e2e-layout`，得到 `candidate documents: 4` / `reopened 2 documents, skipped 0` / **`layout exit=0`** —— 三轮的假红问题确实解决了。

**但这次的工具修复有三处需要指出（都只影响 `tools/e2e-layout.mjs`，不影响产品）：**

1. **「排除 10 分钟内更新」这条过滤是 no-op（空转）**。思源的 `blocks.updated` 是 **14 位数字字符串**（如 `"20261104161523"`），而脚本用 `new Date(String(row.updated).replace(" ", "T"))` 解析 → `Invalid Date` → `NaN` → 判断式 `!Number.isFinite(stamp) || now - stamp > STABLE_AFTER_SECONDS` 的**左边恒为 true** → **每一行都被保留**，`STABLE_AFTER_SECONDS` 从未生效。
   实测：`"20261104161523" -> stamp=NaN | Number.isFinite=false | kept=true`（5 篇全 kept）。
   修法：按位拼 ISO —— `u.slice(0,4)+'-'+u.slice(4,6)+'-'+u.slice(6,8)+'T'+u.slice(8,10)+':'+u.slice(10,12)+':'+u.slice(12,14)`，实测该解析得到 `age=1869s`，判断正确。
2. **真正起作用的是标题过滤，而它依赖 SQLite `LIKE` 的 ASCII 大小写不敏感**。临时文档的标题其实是**大写** `DSH-PANE-A-…` / `DSH-E2E-…`，而过滤条件写的是小写 `content not like 'dsh-%'`。实测 `select 'DSH-PANE-A-1' like 'dsh-%'` → **1**，所以它能命中，串行路径才转绿。
   风险：这是**隐式依赖**。若哪天该库开启 `PRAGMA case_sensitive_like`、或临时文档改了命名习惯，假红会静默回来。建议显式化：`lower(content) not like 'dsh-%'`。
3. **一处 off-by-one，会在候选恰好 2 篇时崩溃**：守卫写的是 `if (rows.length < 2) SKIP`，但第 5 步用的是 `rows[2].id` / `rows[2].content`。若 `rows.length === 2` → `rows[2]` 为 `undefined` → `TypeError` → **假红**。建议改为 `< 3`（或第 5 步改用 `rows[rows.length-1]`）。

**关于「`reopened === 0` 才 FAIL 是否过宽」的判断（实现方要求回答的第 2 点）**：
**偏宽，建议换成「存在性判别」而不是百分比 WARN。** 理由：
- 该脚本实际只重开 **2 篇**（`rows[0]`、`rows[1]`），所以结果只可能是 0/1/2。把 `1` 判为通过，等于**允许 50% 失败静默通过** —— 若 `readDocumentText` 对某一类文档坏了，恰好一篇坏、一篇好，就会绿。
- 而 WARN 很容易被忽略（脚本仍然 exit 0），起不到护栏作用。
- **精确的判别是可行的**（我实测过）：对每个被跳过/失败的候选，用 `select id from blocks where id = '<id>'` 查一次 ——
  - **查不到** → 文档已消失（临时文档），`SKIPPED` 合理；
  - **查得到** → 文档存在却读不出来，这是**产品失败，应当 FAIL**。
  实测：已消失的临时 id `20261104164233-82w9a89` 查询返回 **0 行**，说明这个判别能可靠区分「消失」与「存在但读不出」。

### 12. 工具侧四条修复的复核（`lib/` 未动，仅 `tools/e2e-layout.mjs`）

**最终状态**：`lib/client.js` **`b21538dd…` / 4305 行**（与第 11 点验的完全一致，本轮未动）；`test/first-indent.test.mjs` `930f9d17…`、`lib/index.js` `1fcf3e7d…`、`lib/host-utils.js` `aea81255…`、`README.md` `3ec2b668…` 全部未动。
复跑：`node --test` **103/103**、render **643**、hygiene **34/100/66**、硬编码颜色 **0**。

四条工具修复我逐条复核，并**自己重做了一遍故障注入**（在副本 `D:\tmp\dsh-verify\e2e-layout-inject.mjs` 上，仓库未被修改）：

| 我报的问题 | 修复 | 我的复核结果 |
|---|---|---|
| (a) 「排除 10 分钟内」是 no-op（14 位字符串喂 `new Date()` 得 NaN，判断式左边恒真 → 每行都保留） | 改为显式分段解析 `/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/`，不可解析的 stamp **打印警告并保留** | ✅ 实测生效：真实行 `"20261104161523"` → `stamp=1793780123 finite=true age=2096s kept=true`；**合成「当前时刻」→ `age=0s` → `kept=false`（会被正确排除）**；`"not-a-date"` → `NaN` → 保留并告警。**窗口过滤真的活了**（修复前一切都被保留） |
| (b) 标题过滤靠 SQLite `LIKE` 隐式 ASCII 大小写不敏感（临时文档实际是大写 `DSH-*`） | 显式 `lower(content) not like 'dsh-%'` | ✅ 已在源码确认（第 59 行），不再依赖 pragma 行为 |
| (c) off-by-one：守卫 `< 2` 但第 5 步用 `rows[2]`，候选恰好 2 篇会 `TypeError` 假红 | 改为 `< 3`，SKIP 消息写明原因 | ✅ 已确认（第 74 行） |
| (d) 判定过宽：`reopened === 0` 才 FAIL，允许「1 篇坏 1 篇好」静默通过 | 采纳**存在性判别**：`select id from blocks where id=…`，查得到 → `UNREADABLE` 并 FAIL；查不到 → `SKIPPED` | ✅ **见下方注入结果** |

**故障注入（我自己独立做的）**：在一份副本里给「确实存在」的文档 `20261028200204-qp172p3` 注入 `throw new Error("injected: block unreadable")`，其余逻辑不变：

```
  reopened 20261028200018-0yxlhji "001 第一章 红鞋的少女" -> 82 blocks, buffer 4456 chars
  UNREADABLE 20261028200204-qp172p3: still in the index but could not be opened (injected: block unreadable)
reopened 1 documents, skipped 0, unreadable 1
FAIL: documents that still exist could not be reopened: [{"id":"20261028200204-qp172p3","why":"injected: block unreadable"}]
→ exit 1
```
**这正是 `reopened === 0` 方案会漏掉的「1 篇坏 1 篇好」，现在会红。** 判定不再过宽。

**正常路径 / 串行路径复测**：`e2e-panes` → `e2e-save` → `e2e-layout` 得到
`candidates: 40 | stable enough to sample: 4 | reopened 2 documents, skipped 0, unreadable 0 | exit 0`
—— 三轮的假红彻底消除，且我上一轮报的 (a)(b)(c) 三个真 bug 已闭合。

**临时文档残留**：我独立复查 `lower(content) like 'dsh-%'` → **0 篇**；`created like '20261104%'`（今天创建）→ **0 篇**。

### 13. 一条应并列写入的教训：验证工具本身也需要被验证

§4.15–§4.17 三轮里我反复遇到「`e2e-layout` 重跑即过」，并三次把它归因为「内核读模型瞬时抖动」。真实链条是：

1. **第一个错**：`e2e-layout` 用 `order by updated desc limit 4` 取样，抓到兄弟 E2E 刚建又删的临时文档 → 稳定假红；
2. **第二个错**（实现方修它时）：修法里 3 个 bug —— 时间戳解析 no-op、隐式 LIKE 大小写依赖、off-by-one；
3. **第三个错**（我）：把工具报红当成产品抖动，连续三轮没查。

这与我此前总结的「**成批 MISMATCH 先怀疑取数口径**」是同一类，但更一般化，建议并列记入：

> **「工具报红」也要先怀疑工具。** 验证脚本本身是一个需要被验证的程序：它的取样口径、时间戳解析、大小写假设、判定阈值都会说谎。**对验证工具做故障注入，就是它的变异测试** —— 只有当「注入一个必然失败」能让它变红时，它报绿才算证据。

这条对后续任何一轮都适用：**报红时先复现最小路径（单独跑 vs 串行跑），报绿时先确认它有能力报红。**

## 4.18 打字速度统计（第十六轮需求）

**用户反馈**：「编辑器我现在还需要一个打字速度统计」。
**用户确认的口径**：**近 1 分钟滚动速度**（不是全程平均）、**净增字数**（不是击键数，删除扣减）。

**版本**：`lib/client.js` `9bd804f5…`（**4482 行**，4305 → 4482）、`test/typing.test.mjs`（新）`107e7c0e…`（137 行 / 6 test）、`README.md` `a3e11bb6…`（新增「打字速度」一节）、`lib/index.js` `bf840375…`（本轮一并核，见第 8 点）、`lib/host-utils.js` `aea81255…` 未动。

### 已执行的验证命令与实测数字

```bash
cd dsh-siyuan-notes
node --test                              # 109/109 pass, 0 fail
node test/render.test.mjs                # 643 components, depth 4, no exceptions
node test/hygiene.test.mjs               # 36 setters / 100 keys / 66 classes
grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(' lib/client.js   # 0
node scripts/e2e-save.mjs                # E2E: OK
node scripts/e2e-panes.mjs               # PANE E2E: OK
node ../tools/e2e-layout.mjs             # exit 0（reopened 2, skipped 0, unreadable 0）
node ../tools/e2e-tree-reveal.mjs        # OK
node ../tools/e2e-first-indent.mjs       # 第一段有缩进、bare=0
node ../tools/e2e-no-phantom-write.mjs   # keep=82 write=0
node ../tools/probe-typing-session.mjs   # 27/2 递减到 0，程序化输入 0 次
```

### 三档结论

| 项 | 结论 | 证据 |
|---|---|---|
| `typingMeter` 纯函数（稳态不衰减 / 暂停衰减 / 删除扣减 / 上限下限 / 边界） | ✅ **已实测** | 我自己 16 项探针，含复现实现方修掉的那个衰减 bug |
| `isTypingInput` 白名单 | ✅ **已实测** | 6 类键入计入、10 类非键入不计、垃圾值不计 |
| `suppressTypingCount` 覆盖完整性 | ✅ **已实测**（全文件枚举，非抽样） | 见第 1 点 |
| 速度为 0 时隐藏 | ✅ **已实测** | 渲染树里无 `typingRate` span，同时 `charCount`/`chineseCount`/`blockCount` 都在（证明不是空渲染） |
| 每栏独立 | ✅ 已实测（代码 + 渲染） | `meterRef` 在 `EditorPane` 内 |
| **preview 栏切到编辑后计数不工作** | ⚠️ **仅代码复核（真缺陷，轻）** | 见第 2 点 |
| 真实浏览器里打字计数 | ⚠️ **未验证** | 无浏览器，无法触发真实 `beforeinput` |
| `lib/index.js` `ageSeconds` 修复 | ✅ **已实测** | 19 项，走真实管线，见第 8 点 |

### 1. `suppressTypingCount` 的覆盖完整性（最关键的一项）

全文件枚举（不是抽样）：

| 项 | 数量 | 是否被 `withoutTypingCount` 包住 |
|---|---|---|
| `document.execCommand` 调用 | **1**（1113） | ✅ 是 |
| `textarea.value = …` 赋值 | **1**（1119） | ✅ 是 |
| `replaceRange` 定义 / 调用 | 1 处定义 / **1 处调用**（2230，在 `applyEdit` 内） | — |
| `withoutTypingCount` 调用点 | 2（1113 / 1119） | — |

三种「可能绕过」的路径逐一排除：
1. **`applyEdit` 的 preview-only 分支**（`update({ text: result.text })`）：它不碰 `textarea`，不产生 `beforeinput`/`input`，**不需要包** —— 实测该分支在 `ta` 为 null 时进入，且 `meter` 只监听 textarea 事件。
2. **受控 textarea 重渲染**：React 设置 `value` 属性**不派发 `input` 事件**，所以「程序化改值被计入」没有路径。
3. **撤销/重做、粘贴、拖放、格式化命令**：由 `isTypingInput` 的白名单挡掉（实测 10 类全部为 false）。

**结论：覆盖完整，没有第三条未包的程序化写路径。** 这是本轮做得最扎实的一处 —— 它没有靠「我记得都包了」，而是把写入通道收敛到唯一函数。

### 2. 一处真缺陷：preview 栏切换到编辑后，打字计数不工作

- textarea **只在 `view !== "preview"` 时渲染**（编辑器区是 `view === "preview" ? <article> : <div><textarea/></div>` 的三元）。
- 计数的 `useEffect` 依赖是 **`[doc && doc.id]`**（2680），不含 `view`。
- 于是：**某栏以 preview 挂载** → `textareaRef.current === null` → effect 早退、**监听器根本没装上**；用户再点「编辑」，`view` 变了但 `doc.id` 没变 → **effect 不重跑** → 该栏打字速度永远是 0，而 0 又被隐藏 → **功能在该栏静默失效**，直到切换文档才恢复。
- **可达性**：不是理论问题。布局恢复会按记忆还原每栏的 `view`，`e2e-layout` 自己就断言过 `restored flags` 里有 `view:"preview"`；用户上次留了一个预览栏，下次打开再切编辑就会命中。
- **修法（一行）**：依赖加上 `view` —— `[doc && doc.id, view]`。这样切到编辑时 effect 重跑、此时 `textareaRef.current` 已就绪。
- **影响面**：不写坏数据、不误计，只是「这一栏不显示速度」。按现有三档记「仅代码复核」，因为要真实浏览器/真实 textarea 才能跑到「监听器没装上」这一步。

### 3. 异步 `input` 派发会不会漏过抑制标志（实现方要求判断的第 2 点）

**这个风险不成立，不需要改成「inputType + 时间窗」双判。** 理由：
- 抑制标志**只在 `beforeinput` 处理器里读**（2665），并**立刻锁存**到 `pendingInputRef`；`onInput` 只读 `pendingInputRef`，**再不看那个全局标志**。
- `execCommand("insertText")` 是**同步**派发 `beforeinput` 的，所以读标志时它一定是 `true`。
- 即使 `input` 事件被异步派发，等到它到达时 `pendingInputRef` 早已是 `false`，照样不计。
- 反过来，若浏览器**根本不派发** `beforeinput`，`pendingInputRef` 恒为 `false` → 不计数（**静默退化、不会误计**），这是可接受的最坏情况。

### 4. `before` 长度基准与 delta（第 3 点）

- 正常键入/IME：`beforeinput` → `input` 1:1，`delta = ta.value.length - before` 正确。
- **插件从不在 `beforeinput` 上 `preventDefault`**（我查了全部 `preventDefault` 调用点：都是 `keydown` 的 Enter/缩进处理），所以不存在「`beforeinput` 被取消 → `pendingInputRef` 搁浅 → 下一次无关 `input` 被误计」的路径。
- 残留的理论误差：若某浏览器对一次 `input` 派发多次 `beforeinput`（或反之），`before` 会被最后一次覆盖，delta 可能少算/多算。属于浏览器行为差异，无法在无浏览器环境下验证。

### 5. `meter` 的生命周期 / 切标签是否清零（第 4 点）

- `meterRef` 用 `useRef(null)` 且只在 `=== null` 时创建（2646-2647）→ **跨标签切换、跨文档都保留，不重置**。
- **我的判断：保留是对的，不必清零。** 口径是「近 1 分钟打字速度」，它是**人的行为指标**而不是「这篇文档的指标」；切到另一篇继续写，速度本来就该延续。60 秒窗口会自然把旧文档的贡献衰减掉。
- 但要在文档里说清「近 1 分钟」是**跨文档**的，否则用户可能以为每篇单独统计。
- **唯一需要修的是第 2 点那个 preview→edit 的洞**（那是「根本没装上监听器」，与是否重置无关）。

### 6. 纯函数边界（第 5 点）：16 项全过

`add(0)` / `add(NaN)` / `add(Infinity)` / `add("x")` 全被忽略；`at` 为 `undefined` 回落 `Date.now()`；`windowMs` 传 `0/-1/NaN/Infinity/"60000"/null/undefined/{}` 全部回落到 60s 不抛；空表 0；**巨大删除（-10000）不为负**；上限 1200 生效；窗口外归零；`reset()` 清空；**样本恰好在 cutoff 被判出**（`> cutoff` 严格）；快速按键折叠；稳态不衰减；暂停衰减到 0。

两次关键性质实测：
```
steady 2 chars/s -> {"30":124,"60":122,"90":122,"120":122} cpm   ← 修掉的那个 bug 确实好了
live=120  after 10s pause=80  after 45s pause=28  after 70s pause=0
```

**我自己的一次探针错误（如实记）**：第一版稳态测试一次性塞入 90 秒的样本再在 60s 处取率，等于喂了**未来样本**，算出 240 cpm 并误报「稳态仍衰减」。改成按真实时序逐秒推进后是 **124/122/122/122**，完全正常。**实现是对的，我的探针口径错了** —— 与 §4.17 那条教训同一性质。

### 7. hygiene（第 6 点）

- `typingRate` 中英齐全：zh `"{n} 字/分"`（70 行）、en `"{n} cpm"`（205 行）✅
- 本轮**没有新增 `sy-*` 样式类**（仍是 66 个）✅
- 新测试文件无放宽断言模式（`check-t2` 未报 relaxation）✅
- `hygiene` 的 setter 数从 34 升到 36（新增两处 `useState`：`typingRate` 与 `pendingInputRef` 的 ref 不计入，实际是 `typingRate` + 一处），与实现一致。

### 8. `lib/index.js` `bf840375` 的独立验证（第 8 点，上轮遗漏）

走了**真实管线** `原始 body → normalizeContext() → contextToolValue() → DSH lossless-JSON 检查`，**19 项全过**：

| 检查 | 结果 |
|---|---|
| 关闭文档（`docId:null` / 空 body / 空白 docId） | `ageSeconds` **键不存在**（不是 undefined 值）✅ |
| 打开文档（最小 / 带光标 / 带选区 / 三标签 / 空白选区） | 全部通过 lossless 检查 ✅ |
| `ageSeconds` 仍有值（`updatedAt` 早 5s → 5） | ✅ |
| `describeContext` 对 `selection: null`（常态：无选区）| 不抛，且摘要不提「选中」✅ |
| 空白选区被归一化掉 | ✅ |
| `contextAgeSeconds` 未来时间戳不为负 | ✅ |

**并且我证明了这条守卫不是空跑**：同一个对象 `{open:true, ageSeconds: undefined}`，`JSON.stringify` 会**静默丢掉键**（`{"open":true}`，这正是缺陷当初能上线的原因），而测试里的 walker **会拒绝**它。所以那条断言有牙齿。

两处**代码复核观察（不阻塞）**：
1. `describeContext` 用 `snapshot.selection !== null` 判断，只挡 `null` 不挡 `undefined`；若有人拿**手工构造**的快照（`selection` 为 `undefined`）调用会崩在 `endLine`。生产不会 —— `normalizeContext` 只产出 `null` 或完整对象。**我的第一版探针就踩了这个坑**（喂未归一化快照 → `endLine` 崩溃），改用真实管线后 19/19，所以这是我的探针错，不是产品 bug。
2. `withoutUndefined` 过滤 `undefined`，但**不拦 `NaN`**；而 DSH 的 lossless 检查同时拒绝非有限数。因为 `normalizeContext` 总会写 `updatedAt`，`ageSeconds` 不会变 NaN，当前不可达。

### 9. 发现一处注释残留 —— 行锚点脚本第三次事故的物证

`rate` 方法前有**两段互相矛盾的重复 JSDoc**（1211-1218 与 1219-1226）：
- 前一段说的分母是「已观测时长」（即**修掉之前的错误做法**）；
- 后一段才是修正后的「最老存活样本的跨度」。

残留无害（注释而已），但它正是本轮那次「`move-typing-flag.mjs` 吞掉函数闭合括号」事故的物证 —— 修复时把新注释加上了、旧的没删。**建议删掉前一段**，否则读者会看到两个互相矛盾的分母解释，反而更容易改错。

### 10. 设计判断：速度为 0 时隐藏（实现方要求判断）

**同意隐藏，不建议改成常显或加「本次平均」。** 理由：
1. 与状态栏既有的「最近保存时间为空时不显示」一致，风格统一；
2. 常显 `0 字/分` 是一个**永远为 0 的噪声项**，占位却不传递信息；
3. 「本次平均」作为常驻项**会误导** —— 用户看到它常驻，会把它当成「当前速度」，而它恰恰在停手时不衰减，与本次需求「近 1 分钟滚动」的口径相反。
- 可发现性用**别的方式**补：README + 输入框 `title`/悬浮提示里写明「近 1 分钟」，首次打字时数字自己会冒出来，用户自然看到。**不建议为了可发现性牺牲口径清晰度。**

### 11. 第三次违反「结构性编辑禁用行锚点脚本」→ 升级为硬性检查项

本轮实现方用 `move-typing-flag.mjs` 按 `trim() === "}"` 找函数结尾，而 `withoutTypingCount` 的 `try/finally` 里有多个 `}`，**吞掉了闭合括号**，`replaceRange` 被嵌进 `withoutTypingCount` 内部，测试从 109 掉到 43（`ReferenceError: replaceRange is not defined`）。

这是 §4.16 那条纪律的**第三次违反**（§4.16 吞 170 行、§4.17 一次、本轮一次）。按实现方要求，**不再是「教训」，改为硬性检查项**：

1. **禁止**用 `trim() === "}"`、`向上找注释`、`找空行` 这类**模糊锚点**做结构性编辑；必须用「函数名 + 括号深度」或完整签名定位。
2. **禁止**用行号区间脚本搬运代码块；改用「逐函数整体替换」。
3. 每次结构编辑后**立刻**跑三道：`node --check`（语法）→ 目标符号出现次数自检 → `node --test` 全量。任一不过就回滚重做，不叠第二次修改。
4. 若环境有 git，**先提交再改**；本仓库无 git，则应先另存一份 `.bak` 到 `D:\tmp\`，改坏可整体还原（本轮正是靠服务端下发的完整副本才定位回来的）。

同时记下一条**编码规范**：脚本里做「文本包含」判断时，**不要写正则**（易被多层转义毁掉，本轮 `\\(` 被转义两次变成字面量），直接用 `source.includes("...")` 做字符串包含判断。这是本轮实现方自己总结的，我认同并已写进检查项。

### 12. 收尾复核（`555c83c1`）：三处修复 + 新工具的判断

**最终版**：`lib/client.js` `555c83c1…`（**4478 行**，比上一版少 4 行 —— 删掉的旧 JSDoc 多于新增注释）、`test/typing.test.mjs` `30531fae…`（**153 行 / 7 test**）、`README.md` `0072fdb8…`；`lib/index.js` `bf840375…`、`lib/host-utils.js` `aea81255…` 未动。
复跑：`node --test` **110/110**、render **643**、hygiene **36/100/66**、硬编码颜色 **0**；`tools/check-integrity.mjs` exit 0；`tools/probe-typing-session.mjs` 数字与上一版完全一致（126 / 83 / 31 / 0，程序化输入 0 次）。

| 项 | 结论 |
|---|---|
| ① `[doc && doc.id]` → `[doc && doc.id, view]` | ✅ 已确认（2676 行），`if (!ta) return undefined` 容错守卫仍在 |
| ② 旧 JSDoc 删除 | ✅ 已确认干净，`rate` 前只剩一段且与实现一致 |
| ③ README「跨文档延续」 | ✅ 与实现严格一致 |
| 全量 / E2E | ✅ 110/110；本轮只改依赖数组与注释，行为面未动 |

**1. `before` 基准在 effect 重建时重置，会不会漏计一次？（要求判断的第 1 点）**

**不需要处理，理由是时序上不可达：**
- 一次键入的 `beforeinput` → DOM 变更 → `input` 是**同一个 task 内同步完成**的三步；而切换视图（点「编辑」）是一次 React 状态更新，属于**另一个 task**。两者**无法交错**。
- 因此 effect 重建时不可能停在「`beforeinput` 已发、`input` 未到」的中间态；重建后的第一次 `beforeinput` 会重新采样 `before = ta.value.length`，与当时真实长度一致。
- 而且**重置本身就是正确的**：新监听器若沿用旧 `before`，反而会把「重建期间的长度差」错算进下一条 `input`。
- `meterRef` 由 `if (meterRef.current === null)` 保护，**重建不丢已累计样本** —— 实测确认（实例只在首次渲染创建）。
- 补充观察：`edit` ↔ `split` 切换时两个分支都是「非 preview」→ 同一个 `<textarea>` 元素被 React **复用**（同位置同类型），cleanup 的 `removeEventListener` 作用在同一元素上，不会出现「监听器挂在已卸载元素上」的泄漏。

**2. 旧 JSDoc 是否删干净（第 2 点）**

干净。`grep "measured against the elapsed time"` → **0 命中**；`rate` 目前只有一段 JSDoc，内容是「分母 = 最老存活样本的跨度、上限为窗口；用整段 run 的时长会让稳态率随时间衰减」，**与实现 `span = Math.max(1000, when - samples[0].at)` 完全一致**。`check-integrity.mjs` 的「stale JSDoc removed / corrected JSDoc present」两项也 ok。

**3. README「跨文档延续」（第 3 点）**

逐条对得上：每栏独立 = `meterRef` 在 `EditorPane` 内 ✅；跨文档延续 = `meterRef` 只在 null 时创建、切文档不重建 ✅；「衡量你现在的速度 + 60 秒窗口衰减旧数据」= 分母取最老存活样本跨度、prune 窗口外样本 ✅；「只统计真人按键 + 程序化写入抑制」= `suppressTypingCount` / `withoutTypingCount` ✅；「速度为 0 不显示」= `typingRate > 0 ? span : null` ✅。

**4. 新增第 7 条测试的形态（我的观察）**

`source: the typing listeners follow the view mode` 是**源码文本断言**（`source.includes("}, [doc && doc.id, view]);")`），不是行为测试。它的价值取决于两件事，都成立：
- 实现方做了**变异验证**：依赖改回 `[doc && doc.id]` → 该测试立刻红，说明不是空跑；
- 它同时断言 `const ta = textareaRef.current; if (!ta) return undefined;` 仍在，防止「为修 preview 而把容错删掉」。
按三档记「**已实测（变异验证 + 源码断言）**」，但明确标注：**这类断言只能锁住「写过这行」，锁不住「这行行为正确」** —— 行为面仍要真实浏览器，仍属未验证。

**5. `tools/check-integrity.mjs` 值不值得留（第 5 点，也是实现方问的流程问题）**

先直接回答那个反问：**算同一族，但性质不同，不必因噎废食。**「凭记忆猜计数 → 猜错 5 个 → 改成实测值」这个循环的最终产物不是「一个主观预期」，而是**一份快照**。快照的用途是**变更检测**，不是正确性证明；只要没人把它当证明用，它就是正当的。真正的危险只有一种：**在失败之后盲目重算快照**，那会把 bug 一起锁进去。

分项判断（**建议保留，但分层**）：

| 检查 | 我的判断 |
|---|---|
| **花括号深度扫描**（跳过字符串/注释） | **强烈建议保留**。结构性事实、零主观性，且**正好命中本轮事故的形状**（吞 `}`、提前闭合）。整个脚本里价值最高、成本最低的一项。 |
| 符号出现次数 | **保留，但降级为「漂移探测器」**，并加硬规则：**期望值只允许在 `node --test` 全绿且人工看过 diff 之后重新生成**。否则会养成「红了就改数字」的习惯，检查就废了。另需承认它与 `node --check` + `node --test` 有重叠，**边际价值主要在「代码被吞掉但语法仍合法」这种场景**。 |
| JSDoc 存在性/缺失断言 | **建议移到测试里或长期删掉**。它验证的是「某次修复有没有按我说的删注释」，属**一次性核对**而非长期不变式，留在脚本里会变成噪声。 |

**一句话结论**：**留花括号扫描（核心价值），留符号计数但明确它是漂移探测、规定「只在全绿后重算」，把 JSDoc 断言降级或移除。** 这样既保留防护力，又不会退化成「用错口径自证正确」。

**6. 收尾状态**

- 实现方按新纪律做的三件事我确认有效：**编辑前备份**、**round 内不再用行锚点做大块搬运**、**改完跑完整性检查**。本轮三处修改都是「目标唯一、不碰结构」的小手术，与前面两次事故的成因（多行结构搬运）本质不同。
- 产品侧结论（供用户核对）：打字速度在底部状态栏块数后面，`{n} 字/分` / `{n} cpm`，**近 1 分钟滚动、净增字数、只算真人按键、每栏独立且跨文档延续、速度为 0 时不显示** —— 五项我逐条与实现核对过，与 README 一致。
- 仍属**未验证**：真实浏览器里的计数与衰减观感（无浏览器，无法触发真实 `beforeinput` / IME）。

### 4.18.1 补记：检查器自身是坏的（实现方在验证员收尾后自查发现）

这一条必须单独记，因为它推翻的是**验证工具**，不是产品代码。

**发现过程**：按验证员建议把 `check-integrity.mjs` 分层重写后，实现方对它做了变异验证——删掉
`typingMeter` 的**一个开括号**，此时文件已无法通过语法解析。检查器仍然输出：

```
ok   brace balance: depth=0, no premature close
exit=0
```

**根因**：手写字符扫描器把**正则字面量当成了字符串或注释**。文件里有 `/^\t{3}\/\*\*$/` 这类正则，
扫描器遇到 `/` 就切进「注释/字符串」状态，此后整个文件的判断全部错位。因此它对本轮真实事故
（行锚点脚本吞掉 `withoutTypingCount` 的闭合 `}`，导致 `replaceRange` 被嵌进其内部）**恰好是瞎的**。

**这比「值不值得留」严重**：实现方用一个坏掉的检查器去检查自己的改动，而它给出的绿灯是假的。
验证员在 §4.18 第 5 点给出的「花括号扫描强烈建议保留、价值最高」这一判断，**前提被这次实测推翻了**。

**修法**：不再手写 lexer，改用 Node 自己的解析器——结构的唯一权威：
```js
try { new Function(source); }                    // lib/client.js（浏览器 bundle body）
execFileSync(process.execPath, ["--check", p])   // lib/index.js、lib/host-utils.js（ESM）
```
手写扫描器要正确处理正则字面量、模板字符串嵌套、除号歧义，本来就不该出现在检查脚本里。

**修完的变异验证（这次才真的证明了它有效）**：
```
injected: removed the opening brace of typingMeter
checker exit code: 1 (expected 1)
BAD  client.js DOES NOT PARSE -> Unexpected token 'const'
PASS: the brace scan caught it
restored the original file
checker on the restored file: PASS (exit 0)
```

**探针本身也错了一次**：第一版按旧文案 `"brace balance"` 判断，而新输出是 `"DOES NOT PARSE"`，
于是「检查器报对了、探针却判它没抓到」。**又一次取数口径错**。

**最终形态（按验证员的三层建议落地）**：

| 检查 | 处置 |
|---|---|
| 解析检查（原花括号扫描） | **保留，但改用 Node 解析器** —— 比手写扫描器更强、更准 |
| 符号计数 | **保留并明确降级为漂移探测器**。脚本注释里写死：快照只用于变更检测、不是正确性证明；**只在 `node --test` 全绿且人工看过 diff 后才允许刷新**，为让红的变绿而重算会把下一个 bug 锁进去 |
| JSDoc 存在性断言 | **已移除**（一次性核对，长期是噪声） |

**新增**：`tools/probe-integrity-catches.mjs` —— 检查器的变异测试，注入「删一个括号」并要求检查器
报红，跑完自动还原。它是这一条教训的可执行形式，应长期保留。

**本轮实现方累计犯的同族错误（四条，同一句话）**：

1. 用行锚点脚本做结构编辑，吞掉闭合括号（§4.16 硬纪律的第三次违反）
2. 符号期望计数凭记忆猜，猜错 5 个
3. 变异探针按旧文案断言，误判「检查器没抓到」
4. **检查器自身把正则字面量当字符串，对真实事故完全瞎**

四条都是：**验证工具本身需要被验证，而它的失败模式往往与正在排查的 bug 一模一样。**
建议把「对检查器做变异验证」列为**强制步骤**，与「对功能做变异验证」并列——本次若没有这一步，
一个坏掉的检查器就会以「exit 0」的形式留在仓库里继续给出假绿灯。

## 4.19 自动保存时的视觉跳动 · 光标回弹 · 第一段不缩进（第十七轮反馈）

用户一次反馈三条，都在同一次写作里观察到的：

1. 自动保存的时候，整个编辑器都会上下移动一下，造成视觉上的错位；
2. 如果当前指针闪烁的地方是空白的话，会回到上一段的末尾；
3. 编辑器手打出来的第一段不会自动进入首行缩进的状态，但是第二段就可以了。

### 根因（逐条）

| 症状 | 根因 | 位置 |
|---|---|---|
| ① 上下跳（主因） | 面板级 transient notice 是 `section.sy-root` 的直接子节点，夹在 header 与 `.sy-body` 之间；`.sy-notice` 约 28px 高。每次 `save()` 末尾 `onNotice(...)` 把它插进流里 → 下面整体下移，4.2s 定时器清掉 → 弹回。自动保存 2.2s 一次，于是「每次保存都跳一下」 | 面板 notice 渲染 + `.sy-notice` CSS |
| ① 上下跳（次因） | `.sy-toolbar{flex-wrap:wrap}`；保存按钮在 `doc.saving` 时文案由「保存」变「保存中…」，宽了约 20px，足以把后面的按钮挤到下一行，工具栏长高一行（约 32px） | 工具栏保存按钮 |
| ② 光标回弹 | `save()` 成功后把内核回读文本灌回受控 textarea：`joined = verified.map(...).join("\n\n")` 里没有「没有对应块的空行」（末尾空行没有块、连续空行被并成一个），受控 `value` 变短 → 浏览器把光标钳到新的末尾，也就是上一段末尾 | `save()` 完成段 |
| ③ 第一段不缩进 | `FIRST_INDENT` 只在 Enter 路径写入（`handleEnterKey` → `continueOnEnter`）；第一段永远不经过 Enter。`indentParagraphs` 只在开关点击 / 补齐全篇时跑，`restoreFirstLead` 只是读修复 | `handleEnterKey` / `continueOnEnter` |

### 修法

1. **提示条改为浮层**：`className: "sy-notice sy-toast"` + `.sy-toast{position:absolute;left:50%;bottom:46px;…;pointer-events:none}`
   （`.sy-root` 本来就是 `position:relative`），出现/消失都不再占布局高度。
   自动保存改为静默（`save(true)`：成功不弹 ok，失败与校验警告照弹 —— 状态栏的「已保存/未保存 + 时间」就是回执）。
   保存按钮的 label 放进定宽槽 `.sy-btn-label{min-width:4.2em}`，「保存中…」不再改变按钮宽度。
2. **保存不再重建缓冲区**：删掉 `let text = current.text` / `text = joined || current.text` 整段，
   改为 `{ ...prev, savedText: current.text, … }`（`savedText` 记「刚写出去的那份」）。
   缓冲区形态（末尾空行、双空行）保留，光标与滚动都不动；保存期间新打的字也不会被这次保存的结果覆盖
   （`savedText` 落后于 `text` → 仍是未保存 → 下一轮自动保存接手）。
3. **第一段也吃首行缩进**：新增纯函数 `autoIndentParagraph(before, after, caret, { indent })`
   （规则）与 `typingIndentPlan(before, after, caret, { indent, kind, composing })`（事件门：composing / 粘贴 / 撤销一律不缩进）
   与 `autoIndentTextarea(textarea, beforeText, options)`（落到活 textarea 上，返回插入的字符数）。
   规则只对「编辑前那一行是空行 + 是块首（前一行空白 / 标题之后 / 闭围栏之后）+ 非结构行 + 没有前导空白」
   的段落补一次 U+3000，且只补一次（补过就以 `^\s` 挡住）。
   「刚才是不是空行」按**偏移**判断（`previous[at]` 不是换行才是已有内容的续写），不按行号 ——
   删掉一个换行会让后面所有行号错位；这一条是验证方实测出反例后改的（`"甲\n\n\n乙"` 行首退格）。
   接线在 textarea 的 DOM 监听里：`input`（非 composing）+ `compositionend` 后 `setTimeout(0)`
   （中文候选落字时 `input` 仍报 `isComposing`）。缩进不计入打字速度（`delta - inserted`），
   自己写入产生的嵌套 input 由 `indenting` + `suppressTypingCount` 挡住。
4. **顺带修掉同一族的第三个「编辑器跳」**：点开关 / 「补齐全篇」时原来是 `start: 0, end: 0`，
   光标被扔到文档开头（浏览器随即滚到顶部）。新增 `caretAfterIndent(before, after, caret)`：
   重写只在行首增删两格、行数不变，所以按「光标所在行前面各行净变化 + 本行 ±2」映射回原位置，
   两处调用都改用它。

### 已执行命令与结果

```
cd dsh-siyuan-notes && node --test
# tests 133 / pass 133 / fail 0
#   （原有 113 + 新增 test/autosave-stability.test.mjs 20 条）

node tools/check-integrity.mjs
# ok client.js parses / ok index.js parses / ok host-utils.js parses
# SNAPSHOT 刷新：isTypingInput 3→4、suppressTypingCount 5→7（本轮新增的引用与注释）；
#   typingRate 6→5 是陈旧快照：§4.18 那轮把 `typingRate > 0 ? span : null` 改成无条件渲染，
#   删掉了一个 `typingRate` 却没刷新 SNAPSHOT（test/typing.test.mjs 里明确断言旧写法必须消失，可交叉验证）
```

新增的 20 条测试覆盖：第一段 / 空行段落 / 标题之后补缩进；已有段落、软换行续行、结构行、围栏内、
前导空格的否定用例；开关关闭；光标偏移；`autoIndentTextarea` 对活 textarea 的写入与返回值；
`typingIndentPlan` 的四类事件门（普通输入 / IME 提交算，composing、粘贴、撤销不算）；
`caretAfterIndent` 的往返映射；
**保存后缓冲区不被回读覆盖**（真实 `EditorPane` + 脚本化 client，断言 `text` 与 `savedText` 都等于带尾部空行的原缓冲区）；
**保存进行中继续打字不被吞掉**（在验证读取的瞬间 `onChange` 进来，断言 `text` 是新文本、`savedText` 是旧快照、仍是未保存）；
手动保存仍提示、自动保存静默；以及「提示条是浮层」「label 定宽」「开关不再把光标归零」等源码断言。

### 未验证（不当作已验证）

- **浏览器里的真实观感没有截图或点击验证**（本机 DSH Web 需要启动令牌，按规则不去取）。
  浮层是否压住状态栏、中文候选落字后再补缩进的观感、保存时工具栏是否真的不再换行，都需要你打开面板看一眼。
- **输入法路径**（`compositionstart` → `compositionend` → `setTimeout(0)`）只有单元级与源码级断言，没有真机中文输入法实测。
- **撤销粒度**：自动补的缩进是一次独立的 `execCommand`，Ctrl+Z 可能先是「撤销缩进」再「撤销那个字」两步（文字不会丢）。
- **粘贴进空文档的第一段**不会自动缩进（`inputType` 不属于 typing），可用「补齐全篇」补。

### 登记为残留（本轮不改，等你决定要不要改）

1. `doc.error` 的错误条与「另一个面板保存了这篇文档」的 staleBar 仍是占位行：保存失败 / 他栏保存时编辑器仍会下移约 28px。
   取舍是错误状态需要持续可见、不该浮在正文上；staleBar 还带「重载」按钮，浮层（`pointer-events:none`）反而点不到。
2. 「补齐全篇（n 段）」按钮按需出现/消失，它的宽度与行数会影响工具栏换行，点它时工具栏可能变高或变矮一行。
   （粘贴进空文档不触发自动缩进 → 这个按钮更容易出现，但它是用户主动点击后的一次布局变化，不是保存时的跳动。）
3. **校验失败会重复提示**：不再采用回读文本后，内核真的改写过的块（见「已知限制」里块内含空行那种）
   每次保存都会判 mismatch，于是每次打字停顿都弹一次 warn 浮层。浮层已不占布局，只是提示会闪；
   若你觉得吵，可以按 docId+文本去重或降级到状态栏。
4. 点「首行缩进」开关 / 「补齐全篇」仍是**一次性全文档重写**（一次 `execCommand`）：文字与光标位置都保住了，
   但撤销粒度是「整篇缩进」一步，不是逐段。

## 4.20 图片支持（第十八轮需求）的验证

需求：在面板里**插入图片**（工具栏按钮 / 粘贴截图 / 拖拽文件三个入口）、上传到思源资源库、
预览里把 `assets/…` 渲染成**真图**（含 `{: style="width: …"}` 的宽度）、加载失败有明确降级；
安全边界：token 只留宿主、资源路径白名单防穿越。

实现范围（P0）：宿主两条路由（`POST /siyuan/asset/upload`、`GET /siyuan/asset`）+ 前端三入口 +
预览渲染。**P1（编辑区图片原位卡片）不在本节，见 §4.21。**

### 4.20.1 结论

| 项 | 状态 | 证据 |
|---|---|---|
| 单元测试 | ✅ **338 / 338 pass，0 fail，0 skipped**（基线 258，本轮 +80） | `node --test`（本轮全部为离线用例，不依赖运行中的 DSH） |
| 真机上传→插入→读回 | ✅ 40 项断言全通过 | `scripts/e2e-image.mjs`（真内核 3.8.3，`E2E-IMAGE: OK`） |
| 经宿主代理取图 | ✅ `image/png` 且**逐字节一致** | 同上；另用真实用户图片（中文名，52 328 B）复核：代理与内核直连字节完全相同，ETag 命中回 304、不命中回 200 |
| 保存链路零误写回归 | ✅ 22 PASS | `scripts/e2e-save.mjs`：`E2E: OK` |
| 安全边界 | ✅ 逐条通过（见 4.20.5） | 单测 + 真机 |
| 渲染健壮性 | ✅ 44 形态用例 + 变异测试（见 4.20.4） | `test/editor-shapes.test.mjs` |
| 活体 DSH 最后一跳 | ✅ **已验（2026-11-09，用户重启后）** | `node scripts/e2e-image.mjs` 自动选 **A) 运行中的 DSH（活体路由）**，43 项断言全通过；原始输出见 4.20.2 |

### 4.20.2 执行的命令与原始输出

```bash
cd dsh-siyuan-notes && node --test          # 338 tests / 338 pass / 0 fail / 0 skipped
node scripts/e2e-image.mjs                  # E2E-IMAGE: OK（40 PASS / 0 FAIL）
node scripts/e2e-save.mjs                   # E2E: OK（22 PASS）
```

`e2e-image.mjs` 的真机输出片段（载体说明见下）：

```
  载体   B) 本地临时载体（真实路由代码 + 真内核）—— 原因：运行中的 DSH 还没有 /siyuan/asset 路由（宿主半边需要重启应用）
  PASS 拿到 assets/ 下的资源路径
  资源路径 assets/E2E-图片-1794143083172-20261108210444-akwamty.png（源图 813 B）
  PASS 经载体上传路由（浏览器形状、不带 token）拿到 code 0
  PASS 经载体上传、文件名带空格的第二张图也能取回且字节一致（assets/E2E-二图 空格-…-yeycazh.png）
  PASS 33MB 上传被 413 body_too_large 拒绝
  PASS 非 multipart 上传被 400 invalid_content_type 拒绝
  PASS 读回的 kramdown 与写入完全一致
  PASS 代理回来的 Content-Type 是 image/* ｜ 字节数与源文件一致 ｜ 逐字节相同
  PASS 代理响应带 X-Content-Type-Options: nosniff ｜ 光栅图不带 CSP
  PASS SVG 资源被放行且类型正确 ｜ SVG 带沙箱 CSP ｜ SVG 的 CSP 没有放开脚本执行
  PASS 带 If-None-Match 再取一次回 304 ｜ 304 不带 body
  PASS 路径穿越被 400 拒绝 ｜ 畸形百分号编码被 400（不是 500）｜ 缺失资源回 404 asset_not_found
  直连内核（不带 token）: HTTP 401 application/json; charset=utf-8 41 B
  清理（全部 PASS）：删块 / 文档里已看不到这张图 / 删文档 / 删两个资源文件并复核再取不到
  兜底清扫（全部 PASS）：资源目录无残留；无遗留临时文档
```

**关于载体**：宿主半边（`lib/index.js`）改了必须重启 DSH 应用才生效，而重启是用户操作。
所以第一轮验收时用的是「**同一份 `createSiYuanRoutes({config}).handler` 代码 + 真内核**」的临时 http
server（只监听 127.0.0.1 随机端口，跑完即关），两路跑的是**同一个 handler**，差别只在 carrier 的
最后一跳。脚本会自动探测：活体 DSH 有该路由就用 A) live，否则打印原因并退回 B)。

**活体最后一跳（2026-11-09，用户重启后补验）**：重启后 Web 端口从 57907 变成 49576，脚本改成
优先读 harness 注入的 `DSH_WEB_URL`（端口写死踩过一次坑），复跑即自动切到 live：

```
# 真机图片 E2E
  内核   http://127.0.0.1:6806
  DSH    http://127.0.0.1:49576
  载体   A) 运行中的 DSH（活体路由）
  PASS 经载体上传路由（浏览器形状、不带 token）拿到 code 0
  PASS 经载体上传、文件名带空格的第二张图也能取回且字节一致（assets/E2E-二图 空格-…-3dxqkni.png）
  PASS 33MB 上传被 413 body_too_large 拒绝 ｜ 非 multipart 上传被 400 invalid_content_type 拒绝
  PASS 读回的 kramdown 与写入完全一致 ｜ 插件自己的块解析器看到的就是那一个图片块
  PASS 代理返回 200 ｜ Content-Type 是 image/* ｜ 字节数与源文件一致 ｜ 逐字节相同
  PASS 代理响应头/响应体里都没有 token 明文
  PASS 代理响应带 X-Content-Type-Options: nosniff ｜ 光栅图不带 CSP
  PASS SVG 资源被放行且类型正确 ｜ SVG 带沙箱 CSP ｜ SVG 的 CSP 没有放开脚本执行 ｜ SVG 也带 nosniff
  PASS 代理给了 ETag ｜ 带 If-None-Match 再取一次回 304 ｜ 304 不带 body
  PASS 路径穿越被 400 拒绝 ｜ 畸形百分号编码被 400（不是 500）｜ 缺失资源回 404 asset_not_found
  直连内核（不带 token）: HTTP 401 application/json; charset=utf-8 41 B
  清理（全部 PASS）｜ 兜底清扫（全部 PASS）
E2E-IMAGE: OK
```

同一轮另跑的零误写回归：`node scripts/e2e-save.mjs` → `E2E: OK`（22 PASS）。

### 4.20.3 A｜行为等价：P0 的断言 × P1 的实现（错配组合）

P1 改动 `lib/client.js` 前，本轮的 P0 基线**没有落 `lib/` 的快照**（方法论失误，已知）。
因此改用「**P0 版本的测试 + P1 版本的实现**」这个错配组合当硬证据：它红了就是行为不等价，
无法用"我更新了测试"糊过去。冻结的是 10 个受 P1 影响的测试文件的 P0 逐字节副本（库外）。

结果：**105 tests / 102 pass / 3 fail**，3 条红的**恰好**是集成方声明过的 3 处源码断言更新：

| 红掉的用例 | 文件 | 原因 | 判定 |
|---|---|---|---|
| `source: the indent switch and the sweep keep the caret` | autosave-stability | 旧断言查字面子串 `start: 0, end: 0`，而 P1 给空文档造的那一段里合法地含 `start: 0, end: 0`（是段位置，不是光标） | 可接受；覆盖面在"非字面量 return 的对象"这一形态上变窄，建议后续补一条**行为**断言（驱动缩进开关后断光标位置）替代源码断言 |
| `source: the typing listeners also wait for the document to finish loading` | typing | 旧断言查一个**已不存在**的 effect deps 表 | 等价或更强：新断言改查"节点挂载即挂监听 + 先解绑旧监听 + ref 回调按段缓存"，并反向断言旧 deps 表与 `textareaRef` 都不在 |
| `source: the typing listeners follow the view mode` | typing | 同上 | 同上 |

另外核对（**防漏报**）：10 个文件里 **8 个零改动**（`editor-actions` / `editor-ux` / `first-indent` /
`indent` / `layout` / `layout-panel` / `panel-render` / `render`），改动只落在那 2 个文件的 3 处，
**与集成方自述一致，无漏报**。符号级核对：`textareaRef` 在整份 `lib/client.js` 里**已完全消失**
（没有残留读一个不存在的 ref）。

判定：**A 项通过**。P0 测试编码到的行为没有等价性回归；两处附带的是"源码代理断言的收窄/替换"，
不是行为变化。

### 4.20.4 B｜渲染健壮性（与 A 并列，缺一不可）

A 只能证明"P0 测试编码到的行为没坏"。本轮真实事故恰恰落在**没被编码**的形态上：P1 把
`resplitNow` 用在 `const` 声明之前（TDZ），于是 `node --test` 全绿、`node --check` 也过，
但文档里只要有一行"看起来像图片却还没收成卡片"的语法，`EditorPane` 一渲染就整体抛
`ReferenceError`，用户打开文档看到的是坏掉的面板。所以 B 项独立成立。

- `test/editor-shapes.test.mjs`：**44 条**。逐形态一条用例（红了直接点名是哪个形态）：纯文本／空文档／
  纯图片／卡片+正文／多图／列表项图片／行内图片与正文同段／围栏内图片（```、~~~、未闭合围栏）／
  表格内图片／引用块内图片／缩进图片行／CRLF／无尾换行／宽度 IAL／edit·split·preview 三视图；
  以及 22 个刁钻形态（空 alt／空路径、带 title、路径含空格与中文、未转义 `]`、写了一半的语法、
  空 alt 链接、两行图片紧挨、图片行下一行跟 IAL、tab 缩进、只有围栏、相邻多围栏、围栏内出现围栏、
  未闭合 `~~~`、只以 `\r` 结尾的行、开头 BOM、HTML 注释里的图片语法、HTML `<img>`、连续 60 张图、
  20 万字符单行、2000 处不成行的图片语法、CRLF+围栏混排）。
- 跨全形态不变式：`joinEditorSegments(splitEditorSegments(t)) === t` 逐字节相等。
- **变异测试（关键）**：把 `lib/client.js` 复制到库外，故意把 `const resplitNow` 的声明挪到使用之后
  （复现原始 bug 形态），再用同一份用例跑它 → `21 tests / 13 pass / 8 fail`，失败按形态点名
  （列表项图片、行内图片与正文同段、围栏 ``` 、围栏 ~~~ 、未闭合围栏、表格内图片、引用块内图片、
  "围栏里的图片语法不算图片"）；真实（已修）版本同一份文件 21/21 绿。
  **这一步证明的不是"测试绿了"，而是"测试抓得住这类 bug"。**
- P1 新增路径的补充检查（23 项，全通过）：插入图片后缓冲区里就是图片行、**重新渲染立刻是卡片**
  （不需要手动重排）；卡片四项操作（改说明 / 宽度三档 / 删除 / 显示源码）的文本后果仍自洽
  （`join(split(t)) === t`、图片行仍可解析、宽度只写合法值、删图后原文与渲染层同时少一张）。

### 4.20.5 安全边界（逐条）

| 项 | 结论 | 证据 |
|---|---|---|
| 目录穿越 `..` / `./` / `a/../../b` / `../../etc/passwd` / `assets\..\x` | ✅ 400 `invalid_asset_path`，且**不打内核**（fetch 调用数 0） | 单测 + 真机 |
| 百分号编码穿越 `%2e%2e`、双层 `%252e%252e`、`?path=assets%2F..%2Fx.png` | ✅ 400（先解码再判结构） | 单测 + 真机 |
| 非 `assets/` 前缀 / 绝对路径 / 协议 URL / `//evil` / `Assets/` / 缺 `?path=` | ✅ 400 | 单测 |
| 畸形编码 `%E0%A4%A`、`assets%2Fa%FF.png` | ✅ 400（不是 500，也不是宽容解码后放行） | 单测 + 真机 |
| 控制字符 / `?` `#` `:` / 长度 >2048 | ✅ 400（=2048 放行） | 单测 |
| 超限 | ✅ 32 MB+1 → 413 `body_too_large`（不打内核）；真机 33 MB → 413 | 单测 + 真机 |
| 非 multipart（json / text / 无 boundary / 缺头） | ✅ 400 `invalid_content_type`，不打内核 | 单测 + 真机 |
| 上游返回 HTML | ✅ 上传分支 `bad_upstream_response` 且 message 已去标签；取图分支任何非 `image/*` 一律 404，**绝不把内核首页当图回** | 单测 + 真机 |
| 上游 401/403 / 其它非 2xx / 网络不可达 | ✅ 分别 404 `asset_forbidden` / 404 `asset_not_found` / 200 `upstream_unreachable` | 单测 |
| token 泄漏 | ✅ `/siyuan/state`、`/siyuan/asset` 的**响应体与响应头**都不出现 token 明文；代理 URL 无 token；`Set-Cookie` 不转发 | 单测 + 真机 |
| SVG（可执行文档类型） | ✅ 加固：所有代理响应（200 与 304）带 `X-Content-Type-Options: nosniff`；`image/svg+xml` 额外带 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`；光栅图**不**带 CSP | 单测 + 真机（svg 的 200/304 都验证过） |
| 文档内容不可信（作者手写穿越路径） | ✅ 客户端渲染出的 URL 交给宿主白名单仍被拒（跨半边联测） | 单测 |

补充说明：`assets/` 目录里除了图片还有内核自带的 `.svg`（14）/`.js`（2）/`.json`（72）。
`.js`/`.json` 被 `image/*` 闸门正确挡掉（404）；`.svg` 放行但已沙箱化（理由：用户可能真的想插矢量图）。

### 4.20.6 两条事实订正（此前文档写错，别再复述旧说法）

1. **不带 token 直连 `/assets/<name>` 不是"200 + HTML 首页"**，三种请求头三种结果：
   裸 `curl` → `401 application/json`（`{"code":-1,"msg":"Auth failed [session]"}`，41 B）；
   浏览器式头 → `302 → /check-auth`；跟随那次 302 → `200 text/html`（54 KB SPA 首页）。
   「必须经宿主代理」的结论不变（401 一样拿不到图），但**理由要按三形态写**。
2. **内核不给 `/assets/*` 发 ETag / Cache-Control**（只给 Last-Modified）。所以宿主的
   `ETag` 是"上游优先，没有就按内容自算弱校验值（`W/"<len-hex>-<sha1前16>"`）"，再由宿主
   自己比对 `If-None-Match` 回 304 —— 内核不做条件请求。

### 4.20.7 未覆盖（明确说明，不当作已验证）

- **活体 DSH 的最后一跳**：✅ **已补验（2026-11-09 用户重启后）**，见 4.20.2 末尾的 live 输出
  （载体自动选中 A) 运行中的 DSH，43 项断言全通过；同一轮 `e2e-save.mjs` 零误写回归通过）。
  仍需注意：**宿主半边（`lib/index.js`）每次改动都要重启应用才生效**，这是后续轮次复发的坑。
- **浏览器里的真实交互**：工具栏按钮的"上传中"置忙态、粘贴截图、拖拽文件、破图降级
  （`data-broken` + "图未找到"占位）的**视觉**效果 —— 单测里 React 是 stub，只有代码层与组件树断言。
- **滚动同步观感**、**输入法（IME）**、**跨段撤销**（P1 已确认降级为"段内撤销"）。
- **CSP 对 `<img>` 的实际影响**：`Content-Security-Policy: sandbox` 会不会影响 SVG 作为图片的渲染，
  只有浏览器能拍板（理论上 CSP 是文档级策略、不作用于图片子资源）。
- **静态检查的强度边界**：对 `const/let` 的"首次代码引用 vs 声明行"做粗筛（32 条命中全是噪音：
  CSS 类名、对象字面量键、函数参数、字符串里的 API 路径；两处像"真读"的都在 `useCallback` 内部，
  是合法的延迟求值）。**这个粗筛只能证伪**——没命中不等于绝对安全；真正的防线是
  4.20.4 的形态用例 + 变异测试。

### 4.20.8 一条测试隔离的结论（附带查清的偶发失败）

有报告称 `layout` round-trip 用例（`host: GET and POST /siyuan/layout round-trip through a real file`）
偶发失败，怀疑是"并行写同一 profile 文件"。查证结论：**不是隔离缺失，也没有污染用户 profile**——

- `test/layout.test.mjs:117-121` 用 `os.tmpdir()` 下的**独立临时目录**，并在 `finally` 里还原
  `DSH_SIYUAN_NOTES_HOME`；`test/layout-panel.test.mjs` 完全不碰文件；`host.test.mjs` 里所有会写
  profile 的用例（backup / config / 图片两条路由）都各自隔离到临时目录。
- 用 mtime+长度指纹核对用户真实 profile（`%USERPROFILE%\.dsh\siyuan-notes*.json`）：跑了十余轮全量
  之后指纹**逐字节未变**，即测试从不写用户目录。
- 复现尝试：layout 两个文件连跑 10 轮 + **两轮全量并发**，0 失败。
- 因此那条偶发失败**未能复现**，也没有证据支持"污染用户 profile"；若再次出现，请连同当时的
  完整输出与环境（是否并发跑了两份 `node --test`）一起记录再判。

## 4.21 编辑区图片原位卡片（P1）的验证

需求（承接 §4.20）：编辑区里**图片原位可见**。

技术事实（决定了实现路线）：编辑区原本是"整篇一个 `textarea`"，而 `textarea` 的某一行无法单独变成一张图
（常见的"镜像层 + 文字透明化"方案会让从图片行往下的**全文错位**，因为镜像层画出的图片高度与 textarea 的行高
不一致）。因此路线 A 只能把编辑区改成「**文本段 textarea + 图片卡片**」。这个改造的代价是
`Ctrl+Z` 从"全篇撤销"降级为"当前段内撤销"——**用户已知情并确认接受**（浏览器原生撤销栈的作用域就是单个
textarea，要保住全篇撤销得自研快照栈，列为后续专项）。

实现范围：`lib/client.js`（分段纯函数 / 分段渲染 / 既有机制接活动段 / 卡片操作 / 插入链路打通）。

### 4.21.1 结论

| 项 | 状态 | 证据 |
|---|---|---|
| 单元测试 | ✅ **338 / 338 pass，0 fail，0 skipped**（P0 收尾 289 → 本轮 338，+49） | `node --test` |
| 分段不变式 | ✅ `joinEditorSegments(splitEditorSegments(t)) === t` **逐字节**成立，覆盖 38 种形态（CRLF、无尾换行、BOM、只以 `\r` 结尾、20 万字符单行、60 张图…） | `test/editor-shapes.test.mjs` + 纯函数用例 |
| 渲染健壮性 | ✅ 44 条形态用例 44/44，逐形态一条（红了直接点名是哪种文档） | 同上 |
| 插入即见卡片 | ✅ 选文件 / 粘贴 / 拖拽三入口都走同一条路径；插入后**立刻**是卡片，光标落回卡片下方的文本段 | 集成方骨架 + 验证方 23 项检查 |
| 既有行为等价 | ✅ 9 条逐条判定：8 条等价、1 条（滚动同步）是按设计变更 | §4.20.3 的 D1–D9 |
| 必崩 bug（TDZ） | ✅ 已修，并有变异测试守住 | §4.20.4 |
| 浏览器里的真实手感 | ⏳ **未验**（见 4.21.5） | — |

### 4.21.2 分步数字与三个真 bug

实施分步的测试数字（每步都 `node --check` + 全量 + 形态冒烟）：

| 阶段 | `node --test` |
|---|---|
| P0 收尾（起点） | 289 pass / 0 fail（口径：P0 完成时，已含验证方当时新增的图片用例；P0 **之前**的原始基线是 258，见 §4.20.1） |
| (1) 分段纯函数 + 不变式 | 291 pass / 0 fail |
| (2)(3)(4) 一次落地（分段渲染 + 机制接活动段 + 卡片操作 + 插入打通） | 中间态曾 278 / 16 → 修完 294 pass / 0 fail |
| (5) 全量回归（最终） | **338 pass / 0 fail** |

> (2)(3)(4) 一次落地是刻意的：三者是同一套接线，拆开会让编辑区整体不可用（等于把用户留在"半截代码"上）。
> 中间态那 16 条红的根因是集成方自己的一次外科编辑失误（`commitSegment` 形参写错导致段内提交整段失效），
> 已修；另 2 条是已声明的旧源码断言（见 §4.20.3）。

本轮抓到的**三个真 bug，全部不是测试抓到的**：

1. **`const resplitNow` 的 TDZ**（渲染函数体内"用在前、声明在后"）：文档里只要有一行"像图片却还没收成卡片"的
   语法（围栏代码里的 `![](...)`、行内与正文同段、列表项里），`EditorPane` 一渲染就整体抛
   `ReferenceError`，用户打开文档看到的是坏掉的面板；而当时 `node --test` 全绿、`node --check` 也过。
   修复：把整组图片卡片 helper 整体上移到 `formatBar` 构造之前（**系统性修法**，不是把 `onClick` 改成
   箭头函数绕过），并用一次性审计脚本对 `EditorPane` 内 53 个关键标识符逐个比对"首次**代码引用**行 vs 声明行"。
2. **插入后不重切分**：点图片按钮/粘截图后只看到 `![…](…)` 源码行，还要再点一次"收成卡片"才看到图。
   修复：`insertBlock` 在插入后判断"插的是不是图片行"，是就 `resplit` 并把光标定位到新卡片之后的文本段。
3. **文本段起始行号取错**：收文本段时传的是"收段那一刻的行号"而非"该段起始行号"，导致光标上报的行号与
   大纲跳转整体偏移（图片在前的文档尤其明显）。修复并加锁：`segments.map(s => s.line)` 必须等于各段首行。

### 4.21.3 两条实现约定（避免"抖动"与"打断写作"）

- **打字绝不重切分**：`segments` 只在四个时机重算（文档打开 / 程序化插入图片后 / 卡片操作后 / 手动"重排"），
  文本段里打字只做**段内增量平移**（`withSegmentText`，只改该段文本并平移后续段边界）。
  否则键入 `![](` 的瞬间该行会跳成卡片、光标被吃掉。
- **"保存成功后重算"落地为"缓冲区真的变了才重算"**：没有在 `save()` 里无条件 `resplit`，而是保存后照常渲染、
  渲染期比对 `doc.text` 与记账文本，只有缓冲区**真的被改写**（读回采用 / 整篇覆盖回退 / 另一栏覆盖）才重切分。
  理由：无条件重切分会重建段节点，等于每次 2.2 秒自动保存都打断光标与输入法，回归 `autosave-stability`
  当初修掉的老坑。该偏离经 lead 审定为**行为等价**（更保守）。

### 4.21.4 坐标换算（P1 最容易出错的地方）

分段之后，`applyEdit` 对外仍是**整篇坐标**（段内偏移 + 段起点），内部再分流：

| 位置 | 做法 |
|---|---|
| `applyEdit` | 段内改动 → `replaceRange(段内相对坐标)` 保住原生（段内）撤销；跨段 → 整篇替换 + resplit + `pendingCaretRef` |
| `handleEnterKey` 的 `inFence` | 用"段前文本 + 段内前缀"算围栏状态（修掉跨段围栏误判） |
| `indentSelection` / `pairKey` | 全部用整篇坐标算行/列/配对，结果再交回 `applyEdit` 分流 |
| `reportCaret` | 行号 = 段起始行号 + 段内行号；总行数按 `doc.text` |
| 大纲跳转 / 查找 | 整篇行/偏移 → 段 → `nearestTextSegment`（图片行放不了光标，滑到相邻文本段）+ 双向 clamp |
| 滚动同步 | 改为按预览的 `data-line` 锚点；**锚点缺失时退回原比例算法**（防回环保留） |

逐条等价性判定见 §4.20.3 的 D1–D9（由验证方读代码判定，不是照抄实现者清单）。

### 4.21.5 未覆盖（不当作已验证）

- **浏览器里的真实手感**：卡片外观、粘贴/拖拽的视觉反馈、"上传中"置忙态、滚动同步**观感**、
  输入法（IME）在段边界的行为、跨段撤销的实际体验。
- **卡片三档宽度的视觉观感**：尤其超长竖图在 `max-height:260px` 下的呈现。
- **真实文档的"第 45 种形态"**：已有 44 种形态用例在守，但真实文档总有新组合；出现时用
  `.tmp-client-image-segmented.mjs` 的 `open(text)` 复现（把出问题那篇的正文喂进去）。

### 4.21.6 已知限制（已写入 README「已知限制」）

跨段撤销失效；「重排卡片」是手写图片语法后收卡片的唯一入口；卡片不支持自由缩放与拖动排序；
删除图片不回收 `assets/` 文件；只上传到工作空间根 `assets/`；编辑区滚动从"整篇一次"变成"容器滚动 + 段内自适应高度"。

## 4.22 P2（AI 插图工具 + 外部变更闸门）的验证

需求：① 让模型能把图片写进思源文档（`siyuan_note_insert_image`，tool 契约见 §10/§10.1）；
② 在这之前必须先有"外部变更闸门"，否则 AI 插进去的图会在面板下次保存时被当成多余块删掉（§11）。

分工：**P2a 外部变更闸门**由 client-image 实现（`lib/client.js` + `test/external-change.test.mjs`）；
**P2b 插图工具**由 lead 实现（`lib/index.js`）。本节是第三方（host-verify）的测试与独立验证。

### 4.22.1 结论

| 项 | 状态 | 证据 |
|---|---|---|
| 工具单测 | ✅ **37 / 37 pass** | `node --test test/insert-image-tool.test.mjs` |
| 全量单测 | ✅ **394 / 394 pass，0 fail，5.7 s** | `node --test`（本轮从 383 → 394；lead 独立复跑一致） |
| 外部变更闸门（P2a） | ✅ **13 条行为用例** + **7 条独立边界用例** + 3 项实现等价性复核 | `test/external-change.test.mjs` + `test/external-change-boundary.test.mjs`（见 4.22.4） |
| 修订 A（读失败时的写路径） | ✅ 独立复核通过，**"无基线必须拒绝写"已验**（用例 + 结构核对双重支撑） | 见 4.22.4「修订 A」小节 |
| 工具真机 E2E | ✅ **43 项断言 / 0 FAIL** | `node scripts/e2e-image-tool.mjs`（真内核，全链路 + finally 清理） |
| 闭环（AI 插图 → 闸门认出） | ✅ 真机数据上验证 | 同一 E2E 的"闸门认出「AI 插了图」"组 |
| 浏览器里的真实观感 | ⏳ 未覆盖（见 4.22.7） | — |

### 4.22.2 执行的命令与原始输出

```bash
cd dsh-siyuan-notes
node --test test/insert-image-tool.test.mjs         # 37 tests / 37 pass / 0 fail
node --test test/external-change.test.mjs           # 13 tests / 13 pass / 0 fail
node --test test/external-change-boundary.test.mjs  # 7 tests / 7 pass / 0 fail
node --test                                         # 394 tests / 394 pass / 0 fail / 5.7 s
node scripts/e2e-image-tool.mjs                     # E2E-IMAGE-TOOL: OK（43 PASS / 0 FAIL）
```

`e2e-image-tool.mjs` 的真机输出片段：

```
# P2b 真机 E2E：siyuan_note_insert_image
  内核 http://127.0.0.1:6806 / 笔记本 20251122094407-b4g4hhb4hhx
  PASS 插件在 ctx.get('tools') 上注册了插图工具 ｜ PASS 工具总数 7 ｜ PASS 插件注册了 /siyuan 路由
  PASS 临时文档有 3 个块 ｜ PASS 上报面板当前文档
  PASS 工具返回成功（doc 缺省 = 面板当前文档）｜ PASS 返回的 markdown 形态正确 ｜ PASS 返回了新块 id
  PASS 写前快照落在隔离目录里 ｜ PASS 快照内容是**插入之前**的整篇 kramdown
  PASS 图片块正好在锚点块**之后** ｜ PASS 读回的图片行与工具返回的 markdown 完全一致 ｜ PASS 文档从 3 个块变成 4 个块
  PASS asset kind 复用成功 ｜ PASS 整轮只多出 1 个资源文件（asset kind 没有重复上传）
  PASS 不给 after 时追加到末尾 ｜ PASS 末尾确实是新插的图片块
  PASS 文本锚点不存在 → anchor_not_found ｜ PASS asset 穿越被拒 → invalid_asset_path ｜ PASS hpath 不存在 → doc_not_found
  PASS 错误路径一条都没写进文档
  PASS 闸门认出「AI 插了图」：磁盘与面板缓冲区不一致 → 会弹提示而不是静默覆盖
  PASS 同一个磁盘内容当缓冲区 → 判定为「没变」（不误报）
  PASS 只多尾随空行不算外部改动（内核没有这个块）
  PASS 没有保存基线（新草稿）时不参与判定
  PASS 磁盘是空的、缓冲区有内容 → 视为有差异（有基线时）
  清理（5 项全 PASS）｜ 兜底清扫（2 项全 PASS）
E2E-IMAGE-TOOL: OK
```

`e2e-image-tool.mjs` 刻意**走真实注册路径**（假 Cordis ctx + 真 `apply()`，从 `tools.register` 里取工具），
而不是直接 `createImageInsertTool()` —— 这样连"工具到底有没有注册进 `ctx.get("tools")`"也一起验了。
依赖隔离：`DSH_SIYUAN_NOTES_HOME` 指向脚本自己的临时目录，所以**设置文件与写前快照都不落进用户的
`~/.dsh/siyuan-backups`**；内核侧的资源/文档在 `finally` 里删净并复核。

### 4.22.3 A｜工具单测（37 条）覆盖什么

- **纯函数**：`imageFileParts`（大小写归一、无扩展名、`..`/空返回 null）、`imageAltFromFileName`（去扩展名、`]`→`\]`、换行折空格、截断 200）、`normalizeImageWidth`（数字→`px`、`100%` 保留、`10rem`/`calc()`/`-10px`/`0` 一律拒）、`imageMarkdown`（宽度串**带分号**）、`insertedBlockId`、`assetPathFromUpload`（`succMap` 优先、退化 `succFiles`）。
- **参数与边界**（都断言"不碰内核"）：`source` 非对象 / kind 不认 / value 空 → `invalid_source`；`width` 非法 → `invalid_width` 且在**任何内核调用之前**返回。
- **取图**：`asset` kind 走白名单且 **0 次上传**；穿越与非 `assets/` 前缀被拒；`path` kind 的扩展名白名单（`.exe`/`.txt` 拒）、空文件、超 20 MB、读不到分别给出 `unsupported_image` / `file_not_found` / `image_too_large`，且**都不上传不写**；上传成功从 `succMap` 取路径；上传丢路径 → `upload_failed` 且 0 次写。
- **文档与锚点**：`doc` 缺省读 `editorContext()`，**没有打开的文档 → `no_open_document`**（不 fallback 到"最后一篇"）；hpath 零命中/多命中 → `doc_not_found`/`ambiguous_doc`；`after` 是块 id → `insertBlock{previousID}`；**不给 `after` → `appendBlock{parentID}`**。
- **正文锚点（本轮契约变更后的重点）**：`locateAnchorInKramdown` 的六条语义逐条测（块内多行命中同一 id 不算歧义、命中不同 id 才 `ambiguous_anchor`、IAL 行不算内容、**空行视为块结束**、缩进 IAL 也认、文本不在文档 → `anchor_not_found`）；并且断言**整条正文锚点路径 0 次 SQL 调用**，SQL 只在"按 hpath 解析文档"时出现。
- **写前快照**：成功路径断言 `backup` 收到的是**整篇 kramdown** 且早于写入；**快照失败 → `backup_failed` 且一次写都没有**。
- **返回与错误结构**：成功返回含 `docId/blockId/assetPath/markdown/summary` 且**不带 undefined**（DSH 的无损 JSON 检查会拒）；所有失败都是 `{ok:false,error:{code,message}}` 且 message 是中文。
- **模型可见的定义**：`parameters` 只要求 `source`、`additionalProperties:false`、`kind` 枚举收紧、`width` 故意不写 type（数字或字符串都收）、`output.render` 输出无损 JSON。

> 为什么正文锚点必须不查 SQL（lead 实测，值得留档）：`blocks` 表的索引**异步**写入，延迟与库大小强相关 ——
> 同一台内核，小库（"AI 记忆体"）新建文档约 **0.4 s** 可查，**用户的大库约 3.5 s**；而 `getBlockKramdown`
> **立即可读**。早期实现按 SQL 找锚点，表现为"刚建好的文档插不进图"；改成在已读到的 kramdown 里定位后
> 该问题消失（测试用"0 次 SQL 调用"把这条性质钉住）。

### 4.22.4 B｜P2a 对抗复核（`test/external-change.test.mjs` 13 条 + 独立边界 7 条）

**结论：通过，是本轮质量最高的一份测试。**
- **真行为断言**：唯一的 `readFileSync(SRC)` 只用于装载 bundle；断言全部落在"写入调用记录 / 渲染树文本 / 假内核读数 / 缓冲区内容"上，**没有源码字符串糊弄**。`makeKernel` 是**真会改块表**的假内核，`render()` 还按 deps 模拟了 effect 重跑。
- **五项必查逐条成立**：外部改动 → `assert.deepEqual(writes().all, [])`；点「仍要保存（覆盖）」**之后才**写（并断言写的是缓冲区内容、按覆盖语义删掉外部块、保存点更新）；读失败 → 不报成外部改动、**也不静默写**，给「无法确认」+ 重试 + 跳过检测；**冲突期间自动保存真的停了**（真实等 2.4 s 两轮、`kernel.reads` 停在 1、0 写入；处理后恢复）；冲突期不动缓冲区、重读走既有 `onReload`、草稿不检测。
- **「跳过检测只生效一次」**（本轮补上）：点跳过 → 写一次 → 外部又改 → **第二次保存一个字都不写且提示重新出现**。
- **三项实现等价性复核**（我独立核的）：
  1. **读失败从"继续往下写"改成"立即停手" —— 确认为真 bug 修复，且是本轮发现的第三处存量问题。** 证据是我保留的 P2a 之前那份 `client.js`（21:10:38）：`let original = []` + `catch { kramdown = "" }`（`original` 保持空）→ `planSync(original, next)`；而既有 P0 用例就断言 `planSync([], ["只有一段"]) === [{op:"insert",…}]`。也就是说，读失败时旧代码会把**整篇缓冲区当作新增块重复插一遍**。修复后默认"不写 + 提示重试"，只有用户点「跳过检测」且手上有上次已知块表时，才带着那份基线继续写并**留痕**（`changeSkipped` warn）。
  2. **自动保存的 `guard` 拦截不改变无告警时的行为**：实现是 `save()` 里的 `if (silent === true && guardRef.current !== null) return;` —— 无告警时条件为假，路径与旧版逐行相同；有告警时连读都不做（与用例断言"再来一个周期仍然只读 1 次"一致）。手动保存（`silent !== true`）仍然允许重试一次检测，这是**有意**的：用户可能刚在思源端收拾好。
  3. **覆盖路径以"刚读到的磁盘块"为基线**：`original = read.blocks`（当场读）→ 跳过不变检查 → `planSync(original, next)`，所以写的是"把磁盘改成我的缓冲区"的增量（外部独有的块 → delete，缓冲区独有的 → insert），不是"整篇推平重写"，与用例断言（`deleteBlock` 恰好 1 次、只改原块）一致。

**两处设计取舍的评估（我同意，各带一条边界说明）**：
1. **只有 `savedText` 非空（有基线）才检测**：接受。理由：没有基线就没有可比对象，强行判定会把"每一次新建草稿的首次保存"都拦下来，反而更糟。边界情形（"全新草稿在首次保存前被外部插入"）在**本期功能下不可达**：草稿还没有 docId 时，插图工具无处可插；一旦文档存在（能被外部改），面板也就有了读回基线。建议仍在 README 已知限制里点一句。
2. **读失败选择"不写 + 提示重试"**：同意。读不到就也拿不到备份（备份素材正是写前的 kramdown），盲写等于没有回滚材料；"确实要写"的出口给到了（`changeSkipCheck`，必须用户显式点，且留 warn 痕）。残留代价是：内核长时间读不到（例如笔记本被锁）时用户无法保存，需要走那个显式出口。

#### 修订 A：读失败时「仍要保存（跳过检测）」从"做不到的承诺"变成有条件可写

**起因**：原设计里"读失败 → 不写，给 [重试保存] [仍要保存（跳过检测）]"有一个做不到的承诺 ——
面板的写是**块级 diff**（`planSync(original, next)`），读失败时手里没有基线块表，那个"跳过检测"点下去
仍然回到「无法确认」，等于给用户一个按不动的按钮。更糟的是：真按下去若放行，`planSync([], next)`
会把整篇当新增、**重复插一遍**。

**修订后的语义**（`lib/client.js:2898-2920`，两处前提缺一不可）：

| 前提 | 结果 |
| --- | --- |
| 读失败 + 用户**没有**点跳过 | 不写，停在「无法确认」，给重试 |
| 读失败 + 用户**明确点了**跳过 + 面板**有**上次已知块表 | 带着那份基线写下去，并留 **warn 痕迹** `changeSkipped`（文案写明"无备份 + 按上次已知内容为基线"） |
| 读失败 + 用户点了跳过 + 面板**没有**已知块表 | **仍然拒绝写**（`planSync([], next)` 那条路结构上走不到，不是靠碰巧） |
| 任何**自动**路径 | 永远不会自己点"跳过检测"（有专门用例锁住） |

代码上是结构性的：`if (!skipCheck || known.length === 0) { update({saving:false}); setGuard({reason:"unverified"}); return; }`

**两个"仍要保存"是两件不同的事**（最容易实现错的地方，现已是两个独立的一次性标记）：

| 标记 | 触发条件 | 跳过的判定 | 基线 |
| --- | --- | --- | --- |
| `overwriteOnceRef` | 磁盘**读得出来**，只是被外部改过 | 仅"外部改动"这道判断 | 刚读到的**磁盘**块表（覆盖 = 以磁盘现状为基线合并本地编辑） |
| `skipCheckOnceRef` | 磁盘**读不出来** | "这次检测"本身 | 面板上次已知的 `doc.blocks`（**可能过期**） |

两者都只对紧接着的那一次保存有效、都只由用户点击设置、换文档时一起清；`save()` 里读取后**立即双双清零**。

**我的独立验证（`test/external-change-boundary.test.mjs`，7 条，我另写了一套 harness）**：
为什么不复用它的 harness：共用同一套装法等于"用它自己的尺子量它自己"，如果它的 harness 有偏差
（例如 `doc.blocks` 的构造方式），我照抄就一起错了。所以这份按 EditorPane 的 props 契约重新装了一遍，
用 `baseline: "none"` 直接构造"面板从没成功读到过这篇文档"的场景。

| # | 用例 | 断言 |
|---|---|---|
| 1 | **无已知块表 + 读失败 + 点跳过** | **0 次写内核**；停在「无法确认」；**不产生 `changeSkipped` 痕迹**（没写就不该留"写了"的痕） |
| 2 | 有已知块表 + 读失败 + 点跳过 | 恰好 1 次 `updateBlock`；基线 id 来自已知表（`b1`，不是空表）；1 条 warn 且带读失败原因 |
| 3 | 先点过「覆盖」、再遇到读失败 | **不会被自动放行**（一次覆盖 ≠ 读失败也能写的长期许可）→ 两个一次性标记互相独立 |
| 4 | 自动保存 + 读失败 | 0 写、浮出「无法确认」、**无 `changeSkipped` 痕迹**（自动路径不替用户做决定） |
| 5 | 跳过检测只生效一次 | ①没有新点击时再读失败 → 不写；②读数恢复但磁盘被外部改过 → 重新过闸、不写、提示重现 |
| 6 | 基线过期 | 遍历所有 `deleteBlock` 的 `payload.id`，**必须都在基线内**（外部新插的块永远删不掉） |
| 7 | i18n | `changeSkipped` 中英都有、中文提到"备份/基线"；两个「仍要保存」文案必须不同 |

**变异测试（证明这 7 条抓得住这两个分支，不是摆设）**：把 `lib/client.js` 复制到库外注入两个变异，用同一份用例跑：
- 变异 1：去掉 `known.length === 0` 前提（只留"用户点过"）→ **用例 1 红**（无基线时会写出去）
- 变异 2：`skipCheckOnceRef` 不再复位（一次点击 = 永久豁免）→ **用例 5 红**
两个变异各自只被对应的那条抓住，说明断言与性质是一一对应的。

**"无基线必须拒绝写"的判定：✅ 已验**（三重支撑）：① 用例 1（行为）；② lead 的结构核对
（`if (!skipCheck || known.length === 0)` 让 `planSync([], next)` 走不到）；③ 变异测试（去掉前提就红）。

**过期基线的安全性**（知情接受的风险，性质被用例钉住）：`deleteBlock` 只会针对基线里存在的 id，
外部新插的块不在基线里 → **这条路径永远删不掉外部块**；过期的 id 只会让 `updateBlock`/`insertBlock`
被内核拒绝 → 保存失败并报错（响亮地失败，可重试）。用例 6 逐条遍历 `deleteBlock` 的 id 来锁这个性质。

#### 修订 A 顺带修掉的三处真实问题（我复核确认成立）

1. **两个「仍要保存」原来共用一个标记**（`overwriteOnceRef`）。后果：点过「覆盖」之后，下一次**读失败**
   会被那个残留标记放行（或反之）。已拆成两个独立一次性标记，两个 handler 各自只置自己那个并把另一个清掉。
   用例 3 专门锁这条。
2. **校验轮读失败时白等 1.25 秒**。保存成功后有一次校验读（最多 6 次 × 250 ms，本是为"读到了但内核读模型
   还没收敛"设计的）。读失败是**另一类问题**，再等不会变好，只让用户"点了保存半天没反应"。
   修订：`catch { verify = null; verified = []; break; }`。**这条是我写边界用例时被逼出来的**——用例等不到
   收敛才发现。它属于真实体验 bug，不是测试问题。
3. **校验读失败不再清空面板块表**（`blocks: verify === null ? prev.blocks : verified`）—— 否则一次网络抖动
   就会把"跳过检测"这条兜底路径的唯一基线抹掉（fail-closed 太狠）。连带把 `autosave-stability` 那条锁整段
   对象字面量的源码断言改成**正则锁语义**（保存完成的 setState 里必须有 `savedText: current.text` +
   `saving: false`、不含 `text:`、含 `blocks:`），原有两条负向断言一条没删。

#### 复核方法说明：断言安全性质，而不是断言调用次数

本轮有两条断言值得作为方法留档（不是"0 次写"这种粗口径）：
- **用例 6**：不是断言"没写"，而是**逐个遍历 `writes().deleteBlock`，断言每次 `payload.id` 必须落在基线内** ——
  这直接锁住"外部新插的块永远不会被这条路径删掉"这个**安全性质**。次数对了但删错了块，粗口径抓不到。
- **用例 1**：除了"0 次写"，还断言**不产生 `changeSkipped` 痕迹** —— 锁的是"没写就不许留下'写了'的记录"，
  否则用户会在提示/日志里看到一件没发生的事。
一般化：**当被测行为的安全性依赖"对谁做了什么"时，断言参数集合，而不是调用次数。**

### 4.22.5 C｜真机 E2E 与闭环

`scripts/e2e-image-tool.mjs`（43 项断言）覆盖：真实注册路径（7 个工具 + `/siyuan` 路由）→ 建临时文档 →
经真实 `/siyuan/context` 路由上报"面板当前文档"→ **缺省 doc** 调工具 → 真图上传 + 插入 →
**读回断言图片块正好在锚点块之后、行内容与工具返回的 markdown 逐字一致** → 写前快照落在隔离目录且内容是插入前的整篇 →
`asset` kind 复用（资源目录只多 1 个文件）→ 不给 `after` 追加到末尾 → 三条真机错误路径且**一条都没写进文档** →
**闭环**：把真机读回的磁盘块喂给 `documentUnchanged`，断言"AI 插了图"会被闸门认出（false）、
同一内容当缓冲区不误报（true）、只多尾随空行不算改动（true）、无基线不判定（true）→
`finally` 删块 / 删文档 / `removeFile` / 兜底清扫。

### 4.22.6 未覆盖（明确说明，不当作已验证）

- **浏览器里的真实交互**：冲突提示条的外观与点击（「仍要保存（覆盖）」/「重新读取」/「仍要保存（跳过检测）」/「重试」）、
  工具插入后编辑区**立刻**出现卡片这一点的肉眼确认。逻辑由 13 条行为用例 + 7 条边界用例 + 组件树断言覆盖，
  但**没有真人点击**。
- **CSP 对 `<img>` 的实际影响**（含 SVG 文档）——仍只有浏览器能拍板（同 §4.20.7）。
- **大库（索引 ~3.5 s）下的实机复现**：工具已不依赖 SQL 索引，单测用"0 次 SQL"钉住了这条性质，
  但"超大库 + 刚建文档 + 立刻文本锚点"的实测是 lead 做的，本节没有独立复跑。
- **跨段撤销**仍降级为"段内撤销"（P1 的既定取舍，见 §4.21）。
- **读失败 + 跳过检测的过期基线**：只验到"永远不会删掉基线之外的块"（安全性质），
  没有验"内核实际拒绝过期 id 时的报错文案是否可读"（那需要造一个真实的 id 失效场景）。
- 工具不支持删除/覆盖/批量（设计边界，非缺口）。

### 4.22.7 留档：`node --test` 全量挂起的判别配方

本轮遇到过"全量跑 >4 分钟不结束、逐文件跑却都是秒级"。**判别方法：带 `--test-timeout=20000` 再跑一次**——
- 若它也挂 → 有测试在 `await` 一个永不 settle 的 promise；
- 若它 **5.5 s 就跑完**（本轮实测）→ 不是测试挂住，而是**子进程不退出**：某个文件留下了活着的句柄（本轮真凶是测试宿主里被替换后没恢复的全局定时器）。

定位到文件后，检查它是否 `mock.timers.enable(...)` / 起了 `setInterval` 却没在失败路径上恢复——
本轮就是这种情况，改成真实等待后消失。今后写"假时间"的用例，务必把恢复放进 `try/finally`。

## 5. 验证缺口（明确说明，不当作已验证）

- **视觉外观未截图确认**。DSH 的 Web 页需要进程启动令牌才能取到 `index.html`，
  按 DSH 的验证规则不应去搜这个令牌；页面实际长什么样、暗色主题下的对比度、
  侧栏图标在折叠态 18px 的观感，都需要你打开页面看一眼。
  已做的替代验证是：槽注册 active、506 个组件无异常执行、样式只用主题令牌。
- **面板内的交互路径**（点开文档、编辑、Ctrl+S、回车生成缩进段落、缩进按钮、拆分/关闭栏、
  标签切换、重命名/删除对话框）在浏览器里尚未点过；逻辑由 E2E + 面板模型测试 +
  渲染冒烟覆盖，但没有真人点击验证。
- 思源的**资源图片**：§4.20 起已经不再降级成占位标签 —— `assets/…` 经宿主 `/siyuan/asset`
  带 token 代理后渲染成真 `<img>`（含 IAL 宽度、破图降级）。仍未覆盖的只是**浏览器里的视觉确认**
  （见 §4.20.7）：预览里的实际排版、破图占位的外观、以及活体 DSH 重启后的最后一跳。

## 6. 回滚

```powershell
# 卸载：删掉 profile 补丁里的这一块，并去掉 package.json 里的 link 依赖
# 备份文件已就位：
#   C:\Users\demo\.dsh\profiles\desktop\cordis.patch.yml.bak-before-siyuan-notes
#   C:\Users\demo\.dsh\profiles\desktop\package.json.bak-before-siyuan-notes
#   C:\Users\demo\.dsh\profiles\desktop\pnpm-lock.yaml.bak-before-siyuan-notes
# 插件保存前快照：C:\Users\demo\.dsh\siyuan-backups\
```

## 7. 记忆体 v6 修正（2026-11-11）

依据 `.local/memory-v5-review-20261111/` 的三份实测（write-ux / recall-ux / prompt-panel）与 lead 的真实宿主复查，按 P0→P1→P2 完整实施。方案见 `notes/memory-2026-11-11-v6-plan.md`，契约与变更见 `notes/memory-2026-11-11-contract-v6.md`、`notes/memory-2026-11-11-v6-changes.md`。

### 7.1 改了什么

| 编号 | 问题（用户可感知） | 改法 |
|---|---|---|
| P0-1 | 被动召回取词取到 `time-context`（真实宿主每轮注入 4 条 role=user 消息），首轮静默、之后每步恒定 3 行无关内容 | 新增 `isHumanUserMessage`：排除 runtime-context / skill-catalog / time-context 与内容前缀兜底；recall / capture / opt-out 共用判定 |
| P0-2 | 召回失败提前写死 key，整轮静默；同一步三次求值会重复查询 | 成功才写 key、失败最多重试 3 次、`pending` 合并同 key 并发、`diagnostics().recall` 暴露 failures/lastError |
| P0-3 | `memory_search` 渲染无 id，而 `memory_read` 需要 id → 直连工具路径「查→读」断链 | 渲染行首补 id（含类型/项目/主题/状态），保留 80 字截断与「刚写入」；无 id 降级旧格式 |
| P0-4 | 子代理完成通知（`subagent-settled`）引用「Do not remember this」→ 整场会话静默停止记录 | 新增 `isDirectUserMessage`：opt-out 只认 `source.kind==='user'`，团队/子代理/注入消息一律不算 |
| P1-1 | 宿主不校验裸 register 工具的参数：`statement` 失败只报「正文不能为空」，`supersede` 拼错静默不取代 | 四个记忆工具统一 `rejectUnknownArgs`；`statement` 作 `text` 别名；`missing_text` 点名 |
| P1-2 | `inferred + supersedes` 候选升级后旧结论仍 active | `write()` 升级分支兑现 `proposedSupersedes`：validateTargets + checkStateConflict + 同一 promote 事务置旧条目 superseded |
| P1-3 | 面板「关闭记录」丢会话警告；state 候选一键确认必 400；旧候选 `invalid_project`；`refresh=1` 死参数 | recording 回包补 sessions；approve 路由按同主题自动取代；无工作区候选报 `workspace_required` 并由按钮开确认弹窗；删除死参数 |
| P2-1 | 召回用通用词误召回；最强匹配被 section 去重筛掉只剩第二梯队 | 池 12 → 去重 → 取 3；标识符 weight 3；通用词丢弃；项目/主题命中 +3；门槛「一个 weight≥2 或总分≥3」；纯指代不查询；召回行带状态/日期 |
| P2-2 | 注入前缀浪费（项目名/可信度重复），事实类 38 条只进 2 条 | 默认可信度 stated 省略标签；剩余预算 ≥60 字时截断收录末条；真实工作区 1486/1500、事实类 3 条 |
| P2-3 | 同项目多条 active state（主题漂移）不可见 | `checkup().topicDrift` 只报告不合并（真实库命中 1 组：dsh-siyuan-notes 4 个主题） |
| P3 | 文档/描述与实现不一致 | 契约 v6、README、变更记录、工具描述统一；`memoryContractVersion=6` |

改动 15 个文件（+1389 / −85）：`lib/{memory.js,memory-sessions.js,index.js,client.js}`、`README.md`、`test/host.test.mjs` 与 4 个旧断言文件、5 个新增 `test/memory-v6-*.test.mjs`（45 条用例）。

### 7.2 验证

- 全量 `node --test`：**576/576 通过，连续 3 次**（10.9–11.1 s/次；v5 基线 531）；重启后追加 1 条「陈旧召回行」回归，**577/577**。
- 真实思源 3.8.3 只读回归 **30/30 通过**：20/20 条说法取词=用户原话；v5 噪声签名 0 命中；注入 1486/1500 且无 `| stated`；searchRender 8/8 带 id，用渲染 id 读到 329 字正文；全程零内容写入（唯一拦截写是 memory_read 的引用计数记账）。
- 面板假内核 7/7：recording sessions、state 候选一键确认+自动取代、legacy 候选 `workspace_required`→补范围 200、普通候选 200、契约 6、无 `refresh=1`、写入口校验。
- 独立验证由 verifier 完成，报告 `.local/memory-v6-20261111/reports/verify.md`；各阶段报告在同目录 `p0-*.md / p1-*.md / p2-quality.md / p3-*.md`。

### 7.3 明确未验证（不当作已验证）

- **重启 DSH 后的真实会话行为**：Host 半边不热加载，本轮所有 live 验证都走只读 store / 假内核；运行中的宿主仍是 v5（`memoryContractVersion=5`）。
- **真实模型下的自动整理产出质量**：没有跑真实 distill，避免向真实库灌评测条记忆。
- **面板按钮的真实点击**：只有假 React + 假内核的组件树断言，没有浏览器里的真人点击。
- **召回语义仍是关键词匹配**：切题 top1 约 2/20；最强条已在常驻索引时整块不显示（P1-1 的 B 方案未实施）。

### 7.4 回退与生效

```powershell
# 回退：用改前快照覆盖
Copy-Item -Recurse -Force D:\work\cz\.local\memory-v6-20261111\before\lib   D:\work\cz\dsh-siyuan-notes\
Copy-Item -Recurse -Force D:\work\cz\.local\memory-v6-20261111\before\test   D:\work\cz\dsh-siyuan-notes\
# 生效：重启 DSH（Host 半边不热加载）；重启后 GET /siyuan/memory 应返回 memoryContractVersion=6
```


### 7.5 重启后真实复验（2026-11-11 13:00）

用户重启 DSH 后，在同一会话（sessionId 续跑）上确认：

- `GET /siyuan/memory` 返回 **`memoryContractVersion: 6`**；
- 常驻注入 1499/1500 字、四类标题各一次、结尾提示在、无 `| stated`；
- 召回行已是 v6 格式（带 id / 类型 / 项目 / 状态 / 日期），`diagnostics().recall` 为 `{lines,key,text,failures,lastError}`；
- 真实库 `search → searchRender → read` 链路走通：渲染行首 id 可直接读全文；
- `view=checkup` 返回 `topicDrift`（dsh-siyuan-notes 4 个主题）。

复验中发现并修复一个 P2：**新一轮第一步可能把上一轮的 `[相关记忆]` 带出来**（宿主消息尚未带入新发言时，`refreshRecall` 按旧 key 提前返回）。修法是记录召回对应的原文，`hint()` 只在最后一条真人发言与之一致时显示；新增 1 条回归，全量 **577/577**。该改动在 Host 半边，需再重启一次生效。

## 8. 记忆体 v7 优化（2026-11-11 13:30–13:57）

在 v6 复验的「仍难用」清单上继续做三件事：主题漂移可见+一键收敛、召回「索引内」提示、注入项目名分组。方案见 `notes/memory-2026-11-11-v7-plan.md`，契约 v7 见 `notes/memory-2026-11-11-contract-v7.md`。

### 8.1 改了什么

| 项 | 改法 |
|---|---|
| A 主题漂移 | `store.collapseTopicDrift({keepId, project?, workspace?})`：只作废同 project+workspace 下比 keep 更旧的 active state（≤5，给 keep 已有 supersedes 留位），单个 `mutation('collapse')` 事务改两端链接、失败回滚；无漂移返回 `noDrift` 且零写入（幂等 200）。路由 `POST {action:'collapse-topic-drift'}`；面板体检区新增「主题漂移」区块与二次确认「只保留最新」。 |
| B 召回索引内 | 命中项分 fresh / indexed：fresh 先排最多 3 行；不足 3 行时补 `- <id> [<类型>·<项目> · 索引内] <结论 60 字>`，总行数 ≤3。 |
| C 注入分组 | 每个类目内按项目分组，项目名只在组头写一次，条目行两空格缩进只留 topic/confidence；分配顺序明确为 待办→偏好→事实→决策；截断下限 60→50 字；总长仍 ≤1500。 |
| D 版本 | `memoryContractVersion=7`，契约 v7 + 变更记录 + README 更新。 |

改动 14 个文件（+827/−42）：`lib/{memory.js,memory-sessions.js,index.js,client.js}`、`README.md`、5 个旧测试的格式断言、4 个新增 `test/memory-v7-*.test.mjs`。

### 8.2 验证（独立 verifier）

- 全量 `node --test`：**599/599 通过，连续 3 次**（11 s/次，三次用例数一致）。
- 真实思源 3.8.3 只读回归 **37/37**：注入 1499/1500、四类标题各 1、事实 4 条（同数据 v6 为 12 条 3/3/3/3，v7 为 13 条 3/3/3/4）、组头零重复、尾行在；召回「索引内」在真实数据出现 4 条带 id（「上次定的外部变更闸门方案」从 0 行变为 1 行索引内，正是目标场景）；`topicDrift` 1 组 4 主题与重算一致；真实库零内容写入。
- 面板/路由假内核 **11/11**：渲染、二次确认、POST 200 作废 4 条、幂等 `noDrift` 200、6 种 400 与回滚、契约 7、v6 面板回归。
- 报告：`.local/memory-v7-20261111/reports/verify.md`（各阶段报告同目录 v7-*.md）。

### 8.3 未验证 / 已知边界

- **重启 DSH 后**才能确认 `memoryContractVersion=7` 与真实面板按钮；本轮未重启，运行中的宿主仍是 6。
- 真实窗口里没有点过「只保留最新」；面板交互由假 React + 假内核覆盖。
- 召回语义相关性仍是 v6 水平（关键词匹配，top1 切题约 2/20）；本轮只修「最强条在索引里被整块丢弃」。
- 注入余量只剩 1 字（1499/1500），后续再加内容需要先扩预算或再瘦身。

### 8.4 回退与生效

```powershell
Copy-Item -Recurse -Force D:\work\cz\.local\memory-v7-20261111\before\lib   D:\work\cz\dsh-siyuan-notes\
Copy-Item -Recurse -Force D:\work\cz\.local\memory-v7-20261111\before\test  D:\work\cz\dsh-siyuan-notes\
# 生效：重启 DSH；重启后 GET /siyuan/memory 应返回 memoryContractVersion=7
```

## 9. 记忆体 v8：下线「主题漂移一键收敛」（2026-11-19）

v7 的收敛口径是「同 project + workspace 的 active state」，一次点击会把互不相关的不同任务状态标为已被取代（真实库 10 组 48 条；`*@cz` 一组 11 个主题），且 `maxSupersedes=5` 让确认文案说 15、实际只做 5。v8 删除整条链路，只保留中性统计；同时修掉注入三处硬截断、体检「没查却显示 0」、`memory_distill` 把「没跑」说成「没有值得记的」。契约 v8 见 `notes/memory-2026-11-19-contract-v8.md`，改造记录见 `notes/memory-2026-11-19-v8-changes.md`，评审见 `notes/memory-ux-review-2026-11-19.md`。

### 9.1 改了什么

| 项 | 改法 |
|---|---|
| A 删收敛 | 删除 `collapseTopicDrift`（存储层）、`POST {action:'collapse-topic-drift'}`（路由）、面板「主题漂移」区块与二次确认；`checkup().topicDrift` → `multiStateProjects`（中性统计，按主题数降序，无任何按钮）。 |
| B 体检不完整可见 | `checkup()` 新增 `incomplete: string[]`（`complete===false` 时含 `brokenChains.missing-target`）；面板加常驻 `.sy-mem-banner`，「取代关系异常」标「另有未检查项」；补 `.sy-mem-note[data-tone=warn|ok]` 与 `.sy-mem-banner` 样式。 |
| C 注入截断 | `projectSummaryLine`（最多 6 个项目 + 等 N 个，绝不切单个项目名）、`clipLabel(…, 22)` 用于主题与组头项目名、`clipLabel(…, 48)` 用于候选摘要，截断一律补 `…`。 |
| D distill 回报 | `distillRender` 按 `value.reason` 分支：冷却中 / 没有新的对话内容 / 子代理不自动整理 / 其他原因。 |
| E 版本 | `memoryContractVersion=8`。 |

改动 `lib/memory.js`（−75/+36 行）、`lib/index.js`（−18/+18）、`lib/client.js`（−49/+25）、README（±6）；测试删 `memory-v7-topic-drift.test.mjs`、`memory-v7-panel.test.mjs`（12 条只测已删能力），新增 `test/memory-v8.test.mjs`（6 条）并在 `memory-v7-injection.test.mjs` 追加 2 条。

### 9.2 验证（实现者 + 独立 verifier）

- 全量 `node --test`：**595/595 通过，连续 3 次**（v7 为 599：删 12 条已下线能力的用例、新增 8 条）。
- 真实思源 3.8.3 只读复验（`verify-live.mjs`，写接口全部拦截）：`checkup` 无 `topicDrift`、`multiStateProjects` 5 组 33 主题（GuJumpgate 16 / `*@cz` 11 / `*@sj` 2 / dsh-model-tuning 2 / dsh-plugins 2）、`incomplete=["brokenChains.missing-target"]`、`libraryTotal=400`（横幅「只检查了最近 200 条（全库共 400 条）」）；注入 1463/1500 字 13 条，首行为「…/ dsh-session-lens 等 2 个」（不再出现 `… / d`），主题与候选摘要均带 `…`；`blockedWriteAttempts: {}`。
- 独立 verifier 复核：`node --test` 三次 595/595；v7 口径在同一份数据上会作废 13 条（5 条上限口径）/ 28 条（不设上限口径），与评审的全库 10 组 48 条同向；与 `before/` 快照逐字节对比确认其余 11 个 lib 文件未变、同一 seed 下注入文本逐行相同、面板按钮只少了「只保留最新」一个。
- 面板文本导出（假 React + 假内核）：体检区显示常驻横幅、「取代关系异常：0（另有「取代目标是否还存在」未检查）」与「同项目多任务状态：1 组（最多 16 个主题/组）」，页面中已无「只保留最新」按钮。
- 独立验证：`.local/memory-v8-20261119/report-verify.md`。

### 9.3 未验证 / 已知边界

- **本轮未重启 DSH**：运行中的宿主还是 v7 进程，`GET /siyuan/memory` 仍返回 7；v8 字段要重启后才有。
- 真实窗口里没点过体检（面板交互由假 React + 假内核覆盖）。
- 批次 2/3 未动：整句中文检索 0 命中（`ftsExpression` 只按空白切词）、「待办」组名与 state 只渲染第一行、候选死信队列、`memory_read` 写 refcount、面板无搜索/分页、工作区逐键请求等。
## 10. 记忆体 v9：整句检索 / 注入「当前状态」+「下一步」/ 候选最后分配（2026-11-19）

v8 修完「别把数据搞坏」，v9 修「每轮都在读的东西值不值这些字」：整句中文检索从必然 0 命中变成能命中并按相关度排序；注入的「待办」改名「当前状态」并把蒸馏写的「- 下一步：」带上屏；候选摘要从“先占 192 字”改成“最后分配”。契约 v9 见 `notes/memory-2026-11-19-contract-v9.md`，改造记录见 `notes/memory-2026-11-19-v9-changes.md`。

### 10.1 改了什么

| 项 | 改法 |
|---|---|
| A 检索词元 | 新增 `queryTokens()`：唯一词元且 >6 字且含中文时用 `recallTerms` 的二元组替换（最多 16 个）；`ftsExpression` 改用它，AND 优先 / 落空再 OR 不变。 |
| B 相关度与完整性 | **整句展开的查询**按 `ORDER BY rank, b.created DESC`（短词保持 v8 的「项目 + 时间」）；多取 1 条判断截断，`complete = 结果数 <= limit`；SQL `LIMIT` 上限放行 +1；渲染写“结果被截断”。 |
| C 检索渲染 | 行内补日期（同年 `MM-DD`、跨年 `YY-MM-DD`）与可信度（已核实/推断）；`active` 不写。 |
| D 注入标签与下一步 | 四类标签改「当前状态 / 偏好 / 最近决策 / 踩过的坑与事实」；state 行下补 `    下一步：…`（≤40 字，“无”不写）；预算不够先舍这一行。 |
| E 候选最后分配 | 四类分完再用剩余预算：够 2 条放 2 条、够 1 条放 1 条、都不够略过。 |
| F 召回行 | `active` 不写、日期缩 `MM-DD`（跨年 `YY-MM-DD`），行上限仍 100 字。 |
| G 召回失败可见 | 连续失败 ≥2 次时每步提示加一行（带原因），成功一次清零。 |
| H 面板徽标 | 用 catalog 真值：`300 条 · 仅显示 200`；空列表不显示后半句。 |
| I 版本 | `memoryContractVersion=9`（v8 与 v9 同一次重启前落地，重启后直接是 9）。 |

### 10.2 测试脚手架保真修正

假内核的 FTS 原本是默认 unicode61（一整串汉字 = 一个词元），长句检索在测试里能过、真实内核里必然 0 命中。真实内核实测：`"记忆插件"` 与 `"忆插"` 命中数相同（16/16）、`"面板"` 36 条——是「按字建索引、按短语查」。v9 把假内核对齐：索引时中文按字加空格，`MATCH` 里每个带引号的词元也按字加空格。

### 10.3 验证

- 全量 `node --test`：**603/603 通过，连续 3 次**（v8 为 595，新增 `test/memory-v9.test.mjs` 8 条）。另做反向验证：当前测试 + 改前 lib → 14 红，说明 v9 的断言真咬得住。
- 真实思源 3.8.3 只读复验（`verify-live.mjs`，写接口全部拦截）：整句「为什么召回不准」「上次那个注入预算怎么定的」由 0 条变 5 条（`fts-or`）；短词「面板」仍 5 条；`limit=3` 时 `complete=false`；注入 1499/1500 字、标题「当前状态」、3 行「下一步」、候选块因预算耗尽未出现（目录行仍“候选 7”）；召回行无 `active`；`blockedWriteAttempts: {}`。
- 独立验证：`.local/memory-v9-20261119/report-verify.md`。其 3 条「应修」已全部修掉并复验（probe 上限 +1、工具描述去重、rank 只用于整句）。

### 10.4 未验证 / 已知边界

- **本轮未重启 DSH**（宿主仍是 v7 进程），v8/v9 的字段要重启后才有。
- 真实窗口里没看过 v9 的注入与检索行。
- 候选块在真实库本轮被预算挤掉（换来决策 2→3 与 3 行「下一步」）；「下一步」的字数上限要不要收，等看过真实效果再定。
- 检索仍是关键词匹配，同义改写召不回；批次 3（候选死信队列、`memory_read` 写 refcount、面板搜索/分页）未动。
## 11. 记忆体 v10：候选死信 / 读路径 / 面板输入（2026-11-19）

v8 修「别把数据搞坏」、v9 修「每轮读到的东西」，v10 修**攒着没人管的东西**：7 条候选积压 8 天没人处理（同主题的还会互相覆盖，最后活下来的是最旧那版）、`memory_read` 号称只读却在写库、`reconcile` 20 个 id 每 30 秒打 40 次内核、面板没有搜索分页、输入框逐键发请求。契约 v10 见 `notes/memory-2026-11-19-contract-v10.md`，改造记录见 `notes/memory-2026-11-19-v10-changes.md`。

### 11.1 改了什么

| 项 | 改法 |
|---|---|
| A 候选成组 | `approve()` 在同一事务里把同 topicId（同 project+workspace）的其它候选标为 `superseded`，回包 `supersededCandidates`（超上限给 `skippedCandidates`）。 |
| B 候选可见 | `view=entries` 新增 `byStatus`（全库计数）与 `candidates`（第一页、最多 20、最老在前）；面板顶部单列「候选（推断）N 条」区块。 |
| C 读门禁与批量 | 读计数受 `canWrite`/记录开关约束；一次读只发一次 `/api/attr/batchSetBlockAttrs`（失败退回逐个写）；回包 `counted`。 |
| D 对账批量化 | `reconcile` 先用一条 SQL 取回全部 id，只有没命中的才逐条直读（区分索引滞后与真删除）。 |
| E 面板输入与列表 | 输入 300ms 防抖 + `<datalist>`（新增 `view=scopes`）+ 请求序号 + 失败保留列表；关键词客户端过滤；`offset` 分页与「加载更多」。 |
| F 落点可见 | `memory_write` 回执带 `placement{project,workspace,global,reason}`；面板详情「改归属」走 `reproject`。 |
| G 收尾 | `cleanup-receipts` 也清 `rolled_back`（>24h）；详情显示「距上次确认 N 天」。 |
| H 版本 | `memoryContractVersion=10`。 |

### 11.2 验证

- 全量 `node --test`：**627/627 通过，连续 3 次**（v9 为 603；新增 host 13 条 + panel 11 条）。另外 `native-session.test.mjs` 有一条时间相关用例偶发红，单跑与随后的全量重跑均绿，与本轮改动无关（它只 import lib/native-*.js）。
- 真实思源 3.8.3 只读复验（`verify-live.mjs`，写接口全部拦截）：`statusCounts` = active 304 / candidate 7 / superseded 90 / revoked 1，合计 **402**（= 全库）；`scopes` 11 项目 / 11 工作区；候选 7 条最老在前；`reconcile(3 个 id)` = **1 次内核请求**；`read(canWrite=false)` = `counted 0` 且写请求 0；`blockedWriteAttempts: {}`。
- **分页真值**（真实库 402 条）：`limit=200` → 200 条 / `hasMore` true；`offset=200` → 200 / true；`offset=400` → 2 / false；三页去重 **402 = 全库**。
- 两个假内核补了 `/api/attr/batchSetBlockAttrs`（真实内核支持，空数组 no-op 已实测）。
- 独立验证：`.local/memory-v10-20261119/report-verify.md`。

### 11.3 未验证 / 已知边界

- **本轮未重启 DSH**（宿主仍是 v9 进程），v10 的 `byStatus`/`candidates`/`offset`/`scopes`/`placement` 要重启后才有；面板按「字段缺了就退化渲染」实现，旧宿主上不会崩。
- 真实窗口里没点过 v10 的面板（假 React + 假内核覆盖）。
- `approve` 的「合并正文」分支（正文有改动时走 `write`）不处理同主题候选，候选留在原状态；已知缺口。