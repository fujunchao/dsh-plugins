# 打包约定（发布到市场前每个插件都要满足）

本仓库同时是 12 个插件的源码仓库和市场索引的生成源。`node scripts/check-packages.mjs` 把下面
的规则逐条检查；CI 在部署索引前会先跑它，任何一条不满足就不发布。

## 1. `package.json`

```json
{
  "name": "<包名，目录名必须等于包名的最后一段>",
  "version": "<精确 SemVer>",
  "description": "<一句话，进市场卡片>",
  "keywords": ["dsh", "deepseek-runtime", "plugin", "..."],
  "homepage": "https://github.com/fujunchao/dsh-plugins/tree/main/plugins/<目录名>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/fujunchao/dsh-plugins.git",
    "directory": "plugins/<目录名>"
  },
  "license": "MIT",
  "engines": { "node": ">=20", "dsh": ">=0.2.2-rc.3 <0.3.0-0" },
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "files": ["lib", "locale", "docs", "icon.svg", "cordis.patch.yml", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "market": { "category": "ui", "order": 10 },
    "client": { "platform": "web", "inject": ["..."] }
  }
}
```

- `dsh.bundle.patch` 是市场可选的前提；没有它 DSH 不认为这是 bundle。
- `dsh.market.category` 取 `market.config.json` 里声明的 id：`ui` / `model` / `tools` / `workflow`。
  `order` 只影响索引里的默认排序，越小越靠前。
- `exports` 必须导出 `./locale/*.json` 与 `./icon`，否则插件页读不到标题、描述和图标。
- `files` 必须包含 `cordis.patch.yml`、`locale`、`icon.svg`；有 `docs/` 时要包含 `docs`。
  README 和 LICENSE 由 npm 自动带上，不必列。
- 运行时字段（`dsh.client.inject`、`peerDependencies`、构建产物）保持原样，不要顺手改版本。

## 2. `cordis.patch.yml`

```yaml
- insert:
    - id: <短 id，与插件语义一致>
      name: '<package.json 的 name>'
      config:
        <默认配置，键和类型必须与该插件的 Config schema 一致>
```

- 一行只插入一个插件；`id` 在同一 profile 内唯一。
- `config` 里不能出现任何本机专属值（内网地址、密钥、绝对路径）。
- 已有 `cordis.patch.yml` 的包不要改行 id，避免已有安装变成"不可寻址行"。

## 3. `locale/en.json` 与 `locale/zh.json`

```json
{ "meta": { "title": "<插件页标题>", "description": "<插件页描述，说明能力与关键限制>" } }
```

英文标题用句首大写（sentence case）。这两个字符串也进市场卡片，长度控制在 60/140 字符以内。

## 4. `icon.svg`

- `width="32" height="32" viewBox="0 0 32 32"`，与本仓库已有的
  `dsh-resume` / `dsh-siyuan-notes` / `dsh-workspace-recent` 三个图标风格一致：圆角渐变底 + 单一主图形。
- 每个插件一个主色，避免两张卡看起来一样；颜色取饱和度适中的蓝/青/紫/橙。
- 只允许自包含几何图形：不要 `<style>`、`<script>`、`<image>`、`foreignObject`、滤镜发光、投影；
  文字要转路径（或不放文字）。文件小于 256 KiB。

## 5. `README.md` / `LICENSE` / `.gitignore`

- README 第一行必须是 `# <插件名>`，随后一句话说明；安装段落写成
  「在 DSH 插件页 → 发现 → 添加索引源 → 安装」，不要出现 `D:\`、`C:\Users\<你的名字>` 这类
  本机路径（需要举例时用 `~/.dsh/plugins/...`）。
- LICENSE 用仓库根目录同一份 MIT 文本，版权行统一写 `Copyright (c) 2026 dsh-plugins contributors`；**不要写个人姓名**，`package.json` 也不要加 `author` 字段（市场卡片是匿名来源）。
- `.gitignore` 至少包含 `node_modules/`、`*.bak-*`、`.local/`、`dist/`、`coverage/`。

## 6. 发布：工作副本 → 快照

每个插件在本机有两个副本，它们各有各的所有权，别把一边的东西手工抄到另一边：

| | 路径 | 谁拥有 |
|---|---|---|
| 工作副本 | 本机开发目录（`market.sources.local.json` 里登记） | 代码（`lib/`、`src/`；工作副本自带 `test/`/`tests/` 时连同测试）、`version`、`main`/`type`/`bin`、`dsh.client`、新加的依赖 |
| 发布快照 | `plugins/<name>`（入库、CI 从这里生成索引） | `README`、`docs/`、`locale/`、`icon.svg`、`LICENSE`、`cordis.patch.yml`、`files`、`scripts/` 目录、`package.json` 的 `scripts` 字段、`homepage`/`repository`、`dsh.bundle`/`dsh.market`、`engines`（含 `engines.dsh`）、依赖范围 |

```powershell
npm run sync:snapshot              # 把工作副本的代码、版本与运行时字段写进快照（顺带脱敏）
npm run sync:snapshot -- --dry-run # 只看会改什么
npm run scrub:snapshot             # 把脱敏表过一遍「快照自己拥有的」文件（README/docs/locale/…）
npm run check:drift                # 门禁：代码/版本/manifest 字段不一致，或已发布文件里还有真值，就红
```

- `market.sources.local.json`（**不入库**）登记「包名 → 工作副本绝对路径」和「真实值 → 发布值」的脱敏表；没有它时 `check:drift` 自动跳过，所以 CI 不用配。
- 工作副本若是插件管理器装出来的目录（`~/.dsh/plugins/<name>`），它没有版本管理，一次 `dsh plugin update` 或重装就会把它覆盖掉：这种包一旦改动，快照就是唯一可追溯的副本，落盘前先看 `git diff`。想长期养代码，把它换成一个真正的开发目录再登记。
- 脱敏分两道：`sync:snapshot` 管它复制的那些文件，`scrub:snapshot` 管快照自己拥有的文件；`check:drift` 最后扫**全部**已发布文件（不只代码），任何真值残留都判红。
- 测试里的路径不要照抄本机布局：会跟着语料走的就从句柄/桶名推导（`dsh-session-lens` 的 `tests/support/corpus.js` 就是例子），纯合成 fixture 用 `D:\work\…` 这类中性路径。
- 版本只增不减：快照已经发布了更高的版本时，`sync:snapshot` 会把**工作副本**抬到那个版本，绝不把已发布的版本号改小。
- 依赖表是合并而不是覆盖：快照里选了安装范围的条目保留（工作副本的差异会打 warn），工作副本新加的依赖会被发布出去。`engines` 反过来以快照为准，因为市场用它判断兼容性。
- 这条约定存在的理由：DSH 的「有新版本」徽标只比两串版本号——索引里的 `version`（来自快照）与 `listBundles()` 报的已装版本（来自 `link:` 的工作副本）。两边各自记账，就会出现「全是自己推上去的，却一半提示有新版本」。
- `exports` 属于快照：`check:drift` 会核对工作副本声明的入口在快照里都有，缺了算 drift（安装后加载不到），但不会替你改。

## 7. 验收

```powershell
node scripts/check-packages.mjs     # 你负责的包必须 0 FAIL
npm test                            # 在插件目录里跑，必须全绿
npm run check:drift                 # 只在有工作副本映射的机器上有意义
```

`check-packages.mjs` 会扫 `files` 里真正会发布的文件，本机绝对路径（盘符、`/Users/`、`/home/`）
一律算失败；README 里的 `<...>` 占位符除外。
