/** 按魔数识别图片格式：PNG / JPEG / WebP / GIF。 */
export function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return undefined;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  const gif = buffer.subarray(0, 6).toString("ascii");
  if (gif === "GIF87a" || gif === "GIF89a") {
    return { mime: "image/gif", ext: "gif" };
  }
  return undefined;
}

/** 文件名前缀：空白折叠为 -，保留中文/字母/数字/连字符，其余（含路径不安全字符与标点）直接删除，截断到 30 字符。 */
export function slugify(text) {
  const slug = String(text ?? "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{Script=Han}\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return slug.length > 0 ? slug : "image";
}

/** 输出文件名：<前缀>-<时间戳>-<序号>.<扩展名>。 */
export function buildImageFilename(prefix, index, ext, now = new Date()) {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
    + `-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  return `${slugify(prefix)}-${stamp}-${index}.${ext}`;
}

/** 输出扩展名：优先配置的输出格式；配置 auto/未知时按字节魔数判定，仍未知回退 png。 */
export function extensionFor(buffer, outputFormat) {
  const configured = String(outputFormat ?? "").trim().toLowerCase();
  if (configured === "jpeg") return "jpg";
  if (configured === "png" || configured === "webp" || configured === "gif") return configured;
  const detected = detectImageFormat(buffer);
  if (detected !== undefined) return detected.ext;
  return "png";
}
