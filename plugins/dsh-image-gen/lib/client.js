window.__ModuleLoader__.load({
  id: "dsh-image-gen",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    const SETTINGS_NAMESPACE = "image-gen";
    const LOCALE_NAMESPACE = "image-gen.settings";
    const CHECK_API = "/dsh-image-gen/api/check";
    const TEST_API = "/dsh-image-gen/api/test";
    const DEFAULTS = {
      baseURL: "https://api.openai.com/v1",
      model: "gpt-image-2.5",
      apiKeyEnv: "IMAGE_GEN_API_KEY",
      size: "auto",
      quality: "medium",
      outputFormat: "png",
      outputDir: "images",
      n: 1,
      timeoutSeconds: 300,
    };
    const QUALITIES = ["low", "medium", "high", "auto"];
    const OUTPUT_FORMATS = ["png", "jpeg", "webp"];
    const SETTINGS_FIELDS = [
      { key: "baseURL", type: "string" },
      { key: "model", type: "string" },
      { key: "apiKeyEnv", type: "string" },
      { key: "size", type: "string" },
      { key: "quality", type: "string" },
      { key: "outputFormat", type: "string" },
      { key: "outputDir", type: "string" },
      { key: "n", type: "number" },
      { key: "timeoutSeconds", type: "number" },
    ];

    const zh = {
      navTitle: "图片生成",
      heroKicker: "DSH · IMAGE GENERATION",
      heroTitle: "图片生成（gpt-image）",
      heroSubtitle: "通过 OpenAI Images 兼容端点为模型提供 generate_image / edit_image 工具。端点与模型名可自定义；API Key 只写入 DSH 凭据服务，不会回显到浏览器。",
      endpoint: "当前端点",
      loading: "正在读取图片生成配置…",
      unavailable: "当前部署没有提供此配置命名空间。",
      apiKeyEnv: "API Key 凭据名",
      apiKeyEnvHint: "对应 ~/.dsh/.credentials.yaml 中的键名；未配置时自动回退 OPENAI_API_KEY。",
      apiKey: "API Key",
      apiKeyHint: "密钥只写入凭据服务，不会从网页回显；留空会保留现有密钥。",
      configured: "已配置",
      notConfigured: "未配置",
      checking: "检查中",
      baseURL: "API 端点",
      baseURLHint: "OpenAI Images 兼容根地址（如 https://api.openai.com/v1），不要附加 /images/generations。",
      model: "模型名",
      modelHint: "默认 gpt-image-2.5；可换成端点支持的任意图片模型。",
      size: "默认尺寸",
      sizeHint: "auto 或 宽x高（如 1024x1024、2048x1152、1024x1536），宽高比须在 1:3~3:1。",
      quality: "默认质量",
      qualityHint: "low 最快最便宜；medium 均衡；high 精细但大图约需 2 分钟。",
      outputFormat: "输出格式",
      outputFormatHint: "透明底需要 png 或 webp。",
      outputDir: "输出目录",
      outputDirHint: "绝对路径或相对工作区根的目录，缺省 images/。",
      n: "默认张数",
      nHint: "每次调用的默认生成张数（1-4，按张计费）。",
      timeoutSeconds: "超时（秒）",
      timeoutSecondsHint: "high 质量大图建议 300-600 秒。",
      overridden: "已覆盖",
      testConnection: "测试生成",
      testing: "生成测试图…",
      testHint: "会用 low 质量真实生成一张 1024x1024 测试图（约 $0.006），验证端点与密钥可用。",
      testBlocked: "有未保存修改，请先保存再测试。",
      testOk: "生成成功",
      testFailed: "测试失败",
      save: "保存",
      saving: "保存中…",
      discard: "放弃修改",
      saved: "图片生成配置已保存。",
      saveFailed: "保存失败，请检查配置或服务日志。",
      invalidCredential: "API Key 凭据名不能为空。",
      invalidURL: "API 端点必须是有效 URL。",
      invalidModel: "模型名不能为空。",
      invalidSize: "尺寸应为 auto 或 宽x高（如 2048x1152）。",
      invalidN: "默认张数必须是 1-4 的整数。",
      invalidTimeout: "超时必须是 30-900 的整数（秒）。",
    };

    const en = {
      navTitle: "Image Generation",
      heroKicker: "DSH · IMAGE GENERATION",
      heroTitle: "Image generation (gpt-image)",
      heroSubtitle: "Provides generate_image / edit_image tools via an OpenAI Images compatible endpoint. Endpoint and model are configurable; API keys are stored in the DSH credentials service only and never echoed back to the browser.",
      endpoint: "Endpoint",
      loading: "Loading image generation settings…",
      unavailable: "This deployment does not expose the settings namespace.",
      apiKeyEnv: "API key credential name",
      apiKeyEnvHint: "The key in ~/.dsh/.credentials.yaml; falls back to OPENAI_API_KEY when unset.",
      apiKey: "API key",
      apiKeyHint: "The key is write-only and never returned to the browser; leave blank to keep the stored key.",
      configured: "Configured",
      notConfigured: "Not configured",
      checking: "Checking",
      baseURL: "API endpoint",
      baseURLHint: "OpenAI Images compatible root URL (e.g. https://api.openai.com/v1), without /images/generations.",
      model: "Model",
      modelHint: "Defaults to gpt-image-2.5; any image model the endpoint serves.",
      size: "Default size",
      sizeHint: "auto or WxH (e.g. 1024x1024, 2048x1152, 1024x1536); ratio must be within 1:3~3:1.",
      quality: "Default quality",
      qualityHint: "low is fastest and cheapest; medium balances; high takes ~2 minutes for large images.",
      outputFormat: "Output format",
      outputFormatHint: "Transparent backgrounds need png or webp.",
      outputDir: "Output directory",
      outputDirHint: "Absolute path or a directory relative to the workspace root; defaults to images/.",
      n: "Default count",
      nHint: "Default images per call (1-4, billed per image).",
      timeoutSeconds: "Timeout (seconds)",
      timeoutSecondsHint: "300-600 is recommended for high-quality large images.",
      overridden: "Overridden",
      testConnection: "Test generation",
      testing: "Generating test image…",
      testHint: "Really generates one low-quality 1024x1024 test image (~$0.006) to verify the endpoint and key.",
      testBlocked: "Save pending changes before testing.",
      testOk: "Generation OK",
      testFailed: "Test failed",
      save: "Save",
      saving: "Saving…",
      discard: "Discard changes",
      saved: "Image generation settings saved.",
      saveFailed: "Save failed. Check the configuration or service logs.",
      invalidCredential: "API key credential name cannot be empty.",
      invalidURL: "API endpoint must be a valid URL.",
      invalidModel: "Model name cannot be empty.",
      invalidSize: "Size must be auto or WxH (e.g. 2048x1152).",
      invalidN: "Default count must be an integer between 1 and 4.",
      invalidTimeout: "Timeout must be an integer between 30 and 900 seconds.",
    };

    const styles = `
.dig-root{display:flex;flex-direction:column;gap:16px;min-width:0;color:var(--dsw-alias-label-primary,#111827)}
.dig-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:20px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:16px;background:linear-gradient(135deg,rgba(49,91,255,.10),rgba(45,212,191,.07) 58%,transparent)}
.dig-hero::after{content:"";position:absolute;width:170px;height:170px;right:-66px;top:-78px;border:22px solid rgba(49,91,255,.08);border-radius:50%;pointer-events:none}
.dig-kicker{color:var(--dsw-alias-label-secondary,#667085);font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}
.dig-title{margin:4px 0 5px;font-size:22px;line-height:1.2;font-weight:720;letter-spacing:-.025em}
.dig-subtitle{max-width:650px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:1.6}
.dig-hero-card{z-index:1;display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:150px;padding:12px 14px;border:1px solid rgba(127,127,127,.13);border-radius:12px;background:var(--dsw-alias-bg-base,rgba(255,255,255,.72));backdrop-filter:blur(9px)}
.dig-hero-card-label{color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.dig-hero-card-value{font-size:15px;font-weight:680;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dig-hero-card-state{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:11px;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dig-dot{width:7px;height:7px;border-radius:50%;background:#98a2b3;flex:none}
.dig-dot--ok{background:#12b76a}
.dig-section{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:14px;background:var(--dsw-alias-bg-layer-3,transparent);padding:4px 16px}
.dig-status{color:var(--dsw-alias-label-tertiary,#98a2b3);margin:12px 0;font-size:12px;line-height:1.5}
.dig-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.dig-field+.dig-field{border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.12))}
.dig-field-head{display:flex;align-items:center;gap:8px}
.dig-label{min-width:0;flex:1;color:var(--dsw-alias-label-primary,#111827);font-size:13px;font-weight:500;line-height:1.5}
.dig-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10));color:var(--dsw-alias-label-secondary,#667085);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}
.dig-input,.dig-select{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.9));height:34px;font:inherit;color:var(--dsw-alias-label-primary,#111827);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.dig-input:focus-visible,.dig-select:focus-visible{border-color:var(--dsw-alias-brand-primary,#315bff);outline:none}
.dig-input:disabled,.dig-select:disabled{color:var(--dsw-alias-label-tertiary,#98a2b3);cursor:default}
.dig-secret-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
.dig-secret-state{white-space:nowrap;color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:12px}
.dig-hint{color:var(--dsw-alias-label-tertiary,#98a2b3);margin:0;font-size:12px;line-height:1.5}
.dig-test-result{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.6}
.dig-test-result--ok{background:rgba(18,183,106,.10)}
.dig-test-result--bad{background:rgba(240,68,56,.10)}
.dig-test-result b{font-weight:680}
.dig-footer{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:11px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:14px;background:var(--dsw-alias-bg-base,rgba(255,255,255,.88));backdrop-filter:blur(12px);box-shadow:0 6px 22px rgba(16,24,40,.10)}
.dig-message{min-width:0;flex:1;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#667085)}
.dig-message[data-error=true]{color:var(--dsw-alias-label-error,#d92d20)}
.dig-button{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#667085);padding:5px 14px;font-size:13px;line-height:1.5}
.dig-button:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.4))}
.dig-button-primary{border-color:transparent;background:var(--dsw-alias-label-primary,#111827);color:var(--dsw-alias-bg-layer-3,#fff)}
.dig-button:disabled{opacity:.4;cursor:default}
.dig-spacer{flex:1}
@media (max-width:760px){.dig-hero{grid-template-columns:1fr}.dig-hero-card{min-width:0}}
@media (prefers-reduced-motion:reduce){.dig-root *{transition:none!important;animation:none!important}}
`;

    function installStyles() {
      if (typeof document === "undefined") return;
      const id = "dsh-image-gen/client";
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-image-gen";
      tag.dataset.pluginCss = id;
      tag.textContent = styles;
      document.head.appendChild(tag);
    }

    function normalizedConfig(value) {
      const source = value !== null && typeof value === "object" ? value : {};
      const normalized = {};
      for (const field of SETTINGS_FIELDS) {
        const fallback = DEFAULTS[field.key];
        const current = source[field.key] ?? fallback;
        normalized[field.key] = field.type === "number" ? Number(current) : String(current);
      }
      return normalized;
    }

    function userOverrides(snapshot, key) {
      return snapshot.user !== null
        && typeof snapshot.user === "object"
        && Object.hasOwn(snapshot.user, key);
    }

    function sameDraftValue(field, left, right) {
      if (field.type === "number") return Number(left) === Number(right);
      return String(left) === String(right);
    }

    function draftValue(field, draft) {
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
      if (String(draft.apiKeyEnv).trim() === "") return t("invalidCredential");
      if (!canParseURL(String(draft.baseURL).trim())) return t("invalidURL");
      if (String(draft.model).trim() === "") return t("invalidModel");
      const size = String(draft.size).trim().toLowerCase();
      if (size !== "auto" && !/^\d{1,4}x\d{1,4}$/.test(size)) return t("invalidSize");
      if (!Number.isInteger(Number(draft.n)) || Number(draft.n) < 1 || Number(draft.n) > 4) return t("invalidN");
      const timeout = Number(draft.timeoutSeconds);
      if (!Number.isInteger(timeout) || timeout < 30 || timeout > 900) return t("invalidTimeout");
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
        { className: "dig-field" },
        React.createElement(
          "div",
          { className: "dig-field-head" },
          React.createElement("span", { className: "dig-label" }, label),
          overridden ? React.createElement("span", { className: "dig-badge" }, t("overridden")) : null,
        ),
        children,
        hint ? React.createElement("p", { className: "dig-hint" }, hint) : null,
      );
    }

    function TextInput({ value, onChange, disabled, type = "text", inputMode }) {
      return React.createElement("input", {
        className: "dig-input",
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
          { className: "dig-test-result dig-test-result--ok" },
          React.createElement(
            "b",
            null,
            `✓ ${t("testOk")} · ${result.endpointHost} · ${result.model ?? ""} · ${result.latencyMs}ms · ${result.bytes ?? 0}B`,
          ),
        );
      }
      return React.createElement(
        "div",
        { className: "dig-test-result dig-test-result--bad" },
        React.createElement("b", null, `✗ ${t("testFailed")} · ${result.endpointHost ?? ""}${result.latencyMs ? ` · ${result.latencyMs}ms` : ""}`),
        React.createElement("span", null, result.error),
      );
    }

    function ImageGenSettingsPage({ scope, credentials, t }) {
      const snapshot = useScopeSnapshot(scope);
      const baseline = normalizedConfig(snapshot.value);
      const [draft, setDraft] = React.useState(() => normalizedConfig(scope.getSnapshot().value));
      const [secretDraft, setSecretDraft] = React.useState("");
      const [touched, setTouched] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState("");
      const [failed, setFailed] = React.useState(false);
      const [credentialRefresh, setCredentialRefresh] = React.useState(0);
      const [credential, setCredential] = React.useState({ ref: "", configured: false, writable: true, checking: false });
      const [live, setLive] = React.useState(null);
      const [test, setTest] = React.useState({ running: false, result: null });
      const savingRef = React.useRef(false);

      const edit = (key, value) => {
        setDraft((current) => ({ ...current, [key]: value }));
        setTouched(true);
        setMessage("");
        setFailed(false);
      };

      const editSecret = (value) => {
        setSecretDraft(value);
        setTouched(true);
        setMessage("");
        setFailed(false);
      };

      React.useEffect(() => {
        if (snapshot.status !== "ready" || touched || savingRef.current) return;
        setDraft(normalizedConfig(snapshot.value));
      }, [snapshot.status, snapshot.revision, touched]);

      const credentialRefName = String(draft.apiKeyEnv ?? "").trim();

      React.useEffect(() => {
        let alive = true;
        if (credentialRefName === "") {
          setCredential({ ref: "", configured: false, writable: true, checking: false });
          return () => {
            alive = false;
          };
        }
        setCredential((current) => ({ ...current, ref: credentialRefName, checking: true }));
        const timer = window.setTimeout(async () => {
          try {
            const response = await credentials.describe([credentialRefName]);
            if (!alive || !response.ok) return;
            const view = response.value[credentialRefName];
            setCredential({
              ref: credentialRefName,
              configured: view?.configured ?? false,
              writable: view?.writable ?? true,
              checking: false,
            });
          } catch {
            if (alive) setCredential({ ref: credentialRefName, configured: false, writable: true, checking: false });
          }
        }, 180);
        return () => {
          alive = false;
          window.clearTimeout(timer);
        };
      }, [credentials, credentialRefName, credentialRefresh]);

      const refreshLive = React.useCallback(async () => {
        try {
          const response = await fetch(CHECK_API);
          const payload = await response.json();
          if (payload?.ok) setLive(payload.value);
        } catch {
          /* settings 页可能部署在无 webServer 的环境 */
        }
      }, []);

      React.useEffect(() => {
        void refreshLive();
      }, [refreshLive, credentialRefresh]);

      const configDirty = snapshot.status === "ready" && SETTINGS_FIELDS.some((field) => !sameDraftValue(field, draft[field.key], baseline[field.key]));
      const secretDirty = secretDraft.trim() !== "";
      const dirty = configDirty || secretDirty;
      const invalid = validationFailure(draft, t);

      const discard = () => {
        setDraft(normalizedConfig(scope.getSnapshot().value));
        setSecretDraft("");
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
          const key = secretDraft.trim();
          if (key !== "") {
            const response = await credentials.set(credentialRefName, key);
            if (!response.ok) throw new Error("credential write was rejected");
          }
          setDraft(normalizedConfig(scope.getSnapshot().value));
          setSecretDraft("");
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
          const response = await fetch(TEST_API, { method: "POST" });
          const result = await response.json();
          setTest({ running: false, result });
        } catch (error) {
          setTest({
            running: false,
            result: { ok: false, endpointHost: "", latencyMs: 0, error: error instanceof Error ? error.message : String(error) },
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

      const select = (key, options_, onChange) => React.createElement("select", {
        className: "dig-select",
        value: draft[key],
        disabled: saving,
        onChange: (event) => onChange(event.target.value),
      }, options_.map((entry) => React.createElement("option", { key: entry, value: entry }, entry)));

      let body;
      if (snapshot.status === "loading") {
        body = React.createElement("p", { className: "dig-status" }, t("loading"));
      } else if (snapshot.status !== "ready") {
        body = React.createElement("p", { className: "dig-status" }, t("unavailable"));
      } else {
        const qualityOptions = QUALITIES.includes(draft.quality) ? QUALITIES : [draft.quality, ...QUALITIES];
        const formatOptions = OUTPUT_FORMATS.includes(draft.outputFormat) ? OUTPUT_FORMATS : [draft.outputFormat, ...OUTPUT_FORMATS];

        const controls = [
          field("baseURL", "baseURL", "baseURLHint", React.createElement(TextInput, {
            value: draft.baseURL,
            disabled: saving,
            onChange: (value) => edit("baseURL", value),
          })),
          field("model", "model", "modelHint", React.createElement(TextInput, {
            value: draft.model,
            disabled: saving,
            onChange: (value) => edit("model", value),
          })),
          field("apiKeyEnv", "apiKeyEnv", "apiKeyEnvHint", React.createElement(TextInput, {
            value: draft.apiKeyEnv,
            disabled: saving,
            onChange: (value) => edit("apiKeyEnv", value),
          })),
          React.createElement(Field, {
            key: "api-key",
            label: t("apiKey"),
            hint: t("apiKeyHint"),
            overridden: false,
            t,
          }, React.createElement(
            "div",
            { className: "dig-secret-row" },
            React.createElement(TextInput, {
              type: "password",
              value: secretDraft,
              disabled: saving || !credential.writable,
              onChange: editSecret,
            }),
            React.createElement(
              "span",
              { className: "dig-secret-state" },
              credential.checking ? t("checking") : credential.configured ? t("configured") : t("notConfigured"),
            ),
          )),
          field("size", "size", "sizeHint", React.createElement(TextInput, {
            value: draft.size,
            disabled: saving,
            onChange: (value) => edit("size", value),
          })),
          field("quality", "quality", "qualityHint", select("quality", qualityOptions, (value) => edit("quality", value))),
          field("outputFormat", "outputFormat", "outputFormatHint", select("outputFormat", formatOptions, (value) => edit("outputFormat", value))),
          field("outputDir", "outputDir", "outputDirHint", React.createElement(TextInput, {
            value: draft.outputDir,
            disabled: saving,
            onChange: (value) => edit("outputDir", value),
          })),
          field("n", "n", "nHint", React.createElement(TextInput, {
            value: draft.n,
            disabled: saving,
            inputMode: "numeric",
            onChange: (value) => edit("n", value),
          })),
          field("timeoutSeconds", "timeoutSeconds", "timeoutSecondsHint", React.createElement(TextInput, {
            value: draft.timeoutSeconds,
            disabled: saving,
            inputMode: "numeric",
            onChange: (value) => edit("timeoutSeconds", value),
          })),
        ];

        body = React.createElement(
          React.Fragment,
          null,
          React.createElement("div", { className: "dig-section" }, ...controls),
          React.createElement(TestResult, { result: test.result, t }),
          React.createElement(
            "div",
            { className: "dig-footer" },
            React.createElement("p", { className: "dig-message", "data-error": failed || invalid !== "" }, invalid || message || (dirty ? t("testBlocked") : t("testHint"))),
            React.createElement("button", {
              type: "button",
              className: "dig-button",
              disabled: test.running || saving || dirty || invalid !== "" || snapshot.status !== "ready",
              title: dirty ? t("testBlocked") : "",
              onClick: () => void runTest(),
            }, t(test.running ? "testing" : "testConnection")),
            React.createElement("span", { className: "dig-spacer" }),
            React.createElement("button", {
              type: "button",
              className: "dig-button",
              disabled: saving || !dirty,
              onClick: discard,
            }, t("discard")),
            React.createElement("button", {
              type: "button",
              className: "dig-button dig-button-primary",
              disabled: saving || !dirty || invalid !== "",
              onClick: () => void save(),
            }, t(saving ? "saving" : "save")),
          ),
        );
      }

      const heroHost = live?.endpointHost ?? "";
      return React.createElement(
        "div",
        { className: "dig-root" },
        React.createElement(
          "section",
          { className: "dig-hero" },
          React.createElement(
            "div",
            null,
            React.createElement("div", { className: "dig-kicker" }, t("heroKicker")),
            React.createElement("h2", { className: "dig-title" }, t("heroTitle")),
            React.createElement("div", { className: "dig-subtitle" }, t("heroSubtitle")),
          ),
          React.createElement(
            "div",
            { className: "dig-hero-card" },
            React.createElement("span", { className: "dig-hero-card-label" }, t("endpoint")),
            React.createElement("span", { className: "dig-hero-card-value" }, heroHost || String(draft.baseURL ?? "")),
            live === null
              ? React.createElement("span", { className: "dig-hero-card-state" }, React.createElement("span", { className: "dig-dot" }), credential.checking ? t("checking") : credential.configured ? t("configured") : t("notConfigured"))
              : React.createElement(
                  "span",
                  { className: "dig-hero-card-state" },
                  React.createElement("span", { className: `dig-dot${live.apiKeyConfigured ? " dig-dot--ok" : ""}` }),
                  live.apiKeyConfigured ? `${live.model} · ${live.apiKeySource}` : `${live.model} · ${t("notConfigured")}`,
                ),
          ),
        ),
        body,
      );
    }

    const inject = ["slots", "locale", "remote", "remote.credentials", "configForms"];

    function apply(ctx) {
      installStyles();
      const t = ctx.locale.bind(LOCALE_NAMESPACE);
      ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), "dsh-image-gen: settings locale");
      const scope = ctx.configForms.get(SETTINGS_NAMESPACE);
      const credentials = ctx.remote.credentials;
      ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register({
            name: "settings.section",
            id: SETTINGS_NAMESPACE,
            order: 65,
            label: () => t("navTitle"),
            locale: LOCALE_NAMESPACE,
            inject: () => ({ scope, credentials, t }),
          }, ImageGenSettingsPage))), "dsh-image-gen: settings section");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
