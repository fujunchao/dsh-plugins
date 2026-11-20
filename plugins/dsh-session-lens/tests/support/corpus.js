/**
 * 真实会话日志读取器（仅测试用）。
 *
 * 会话日志是**多帧 zstd 追加**：每次 flush 写一个独立帧。Node 的
 * `zstdDecompressSync` / `createZstdDecompress` 都只吃第一帧（823 KB 的文件里
 * 第一帧只解出 header 那一行 274 字节，而且不报错）。所以这里按 zstd 魔数扫描帧起点，
 * 逐帧解、再按 seq 去重合并——这正是生产代码必须走 `ctx.sessionQuery` 而不是自己读文件的原因。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const DEFAULT_ROOT = path.join(os.homedir(), ".dsh", "sessions");

/** 一个会话可能产生消息的事件类型（与 dsh-session 的 SurfaceEventType 一致）。 */
export const SURFACE_TYPES = new Set([
  "system/message",
  "developer/message",
  "user/message",
  "assistant/message",
  "tool/result",
]);

/**
 * 解出一个会话文件里的全部事件。
 * @param {string} file `session.v4.jsonl.zstd` 的绝对路径。
 * @returns {{header: any, events: any[]}} header 与去重后的事件（按 seq 升序）。
 */
export function readSessionFile(file) {
  const buffer = fs.readFileSync(file);
  const offsets = [];
  for (let index = 0; index <= buffer.length - MAGIC.length; index += 1) {
    if (
      buffer[index] === MAGIC[0] &&
      buffer[index + 1] === MAGIC[1] &&
      buffer[index + 2] === MAGIC[2] &&
      buffer[index + 3] === MAGIC[3]
    ) {
      offsets.push(index);
    }
  }

  /** @type {Map<number, any>} */
  const events = new Map();
  let header;
  for (const offset of offsets) {
    let text;
    try {
      text = zlib.zstdDecompressSync(buffer.subarray(offset)).toString("utf8");
    } catch {
      continue; // 魔数出现在压缩数据内部时会解失败，跳过即可。
    }
    for (const line of text.split("\n")) {
      if (line === "") continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.type === "session") {
        header = parsed;
        continue;
      }
      if (typeof parsed.seq === "number") events.set(parsed.seq, parsed);
    }
  }
  if (header === undefined) throw new Error(`no session header in ${file}`);
  return { header, events: [...events.values()].sort((left, right) => left.seq - right.seq) };
}

/**
 * 读一个 cwd 桶下的全部会话。
 * @param {string} bucket 桶目录名，例如 `--D-work-cz--`。
 * @param {string} [root] 会话根目录。
 * @returns {{file: string, header: any, events: any[]}[]} 会话。
 */
export function loadBucket(bucket, root = DEFAULT_ROOT) {
  const dir = path.join(root, bucket);
  if (!fs.existsSync(dir)) return [];
  const sessions = [];
  for (const entry of fs.readdirSync(dir)) {
    const file = path.join(dir, entry, "session.v4.jsonl.zstd");
    if (!fs.existsSync(file)) continue;
    const { header, events } = readSessionFile(file);
    sessions.push({ file, header, events });
  }
  return sessions;
}

/**
 * 列出会话根下的所有桶名。
 * @param {string} [root] 会话根目录。
 * @returns {string[]} 桶目录名。
 */
export function listBuckets(root = DEFAULT_ROOT) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((entry) => fs.statSync(path.join(root, entry)).isDirectory());
}

/**
 * 本机是否有可用的真实会话语料（没有时相关测试整组跳过）。
 * @param {string} [root] 会话根目录。
 * @returns {boolean} 是否存在。
 */
export function hasCorpus(root = DEFAULT_ROOT) {
  return fs.existsSync(root) && listBuckets(root).length > 0;
}

/**
 * 从一个桶里挑若干个会话，按文件体积升序（小文件先，测试跑得快）。
 * @param {string} bucket 桶目录名。
 * @param {{limit?: number, newest?: boolean}} [options] 选项。
 * @returns {{file: string, header: any, events: any[]}[]} 会话。
 */
export function pickSessions(bucket, options = {}) {
  const dir = path.join(DEFAULT_ROOT, bucket);
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir)) {
    const file = path.join(dir, entry, "session.v4.jsonl.zstd");
    if (!fs.existsSync(file)) continue;
    files.push({ file, bytes: fs.statSync(file).size });
  }
  files.sort((left, right) => (options.newest === true ? right.bytes - left.bytes : left.bytes - right.bytes));
  return files.slice(0, options.limit ?? 5).map(({ file }) => {
    const { header, events } = readSessionFile(file);
    return { file, header, events };
  });
}
