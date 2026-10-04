/**
 * Timing and async utilities.
 */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const debounce = (fn, delayMs = 250) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
};

export const waitForCondition = async (predicate, { timeoutMs = 3000, intervalMs = 50 } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
};
