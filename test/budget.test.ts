import { describe, expect, it } from "vitest";
import { costEur, RateLimiter } from "../lib/budget";

describe("cost estimate (Sonnet 5.5: $2/MTok in, $10/MTok out, cache read $0.10/MTok, usd->eur 0.92)", () => {
  it("prices uncached input and output", () => {
    // 1M in * $2 + 1M out * $10 = $12 -> EUR 11.04
    expect(costEur({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(11.04, 4);
  });
  it("prices cache reads at $0.10/MTok and treats inputTokens as the total", () => {
    // 1M input of which 900k are cache reads: 100k*$2 + 900k*$0.10 = $0.29 -> EUR 0.2668
    expect(costEur({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 900_000, cacheWriteTokens: 0 })).toBeCloseTo(0.2668, 4);
  });
  it("never under-counts cache writes (billed at 1.25x input)", () => {
    // 100k all cache writes: 100k*$2.5/M = $0.25 -> EUR 0.23
    expect(costEur({ inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 100_000 })).toBeCloseTo(0.23, 4);
  });
});

describe("per-IP rate limit", () => {
  it("allows N per window, then blocks, then recovers", () => {
    let now = 0;
    const rl = new RateLimiter(3, 3_600_000, () => now);
    expect([rl.hit("a"), rl.hit("a"), rl.hit("a"), rl.hit("a")]).toEqual([true, true, true, false]);
    expect(rl.hit("b")).toBe(true);
    now = 3_600_001;
    expect(rl.hit("a")).toBe(true);
  });
});
