# v3 第一批（编辑）接口契约

开工依据：`docs/adr/0009-edit-and-default-effort.md`。**本批不含模型默认档位**（那是第二批），也不动 `carryEffort` 的任何逻辑。

## 1. `POST /model` —— 现在可以改 model 的 id

```jsonc
{ "route": "cli", "revision": 12, "modelId": "glm-5.3", "model": { "id": "glm-5.3-pro", "name": "GLM-5.3 Pro" }, "fields": { } }
```

- `modelId`：被编辑的模型的**当前** id。省略时等于 `model.id`，即不改 id。
- `model`：要写入的字段（`name` / `contextWindow` / `maxTokens` / `input` / `reasoningEfforts` / `compat`）。若 `model.id` 与 `modelId` 不同 → **改名**。
- `fields`：保持现状，仍是 provider 级 `ROUTE_FIELDS`，本批不动。

改名语义：

- **该 route 有显式 `models`**：把数组里 `id === modelId` 的那一项替换成「原字段 + `model`」，其余模型与顺序不动（沿用"整段替换 `models`"的既有 op 形状）。
- **该 route 无显式 `models`（目录路由）**：同一批 ops 里 `set ['providers', route, 'modelOverrides', newId]`（值 = 合并后的 override，**不得含 `id`**）+ `unset ['providers', route, 'modelOverrides', modelId]`。
- 两个分支写前都要 `captureBefore(view, 'edit-model')`。
- 新 id 已存在 → `{ ok:false, code:'invalid', message:'模型 id 已存在：<id>' }`。
- 改名成功后把插件状态 `defaults` 里命中 `provider === route && model === modelId` 的改成新 id，响应带 `defaultsMigrated: true|false`。

响应：`{ ok:true, revision, providers, defaultsMigrated }`。

## 2. `POST /provider/edit` —— 改供应商身份字段

```jsonc
{ "route": "cli", "revision": 12, "fields": { "displayName": "GLM 中转", "baseURL": "https://…", "api": "anthropic-messages" }, "key": "sk-…" }
```

- `fields` 只允许 `displayName` / `baseURL` / `api`；出现别的键报 `invalid`（不静默丢弃）。
- `displayName` / `baseURL` 传空串 → 直接 `invalid`（上游对空串会抛错，别让它半途炸）。
- `api` 必须是 4 个协议之一（`openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai`）。
- `key` 非空 → 在该 provider 现有 `apiKeyEnv` 引用名下 `credentials.set`；**引用名不允许改**。
- 写前 `captureBefore(view, 'edit-provider')`。
- `api` 与现有 models 不兼容时宿主会拒，把错误翻成 `{ ok:false, code:'invalid', message }`，配置保持原值。

响应：`{ ok:true, revision, credential?: { ok, keyRef } }`。

## 3. `POST /discover` —— 支持按已存在的供应商探测

- 新增 `{ route }` 形式：从配置里读该 route 的 `baseURL` / `api` / `apiKeyEnv`；
  - **可显式覆盖端点**：`{ route, baseURL?, api? }` 用传入值替换配置里的同名字段（编辑表单要探"表单里的新值"，不能探已保存的旧值）；
  - 有 `apiKeyEnv` → `credentials.resolve(apiKeyEnv)` 取明文（可被显式 `apiKey` 覆盖），**只在宿主侧用于发请求，绝不回传**；
  - 拼 `{ baseURL, api, apiKey }` 调 `llm.discoverModels(NS, request)`；
  - 没有 `baseURL` → 退回 `{ provider: route }`。
- 原有 `{ provider }` / `{ baseURL, api, apiKey }` 形状不变。
- 响应形状不变：`{ ok:true, models }`；失败 400 `{ ok:false, error:{ code:'discover-failed'|'unavailable', message } }`。

## 4. 快照：记录"写完之后的值"，撤销前复核

- 快照文件结构加一个字段：`{ at, label, providers: <写前子树>, after: <写后子树> }`。旧文件没有 `after` → 视为"无法复核"，不阻断撤销。
- 五个捕获点（create / delete / add / remove / edit）都要写入 `after`。
- `POST /provider/undo` 增加 `force?: boolean`：
  - 快照有 `after` 且当前子树与 `after` 不一致 → 不写，返回 `{ ok:false, code:'stale', message:'上次写入后这条供应商又被改过，撤销会一并覆盖', routes:[...] }`；
  - `force:true` 时照常撤销；
  - 成功响应带 `label` 与 `routes`。

## 5. 客户端（`lib/client.js`）

- **模型行**：新增 `编辑` 按钮 → 该行就地展开表单（字段与「添加模型」一致：id / 显示名 / 上下文窗口 / 最大输出 / 输入模态 / 思考档位声明），保存 → `POST /model`（带 `modelId`）。id 可改，旁注"改名会断开历史会话里的旧选择"。
- **供应商头**：新增 `编辑` 按钮 → 行内表单（显示名 / baseURL / 协议下拉 / 密钥，密钥留空=不改）+ `检测连通`（`POST /discover {route}`：成功显示"连通，N 个模型"，失败显示原始文案）；保存 → `POST /provider/edit`。
- **撤销**：文案改为「撤销上一次写入」，成功提示带 `label`；收到 `stale` → 二次确认后带 `force:true` 重发。
- zh / en 两份字典键必须同名同数（`test/client.test.js` 有断言）。
- 文案与注释一律中文。

## 6. 测试（`test/`）

- `tune.test.js`：显式 `models` 改名（元素替换、其余不动、顺序不变）；override 路由改名（set 新键 + unset 旧键、新值不含 id、同一批 ops）；改名后 `defaults` 迁移；新 id 撞车报 `invalid`；provider 字段写 op 形状；`after` 快照与 `stale` 判定。
- `routes.test.js`：`/provider/edit` 状态码；`/discover {route}` 经 `credentials.resolve`（打桩）；`/provider/undo` 的 `stale` / `force`。
- `client.test.js`：新增字典键对齐、新按钮接线（沿用现有 mock 风格）。

## 7. 硬约束

- 零构建纯 ESM，不加新依赖。
- 所有写仍走 `settings.mutate(NS, ops, revision)`，不许绕过 revision 围栏。
- `node --test` 必须全绿（基线 106 例，只增不减）。
