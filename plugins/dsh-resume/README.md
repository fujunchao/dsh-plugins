# dsh-resume

> 会话被中断之后，输入框右下角那颗**灰掉的发送键会变成可点的「▶ 继续」**：点一下，宿主带着"中断现场"接着干，不用再手打「继续」二字。

<!-- 说明：本插件只在本机工作；不联网、不发遥测、不改宿主文件。 -->

---

## 它解决什么

DSH 里一次回合（turn）可能因为各种原因没干完就结束了：

| 终止原因 | 典型场景 | 现在的体验 | 装上之后 |
|---|---|---|---|
| `error` | 上游 429 限流、402 余额不足、请求超时 | 发送键变回灰箭头，要手打「继续」 | ▶ 可点 |
| `aborted` | 你按了停止（或父会话/插件把它停了） | 同上 | ▶ 可点 |
| `interrupted` | DSH 进程在回合结束前退出（崩溃/重启） | 同上 | ▶ 可点 |
| `max-tokens` | 回复被输出上限截断 | 同上 | ▶ 可点 |

`blocked`（步骤被插件拒绝）**不给** ▶——继续会被同一个插件再拒一次。
回合正常结束（`completed`）默认也不给（可用 `includeCompleted` 打开"还有未完成待办时也给"）。

> 灵感来自 Codex 桌面版的 ▶。但 Codex 的 ▶ 实际是"把上一轮整个重跑一遍"，会重复已经成功的工具调用（官方 issue 里被反复报告）。
> 这里的 ▶ 发的是**一条带现场信息的续跑指令**：中断在哪、为什么、还剩什么活，外加三条护栏（先核实现场 / 不重做已完成 / 半途操作先对账）。这一点抄的是 Codex 崩溃自动恢复用的那段 prompt，而不是它的按钮语义。

---

## 用起来是什么样

1. 回合异常结束 → 右下角那颗发送键原地变成 **▶**（同尺寸、同位置、同配色，只是图标从 ↑ 变成 ▶）。
2. 鼠标悬停：提示「继续未完成的工作 · 429 限流 · 2 项待办未完成 · 直接输入文字即可忽略」。
3. 点一下：图标变成转圈，宿主立刻开出新回合。
4. 转录里同时出现一行折叠条目：
   `[◇] 上下文注入 · resume · 429 限流 · 第 12 轮 · 待办 2 项未完成`
   点开就是模型看到的完整续跑指令（模型看全文，你只看一行）。
5. 中断的那一轮下方，还有一行 `▶ 上一轮被中断 · …  [继续] [忽略]`（滚动到错误处也能点）。
6. 你只要一开始打字，▶ 立刻变回宿主原来的发送键；点「忽略」则这一轮不再提示。

---

## 安装 / 卸载

**从市场安装（推荐）**：DSH 插件页 → 发现 → 添加索引源，索引地址

```text
https://fujunchao.github.io/dsh-plugins/index.json
```

然后在「界面」分类里安装 `dsh-resume`。装完**刷新页面**（浏览器半是启动时加载的）。

在仓库里开发时，把本目录当作本地 bundle 装进当前 profile（已装过的会提示 already-installed）：

```text
plugin_manager: { action: "install_bundle", target: "<本仓库 plugins/dsh-resume 目录>" }
```

卸载：

```text
plugin_manager: { action: "remove_bundle", target: "dsh-resume" }
```

卸载后 DOM、样式、路由全部回收，输入框恢复原样。

---

## 配置

改 `cordis.patch.yml` 里 `resume` 这一行，保存后重启 dsh。插件挂载时读取配置，不支持设置表单的即时更新。

配置使用可选依赖 `@deepseek-ai/schemastery` 提供宿主兼容的描述；直接链接源码时先运行 `pnpm install`。依赖缺失时只导出 Standard Schema 校验，仍可正常启动。普通 JSON Schema 不能通过 `toJSON()` 冒充 Schemastery，否则桌面启动读取设置时会报 `desktop welcome: Web RPC failed`，内部错误为读取 `meta.volatile` 失败。

| 键 | 默认 | 含义 |
|---|---|---|
| `placement` | `seat` | ▶ 的位置。`seat`=精确覆盖发送键；`toolbar`=放到发送键左侧（宿主大改版时的兜底） |
| `includeCompleted` | `false` | 回合正常结束、但仍有未完成待办/目标/后台任务时，也给 ▶ |
| `promptLanguage` | `auto` | 续跑指令语言：`auto` 跟随界面语言 / `zh` / `en` |
| `maxPromptChars` | `1200` | 指令长度上限（超长时压缩错误原文，护栏不截断） |
| `ignoreErrorCodes` | `[]` | 这些错误码永不给 ▶，例如 `CONTEXT_LENGTH_EXCEEDED` |

```yaml
- insert:
    - id: resume
      name: 'dsh-resume'
      config:
        placement: seat
        includeCompleted: false
        promptLanguage: auto
        maxPromptChars: 1200
        ignoreErrorCodes: []
```

---

## 它是怎么工作的

