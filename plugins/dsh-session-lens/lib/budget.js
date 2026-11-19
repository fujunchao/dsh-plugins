/**
 * 预算裁剪。
 *
 * 会话正文可以到几十万 token，而工具结果必须**有界且可续读**：一次调用只给装得下的
 * 部分，并且明确告诉调用方“从哪儿接着读”。裁剪以**事件**为最小单位——半个事件读到
 * 一半会让续读指引变得无法精确。
 *
 * @module dsh-session-lens/budget
 */

/**
 * UTF-8 字节数。预算用字节而不是字符，因为模型上下文是按 token（≈字节/4）计的，
 * 而中文一个字常常三字节，用字符数会低估两三倍。
 * @param {string} text 文本。
 * @returns {number} 字节数。
 */
export function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

/**
 * 从一组块里取出装得下的前缀。
 * @template {{ text: string }} T
 * @param {readonly T[]} blocks 按顺序排列的块（每个块是一条消息/事件/一轮）。
 * @param {number} maxBytes 字节上限。
 * @returns {{ kept: T[], truncated: boolean, usedBytes: number, omitted: number }} 裁剪结果。
 */
export function fitBlocks(blocks, maxBytes) {
  /** @type {T[]} */
  const kept = [];
  let used = 0;
  for (const block of blocks) {
    const cost = byteLength(block.text) + (kept.length === 0 ? 0 : 1); // 换行符
    if (kept.length > 0 && used + cost > maxBytes) {
      return { kept, truncated: true, usedBytes: used, omitted: blocks.length - kept.length };
    }
    kept.push(block);
    used += cost;
  }
  return { kept, truncated: false, usedBytes: used, omitted: 0 };
}

/**
 * 人类可读的体积。
 * @param {number} bytes 字节数。
 * @returns {string} 形如 `3.1 KB` / `812 B`。
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
