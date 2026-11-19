# 净化层放在系统提示词组装点，而不是最后的出口

系统提示词在 `system-prompt/assemble` 里成型、随即作为 `system/message` 落进会话表层，再由 pi-ai 变成 `systemInstruction`。我们把净化放在组装点：会话日志里存的就是模型真正看到的那份提示词，符合 harness 的「model-visible ⟺ logged」不变式；每步只计算一次，重试不用重算。代价是覆盖不到不走 agent 组装点的调用（例如会话标题 LLM 自己的 system 字符串）。

## Considered Options

- **`llm/stream` 出口改写**：能覆盖所有出口，但日志与模型所见不一致，且每次尝试都要重算——排查时会被误导。
- **两层都做**：更保险，但规则叠加容易互相误伤，调试成本翻倍。

## Consequences

将来若把会话标题也指到这条路由，需要另行处理（它的 system 字符串不经过组装点）。
