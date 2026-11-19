window.__ModuleLoader__.load({
  id: "dsh-web-search-multi",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    const SETTINGS_NAMESPACE = "web-search-multi";
    const LOCALE_NAMESPACE = "web-search-multi.settings";
    const PROVIDERS = ["tavily", "grok", "openai", "gemini"];
    const TEST_API = "/web-search-multi/api/test";
    const DEFAULTS = {
      provider: "tavily",
      tavilyApiKeyEnv: "TAVILY_API_KEY",
      tavilyBaseURL: "https://api.tavily.com",
      tavilyMaxResults: 8,
      tavilySearchDepth: "basic",
      tavilyIncludeAnswer: true,
      grokApiKeyEnv: "XAI_API_KEY",
      grokBaseURL: "https://api.x.ai/v1",
      grokModel: "grok-4.6",
      openaiApiKeyEnv: "OPENAI_API_KEY",
      openaiBaseURL: "https://api.openai.com/v1",
      openaiModel: "gpt-5.6",
      geminiApiKeyEnv: "GEMINI_API_KEY",
      geminiBaseURL: "https://generativelanguage.googleapis.com/v1beta",
      geminiModel: "gemini-3.6-flash",
    };
    const SETTINGS_FIELDS = [
      { key: "provider", type: "string" },
      { key: "tavilyApiKeyEnv", type: "string" },
      { key: "tavilyBaseURL", type: "string" },
      { key: "tavilyMaxResults", type: "number" },
      { key: "tavilySearchDepth", type: "string" },
      { key: "tavilyIncludeAnswer", type: "boolean" },
      { key: "grokApiKeyEnv", type: "string" },
      { key: "grokBaseURL", type: "string" },
      { key: "grokModel", type: "string" },
      { key: "openaiApiKeyEnv", type: "string" },
      { key: "openaiBaseURL", type: "string" },
      { key: "openaiModel", type: "string" },
      { key: "geminiApiKeyEnv", type: "string" },
      { key: "geminiBaseURL", type: "string" },
      { key: "geminiModel", type: "string" },
    ];

    const zh = {
      navTitle: "Web 搜索",
      heroKicker: "DSH · WEB SEARCH PROVIDER",
      heroTitle: "多后端 Web 搜索",
      heroSubtitle: "为内置 web_search 工具选择 Tavily、Grok、OpenAI 或 Gemini 后端。API Key 只写入 DSH 凭据服务，不会回显到浏览器。",
      activeProvider: "当前后端",
      inUse: "使用中",
      inactiveNote: "正在编辑此后端的配置，但它尚未启用。",
      setActive: "设为当前后端",
      loading: "正在读取搜索配置…",
      unavailable: "当前部署没有提供此配置命名空间。",
      tavily: "Tavily",
      grok: "Grok / xAI",
      openai: "OpenAI",
      gemini: "Gemini",
      apiKeyEnv: "API Key 凭据名",
      apiKeyEnvHint: "对应 ~/.dsh/.credentials.yaml 中的键名，也可由启动环境提供。",
      apiKey: "API Key",
      apiKeyHint: "密钥只写入凭据服务，不会从网页回显；留空会保留现有密钥。",
      configured: "已配置",
      notConfigured: "未配置",
      checking: "检查中",
      baseURL: "API Endpoint",
      baseURLHint: "填写 API 根地址，不要附加具体搜索方法路径。",
      model: "模型",
      modelHint: "该后端执行联网搜索时使用的模型名。",
      maxResults: "最大结果数",
      maxResultsHint: "Tavily 单次搜索最多返回的结果数量。",
      searchDepth: "搜索深度",
      searchDepthHint: "basic 更快，advanced 搜索更深入。",
      includeAnswer: "包含 Tavily 汇总答案",
      overridden: "已覆盖",
      testConnection: "测试连接",
      testing: "测试中…",
      testBlocked: "有未保存修改，请先保存再测试。",
      testOk: "连接正常",
      testSources: "条来源",
      testFailed: "测试失败",
      save: "保存",
      saving: "保存中…",
      discard: "放弃修改",
      saved: "搜索配置已保存。",
      saveFailed: "保存失败，请检查配置或服务日志。",
      invalidCredential: "每个后端的 API Key 凭据名都不能为空。",
      invalidURL: "每个后端都必须填写有效的 API Endpoint。",
      invalidModel: "Grok、OpenAI 和 Gemini 的模型名不能为空。",
      invalidMaxResults: "Tavily 最大结果数必须是大于 0 的整数。",
      invalidSearchDepth: "Tavily 搜索深度不能为空。",
    };

    const en = {
      navTitle: "Web Search",
      heroKicker: "DSH · WEB SEARCH PROVIDER",
      heroTitle: "Multi-backend Web search",
      heroSubtitle: "Pick Tavily, Grok, OpenAI, or Gemini for the built-in web_search tool. API keys are stored in the DSH credentials service only and never echoed back to the browser.",
      activeProvider: "Active backend",
      inUse: "In use",
      inactiveNote: "You are editing this backend, but it is not active yet.",
      setActive: "Make active",
      loading: "Loading search settings…",
      unavailable: "This deployment does not expose the settings namespace.",
      tavily: "Tavily",
      grok: "Grok / xAI",
      openai: "OpenAI",
      gemini: "Gemini",
      apiKeyEnv: "API key credential name",
      apiKeyEnvHint: "The key in ~/.dsh/.credentials.yaml, or a value supplied by the launch environment.",
      apiKey: "API key",
      apiKeyHint: "The key is write-only and never returned to the browser; leave blank to keep the stored key.",
      configured: "Configured",
      notConfigured: "Not configured",
      checking: "Checking",
      baseURL: "API endpoint",
      baseURLHint: "Enter the API root URL without a concrete search method path.",
      model: "Model",
      modelHint: "Model used by this backend for web search.",
      maxResults: "Maximum results",
      maxResultsHint: "Maximum number of Tavily results per search.",
      searchDepth: "Search depth",
      searchDepthHint: "basic is faster; advanced searches more deeply.",
      includeAnswer: "Include Tavily answer summary",
      overridden: "Overridden",
      testConnection: "Test connection",
      testing: "Testing…",
      testBlocked: "Save pending changes before testing.",
      testOk: "Connection OK",
      testSources: "sources",
      testFailed: "Test failed",
      save: "Save",
      saving: "Saving…",
      discard: "Discard changes",
      saved: "Search settings saved.",
      saveFailed: "Save failed. Check the configuration or service logs.",
      invalidCredential: "Every backend must have an API key credential name.",
      invalidURL: "Every backend must have a valid API endpoint.",
      invalidModel: "Grok, OpenAI, and Gemini must have a model name.",
      invalidMaxResults: "Tavily maximum results must be a positive integer.",
      invalidSearchDepth: "Tavily search depth cannot be empty.",
    };

    const styles = `
.wsm-root{display:flex;flex-direction:column;gap:16px;min-width:0;color:var(--dsw-alias-label-primary,#111827)}
.wsm-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:20px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:16px;background:linear-gradient(135deg,rgba(49,91,255,.10),rgba(45,212,191,.07) 58%,transparent)}
.wsm-hero::after{content:"";position:absolute;width:170px;height:170px;right:-66px;top:-78px;border:22px solid rgba(49,91,255,.08);border-radius:50%;pointer-events:none}
.wsm-kicker{color:var(--dsw-alias-label-secondary,#667085);font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}
.wsm-title{margin:4px 0 5px;font-size:22px;line-height:1.2;font-weight:720;letter-spacing:-.025em}
.wsm-subtitle{max-width:650px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:1.6}
.wsm-hero-card{z-index:1;display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:150px;padding:12px 14px;border:1px solid rgba(127,127,127,.13);border-radius:12px;background:var(--dsw-alias-bg-base,rgba(255,255,255,.72));backdrop-filter:blur(9px)}
.wsm-hero-card-label{color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.wsm-hero-card-value{font-size:16px;font-weight:680}
.wsm-hero-card-state{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:11px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsm-dot{width:7px;height:7px;border-radius:50%;background:#98a2b3;flex:none}
.wsm-dot--ok{background:#12b76a}
.wsm-pills{display:flex;gap:5px;padding:4px;border-radius:12px;background:var(--dsw-alias-bg-sunken,rgba(127,127,127,.08));flex-wrap:wrap}
.wsm-pill{appearance:none;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:7px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary,#667085);padding:6px 13px;font-size:13px;line-height:1.5}
.wsm-pill:hover{background:var(--dsw-alias-bg-hover,rgba(127,127,127,.06))}
.wsm-pill[data-active=true]{background:var(--dsw-alias-bg-base,rgba(255,255,255,.92));color:var(--dsw-alias-label-primary,#111827);font-weight:620;box-shadow:0 1px 4px rgba(16,24,40,.12)}
.wsm-pill-badge{padding:1px 7px;border-radius:999px;background:rgba(49,91,255,.10);color:#315bff;font-size:10px;font-weight:680}
.wsm-inactive-note{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border:1px solid rgba(247,144,9,.35);border-radius:12px;background:rgba(247,144,9,.08);color:var(--dsw-alias-label-primary,#111827);font-size:12px;line-height:1.5}
.wsm-section{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:14px;background:var(--dsw-alias-bg-layer-3,transparent);padding:4px 16px}
.wsm-status{color:var(--dsw-alias-label-tertiary,#98a2b3);margin:12px 0;font-size:12px;line-height:1.5}
.wsm-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.wsm-field+.wsm-field{border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.12))}
.wsm-field-head{display:flex;align-items:center;gap:8px}
.wsm-label{min-width:0;flex:1;color:var(--dsw-alias-label-primary,#111827);font-size:13px;font-weight:500;line-height:1.5}
.wsm-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10));color:var(--dsw-alias-label-secondary,#667085);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}
.wsm-input,.wsm-select{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.9));height:34px;font:inherit;color:var(--dsw-alias-label-primary,#111827);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.wsm-input:focus-visible,.wsm-select:focus-visible{border-color:var(--dsw-alias-brand-primary,#315bff);outline:none}
.wsm-input:disabled,.wsm-select:disabled{color:var(--dsw-alias-label-tertiary,#98a2b3);cursor:default}
.wsm-secret-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
.wsm-secret-state{white-space:nowrap;color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:12px}
.wsm-hint{color:var(--dsw-alias-label-tertiary,#98a2b3);margin:0;font-size:12px;line-height:1.5}
.wsm-check{display:flex;align-items:center;gap:9px;color:var(--dsw-alias-label-primary,#111827);font-size:13px}
.wsm-check input{width:16px;height:16px;accent-color:#315bff}
.wsm-test-result{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.6}
.wsm-test-result--ok{background:rgba(18,183,106,.10)}
.wsm-test-result--bad{background:rgba(240,68,56,.10)}
.wsm-test-result b{font-weight:680}
.wsm-test-samples{display:flex;flex-direction:column;gap:3px;margin:0;padding:0;list-style:none}
.wsm-test-samples a{color:#315bff;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.wsm-test-samples a:hover{text-decoration:underline}
.wsm-test-host{color:var(--dsw-alias-label-tertiary,#98a2b3)}
.wsm-footer{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:11px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:14px;background:var(--dsw-alias-bg-base,rgba(255,255,255,.88));backdrop-filter:blur(12px);box-shadow:0 6px 22px rgba(16,24,40,.10)}
.wsm-message{min-width:0;flex:1;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#667085)}
.wsm-message[data-error=true]{color:var(--dsw-alias-label-error,#d92d20)}
.wsm-button{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#667085);padding:5px 14px;font-size:13px;line-height:1.5}
.wsm-button:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.4))}
.wsm-button-primary{border-color:transparent;background:var(--dsw-alias-label-primary,#111827);color:var(--dsw-alias-bg-layer-3,#fff)}
.wsm-button:disabled{opacity:.4;cursor:default}
.wsm-spacer{flex:1}
@media (max-width:760px){.wsm-hero{grid-template-columns:1fr}.wsm-hero-card{min-width:0}}
@media (prefers-reduced-motion:reduce){.wsm-root *{transition:none!important;animation:none!important}}
`;

    function installStyles() {
      if (typeof document === "undefined") return;
      const id = "dsh-web-search-multi/client";
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-web-search-multi";
      tag.dataset.pluginCss = id;
      tag.textContent = styles;
      document.head.appendChild(tag);
    }

    function normalizedConfig(value) {
      const source = value !== null && typeof value === "object" ? value : {};
      const provider = PROVIDERS.includes(source.provider) ? source.provider : DEFAULTS.provider;
      const normalized = { provider };
      for (const field of SETTINGS_FIELDS.slice(1)) {
        const fallback = DEFAULTS[field.key];
        const current = source[field.key] ?? fallback;
        normalized[field.key] = field.type === "boolean" ? current === true : String(current);
      }
      return normalized;
    }

    function userOverrides(snapshot, key) {
      return snapshot.user !== null
        && typeof snapshot.user === "object"
        && Object.hasOwn(snapshot.user, key);
    }

    function sameDraftValue(field, left, right) {
      if (field.type === "boolean") return left === right;
      return String(left) === String(right);
    }

    function draftValue(field, draft) {
      if (field.type === "boolean") return draft[field.key] === true;
      if (field.type === "number") return Number(draft[field.key]);
      return String(draft[field.key]).trim();
    }

    function canParseURL(value) {
      try {
        if (typeof URL.canParse === "function") return URL.canParse(value);
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }

    function validationFailure(draft, t) {
      for (const provider of PROVIDERS) {
        if (String(draft[`${provider}ApiKeyEnv`]).trim() === "") return t("invalidCredential");
        if (!canParseURL(String(draft[`${provider}BaseURL`]).trim())) return t("invalidURL");
      }
      for (const provider of ["grok", "openai", "gemini"]) {
        if (String(draft[`${provider}Model`]).trim() === "") return t("invalidModel");
      }
      const maxResults = Number(draft.tavilyMaxResults);
      if (!Number.isInteger(maxResults) || maxResults < 1) return t("invalidMaxResults");
      if (String(draft.tavilySearchDepth).trim() === "") return t("invalidSearchDepth");
      return "";
    }

    function useScopeSnapshot(scope) {
      return React.useSyncExternalStore(
        (listener) => scope.subscribe(listener),
        () => scope.getSnapshot(),
        () => scope.getSnapshot(),
      );
    }

    function Field({ label, hint, overridden, t, children }) {
      return React.createElement(
        "div",
        { className: "wsm-field" },
        React.createElement(
          "div",
          { className: "wsm-field-head" },
          React.createElement("span", { className: "wsm-label" }, label),
          overridden ? React.createElement("span", { className: "wsm-badge" }, t("overridden")) : null,
        ),
        children,
        hint ? React.createElement("p", { className: "wsm-hint" }, hint) : null,
      );
    }

    function TextInput({ value, onChange, disabled, type = "text", inputMode }) {
      return React.createElement("input", {
        className: "wsm-input",
        type,
        value,
        disabled,
        autoComplete: type === "password" ? "off" : undefined,
        inputMode,
        onChange: (event) => onChange(event.target.value),
      });
    }

    function TestResult({ result, t }) {
      if (result === null) return null;
      if (result.ok) {
        return React.createElement(
          "div",
          { className: "wsm-test-result wsm-test-result--ok" },
          React.createElement(
            "span",
            null,
            React.createElement("b", null, `✓ ${t("testOk")} · ${result.provider} · ${result.latencyMs}ms · ${result.sourceCount} ${t("testSources")}`),
          ),
          result.sample.length > 0
            ? React.createElement(
              "ul",
              { className: "wsm-test-samples" },
              result.sample.map((source) => React.createElement(
                "li",
                { key: source.url },
                React.createElement("a", { href: source.url, target: "_blank", rel: "noreferrer noopener" },
                  source.title ?? source.url),
                React.createElement("span", { className: "wsm-test-host" }, ` ${new URL(source.url).hostname}`),
              )),
            )
            : null,
        );
      }
      return React.createElement(
        "div",
        { className: "wsm-test-result wsm-test-result--bad" },
        React.createElement("b", null, `✗ ${t("testFailed")} · ${result.provider} · ${result.latencyMs}ms`),
        React.createElement("span", null, result.error),
      );
    }

    function SearchSettingsPage({ scope, credentials, t }) {
      const snapshot = useScopeSnapshot(scope);
      const baseline = normalizedConfig(snapshot.value);
      const [panel, setPanel] = React.useState(null);
      const [draft, setDraft] = React.useState(() => normalizedConfig(scope.getSnapshot().value));
      const [secretDrafts, setSecretDrafts] = React.useState({ tavily: "", grok: "", openai: "", gemini: "" });
      const [touched, setTouched] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState("");
      const [failed, setFailed] = React.useState(false);
      const [credentialRefresh, setCredentialRefresh] = React.useState(0);
      const [credential, setCredential] = React.useState({ ref: "", configured: false, writable: true, checking: false });
      const [test, setTest] = React.useState({ running: false, result: null });
      const savingRef = React.useRef(false);

      const edit = (key, value) => {
        setDraft((current) => ({ ...current, [key]: value }));
        setTouched(true);
        setMessage("");
        setFailed(false);
      };

      const editSecret = (provider, value) => {
        setSecretDrafts((current) => ({ ...current, [provider]: value }));
        setTouched(true);
        setMessage("");
        setFailed(false);
      };

      React.useEffect(() => {
        if (snapshot.status !== "ready" || touched || savingRef.current) return;
        setDraft(normalizedConfig(snapshot.value));
      }, [snapshot.status, snapshot.revision, touched]);

      const provider = PROVIDERS.includes(draft.provider) ? draft.provider : DEFAULTS.provider;
      const activePanel = panel ?? provider;
      const envKey = `${activePanel}ApiKeyEnv`;
      const baseURLKey = `${activePanel}BaseURL`;
      const modelKey = `${activePanel}Model`;
      const credentialRef = String(draft[envKey] ?? "").trim();

      React.useEffect(() => {
        let alive = true;
        if (credentialRef === "") {
          setCredential({ ref: "", configured: false, writable: true, checking: false });
          return () => {
            alive = false;
          };
        }
        setCredential((current) => ({ ...current, ref: credentialRef, checking: true }));
        const timer = window.setTimeout(async () => {
          try {
            const response = await credentials.describe([credentialRef]);
            if (!alive || !response.ok) return;
            const view = response.value[credentialRef];
            setCredential({
              ref: credentialRef,
              configured: view?.configured ?? false,
              writable: view?.writable ?? true,
              checking: false,
            });
          } catch {
            if (alive) setCredential({ ref: credentialRef, configured: false, writable: true, checking: false });
          }
        }, 180);
        return () => {
          alive = false;
          window.clearTimeout(timer);
        };
      }, [credentials, credentialRef, credentialRefresh]);

      const configDirty = snapshot.status === "ready" && SETTINGS_FIELDS.some((field) => !sameDraftValue(field, draft[field.key], baseline[field.key]));
      const secretDirty = PROVIDERS.some((entry) => secretDrafts[entry].trim() !== "");
      const dirty = configDirty || secretDirty;
      const invalid = validationFailure(draft, t);

      const switchPanel = (entry) => {
        setPanel(entry);
        setTest({ running: false, result: null });
      };

      const discard = () => {
        setDraft(normalizedConfig(scope.getSnapshot().value));
        setSecretDrafts({ tavily: "", grok: "", openai: "", gemini: "" });
        setTouched(false);
        setMessage("");
        setFailed(false);
        setTest({ running: false, result: null });
      };

      const save = async () => {
        if (saving || !dirty || invalid !== "" || snapshot.status !== "ready") return;
        setSaving(true);
        savingRef.current = true;
        setMessage("");
        setFailed(false);
        setTest({ running: false, result: null });
        const changed = SETTINGS_FIELDS.filter((field) => !sameDraftValue(field, draft[field.key], baseline[field.key]));
        try {
          for (const field of changed) {
            if (!(await scope.set(field.key, draftValue(field, draft)))) {
              throw new Error("settings write was rejected");
            }
          }
          const accepted = normalizedConfig(scope.getSnapshot().value);
          for (const entry of PROVIDERS) {
            const key = secretDrafts[entry].trim();
            if (key === "") continue;
            const ref = String(draft[`${entry}ApiKeyEnv`]).trim();
            const response = await credentials.set(ref, key);
            if (!response.ok) throw new Error("credential write was rejected");
          }
          setDraft(accepted);
          setSecretDrafts({ tavily: "", grok: "", openai: "", gemini: "" });
          setTouched(false);
          setMessage(t("saved"));
          setCredentialRefresh((current) => current + 1);
        } catch {
          setMessage(t("saveFailed"));
          setFailed(true);
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      };

      const runTest = async () => {
        if (test.running || dirty || invalid !== "") return;
        setTest({ running: true, result: null });
        try {
          const response = await fetch(TEST_API, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider: activePanel }),
          });
          const result = await response.json();
          setTest({ running: false, result });
        } catch (error) {
          setTest({
            running: false,
            result: { ok: false, provider: activePanel, latencyMs: 0, error: error instanceof Error ? error.message : String(error) },
          });
        }
      };

      const field = (key, labelKey, hintKey, input) => React.createElement(Field, {
        key,
        label: t(labelKey),
        hint: hintKey ? t(hintKey) : "",
        overridden: userOverrides(snapshot, key),
        t,
      }, input);

      const activeCredentialRef = String(draft[`${provider}ApiKeyEnv`] ?? "").trim();

      let body;
      if (snapshot.status === "loading") {
        body = React.createElement("p", { className: "wsm-status" }, t("loading"));
      } else if (snapshot.status !== "ready") {
        body = React.createElement("p", { className: "wsm-status" }, t("unavailable"));
      } else {
        const depthOptions = ["basic", "advanced"];
        if (!depthOptions.includes(draft.tavilySearchDepth)) depthOptions.push(draft.tavilySearchDepth);

        const controls = [
          field(envKey, "apiKeyEnv", "apiKeyEnvHint", React.createElement(TextInput, {
            value: draft[envKey],
            disabled: saving,
            onChange: (value) => edit(envKey, value),
          })),
          React.createElement(Field, {
            key: `${activePanel}-api-key`,
            label: t("apiKey"),
            hint: t("apiKeyHint"),
            overridden: false,
            t,
          }, React.createElement(
            "div",
            { className: "wsm-secret-row" },
            React.createElement(TextInput, {
              type: "password",
              value: secretDrafts[activePanel],
              disabled: saving || !credential.writable,
              onChange: (value) => editSecret(activePanel, value),
            }),
            React.createElement(
              "span",
              { className: "wsm-secret-state" },
              credential.checking ? t("checking") : credential.configured ? t("configured") : t("notConfigured"),
            ),
          )),
          field(baseURLKey, "baseURL", "baseURLHint", React.createElement(TextInput, {
            value: draft[baseURLKey],
            disabled: saving,
            onChange: (value) => edit(baseURLKey, value),
          })),
        ];

        if (activePanel === "tavily") {
          controls.push(
            field("tavilyMaxResults", "maxResults", "maxResultsHint", React.createElement(TextInput, {
              value: draft.tavilyMaxResults,
              disabled: saving,
              inputMode: "numeric",
              onChange: (value) => edit("tavilyMaxResults", value),
            })),
            field("tavilySearchDepth", "searchDepth", "searchDepthHint", React.createElement("select", {
              className: "wsm-select",
              value: draft.tavilySearchDepth,
              disabled: saving,
              onChange: (event) => edit("tavilySearchDepth", event.target.value),
            }, depthOptions.map((entry) => React.createElement("option", { key: entry, value: entry }, entry)))),
            React.createElement(Field, {
              key: "tavilyIncludeAnswer",
              label: t("includeAnswer"),
              hint: "",
              overridden: userOverrides(snapshot, "tavilyIncludeAnswer"),
              t,
            }, React.createElement(
              "label",
              { className: "wsm-check" },
              React.createElement("input", {
                type: "checkbox",
                checked: draft.tavilyIncludeAnswer,
                disabled: saving,
                onChange: (event) => edit("tavilyIncludeAnswer", event.target.checked),
              }),
              t("includeAnswer"),
            )),
          );
        } else {
          controls.push(field(modelKey, "model", "modelHint", React.createElement(TextInput, {
            value: draft[modelKey],
            disabled: saving,
            onChange: (value) => edit(modelKey, value),
          })));
        }

        body = React.createElement(
          React.Fragment,
          null,
          React.createElement(
            "div",
            { className: "wsm-pills" },
            PROVIDERS.map((entry) => React.createElement(
              "button",
              {
                key: entry,
                type: "button",
                className: "wsm-pill",
                "data-active": entry === activePanel,
                onClick: () => switchPanel(entry),
              },
              t(entry),
              entry === provider ? React.createElement("span", { className: "wsm-pill-badge" }, t("inUse")) : null,
            )),
          ),
          activePanel !== provider
            ? React.createElement(
              "div",
              { className: "wsm-inactive-note" },
              React.createElement("span", null, t("inactiveNote")),
              React.createElement("button", {
                type: "button",
                className: "wsm-button",
                disabled: saving,
                onClick: () => edit("provider", activePanel),
              }, t("setActive")),
            )
            : null,
          React.createElement("div", { className: "wsm-section" }, ...controls),
          React.createElement(TestResult, { result: test.result, t }),
          React.createElement(
            "div",
            { className: "wsm-footer" },
            React.createElement("p", { className: "wsm-message", "data-error": failed || invalid !== "" }, invalid || message || (dirty ? t("testBlocked") : "")),
            React.createElement("button", {
              type: "button",
              className: "wsm-button",
              disabled: test.running || saving || dirty || invalid !== "" || snapshot.status !== "ready",
              title: dirty ? t("testBlocked") : "",
              onClick: () => void runTest(),
            }, t(test.running ? "testing" : "testConnection")),
            React.createElement("span", { className: "wsm-spacer" }),
            React.createElement("button", {
              type: "button",
              className: "wsm-button",
              disabled: saving || !dirty,
              onClick: discard,
            }, t("discard")),
            React.createElement("button", {
              type: "button",
              className: "wsm-button wsm-button-primary",
              disabled: saving || !dirty || invalid !== "",
              onClick: () => void save(),
            }, t(saving ? "saving" : "save")),
          ),
        );
      }

      return React.createElement(
        "div",
        { className: "wsm-root" },
        React.createElement(
          "section",
          { className: "wsm-hero" },
          React.createElement(
            "div",
            null,
            React.createElement("div", { className: "wsm-kicker" }, t("heroKicker")),
            React.createElement("h2", { className: "wsm-title" }, t("heroTitle")),
            React.createElement("div", { className: "wsm-subtitle" }, t("heroSubtitle")),
          ),
          React.createElement(
            "div",
            { className: "wsm-hero-card" },
            React.createElement("span", { className: "wsm-hero-card-label" }, t("activeProvider")),
            React.createElement("span", { className: "wsm-hero-card-value" }, t(provider)),
            activeCredentialRef === ""
              ? React.createElement("span", { className: "wsm-hero-card-state" }, React.createElement("span", { className: "wsm-dot" }), t("notConfigured"))
              : React.createElement("span", { className: "wsm-hero-card-state" }, React.createElement("span", { className: "wsm-dot wsm-dot--ok" }), activeCredentialRef),
          ),
        ),
        body,
      );
    }

    const inject = ["slots", "locale", "remote", "remote.credentials", "configForms"];

    function apply(ctx) {
      installStyles();
      const t = ctx.locale.bind(LOCALE_NAMESPACE);
      ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), "web-search-multi: settings locale");
      const scope = ctx.configForms.get(SETTINGS_NAMESPACE);
      const credentials = ctx.remote.credentials;
      ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register({
            name: "settings.section",
            id: SETTINGS_NAMESPACE,
            order: 64,
            label: () => t("navTitle"),
            locale: LOCALE_NAMESPACE,
            inject: () => ({ scope, credentials, t }),
          }, SearchSettingsPage))), "web-search-multi: settings section");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