```
浏览器半（lib/client.js）                         宿主半（lib/index.js）
────────────────────                           ──────────────────────
① 会话 running 翻转 / 挂载 / 窗口聚焦
   → GET /dsh-resume/state?sessionId=…  ───────► 只读会话日志，折叠出：
                                                  终止原因 / 中断位置 / 剩余工作
② 找到宿主发送键（卡片里最后一个 button，
   几何自检 20–56px + 右下象限），
   只在这颗键 disabled 时，把 ▶ 精确画在它上面
③ 点击 → POST /dsh-resume/continue ───────────► 校验（同一把锁 / agent 空闲 /
                                                  inbox 无待发 / 仍是同一次中断）
                                               → agent.followup(createUserMessage({
                                                    source: { kind: 'resume',
                                                              form: 'notice',
                                                              summary, turn, seq } }))
④ running 变 true → 交还宿主的 Stop 键
```

- **续跑指令**（模型看到的就是这段，转录里默认折叠）：

  ```
  <resume_after_interruption>
  状态：上一轮被中断，并未完成。
  中断位置：第 12 轮、第 3 步。
  中断原因：上游限流（429）—— "上游返回 429: 您的模型请求频率超限…"
  - 待办：2 项待处理、1 项进行中、2 项已完成（共 5 项）
  - 目标：进行中（第 2/10 轮）— "…"
  - 后台任务：1 个仍未结束
  继续规则：
  1. 以当前工作区、工具输出和会话里的持久状态为准；先核实，不要把之前的叙述当成现状。
  2. 不要重做已经完成的工作。任何有副作用的动作…先确认它是否已经生效。
  3. 中断时正在进行的操作可能只执行了一半，先显式核对再继续。
  4. 一直做到最初的要求被满足为止；结束后验证结果，并简要汇报。
  如果确实无法继续（缺凭据、同样的错误持续存在），停下来并明确说明卡在哪里。
  </resume_after_interruption>
  ```

- **为什么覆盖而不是"加个键"**：宿主没有"替换发送键"的扩展点（`conversation.composer.bar` 是整块输入框的 single slot，替换它等于重写输入框）。所以这里是测量宿主的 `button.primary` 后精确覆盖，并复制它的 `background-color`/`color`/`border-radius`，做到不同主题下都像同一颗按钮。
- **三级兜底**：找不到键位 → 自动降级到发送键左侧的小圆钮；连 slot 都拿不到 → 只剩转录里那行「继续」。
- **永不误伤**：只在宿主发送键 `disabled`（草稿为空）时出现；一打字就消失；万一点击落在"键位其实已可用"的瞬间，会把这一下点转交给宿主，不吞掉真正的发送。

---

## 自检与排障

浏览器控制台：

```js
__DSH_RESUME__.health()          // 宿主路由是否活着、客户端注册情况
__DSH_RESUME__.caps()            // { definition, renderer, error }：转录行是否注册成功
__DSH_RESUME__.mode()            // 'seat' | 'toolbar'（当前用的哪种形态）
__DSH_RESUME__.state(sessionId)  // 直接看某会话的折叠结果
__DSH_RESUME__.continue(sessionId, seq)  // 绕过 UI 直接触发一次
```

命令行：

```pwsh
curl.exe -s http://127.0.0.1:58699/dsh-resume/health
curl.exe -s "http://127.0.0.1:58699/dsh-resume/state?sessionId=<id>&lang=zh"
```

自测取消（只对**子会话**生效，碰不到你的顶层会话；用来在没有真实 429 的情况下验链路）：

```pwsh
curl.exe -s -X POST -H 'Content-Type: application/json' `
  -d '{"sessionId":"<子会话 id>"}' http://127.0.0.1:58699/dsh-resume/debug/cancel
```

常见问题：

| 现象 | 原因 / 处理 |
|---|---|
| 刷新后完全没变化 | 客户端半没加载：检查 `__DSH_RESUME__.health()`；或插件行没启用 |
| ▶ 不出现 | 这一轮不是中断态（`completed`）；或会话不在内存里（`state:null`）；或错误码在 `ignoreErrorCodes` 里 |
| ▶ 位置偏了 | 宿主改版改了几何：把 `placement` 设成 `toolbar` 立刻可用，再报给我修 |
| 点了报「会话正在运行」 | 有回合正在跑（或另一个窗口刚点了），等它结束再点 |
| 点了报「已有排队中的消息」 | 输入框里还有排队消息，先让它跑完 |

---

## 边界（已知限制）

- **只在"会话处于内存中"时工作**：宿主重启后要先打开一次该会话，▶ 才会出现（状态从日志推导，不依赖内存态）。
- **子会话（subagent）聊天面板里不出现**：`subagent !== null` 的会话被显式跳过。
- **不自动重试**：这是有意的。失败原因如实透出，要不要再来一次由人决定。
- **宿主改版风险**：覆盖层依赖"卡片里最后一个 button 就是发送键"这个形状；找不到时会自动降级，不会误伤任何现有交互。

---

## 开发

```pwsh
node --test               # 状态折叠 / 指令文案 / 路由 / 客户端注册 / 配置兼容性
```

目录：

```
lib/state.js      会话日志 → 中断状态（纯函数）
lib/prompt.js     续跑指令与摘要（纯函数）
lib/index.js      宿主半：配置 / 路由 / followup
lib/client.js     浏览器半：覆盖层 / 降级按钮 / 转录行
test/             单测
```

改完宿主半后需要重启 dsh；浏览器半改完刷新页面。修改 profile 补丁前先备份，并在当前回合结束后操作：插件重载可能释放当前 Agent，使旧窗口的停止操作返回 `not found (not attached)`。发生后完整退出并重新打开 dsh，再打开原会话即可从存档恢复。

## License

MIT
