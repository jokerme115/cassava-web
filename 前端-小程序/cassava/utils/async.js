// utils/async.js — 并发任务池工具

/**
 * 并发执行任务池，限制最大并发窗口，单个任务失败不中断整体。
 * @param {Array} items 待处理数组
 * @param {number} limit 最大并发数
 * @param {Function} fn 处理函数 (item, index) => Promise
 * @returns {Promise<Array<{ok:boolean, value:any, error:any}>>}
 */
function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        results[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (e) {
        results[idx] = { ok: false, error: e };
      }
    }
  };

  const workers = [];
  const workerCount = Math.min(limit, items.length);
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker());
  }
  return Promise.all(workers).then(() => results);
}

module.exports = {
  mapConcurrent
};
