/**
 * 最小 asar 读写：读条目、原位替换一个条目（含偏移重基与头部重建）。
 *
 * 为什么自己写：宿主把依赖打进 app.asar（归档形态），Electron 的 fs 能读不能写；
 * 打补丁必须在宿主关闭时对归档做「替换条目 → 重排偏移 → 重建头部 → self-swap」。
 * 算法沿用 ~/.dsh/backups/app-asar-before-xhigh-20261113/reapply-xhigh-patch.cjs（已实战验证）。
 *
 * 同时支持目录形态（部分安装是把 asar 解开的）：那时直接读写普通文件。
 *
 * @module dsh-clean-route/asar
 */

import {
  closeSync,
  copyFileSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/** 归档内路径统一成 / 分隔。 */
function normalizeEntry(path) {
  return path.split("\\").join("/");
}

/** 时间戳后缀，用于备份文件名。 */
export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * 判断路径形态：
 *  - "archive"：普通 Node 里看到的 app.asar 文件；
 *  - "mounted"：Electron 宿主里被挂载的 asar（读得到、写不了，`statSync` 会谎报目录）；
 *  - "directory"：真正解开的安装目录；
 *  - "missing"：不存在。
 */
export function archiveForm(archivePath, options = {}) {
  const electron = options.electron ?? typeof process.versions.electron === "string";
  let stat;
  try {
    stat = statSync(archivePath);
  } catch {
    return "missing";
  }
  const looksLikeArchive = /\.asar$/i.test(archivePath) || archivePath.includes(".asar/") || archivePath.includes(".asar\\");
  if (!stat.isDirectory()) return "archive";
  // Electron 里 .asar 永远是挂载点；纯 Node 里同名目录更可能是真的解开了。
  if (electron && looksLikeArchive) return "mounted";
  return "directory";
}

/** 读归档头部：返回打开的文件描述符、header、数据区起点与归档大小。 */
export function readHeader(archivePath) {
  const fd = openSync(archivePath, "r");
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const jsonLength = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    readSync(fd, json, 0, jsonLength, 16);
    return {
      fd,
      header: JSON.parse(json.toString("utf8")),
      dataStart: 16 + Math.ceil(jsonLength / 4) * 4,
      size: fstatSync(fd).size,
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** 深度优先遍历头部，产出 `{ path, node }`（node 带 offset/size 或 unpacked）。 */
export function walkFiles(header) {
  const out = [];
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node.files ?? {})) {
      const path = prefix === "" ? key : prefix + "/" + key;
      if (value.files !== undefined) walk(value, path);
      else out.push({ path: normalizeEntry(path), node: value });
    }
  };
  walk(header, "");
  return out;
}

/** 读取一个条目的字节。 */
export function readEntry(handle, entry) {
  const buffer = Buffer.alloc(entry.node.size);
  readSync(handle.fd, buffer, 0, entry.node.size, handle.dataStart + Number(entry.node.offset));
  return buffer;
}

/** 读归档（或解开的目录）里的一个文本文件。 */
export function readText(archivePath, entryPath) {
  const form = archiveForm(archivePath);
  const target = normalizeEntry(entryPath);
  if (form === "directory") return readFileSync(join(archivePath, target), "utf8");
  if (form === "mounted") return readFileSync(archivePath + "/" + target, "utf8");
  if (form !== "archive") throw new Error("宿主目录不存在：" + archivePath);
  const handle = readHeader(archivePath);
  try {
    const entry = walkFiles(handle.header).find((candidate) => candidate.path === target);
    if (entry === undefined) throw new Error("归档里没有这个条目：" + target);
    return readEntry(handle, entry).toString("utf8");
  } finally {
    closeSync(handle.fd);
  }
}

/**
 * 替换一个条目的文本。
 *
 * 目录形态：备份后直接写文件。
 * 归档形态：按条目新旧长度重排后续偏移、重建头部、流式写出新归档，最后 self-swap。
 *
 * @param {string} archivePath app.asar（或解开的目录）
 * @param {string} entryPath 归档内路径（/ 分隔）
 * @param {string} nextText 新内容
 * @param {{ backup?: boolean }} [options] 是否留一份备份（默认 true）
 */
