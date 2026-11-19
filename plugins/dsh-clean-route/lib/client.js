/**
 * dsh-clean-route —— 客户端半：设置 → 插件 → 净化路由 tab。
 *
 * 形态：表单（路由 / 剔除 / 人设 / 追加 / 文本规则 / 载体）＋ 高级 YAML 编辑，
 * 两者都写同一份规则表；另有净化前后预览、命中统计与 xhigh 补丁状态。
 *
 * 数据全部走宿主端的 /clean-route/* 路由（同源 fetch），不做额外 RPC 编解码。
 */

window.__ModuleLoader__.load({
  id: "dsh-clean-route",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    /** 宿主端接口前缀。 */
    const HOST = "/clean-route";
    /** 翻译命名空间。 */
    const NS = "clean-route";
    /** 本插件在插件页里的行键：<包名>#<row id>。 */
    const ROW_KEY = "dsh-clean-route#clean-route";
    /** 默认的人设替换目标 section。 */
    const PERSONA_SECTION = "deployment:persona-prefix";

    const zh = {
      tab: "净化路由",
      title: "净化路由",
      summary: "剔除上游会拒绝的提示词段落，工具声明照常透传",
      intro: "按规则剔除系统提示词里被上游识别为指纹的段落；工具声明与历史消息原样透传。",
      rulesFile: "规则表",
      sourceFile: "来自文件",
      sourceDefault: "内置默认",
      reload: "重新载入",
      reset: "恢复默认",
      save: "保存",
      saving: "保存中…",
      saved: "已保存，下一个 step 生效",
      unsaved: "有未保存的改动",
      loadFailed: "读取失败",
      saveFailed: "保存失败",
      xhighTitle: "xhigh 第四档（已迁移）",
      xhighPatched: "已打补丁，xhigh 可用",
      xhighMissing: "未打补丁：选 xhigh 会报 Unsupported Google thinking level mapping",
      xhighUnknown: "无法检查",
      xhighFix: "写入补丁",
      xhighRestart: "补丁写好后需要完全重启宿主才生效",
      xhighMounted: "宿主正在运行，app.asar 处于挂载状态（只读）：请完全退出宿主后运行下面这条命令",
      copyCommand: "复制命令",
      copied: "已复制",
      xhighFailed: "写入失败",
      xhighMoved: "xhigh 补丁托管已迁移到 dsh-model-tuning：设置 → 插件 → dsh-model-tuning → 配置 → 宿主补丁状态。本插件不再写入 app.asar，此处仅显示只读状态。",
      routesTitle: "净化路由",
      routesHint: "勾选哪些 provider 走净化；可留空表示全部。模型过滤留空即整个 provider。",
      noProviders: "宿主还没有注册任何 provider",
      modelFilter: "仅这些模型（glob，可空）",
      dropTitle: "剔除的提示词段落",
      dropHint: "名字来自真实组装（左侧长度是当前字数）。勾选即剔。",
      contextTitle: "剔除的运行时提醒",
      contextHint: "每步 system-reminder 里的同名条目。",
      personaTitle: "替换人设",
      personaHint: "让模型不再自报 DSH。留空表示不替换。",
      appendTitle: "追加段落",
      appendHint: "每行一段，追加在提示词末尾。",
      textRulesTitle: "文本兜底规则",
      textRulesHint: "按顺序作用在每个段落内部；名字变了或未知黑名单时用。",
      pattern: "匹配",
      replacement: "替换为",
      regex: "正则",
      remove: "删除",
      addRule: "添加一条规则",
      carrierTitle: "整份接管（逃生口）",
      carrierHint: "填了就用这份文本完全替代系统提示词；留空表示不启用。",
      carrierPlaceholder: "把整份提示词粘贴到这里…",
      importFile: "从文件导入",
      exportFile: "导出到文件",
      previewTitle: "净化预览",
      previewRoute: "取自",
      previewRun: "预览",
      nonCleanRoute: "（非净化路由）",
      previewEmpty: "还没有捕获到真实组装：先在净化路由上发一条消息。",
      previewChars: "字数",
      previewActions: "动作",
      previewResidue: "残留检查",
      previewResidueOk: "通过",
      previewResidueBad: "仍有残留",
      verify: "测试跑通",
      verifying: "测试中…",
      verifyOk: "跑通了：上游接受净化后的请求",
      verifyFail: "没跑通",
      verifyDetail: "耗时 {ms}ms ｜ 发送 {chars} 字 ｜ 样本 {sample}",
      verifySampleReal: "真实组装",
      verifySampleFixture: "内置样本",
      previewBefore: "净化前",
      previewAfter: "净化后",
      recentTitle: "最近的净化记录",
      recentEmpty: "还没有记录",
      advancedTitle: "高级：直接编辑 YAML",
      advancedHint: "这里改的是同一份文件；保存会连同注释一起写回。",
      validate: "校验并预览",
      loadYaml: "载入当前文件",
      invalid: "校验失败",
      validWarnings: "校验通过（有告警）",
      confirmReset: "把规则表恢复为内置默认？当前内容会被覆盖。",
      confirmCarrierImport: "导入会覆盖当前载体文本，继续？",
      none: "（无）",
      addSection: "添加段落名",
      dropAction: "剔除",
      keepAction: "保留",
      replaceAction: "替换",
    };

    const en = {
      tab: "Clean route",
      title: "Clean route",
      summary: "Strip the prompt paragraphs an upstream rejects; tools pass through",
      intro: "Strip the prompt paragraphs an upstream fingerprints, while tool declarations and history pass through untouched.",
      rulesFile: "Rules file",
      sourceFile: "from file",
      sourceDefault: "built-in default",
      reload: "Reload",
      reset: "Restore default",
      save: "Save",
      saving: "Saving…",
      saved: "Saved — applies on the next step",
      unsaved: "Unsaved changes",
      loadFailed: "Failed to load",
      saveFailed: "Failed to save",
      xhighTitle: "xhigh tier (moved)",
      xhighPatched: "Patched — xhigh available",
      xhighMissing: "Not patched: picking xhigh throws Unsupported Google thinking level mapping",
      xhighUnknown: "Cannot inspect",
      xhighFix: "Write patch",
      xhighRestart: "Restart the host fully after patching",
      xhighMounted: "The host is running, so app.asar is mounted read-only: quit the host fully, then run this command",
      copyCommand: "Copy command",
      copied: "Copied",
      xhighFailed: "Patch failed",
      xhighMoved: "xhigh patch custody moved to dsh-model-tuning: Settings → Plugins → dsh-model-tuning → Configure → host patch status. This plugin no longer writes app.asar; the status here is read-only.",
      routesTitle: "Clean routes",
      routesHint: "Providers that get scrubbed; empty means all.",
      noProviders: "No provider registered yet",
      modelFilter: "Only these models (glob, optional)",
      dropTitle: "Prompt sections to drop",
      dropHint: "Names come from a real assembly (left number is character count).",
      contextTitle: "Runtime reminders to drop",
      contextHint: "Same-named entries in the per-step system reminder.",
      personaTitle: "Replace persona",
      personaHint: "Stops the model from announcing itself. Empty means no replacement.",
      appendTitle: "Appended paragraphs",
      appendHint: "One paragraph per line, appended at the end.",
      textRulesTitle: "Fallback text rules",
      textRulesHint: "Applied in order inside each section.",
      pattern: "pattern",
      replacement: "replacement",
      regex: "regex",
      remove: "remove",
      addRule: "Add rule",
      carrierTitle: "Full takeover (escape hatch)",
      carrierHint: "When set, replaces the whole system prompt; empty disables it.",
      carrierPlaceholder: "Paste the whole prompt here…",
      importFile: "Import file",
      exportFile: "Export file",
      previewTitle: "Scrub preview",
      previewRoute: "from",
      previewRun: "Preview",
      nonCleanRoute: " (not a clean route)",
      previewEmpty: "No real assembly captured yet: send a message on a clean route first.",
      previewChars: "chars",
      previewActions: "actions",
      previewResidue: "residue",
      previewResidueOk: "clear",
      previewResidueBad: "still present",
      verify: "Run a test",
      verifying: "Testing…",
      verifyOk: "Passed: the upstream accepted the scrubbed request",
      verifyFail: "Failed",
      verifyDetail: "{ms}ms ｜ {chars} chars ｜ sample {sample}",
      verifySampleReal: "real assembly",
      verifySampleFixture: "built-in sample",
      previewBefore: "before",
      previewAfter: "after",
      recentTitle: "Recent scrubs",
      recentEmpty: "nothing yet",
      advancedTitle: "Advanced: edit YAML directly",
      advancedHint: "Same file; saving writes your comments back verbatim.",
      validate: "Validate & preview",
      loadYaml: "Load current file",
      invalid: "Invalid",
      validWarnings: "Valid (with warnings)",
      confirmReset: "Restore the built-in default rules? Current content is overwritten.",
      confirmCarrierImport: "Import overwrites the current carrier text. Continue?",
      none: "(none)",
      addSection: "Add section name",
      dropAction: "drop",
      keepAction: "keep",
      replaceAction: "replace",
    };

    /** 注入一次样式（DSH 的 CSS 变量保证明暗主题都跟着走）。 */
    const CSS = `
.cr-root{display:flex;flex-direction:column;gap:16px;max-width:820px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.cr-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-l1)}
.cr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cr-row.between{justify-content:space-between}
.cr-title{font-size:14px;font-weight:600;margin:0}
.cr-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.cr-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}
.cr-input,.cr-textarea,.cr-select{font:inherit;font-size:12px;color:inherit;background:var(--dsw-alias-bg-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 8px;width:100%;box-sizing:border-box}
.cr-textarea{min-height:88px;resize:vertical;line-height:18px}
.cr-textarea.tall{min-height:220px}
.cr-button{font:inherit;font-size:12px;cursor:pointer;border-radius:6px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-l2);color:inherit}
.cr-button[data-primary=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-label-on-business,#fff)}
.cr-button:disabled{opacity:.5;cursor:default}
.cr-check{display:flex;align-items:center;gap:6px;font-size:12px}
.cr-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}
.cr-item{display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:12px}
.cr-item .cr-name{display:flex;align-items:center;gap:6px;min-width:0}
.cr-name span.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cr-tag{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.cr-tag.bad{color:var(--dsw-alias-state-error-primary,#d33);border-color:currentColor}
.cr-tag.good{color:var(--dsw-alias-state-success-primary,#2a2);border-color:currentColor}
.cr-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cr-table{width:100%;border-collapse:collapse;font-size:12px}
.cr-table th,.cr-table td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}
.cr-table th{color:var(--dsw-alias-label-tertiary);font-weight:500}
.cr-msg{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.cr-msg.bad{color:var(--dsw-alias-state-error-primary,#d33)}
.cr-msg.good{color:var(--dsw-alias-state-success-primary,#2a2)}
.cr-pre{margin:0;padding:8px;border-radius:6px;background:var(--dsw-alias-bg-l2);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word}
`;

    function installStyles() {
      if (typeof document === "undefined") return;
      const id = "dsh-clean-route/style";
      if (document.querySelector('style[data-plugin="dsh-clean-route"]') !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-clean-route";
      tag.dataset.pluginCss = id;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** 同源 fetch；非 2xx 也把 JSON 里的错误抛出来。 */
    async function call(path, options) {
      const response = await fetch(HOST + path, {
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        ...options,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (payload === null) throw new Error("宿主返回了非 JSON 响应（" + response.status + "）");
      if (!response.ok || payload.ok === false) throw new Error(payload.error ?? "请求失败（" + response.status + "）");
      return payload;
    }

    function Button({ children, onClick, primary, disabled }) {
      return h("button", { type: "button", className: "cr-button", "data-primary": primary === true ? "true" : undefined, disabled, onClick }, children);
    }

    function Card({ title, hint, children, right }) {
      return h(
        "section",
        { className: "cr-card" },
        h("div", { className: "cr-row between" }, title === null || title === undefined ? h("span", null) : h("h3", { className: "cr-title" }, title), right ?? null),
        hint === undefined || hint === null ? null : h("p", { className: "cr-hint" }, hint),
        children,
      );
    }

    /** 表单模型 → 可提交的载荷（去掉空行）。 */
    function normalizeModel(model) {
      return {
        routes: (model.routes ?? []).filter((route) => String(route.provider ?? "").trim().length > 0),
        dropSections: (model.dropSections ?? []).filter((name) => name.length > 0),
        replaceSections: (model.replaceSections ?? []).filter((entry) => String(entry.text ?? "").length > 0),
        appendSections: (model.appendSections ?? []).filter((entry) => String(entry.text ?? "").length > 0),
        dropContexts: (model.dropContexts ?? []).filter((name) => name.length > 0),
        carrierPath: String(model.carrierPath ?? "").trim(),
        textRules: (model.textRules ?? []).filter((rule) => String(rule.pattern ?? "").length > 0),
      };
    }

    function CleanRoutePanel(props) {
      const t = props.t;
      const [state, setState] = useState(null);
      const [error, setError] = useState(null);
      const [dirty, setDirty] = useState(false);
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState(null);
      const [model, setModel] = useState(null);
      const [mode, setMode] = useState("form");
      const [yamlText, setYamlText] = useState("");
      const [preview, setPreview] = useState(null);
      const [previewError, setPreviewError] = useState(null);
      const [verify, setVerify] = useState(null);
      const [copied, setCopied] = useState(false);
      const [verifyError, setVerifyError] = useState(null);
      const fileRef = useRef(null);

      const load = useCallback(async () => {
        setError(null);
        try {
          const payload = await call("/state", { method: "GET" });
          setState(payload);
          setModel(payload.model);
          setYamlText(payload.yaml);
          setDirty(false);
        } catch (failure) {
          setError(failure.message);
        }
      }, []);

      useEffect(() => {
        void load();
      }, [load]);

      const seenSections = useMemo(() => {
        const names = new Map();
        for (const entry of state?.seen ?? []) {
          for (const section of entry.sections ?? []) {
            if (!names.has(section.name)) names.set(section.name, section.chars);
          }
        }
        for (const name of model?.dropSections ?? []) if (!names.has(name)) names.set(name, null);
        return [...names.entries()].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
      }, [state, model]);

      const seenContexts = useMemo(() => {
        const names = new Set();
        for (const entry of state?.seen ?? []) for (const context of entry.contexts ?? []) names.add(context);
        for (const name of model?.dropContexts ?? []) names.add(name);
        return [...names];
      }, [state, model]);

      const update = (patch) => {
        setModel((previous) => (previous === null ? previous : { ...previous, ...patch }));
        setDirty(true);
        setMessage(null);
      };

      const personaEntry = useMemo(() => (model?.replaceSections ?? []).find((entry) => entry.name === PERSONA_SECTION), [model]);
      const otherReplace = useMemo(() => (model?.replaceSections ?? []).filter((entry) => entry.name !== PERSONA_SECTION), [model]);

      const save = async () => {
        setBusy(true);
        setMessage(null);
        try {
          const payload =
            mode === "yaml"
              ? await call("/rules", { method: "POST", body: JSON.stringify({ mode: "yaml", text: yamlText }) })
              : await call("/rules", { method: "POST", body: JSON.stringify({ mode: "model", model: normalizeModel(model) }) });
          setState(payload);
          setModel(payload.model);
          setYamlText(payload.yaml);
          setDirty(false);
          setMessage({ kind: "good", text: t("saved") + ((payload.warnings ?? []).length > 0 ? "（告警：" + payload.warnings.join("；") + "）" : "") });
        } catch (failure) {
          setMessage({ kind: "bad", text: t("saveFailed") + "：" + failure.message });
        } finally {
          setBusy(false);
        }
      };

      const runPreview = async () => {
        setPreviewError(null);
        setBusy(true);
        try {
          const body = mode === "yaml" ? { yaml: yamlText } : {};
          const payload = await call("/preview", { method: "POST", body: JSON.stringify(body) });
          setPreview(payload);
        } catch (failure) {
          setPreview(null);
          setPreviewError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const runVerify = async () => {
        setVerifyError(null);
        setVerify(null);
        setBusy(true);
        try {
          // 表单模式把当前（可能未保存的）模型转成 YAML 当草稿；YAML 模式直接用编辑器内容。
          const body = mode === "yaml" ? { yaml: yamlText } : { model: normalizeModel(model) };
          const payload = await call("/verify", { method: "POST", body: JSON.stringify(body) });
          setVerify(payload);
        } catch (failure) {
          setVerifyError(failure.message);
        } finally {
          setBusy(false);
        }
      };

      const resetRules = async () => {
        if (typeof window !== "undefined" && !window.confirm(t("confirmReset"))) return;
        setBusy(true);
        try {
          const payload = await call("/state", { method: "GET" });
          const defaults = payload.defaults;
          if (defaults === undefined) {
            setMessage({ kind: "bad", text: t("invalid") });
            return;
          }
          const saved = await call("/rules", { method: "POST", body: JSON.stringify({ mode: "yaml", text: defaults }) });
          setState(saved);
          setModel(saved.model);
          setYamlText(saved.yaml);
          setDirty(false);
          setMessage({ kind: "good", text: t("saved") });
        } catch (failure) {
          setMessage({ kind: "bad", text: failure.message });
        } finally {
          setBusy(false);
        }
      };

      const exportCarrier = () => {
        try {
          const blob = new Blob([model?.carrierPath ?? ""], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "clean-route-carrier.md";
          anchor.click();
          URL.revokeObjectURL(url);
        } catch (failure) {
          setMessage({ kind: "bad", text: String(failure) });
        }
      };

      const importCarrier = () => fileRef.current?.click();

      const onCarrierFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file === undefined) return;
        if (typeof window !== "undefined" && !window.confirm(t("confirmCarrierImport"))) return;
        const text = await file.text();
        update({ carrierPath: text });
      };

      if (error !== null) {
        return h("div", { className: "cr-root" }, h(Card, { title: t("title"), hint: t("loadFailed") + "：" + error }, h(Button, { onClick: load }, t("reload"))));
      }
      if (state === null || model === null) {
        return h("div", { className: "cr-root" }, h(Card, { title: t("title") }, h("p", { className: "cr-hint" }, "…")));
      }

      const xhigh = state.xhigh ?? {};
      const xhighTag = xhigh.exists !== true ? { kind: "", text: t("xhighUnknown") } : xhigh.patched ? { kind: "good", text: t("xhighPatched") } : { kind: "bad", text: t("xhighMissing") };

      return h(
        "div",
        { className: "cr-root" },
        h(
          Card,
          {
            hint: t("intro"),
            right: h(
              "div",
              { className: "cr-row" },
              h("span", { className: "cr-tag" }, state.source === "file" ? t("sourceFile") : t("sourceDefault")),
              dirty ? h("span", { className: "cr-tag bad" }, t("unsaved")) : null,
              h(Button, { onClick: load, disabled: busy }, t("reload")),
              h(Button, { onClick: resetRules, disabled: busy }, t("reset")),
              h(Button, { onClick: save, primary: true, disabled: busy }, busy ? t("saving") : t("save")),
            ),
          },
          h("p", { className: "cr-hint cr-mono" }, t("rulesFile") + "：" + state.rulesPath),
          message === null ? null : h("p", { className: "cr-msg " + (message.kind === "bad" ? "bad" : "good") }, message.text),
          (state.warnings ?? []).length === 0 ? null : h("p", { className: "cr-msg bad" }, (state.warnings ?? []).join("；")),
        ),

        h(
          Card,
          {
            title: t("xhighTitle"),
            right: h("span", { className: "cr-tag " + xhighTag.kind }, xhighTag.text),
          },
          xhigh.exists !== true ? null : h("p", { className: "cr-hint cr-mono" }, (xhigh.resources ?? "") + (xhigh.form === undefined ? "" : "（" + xhigh.form + "）")),
          xhigh.exists === true && xhigh.patched !== true
            ? xhigh.archiveMounted === true
              ? h(
                  "div",
                  { className: "cr-row", style: { flexDirection: "column", alignItems: "stretch", gap: "6px" } },
                  h("span", { className: "cr-hint" }, t("xhighMounted")),
                  h("pre", { className: "cr-pre cr-mono" }, xhigh.command ?? ""),
                  h(
                    "div",
                    { className: "cr-row" },
                    h(
                      Button,
                      {
                        onClick: async () => {
                          try {
                            await navigator.clipboard.writeText(xhigh.command ?? "");
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          } catch (failure) {
                            setMessage({ kind: "bad", text: String(failure) });
                          }
                        },
                      },
                      copied ? t("copied") : t("copyCommand"),
                    ),
                  ),
                )
              : h("p", { className: "cr-hint" }, t("xhighMoved"))
            : null,
        ),

        h(
          Card,
          { title: t("routesTitle"), hint: t("routesHint") },
          (state.providers ?? []).length === 0
            ? h("p", { className: "cr-hint" }, t("noProviders"))
            : h(
                "div",
                { className: "cr-list" },
                (state.providers ?? []).map((provider) => {
                  const entry = (model.routes ?? []).find((route) => route.provider === provider.id);
                  return h(
                    "div",
                    { key: provider.id, className: "cr-item" },
                    h(
                      "label",
                      { className: "cr-check" },
                      h("input", {
                        type: "checkbox",
                        checked: entry !== undefined,
                        onChange: (event) => {
                          const routes = (model.routes ?? []).filter((route) => route.provider !== provider.id);
                          if (event.target.checked) routes.push({ provider: provider.id, model: "" });
                          update({ routes });
                        },
                      }),
                      h("span", null, provider.name + "（" + provider.id + "）"),
                    ),
                    entry === undefined
                      ? null
                      : h("input", {
                          className: "cr-input cr-mono",
                          style: { maxWidth: "220px" },
                          placeholder: t("modelFilter"),
                          value: entry.model ?? "",
                          onChange: (event) => {
                            update({ routes: (model.routes ?? []).map((route) => (route.provider === provider.id ? { ...route, model: event.target.value } : route)) });
                          },
                        }),
                  );
                }),
              ),
        ),

        h(
          Card,
          { title: t("dropTitle"), hint: t("dropHint") },
          h(
            "div",
            { className: "cr-list" },
            seenSections.map(([name, chars]) =>
              h(
                "label",
                { key: name, className: "cr-item" },
                h("span", { className: "cr-name" }, h("input", {
                  type: "checkbox",
                  checked: (model.dropSections ?? []).includes(name),
                  onChange: (event) => {
                    const drop = (model.dropSections ?? []).filter((item) => item !== name);
                    if (event.target.checked) drop.push(name);
                    update({ dropSections: drop });
                  },
                }), h("span", { className: "truncate cr-mono" }, name)),
                h("span", { className: "cr-tag" }, chars === null ? "—" : String(chars)),
              ),
            ),
          ),
        ),

        h(
          Card,
          { title: t("contextTitle"), hint: t("contextHint") },
          h(
            "div",
            { className: "cr-list" },
            seenContexts.map((name) =>
              h(
                "label",
                { key: name, className: "cr-item" },
                h("span", { className: "cr-name" }, h("input", {
                  type: "checkbox",
                  checked: (model.dropContexts ?? []).includes(name),
                  onChange: (event) => {
                    const drop = (model.dropContexts ?? []).filter((item) => item !== name);
                    if (event.target.checked) drop.push(name);
                    update({ dropContexts: drop });
                  },
                }), h("span", { className: "truncate cr-mono" }, name)),
                null,
              ),
            ),
          ),
        ),

        h(
          Card,
          { title: t("personaTitle"), hint: t("personaHint") },
          h("input", {
            className: "cr-input",
            value: personaEntry?.text ?? "",
            placeholder: "你是一个在用户本机运行的编码助手，用中文回答。",
            onChange: (event) => {
              const text = event.target.value;
              const rest = otherReplace;
              update({ replaceSections: text.length === 0 ? rest : [{ name: PERSONA_SECTION, text }, ...rest] });
            },
          }),
          otherReplace.length === 0
            ? null
            : h("p", { className: "cr-hint cr-mono" }, "额外替换：" + otherReplace.map((entry) => entry.name).join("、") + "（在高级 YAML 里编辑）"),
        ),

        h(
          Card,
          { title: t("appendTitle"), hint: t("appendHint") },
          h("textarea", {
            className: "cr-textarea cr-mono",
            value: (model.appendSections ?? []).map((entry) => entry.text).join("\n"),
            onChange: (event) => {
              const lines = event.target.value.split("\n").filter((line) => line.trim().length > 0);
              update({ appendSections: lines.map((line) => ({ name: "", text: line })) });
            },
          }),
        ),

        h(
          Card,
          { title: t("textRulesTitle"), hint: t("textRulesHint") },
          h(
            "table",
            { className: "cr-table" },
            h(
              "thead",
              null,
              h("tr", null, h("th", null, t("pattern")), h("th", null, t("replacement")), h("th", null, t("regex")), h("th", null, "")),
            ),
            h(
              "tbody",
              null,
              (model.textRules ?? []).map((rule, index) =>
                h(
                  "tr",
                  { key: index },
                  h("td", null, h("input", {
                    className: "cr-input cr-mono",
                    value: rule.pattern,
                    onChange: (event) => update({ textRules: (model.textRules ?? []).map((item, i) => (i === index ? { ...item, pattern: event.target.value } : item)) }),
                  })),
                  h("td", null, h("input", {
                    className: "cr-input cr-mono",
                    value: rule.replacement,
                    onChange: (event) => update({ textRules: (model.textRules ?? []).map((item, i) => (i === index ? { ...item, replacement: event.target.value } : item)) }),
                  })),
                  h("td", null, h("input", {
                    type: "checkbox",
                    checked: rule.regex === true,
                    onChange: (event) => update({ textRules: (model.textRules ?? []).map((item, i) => (i === index ? { ...item, regex: event.target.checked } : item)) }),
                  })),
                  h("td", null, h(Button, { onClick: () => update({ textRules: (model.textRules ?? []).filter((_item, i) => i !== index) }) }, t("remove"))),
                ),
              ),
            ),
          ),
          h("div", { className: "cr-row" }, h(Button, { onClick: () => update({ textRules: [...(model.textRules ?? []), { pattern: "", replacement: "", regex: false, flags: "" }] }) }, t("addRule"))),
        ),

        h(
          Card,
          { title: t("carrierTitle"), hint: t("carrierHint") },
          h("textarea", {
            className: "cr-textarea cr-mono tall",
            placeholder: t("carrierPlaceholder"),
            value: model.carrierPath ?? "",
            onChange: (event) => update({ carrierPath: event.target.value }),
          }),
          h(
            "div",
            { className: "cr-row" },
            h(Button, { onClick: importCarrier }, t("importFile")),
            h(Button, { onClick: exportCarrier }, t("exportFile")),
            h("input", { ref: fileRef, type: "file", accept: ".md,.txt,text/plain", style: { display: "none" }, onChange: onCarrierFile }),
            h("span", { className: "cr-hint" }, (model.carrierPath ?? "").length + " 字"),
          ),
        ),

        h(
          Card,
          {
            title: t("previewTitle"),
            hint:
              preview === null
                ? (state.seen ?? []).length === 0
                  ? t("previewEmpty")
                  : null
                : t("previewRoute") + "：" + preview.provider + "/" + preview.model + (preview.cleanRoute === false ? t("nonCleanRoute") : "") + (preview.sampleFrom === "fixture" ? "（" + t("verifySampleFixture") + "）" : ""),
            right: h(
              "div",
              { className: "cr-row" },
              h("button", { type: "button", className: "cr-button", disabled: busy, onClick: runPreview }, t("previewRun")),
              h("button", { type: "button", className: "cr-button", "data-primary": "true", disabled: busy, onClick: runVerify }, busy ? t("verifying") : t("verify")),
            ),
          },
          previewError === null ? null : h("p", { className: "cr-msg bad" }, previewError),
          verifyError === null ? null : h("p", { className: "cr-msg bad" }, t("verifyFail") + "：" + verifyError),
          verify === null
            ? null
            : h(
                "div",
                null,
                h("p", { className: "cr-msg " + (verify.ok ? "good" : "bad") }, verify.ok ? t("verifyOk") : t("verifyFail") + "：" + (verify.failureCode ?? verify.error ?? "未知错误")),
                h("p", { className: "cr-hint" }, verify.provider + "/" + verify.model + (verify.cleanRoute === false ? t("nonCleanRoute") : "") + " ｜ " + t("verifyDetail").replace("{ms}", String(verify.tookMs ?? 0)).replace("{chars}", String(verify.charsSent ?? 0)).replace("{sample}", verify.sampleFrom === "fixture" ? t("verifySampleFixture") : t("verifySampleReal"))),
                typeof verify.received === "string" && verify.received.length > 0 ? h("pre", { className: "cr-pre cr-mono" }, verify.received) : null,
              ),
          preview === null
            ? null
            : h(
                "div",
                null,
                h(
                  "p",
                  { className: "cr-msg" },
                  t("previewChars") + "：" + preview.beforeChars + " → " + preview.afterChars + " ｜ " + t("previewActions") + "：" +
                    (preview.hits.droppedSections.length > 0 ? "drop " + preview.hits.droppedSections.length + " " : "") +
                    (preview.hits.replacedSections.length > 0 ? "replace " + preview.hits.replacedSections.length + " " : "") +
                    (preview.hits.textRuleHits.length > 0 ? "rules " + preview.hits.textRuleHits.length : "") +
                    " ｜ " + t("previewResidue") + "：" + (preview.residue.length === 0 ? t("previewResidueOk") : t("previewResidueBad") + "（" + preview.residue.join(", ") + "）"),
                ),
                h(
                  "div",
                  { className: "cr-grid" },
                  h("div", null, h("p", { className: "cr-hint" }, t("previewBefore")), h("pre", { className: "cr-pre cr-mono" }, preview.beforePreview)),
                  h("div", null, h("p", { className: "cr-hint" }, t("previewAfter")), h("pre", { className: "cr-pre cr-mono" }, preview.afterPreview)),
                ),
              ),
        ),

        h(
          Card,
          { title: t("recentTitle") },
          (state.recent ?? []).length === 0
            ? h("p", { className: "cr-hint" }, t("recentEmpty"))
            : h(
                "table",
                { className: "cr-table" },
                h("thead", null, h("tr", null, h("th", null, "时间"), h("th", null, "模型"), h("th", null, "字数"), h("th", null, "剔除"), h("th", null, "sha"))),
                h(
                  "tbody",
                  null,
                  (state.recent ?? []).slice().reverse().slice(0, 12).map((record, index) =>
                    h(
                      "tr",
                      { key: index },
                      h("td", null, new Date(record.at).toLocaleTimeString()),
                      h("td", { className: "cr-mono" }, record.provider + "/" + record.model),
                      h("td", null, String(record.chars)),
                      h("td", null, String(record.hits.droppedSections.length) + " + " + String(record.hits.replacedSections.length)),
                      h("td", { className: "cr-mono" }, record.sha256.slice(0, 8)),
                    ),
                  ),
                ),
              ),
        ),

        h(
          Card,
          {
            title: t("advancedTitle"),
            hint: t("advancedHint"),
            right: h("div", { className: "cr-row" },
              h(Button, { onClick: () => { setMode(mode === "yaml" ? "form" : "yaml"); setYamlText(state.yaml); } }, mode === "yaml" ? "表单" : "YAML"),
              mode === "yaml" ? h(Button, { onClick: () => setYamlText(state.yaml) }, t("loadYaml")) : null,
              mode === "yaml" ? h(Button, { onClick: runPreview, disabled: busy }, t("validate")) : null,
            ),
          },
          mode === "yaml"
            ? h("textarea", {
                className: "cr-textarea cr-mono tall",
                value: yamlText,
                onChange: (event) => {
                  setYamlText(event.target.value);
                  setDirty(true);
                  setMessage(null);
                },
              })
            : h("p", { className: "cr-hint" }, "切到 YAML 可以直接改这份文件的全部字段（保存时连同注释写回）。"),
        ),
      );
    }

    /** 插件页的入口卡片：列表里只要一行摘要，详情页才渲染完整面板。 */
    function CleanRouteCard(props) {
      if (props.view === "summary") return props.t("summary");
      return h(CleanRoutePanel, { t: props.t });
    }

    const inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "clean-route: dictionaries");
      const t = ctx.locale.bind(NS);
      // 挂在「插件」页里本插件那一行的「配置」入口（key = <包名>#<row id>）：
      // 点开就是完整配置页。设置里的独立入口已移除。
      ctx.effect(
        () =>
          ctx.slots.inject("plugins.row.config", () =>
            ctx.slots.register(
              {
                name: "plugins.row.config",
                key: ROW_KEY,
                locale: NS,
                inject: () => ({ t }),
              },
              CleanRouteCard,
            ),
          ),
        "clean-route: plugins row config",
      );
    }

    installStyles();
    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
