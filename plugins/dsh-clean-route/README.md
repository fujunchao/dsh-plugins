# dsh-clean-route

净化路由：让某些渠道上的模型「不因为 DSH 自带的系统提示词被上游拒绝」。

验证过的场景是 Gemini（`provider: google`）：按规则表**定点切除**提示词里被上游识别为指纹的段落，工具声明、历史消息、运行时提醒全部原样透传。上游端点由你自己的供应商配置决定，与插件无关。

## 为什么是这个方案

2026-11-17 的 6 变体 A/B（同一条 route、同一个 key、同一个模型）结论：

| 变体 | systemInstruction | 工具 | generationConfig | UA | 结果 |
|---|---|---|---|---|---|
| V1 | DSH 全文 | 80 个真实工具 | XHIGH / 995702 | 带 harness 尾 | **429** |
| V2 | 短载体提示词 | 同上 | 同上 | 带 harness 尾 | 200 |
| V3 | 短载体提示词 | 无 | 同上 | 带 harness 尾 | 200 |
| V4 | DSH 全文 | 80 个 | 同上 | 干净 UA | **429** |
| V5 | DSH 全文 | 80 个 | 1024 / 无 thinking | 带 harness 尾 | **429** |
| V6 | 短载体提示词 | 80 个 | 1024 / 无 thinking | 带 harness 尾 | 200 |

→ **只和提示词内容有关**。逐段 bisect 定位到两处：开头 47 字符的身份句、以及 `harness:source` + `app:web-surface` 这两段；其余 7 千字（记忆块、工具规范、MCP 说明）全部放行；4000 字无害填充也放行；把品牌词删掉仍然 429（不是关键词过滤，是提示词签名匹配）。

设计取舍见 [ADR 0001](docs/adr/0001-scrub-at-assembly-waterfall.md)（为什么在组装点而不是出口）、[ADR 0002](docs/adr/0002-surgical-scrub-with-rule-table.md)（为什么定点切除而不是整份替换）、[ADR 0003](docs/adr/0003-xhigh-patch-custody.md)（为什么 xhigh 走补丁托管）。

## 规则表

默认路径 `~/.dsh/gemini-clean.yml`（插件配置里的 `rulesPath` 可改）。**改文件即生效**，下一个 step 就按新规则组装，不用重启。

```yaml
version: 1
routes:                          # 哪些 provider/model 算净化路由
  - provider: google             # 整个 google 路由
  # - provider: google
  #   model: "gemini-4-*"        # 也可以只命中部分模型（只支持 * 通配）
sections:
  drop:                          # 按 section 名剔除
    - harness:identity
    - harness:source
    - app:web-surface
  replace:                       # 按 section 名换文本（人设换成中性的）
    deployment:persona-prefix: 你是一个在用户本机运行的编码助手，用中文回答。
  append: []                     # 追加段落（字符串或 { name, text }）
contexts:
  drop:                          # 每步 reminder 里同名的两条也一并剔
    - harness:source
    - app:web-surface
carrier: null                    # 整份接管：文件路径；默认关，是规则失效时的逃生口
textRules: []                    # 兜底：[{ pattern, replacement, regex?, flags? }]
```

几条使用注意：

- **正则规则要用单引号**：YAML 双引号里 `\.` 是非法转义；写 `pattern: '工具\\.规范'` 或干脆用 `字符集`。
- `textRules` 按顺序作用在**每个 section 的文本**上（section 之间用空行连接，跨段的规则请拆成两条）。替换文本里出现 `{{` 时该 section 会被钉成字面量，避免插值报错。
- 规则表坏了不会拖垮会话：解析失败保留**上一份有效配置**并记日志；文件不存在则用内置默认规则。

## 配置界面（阶段 2）

入口：**插件页 → `dsh-clean-route` 包 → 行 `clean-route` → 「配置」**。

挂载点是 `plugins.row.config` 槽位（key = `<包名>#<row id>` = `dsh-clean-route#clean-route`）——插件页给每一行提供「配置」入口，点开就是下面的完整面板；列表里用的是 `view: "summary"` 的一行摘要。设置里的独立 tab 已移除。

面板能力：

