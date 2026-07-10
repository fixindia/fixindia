/**
 * Tiny in-memory TTL cache for read-only, non-personalized endpoints (8.2).
 * No external dependency. Entries expire after `ttlMs` and are served from
 * memory on repeat hits so slow aggregate queries don't re-run on every
 * request. Keep TTLs short (e.g. 60s) — these datasets change slowly but we
 * never want stale data for long.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Get a cached value if fresh, else call `loader()` and cache its result.
 */
export async function withTtlCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now < hit.expiresAt) {
    return hit.value as T;
  }

  const value = await loader();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/** Clear one or all cache entries (useful for tests / manual invalidation). */
export function clearTtlCache(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}
