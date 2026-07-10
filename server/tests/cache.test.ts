import { test, expect, beforeEach } from 'bun:test';
import { withTtlCache, clearTtlCache } from '../src/lib/cache';

beforeEach(() => {
  clearTtlCache();
});

test('withTtlCache: calls the loader on first call and caches on second', async () => {
  let calls = 0;
  const loader = async () => { calls++; return { value: calls }; };
  const a = await withTtlCache('k', 60_000, loader);
  const b = await withTtlCache('k', 60_000, loader);
  expect(a.value).toBe(1);
  expect(b.value).toBe(1); // cached, loader not called again
  expect(calls).toBe(1);
});

test('withTtlCache: re-runs the loader after the TTL expires', async () => {
  let calls = 0;
  const loader = async () => { calls++; return calls; };
  const first = await withTtlCache('expiring', 60, loader);
  expect(first).toBe(1);
  await new Promise((r) => setTimeout(r, 90));
  const second = await withTtlCache('expiring', 60, loader);
  expect(second).toBe(2);
  expect(calls).toBe(2);
});

test('withTtlCache: different keys do not share cache entries', async () => {
  let calls = 0;
  const loader = async () => { calls++; return calls; };
  await withTtlCache('one', 60_000, loader);
  await withTtlCache('two', 60_000, loader);
  expect(calls).toBe(2);
});
