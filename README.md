# DSH 插件集 · 市场索引

面向 [DeepSeekRuntime（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的一组插件，外加一个 DSH「发现」页能直接读取的**插件索引**（plugin market index, format 1）。

## 在 DSH 里安装

1. **插件** → 实验性插件 → 打开 **自定义插件索引**。
2. 切到 **发现** → **添加索引源**，填入：

   ```
   https://fujunchao.github.io/dsh-plugins/index.json
   ```

3. 搜索插件名 → 打开卡片 → **安装**。DSH 会以固定 commit 安装到当前 profile：

   ```
   git+https://github.com/fujunchao/dsh-plugins.git#<sha>&path:/plugins/<name>
   ```

索引里每个版本都钉死在某个提交上；`scripts/check-index.mjs` 用 DSH 自带校验器验证格式，CI 在每次 push 时重跑。

## 插件

| 插件 | 能力 | 分类 |
|---|---|---|
| `dsh-clean-route` | 按规则表剔除系统提示词里会被上游识别为指纹的段落，工具声明原样透传 | 模型与供应商 |
| `dsh-model-tuning` | 供应商与模型增删、每模型思考等级（含 Gemini xhigh 补丁托管）、新会话默认模型与档位 | 模型与供应商 |
| `dsh-quote-ref` | 选中对话片段 → 输入框里的引用胶囊，发送时展开全文 | 界面 |
| `dsh-resume` | 会话中断后把发送键变成「▶ 继续」，带着中断现场继续未完成的工作 | 界面 |
| `dsh-thinking-scroll` | 给展开的推理块加可滚动窗口，并跟随流式输出 | 界面 |
| `dsh-workspace-recent` | 侧边栏项目按最近工作时间自动排序 | 界面 |
| `dsh-session-lens` | 跨项目只读会话浏览：列项目、跨区检索、按轮次阅读 | 工具与数据 |
| `dsh-session-vault` | 会话归档恢复、可恢复回收站、批量管理与安全永久清除 | 工具与数据 |
| `dsh-siyuan-notes` | 在侧边栏浏览、搜索并块级编辑思源笔记，保存前自动备份 | 工具与数据 |
| `dsh-image-gen` | 图片生成与改图工具（OpenAI Images 兼容端点） | 工具与数据 |
| `dsh-web-search-multi` | 多通道网页搜索与抓取 | 工具与数据 |
| `dsh-research-team` | 深度研究专家团：主理人 + 6 专家 5 阶段编排，产出带引用的研究报告 | 工作流 |

## 仓库结构

```
plugins/<name>/            一个插件一个目录，每个都是可独立安装的 DSH bundle
docs/index.json            CI 生成的市场索引（不入库，部署到 Pages）
docs/icons/<name>.svg      索引卡片的图标（从各包的 icon.svg 复制）
market.config.json         索引标题、描述、分类、仓库地址
scripts/build-index.mjs    从 package.json + git 提交生成索引
scripts/check-index.mjs    用 DSH 官方校验器验证索引，并核对版本/引擎声明
scripts/check-packages.mjs 发布前体检：bundle patch、图标、locale、元数据、绝对路径
scripts/test-all.mjs       跑零依赖包的测试
scripts/verify-git-install.mjs  用 pnpm 真实安装索引里钉住的 git spec（需要已推送的 commit）
scripts/refresh-vendor.mjs 从本机 DSH 安装包重新取回官方索引校验器
.github/workflows/publish.yml  体检 → 测试 → 生成索引 → 部署 Pages
```

## 本地开发

```powershell
npm install
npm run verify            # 体检 + 测试 + 生成索引 + 校验
npm run verify:install -- dsh-resume   # 真实 pnpm 安装一次索引里的 git spec
```

只改前端调试时，仍可用 `plugin_manager` 的 `install_bundle` 指向插件目录（`link:` 安装）；市场安装的是 git 固定副本，两者互不影响。开发链路想保留热更新，就别把开发 profile 里指向本地目录的插件换成市场版本。

## 发版

1. 改插件目录里的 `version`（以及需要时的 `CHANGELOG`）。
2. push 到 `main`。
3. CI 体检 → 测试 → 用当次 `GITHUB_SHA` 生成索引 → 校验 → 部署 Pages。

索引的 `publishTimestamp` 取该插件目录最后一次提交时间；`engines.dsh` 取自 `package.json`，DSH 安装时会再校验一次。

## 说明

- 这些插件原先分散在本机各目录、以 `link:` 方式安装在作者自己的 profile 里；本仓库是它们的公开来源，`dsh-quote-ref`、`dsh-image-gen`、`dsh-research-team`、`dsh-session-vault`、`dsh-thinking-scroll`、`dsh-web-search-multi` 的独立仓库不再更新。
- 市场索引是第三方内容：DSH 只校验格式，不校验声明。本索引由本仓库 CI 生成，安装前请核对确认框里的来源。

## 许可

MIT，见 [LICENSE](LICENSE)。
