# xhigh 补丁托管从 dsh-clean-route 迁到 dsh-model-tuning

`xhigh` 在 Gemini 路由上的失败点不在 DSH 配置层，而在宿主的 `@earendil-works/pi-ai`：`dist/api/google-shared.js` 只有 `minimal/low/medium/high` 的档位映射，遇到 `xhigh` 直接抛 `Unsupported Google thinking level mapping`。DSH 能决定的只是「声明哪个档位」，决定不了「pi-ai 认不认这个档位」。因此「能选 xhigh」与「请求真能发出去」是两件事，必须有插件托管一份 asar 补丁。

补丁托管原先在 `dsh-clean-route`（其 ADR 0003），但新插件的设置页正是「模型能不能按我配的档位思考」的所在；把补丁留在净化路由插件里，会让「我配了 xhigh 为什么不生效」变成跨插件的猜谜。**谁改过 app.asar，必须永远只有一个答案。**

## Considered Options

- **新插件只声明、clean-route 负责打补丁**：任一插件缺失就半死，且用户要在两个设置页之间来回跳。
- **两边都能打补丁**：靠"最后写的人赢"，冲突与重复备份不可解释。
- **抽出第三个共享包，两边都调用**：最干净，但要为一个功能养一个包，且两个插件仍都要有 UI 去触发它。
- **新插件托管，clean-route 退役该职责**（采納）：单一职责，一处可验。

## Consequences

- `dsh-clean-route` 的 xhigh 相关代码与设置区**退役**：代码保留但默认关闭，设置页改为提示「已迁移到 dsh-model-tuning」；其 ADR 0003 被本条取代。
- 补丁是**磁盘改写** `app.asar`（备份 + 原子替换 + 校验），因此生效必须**重启应用**；插件页显示三态：在位 / 已被 app 升级冲掉 / 补丁失败（附备份路径）。
- app 每次升级都会冲掉补丁，所以「检测」是常驻能力，不是一次性动作。
