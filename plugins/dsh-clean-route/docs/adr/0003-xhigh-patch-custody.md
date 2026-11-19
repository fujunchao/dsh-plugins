# xhigh 由插件托管补丁，而不是别名兜底或自建 HTTP 层

> **已被取代（2026-11-17）**：xhigh 补丁托管已迁移到 `dsh-model-tuning`
> （见其 `docs/adr/0001-xhigh-patch-custody.md`）。本插件不再写入 `app.asar`，
> `/clean-route/xhigh/apply` 现在返回 410，设置页只保留只读状态。
> 迁移理由：配置某个模型思考等级的页面，就应该是能修它的页面；「谁改过
> app.asar」必须永远只有一个答案。以下为原始决策，保留以备追溯。

第四档 xhigh 的缺口在宿主依赖的 `@earendil-works/pi-ai` 内部（一张 thinking level 表与两个 switch），DSH 插件层没有可用关口：`llm/stream` 只能改已有档位名，fetch 改写发生在抛错之后。因此插件不造档位，只负责「检测 + 写回 + 状态展示」：宿主目录里的 `google-shared.js` 是三处小改，插件在设置页给出补丁状态与一键修复（需重启）。

## Considered Options

- **别名兜底**（把 high 的线上值改成 XHIGH）：永不失效，但失去真正的 HIGH，档位名与实际不符。
- **自建 Gemini HTTP 层**：能原生支持四档，但要重写工具转换、SSE、思考流，风险与工作量最大，且与本插件「透传工具」的定位冲突。

## Consequences

宿主升级会冲掉补丁；插件必须能立刻发现并提示，否则症状是那句难以理解的 `Unsupported Google thinking level mapping`。
