// RE: n/a (NEITHER - original spend ledger; prices from the task brief, Sonnet 5.5 list prices)
import { access } from "node:fs/promises";
import { DAILY_CAP_EUR, HALT_FILE, MONTHLY_CAP_EUR, PRICE_USD_PER_MTOK, USD_TO_EUR } from "./config";
import { getPool } from "./db";

export type Usage = {
  /** Total input tokens as reported by the AI SDK (includes cache reads and writes). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Estimated cost of one model call in EUR. */
export function costEur(u: Usage): number {
  const plain = Math.max(0, u.inputTokens - u.cacheReadTokens - u.cacheWriteTokens);
  const p = PRICE_USD_PER_MTOK;
  const usd =
    (plain * p.input + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite + u.outputTokens * p.output) /
    1_000_000;
  return usd * USD_TO_EUR;
}

/** Normalises the AI SDK usage object (field names vary slightly between provider versions). */
export function toUsage(u: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined } | undefined;
}): Usage {
  return {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
}

/** Sliding-window per-key limiter. In memory on purpose: nothing about visitors is persisted. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns true if it is allowed. */
  hit(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < this.windowMs)) this.hits.delete(k);
    return true;
  }
}

export async function isHalted(): Promise<boolean> {
  try {
    await access(HALT_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function recordSpend(kind: "answer" | "draft", eur: number): Promise<void> {
  await getPool().query("INSERT INTO spend_ledger (kind, eur) VALUES ($1, $2)", [kind, eur.toFixed(6)]);
}

export async function spendSoFar(): Promise<{ dayEur: number; monthEur: number }> {
  const { rows } = await getPool().query(
    `SELECT
       COALESCE(SUM(eur) FILTER (WHERE (at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date), 0) AS day,
       COALESCE(SUM(eur) FILTER (WHERE date_trunc('month', at AT TIME ZONE 'UTC') = date_trunc('month', now() AT TIME ZONE 'UTC')), 0) AS month
     FROM spend_ledger`,
  );
  return { dayEur: Number(rows[0].day), monthEur: Number(rows[0].month) };
}

export type Gate = { ok: true } | { ok: false; reason: "halted" | "budget" };

/** Checked before every model call. Spend is recorded after the call from real token usage. */
export async function checkBudget(): Promise<Gate> {
  if (await isHalted()) return { ok: false, reason: "halted" };
  const { dayEur, monthEur } = await spendSoFar();
  if (dayEur >= DAILY_CAP_EUR || monthEur >= MONTHLY_CAP_EUR) return { ok: false, reason: "budget" };
  return { ok: true };
}