| 区域 | 做什么 |
|---|---|
| 顶部 | 规则来源（文件/内置默认）、未保存标记、重新载入 / 恢复默认 / 保存 |
| xhigh | 补丁状态（红/绿）+ 一键写入（宿主正在跑时会失败并给出退出指引） |
| 净化路由 | 勾选 provider，可填 model glob，留空表示整个 provider |
| 剔除段落 / 运行时提醒 | 复选框列表，名字与字数取自**最近一次真实组装** |
| 替换人设 | 一行输入，对应 `deployment:persona-prefix` |
| 追加段落 | 每行一段 |
| 文本兜底规则 | 表格：匹配 / 替换为 / 正则 / 删除 |
| 整份接管 | 内联大文本框 + 「从文件导入」「导出到文件」 |
| 净化预览 | 用当前（或草稿）规则渲染：字数前后对比、动作清单、残留检查、前后 1200 字对照 |
| 测试跑通 | **真发一次最小请求**：用当前（含未保存改动）规则渲染净化后提示词，走宿主自己的 `llm.stream` + 真实凭据直打上游，回报成败、耗时、发送字数与首字 |
| 最近净化记录 | 时间 / 模型 / 字数 / 剔除数 / 提示词 sha256 前缀 |
| 高级 YAML | 直接编辑同一份文件（保存时连同注释写回） |

预览与测试挑哪条路由：**净化路由清单里的第一个 provider 的真实组装**优先；没有就退到最近一次组装（会标注「非净化路由」）；再没有就用内置样本（`test/fixtures/assembly.json`，随安装走），所以第一次进页面就能测。

宿主端接口（同源，挂在 `/clean-route` 前缀）：

```
GET  /clean-route/state        规则模型 + 默认 YAML + provider + 最近组装 + 净化记录 + xhigh 状态
POST /clean-route/rules        { mode: "model", model } | { mode: "yaml", text }，先校验后写盘
POST /clean-route/preview      {} 用已保存规则；{ yaml } 或 { model } 用草稿规则（不写盘）
POST /clean-route/verify       同上；用净化后的提示词真发一次请求，回报 ok / 失败码 / 耗时
GET  /clean-route/xhigh        补丁状态
POST /clean-route/xhigh/apply  尝试写入（宿主未退出会 409 并给出指引）
```

## 安装

插件是宿主半 + 客户端半（客户端半声明在 `package.json` 的 `dsh.client`）。

**从市场安装（推荐）**：DSH 插件页 → 发现 → 添加索引源，索引地址

```text
https://fujunchao.github.io/dsh-plugins/index.json
```

然后在「模型与供应商」分类里安装 `dsh-clean-route`。装完刷新页面；宿主半要重启一次 DSH 才生效。

**在仓库里开发时用本地 link**，省得每次改都重装：

```powershell
npm install      # 唯一依赖：yaml
```

把本目录 link 进 profile 的 `node_modules`（即 `~/.dsh/profiles/node_modules/dsh-clean-route`）。本包自带 `cordis.patch.yml`，市场安装时 DSH 会按它插行；手工 link 时不要再往 profile 的 `cordis.patch.yml` 里插同一个 id —— 同一行被插两次会变成「不可寻址行」，插件管理器就再也开关不了它。

安装后入口：**插件页 → dsh-clean-route → 配置**。

## 验证

```bash
npm test                                 # 43 个单测：规则、净化、asar、HTTP 接口、插件接线
node scripts/probe.mjs                   # 用当前规则渲染一遍，查残留
node scripts/probe.mjs --live --base-url https://…/v1beta   # 再真打一次上游（另需 GOOGLE_API_KEY），应为 200
node scripts/build-fixture.mjs           # 宿主升级后重建 test/fixtures/assembly.json
```

`probe.mjs` 是那套 A/B 的固化版：DSH 升级或规则改动后跑一次，就能知道「净化后上游还认不认得出来」。

## xhigh 补丁托管

第四档 xhigh 的缺口在 `@earendil-works/pi-ai` 内部（thinking level 表与两个 switch），插件层造不出档位，只能把宿主那三处改动写回去：

```bash
node scripts/xhigh.mjs status                  # 检测（插件在宿主内也会自动定位并记住路径）
node scripts/xhigh.mjs apply                   # 写入（必须先完全退出宿主）
node scripts/xhigh.mjs restore <备份文件>       # 回滚
```

宿主升级会冲掉补丁，`status` 会立刻变红；症状是选择 xhigh 档时报 `Unsupported Google thinking level mapping`。

## 已知边界

- 设置页保存表单模式时会重写规则表文件的注释头；想保留自己的注释，就在「高级 YAML」里编辑（文本原样写回）。
- 「测试跑通」发的是一条**不带工具**的最小对话（约 128 token），用来回答「这条规则还能不能被上游接受」；它不验证工具调用是否能走通——那是正常聊天的职责。
- **会话标题 LLM 不走`system-prompt/assemble`**：它有自己的 system 字符串。标题指到 deepseek 时无影响；哪天指到净化路由要另加规则。
- 净化只作用在系统提示词与 runtime context；工具声明（含 MCP 工具）与历史消息一律原样透传。
- 归档形态的宿主必须先关掉才能打 xhigh 补丁；打补丁前的备份是整份 `app.asar`（约 209 MB）。
