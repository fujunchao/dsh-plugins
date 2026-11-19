import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** 保存指纹、块 ID、条目元数据（类型、项目、主题、来源、依据）和属性修改前后的值；不保存记忆正文或连接凭据。 */
export function createMemoryReceipts(directory) {
  const file = key => {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('无效记忆指纹');
    return path.join(directory, key + '.json');
  };
  return {
    async delete(key) { await fs.rm(file(key), { force: true }); },
    async list() {
      let names;
      try { names = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const result = [];
      for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/u.test(name))) {
        try { result.push({ key: name.slice(0, -5), ...JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) }); }
        catch (error) { if (error.code !== 'ENOENT') result.push({ key: name.slice(0, -5), phase: 'corrupt', error: '凭据无法读取，请核对文件' }); }
      }
      return result;
    },
    async get(key) {
      try { return JSON.parse(await fs.readFile(file(key), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async set(key, receipt) {
      await fs.mkdir(directory, { recursive: true });
      const target = file(key), temporary = target + '.' + randomUUID() + '.tmp';
      try { await fs.writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 }); await fs.rename(temporary, target); }
      finally { await fs.rm(temporary, { force: true }); }
    },
  };
}
