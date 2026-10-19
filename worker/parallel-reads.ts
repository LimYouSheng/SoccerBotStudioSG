// Account callers retain physical admission limits. Stop scheduling on failure,
// drain started siblings, and report the first failed input deterministically.
export async function parallelReads<T>(
  operations: (() => Promise<T>)[],
  onFailure?: (index: number) => void,
): Promise<T[]> {
  const results: PromiseSettledResult<T>[] = [];
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < operations.length) {
      const index = next++;
      try {
        results[index] = {
          status: "fulfilled",
          value: await operations[index](),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
        failed = true;
      }
    }
  };
  await Promise.all([lane(), lane()]);
  for (const [index, result] of results.entries()) {
    if (result?.status === "rejected") {
      onFailure?.(index);
      throw result.reason;
    }
  }
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}
