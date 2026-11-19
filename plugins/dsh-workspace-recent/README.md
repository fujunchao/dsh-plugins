# dsh-workspace-recent

侧边栏的**项目（工作区）按最近工作顺序自动排序**：最近发过消息的项目自己浮到最上面，不用再一个个往下翻。

组内会话的「最近更新」排序是 DSH 自带的，本插件不碰；它只管**项目这一层**。

## 口径

| 概念 | 定义 |
| --- | --- |
| 会话时间 | `max(会话创建时间, 最后一次用户发消息的时间)`——与侧边栏「最近更新」同一把尺子 |
| 项目时间 | 该项目里参与计算的会话的最大会话时间 |
| 参与计算的会话 | 排除**归档会话**、排除**子代理会话**、**计入空白新会话** |
| 无工作时间的项目 | 沉到底部，保持它们现有的相对顺序 |
| 时间相同时 | 用当前顺序决胜（稳定，不抖动） |

术语的完整定义见开发笔记 `CONTEXT.md`（不随包发布），为什么这么实现见 [ADR 0001](./docs/adr/0001-order-workspaces-by-rewriting-durable-order.md)。

## 它到底改了什么

只改一件事：宿主 registry 里工作区 id 的**持久顺序**（`~/.dsh/storages/workspace.json` 的 `workspaceIds`）。

侧边栏的分组顺序本来就来自这份顺序，所以：

- 不需要接管任何 UI，DSH 升级不会让你的侧边栏变样；
- 拖拽排序、新建会话的工作区下拉、下次启动，全都自动一致；
- 顺序变更是全局的：多窗口共享同一份顺序。

`insertBefore` 自带幂等短路：顺序没变时一次都不写。

## 什么时候排

| 触发 | 行为 |
| --- | --- |
| 插件加载后约 1.5 秒 | 按历史数据排一次（覆盖"上次关掉时还没排"的情况） |
| 你在某个会话里发消息 | 把该项目实时顶到首位；已在首位则不写 |
| 某个项目里新建空白会话 | 同上（代表"刚在这里开了张"） |
| 设置页改了插件配置 | 重新排一次 |
| 斜杠命令 `/sort-projects` | 立即整理一次，回报排序结果 |

## 安装

1. 打开 **DSH 插件页 → 发现 → 添加索引源**，填入本插件集的索引地址（见仓库说明）。
2. 在列表里找到 **项目按最近工作排序（Workspace Recent）** → 安装：DSH 把包装进当前 profile，
   并把 `cordis.patch.yml` 里的一行 `insert` 追加进 profile 补丁层。
3. 新行不会自动 mount：在插件管理器把这一行 enable **关 → 开**一次，或重启 DSH。之后插件就是
   `fiberPhase: active`，**不需要重启 DSH**。

装上之后不需要配置：打开 DSH 约 1.5 秒后侧边栏按历史数据自动排一次，之后你每次发消息都会把
对应项目顶上去。

> 自建索引或本地开发时也可以手工把这一行写进 profile 的 `cordis.patch.yml`（必须是 `insert:`
> 形式；带 `id` 但不带 `insert` 的写法只会去找已存在的行，找不到就跳过），并用 `link:` 依赖把
> 工作副本挂进 `~/.dsh/profiles/<profile>/`。注意不要在 profile 目录直接跑 `pnpm install`：它会
> 想删掉整个 `node_modules`，无 TTY 时直接以 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 中止
> （设 `CI=true` 会真的重装整棵树，风险高）。

## 开关

设置页 → 插件 → 「按最近工作顺序整理侧边栏项目」：

- `recent`（默认）：按最近工作自动排；
- `manual`：**完全不碰顺序**，手动拖拽是唯一真相。

开关是 volatile 的：改完立即生效，不需要重启。

## 命令

```
/sort-projects
```

立即整理一次，并列出前 12 个项目的最近工作时间、以及沉底的项目，方便肉眼核对口径。

## 验收清单

1. 重启后侧边栏第一个项目 = 最近发过消息的项目。
2. 在项目 B 发一条消息 → 1 秒内 B 到首位，其余项目相对顺序不变。
3. 把某项目下的会话全归档 → 它失去时间戳 → 沉底。
4. 子代理会话跑得再新，也不会让项目上浮。
5. 切到 `manual` 后拖拽结果不再被改；切回 `recent` 会重排一次。
6. `/sort-projects` 报的时间与侧边栏会话行显示的时间一致。

## 测试与预演

```bash
node --test                                  # 排序核心单测（纯函数）
node tools/dry-run.mjs                       # 只读预演：用磁盘真实数据算出排序结果，不写任何东西
node tools/dry-run.mjs --limit 20            # 多看几个
```

## 目录

```
lib/order.js              纯排序核心（口径、目标顺序、最少移动规划）
lib/index.js              插件壳：取数据、订阅事件、落盘、注册命令
test/order.test.js        单测
tools/dry-run.mjs         只读预演
CONTEXT.md                术语表
docs/adr/0001-*.md        取舍记录
cordis.patch.yml          bundle 行
```

## 已知边界

- **会写 `workspace.json`**：只有顺序真的改变时才写；首次排序、切换项目、新建会话会触发。
- **拖拽会被覆盖**：自动模式下拖拽只是临时效果；不想被覆盖就切 `manual`。
- **多窗口共享顺序**：一个窗口里的活动会改变另一个窗口的排列，这是全局一致的必然代价。
- **归档集合的读取**：优先用 registry 上现成的 `archivedSessionIds`，退路是 storage 域的 global 快照；两者都取不到时按"没有归档会话"处理（最坏情况是有归档会话的项目时间偏新）。
- **DSH 升级**：依赖 `workspaceRegistry.list()/insertBefore()`、`sessionController.list()`、`api-session/activity`、`api-session/added` 四个宿主能力；升级后跑一次 `/sort-projects` 就知道还活着没有。
