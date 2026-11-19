import { readFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// 用户可见的持久记录开关；环境变量关闭仍拥有优先权。
export function createMemoryRecording(file, environmentDisabled = () => false) {
  let disabled = false, error = null, tail = Promise.resolve();
  try { const value = JSON.parse(readFileSync(file, 'utf8')); if (typeof value.disabled !== 'boolean') throw new Error('记录设置格式不正确'); disabled = value.disabled; }
  catch (failure) { if (failure.code !== 'ENOENT') { disabled = true; error = '记录设置无法读取，暂时关闭；重新设置开关可恢复'; } }
  const state = () => ({ enabled: !disabled && !environmentDisabled(), locked: environmentDisabled(), error });
  return { state, set(enabled) {
    const operation = tail.then(async () => {
      if (environmentDisabled() && enabled) throw new Error('环境变量 DSH_SIYUAN_MEMORY_RECORDING=off 已关闭记录，请先调整该设置');
      const temporary = file + '.' + randomUUID() + '.tmp';
      await fs.mkdir(path.dirname(file), { recursive: true });
      try { await fs.writeFile(temporary, JSON.stringify({ disabled: !enabled }), { mode: 0o600 }); await fs.rename(temporary, file); }
      finally { await fs.rm(temporary, { force: true }); }
      disabled = !enabled; error = null; return state();
    });
    tail = operation.catch(() => {}); return operation;
  } };
}
