import { test, expect } from "vitest";
import { Semaphore } from "../dist/util/semaphore.js";

test("queued semaphore callers resume without exceeding the limit", async () => {
  const semaphore = new Semaphore(4);
  let active = 0;
  let peak = 0;
  const results = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const unlock = await semaphore.lock();
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      unlock();
      return index;
    })
  );
  expect(peak).toBe(4);
  expect(results).toHaveLength(12);
});
