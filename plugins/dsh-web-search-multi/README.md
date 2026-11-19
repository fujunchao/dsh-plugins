# dsh-web-search-multi

[English](README.en.md) | 中文

一个用于 **DeepSeekRuntime (dsh)** 的多后端联网搜索插件。它接入 `ctx.web` 搜索能力，为内置的 `web_search` 工具提供可切换的搜索后端。

---

## 功能特性

- Tavily 搜索后端
- Grok / xAI 搜索后端（OpenAI Responses API）
- OpenAI 搜索后端（Responses API）
- Gemini 搜索后端（Google Search grounding）
- 可自定义 API Key、Endpoint、模型名
- 设置侧边栏独立配置页（设置 → Web 搜索）：四后端切换、凭据与端点编辑、一键「测试连接」实测后端可用性
- UI 只显示当前编辑后端的配置项；未启用的后端可预先配好再一键切换
- 兼容 DSH `0.1.0-rc.7` 与 `0.1.1-rc.2`：防止部分 OpenAI 兼容网关的空白流式帧把工具调用名称覆盖为空，避免 `unknown tool ""` 和后续 HTTP 422

## 支持的后端

| 后端 | 默认端点 | 默认模型 | 真实联网搜索 |
| --- | --- | --- | --- |
| Tavily | `https://api.tavily.com` | — | ✅ |
| Grok / xAI | `https://api.x.ai/v1` | `grok-4.6` | ✅（需要官方 xAI API） |
| OpenAI | `https://api.openai.com/v1` | `gpt-5.6` | ✅ |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | `gemini-3.6-flash` | ✅ |

> 注意：部分第三方代理可能接受请求，但不会真正执行服务端搜索。Grok 请使用官方 xAI API 才能获得真实搜索结果和引用来源。

## 安装

DSH 插件页 → **发现** → **添加索引源** → 粘贴索引地址 `https://fujunchao.github.io/dsh-plugins/index.json`，
然后在卡片里安装 **dsh-web-search-multi**。本包是 bundle（`package.json` 声明 `dsh.bundle.patch`），
安装时由 DSH 自动插入 `web-search-multi` 这一行（默认 `provider: tavily`，四个后端的凭据名按标准
环境变量名给好），不需要手改 profile。

装完还需要两步收尾：

1. **重启 dsh**，设置页出现「设置 → Web 搜索」。
2. **让内置 web 服务改用本 provider**：在 profile 的 `web` 行加 `searchProvider: multi`（必要时把自带的
   `web-search-deepseek` 行设为 `disabled: true`），否则 `web_search` 仍走 DSH 自带后端：

   ```yaml
   - id: web
     config:
       searchProvider: multi

   - id: web-search-deepseek
     disabled: true
   ```

   这两行是用户自己的行，插件不会代改。之后在「设置 → Web 搜索」里选后端、填 key、点「测试连接」。

## DSH 工具调用兼容修复

部分 OpenAI 兼容网关会在第一个有效的工具调用帧之后继续发送 `id: ""`、`name: null`。DSH `0.1.0-rc.7` 与 `0.1.1-rc.2` 都会把已经收到的工具调用标识覆盖为空，表现为：

```text
Error: unknown tool ""
Upstream request failed: [missing_required_parameter] Field required
```

从 `v0.1.1` 开始，本插件会在 LLM 流边界保留每个工具调用最后一个非空的 ID 和名称。修复对搜索以外的流式工具调用同样有效，但不会更改已有的合法标识。

## 配置

编辑 `~/.dsh/settings.yaml`：

```yaml
web-search-multi:
  provider: tavily # tavily | grok | openai | gemini

  tavilyApiKeyEnv: TAVILY_API_KEY
  tavilyBaseURL: https://api.tavily.com
  tavilyMaxResults: 8
  tavilySearchDepth: basic
  tavilyIncludeAnswer: true

  grokApiKeyEnv: XAI_API_KEY
  grokBaseURL: https://api.x.ai/v1
  grokModel: grok-4.6

  openaiApiKeyEnv: OPENAI_API_KEY
  openaiBaseURL: https://api.openai.com/v1
  openaiModel: gpt-5.6

  geminiApiKeyEnv: GEMINI_API_KEY
  geminiBaseURL: https://generativelanguage.googleapis.com/v1beta
  geminiModel: gemini-3.6-flash
```

在 `~/.dsh/.credentials.yaml` 中添加 API Key：

```yaml
TAVILY_API_KEY: tvly-...
XAI_API_KEY: xai-...
OPENAI_API_KEY: sk-...
GEMINI_API_KEY: AIza...
```

bundle 的 `cordis.patch.yml` 只写中性默认（`provider` 与四个 `*ApiKeyEnv`），不写任何个人中转
`baseURL` 和私有模型名；`baseURL` / `*Model` 一律走上表里的 Config 默认值，需要改就在设置页里改。

## Web UI 配置

安装并重启 dsh 后，打开：

> 设置 → Web 搜索

页面顶部展示当前后端与凭据状态；用胶囊切换四个后端，编辑所选后端的 API Key、Endpoint 与模型名
（未启用的后端可预先配置，再一键「设为当前后端」）；「测试连接」会按已保存配置对该后端发起一次真实搜索，
直接在页面里看到延迟、来源数与样例链接。

`v0.3.0` 起配置页挂在设置侧边栏（`settings.section` 槽位）；`v0.1.2`–`v0.2.x` 的版本则以折叠卡片形式挂在
「设置 → 插件 → 插件配置」下。

## 开发

零构建（`lib/` 手写 JS）。测试：`npm test`（node --test）。本仓库不含 `node_modules`，测试需要
`@deepseek-ai/dsh-web`、`@deepseek-ai/dsh-credentials` 等宿主包，要在带依赖的环境（安装后的 profile
或本地 `npm install`）里跑。

## 开源协议

MIT
