/**
 * xhigh 补丁托管：检测宿主 pi-ai 的第四档支持，必要时写入三处改动。
 *
 * 为什么在这里：第四档的缺口在 @earendil-works/pi-ai 内部（一张 thinking level 表
 * 与两个 switch），DSH 插件层没有可用关口——`llm/stream` 只能改已有档位名，
 * fetch 改写发生在抛错之后。所以插件只负责「发现 + 写回 + 状态展示」，不造档位。
 *
 * 目标条目（归档内路径）：
 *   dsh/node_modules/@earendil-works/pi-ai/dist/api/google-shared.js
 *
 * @module dsh-clean-route/xhigh
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveForm, replaceEntryText, readText } from "./asar.js";

/** 宿主归档/目录里的目标条目。 */
export const TARGET_ENTRY = "dsh/node_modules/@earendil-works/pi-ai/dist/api/google-shared.js";

/** 三处锚点：命中次数必须恰好 1（版本漂移时宁可停手也不乱改）。 */
export const EDITS = [
  {
    label: "thinking level 表项",
    from: '    HIGH: GoogleSdkThinkingLevel.HIGH,\n};',
    to: '    HIGH: GoogleSdkThinkingLevel.HIGH,\n    XHIGH: "XHIGH",\n};',
  },
  {
    label: "resolveGoogleThinkingLevel",
    from: '        case "high":\n            return resolvedLevel;',
    to: '        case "high":\n        case "xhigh":\n            return resolvedLevel;',
  },
  {
    label: "toGoogleThinkingLevel",
    from: '        case "high":\n            return "HIGH";\n    }',
    to: '        case "high":\n            return "HIGH";\n        case "xhigh":\n            return "XHIGH";\n    }',
  },
];

const PATCH_MARK = 'XHIGH: "XHIGH"';

/** 记住宿主 resources 路径的状态文件（纯 Node 的 CLI 靠它找到 Electron 的安装）。 */
export function stateFilePath() {
  return join(homedir(), ".dsh", "clean-route-state.json");
}

/** 读记住的 resources 路径；坏文件当没有。 */
function rememberedResources() {
  try {
    const raw = JSON.parse(readFileSync(stateFilePath(), "utf8"));
    return typeof raw?.resources === "string" && raw.resources.length > 0 ? raw.resources : null;
  } catch {
    return null;
  }
}

