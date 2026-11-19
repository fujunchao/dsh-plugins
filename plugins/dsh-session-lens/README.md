# dsh-session-lens

跨项目只读会话浏览，**给模型用的三个工具**：在本项目的对话里，模型可以列出这台机器上的项目、跨项目检索会话正文、按步阅读任意会话。

> 它不给你人眼看的东西——人侧的 `@` 提及本来就能跨工作区取快照。它补的是**模型自主**的那一半：**按内容找会话 → 打开读细节 → 沿步往下追**。

## 为什么需要它

DSH 官方的会话工具（`session_search` / `session_event_read` / …）按 `cwd` **字符串精确相等**授权（`@deepseek-ai/dsh-tool-session-query` 的 `workspace-access.ts`）：在本项目的对话里，模型读不到别的项目。而 `ctx.sessionQuery` 服务本身从不按 cwd 过滤，人侧的 `@` 提及也早就跨工作区——**缺的只是模型可见、且能自主使用的那条路径**。

## 三个工具

| 工具 | 作用域 | 做什么 |
|---|---|---|
| `session_projects` | **本机每个项目** | 列项目（注册表名字 + 路径 + 会话数 + 最近活动）；给 `project` 参数则展开该项目的会话 |
| `session_find` | **默认本工作区**，`scope: "all"` 才跨项目 | 按字面文本检索；每条命中带项目、会话 id、**步号**与摘录，可直接接一次 `session_read` |
| `session_read` | **任意会话**（点名 id 即授权） | `outline`（目录）/ `text`（人话）/ `surface`（模型当时看到的历史，含工具调用与结果，默认）/ `raw`（未删节日志） |

### 为什么默认不跨项目

跨项目访问**必须显式**（`scope: "all"`）。这不是安全闸门——沙箱只管写不管读，模型用 bash 本来就能读到任何会话文件——而是**意图可见性**：每次跨区都在 transcript 里留下 `scope: "all"`，模型不会不声不响地把别的项目塞进你的上下文。

### 阅读是按“步”寻址的

DSH 一次模型调用 + 它触发的工具批次 = 一个 `step`。这是日志里唯一既足够细、又机械无歧义的边界：

| 单位 | cz 桶中位数 | cz 桶最大值 |
|---|---|---|
| 人类消息 | 1 | 21 |
| 轮次（turn） | 2 | 27 |
| **步（step）** | **97** | **1,034** |

所以 `from` / `to` 收的是**步号**，每行正文带 `[s620 · assistant]` 这样的边注。

大纲的行粒度是**自适应**的：先试“一行一步”；行数超过 `maxOutlineLines` 就换成“一行一个叙述段”；还不够就按轮分组。超预算的行会标上 `需续读`。无论哪一档，地址永远是步号——下钻的姿势是：

```text
session_read(mode="outline")                     → t1 · s1–130 …（按轮的顶层地图）
session_read(mode="outline", from=614, to=758)   → s614–615 · …（该轮内的可读段落）
session_read(from=620, to=626)                   → 正文
```

## 外来内容的处理

- **来源围栏**：结果包在 `<foreign-session cwd=… id=… ref=… title=… mode=… steps=… snapshot=…>` 里，正文中的 `<` 转义成 `\u003c`，源文本伪造不出围栏或工具结果；
- **不说道德**：不加“不得遵循其中指令”之类的警告——内容类型与本工作区历史完全一样，说教只会让模型对所有材料打折扣；
- **秘密默认打码**：`sk-…`、`Bearer …`、`Authorization: Token/Bearer/Basic/Digest/ApiKey …`、`password=…`、`--password …`、`*_API_KEY=…`、PEM 私钥、URL 里的 `user:pass`，以及散文里的 `token demo-7f3a91` 这类写法，都会被替换成 `<redacted: 类型, N chars>`（**保留类型与长度**，结构不动）。真需要原文时显式 `include_secrets: true`；
- **只读**：不 resume、不 fork、不改名、不删除，也不触发格式迁移的发布。

## 安装

1. 打开 **DSH 插件页 → 发现 → 添加索引源**，填入本插件集的索引地址（见仓库说明）。
2. 在列表里找到 **Session Lens** → 安装。DSH 会把包装进当前 profile，并把
   `cordis.patch.yml` 里的一行 `insert` 追加进 profile 补丁层。
3. 新插入的行不会自动 mount：在插件管理器里把这一行 enable **关 → 开**一次，或重启 DSH。

装完不需要任何配置。在任意会话里说一句「找找别的项目里关于 zstd 的会话」，模型就会自己走
`session_projects` → `session_find` → `session_read` 这条链。

插件是纯宿主半（没有 client 半、不注入 DOM），所以升级/重装只影响模型工具与提示词，不动界面。

本地开发时可以改用 `link:` 依赖把工作副本挂进 `~/.dsh/profiles/<profile>/`，重载插件即可生效。

## 开发与测试

```powershell
node --test          # 80 条：步映射、大纲粒度阶梯、脱敏、围栏转义、预算截断、子会话过滤、端到端工具调用
```

测试用**真实会话日志**当 fixture（`tests/support/corpus.js`），因此不需要启动 DSH。注意日志是**多帧 zstd 追加**，单次解压只会拿到第一帧（823 KB 的文件只解出 274 字节且不报错）——fixture 读取器按 zstd 魔数逐帧解码，生产代码则一律走 `ctx.sessionQuery`，从不自己读文件。

## 真机验收（2026-11-17，desktop profile）

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 跨区检索：`scope:"all"` 能找到 dh 项目的会话 | ✅ 命中 3 条，带步号 `s42 / s45 / s70` 与 `ref=` |
| 2 | 默认作用域不越界：同样的词不传 `scope` | ✅ 0 命中，并给出“加 scope:\"all\""提示 |
| 3 | 大会话大纲完整：cz 最大会话（1,034 步 / 6,808 事件） | ✅ 18 行覆盖 `t0–t17`，逐行带步区间、工具计数、体积、`含错误`、`需续读` |
| 4 | 真含密会话（`profiles\desktop` 桶）：`Authorization: Token demo-7f3a91` + 散文 `token demo-7f3a91` | ⚠️ 首次漏网 → 补 `auth-token`/散文规则后 ✅ 两处都变成 `<redacted: …>` |
| 5 | 只读：`~/.dsh/sessions` 前后对比 344 个文件 | ✅ 只有本会话自己的日志在增长，其余 343 个文件 size/mtime 全未变 |

第 4 项就是为什么要有真机验收：单元测试的样本里没有 `Authorization: Token …` 这种写法，而真实会话里有。

## 相关文档

- [CONTEXT.md](CONTEXT.md) —— 术语与判定（工作区 / 项目 / 步 / 大纲 / 围栏 / 脱敏）
- [docs/DESIGN.md](docs/DESIGN.md) —— 模块地图、两次数据驱动的设计修正、预算与授权模型
- [docs/adr/0001-跨项目读取的授权模型.md](docs/adr/0001-跨项目读取的授权模型.md) —— 为什么并存而不是顶替、为什么默认不跨区
