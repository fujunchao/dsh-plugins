import { createMemoryStore } from '../../lib/memory.js';

// 旧存储/恢复用例模拟已经由用户确认的宿主写入，继续覆盖其事务与幂等路径。
// 模型入口及未确认写入由 memory-design 和真实 apply 接线用例使用原始 store 验证。
export function createConfirmedMemoryStore(options) {
  const store = createMemoryStore(options);
  return { ...store, write: (spec, authority = { confirmed: true }) => store.write(spec, authority) };
}
