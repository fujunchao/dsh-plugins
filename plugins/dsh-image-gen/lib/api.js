import { readFile } from "node:fs/promises";
import path from "node:path";
import { detectImageFormat } from "./images.js";
import { describeError, fetchWithRetry } from "./retry.js";

/**
 * OpenAI Images API 兼容客户端（/images/generations 与 /images/edits）。
 * 零依赖：fetch / FormData / Blob 都是 Node 18+ 内置（AbortSignal.any 需 20.3+，
 * 此处带特性检测回退，兼容 Electron 内置的较旧 Node）。
 */

/** 错误码：INVALID_INPUT / CREDENTIAL_MISSING / PROVIDER_ERROR / TIMEOUT / ABORTED / UNSUPPORTED_RESPONSE。 */
export class ImageApiError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = "ImageApiError";
    this.code = code;
  }
}

export const QUALITIES = ["low", "medium", "high", "auto"];
export const OUTPUT_FORMATS = ["png", "jpeg", "webp"];
export const BACKGROUNDS = ["auto", "transparent", "opaque"];

const MAX_EDGE = 3840;
const MIN_EDGE = 64;
const MAX_RATIO = 3;

/**
 * 校验并归一 size："auto" 或 "宽x高"。
 * 只做保底校验（边长范围、比例 1:3~3:1）；16 倍数等更严的模型规则交给端点报错，
 * 以兼容宽松的自定义端点和其他模型。
 */
export function validateSize(size) {
  const value = String(size ?? "").trim().toLowerCase();
  if (value === "auto" || value === "") return "auto";
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(value);
  if (match === null) {
    throw new ImageApiError(`size "${size}" 无效：应为 auto 或 宽x高（如 2048x1152）`, "INVALID_INPUT");
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < MIN_EDGE || height < MIN_EDGE || width > MAX_EDGE || height > MAX_EDGE) {
    throw new ImageApiError(
      `size "${value}" 超出范围：宽高各须在 ${MIN_EDGE}-${MAX_EDGE} 之间（官方上限 3840x2160）`,
      "INVALID_INPUT",
    );
  }
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > MAX_RATIO) {
    throw new ImageApiError(`size "${value}" 无效：宽高比须在 1:3 ~ 3:1 之间`, "INVALID_INPUT");
  }
  return `${width}x${height}`;
}

/** 组合调用方取消信号与整体超时；AbortSignal.any 不可用时退化为仅超时。 */
function requestSignals(timeoutSeconds, signal) {
  const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (signal === undefined || typeof AbortSignal.any !== "function") {
    return { timeoutSignal, timeoutSeconds, fetchSignal: timeoutSignal };
  }
  return { timeoutSignal, timeoutSeconds, fetchSignal: AbortSignal.any([signal, timeoutSignal]) };
}

function endpointOf(baseURL, pathname) {
  return `${String(baseURL ?? "").replace(/\/+$/, "")}${pathname}`;
}

async function readResponse(response, label) {
  if (!response.ok) {
    let message = `${label} API error (HTTP ${response.status})`;
    try {
      const parsed = await response.json();
      const detail =
        typeof parsed.detail === "string"
          ? parsed.detail
          : parsed.detail?.error ?? parsed.error?.message ?? parsed.message;
      if (detail) message = typeof detail === "string" ? detail : JSON.stringify(detail);
    } catch {}
    throw new ImageApiError(message, "PROVIDER_ERROR");
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ImageApiError(`${label} 响应不是合法 JSON: ${describeError(error)}`, "PROVIDER_ERROR", { cause: error });
  }
}

function wrapNetworkError(error, label, signal, timeoutContext) {
  // AbortSignal.timeout() 抛出的是名为 TimeoutError 的 DOMException（不是 AbortError），
  // 所以这里按「哪个信号先置位」分类，而不是靠异常名。
  if (signal?.aborted === true) {
    throw new ImageApiError("请求已取消", "ABORTED", { cause: error });
  }
  if (timeoutContext?.timeoutSignal?.aborted === true) {
    throw new ImageApiError(
      `请求超过 ${timeoutContext.timeoutSeconds} 秒未返回而超时。` +
        "可在插件设置调大 timeoutSeconds（high 质量大图约需 120-180 秒），或先用 low 质量试构图",
      "TIMEOUT",
      { cause: error },
    );
  }
  if (error?.name === "TimeoutError") {
    throw new ImageApiError(
      `请求超过 ${timeoutContext?.timeoutSeconds ?? "?"} 秒未返回而超时。` +
        "可在插件设置调大 timeoutSeconds（high 质量大图约需 120-180 秒），或先用 low 质量试构图",
      "TIMEOUT",
      { cause: error },
    );
  }
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") {
    throw new ImageApiError("请求已取消", "ABORTED", { cause: error });
  }
  if (error instanceof ImageApiError) throw error;
  throw new ImageApiError(`${label} 请求失败: ${describeError(error)}`, "PROVIDER_ERROR", { cause: error });
}

/** 解析 Images API 响应：data[] 里每项须有 b64_json 或 url。 */
export function parseImagesResponse(data, label = "Images") {
  const items = data?.data;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ImageApiError(
      `${label} 响应里没有 data 数组（顶层键: ${Object.keys(data ?? {}).join(", ") || "无"}）` +
        "——若使用的是兼容端点，请确认其支持 /images/generations 的图片生成模型",
      "UNSUPPORTED_RESPONSE",
    );
  }
  return items.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new ImageApiError(`${label} 响应 data[${index}] 不是对象`, "UNSUPPORTED_RESPONSE");
    }
    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      return { kind: "base64", value: item.b64_json };
    }
    if (typeof item.url === "string" && item.url.length > 0) {
      return { kind: "url", value: item.url };
    }
    throw new ImageApiError(
      `${label} 响应 data[${index}] 既没有 b64_json 也没有 url（键: ${Object.keys(item).join(", ") || "无"}）`,
      "UNSUPPORTED_RESPONSE",
    );
  });
}

