# dsh-session-lens 术语表

本文件只收**术语与判定**，不收实现。实现细节见 `README.md` 与 `docs/DESIGN.md`。

## 核心名词

| 术语 | 定义 | 容易混成什么 |
|---|---|---|
| **会话** session | 一条持久化日志，`session.v4.jsonl.zstd`，带不可变 header（`id` / `cwd` / `origin` / `parentSession`） | 不是“一轮”，也不是“一次提问” |
| **主会话** main session | `origin: main`，侧栏里能被用户打开的那些 | — |
| **子会话** subagent session | `origin: subagent`，由主会话派生，`delegationDepth ≥ 1`；占本机会话总数约一半（173/343） | 不是“子任务”，它是完整的独立日志 |
| **工作区** workspace | 会话 header 里的 `cwd`。**同区 = 字符串完全相等**，不做大小写归一、不解析符号链接 | 不是“项目” |
| **项目** project | workspace registry 里的注册单位：`path` + `title` + `sessionIds`。是**人对目录的组织行为** | 不是 cwd 的同义词 |
| **未注册目录** unregistered directory | 有会话落盘、但不在注册表里的 cwd（如 `%SystemRoot%\system32`、`/tmp/scratch`） | 不是项目，默认折叠 |
| **步** step | 一次模型调用 + 它触发的工具批次，由 `step/start` 界定。**唯一的寻址单位**：cz 桶中位数 97 步/会话、单会话最多 1,034 步 | 不是“轮”，也不是“消息” |
| **轮次** turn | agent 处理周期，由 `turn/start` 界定；一轮平均 34 步，dh 桶 9 个会话全部只有 1 轮。**只用于大纲的显示分组，不参与寻址** | 不是“人提问的单位” |
| **叙述段** narrative segment | 大纲的一种**行粒度**：在“有文本的 assistant 消息”处断开。不是地址，只是一种把步合并成一行看的方式 | 不是“段”，也不是地址单位 |
| **大纲** outline | 目录：每行带一个步号区间（`s614–615`）、用户问题摘录、工具名与次数、条数、体积、错误标记 | 不是摘要，不做语义压缩 |
| **会话表层** surface | 某个会话里**模型实际看到的历史**：完整消息序列，含工具调用与结果，压缩过的部分已被遮蔽 | 不是原始日志，也不是“文本投影” |
| **文本投影** text projection | 只保留 user 与 assistant 文字的裁剪视图，不含工具调用/结果/推理 | 不是“摘要”，它不压缩、只过滤 |
| **原始日志** raw log | 逐条未删节事件：delta、streaming 帧、`step/start`–`step/end`、子代理内部事件 | 不是“完整正文”——它包含正文之外的全部噪声 |
| **跨区读取** cross-workspace read | 目标会话 `cwd` ≠ 调用方会话 `cwd` | 不是“越权”——读取权限本身不设防（bash 本来就能读） |
| **显式跨区** explicit cross-workspace | 跨区必须由**调用参数**点名（`scope: "all"`），不是默认发生 | 不是安全闸门，是意图可见性 |
| **外来内容** foreign content | 来自非本工作区的会话内容 | 不是“不可信内容”——可信度与来源无关 |
| **来源围栏** provenance fence | 包裹外来内容的结构边界，头尾带 `cwd` / `id` / `ref` / `mode` / 步区间 / 快照点 | 不是安全边界，也不附带道德警告 |
| **秘密脱敏** secret redaction | 值级替换，**保留类型与长度**（`<redacted: api-key, 51 chars>`），不破坏结构。覆盖 `sk-` 类键、`Authorization: Token/Bearer/Basic/Digest/ApiKey`、`password=`、`--password`、`*_API_KEY=`、PEM、URL 里的 `user:pass`，以及散文里的 `token demo-7f3a91`（仅当值像凭据：含数字或 ≥24 字符） | 不是权限控制，也不是“删掉那段” |
| **读快照** capture | 一次读取的时点：`live` / `persisted` 标记 + `capturedThroughSeq` | 不是订阅，不跟随源会话后续变化 |
| **续读** continuation | 预算截断后给出的续读参数（`from=<步>` + `after_seq=<seq>`） | 不是游标，不暴露 provider cursor |
| **需续读** oversized line | 大纲里单行体积超过单次读取预算的行 | 不是错误，是提示“这一行要分几次读” |

## 判定规则

- **同区** = `cwd` 字符串完全相等。没有 `cwd` 的会话只能读自己。
- **默认作用域** = 调用方所在工作区。跨区必须显式 `scope: "all"`。
- **发现默认排除子会话**：`session_find` 只搜主会话，`include_subagents: true` 才下钻。
- **列表看组织，检索看事实**：`session_projects` 按注册项目组织（未注册目录折叠）；`session_find` 覆盖全部落盘会话。
- **阅读按步寻址**：`from` / `to` / `after_seq` 收的都是步号；正文边注是 `[s620 · assistant]`。
- **大纲粒度自适应**：一行一步 → 一行一叙述段 → 一行一轮，取第一个能塞进行数上限的档位；地址永远是步号。
- **装不下先给大纲**：整段超预算时不硬塞截断正文，而是退成目录。
- **读取永远只读**：不 resume、不 fork、不改名、不删除、不触发迁移发布。

## 被否决的说法

- ❌ "查看权限" —— 权限并不缺，缺的是**模型可见的工具**。人侧的 `@` 提及本来就能跨工作区。
- ❌ "跨项目搜索就是全局搜索" —— 默认作用域仍是本工作区，跨区是显式动作。
- ❌ "打码等于安全" —— 它是防**意外扩散**（进笔记、进记忆、进 commit），不是防越权。
- ❌ "按轮次读" —— 实测轮次中位数 2、最大 27，而单轮可长到 1,034 步；按轮切等于没有导航。
- ❌ "按人类消息分段" —— 实测人类消息中位数 1 条/会话（其余 user 角色消息都是注入的上下文）。
