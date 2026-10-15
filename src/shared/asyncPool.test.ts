import { describe, expect, it } from "vitest";
import { mapConcurrent, requestConcurrency } from "./asyncPool";

describe("bounded async work", () => {
  it("preserves input order when requests finish out of order", async () => {
    const release: Array<() => void> = [];
    const started: number[] = [];
    const pending = mapConcurrent([0, 1, 2, 3], 2, async (item) => {
      started.push(item);
      await new Promise<void>((resolve) => { release[item] = resolve; });
      return item * 10;
    });
    expect(started).toEqual([0, 1]);
    release[1]();
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toEqual([0, 1, 2]);
    release[2]();
    await new Promise((resolve) => setImmediate(resolve));
    release[3]();
    release[0]();
    expect(await pending).toEqual([0, 10, 20, 30]);
  });

  it("stops scheduling on failure and waits for already active requests", async () => {
    let release!: () => void;
    const started: number[] = [];
    let drained = false;
    let settled = false;
    const pending = mapConcurrent([0, 1, 2], 2, async (item) => {
      started.push(item);
      if (item === 0) {
        throw new Error("failed page");
      }
      await new Promise<void>((resolve) => { release = resolve; });
      drained = true;
    });
    const observed = pending.catch((error: Error) => { settled = true; return error.message; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(started).toEqual([0, 1]);
    release();
    expect(await observed).toBe("failed page");
    expect(drained).toBe(true);
  });

  it("bounds concurrency and handles empty work", async () => {
    expect(requestConcurrency(0)).toBe(1);
    expect(requestConcurrency(100)).toBe(8);
    expect(requestConcurrency(Number.NaN)).toBe(4);
    expect(await mapConcurrent([], 4, async () => 0)).toEqual([]);
  });
});
