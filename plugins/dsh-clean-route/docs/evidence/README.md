# 2026-11-17 的取证

这些文件是 429 归因那次 A/B 与 bisect 的原始输出，用来支撑 ADR 0001/0002 的结论。

- `ab-six-variants.json` 6 变体：提示词 / 工具 / generationConfig / UA 四个变量的隔离
- `determinism-check.json` 边界用例各 3 次：把「偶发 429」与「确定性拒绝」区分开
- `scan-*.json` 把 7,564 字提示词切成 1000/250/60 字块单独发送，定位命中区
- `bisect-*.json` 进一步收窄到「开头 47 字符」与「6750–6900 两段」
- 复现方式：`node scripts/probe.mjs --live`（规则改动后重跑即可知道上游还认不认得出来）
