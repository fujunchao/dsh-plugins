#!/usr/bin/env node
/**
 * xhigh 补丁 CLI：status | apply | restore <备份>
 *
 * 归档形态（app.asar 是文件）必须先完全退出宿主再 apply —— 归档被占用时 rename 会失败，
 * 半途失败也不会改动原档（新档写在 *.clean-route-new，成功后 self-swap）。
 *
 * 例：
 *   node scripts/xhigh.mjs status
 *   node scripts/xhigh.mjs apply
 *   node scripts/xhigh.mjs restore "<宿主 resources 目录>/app.asar.bak-clean-route-…"
 */

import { applyPatch, inspect, restorePatch } from "../lib/xhigh.js";

const argv = process.argv.slice(2);
const resourcesIndex = argv.indexOf("--resources");
const resourcesPath = resourcesIndex >= 0 ? argv[resourcesIndex + 1] : undefined;
const rest = resourcesIndex >= 0 ? argv.filter((_value, index) => index !== resourcesIndex && index !== resourcesIndex + 1) : argv;
const [command, argument] = rest;

function print() {
  const status = inspect({ resourcesPath });
  console.log("resources：" + (status.resources ?? "（未找到）") + "（定位方式：" + status.via + "）");
  if (!status.exists) {
    console.log("状态：不可用 —— " + status.error);
    return status;
  }
  console.log("状态：" + (status.patched ? "已打补丁（xhigh 可用）" : "未打补丁（xhigh 会被 pi-ai 拒绝）"));
  for (const anchor of status.anchors) {
    console.log("  锚点 " + anchor.label + "：原文 " + anchor.matches + " 处，补丁后目标 " + anchor.patchedMatches + " 处");
  }
  return status;
}

switch (command) {
  case "status": {
    const status = print();
    process.exitCode = status.exists && status.patched ? 0 : 1;
    break;
  }
  case "apply": {
    const status = print();
    if (!status.exists) process.exit(1);
    if (status.patched) {
      console.log("已经打过补丁，无需重复。");
      break;
    }
    console.log("开始写入（请确认宿主已完全退出）…");
    const result = applyPatch({ resourcesPath });
    if (!result.changed) {
      console.log("没有需要写入的改动。");
      break;
    }
    console.log("已写入：" + result.applied.join(" / ") + "（" + result.delta + " 字节）");
    console.log("备份：" + result.backup);
    console.log("现在可以启动宿主；xhigh 档应可选中。");
    break;
  }
  case "restore": {
    if (argument === undefined) {
      console.error("用法：node scripts/xhigh.mjs restore <备份文件路径>");
      process.exit(2);
    }
    const result = restorePatch(argument, { resourcesPath });
    console.log("已从备份恢复：" + result.archive + "（" + result.bytes + " 字节）");
    break;
  }
  default:
    console.error("用法：node scripts/xhigh.mjs status | apply | restore <backup>");
    process.exit(2);
}
