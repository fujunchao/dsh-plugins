# dsh-image-gen

DeepSeekRuntime (DSH) 图片生成插件：通过 **OpenAI Images 兼容端点**（`/images/generations` 与 `/images/edits`）为模型提供两个工具，端点与模型名完全可自定义（默认 `gpt-image-2.5`）。

- `generate_image` — 文生图。支持尺寸/质量/格式/张数/透明底，图片写入工作区并返回绝对路径。
- `edit_image` — 图生图/改图（multipart，1-16 张输入，PNG/JPEG/WebP/GIF）。

## 安装

DSH 插件页 → **发现** → **添加索引源** → 粘贴索引地址 `https://fujunchao.github.io/dsh-plugins/index.json`，
然后在卡片里安装 **dsh-image-gen**。本包是 bundle（`package.json` 声明 `dsh.bundle.patch`），安装时由 DSH
自动插入 `image-gen` 这一行；首次装完重启一次 DSH，设置页出现「图片生成」卡片，模型侧新增
`generate_image` / `edit_image` 工具。

bundle 的默认配置只写了两项，都取中性值：

```yaml
- insert:
    - id: image-gen
      name: 'dsh-image-gen'
      config:
        apiKeyEnv: OPENAI_API_KEY
        timeoutSeconds: 600
```

`baseURL` / `model` 刻意不写死：走 Config 默认（官方 `https://api.openai.com/v1` + `gpt-image-2.5`），
用自己的中转或其它兼容端点时，在设置卡里改即可，不必改仓库里的文件。

## 配置

设置页「图片生成」卡片（Web UI）或 `cordis.patch.yml` 直接配置：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `baseURL` | `https://api.openai.com/v1` | OpenAI Images 兼容根地址，不要带 `/images/generations` |
| `model` | `gpt-image-2.5` | 模型名，任意自定义 |
| `apiKey` | — | 字面 key（可选；一般走凭据服务） |
| `apiKeyEnv` | `IMAGE_GEN_API_KEY`（bundle 行里写 `OPENAI_API_KEY`） | 凭据 ref 名；解析失败自动回退 `OPENAI_API_KEY` |
| `size` | `auto` | 默认尺寸，`auto` 或 `宽x高`（比例 1:3~3:1） |
| `quality` | `medium` | `low` / `medium` / `high` / `auto` |
| `outputFormat` | `png` | `png` / `jpeg` / `webp` |
| `outputDir` | `images` | 输出目录（绝对路径或相对工作区根） |
| `n` | `1` | 默认张数（1-4） |
| `timeoutSeconds` | `300`（bundle 行里写 `600`） | 单次请求超时（30-900 秒；high 质量大图建议 300-600） |

API key 解析链（高 → 低）：配置字面 `apiKey` → 凭据服务 `apiKeyEnv` → 凭据服务 `OPENAI_API_KEY`。
key 通过设置卡写入 DSH 凭据服务，不落 profile 配置、不回显浏览器。

设置卡带「测试生成」按钮：真实生成一张 low 质量 1024x1024 测试图（约 $0.006）验证端点与密钥。

## 开发

零构建（`lib/` 手写 JS，无 src 目录）。测试：`npm test`（node --test）。

本仓库不含 `node_modules`，测试依赖 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-credentials`、
`@deepseek-ai/dsh-launch-environment` 三个宿主包，需要在带依赖的环境（安装后的 profile 或本地
`npm install`）里跑；仓库内不做依赖安装。

## License

MIT