/** url 结果可能是签名直链，也可能是相对路径（相对 baseURL）。 */
function resolveImageUrl(url, baseURL) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${String(baseURL ?? "").replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function decodeItems(items, { baseURL, apiKey, timeoutSeconds, signal, label }) {
  const buffers = [];
  for (const item of items) {
    if (item.kind === "base64") {
      const buffer = Buffer.from(item.value, "base64");
      if (buffer.length === 0) {
        throw new ImageApiError(`${label} 响应的 b64_json 解码后为空`, "UNSUPPORTED_RESPONSE");
      }
      buffers.push(buffer);
      continue;
    }
    // url 直链下载；相对路径视为同源并带上鉴权头
    const target = resolveImageUrl(item.value, baseURL);
    const sameOrigin = !/^https?:\/\//i.test(item.value);
    const signals = requestSignals(timeoutSeconds, signal);
    let response;
    try {
      response = await fetchWithRetry(
        target,
        {
          headers: sameOrigin && apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        },
        signals.fetchSignal,
      );
    } catch (error) {
      throw wrapNetworkError(error, `${label} 图片下载`, signal, signals);
    }
    if (!response.ok) {
      throw new ImageApiError(`下载生成图片失败 (HTTP ${response.status}: ${target})`, "PROVIDER_ERROR");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new ImageApiError(`下载生成图片为空: ${target}`, "UNSUPPORTED_RESPONSE");
    }
    buffers.push(buffer);
  }
  return buffers;
}

/** 组装请求体：auto 档位不发送（兼容不支持这些字段的端点/模型），png 为默认格式也不发送。 */
function buildBody(options) {
  const body = { model: options.model, prompt: options.prompt, n: options.n };
  const size = validateSize(options.size);
  if (size !== "auto") body.size = size;
  if (options.quality !== undefined && options.quality !== "auto") body.quality = options.quality;
  if (options.background !== undefined && options.background !== "auto") body.background = options.background;
  if (options.outputFormat !== undefined && options.outputFormat !== "png") {
    body.output_format = options.outputFormat;
  }
  return body;
}

/**
 * 文生图：POST {baseURL}/images/generations。
 * 返回 { images: Buffer[], usage?, revisedPrompt? }。
 */
export async function generateImages(options, signal) {
  const label = "Images";
  const body = buildBody(options);
  const signals = requestSignals(options.timeoutSeconds, signal);
  let data;
  try {
    const response = await fetchWithRetry(
      endpointOf(options.baseURL, "/images/generations"),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      signals.fetchSignal,
    );
    data = await readResponse(response, label);
  } catch (error) {
    throw wrapNetworkError(error, label, signal, signals);
  }
  const items = parseImagesResponse(data, label);
  const images = await decodeItems(items, { ...options, label });
  const revisedPrompt = items.length === 1 && typeof data.data[0]?.revised_prompt === "string"
    ? data.data[0].revised_prompt
    : undefined;
  return { images, ...(data.usage ? { usage: data.usage } : {}), ...(revisedPrompt ? { revisedPrompt } : {}) };
}

/**
 * 图生图/改图：POST {baseURL}/images/edits（multipart/form-data）。
 * 多张输入用 image[] 字段（OpenAI SDK 行为），单张用 image。
 */
export async function editImages(options, signal) {
  const label = "Images edits";
  const files = [];
  for (const imagePath of options.imagePaths) {
    let buffer;
    try {
      buffer = await readFile(imagePath);
    } catch (error) {
      throw new ImageApiError(`读取输入图片失败: ${imagePath} (${error?.code ?? String(error)})`, "INVALID_INPUT", {
        cause: error,
      });
    }
    const kind = detectImageFormat(buffer);
    if (kind === undefined) {
      throw new ImageApiError(
        `输入图片格式无法识别（仅支持 PNG/JPEG/WebP/GIF）: ${imagePath}`,
        "INVALID_INPUT",
      );
    }
    files.push({ name: path.basename(imagePath), buffer, mime: kind.mime });
  }

  const form = new FormData();
  form.append("model", options.model);
  form.append("prompt", options.prompt);
  form.append("n", String(options.n));
  const body = buildBody(options);
  if (body.size !== undefined) form.append("size", body.size);
  if (body.quality !== undefined) form.append("quality", body.quality);
  if (body.background !== undefined) form.append("background", body.background);
  if (body.output_format !== undefined) form.append("output_format", body.output_format);
  const field = files.length > 1 ? "image[]" : "image";
  for (const file of files) {
    form.append(field, new Blob([file.buffer], { type: file.mime }), file.name);
  }

  const signals = requestSignals(options.timeoutSeconds, signal);
  let data;
  try {
    // 注意不要手动设置 Content-Type：fetch 会带上 multipart 边界。
    const response = await fetchWithRetry(
      endpointOf(options.baseURL, "/images/edits"),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
      },
      signals.fetchSignal,
    );
    data = await readResponse(response, label);
  } catch (error) {
    throw wrapNetworkError(error, label, signal, signals);
  }
  const items = parseImagesResponse(data, label);
  const images = await decodeItems(items, { ...options, label });
  return { images, ...(data.usage ? { usage: data.usage } : {}) };
}
