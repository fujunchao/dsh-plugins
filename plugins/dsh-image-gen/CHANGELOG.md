# Changelog

## 0.1.0 (2026-10-15)

初始版本。

- `generate_image` / `edit_image` 两个模型工具（OpenAI Images 兼容端点，端点/模型可自定义，默认 gpt-image-2.5）。
- 设置卡（Web UI「图片生成」）：端点、模型、凭据、默认尺寸/质量/格式/张数/超时/输出目录；API key 走 DSH 凭据服务（回退链 IMAGE_GEN_API_KEY → OPENAI_API_KEY）。
- loopback 测试 API：`GET /dsh-image-gen/api/check`（配置体检）、`POST /dsh-image-gen/api/test`（真实生成一张 low 质量测试图）。
- 中断语义：预中断/请求中断返回结构化错误（ok=false）而非抛异常；输出 schema 全键集一致。
