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

## 6. 验收

```powershell
node scripts/check-packages.mjs     # 你负责的包必须 0 FAIL
npm test                            # 在插件目录里跑，必须全绿
```

`check-packages.mjs` 会扫 `files` 里真正会发布的文件，本机绝对路径（盘符、`/Users/`、`/home/`）
一律算失败；README 里的 `<...>` 占位符除外。
