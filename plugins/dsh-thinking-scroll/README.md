# dsh-thinking-scroll

DeepSeekRuntime (DSH) web 插件：主聊天流的"思考"块展开后正文限高（默认 40vh）并可滚动，标题行（折叠按钮）始终留在滚动容器外；流式输出中展开时正文自动钉底跟随，手动上滚即暂停、滚回底部恢复。

## 安装

DSH 插件页 → **发现** → **添加索引源** → 粘贴索引地址 `https://fujunchao.github.io/dsh-plugins/index.json`，
然后在卡片里安装 **dsh-thinking-scroll**。本包是 bundle（`package.json` 声明 `dsh.bundle.patch`），
安装时由 DSH 自动插入 `thinking-scroll` 这一行，不需要手改 profile；首次装完重启一次 DSH 生效。

## 配置

设置 → 插件 → "思考块滚动窗口" 卡片可调：

- **展开限高** `maxHeightVh`：20–80（视口百分比），默认 40。
- **流式时自动跟随** `autoFollow`：默认开启。

bundle 的 `cordis.patch.yml` 里就是这两个默认值，需要不同默认值时改那一行即可：

```yaml
- insert:
    - id: thinking-scroll
      name: 'dsh-thinking-scroll'
      config:
        maxHeightVh: 40
        autoFollow: true
```

## 原理

- 纯浏览器侧改造：CSS 限高命中契约属性 `[data-variant="think"][data-expanded]`（结构选择器 + `[class$="_thinkBody"]` 兜底），不改 React 行为。
- 自动跟随：对每个已展开思考正文挂 MutationObserver（characterData/subtree），在用户处于底部 25px 内时 `scrollTop = scrollHeight`。
- 宿主半边仅在 settings 服务可用时注册命名空间（回调式注入，缺失时静默跳过）。

## 开发

```powershell
npm run check     # node --check：语法检查（本包无 node_modules，行为测试需在带依赖的 profile 里跑）
```

改 `lib/client.js` 后由 client-hmr 自动热更新，无需重启。

## License

MIT