/** 把宿主 resources 路径记下来（插件在 Electron 里自动定位成功后调用）。 */
export function rememberResources(resourcesPath) {
  try {
    mkdirSync(dirname(stateFilePath()), { recursive: true });
    writeFileSync(stateFilePath(), JSON.stringify({ resources: resourcesPath, at: Date.now() }, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 定位宿主 resources 目录，优先级：
 * 1. 显式 override / 环境变量 DSH_CLEAN_ROUTE_RESOURCES
 * 2. 调用方给的 resourcesPath
 * 3. 运行中可执行文件同级的 resources（插件在 Electron 里就是这条）
 * 4. 上次插件自动定位成功时记住的路径（纯 Node 跑 CLI 时用）
 */
export function locateResources({ resourcesPath, override } = {}) {
  const explicit = override ?? process.env.DSH_CLEAN_ROUTE_RESOURCES;
  if (explicit !== undefined && explicit !== "") return { path: explicit, via: "override" };
  if (resourcesPath !== undefined && resourcesPath !== "") return { path: resourcesPath, via: "parameter" };
  const executable = process.execPath;
  if (typeof executable === "string" && executable.length > 0) {
    const sibling = join(dirname(executable), "resources");
    if (existsSync(join(sibling, "app.asar"))) return { path: sibling, via: "execPath" };
  }
  const remembered = rememberedResources();
  if (remembered !== null && existsSync(join(remembered, "app.asar"))) return { path: remembered, via: "remembered" };
  return { path: null, via: "unavailable" };
}

/** 本仓库里打补丁的 CLI。 */
export function applyScriptPath() {
  return fileURLToPath(new URL("../scripts/xhigh.mjs", import.meta.url));
}

/** 找一个能跑 CLI 的 node：环境变量 > 宿主自带运行时 > PATH 上的 node。 */
export function resolveNodeBinary() {
  const explicit = process.env.DSH_NODE;
  if (explicit !== undefined && explicit !== "" && existsSync(explicit)) return explicit;
  const root = join(homedir(), ".dsh", "dsh-runtimes");
  try {
    for (const runtime of readdirSync(root)) {
      const candidate = join(root, runtime, "dependencies", "node", "bin", process.platform === "win32" ? "node.exe" : "node");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* 没有自带运行时就用 PATH 上的 node */
  }
  return "node";
}

/** 「退出宿主后运行这个」的完整命令。 */
export function applyCommand() {
  const node = resolveNodeBinary();
  const script = applyScriptPath();
  return node === "node" ? `node "${script}" apply` : `"${node}" "${script}" apply`;
}

/** 宿主是否正把 app.asar 挂在进程里（Electron 下只读）。 */
export function mountedArchive({ resourcesPath, override } = {}) {
  const located = locateResources({ resourcesPath, override });
  if (located.path === null) return { archive: null, form: "missing" };
  const archive = join(located.path, "app.asar");
  return { archive, form: archiveForm(archive) };
}

/** 在源码里数一条锚点出现的次数。 */
function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** 计算补丁后的源码；已打过或锚点漂移时抛错，且不产生任何写入。 */
export function patchSource(source) {
  if (source.includes(PATCH_MARK)) return { source, changed: false, applied: [] };
  let next = source;
  const applied = [];
  for (const edit of EDITS) {
    const matches = countOccurrences(next, edit.from);
    if (matches !== 1) {
      throw new Error("锚点「" + edit.label + "」命中 " + matches + " 次（应恰好 1 次）：宿主版本漂移，停手");
    }
    next = next.replace(edit.from, edit.to);
    applied.push(edit.label);
  }
  return { source: next, changed: true, applied };
}

/** 只读检查：resources 是否存在、目标条目是否可读、三处锚点状态。 */
export function inspect({ resourcesPath, override } = {}) {
  const located = locateResources({ resourcesPath, override });
  if (located.path === null) {
    return { resources: null, via: located.via, exists: false, patched: false, anchors: [], error: "找不到宿主 resources 目录（可用 DSH_CLEAN_ROUTE_RESOURCES 指定）" };
  }
  const archive = join(located.path, "app.asar");
  const form = archiveForm(archive);
  let source;
  try {
    source = readText(archive, TARGET_ENTRY);
  } catch (error) {
    return { resources: located.path, via: located.via, form, archiveMounted: form === "mounted", exists: false, patched: false, anchors: [], error: error.message, command: applyCommand() };
  }
  return {
    resources: located.path,
    via: located.via,
    form,
    archiveMounted: form === "mounted",
    command: applyCommand(),
    exists: true,
    patched: source.includes(PATCH_MARK),
    anchors: EDITS.map((edit) => ({ label: edit.label, matches: countOccurrences(source, edit.from), patchedMatches: countOccurrences(source, edit.to) })),
    error: null,
  };
}

/** 写入补丁（宿主必须已关闭）。返回备份路径与已应用的改动。 */
export function applyPatch({ resourcesPath, override, backup = true } = {}) {
  const located = locateResources({ resourcesPath, override });
  if (located.path === null) throw new Error("找不到宿主 resources 目录");
  const archive = join(located.path, "app.asar");
  if (archiveForm(archive) === "mounted") {
    const error = new Error("宿主正在运行：app.asar 处于挂载状态，只能读不能写。请完全退出宿主后运行下面这条命令。");
    error.code = "ASAR_MOUNTED";
    error.command = applyCommand();
    throw error;
  }
  const original = readText(archive, TARGET_ENTRY);
  const { source, changed, applied } = patchSource(original);
  if (!changed) return { changed: false, applied: [], backup: null, archive, entry: TARGET_ENTRY };
  const result = replaceEntryText(archive, TARGET_ENTRY, source, { backup });
  return { changed: true, applied, backup: result.backup, archive, entry: TARGET_ENTRY, delta: result.delta };
}

/** 从备份恢复：备份是整份 app.asar（归档形态）或单个文件（目录形态）。 */
export function restorePatch(backupPath, { resourcesPath, override } = {}) {
  const located = locateResources({ resourcesPath, override });
  if (located.path === null) throw new Error("找不到宿主 resources 目录");
  const archive = join(located.path, "app.asar");
  const info = statSync(backupPath);
  if (!info.isFile()) throw new Error("备份不是文件：" + backupPath);
  copyFileSync(backupPath, archive);
  return { restored: true, archive, backup: backupPath, bytes: info.size };
}