export function replaceEntryText(archivePath, entryPath, nextText, { backup = true, electron } = {}) {
  const form = archiveForm(archivePath, electron === undefined ? undefined : { electron });
  if (form === "missing") throw new Error("宿主目录不存在：" + archivePath);
  if (form === "mounted") {
    const error = new Error("宿主正在运行：app.asar 处于挂载状态，只能读不能写");
    error.code = "ASAR_MOUNTED";
    throw error;
  }
  const targetPath = normalizeEntry(entryPath);

  if (form === "directory") {
    const file = join(archivePath, targetPath);
    const original = readFileSync(file, "utf8");
    const backupPath = backup ? file + ".bak-clean-route-" + stamp() : null;
    if (backupPath !== null) copyFileSync(file, backupPath);
    writeFileSync(file, nextText, "utf8");
    return { changed: true, form, path: file, backup: backupPath, delta: Buffer.byteLength(nextText) - Buffer.byteLength(original) };
  }

  const handle = readHeader(archivePath);
  const entries = walkFiles(handle.header);
  const target = entries.find((entry) => entry.path === targetPath);
  if (target === undefined) {
    closeSync(handle.fd);
    throw new Error("归档里没有这个条目：" + targetPath);
  }
  const oldBuffer = readEntry(handle, target);
  const newBuffer = Buffer.from(nextText, "utf8");
  const delta = newBuffer.length - oldBuffer.length;
  const patchedStart = handle.dataStart + Number(target.node.offset);
  const patchedEnd = patchedStart + oldBuffer.length;

  // 偏移是相对数据区起点的：被替换内容之后的所有条目按 delta 平移即可，
  // 头部大小变化只影响数据区在文件里的绝对位置，不影响条目偏移。
  const oldEndOffset = Number(target.node.offset) + oldBuffer.length;
  target.node.size = newBuffer.length;
  for (const entry of entries) {
    if (entry.node.offset === undefined) continue;
    if (Number(entry.node.offset) >= oldEndOffset) entry.node.offset = String(Number(entry.node.offset) + delta);
  }
  const json = Buffer.from(JSON.stringify(handle.header), "utf8");

  // asar 头部：0=4（pickle 头长度），4/8 按“含空格填充”的长度记录，12 记录未填充的 JSON 长度。
  const unpaddedLength = json.length;
  const padLength = (4 - (unpaddedLength % 4)) % 4;
  const paddedJson = padLength === 0 ? json : Buffer.concat([json, Buffer.alloc(padLength, 0x20)]);
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(4 + 4 + paddedJson.length, 4);
  prefix.writeUInt32LE(4 + paddedJson.length, 8);
  prefix.writeUInt32LE(unpaddedLength, 12);

  const staging = archivePath + ".clean-route-new";
  const out = openSync(staging, "w");
  try {
    writeSync(out, prefix);
    writeSync(out, paddedJson);
    const CHUNK = 4 * 1024 * 1024;
    let position = handle.dataStart;
    const copyUntil = (endExclusive) => {
      while (position < endExclusive) {
        const length = Math.min(CHUNK, endExclusive - position);
        const buffer = Buffer.alloc(length);
        readSync(handle.fd, buffer, 0, length, position);
        writeSync(out, buffer);
        position += length;
      }
    };
    copyUntil(patchedStart);
    writeSync(out, newBuffer);
    position = patchedEnd;
    copyUntil(handle.size);
  } finally {
    closeSync(out);
    closeSync(handle.fd);
  }

  const backupPath = backup ? archivePath + ".bak-clean-route-" + stamp() : null;
  if (backupPath !== null) copyFileSync(archivePath, backupPath);
  renameSync(staging, archivePath);
  return { changed: true, form, path: archivePath, backup: backupPath, delta };
}
