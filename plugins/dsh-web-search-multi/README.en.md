# dsh-web-search-multi

English | [中文](README.md)

A multi-backend web search provider plugin for **DeepSeek Harness (dsh)**. It plugs into the `ctx.web` search seam and powers the built-in `web_search` tool with pluggable search backends.

---

## Features

- Tavily search backend
- Grok / xAI search backend (OpenAI Responses API)
- OpenAI search backend (Responses API)
- Gemini search backend (Google Search grounding)
- Customizable API keys, endpoints, and model names
- Configurable from a dedicated page in the dsh settings sidebar (Settings → Web Search): switch between the four backends, edit credentials and endpoints, and run a one-click connection test
- Only the selected backend's settings are shown in the UI
- DSH `0.1.0-rc.7` and `0.1.1-rc.2` compatibility: prevents blank continuation frames from erasing a streamed tool-call identity and causing `unknown tool ""` followed by HTTP 422

## Supported Backends

| Backend | Default Endpoint | Default Model | Real Web Search |
| --- | --- | --- | --- |
| Tavily | `https://api.tavily.com` | — | ✅ |
| Grok / xAI | `https://api.x.ai/v1` | `grok-4.6` | ✅ (official xAI API required) |
| OpenAI | `https://api.openai.com/v1` | `gpt-5.6` | ✅ |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | `gemini-3.6-flash` | ✅ |

> Note: Some third-party proxies may accept the request but do not actually execute server-side web search. For Grok, use the official xAI API to get real search results and citations.

## Installation

Open the DSH plugin page → **Discover** → **Add index source** and paste the index URL
`https://fujunchao.github.io/dsh-plugins/index.json`, then install **dsh-web-search-multi** from the card.
The package is a bundle (`package.json` declares `dsh.bundle.patch`), so DSH inserts the
`web-search-multi` row itself — default `provider: tavily`, with the four credential names already filled
in — and no profile editing is needed for the row.

Two steps remain after installing:

1. **Restart dsh**; the settings page then shows **Settings → Web Search**.
2. **Point the built-in web service at this provider**: add `searchProvider: multi` to the `web` row of
   your profile patch and disable the built-in `web-search-deepseek` row, otherwise `web_search` keeps
   using DSH's own backend:

   ```yaml
   - id: web
     config:
       searchProvider: multi

   - id: web-search-deepseek
     disabled: true
   ```

   Both rows are yours; the plugin never rewrites them. Afterwards pick a backend, add a key and press
   **Test connection** in **Settings → Web Search**.

To upgrade, install the newer version from the same card and restart dsh.

## DSH Tool-Call Compatibility Fix

Some OpenAI-compatible gateways send `id: ""` and `name: null` continuation frames after the first valid tool-call frame. Both DSH `0.1.0-rc.7` and `0.1.1-rc.2` let those frames erase the identity, resulting in:

```text
Error: unknown tool ""
Upstream request failed: [missing_required_parameter] Field required
```

Starting with `v0.1.1`, this plugin preserves the last non-empty ID and name for each streamed tool call at the LLM boundary. The compatibility layer also protects non-search tool calls while the plugin is loaded, without changing valid identities.

## Configuration

Edit `~/.dsh/settings.yaml`:

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

Add API keys to `~/.dsh/.credentials.yaml`:

```yaml
TAVILY_API_KEY: tvly-...
XAI_API_KEY: xai-...
OPENAI_API_KEY: sk-...
GEMINI_API_KEY: AIza...
```

## Web UI

After installation and a dsh restart, open:

> Settings → Web Search

The page shows the active backend and its credential status up front. Switch between
backends with the pills, edit the API key, endpoint, and model of the selected backend
(inactive backends can be pre-configured and activated in one click), and use
**Test connection** to run a real search against the saved configuration.

Starting with `v0.1.2`, the package ships both the Host settings namespace and a `dsh.client` browser card. Older versions only registered the Host half, so search worked but no configuration card appeared in the UI.

## License

MIT
