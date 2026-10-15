export function requestConcurrency(value = 4): number {
  return Number.isFinite(value) ? Math.min(8, Math.max(1, Math.floor(value))) : 4;
}

// Preserve input order and drain active work before returning a failure. A failed
// refresh must not leave requests mutating its results after failure is recorded.
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(requestConcurrency(concurrency), items.length) }, async () => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }));
  if (failed) {
    throw failure;
  }
  return results;
}
