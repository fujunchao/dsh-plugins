/**
 * dsh-model-tuning —— 客户端半：插件页里本插件那一行的「配置」，点开就是模型调优页。
 *
 * 四块：①新会话默认（provider → model → 思考档位，外加两个开关）
 *      ②模型高级字段（llm-pi-ai 的 providers 视图：reasoningEfforts / compat / 提供商默认值）
 *      ③宿主补丁状态（app.asar 里 pi-ai 档位表的三态 ＋ 打补丁 / 回滚）
 *      ④底部一行席位提示
 *
 * 为什么全部数据走宿主路由：客户端读不到 settings，也碰不到 asar；/model-tuning/* 是同源 JSON，
 * 插件与宿主之间不再做第二套 RPC 编解码。
 * 为什么每个数据源各自带一行错误：插件页的配置槽一旦整页空白，用户既看不到错也点不到重试，
 * 所以 /state 与 /providers 各自失败各自降级，摘要视图只靠 /state 也能出一行字。
 */

window.__ModuleLoader__.load({
  id: "dsh-model-tuning",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useState } = React;

    /** 宿主端接口前缀。 */
    const HOST = "/model-tuning";
    /** 翻译命名空间。 */
    const NS = "model-tuning";
    /** 本插件在插件页里的行键：<包名>#<row id>。 */
    const ROW_KEY = "dsh-model-tuning#model-tuning";
    /** Gemini 走的是 pi-ai 的 google-generative-ai 适配器；宿主会在 /providers 里回报真实值，这里只是兜底。 */
    const GEMINI_API = "google-generative-ai";
    /** pi-ai 认识的思考档位全集（用来判断“Gemini 路由上这一档能不能写”）。 */
    const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"];
    /** 空数组常量：让 useMemo / map 的引用稳定，不为空数据每次新建。 */
    const EMPTY = [];
    /**
     * 勾选框用的档位全集（含 off 与 max）。
     *
     * 注意别用 `REASONING_LEVELS`：那个是"升级顺序"用的展示序，故意不含 off/max；
     * 拿它渲染勾选框会让用户永远勾不到 max——而 max 正是本机在用的档位。
     */
    const ALL_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

    /**
     * 允许编辑的 compat 键（ADR 0003 精选）。
     * 只碰这几项：其余 compat 字段属于上游协议内部细节，宿主那边也没有校验，写坏只会静默失效。
     * kind 决定控件形态：boolean 是三态下拉，string / number 是文本框（留空 = 不设置）。
     */
    const COMPAT_KEYS = [
      { key: "supportsReasoningEffort", kind: "boolean" },
      { key: "thinkingFormat", kind: "string" },
      { key: "maxTokensField", kind: "string" },
      { key: "supportsDeveloperRole", kind: "boolean" },
      { key: "supportsStore", kind: "boolean" },
    ];

    /** 补丁三态（加上客户端自己的「待重启」）到徽标文案 / 颜色的映射。 */
    const PATCH_LABEL = {
      patched: "patchPatched",
      missing: "patchMissing",
      unsupported: "patchUnsupported",
      error: "patchError",
      pending: "patchPending",
    };
    const PATCH_TAG = {
      patched: "good",
      missing: "bad",
      unsupported: "warn",
      error: "bad",
      pending: "warn",
    };

    const zh = {
      tab: "模型调优",
      title: "模型调优",
      summary: "按模型设思考档位、新会话默认与 xhigh 补丁",
      summaryLoading: "读取中…",
      summaryDefaults: "默认",
      summaryTeam: "团队",
      summaryPatch: "补丁",
      on: "开",
      off: "关",
      none: "未设置",
      loading: "读取中…",
      retry: "重试",
      reload: "重新载入",
      working: "处理中…",
      saved: "已保存",
      saving: "保存中…",
      unsaved: "有未保存的改动",
      notSet: "不设置",
      remove: "删除",
      edit: "编辑",
      save: "保存",

      defaultsTitle: "新会话默认",
      defaultsHint: "只作用于新开的会话；fork、恢复与压缩沿用原来的选择。",
      providerLabel: "提供商",
      modelLabel: "模型",
      effortLabel: "思考档位",
      followModel: "跟随模型默认",
      dshDefaultTitle: "DSH 当前默认",
      dshDefaultNote: "会话内换模型会改写 DSH 默认，但不会改写这里设置的插件默认。",
      dshDefaultUnset: "主机还没报告当前默认",
      teamLabel: "新会话默认开启智能体团队",
      teamWarn: "开启后新会话会写入 team/mode 事件，旧版 DSH 无法读取这些会话",
      carryLabel: "换模型时保持思考档位",
      carryHint: "只在目标模型有同名档位时补一次，补不上就放弃、不再重试。",
      taskFirstLabel: "团队任务先行提示",
      taskFirstHint: "开启后，团队模式下的会话会多一段系统提示词：派活前先建任务，看到空板就报告而不是继续猜。它会改变提示词前缀，走指纹敏感中转站时请自行评估。",
      capsSettings: "宿主缺少 settings 服务，模型高级字段暂时不可用",
      capsLlm: "宿主缺少 llm 服务：模型清单与默认值都无法校验",
      capsAgentTeams: "宿主缺少 agentTeams 服务，这个开关不生效",
      saveDefaults: "保存为默认",

      advancedTitle: "模型高级字段",
      advancedHint: "写的是 llm-pi-ai 的 providers 视图；保存后不用重启，composer 的档位菜单立即更新。",
      noProviders: "宿主还没有注册任何提供商",
      noModels: "这个提供商下还没有模型",
      modelsCount: "个模型",
      providerDefaults: "提供商默认值",
      effortsTitle: "思考档位映射",
      effortsSwitch: "启用档位映射",
      effortsOffHint: "关闭 = 不推理，写入 reasoningEfforts: false",
      effortsUnsetHint: "当前未设置（沿用主机默认）；改动后会写成显式值",
      wireLabel: "API 参数值",
      addLevel: "添加档位",
      compatTitle: "兼容开关",
      compatHint: "留空 = 不设置这一项。",
      defaultContextWindow: "默认上下文窗口",
      defaultMaxTokens: "默认最大输出",
      defaultInput: "默认输入类型",
      inputText: "文本",
      inputImage: "图片",
      thinkingBudgets: "思考预算（档位 → token）",
      addBudget: "添加一行预算",
      defaultReasoning: "默认档位",
      saveProvider: "保存此提供商",
      savedProvider: "已保存，已热生效",
      dirtyProvider: "有未保存的改动",
      invalid: "校验未通过",
      errNonOff: "至少要保留一个非 off 的档位",
      errEmptyValue: "档位 {level} 缺少 API 参数值",
      errDuplicateLevel: "档位 {level} 重复出现",
      errGeminiLevel: "Gemini 路由只接受 {levels}（xhigh 另外取决于补丁）",
      errNumber: "{field} 需要是正整数",
      errBudgetLevel: "思考预算里有重复的档位",
      xhighWarn: "宿主补丁不在位，xhigh 请求会被 pi-ai 拒绝",

      providersTitle: "供应商",
      providersHint: "在这里新建供应商、给供应商加删模型。原生「设置 → 模型」页写的是同一份配置：两边同时改会提示「已被外部改动」，不会互相覆盖。",
      providersNoService: "宿主缺少 settings 服务，供应商管理不可用",
      providerNone: "还没有任何供应商",
      tagHandwritten: "手写路由",
      tagCatalog: "目录路由",
      tagInherited: "模型来自目录",
      tagNoKey: "未配置密钥",
      keyRef: "密钥引用：{ref}",
      keyAbsent: "没有 apiKeyEnv：靠供应商自带的凭据发现",
      modelsUnit: "个模型",
      addProvider: "+ 添加供应商",
      cancel: "取消",
      create: "创建",
      creating: "创建中…",
      removeProvider: "删除供应商",
      removeProviderConfirm: "键入 {route} 以确认删除：会一并删掉它的 {count} 个模型与派生的密钥引用。",
      confirmRemove: "确认删除",
      addModel: "+ 添加模型",
      modelRow: "模型",
      addRow: "+ 再加一行",
      removeLastModelWarn: "这是最后一个模型：删掉它等于删掉整条供应商",
      created: "已创建 {route}",
      modelAdded: "已加上 {id}",
      modelRemoved: "已删除 {id}",
      removedProvider: "{route} 已连同最后一个模型一起删除",
      undo: "撤销上一次写入",
      undoNone: "还没有可撤销的写入",
      undoAt: "快照 {when}（{label}）",
      undone: "已撤销：{label}",
      undoneWithObject: "已撤销：{label}（{object}）",
      undoneNoLabel: "已撤销上一次写入",
      // 快照 label 在宿主侧是 slug（宿主没有 i18n），说人话这层归客户端：「动作 + 对象」。
      undoLabelCreate: "新建供应商",
      undoLabelDelete: "删除供应商",
      undoLabelAddModel: "添加模型",
      undoLabelRemoveModel: "删除模型",
      undoLabelEditModel: "编辑模型",
      undoLabelEditProvider: "编辑供应商",
      undoStaleConfirm: "上次写入后这条供应商又被改过，撤销会一并覆盖那些改动。仍要撤销？",
      externalManager: "检测到 cc-switch 也在管理这份配置：这里的改动有可能被它下次同步覆盖。",
      templateLabel: "家族模板",
      tplRelay: "中转站 / OpenAI 兼容（推荐）",
      tplOpenai: "OpenAI 官方",
      tplAnthropic: "Anthropic 官方",
      tplGemini: "Google Gemini 官方",
      tplDeepseek: "DeepSeek 官方",
      tplBlank: "空白（全部自己填）",
      providerRemoved: "已删除 {route}",
      routeLabel: "route id",
      routeHint: "小写字母开头，可含数字与连字符；创建后不能改名",
      displayNameLabel: "显示名",
      baseUrlLabel: "baseURL",
      apiLabel: "协议",
      keyLabel: "API key",
      keyHint: "写进凭据库，配置里只留引用名；留空表示这个端点自带鉴权",
      modelsTitle: "模型",
      modelId: "模型 id",
      modelName: "显示名",
      contextWindow: "上下文窗口",
      maxTokens: "最大输出",
      inputLabel: "输入",
      levelsLabel: "思考档位",
      discover: "检测连通",
      discovering: "探测中…",
      discovered: "端点报告了 {count} 个模型",
      discoverHint: "只发一次列表请求，不消耗 token；密钥只用于这一次探测",
      noDiscovery: "没有探测到模型（端点可能不支持列表，或密钥不对）",
      adopt: "把勾选的加为模型行",
      needsModels: "至少要填一个模型 id",
      needsRoute: "先填一个合法的 route id",
      needsBaseUrl: "baseURL 必须是 http(s) 地址",
      modelOverridesNote: "这条路由的模型来自已安装目录：改档位写的是覆盖项，不会把整张目录抄进配置。",
      modelRenameWarn: "改名会断开历史会话里的旧选择",
      modelUpdated: "已更新 {id}",
      defaultsMigrated: "插件默认里指向旧 id 的选择也一并改了",
      providerUpdated: "已更新 {route} 的身份字段",
      reachable: "连通，{count} 个模型",
      keyKeepHint: "留空 = 不改密钥",
      needsField: "{field} 不能为空",
      confirmSaveUnchecked: "还没检测连通，仍要保存吗？",

      patchTitle: "宿主补丁状态",
      patchPatched: "在位",
      patchMissing: "被升级冲掉",
      patchUnsupported: "结构不识别",
      patchError: "读取失败",
      patchPending: "待重启",
      patchApply: "打补丁",
      patchRollback: "回滚",
      patchRestart: "需重启应用后生效",
      patchMounted: "DSH 正在运行时 app.asar 是挂载只读的，写不进去：请完全退出 DeepSeekRuntime，再在终端里跑这条命令",
      patchFallback: "也可以完全退出应用后跑上面那条命令",
      copyCommand: "复制命令",
      copied: "已复制",
      patchConfirmApply: "会改写 app.asar 里的 pi-ai 档位表（先备份再写）。继续？",
      patchConfirmRollback: "会从备份还原 app.asar 里的 pi-ai 档位表。继续？",
      patchDetail: "检测详情",
      appVersion: "应用版本",
      archivePath: "目标文件",
      backupPath: "备份",

      seatsNote: "本插件也在「设置 → 模型」页留了跳转入口。",
    };

    const en = {
      tab: "Model tuning",
      title: "Model tuning",
      summary: "Per-model thinking tiers, new-session defaults, and the xhigh patch",
      summaryLoading: "Loading…",
      summaryDefaults: "default",
      summaryTeam: "team",
      summaryPatch: "patch",
      on: "on",
      off: "off",
      none: "unset",
      loading: "Loading…",
      retry: "Retry",
      reload: "Reload",
      working: "Working…",
      saved: "Saved",
      saving: "Saving…",
      unsaved: "Unsaved changes",
      notSet: "not set",
      remove: "Remove",
      edit: "Edit",
      save: "Save",

      defaultsTitle: "New-session defaults",
      defaultsHint: "Applies to newly started sessions only; fork, resume and compaction keep the previous choice.",
      providerLabel: "Provider",
      modelLabel: "Model",
      effortLabel: "Thinking tier",
      followModel: "Follow the model default",
      dshDefaultTitle: "DSH's current default",
      dshDefaultNote: "Switching models inside a session rewrites DSH's default, but never the plugin default set here.",
      dshDefaultUnset: "The host has not reported a current default yet",
      teamLabel: "Enable agent teams for new sessions",
      teamWarn: "New sessions then carry team/mode events, and older DSH versions cannot read those sessions",
      carryLabel: "Keep the thinking tier across model switches",
      carryHint: "Restored once per switch, only when the target model has the same tier; failures are dropped.",
      taskFirstLabel: "Team task-first hint",
      taskFirstHint: "Adds one system-prompt section to team-enabled sessions: create the task before delegating, and report an empty board instead of guessing. It changes the prompt prefix, so judge it yourself on fingerprint-sensitive gateways.",
      capsSettings: "The host has no settings service, so these fields are unavailable",
      capsLlm: "The host has no llm service: neither the model list nor the defaults can be validated",
      capsAgentTeams: "The host has no agentTeams service, so this switch has no effect",
      saveDefaults: "Save as default",

      advancedTitle: "Advanced model fields",
      advancedHint: "Writes the llm-pi-ai providers view; no restart needed — the composer tier menu updates immediately.",
      noProviders: "The host has not registered any provider yet",
      noModels: "This provider has no models yet",
      modelsCount: "models",
      providerDefaults: "Provider defaults",
      effortsTitle: "Thinking-tier mapping",
      effortsSwitch: "Enable tier mapping",
      effortsOffHint: "Off = no reasoning, writes reasoningEfforts: false",
      effortsUnsetHint: "Currently unset (inherits the host default); editing writes an explicit value",
      wireLabel: "API value",
      addLevel: "Add tier",
      compatTitle: "Compat switches",
      compatHint: "Blank = leave this key unset.",
      defaultContextWindow: "Default context window",
      defaultMaxTokens: "Default max output",
      defaultInput: "Default input types",
      inputText: "text",
      inputImage: "image",
      thinkingBudgets: "Thinking budgets (tier → tokens)",
      addBudget: "Add a budget row",
      defaultReasoning: "Default tier",
      saveProvider: "Save this provider",
      savedProvider: "Saved — applied live",
      dirtyProvider: "Unsaved changes",
      invalid: "Validation failed",
      errNonOff: "Keep at least one tier other than off",
      errEmptyValue: "Tier {level} has no API value",
      errDuplicateLevel: "Tier {level} appears more than once",
      errGeminiLevel: "A Gemini route only accepts {levels} (xhigh also depends on the patch)",
      errNumber: "{field} must be a positive integer",
      errBudgetLevel: "Duplicate tier in the thinking budgets",
      xhighWarn: "The host patch is not in place, so pi-ai will reject xhigh",

      providersTitle: "Providers",
      providersHint: "Create providers and add or remove their models here. The native Models page writes the same configuration; a concurrent edit surfaces as a conflict instead of overwriting.",
      providersNoService: "The host has no settings service, so provider management is unavailable",
      providerNone: "No providers yet",
      tagHandwritten: "hand-declared",
      tagCatalog: "catalog",
      tagInherited: "models from catalog",
      tagNoKey: "no key",
      keyRef: "credential ref: {ref}",
      keyAbsent: "no apiKeyEnv: relies on the provider's own credential discovery",
      modelsUnit: "models",
      addProvider: "+ Add provider",
      cancel: "Cancel",
      create: "Create",
      creating: "Creating…",
      removeProvider: "Delete provider",
      removeProviderConfirm: "Type {route} to confirm: this also deletes its {count} model(s) and the derived credential reference.",
      confirmRemove: "Confirm delete",
      addModel: "+ Add model",
      modelRow: "Model",
      addRow: "+ Add another row",
      removeLastModelWarn: "This is the last model: deleting it deletes the whole provider",
      created: "Created {route}",
      modelAdded: "Added {id}",
      modelRemoved: "Removed {id}",
      removedProvider: "{route} was deleted together with its last model",
      undo: "Undo the last write",
      undoNone: "No write to undo yet",
      undoAt: "Snapshot {when} ({label})",
      undone: "Undone: {label}",
      undoneWithObject: "Undone: {label} ({object})",
      undoneNoLabel: "Undid the last write",
      // 快照 label 在宿主侧是 slug（宿主没有 i18n），说人话这层归客户端：「动作 + 对象」。
      undoLabelCreate: "Created provider",
      undoLabelDelete: "Deleted provider",
      undoLabelAddModel: "Added model",
      undoLabelRemoveModel: "Removed model",
      undoLabelEditModel: "Edited model",
      undoLabelEditProvider: "Edited provider",
      undoStaleConfirm: "This provider changed after the last write, so undoing would overwrite those changes too. Undo anyway?",
      externalManager: "cc-switch is also managing this configuration: changes made here may be overwritten by its next sync.",
      templateLabel: "Family template",
      tplRelay: "Relay / OpenAI-compatible (recommended)",
      tplOpenai: "OpenAI",
      tplAnthropic: "Anthropic",
      tplGemini: "Google Gemini",
      tplDeepseek: "DeepSeek",
      tplBlank: "Blank (fill everything)",
      providerRemoved: "Deleted {route}",
      routeLabel: "route id",
      routeHint: "Lowercase start, digits and hyphens allowed; it cannot be renamed later",
      displayNameLabel: "Display name",
      baseUrlLabel: "baseURL",
      apiLabel: "Protocol",
      keyLabel: "API key",
      keyHint: "Stored in the credential service; only the reference name lands in the config. Leave blank if the endpoint carries its own auth",
      modelsTitle: "Models",
      modelId: "Model id",
      modelName: "Display name",
      contextWindow: "Context window",
      maxTokens: "Max output",
      inputLabel: "Input",
      levelsLabel: "Thinking tiers",
      discover: "Probe endpoint",
      discovering: "Probing…",
      discovered: "The endpoint reported {count} model(s)",
      discoverHint: "One listing request, no tokens spent; the key is used for this probe only",
      noDiscovery: "No models discovered (the endpoint may not list them, or the key is wrong)",
      adopt: "Adopt the checked ones as model rows",
      needsModels: "At least one model id is required",
      needsRoute: "Fill in a valid route id first",
      needsBaseUrl: "baseURL must be an http(s) address",
      modelOverridesNote: "This route's models come from the installed catalog: tier edits are written as overrides, never as a copy of the catalog.",
      modelRenameWarn: "Renaming breaks the old choice recorded in past sessions",
      modelUpdated: "Updated {id}",
      defaultsMigrated: "The plugin default that pointed at the old id was updated too",
      providerUpdated: "Updated the identity fields of {route}",
      reachable: "Reachable, {count} model(s)",
      keyKeepHint: "Leave blank to keep the current key",
      needsField: "{field} cannot be empty",
      confirmSaveUnchecked: "Connectivity has not been checked yet. Save anyway?",

      patchTitle: "Host patch state",
      patchPatched: "in place",
      patchMissing: "wiped by an upgrade",
      patchUnsupported: "unrecognised structure",
      patchError: "cannot read",
      patchPending: "restart pending",
      patchApply: "Apply patch",
      patchRollback: "Roll back",
      patchRestart: "Takes effect after restarting the app",
      patchMounted: "While DSH is running, app.asar is mounted read-only and cannot be written: quit DeepSeekRuntime completely, then run this command in a terminal",
      patchFallback: "You can also quit the app and run the command above",
      copyCommand: "Copy command",
      copied: "Copied",
      patchConfirmApply: "This rewrites the pi-ai tier table inside app.asar (backup first). Continue?",
      patchConfirmRollback: "This restores the pi-ai tier table from the backup. Continue?",
      patchDetail: "Inspection detail",
      appVersion: "App version",
      archivePath: "Target file",
      backupPath: "Backup",

      seatsNote: "This plugin also leaves a jump-off entry on Settings → Models.",
    };

    /** 注入一次样式（DSH 的 CSS 变量保证明暗主题都跟着走；类名统一 mt- 前缀）。 */
    const CSS = `
.mt-root{display:flex;flex-direction:column;gap:16px;max-width:860px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.mt-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-l1)}
.mt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.mt-title{font-size:14px;font-weight:600;margin:0}
.mt-subtitle{font-size:12px;font-weight:600;margin:0;color:var(--dsw-alias-label-secondary)}
.mt-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.mt-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}
.mt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.mt-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.mt-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.mt-input,.mt-select{font:inherit;font-size:12px;color:inherit;background:var(--dsw-alias-bg-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:5px 8px;width:100%;box-sizing:border-box}
.mt-input:disabled{opacity:.6}
.mt-button{font:inherit;font-size:12px;cursor:pointer;border-radius:6px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-l2);color:inherit}
.mt-button[data-primary=true]{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary));border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
@media (hover:hover){.mt-button[data-primary=true]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary)))}}
.mt-button:disabled{opacity:.5;cursor:default}
.mt-check{display:flex;align-items:center;gap:6px;font-size:12px}
.mt-tag{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid currentColor;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.mt-tag.good{color:var(--dsw-alias-state-success-primary)}
.mt-tag.bad{color:var(--dsw-alias-state-error-primary)}
.mt-tag.warn{color:var(--dsw-alias-state-warn-primary)}
.mt-msg{font-size:12px;margin:0;color:var(--dsw-alias-label-tertiary)}
.mt-msg.good{color:var(--dsw-alias-state-success-primary)}
.mt-msg.bad{color:var(--dsw-alias-state-error-primary)}
.mt-msg.warn{color:var(--dsw-alias-state-warn-primary)}
.mt-panel{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-secondary)}
.mt-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mt-provider{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}
.mt-provider:first-of-type{border-top:none;padding-top:0}
.mt-model{display:flex;flex-direction:column;gap:6px;padding-left:10px;border-left:1px solid var(--dsw-alias-border-l2)}
.mt-editor{display:flex;flex-direction:column;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px}
.mt-effort-row{display:grid;grid-template-columns:150px 1fr auto;gap:6px;align-items:center}
.mt-compat-row{display:grid;grid-template-columns:230px 1fr;gap:6px;align-items:center}
.mt-budget-row{display:grid;grid-template-columns:150px 1fr auto;gap:6px;align-items:center}
.mt-meta{display:grid;grid-template-columns:100px 1fr;gap:6px;align-items:baseline}
.mt-path{word-break:break-all}
.mt-toggle{background:none;border:none;color:inherit;font:inherit;font-size:13px;cursor:pointer;padding:0;text-align:left;display:inline-flex;align-items:center;gap:6px;min-width:0}
.mt-details>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.mt-sub{display:flex;flex-direction:column;gap:6px}
.mt-pre{margin:0;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-l2);border:1px solid var(--dsw-alias-border-l2);white-space:pre;overflow-x:auto;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mt-provider-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mt-provider-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mt-hint-inline{font-size:11px;margin:0;color:var(--dsw-alias-label-tertiary)}
.mt-model-line{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2)}
.mt-provider-form,.mt-model-form{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-l2)}
.mt-model-form-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.mt-levels{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.mt-discovered{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:6px}
.mt-delete-confirm{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:6px}
`;

    function installStyles() {
      if (typeof document === "undefined") return;
      const id = "dsh-model-tuning/style";
      if (document.querySelector('style[data-plugin="dsh-model-tuning"]') !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-model-tuning";
      tag.dataset.pluginCss = id;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** 同源 fetch；非 2xx 也把 JSON 里的错误抛出来，并把宿主给的 code 挂在 error 上供 409 分支判断。 */
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
      // 宿主约定：成功带 ok:true，失败一律 ok:false + error{code,message}（400/409/500 都走这条）。
      if (!response.ok || payload.ok === false) {
        // 但有两种失败是平铺的：撤销的 `stale`（要连 routes 一起给）与 /provider/edit 的 `invalid`。
        // 都在这里收口，调用方只认 failure.code，不必知道是哪种封装。
        const detail = payload.error ?? (typeof payload.code === "string" ? payload : null);
        const failure = new Error((detail === null ? undefined : detail.message) ?? "请求失败（" + response.status + "）");
        failure.code = detail === null ? "http-" + response.status : detail.code;
        failure.status = response.status;
        failure.payload = payload;
        throw failure;
      }
      return payload;
    }

    /* ---------- 通用控件：都是原生元素，样式全在本文件里，不依赖客户端原语包 ---------- */

    function Button({ children, onClick, primary, disabled, title }) {
      return h("button", {
        type: "button",
        className: "mt-button",
        "data-primary": primary === true ? "true" : undefined,
        disabled: disabled === true,
        title,
        onClick,
      }, children);
    }

    function Section({ title, hint, right, children }) {
      return h(
        "section",
        { className: "mt-card" },
        h(
          "div",
          { className: "mt-head" },
          title === null || title === undefined ? h("span", null) : h("h3", { className: "mt-title" }, title),
          right ?? null,
        ),
        hint === null || hint === undefined ? null : h("p", { className: "mt-hint" }, hint),
        children,
      );
    }

    function Field({ label, children }) {
      return h("label", { className: "mt-field" }, h("span", { className: "mt-label" }, label), children);
    }

    function TextInput({ value, onChange, placeholder, disabled, mono, type, ariaLabel }) {
      return h("input", {
        className: "mt-input" + (mono === true ? " mt-mono" : ""),
        type: type ?? "text",
        value,
        placeholder: placeholder ?? "",
        disabled: disabled === true,
        "aria-label": ariaLabel ?? undefined,
        onChange: (event) => onChange(event.target.value),
      });
    }

    function Select({ value, onChange, options, disabled }) {
      return h(
        "select",
        { className: "mt-select", value, disabled: disabled === true, onChange: (event) => onChange(event.target.value) },
        options.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
      );
    }

    function Check({ checked, onChange, label, disabled }) {
      return h(
        "label",
        { className: "mt-check" },
        h("input", {
          type: "checkbox",
          checked: checked === true,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.checked),
        }),
        h("span", null, label),
      );
    }

    function Tag({ kind, children }) {
      return h("span", { className: "mt-tag" + (kind === undefined || kind === null || kind === "" ? "" : " " + kind) }, children);
    }

    function Msg({ kind, children }) {
      return h("p", { className: "mt-msg" + (kind === undefined || kind === null || kind === "" ? "" : " " + kind) }, children);
    }

    function Meta({ label, children }) {
      return h("div", { className: "mt-meta" }, h("span", { className: "mt-label" }, label), h("span", { className: "mt-mono mt-path" }, children));
    }

    /* ---------- 纯数据小工具：不碰 React，方便在渲染与保存两处复用同一套判断 ---------- */

    function pushOnce(list, message) {
      if (list.indexOf(message) === -1) list.push(message);
    }

    /**
     * 从 `/state` 的响应里取出**插件状态**（`defaults` / 三个开关 / `lastApply`）。
     *
     * `/state` 回的是一个信封：`{ state, warning, dshDefault, levels, patch, capabilities, … }`。
     * 之前页面把这个信封整个当成插件状态往下传，于是 `state.teamDefaultEnabled` 永远是
     * `undefined` —— 表现就是"我明明勾了，重新进来又是空的"（而文件里其实一直是 true）。
     * 所有需要插件状态的地方都必须经过这个函数，别直接读信封。
     */
    function payloadState(payload) {
      if (payload === null || typeof payload !== "object") return {};
      const inner = payload.state;
      return inner !== null && typeof inner === "object" ? inner : {};
    }

    function labelForProvider(provider) {
      return provider.displayName === undefined || provider.displayName === null || provider.displayName === provider.id
        ? provider.id
        : provider.displayName + "（" + provider.id + "）";
    }

    function labelForModel(model) {
      return model.name === undefined || model.name === null || model.name === model.id ? model.id : model.name + "（" + model.id + "）";
    }

    /**
     * 档位下拉的候选集合。
     * 非 Gemini 路由：宿主报什么就用什么（宿主是 llm-pi-ai 的档位全集）。
     * Gemini 路由：只列宿主 `geminiLevels` 回报的那几档；xhigh 也列出来（补丁在位才真能过），
     * 选了但补丁不在位只给黄线警告、不拦保存——拦下来会让用户以为这一档永远填不了。
     * 无论哪种，数据里已经存在的档位都保留在候选里，否则下拉框会显示成空值、用户无从改回。
     */
    function levelChoices(api, levels, currentLevels, gemini) {
      const base = Array.isArray(levels) && levels.length > 0 ? levels.slice() : ["off", "minimal", "low", "medium", "high"];
      if (api === gemini.api) {
        const list = gemini.levels.slice();
        if (list.indexOf("off") === -1) list.unshift("off");
        if (list.indexOf("xhigh") === -1) list.push("xhigh");
        for (const level of currentLevels ?? EMPTY) if (list.indexOf(level) === -1) list.push(level);
        return list;
      }
      for (const level of currentLevels ?? EMPTY) if (level !== "" && base.indexOf(level) === -1) base.push(level);
      return base;
    }

    /** Gemini 路由真正能写的档位：宿主回报的那几档 + xhigh（补丁在位才通过，不在位只警告）。 */
    function geminiAcceptedLevels(gemini) {
      const list = gemini.levels.slice();
      if (list.indexOf("xhigh") === -1) list.push("xhigh");
      return list;
    }

    /**
     * Gemini 的两条事实由宿主随 /providers 一起回报（geminiApi / geminiLevels），不在客户端写死：
     * pi-ai 升级要是换了适配器名或档位表，界面跟着宿主走，不用改这个文件。
     */
    function routeInfo(providers) {
      const source = providers === null || providers === undefined ? {} : providers;
      return {
        api: typeof source.geminiApi === "string" && source.geminiApi !== "" ? source.geminiApi : GEMINI_API,
        levels: Array.isArray(source.geminiLevels) && source.geminiLevels.length > 0 ? source.geminiLevels.slice() : ["minimal", "low", "medium", "high"],
      };
    }

    /** compat 键：宿主回报 compatKeys 就用它（kind 查表，未知的按文本框处理），否则用本文件里的精选表。 */
    function compatKeyList(providers) {
      const reported = providers === null || providers === undefined ? undefined : providers.compatKeys;
      if (!Array.isArray(reported) || reported.length === 0) return COMPAT_KEYS;
      const kinds = {};
      for (const item of COMPAT_KEYS) kinds[item.key] = item.kind;
      return reported.map((key) => ({ key, kind: kinds[key] ?? "string" }));
    }

    function effortChoices(levels, current) {
      const list = (Array.isArray(levels) ? levels : EMPTY).map((level) => ({ value: level, label: level }));
      if (current !== "" && list.every((option) => option.value !== current)) list.push({ value: current, label: current });
      return list;
    }

    function defaultEffortRows() {
      return [
        { level: "off", value: "" },
        { level: "low", value: "low" },
        { level: "medium", value: "medium" },
        { level: "high", value: "high" },
      ];
    }

    function sortEffortRows(rows) {
      const rank = (level) => {
        const index = REASONING_LEVELS.indexOf(level);
        return index === -1 ? (level === "off" ? -1 : REASONING_LEVELS.length) : index;
      };
      return rows.slice().sort((left, right) => rank(left.level) - rank(right.level));
    }

    /**
     * 宿主里的 reasoningEfforts 有三种形态：false（不推理）/ null（不设置，继承）/ 对象（档位→参数值）。
     * 开关只有两态，所以 null 也显示成「关」，并记下 stored = "unset" 给一行灰字提示；
     * 只有用户真的动过（touched）才会把 null 覆盖成 false，避免打开页面就偷偷改语义。
     */
    function draftEfforts(value) {
      if (value === false) return { on: false, rows: [], touched: false, stored: "false" };
      if (value === null || value === undefined) return { on: false, rows: defaultEffortRows(), touched: false, stored: "unset" };
      const rows = [];
      for (const level of Object.keys(value)) {
        const wire = value[level];
        rows.push({ level, value: wire === null || wire === undefined ? "" : String(wire) });
      }
      return { on: true, rows: sortEffortRows(rows), touched: false, stored: "map" };
    }

    function freshModelDraft(model) {
      // compat 草稿只装“用户动过”的键；没动过的键在渲染时从 model.compat 读，保存时原样保留。
      return { efforts: draftEfforts(model.reasoningEfforts), compat: {} };
    }

    function draftKey(providerId, modelId) {
      return providerId + "::" + modelId;
    }

    function serializeEfforts(draft) {
      if (draft.on !== true) return false;
      const out = {};
      for (const row of draft.rows) out[row.level] = row.level === "off" ? null : String(row.value).trim();
      return out;
    }

    function serializeCompat(stored, entries) {
      const base = stored !== null && typeof stored === "object" ? { ...stored } : {};
      for (const key of Object.keys(entries)) {
        const entry = entries[key];
        if (entry.mode === "unset") delete base[key];
        else base[key] = entry.value;
      }
      return Object.keys(base).length === 0 ? null : base;
    }

    function modelPayloadFor(model, draft) {
      let changed = false;
      const payload = { id: model.id };
      if (draft.efforts.touched === true) {
        payload.reasoningEfforts = serializeEfforts(draft.efforts);
        changed = true;
      }
      if (Object.keys(draft.compat).length > 0) {
        payload.compat = serializeCompat(model.compat, draft.compat);
        changed = true;
      }
      return changed ? payload : null;
    }

    function freshFieldsDraft(fields) {
      const value = fields ?? {};
      const budgets = [];
      const stored = value.thinkingBudgets;
      if (stored !== null && typeof stored === "object") {
        for (const level of Object.keys(stored)) budgets.push({ level, tokens: String(stored[level]) });
      }
      const text = (input) => (input === null || input === undefined ? "" : String(input));
      return {
        cw: text(value.defaultContextWindow),
        mt: text(value.defaultMaxTokens),
        input: Array.isArray(value.defaultInput) ? value.defaultInput.filter((item) => item === "text" || item === "image") : [],
        budgets,
        reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
        touched: false,
      };
    }

    function fieldsPayloadFor(draft) {
      const budgets = {};
      let hasBudget = false;
      for (const row of draft.budgets) {
        if (row.level === "" || row.level === undefined) continue;
        const tokens = Number(String(row.tokens).trim());
        if (!Number.isFinite(tokens)) continue;
        budgets[row.level] = tokens;
        hasBudget = true;
      }
      const number = (raw) => (String(raw).trim() === "" ? null : Number(String(raw).trim()));
      return {
        defaultContextWindow: number(draft.cw),
        defaultMaxTokens: number(draft.mt),
        defaultInput: draft.input.length === 0 ? null : draft.input.slice(),
        thinkingBudgets: hasBudget ? budgets : null,
        reasoning: draft.reasoning === "" ? null : draft.reasoning,
      };
    }

    /** 模型草稿的校验：UI 里看到的内联错误与保存前的拦截用的是同一份判断。 */
    function modelDraftIssues(provider, draft, patchState, t, gemini) {
      const errors = [];
      const warnings = [];
      const efforts = draft.efforts;
      if (efforts.on === true) {
        let nonOff = 0;
        const seen = {};
        for (const row of efforts.rows) {
          if (seen[row.level] === true) pushOnce(errors, t("errDuplicateLevel").replace("{level}", row.level));
          seen[row.level] = true;
          if (row.level === "off") continue;
          nonOff += 1;
          if (String(row.value).trim() === "") pushOnce(errors, t("errEmptyValue").replace("{level}", row.level));
          if (provider.api === gemini.api && geminiAcceptedLevels(gemini).indexOf(row.level) === -1) {
            pushOnce(errors, t("errGeminiLevel").replace("{levels}", gemini.levels.join(" / ")));
          }
          if (provider.api === gemini.api && row.level === "xhigh" && patchState !== "patched") pushOnce(warnings, t("xhighWarn"));
        }
        if (nonOff === 0) pushOnce(errors, t("errNonOff"));
      }
      return { errors, warnings };
    }

    function fieldsDraftIssues(draft, t) {
      const errors = [];
      if (draft === undefined) return errors;
      const positive = (raw, label) => {
        const text = String(raw).trim();
        if (text !== "" && !/^\d+$/.test(text)) pushOnce(errors, t("errNumber").replace("{field}", label));
      };
      positive(draft.cw, t("defaultContextWindow"));
      positive(draft.mt, t("defaultMaxTokens"));
      const seen = {};
      for (const row of draft.budgets) {
        positive(row.tokens, t("thinkingBudgets"));
        if (row.level === "") continue;
        if (seen[row.level] === true) pushOnce(errors, t("errBudgetLevel"));
        seen[row.level] = true;
      }
      return errors;
    }

    /** 一个提供商下所有草稿的毛病汇总：模型级 + 提供商级，保存按钮据此置灰。 */
    function providerIssues(provider, modelDrafts, fieldDraft, patchState, t, gemini) {
      const models = {};
      const errors = [];
      for (const model of provider.models ?? EMPTY) {
        const draft = modelDrafts[draftKey(provider.id, model.id)];
        const issue = modelDraftIssues(provider, draft ?? freshModelDraft(model), patchState, t, gemini);
        // 没动过的模型只带警告（例如存量 xhigh 而补丁不在位），不拿校验规则去挑存量配置的刺：
        // 那些值是宿主原本就接受的，红字拦截只会让用户以为自己弄坏了什么。
        models[model.id] = draft === undefined ? { errors: [], warnings: issue.warnings } : issue;
        if (draft !== undefined) for (const message of issue.errors) pushOnce(errors, message);
      }
      const fieldErrors = fieldsDraftIssues(fieldDraft, t);
      for (const message of fieldErrors) pushOnce(errors, message);
      return { models, errors, fieldErrors };
    }

    /* ---------- 第 1 块：新会话默认 ---------- */

    function DefaultsBlock(props) {
      const { t, state, providers, levels, caps, onState } = props;
      const stored = state.defaults ?? null;
      const storedProvider = stored === null ? "" : stored.provider;
      const storedModel = stored === null ? "" : stored.model;
      const storedEffort = stored === null || stored.reasoningEffort === null ? "" : stored.reasoningEffort;

      const [form, setForm] = useState({ provider: storedProvider, model: storedModel, effort: storedEffort });
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);

      // 宿主回报的默认值变了（保存成功、或别处改写）就让表单跟上；用户正在改的中间态不会被冲掉。
      useEffect(() => {
        setForm({ provider: storedProvider, model: storedModel, effort: storedEffort });
      }, [storedProvider, storedModel, storedEffort]);

      const providerList = providers === null ? EMPTY : providers.providers ?? EMPTY;
      const providerOptions = providerList.map((provider) => ({ value: provider.id, label: labelForProvider(provider) }));
      if (form.provider !== "" && providerOptions.every((option) => option.value !== form.provider)) {
        providerOptions.push({ value: form.provider, label: form.provider });
      }
      const currentProvider = providerList.find((provider) => provider.id === form.provider);
      const modelOptions = currentProvider === undefined ? [] : (currentProvider.models ?? EMPTY).map((model) => ({ value: model.id, label: labelForModel(model) }));
      if (form.model !== "" && modelOptions.every((option) => option.value !== form.model)) {
        modelOptions.push({ value: form.model, label: form.model });
      }

      const dirty = form.provider !== storedProvider || form.model !== storedModel || form.effort !== storedEffort;

      const save = async () => {
        setBusy(true);
        setNotice(null);
        try {
          const payload = await call("/defaults", {
            method: "POST",
            body: JSON.stringify({ provider: form.provider, model: form.model, reasoningEffort: form.effort === "" ? null : form.effort }),
          });
          onState(payload.state);
          setNotice({ kind: "good", text: t("saved") });
        } catch (failure) {
          setNotice({ kind: "bad", text: failure.message });
        } finally {
          setBusy(false);
        }
      };

      // 两个开关是即时生效的：翻转 → POST → 用回传的 state 覆盖，失败就保持原样并给一行错误。
      const toggle = async (path, enabled) => {
        setBusy(true);
        setNotice(null);
        try {
          const payload = await call(path, { method: "POST", body: JSON.stringify({ enabled }) });
          onState(payload.state);
        } catch (failure) {
          setNotice({ kind: "bad", text: failure.message });
        } finally {
          setBusy(false);
        }
      };

      const dsh = state.dshDefault ?? null;

      return h(
        "div",
        { className: "mt-sub" },
        h(
          "div",
          { className: "mt-grid" },
          h(
            Field,
            { label: t("providerLabel") },
            providers === null
              ? h(TextInput, { value: form.provider, mono: true, onChange: (value) => setForm({ ...form, provider: value, model: "" }) })
              : h(Select, { value: form.provider, options: providerOptions, onChange: (value) => setForm({ ...form, provider: value, model: "" }) }),
          ),
          h(
            Field,
            { label: t("modelLabel") },
            providers === null
              ? h(TextInput, { value: form.model, mono: true, onChange: (value) => setForm({ ...form, model: value }) })
              : h(Select, { value: form.model, options: modelOptions, onChange: (value) => setForm({ ...form, model: value }) }),
          ),
          h(
            Field,
            { label: t("effortLabel") },
            h(Select, {
              value: form.effort,
              options: [{ value: "", label: t("followModel") }].concat(effortChoices(levels, form.effort)),
              onChange: (value) => setForm({ ...form, effort: value }),
            }),
          ),
        ),
        caps.llm === false ? h("p", { className: "mt-hint" }, t("capsLlm")) : null,
        h(
          "div",
          { className: "mt-actions" },
          h(Button, {
            primary: true,
            disabled: busy || !dirty || form.provider === "" || form.model === "",
            onClick: () => {
              void save();
            },
          }, busy ? t("saving") : t("saveDefaults")),
          dirty ? h(Tag, { kind: "warn" }, t("unsaved")) : null,
        ),
        notice === null ? null : h(Msg, { kind: notice.kind }, notice.text),
        h(
          "div",
          { className: "mt-panel" },
          h("span", { className: "mt-label" }, t("dshDefaultTitle")),
          dsh === null
            ? h("span", { className: "mt-hint" }, t("dshDefaultUnset"))
            : h(
                "span",
                { className: "mt-mono" },
                dsh.provider + "/" + dsh.model + " ｜ " + t("effortLabel") + "：" + (dsh.reasoningEffort === null ? t("followModel") : dsh.reasoningEffort),
              ),
          h("p", { className: "mt-hint" }, t("dshDefaultNote")),
        ),
        h(
          "div",
          { className: "mt-sub" },
          h(Check, {
            checked: state.teamDefaultEnabled === true,
            disabled: busy || caps.agentTeams === false,
            label: t("teamLabel"),
            onChange: (checked) => {
              void toggle("/team-default", checked);
            },
          }),
          caps.agentTeams === false
            ? h("p", { className: "mt-hint" }, t("capsAgentTeams"))
            : state.teamDefaultEnabled === true
              ? null
              : h("p", { className: "mt-hint" }, t("teamWarn")),
        ),
        h(
          "div",
          { className: "mt-sub" },
          h(Check, {
            checked: state.carryEffort === true,
            disabled: busy,
            label: t("carryLabel"),
            onChange: (checked) => {
              void toggle("/carry-effort", checked);
            },
          }),
          h("p", { className: "mt-hint" }, t("carryHint")),
        ),
        h(
          "div",
          { className: "mt-sub" },
          h(Check, {
            checked: state.taskFirstHint === true,
            disabled: busy || caps.agentTeams === false,
            label: t("taskFirstLabel"),
            onChange: (checked) => {
              void toggle("/task-first-hint", checked);
            },
          }),
          caps.agentTeams === false
            ? h("p", { className: "mt-hint" }, t("capsAgentTeams"))
            : h("p", { className: "mt-hint" }, t("taskFirstHint")),
        ),
      );
    }

    /* ---------- 第 2 块：模型高级字段 ---------- */

    function CompatEditor(props) {
      const { t, model, draft, compatKeys, onChange } = props;
      return h(
        "div",
        { className: "mt-sub" },
        h("span", { className: "mt-subtitle" }, t("compatTitle")),
        h("p", { className: "mt-hint" }, t("compatHint")),
        compatKeys.map((item) => {
          const entry = draft.compat[item.key];
          const stored = model.compat !== null && typeof model.compat === "object" ? model.compat[item.key] : undefined;
          const current = entry !== undefined ? entry : stored === undefined ? { mode: "unset" } : { mode: "value", value: stored };
          const write = (next) => onChange({ compat: { ...draft.compat, [item.key]: next } });
          return h(
            "div",
            { className: "mt-compat-row", key: item.key },
            h("span", { className: "mt-mono" }, item.key),
            item.kind === "boolean"
              ? h(Select, {
                  value: current.mode === "unset" ? "" : String(current.value),
                  options: [
                    { value: "", label: t("notSet") },
                    { value: "true", label: "true" },
                    { value: "false", label: "false" },
                  ],
                  onChange: (raw) => write(raw === "" ? { mode: "unset" } : { mode: "value", value: raw === "true" }),
                })
              : h(TextInput, {
                  value: current.mode === "unset" ? "" : String(current.value ?? ""),
                  placeholder: t("notSet"),
                  mono: true,
                  onChange: (raw) =>
                    write(
                      String(raw).trim() === ""
                        ? { mode: "unset" }
                        : { mode: "value", value: item.kind === "number" ? Number(raw) : raw },
                    ),
                }),
          );
        }),
      );
    }

    function EffortsEditor(props) {
      const { t, provider, efforts, patchState, levels, gemini, onChange } = props;
      const rows = efforts.rows;
      const used = {};
      for (const row of rows) used[row.level] = true;
      const choices = levelChoices(provider.api, levels, rows.map((row) => row.level), gemini);
      const addable = choices.filter((level) => used[level] !== true);
      const setEfforts = (patch) => onChange({ efforts: { ...efforts, ...patch, touched: true } });

      const hint =
        efforts.on === true
          ? null
          : efforts.stored === "unset" && efforts.touched !== true
            ? h("p", { className: "mt-hint" }, t("effortsUnsetHint"))
            : h("p", { className: "mt-hint" }, t("effortsOffHint"));

      return h(
        "div",
        { className: "mt-sub" },
        h(
          "div",
          { className: "mt-head" },
          h("span", { className: "mt-subtitle" }, t("effortsTitle")),
          h(Check, {
            checked: efforts.on === true,
            label: t("effortsSwitch"),
            onChange: (checked) =>
              setEfforts({ on: checked, rows: checked && rows.length === 0 ? defaultEffortRows() : rows }),
          }),
        ),
        hint,
        efforts.on === true
          ? rows.map((row, index) =>
              h(
                "div",
                { className: "mt-effort-row", key: index },
                h(Select, {
                  value: row.level,
                  options: choices.map((level) => ({ value: level, label: level })),
                  // 从 off 换到具体档位时顺手把 API 参数值填成同名，省掉一次输入。
                  onChange: (level) =>
                    setEfforts({
                      rows: rows.map((item, i) =>
                        i === index
                          ? level === "off"
                            ? { level, value: "" }
                            : { level, value: item.level === "off" || String(item.value).trim() === "" ? level : item.value }
                          : item,
                      ),
                    }),
                }),
                h(TextInput, {
                  value: row.level === "off" ? "" : row.value,
                  disabled: row.level === "off",
                  placeholder: row.level === "off" ? "null" : t("wireLabel"),
                  mono: true,
                  onChange: (value) => setEfforts({ rows: rows.map((item, i) => (i === index ? { ...item, value } : item)) }),
                }),
                h(Button, { onClick: () => setEfforts({ rows: rows.filter((_item, i) => i !== index) }) }, t("remove")),
              ),
            )
          : null,
        efforts.on === true
          ? h(
              "div",
              { className: "mt-actions" },
              h(Button, {
                disabled: addable.length === 0,
                onClick: () => setEfforts({ rows: rows.concat([{ level: addable[0], value: addable[0] === "off" ? "" : addable[0] }]) }),
              }, t("addLevel")),
            )
          : null,
      );
    }

    function ModelEditor(props) {
      const { t, provider, model, draft, issues, patchState, levels, gemini, compatKeys, onChange } = props;
      return h(
        "div",
        { className: "mt-editor" },
        h(EffortsEditor, {
          t,
          provider,
          efforts: draft.efforts,
          patchState,
          levels,
          gemini,
          onChange,
        }),
        h(CompatEditor, { t, model, draft, compatKeys, onChange }),
        (issues.errors ?? EMPTY).length === 0 ? null : h("p", { className: "mt-msg bad" }, issues.errors.join("；")),
        (issues.warnings ?? EMPTY).length === 0 ? null : h("p", { className: "mt-msg warn" }, issues.warnings.join("；")),
      );
    }

    function ModelRow(props) {
      const { t, provider, model, open, onToggle, draft, issues, patchState, levels, gemini, compatKeys, onChange } = props;
      const meta = [];
      if (model.contextWindow !== undefined && model.contextWindow !== null) meta.push("ctx " + String(model.contextWindow));
      if (model.maxTokens !== undefined && model.maxTokens !== null) meta.push("out " + String(model.maxTokens));
      if (Array.isArray(model.input) && model.input.length > 0) meta.push(model.input.join("+"));
      const collapsedErrors = (issues.errors ?? EMPTY).length;
      return h(
        "div",
        { className: "mt-model" },
        h(
          "div",
          { className: "mt-head" },
          h(
            "button",
            { type: "button", className: "mt-toggle", onClick: onToggle },
            h("span", null, open === true ? "▾" : "▸"),
            h("span", null, labelForModel(model)),
          ),
          h("span", { className: "mt-hint mt-mono" }, model.id + (meta.length === 0 ? "" : " ｜ " + meta.join(" ｜ "))),
        ),
        open === true ? h(ModelEditor, { t, provider, model, draft, issues, patchState, levels, gemini, compatKeys, onChange }) : null,
        open !== true && collapsedErrors > 0 ? h("p", { className: "mt-msg bad" }, issues.errors.join("；")) : null,
        open !== true && (issues.warnings ?? EMPTY).length > 0 ? h("p", { className: "mt-msg warn" }, issues.warnings.join("；")) : null,
      );
    }

    function FieldsEditor(props) {
      const { t, provider, draft, onChange, levels, gemini } = props;
      const budgets = draft.budgets;
      const choices = levelChoices(provider.api, levels, budgets.map((row) => row.level).concat([draft.reasoning]), gemini);
      const budgetOptions = [{ value: "", label: "—" }].concat(choices.map((level) => ({ value: level, label: level })));
      const toggleInput = (value, checked) => {
        const rest = draft.input.filter((item) => item !== value);
        return checked ? rest.concat([value]) : rest;
      };
      return h(
        "div",
        { className: "mt-sub" },
        h(
          "div",
          { className: "mt-grid" },
          h(Field, { label: t("defaultContextWindow") }, h(TextInput, { value: draft.cw, mono: true, placeholder: t("notSet"), onChange: (value) => onChange({ cw: value }) })),
          h(Field, { label: t("defaultMaxTokens") }, h(TextInput, { value: draft.mt, mono: true, placeholder: t("notSet"), onChange: (value) => onChange({ mt: value }) })),
        ),
        h(
          "div",
          { className: "mt-sub" },
          h("span", { className: "mt-label" }, t("defaultInput")),
          h(
            "div",
            { className: "mt-actions" },
            h(Check, { checked: draft.input.indexOf("text") !== -1, label: t("inputText"), onChange: (checked) => onChange({ input: toggleInput("text", checked) }) }),
            h(Check, { checked: draft.input.indexOf("image") !== -1, label: t("inputImage"), onChange: (checked) => onChange({ input: toggleInput("image", checked) }) }),
          ),
        ),
        h(
          "div",
          { className: "mt-sub" },
          h("span", { className: "mt-label" }, t("thinkingBudgets")),
          budgets.map((row, index) =>
            h(
              "div",
              { className: "mt-budget-row", key: index },
              h(Select, {
                value: row.level,
                options: budgetOptions,
                onChange: (level) => onChange({ budgets: budgets.map((item, i) => (i === index ? { ...item, level } : item)) }),
              }),
              h(TextInput, {
                value: row.tokens,
                mono: true,
                placeholder: "1024",
                onChange: (tokens) => onChange({ budgets: budgets.map((item, i) => (i === index ? { ...item, tokens } : item)) }),
              }),
              h(Button, { onClick: () => onChange({ budgets: budgets.filter((_item, i) => i !== index) }) }, t("remove")),
            ),
          ),
          h(
            "div",
            { className: "mt-actions" },
            h(Button, { onClick: () => onChange({ budgets: budgets.concat([{ level: "", tokens: "" }]) }) }, t("addBudget")),
          ),
        ),
        h(
          Field,
          { label: t("defaultReasoning") },
          h(Select, {
            value: draft.reasoning,
            options: [{ value: "", label: t("notSet") }].concat(choices.map((level) => ({ value: level, label: level }))),
            onChange: (value) => onChange({ reasoning: value }),
          }),
        ),
      );
    }

    function ProviderCard(props) {
      const {
        t,
        provider,
        levels,
        gemini,
        compatKeys,
        patchState,
        expanded,
        onToggle,
        openModel,
        onToggleModel,
        modelDraftFor,
        onChangeModel,
        fieldsDraft,
        onFieldsChange,
        issues,
        dirty,
        saving,
        onSave,
        notice,
      } = props;
      const models = provider.models ?? EMPTY;
      return h(
        "div",
        { className: "mt-provider" },
        h(
          "div",
          { className: "mt-head" },
          h(
            "button",
            { type: "button", className: "mt-toggle", onClick: onToggle },
            h("span", null, expanded === true ? "▾" : "▸"),
            h("span", null, provider.displayName === undefined || provider.displayName === null || provider.displayName === provider.id ? provider.id : provider.displayName),
            // 宿主视图里 api 可能是 null（该路由没写 api 字段）：那时不画空徽标，只留路由 id。
            typeof provider.api === "string" && provider.api !== "" ? h(Tag, null, provider.api) : null,
          ),
          h("span", { className: "mt-hint mt-mono" }, provider.id + " ｜ " + String(models.length) + " " + t("modelsCount")),
        ),
        h("span", { className: "mt-hint mt-mono mt-path" }, provider.baseURL === undefined || provider.baseURL === null || provider.baseURL === "" ? "—" : provider.baseURL),
        expanded === true
          ? h(
              "div",
              { className: "mt-sub" },
              models.length === 0
                ? h("p", { className: "mt-hint" }, t("noModels"))
                : models.map((model) =>
                    h(ModelRow, {
                      key: model.id,
                      t,
                      provider,
                      model,
                      open: openModel === model.id,
                      onToggle: () => onToggleModel(openModel === model.id ? null : model.id),
                      draft: modelDraftFor(provider, model),
                      issues: issues.models[model.id] ?? { errors: [], warnings: [] },
                      patchState,
                      levels,
                      gemini,
                      compatKeys,
                      onChange: (patch) => onChangeModel(provider, model, patch),
                    }),
                  ),
              h(
                "details",
                { className: "mt-details" },
                h("summary", null, t("providerDefaults")),
                h(FieldsEditor, { t, provider, draft: fieldsDraft, onChange: onFieldsChange, levels, gemini }),
              ),
              h(
                "div",
                { className: "mt-actions" },
                h(Button, { primary: true, disabled: saving === true || dirty !== true, onClick: onSave }, saving === true ? t("saving") : t("saveProvider")),
                dirty === true ? h(Tag, { kind: "warn" }, t("dirtyProvider")) : null,
              ),
              (issues.errors ?? EMPTY).length === 0 ? null : h("p", { className: "mt-msg bad" }, issues.errors.join("；")),
              notice === null || notice === undefined ? null : h(Msg, { kind: notice.kind }, notice.text),
            )
          : null,
      );
    }

    function AdvancedBlock(props) {
      const { t, providers, providersError, onReload, onProviders, patchState, levels, caps } = props;
      const [openProvider, setOpenProvider] = useState(null);
      const [openModel, setOpenModel] = useState(null);
      const [modelDrafts, setModelDrafts] = useState({});
      const [fieldDrafts, setFieldDrafts] = useState({});
      const [savingId, setSavingId] = useState(null);
      const [notices, setNotices] = useState({});

      const list = providers === null ? EMPTY : providers.providers ?? EMPTY;
      const gemini = routeInfo(providers);
      const compatKeys = compatKeyList(providers);

      const notice = (providerId, kind, text) => setNotices((previous) => ({ ...previous, [providerId]: kind === null ? null : { kind, text } }));

      const modelDraftFor = (provider, model) => modelDrafts[draftKey(provider.id, model.id)] ?? freshModelDraft(model);
      const fieldsDraftFor = (provider) => fieldDrafts[provider.id] ?? freshFieldsDraft(provider.fields);

      const updateModelDraft = (provider, model, patch) => {
        const key = draftKey(provider.id, model.id);
        setModelDrafts((previous) => ({ ...previous, [key]: { ...(previous[key] ?? freshModelDraft(model)), ...patch } }));
        notice(provider.id, null, null);
      };

      const updateFieldsDraft = (provider, patch) => {
        setFieldDrafts((previous) => ({
          ...previous,
          [provider.id]: { ...(previous[provider.id] ?? freshFieldsDraft(provider.fields)), ...patch, touched: true },
        }));
        notice(provider.id, null, null);
      };

      const isDirty = (provider) => {
        if (fieldDrafts[provider.id] !== undefined && fieldDrafts[provider.id].touched === true) return true;
        return (provider.models ?? EMPTY).some((model) => {
          const draft = modelDrafts[draftKey(provider.id, model.id)];
          if (draft === undefined) return false;
          return draft.efforts.touched === true || Object.keys(draft.compat).length > 0;
        });
      };

      /**
       * 一个提供商一个保存按钮：先逐个模型 POST（契约里 model 字段只放一个模型，所以有几个脏模型就发几次），
       * 再发提供商级 fields。每次都用上一次回传的 revision，避免自己在两次写之间把版本顶旧。
       * 409 只提示 + 重新拉 /providers，绝不自动重试：写冲突时重放等于覆盖别人的改动。
       */
      const save = async (provider) => {
        const check = providerIssues(provider, modelDrafts, fieldDrafts[provider.id], patchState, t, gemini);
        if (check.errors.length > 0) {
          notice(provider.id, "bad", t("invalid") + "：" + check.errors[0]);
          return;
        }
        setSavingId(provider.id);
        notice(provider.id, null, null);
        let revision = providers === null ? undefined : providers.revision;
        let latest = list;
        try {
          for (const model of provider.models ?? EMPTY) {
            const draft = modelDrafts[draftKey(provider.id, model.id)];
            if (draft === undefined) continue;
            const modelPayload = modelPayloadFor(model, draft);
            if (modelPayload === null) continue;
            const payload = await call("/model", {
              method: "POST",
              body: JSON.stringify({ route: provider.id, revision, model: modelPayload }),
            });
            revision = payload.revision;
            if (Array.isArray(payload.providers)) latest = payload.providers;
          }
          const fieldDraft = fieldDrafts[provider.id];
          if (fieldDraft !== undefined && fieldDraft.touched === true) {
            const payload = await call("/model", {
              method: "POST",
              body: JSON.stringify({ route: provider.id, revision, fields: fieldsPayloadFor(fieldDraft) }),
            });
            revision = payload.revision;
            if (Array.isArray(payload.providers)) latest = payload.providers;
          }
          onProviders(revision, latest);
          // 保存成功后清掉本提供商的草稿：显示回落到宿主刚回报的值，而不是用户手里那份。
          setModelDrafts((previous) => {
            const next = {};
            for (const key of Object.keys(previous)) if (key.indexOf(provider.id + "::") !== 0) next[key] = previous[key];
            return next;
          });
          setFieldDrafts((previous) => {
            const next = { ...previous };
            delete next[provider.id];
            return next;
          });
          notice(provider.id, "good", t("savedProvider"));
        } catch (failure) {
          if (failure.code === "conflict") {
            notice(provider.id, "bad", failure.message);
            await onReload();
          } else {
            notice(provider.id, "bad", failure.message);
          }
        } finally {
          setSavingId(null);
        }
      };

      // settings 服务缺席时整块不可用：read 不到 providers，写也就没有意义，直接说清楚，别给一堆空控件。
      if (caps.settings === false) {
        return h("p", { className: "mt-hint" }, t("capsSettings"));
      }

      if (providers === null) {
        return h(
          "div",
          { className: "mt-sub" },
          providersError === null ? h("p", { className: "mt-hint" }, t("loading")) : h(Msg, { kind: "bad" }, providersError),
        );
      }

      return h(
        "div",
        { className: "mt-sub" },
        providersError === null ? null : h(Msg, { kind: "bad" }, providersError),
        list.length === 0
          ? h("p", { className: "mt-hint" }, t("noProviders"))
          : list.map((provider) =>
              h(ProviderCard, {
                key: provider.id,
                t,
                provider,
                levels,
                gemini,
                compatKeys,
                patchState,
                expanded: openProvider === provider.id,
                onToggle: () => {
                  setOpenProvider(openProvider === provider.id ? null : provider.id);
                  setOpenModel(null);
                },
                openModel: openProvider === provider.id ? openModel : null,
                onToggleModel: (modelId) => setOpenModel(openModel === modelId ? null : modelId),
                modelDraftFor,
                onChangeModel: updateModelDraft,
                fieldsDraft: fieldsDraftFor(provider),
                onFieldsChange: (patch) => updateFieldsDraft(provider, patch),
                issues: providerIssues(provider, modelDrafts, fieldDrafts[provider.id], patchState, t, gemini),
                dirty: isDirty(provider),
                saving: savingId === provider.id,
                onSave: () => {
                  void save(provider);
                },
                notice: notices[provider.id] ?? null,
              }),
            ),
      );
    }

    /* ---------- 第 1 块（v2）：供应商管理 ---------- */

    /** 家族模板的界面文案由客户端字典决定（宿主回报的 label 两语并列，不能直接渲染）。 */
    const TEMPLATE_LABELS = {
      relay: "tplRelay",
      openai: "tplOpenai",
      anthropic: "tplAnthropic",
      gemini: "tplGemini",
      deepseek: "tplDeepseek",
      blank: "tplBlank",
    };

    /** 一行新模型的初值；`efforts` 来自家族模板（`undefined` = 先不声明档位）。 */
    function emptyModelForm(efforts) {
      const levels = {};
      for (const level of Object.keys(efforts ?? {})) levels[level] = true;
      return { id: "", name: "", cw: "", mt: "", input: { text: true, image: false }, levels: levels };
    }

    /** 勾选的档位 → reasoningEfforts；没有任何非 off 档时返回 undefined（= 不声明）。 */
    function effortsFromLevels(levels, wire) {
      const out = {};
      let nonOff = 0;
      for (const level of ALL_LEVELS) {
        if (levels[level] !== true) continue;
        if (level === "off") {
          out.off = null;
          continue;
        }
        // 已经声明过的档位沿用原来的 API 参数值（高级字段里可能是手写的 `reasoning_effort=high`）：
        // 这张表的勾选框只表达"声明了哪几档"，没道理顺手把别人的 wire 写法改写成同名。
        out[level] = wire !== undefined && wire !== null && typeof wire[level] === "string" ? wire[level] : level;
        nonOff += 1;
      }
      return nonOff === 0 ? undefined : out;
    }

    /** 表单行 → 宿主认识的模型对象：空字段一律不写，交给 schema 的默认值。 */
    function modelPayloadFromForm(row) {
      const model = { id: row.id.trim() };
      if (row.name.trim() !== "") model.name = row.name.trim();
      const number = (raw) => {
        const value = String(raw).trim();
        if (value === "") return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined;
      };
      const cw = number(row.cw);
      if (cw !== undefined) model.contextWindow = cw;
      const mt = number(row.mt);
      if (mt !== undefined) model.maxTokens = mt;
      const input = [];
      if (row.input.text === true) input.push("text");
      if (row.input.image === true) input.push("image");
      if (input.length > 0) model.input = input;
      const efforts = effortsFromLevels(row.levels, row.wire);
      if (efforts !== undefined) model.reasoningEfforts = efforts;
      return model;
    }

    /**
     * 存量模型 → 表单行：与 {@link emptyModelForm} 同一形状，好让「编辑」复用「+ 添加模型」那张表。
     *
     * `reasoningEfforts` 有三种形态：`false`（显式不推理）/ 缺失（不声明）/ 对象（档位 → 参数值）。
     * 勾选框只能表达「声明了哪几档」，所以 `false` 与缺失都渲染成全不勾；
     * 用户没动档位时 payload 里不会带这个键，宿主按「原字段 + 新值」合并，原样保留。
     * 对象形态另外把每档的参数值记进 `wire`：编辑保存时沿用，不会把高级字段里手写的写法改写掉。
     */
    function modelFormFromModel(model) {
      const levels = {};
      const wire = {};
      if (model.reasoningEfforts !== null && typeof model.reasoningEfforts === "object") {
        for (const level of Object.keys(model.reasoningEfforts)) {
          levels[level] = true;
          // 记下每档原来的 API 参数值：勾选框只改"声明哪几档"，不该顺手改写 wire 写法。
          const value = model.reasoningEfforts[level];
          if (typeof value === "string" && value !== "") wire[level] = value;
        }
      }
      const input = { text: false, image: false };
      if (Array.isArray(model.input)) {
        for (const item of model.input) if (item === "text" || item === "image") input[item] = true;
      }
      const text = (value) => (value === null || value === undefined ? "" : String(value));
      return {
        id: typeof model.id === "string" ? model.id : "",
        name: typeof model.name === "string" ? model.name : "",
        cw: text(model.contextWindow),
        mt: text(model.maxTokens),
        input,
        levels,
        wire,
      };
    }

    /**
     * 模型行编辑的请求体：`modelId` 是被编辑模型的**当前** id，`model` 是要写入的新值（含新 id）。
     * 两个 id 不同就是改名——宿主据此把显式 `models` 的元素替换掉，或把目录路由的 override 键搬过去。
     */
    function modelEditBody(provider, model, revision, row) {
      return { route: provider.id, revision, modelId: model.id, model: modelPayloadFromForm(row) };
    }

    /**
     * 供应商头表单 → `/provider/edit` 的 `fields`：**只发用户真的改过的那几个键**。
     *
     * 为什么不整份发：契约只允许 `displayName` / `baseURL` / `api`，而空串直接判 invalid；
     * 目录路由的端点与协议本来就没写进配置（宿主回报 null），原样发一个空串会被当成
     * 「要把它们写成空」，用户明明只改了显示名却被拒。
     */
    function providerEditFields(provider, form) {
      const previous = (value) => (typeof value === "string" ? value : "");
      const fields = {};
      if (form.displayName.trim() !== previous(provider.displayName)) fields.displayName = form.displayName.trim();
      if (form.baseURL.trim() !== previous(provider.baseURL)) fields.baseURL = form.baseURL.trim();
      // 空串协议是「不设置」，不是一个合法协议名；发给宿主只会被判 invalid。
      if (form.api !== "" && form.api !== previous(provider.api)) fields.api = form.api;
      return fields;
    }

    /** 供应商头编辑的请求体：密钥留空 = 不改，所以 `key` 只在真的填了的时候出现。 */
    function providerEditBody(provider, revision, form) {
      const body = { route: provider.id, revision, fields: providerEditFields(provider, form) };
      if (typeof form.key === "string" && form.key !== "") body.key = form.key;
      return body;
    }

    /** 供应商头表单的本地校验：只在字段真的要写时才拦；显示名与端点写空会被宿主直接拒。 */
    function providerEditIssues(body, t) {
      const errors = [];
      if (body.fields.displayName === "") pushOnce(errors, t("needsField").replace("{field}", t("displayNameLabel")));
      if (body.fields.baseURL === "") pushOnce(errors, t("needsField").replace("{field}", t("baseUrlLabel")));
      return errors;
    }

    /**
     * 撤销：先按常规发一次；宿主回 `stale`（撤销是整条供应商覆盖，而上次写入后它又被改过）
     * 就先弹一次确认，确认后带 `force: true` 重发。
     *
     * 抽成独立函数有两个原因：这段「二次确认 + 重发」是本次最容易写错的分支，而它在组件里
     * 没法单独触发；再者用户拒绝时不该当错误报，只把宿主给的原因显示成一行黄字。
     *
     * @returns `{ ok: true, payload }`，或 `{ ok: false, stale: true, message }`（用户选择不动）
     */
    async function undoWithForce(send, confirmStale) {
      try {
        return { ok: true, payload: await send({}) };
      } catch (failure) {
        if (failure === null || failure === undefined || failure.code !== "stale") throw failure;
        if (confirmStale(failure) !== true) return { ok: false, stale: true, message: failure.message };
        return { ok: true, payload: await send({ force: true }) };
      }
    }

    /** 快照 label 的 slug → 字典键：宿主没有 i18n，五个捕获点加上编辑共六种。 */
    const UNDO_LABELS = {
      "create-provider": "undoLabelCreate",
      "delete-provider": "undoLabelDelete",
      "add-model": "undoLabelAddModel",
      "remove-model": "undoLabelRemoveModel",
      "edit-model": "undoLabelEditModel",
      "edit-provider": "undoLabelEditProvider",
    };

    /**
     * 把快照 label 翻成「动作 + 对象」；认不出的 slug 返回 null。
     * 认不出就不硬翻：宿主以后加新的捕获点，宁可少一句，也不把 slug 漏到界面上。
     */
    function undoActionText(t, label) {
      if (typeof label !== "string") return null;
      const key = UNDO_LABELS[label];
      return key === undefined ? null : t(key);
    }

    /**
     * 撤销成功的提示：动作 + 对象，能拿到 `routes` 就把被撤销的 route 一起写进括号。
     * 认不出的 label 退化到固定文案——slug 与时间戳都不往「已撤销：」后面塞
     * （时间戳在快照提示行里已经有了）。
     */
    function undoNoticeText(t, payload) {
      const source = payload === null || payload === undefined ? {} : payload;
      const action = undoActionText(t, source.label);
      if (action === null) return t("undoneNoLabel");
      const routes = Array.isArray(source.routes)
        ? source.routes.filter((route) => typeof route === "string" && route !== "")
        : EMPTY;
      if (routes.length === 0) return t("undone").replace("{label}", action);
      return t("undoneWithObject").replace("{label}", action).replace("{object}", routes.join(", "));
    }

    /**
     * ADR 0009 第 7 条在客户端唯一的落点：改过 baseURL 或协议、而这次编辑还没检测成功过，
     * 保存前就要再问一句。做成软门禁而不是禁用保存——探测不出列表的端点（noDiscovery 已是
     * 合法状态）会被硬门禁彻底锁死；只改显示名或只改密钥不触发。
     */
    function needsUncheckedConfirm(body, checked) {
      const endpointChanged = body.fields.baseURL !== undefined || body.fields.api !== undefined;
      return endpointChanged && checked !== true;
    }

    /** 一条供应商表单的初值：默认就是第一个模板（中转站）。 */
    function emptyProviderForm(templates) {
      const template = templates.length > 0 ? templates[0] : null;
      return {
        templateId: template === null ? "" : template.id,
        route: "",
        displayName: "",
        api: template === null ? "openai-completions" : template.api,
        baseURL: template === null ? "" : template.baseURL,
        key: "",
        discovered: [],
        models: [emptyModelForm(template === null ? undefined : template.efforts)],
      };
    }

    /**
     * 一行模型输入：新建供应商、「+ 添加模型」与「模型行编辑」共用同一张表。
     * `title` 换掉表头那句「模型 N」，`idHint` 是 id 输入框下面那行小字（改名警告只编辑才需要）。
     */
    function ModelFormRow(props) {
      const { t, row, index, onChange, onRemove, canRemove, levelChoices, title, idHint } = props;
      const choices = Array.isArray(levelChoices) && levelChoices.length > 0 ? levelChoices : ALL_LEVELS;
      const set = (patch) => onChange({ ...row, ...patch });
      return h(
        "div",
        { className: "mt-model-form" },
        h(
          "div",
          { className: "mt-model-form-head" },
          h("span", { className: "mt-label" }, title ?? t("modelRow") + " " + String(index + 1)),
          canRemove ? h(Button, { onClick: onRemove }, t("remove")) : null,
        ),
        h(
          "div",
          { className: "mt-grid" },
          h(
            Field,
            { label: t("modelId") },
            h(TextInput, { value: row.id, mono: true, onChange: (value) => set({ id: value }) }),
            idHint === undefined || idHint === null ? null : h("span", { className: "mt-hint-inline" }, idHint),
          ),
          h(Field, { label: t("modelName") }, h(TextInput, { value: row.name, onChange: (value) => set({ name: value }) })),
          h(Field, { label: t("contextWindow") }, h(TextInput, { value: row.cw, onChange: (value) => set({ cw: value }) })),
          h(Field, { label: t("maxTokens") }, h(TextInput, { value: row.mt, onChange: (value) => set({ mt: value }) })),
        ),
        h(
          "div",
          { className: "mt-levels" },
          h("span", { className: "mt-label" }, t("inputLabel")),
          h(Check, {
            checked: row.input.text === true,
            label: t("inputText"),
            onChange: (checked) => set({ input: { ...row.input, text: checked } }),
          }),
          h(Check, {
            checked: row.input.image === true,
            label: t("inputImage"),
            onChange: (checked) => set({ input: { ...row.input, image: checked } }),
          }),
        ),
        h(
          "div",
          { className: "mt-levels" },
          h("span", { className: "mt-label" }, t("levelsLabel")),
          choices.map((level) =>
            h(Check, {
              key: level,
              checked: row.levels[level] === true,
              label: level,
              onChange: (checked) => set({ levels: { ...row.levels, [level]: checked } }),
            }),
          ),
        ),
      );
    }

    /**
     * 模型行「编辑」：就地展开，字段与「+ 添加模型」完全同一张表。
     * 保存走 `POST /model`，`modelId` 带旧 id、`model.id` 带新 id——改名由宿主一次原子写完成
     * （显式 models 换数组元素、目录路由搬 override 键，并顺手迁移插件默认里的旧引用）。
     */
    function EditModelForm(props) {
      const { t, provider, model, index, levels, revision, onSaved, onCancel } = props;
      const [row, setRow] = useState(() => modelFormFromModel(model));
      const [saving, setSaving] = useState(false);
      const [localFailure, setLocalFailure] = useState(null);

      const submit = () => {
        const body = modelEditBody(provider, model, revision, row);
        if (body.model.id === "") {
          setLocalFailure(t("needsModels"));
          return;
        }
        setLocalFailure(null);
        setSaving(true);
        void (async () => {
          try {
            const payload = await call("/model", { method: "POST", body: JSON.stringify(body) });
            // 成功后本表单会被父级收起（父级负责重载 + 提示），这里不再动 saving。
            onSaved(payload, body.model.id);
          } catch (error) {
            setLocalFailure(error.message);
            setSaving(false);
          }
        })();
      };

      return h(
        "div",
        { className: "mt-sub" },
        h(ModelFormRow, {
          t: t,
          row: row,
          index: index,
          // 表头写明在编辑哪个 id；改名后标题会跟着新 id 变，用户能立刻看出改没改成。
          title: t("edit") + "：" + row.id,
          idHint: t("modelRenameWarn"),
          levelChoices: levels,
          onChange: setRow,
          canRemove: false,
          onRemove: null,
        }),
        localFailure === null ? null : h(Msg, { kind: "bad" }, localFailure),
        h(
          "div",
          { className: "mt-actions" },
          h(Button, { primary: true, disabled: saving === true, onClick: submit }, saving === true ? t("saving") : t("save")),
          h(Button, { onClick: onCancel }, t("cancel")),
        ),
      );
    }

    /**
     * 供应商头「编辑」：就地改身份字段（显示名 / baseURL / 协议 / 密钥）。
     *
     * 只读的两样东西在这里刻意没有输入框：route id（容器键）与 `apiKeyEnv` 引用名
     * （凭据引用名沿用 `<ROUTE>_API_KEY` 派生规则，原生页也不许改，ADR 0009 第 1 条）。
     * 密钥留空 = 不改；改了就写进凭据库，配置里仍然只有引用名。
     */
    function EditProviderForm(props) {
      const { t, provider, protocols, revision, onSaved, onCancel } = props;
      const [form, setForm] = useState(() => ({
        displayName: typeof provider.displayName === "string" ? provider.displayName : "",
        baseURL: typeof provider.baseURL === "string" ? provider.baseURL : "",
        // 目录路由的协议本来就没写进配置（宿主回报 null）：初值是空串 = 停在「不设置」，
        // 不能替用户挑一个协议——那会把目录里的默认协议悄悄钉成显式值。
        api: typeof provider.api === "string" && provider.api !== "" ? provider.api : "",
        key: "",
      }));
      const [checking, setChecking] = useState(false);
      const [saving, setSaving] = useState(false);
      const [localFailure, setLocalFailure] = useState(null);
      const [localNotice, setLocalNotice] = useState(null);
      // 「这次编辑检测成功过」的标记：端点或协议一动就作废（宿主只探测已保存的端点，
      // 改完不重新点一次，上一次的"连通"说的就不是新地址了）。
      const [checked, setChecked] = useState(false);

      const set = (patch) => {
        setForm((current) => ({ ...current, ...patch }));
        if (patch.baseURL !== undefined || patch.api !== undefined) {
          setChecked(false);
          setLocalNotice(null);
        }
      };

      // 协议下拉：宿主只接受那 4 个协议名，所以「清空」不是一个能给的动作。
      // 只有本来就没写协议的路由（目录路由，宿主回报 null）才多一项「不设置」占位——
      // 停在那里什么都不会写；一旦选了协议，这一项就消失，不会让人误以为还能改回空。
      const protocolOptions = protocols.map((protocol) => ({ value: protocol, label: protocol }));
      if (form.api === "") {
        protocolOptions.unshift({ value: "", label: t("notSet") });
      } else if (protocolOptions.every((option) => option.value !== form.api)) {
        // 存量值不在宿主回报的协议表里（老配置写了别的名字）：补一项，否则下拉显示成空值，
        // 用户一打开表单就以为协议被吃掉了。
        protocolOptions.push({ value: form.api, label: form.api });
      }

      const body = providerEditBody(provider, revision, form);
      const dirty = Object.keys(body.fields).length > 0 || body.key !== undefined;

      const discover = () => {
        setChecking(true);
        setLocalFailure(null);
        setLocalNotice(null);
        void (async () => {
          try {
            // route + 表单当前值：只给 route 的话宿主探的是**已保存**的端点，
            // 用户刚改完 baseURL 就点检测，验的还是旧地址（这个坑上一版就踩过）。
            // 两个键始终带上，空值由宿主决定是否回落到配置里的值；明文密钥不经过客户端。
            const payload = await call("/discover", {
              method: "POST",
              body: JSON.stringify({ route: provider.id, baseURL: form.baseURL.trim(), api: form.api }),
            });
            const found = Array.isArray(payload.models) ? payload.models : [];
            setChecked(true);
            setLocalNotice({
              kind: found.length === 0 ? "warn" : "good",
              text: t("reachable").replace("{count}", String(found.length)),
            });
          } catch (error) {
            // 失败一律显示宿主原文案：401、域名写错、端点不支持列表，只有宿主说得清。
            setChecked(false);
            setLocalFailure(error.message);
          } finally {
            setChecking(false);
          }
        })();
      };

      const submit = () => {
        const issues = providerEditIssues(body, t);
        if (issues.length > 0) {
          setLocalFailure(issues.join("；"));
          return;
        }
        // ADR 0009 第 7 条（软门禁）：改过端点或协议、这次编辑又没检测成功过，先问一句。
        // 用户拒绝就什么都不发、不报错——他只是还没准备好，不是出错。
        if (needsUncheckedConfirm(body, checked) && (typeof window === "undefined" || window.confirm(t("confirmSaveUnchecked")) !== true)) {
          return;
        }
        setLocalFailure(null);
        setLocalNotice(null);
        setSaving(true);
        void (async () => {
          try {
            const payload = await call("/provider/edit", { method: "POST", body: JSON.stringify(body) });
            onSaved(payload);
          } catch (error) {
            setLocalFailure(error.message);
            setSaving(false);
          }
        })();
      };

      return h(
        "div",
        { className: "mt-provider-form" },
        h("span", { className: "mt-label" }, t("edit") + "：" + provider.id),
        h(
          "div",
          { className: "mt-grid" },
          h(Field, { label: t("displayNameLabel") }, h(TextInput, { value: form.displayName, onChange: (value) => set({ displayName: value }) })),
          h(Field, { label: t("baseUrlLabel") }, h(TextInput, { value: form.baseURL, mono: true, onChange: (value) => set({ baseURL: value }) })),
          h(Field, { label: t("apiLabel") }, h(Select, { value: form.api, options: protocolOptions, onChange: (value) => set({ api: value }) })),
          h(Field, { label: t("keyLabel") }, h(TextInput, { value: form.key, type: "password", onChange: (value) => set({ key: value }) })),
        ),
        h("p", { className: "mt-hint" }, t("keyKeepHint")),
        localFailure === null ? null : h(Msg, { kind: "bad" }, localFailure),
        localNotice === null ? null : h(Msg, { kind: localNotice.kind }, localNotice.text),
        h(
          "div",
          { className: "mt-actions" },
          h(Button, { primary: true, disabled: saving === true || dirty !== true, onClick: submit }, saving === true ? t("saving") : t("save")),
          h(Button, { disabled: checking === true || saving === true, onClick: discover }, checking === true ? t("discovering") : t("discover")),
          h(Button, { onClick: onCancel }, t("cancel")),
        ),
      );
    }

    /** 新建供应商：家族模板 + route/端点/密钥 + 至少一行模型，一次原子写入。 */
    function NewProviderForm(props) {
      const { t, templates, protocols, revision, levels, run, onClose } = props;
      const [form, setForm] = useState(() => emptyProviderForm(templates));
      const [discovering, setDiscovering] = useState(false);
      const [localFailure, setLocalFailure] = useState(null);
      const [localNotice, setLocalNotice] = useState(null);

      const set = (patch) => setForm((current) => ({ ...current, ...patch }));

      const applyTemplate = (templateId) => {
        const template = templates.find((item) => item.id === templateId);
        setForm((current) => {
          if (template === undefined) return { ...current, templateId: templateId };
          // 只换协议与端点；已经填了模型 id 的行保留用户自己勾的档位
          const models = current.models.map((row) => (row.id.trim() === "" ? emptyModelForm(template.efforts) : row));
          return { ...current, templateId: templateId, api: template.api, baseURL: template.baseURL, models: models };
        });
      };

      const setRow = (index, next) =>
        setForm((current) => ({ ...current, models: current.models.map((row, at) => (at === index ? next : row)) }));
      const removeRow = (index) =>
        setForm((current) => ({ ...current, models: current.models.filter((row, at) => at !== index) }));

      const discover = () => {
        setDiscovering(true);
        setLocalFailure(null);
        setLocalNotice(null);
        void (async () => {
          try {
            const payload = await call("/discover", {
              method: "POST",
              body: JSON.stringify({ baseURL: form.baseURL.trim(), api: form.api, apiKey: form.key }),
            });
            const found = Array.isArray(payload.models) ? payload.models : [];
            setForm((current) => ({
              ...current,
              discovered: found.map((model) => ({ id: String(model.id ?? ""), chosen: false })),
            }));
            setLocalNotice(found.length === 0 ? t("noDiscovery") : t("discovered").replace("{count}", String(found.length)));
          } catch (error) {
            setLocalFailure(error.message);
          } finally {
            setDiscovering(false);
          }
        })();
      };

      const adopt = () => {
        const chosen = form.discovered.filter((entry) => entry.chosen === true && entry.id !== "");
        if (chosen.length === 0) return;
        setForm((current) => ({
          ...current,
          models: current.models.concat(chosen.map((entry) => ({ ...emptyModelForm(undefined), id: entry.id }))),
          discovered: [],
        }));
      };

      const submit = () => {
        const models = form.models.map(modelPayloadFromForm).filter((model) => model.id !== "");
        if (form.route.trim() === "") {
          setLocalFailure(t("needsRoute"));
          return;
        }
        if (models.length === 0) {
          setLocalFailure(t("needsModels"));
          return;
        }
        setLocalFailure(null);
        setLocalNotice(null);
        void run(async () => {
          const payload = await call("/provider", {
            method: "POST",
            body: JSON.stringify({
              route: form.route.trim(),
              displayName: form.displayName.trim(),
              api: form.api,
              baseURL: form.baseURL.trim(),
              key: form.key,
              revision: revision,
              models: models,
            }),
          });
          onClose(payload.credential !== null && payload.credential !== undefined && payload.credential.ok !== true
            ? payload.credential.message
            : t("created").replace("{route}", payload.route));
        });
      };

      const templateOptions = templates.map((template) => {
        const key = TEMPLATE_LABELS[template.id];
        return { value: template.id, label: key === undefined ? template.id : t(key) };
      });
      const protocolOptions = protocols.map((protocol) => ({ value: protocol, label: protocol }));

      return h(
        "div",
        { className: "mt-provider-form" },
        h(
          "div",
          { className: "mt-grid" },
          h(Field, { label: t("templateLabel") }, h(Select, { value: form.templateId, options: templateOptions, onChange: applyTemplate })),
          h(Field, { label: t("routeLabel") }, h(TextInput, { value: form.route, mono: true, onChange: (value) => set({ route: value }) })),
          h(Field, { label: t("displayNameLabel") }, h(TextInput, { value: form.displayName, onChange: (value) => set({ displayName: value }) })),
          h(Field, { label: t("apiLabel") }, h(Select, { value: form.api, options: protocolOptions, onChange: (value) => set({ api: value }) })),
          h(Field, { label: t("baseUrlLabel") }, h(TextInput, { value: form.baseURL, mono: true, onChange: (value) => set({ baseURL: value }) })),
          h(Field, { label: t("keyLabel") }, h(TextInput, { value: form.key, type: "password", onChange: (value) => set({ key: value }) })),
        ),
        h("p", { className: "mt-hint" }, t("routeHint") + "；" + t("keyHint")),
        h("p", { className: "mt-hint" }, t("discoverHint")),
        h(
          "div",
          { className: "mt-actions" },
          h(Button, { onClick: discover, disabled: discovering || form.baseURL.trim() === "" }, discovering ? t("discovering") : t("discover")),
        ),
        form.discovered.length === 0
          ? null
          : h(
              "div",
              { className: "mt-discovered" },
              form.discovered.map((entry, index) =>
                h(Check, {
                  key: entry.id + "-" + String(index),
                  checked: entry.chosen === true,
                  label: entry.id,
                  onChange: (checked) =>
                    setForm((current) => ({
                      ...current,
                      discovered: current.discovered.map((item, at) => (at === index ? { ...item, chosen: checked } : item)),
                    })),
                }),
              ),
              h(Button, { onClick: adopt }, t("adopt")),
            ),
        h("p", { className: "mt-label" }, t("modelsTitle")),
        form.models.map((row, index) =>
          h(ModelFormRow, {
            key: String(index),
            t: t,
            row: row,
            index: index,
            levelChoices: levels,
            onChange: (next) => setRow(index, next),
            onRemove: () => removeRow(index),
            canRemove: form.models.length > 1,
          }),
        ),
        h(
          "div",
          { className: "mt-actions" },
          h(Button, {
            onClick: () => setForm((current) => ({ ...current, models: current.models.concat([emptyModelForm(undefined)]) })),
          }, t("addRow")),
        ),
        localFailure === null ? null : h(Msg, { kind: "bad" }, localFailure),
        localNotice === null ? null : h(Msg, { kind: "warn" }, localNotice),
        h(
          "div",
          { className: "mt-actions" },
          h(Button, { onClick: submit, primary: true }, t("create")),
          h(Button, { onClick: () => onClose(null) }, t("cancel")),
        ),
      );
    }

    /**
     * 供应商区块：结构操作与**就地编辑**都在这里。
     *
     * 编辑刻意不弹窗、不跳页：一个字段只有一个家（ADR 0009），点哪一行改哪一行、按行保存，
     * 用户不用记「我刚才那步是什么」。逐字段的精修（compat / 提供商默认值）仍归下一块。
     */
    function ProvidersBlock(props) {
      const { t, state, providers, providersError, onReload } = props;
      const [creating, setCreating] = useState(false);
      const [busy, setBusy] = useState(false);
      const [failure, setFailure] = useState(null);
      const [notice, setNotice] = useState(null);
      const [addTarget, setAddTarget] = useState(null);
      const [deleting, setDeleting] = useState(null);
      const [undoing, setUndoing] = useState(false);
      // 两处就地编辑各自只允许开一个：模型行按 `{route, modelId}` 记，供应商头按 route 记。
      // 三个瞬时态（加模型 / 删供应商 / 编辑）互斥，避免同一片区域叠出两张表单。
      const [editingModel, setEditingModel] = useState(null);
      const [editingProvider, setEditingProvider] = useState(null);

      /** 统一外壳：先清提示，跑动作，再整体重载（结构与 revision 会一起变）。 */
      const run = async (action) => {
        setBusy(true);
        setFailure(null);
        setNotice(null);
        try {
          await action();
          await onReload();
        } catch (error) {
          setFailure(error.message);
        } finally {
          setBusy(false);
        }
      };

      const caps = state === null ? {} : (state.capabilities ?? {});
      if (providers === null) {
        return h(Msg, { kind: providersError === null ? "" : "bad" }, providersError === null ? t("loading") : providersError);
      }
      if (caps.settings === false) return h(Msg, { kind: "bad" }, t("providersNoService"));

      const list = providers.providers ?? EMPTY;
      const templates = providers.templates ?? EMPTY;
      const protocols = providers.protocols ?? EMPTY;
      const levels = Array.isArray(providers.levels) && providers.levels.length > 0 ? providers.levels : ALL_LEVELS;
      const undoTip = providers.undo ?? null;
      const revision = providers.revision;

      const removeModel = (route, modelId, remaining) => {
        if (remaining <= 1 && !window.confirm(t("removeLastModelWarn"))) return;
        void run(async () => {
          const payload = await call("/model/remove", {
            method: "POST",
            body: JSON.stringify({ route: route, revision: revision, modelId: modelId }),
          });
          setNotice(payload.removesProvider === true
            ? t("removedProvider").replace("{route}", route)
            : t("modelRemoved").replace("{id}", modelId));
          if (payload.credential !== null && payload.credential !== undefined && payload.credential.ok !== true) {
            setFailure(payload.credential.message);
          }
        });
      };

      const addModel = (route, row) => {
        if (row.id.trim() === "") {
          setFailure(t("needsModels"));
          return;
        }
        void run(async () => {
          const payload = await call("/model/add", {
            method: "POST",
            body: JSON.stringify({ route: route, revision: revision, model: modelPayloadFromForm(row) }),
          });
          setAddTarget(null);
          setNotice(t("modelAdded").replace("{id}", payload.model.id));
        });
      };

      const submitDelete = (route) => {
        void run(async () => {
          await call("/provider", {
            method: "DELETE",
            body: JSON.stringify({ route: route, revision: revision }),
          });
          setDeleting(null);
          setNotice(t("providerRemoved").replace("{route}", route));
        });
      };

      /** 模型行编辑成功：收起表单 → 重载（id 可能变了）→ 提示新 id；改名还多一句默认迁移。 */
      const savedModel = (payload, nextId) => {
        setEditingModel(null);
        void onReload();
        setNotice(
          t("modelUpdated").replace("{id}", nextId)
            + (payload !== null && payload !== undefined && payload.defaultsMigrated === true ? "；" + t("defaultsMigrated") : ""),
        );
      };

      /** 供应商头编辑成功：收起表单 → 重载；凭据没存下来时显示宿主那句话（供应商本身已改好）。 */
      const savedProvider = (provider, payload) => {
        setEditingProvider(null);
        void onReload();
        const credential = payload === null || payload === undefined ? null : payload.credential ?? null;
        setNotice(credential !== null && credential.ok !== true
          ? credential.message
          : t("providerUpdated").replace("{route}", provider.id));
      };

      /**
       * 撤销上一次写入：宿主若回 `stale`（撤销是整条供应商覆盖，而上次写入后它又被改过），
       * 先弹一次确认，确认后带 `force: true` 重发。用户拒绝时不报错，只把宿主的原因显示成黄字。
       */
      const submitUndo = () => {
        setUndoing(true);
        // 撤销也是一次写：把 busy 一起立起来，别让用户在跑的过程中再点一次别的结构操作。
        setBusy(true);
        setFailure(null);
        setNotice(null);
        void (async () => {
          try {
            const result = await undoWithForce(
              (extra) => call("/provider/undo", { method: "POST", body: JSON.stringify({ revision: revision, ...extra }) }),
              () => typeof window !== "undefined" && window.confirm(t("undoStaleConfirm")) === true,
            );
            if (result.ok !== true) {
              setNotice(result.message);
              return;
            }
            await onReload();
            setNotice(undoNoticeText(t, result.payload));
          } catch (error) {
            setFailure(error.message);
          } finally {
            setUndoing(false);
            setBusy(false);
          }
        })();
      };

      return h(
        "div",
        null,
        h("p", { className: "mt-hint" }, t("providersHint")),
        state !== null && state.externalManager === true ? h(Msg, { kind: "warn" }, t("externalManager")) : null,
        list.length === 0 ? h(Msg, null, t("providerNone")) : null,
        list.map((provider) =>
          h(
            "div",
            { key: provider.id, className: "mt-provider" },
            h(
              "div",
              { className: "mt-provider-head" },
              h("span", { className: "mt-provider-name" }, labelForProvider(provider)),
              h(Tag, { kind: provider.declared === true ? "warn" : "" }, provider.declared === true ? t("tagHandwritten") : t("tagCatalog")),
              provider.modelsExplicit === true ? null : h(Tag, null, t("tagInherited")),
              h("span", { className: "mt-hint-inline" }, String(provider.models.length) + " " + t("modelsUnit")),
              provider.keyRef === null ? h(Tag, { kind: "warn" }, t("tagNoKey")) : null,
              h(Button, {
                disabled: busy,
                onClick: () => {
                  // 同一颗按钮既开又关：开着的时候再点一次就收起来。
                  setEditingProvider(editingProvider === provider.id ? null : provider.id);
                  setEditingModel(null);
                  setDeleting(null);
                },
              }, t("edit")),
              provider.userOwned === true
                ? h(Button, {
                    onClick: () => {
                      setDeleting({ route: provider.id, typed: "" });
                      setEditingProvider(null);
                      setEditingModel(null);
                    },
                  }, t("removeProvider"))
                : null,
            ),
            editingProvider === provider.id
              ? h(EditProviderForm, {
                  t: t,
                  provider: provider,
                  protocols: protocols,
                  revision: revision,
                  onSaved: (payload) => savedProvider(provider, payload),
                  onCancel: () => setEditingProvider(null),
                })
              : null,
            provider.keyRef === null
              ? h("p", { className: "mt-hint-inline" }, t("keyAbsent"))
              : h("p", { className: "mt-hint-inline" }, t("keyRef").replace("{ref}", provider.keyRef)),
            provider.modelsExplicit === true ? null : h("p", { className: "mt-hint-inline" }, t("modelOverridesNote")),
            deleting !== null && deleting.route === provider.id
              ? h(
                  "div",
                  { className: "mt-delete-confirm" },
                  h("p", { className: "mt-hint" }, t("removeProviderConfirm")
                    .replace("{route}", provider.id)
                    .replace("{count}", String(provider.models.length))),
                  h(TextInput, {
                    value: deleting.typed,
                    mono: true,
                    placeholder: provider.id,
                    onChange: (value) => setDeleting({ route: provider.id, typed: value }),
                  }),
                  h(
                    "div",
                    { className: "mt-actions" },
                    h(Button, { primary: true, disabled: deleting.typed !== provider.id || busy, onClick: () => submitDelete(provider.id) }, t("confirmRemove")),
                    h(Button, { onClick: () => setDeleting(null) }, t("cancel")),
                  ),
                )
              : null,
            (provider.models ?? EMPTY).map((model) => {
              const open = editingModel !== null && editingModel.route === provider.id && editingModel.modelId === model.id;
              const line = h(
                "div",
                { key: model.id + "-line", className: "mt-model-line" },
                h("span", { className: "mt-mono" }, labelForModel(model)),
                model.reasoningEfforts === undefined || model.reasoningEfforts === null
                  ? h(Tag, null, t("tagInherited"))
                  : h("span", { className: "mt-hint-inline" }, Object.keys(model.reasoningEfforts).join(" / ")),
                h(Button, {
                  disabled: busy,
                  onClick: () => {
                    setEditingModel(open ? null : { route: provider.id, modelId: model.id });
                    setAddTarget(null);
                    setDeleting(null);
                  },
                }, t("edit")),
                provider.modelsExplicit === true
                  ? h(Button, { onClick: () => removeModel(provider.id, model.id, provider.models.length) }, t("remove"))
                  : null,
              );
              // 行本身留在原位，编辑表展开在它下面：上下文（哪个供应商、第几个模型）不会消失。
              if (open !== true) return line;
              return [
                line,
                h(EditModelForm, {
                  key: model.id + "-edit",
                  t: t,
                  provider: provider,
                  model: model,
                  index: (provider.models ?? EMPTY).indexOf(model),
                  levels: levels,
                  revision: revision,
                  onSaved: (payload, nextId) => savedModel(payload, nextId),
                  onCancel: () => setEditingModel(null),
                }),
              ];
            }),
            provider.modelsExplicit !== true
              ? null
              : addTarget !== null && addTarget.route === provider.id
                ? h(
                    "div",
                    { className: "mt-model-form" },
                    h(ModelFormRow, {
                      t: t,
                      row: addTarget.row,
                      index: provider.models.length,
                      levelChoices: levels,
                      onChange: (next) => setAddTarget({ route: provider.id, row: next }),
                      onRemove: () => setAddTarget(null),
                      canRemove: true,
                    }),
                    h(
                      "div",
                      { className: "mt-actions" },
                      h(Button, { primary: true, disabled: busy, onClick: () => addModel(provider.id, addTarget.row) }, t("create")),
                      h(Button, { onClick: () => setAddTarget(null) }, t("cancel")),
                    ),
                  )
                : h(Button, {
                    onClick: () => {
                      setAddTarget({ route: provider.id, row: emptyModelForm(undefined) });
                      setEditingModel(null);
                    },
                  }, t("addModel")),
          ),
        ),
        creating
          ? h(NewProviderForm, {
              t: t,
              templates: templates,
              protocols: protocols,
              levels: levels,
              revision: revision,
              run: run,
              onClose: (message) => {
                setCreating(false);
                if (message !== null && message !== undefined) setNotice(message);
              },
            })
          : h("div", { className: "mt-actions" }, h(Button, { primary: true, onClick: () => setCreating(true) }, t("addProvider"))),
        failure === null ? null : h(Msg, { kind: "bad" }, failure),
        notice === null ? null : h(Msg, { kind: "warn" }, notice),
        h(
          "div",
          { className: "mt-actions" },
          providerUndoRow(t, undoTip, undoing, busy, submitUndo),
        ),
      );
    }

    /** 撤销行：没有快照时只给一句说明，别放一个必然失败的按钮。 */
    function providerUndoRow(t, undoTip, undoing, busy, onUndo) {
      if (undoTip === null || undoTip === undefined) return h("span", { className: "mt-hint", key: "undo" }, t("undoNone"));
      // 快照 label 是 slug：能翻就翻成人话，翻不出来（宿主将来新增捕获点）宁可显示原样，也别显示空。
      const action = undoActionText(t, undoTip.label) ?? undoTip.label;
      return h(
        "span",
        { className: "mt-hint", key: "undo" },
        t("undoAt").replace("{when}", undoTip.at).replace("{label}", action) + "  ",
        h(Button, { onClick: onUndo, disabled: undoing || busy }, undoing ? t("working") : t("undo")),
      );
    }

    /* ---------- 第 3 块：宿主补丁状态 ---------- */

    function PatchBlock(props) {
      const { t, patch, onPatch } = props;
      const [pending, setPending] = useState(false);
      const [busy, setBusy] = useState(null);
      const [notice, setNotice] = useState(null);
      const [copied, setCopied] = useState(false);
      const current =
        patch === null || patch === undefined
          ? { state: "error", detail: "", archivePath: "", appVersion: "", backupPath: null, command: "" }
          : patch;
      // 「待重启」不是宿主的三态之一：打补丁 / 回滚成功后到重启前，文件已经变了但进程里还是旧的，
      // 这一段只有客户端知道，所以单独记一个本地状态，别让它看起来像「在位」。
      const kind = pending === true ? "pending" : current.state;
      const labelKey = PATCH_LABEL[kind] ?? "patchError";
      const tag = h(Tag, { kind: PATCH_TAG[kind] ?? "warn" }, t(labelKey));
      const command = typeof current.command === "string" ? current.command : "";

      // 宿主进程里写 app.asar 在 Windows 上几乎必然失败（rename EPERM / 挂载只读），
      // 所以「给命令 + 能复制」才是这一块真正可用的动作：按钮留着给能直接写的部署形态，命令永远在。
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch (failure) {
          setNotice({ kind: "bad", text: String((failure === null || failure === undefined ? "" : failure.message) ?? failure) });
        }
      };

      const run = async (path, confirmText) => {
        if (typeof window !== "undefined" && !window.confirm(confirmText)) return;
        setBusy(path);
        setNotice(null);
        try {
          const payload = await call(path, { method: "POST", body: "{}" });
          onPatch(payload.patch);
          setPending(payload.requiresRestart === true);
          setNotice({ kind: "good", text: t("patchRestart") });
        } catch (failure) {
          // 失败文案是宿主原文；后面再补一句逃生口——退出应用后跑上面那条命令。
          setNotice({ kind: "bad", text: failure.message, fallback: command !== "" });
        } finally {
          setBusy(null);
        }
      };

      return h(
        Section,
        { title: t("patchTitle"), right: tag },
        h("p", { className: "mt-hint" }, t("patchDetail") + "：" + (current.detail === undefined || current.detail === "" ? "—" : current.detail)),
        h(Meta, { label: t("appVersion") }, current.appVersion === undefined || current.appVersion === null || current.appVersion === "" ? "—" : current.appVersion),
        h(Meta, { label: t("archivePath") }, current.archivePath === undefined || current.archivePath === "" ? "—" : current.archivePath),
        current.backupPath === null || current.backupPath === undefined || current.backupPath === ""
          ? null
          : h(Meta, { label: t("backupPath") }, current.backupPath),
        command === ""
          ? null
          : h(
              "div",
              { className: "mt-sub" },
              current.state === "patched" ? null : h("p", { className: "mt-hint" }, t("patchMounted")),
              h("pre", { className: "mt-pre" }, command),
              h(
                "div",
                { className: "mt-actions" },
                h(Button, { onClick: () => { void copy(); } }, copied ? t("copied") : t("copyCommand")),
              ),
            ),
        h(
          "div",
          { className: "mt-actions" },
          h(Button, {
            primary: true,
            disabled: busy !== null,
            onClick: () => {
              void run("/patch/apply", t("patchConfirmApply"));
            },
          }, busy === "/patch/apply" ? t("working") : t("patchApply")),
          h(Button, {
            disabled: busy !== null,
            onClick: () => {
              void run("/patch/rollback", t("patchConfirmRollback"));
            },
          }, busy === "/patch/rollback" ? t("working") : t("patchRollback")),
        ),
        pending === true ? h("p", { className: "mt-hint" }, t("patchRestart")) : null,
        notice === null ? null : h(Msg, { kind: notice.kind }, notice.text),
        notice === null || notice.fallback !== true ? null : h("p", { className: "mt-hint" }, t("patchFallback")),
      );
    }

    /* ---------- 整页 ---------- */

    function ModelTuningPage(props) {
      const t = props.t;
      const [state, setState] = useState(null);
      const [stateError, setStateError] = useState(null);
      const [providers, setProviders] = useState(null);
      const [providersError, setProvidersError] = useState(null);

      // 两个数据源各自失败各自降级：/state 挂了摘要与补丁块还有话说，/providers 挂了只影响第二块。
      const reload = useCallback(async () => {
        setStateError(null);
        setProvidersError(null);
        await Promise.all([
          (async () => {
            try {
              setState(await call("/state", { method: "GET" }));
            } catch (failure) {
              setStateError(failure.message);
            }
          })(),
          (async () => {
            try {
              setProviders(await call("/providers", { method: "GET" }));
            } catch (failure) {
              setProvidersError(failure.message);
            }
          })(),
        ]);
      }, []);

      useEffect(() => {
        void reload();
      }, [reload]);

      /** 合并**插件状态**（开关、默认模型…）：进信封的 `state` 里。 */
      const applyPluginState = useCallback((next) => {
        // 回传的是插件状态本身（`{defaults, teamDefaultEnabled, …}`），要合并回信封的 `state` 里，
        // 否则下一次读 `payloadState()` 还是旧值，开关会自己弹回去。
        setState((previous) => (previous === null
          ? previous
          : { ...previous, state: { ...payloadState(previous), ...(next ?? {}) } }));
      }, []);

      /** 合并**补丁三态**：它属于信封，不属于插件状态。 */
      const applyPatch = useCallback((next) => {
        setState((previous) => (previous === null ? previous : { ...previous, patch: next }));
      }, []);

      const applyProviders = useCallback((revision, list) => {
        setProviders((previous) => (previous === null ? previous : { ...previous, revision, providers: list }));
      }, []);

      const blocks = [];
      if (state === null) {
        blocks.push(
          h(Section, {
            key: "boot",
            title: t("title"),
            hint: stateError === null ? t("loading") : stateError,
            right:
              stateError === null
                ? null
                : h(Button, {
                    onClick: () => {
                      void reload();
                    },
                  }, t("retry")),
          }),
        );
      } else {
        const levels = Array.isArray(state.levels) && state.levels.length > 0
          ? state.levels
          : providers === null
            ? EMPTY
            : providers.levels ?? EMPTY;
        // capabilities 决定哪块可用：缺 settings 就没有 providers 可写，缺 agentTeams 开关不生效。
        const caps = state.capabilities ?? {};
        // 状态文件损坏时宿主只回报一句 warning：给它一行黄字，别让用户以为保存成功过。
        if (state.warning !== null && state.warning !== undefined && state.warning !== "") {
          blocks.push(h(Msg, { key: "warning", kind: "warn" }, state.warning));
        }
        blocks.push(
          h(
            Section,
            { key: "providers", title: t("providersTitle") },
            h(ProvidersBlock, {
              t,
              state,
              providers,
              providersError,
              onReload: reload,
            }),
          ),
            h(Section,
              { key: "defaults", title: t("defaultsTitle"), hint: t("defaultsHint") },
              h(DefaultsBlock, { t, state: payloadState(state), providers, levels, caps, onState: applyPluginState }),
            ),
          h(
            Section,
            {
              key: "advanced",
              title: t("advancedTitle"),
              hint: t("advancedHint"),
              right: h(Button, {
                onClick: () => {
                  void reload();
                },
              }, t("reload")),
            },
            h(AdvancedBlock, {
              t,
              providers,
              providersError,
              patchState: (state.patch ?? {}).state,
              levels,
              caps,
              onReload: reload,
              onProviders: applyProviders,
            }),
          ),
          h(PatchBlock, { key: "patch", t, patch: state.patch, onPatch: applyPatch }),
        );
      }

      return h("div", { className: "mt-root" }, blocks);
    }

    /**
     * 摘要视图：插件页列表里只占一行，所以自己拉 /state、只写一行字。
     * 只依赖 /state（契约保证它能单独给出默认、团队开关与补丁三态），/providers 挂了也照样出字。
     */
    function SummaryLine(props) {
      const t = props.t;
      const [state, setState] = useState(null);
      const [error, setError] = useState(null);

      useEffect(() => {
        let alive = true;
        void (async () => {
          try {
            const payload = await call("/state", { method: "GET" });
            if (alive) setState(payload);
          } catch (failure) {
            if (alive) setError(failure.message);
          }
        })();
        return () => {
          alive = false;
        };
      }, []);

      // 宿主给的 error.message 已经是中文人话，原样显示，不再自己拼前缀。
      if (error !== null) return error;
      if (state === null) return t("summaryLoading");

      const plugin = payloadState(state);
      const defaults = plugin.defaults ?? null;
      const patch = state.patch ?? null;
      const kind = patch === null ? "error" : patch.state;
      const parts = [
        t("summaryDefaults") + "：" + (defaults === null ? t("none") : defaults.provider + "/" + defaults.model + " ｜ " + (defaults.reasoningEffort === null ? t("followModel") : defaults.reasoningEffort)),
        t("summaryTeam") + "：" + (plugin.teamDefaultEnabled === true ? t("on") : t("off")),
        t("summaryPatch") + "：" + t(PATCH_LABEL[kind] ?? "patchError"),
      ];
      return parts.join(" ｜ ");
    }

    /** 插件页的入口卡片：列表里一行摘要，详情页才渲染完整面板。 */
    function ModelTuningCard(props) {
      if (props.view === "summary") return h(SummaryLine, { t: props.t });
      return h(ModelTuningPage, { t: props.t });
    }

    const inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "model-tuning: dictionaries");
      const t = ctx.locale.bind(NS);
      // 挂在「插件」页里本插件那一行的「配置」入口（key = <包名>#<row id>）：
      // 点开就是完整配置页。设置页只留两个跳转席位，不放重逻辑。
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
              ModelTuningCard,
            ),
          ),
        "model-tuning: plugins row config",
      );
    }

    installStyles();
    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    /**
     * 只给测试用：最容易在界面上悄悄出错的地方。
     * 除了信封 → 插件状态那层解析，还有本次新增的就地编辑：表单与请求体之间的形状（改名靠
     * `modelId` 与 `model.id` 的差）、供应商头"只发改过的键"、撤销的 stale 分支与 label 翻译、
     * 以及"改过端点却没检测过"的软门禁判据。
     */
    exports.__internals = {
      payloadState: payloadState,
      call: call,
      modelFormFromModel: modelFormFromModel,
      modelEditBody: modelEditBody,
      providerEditFields: providerEditFields,
      providerEditBody: providerEditBody,
      providerEditIssues: providerEditIssues,
      undoWithForce: undoWithForce,
      undoActionText: undoActionText,
      undoNoticeText: undoNoticeText,
      needsUncheckedConfirm: needsUncheckedConfirm,
      EditModelForm: EditModelForm,
      EditProviderForm: EditProviderForm,
    };
    return module.exports;
  },
});
