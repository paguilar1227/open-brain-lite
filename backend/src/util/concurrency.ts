/**
 * Run an async fn over `items` with at most `limit` calls in flight at a time.
 * Returns results in the same order as the input. If any call rejects, the
 * returned promise rejects (matching Promise.all semantics) — wrap inside `fn`
 * if you want to swallow per-item errors.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const effective = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: effective }, () => worker()));
  return results;
}
