// RE: n/a (NEITHER - request guard glue: rate limit + budget + halt in front of every model call)
import { checkBudget, RateLimiter } from "./budget";
import { BUDGET_TEXT, RATE_LIMIT_PER_HOUR } from "./config";

const limiter = new RateLimiter(RATE_LIMIT_PER_HOUR, 3_600_000);

/** Caddy is the only client of this port and sets X-Forwarded-For; take the left-most entry. */
export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export type Blocked = { status: number; code: "rate_limit" | "budget" | "halted"; message: string };

/** Returns null when the request may proceed to a model call. */
export async function guard(req: Request): Promise<Blocked | null> {
  if (!limiter.hit(clientKey(req))) {
    return { status: 429, code: "rate_limit", message: `Rate limit reached (${RATE_LIMIT_PER_HOUR} questions per hour). Please try again later.` };
  }
  const gate = await checkBudget();
  if (gate.ok) return null;
  if (gate.reason === "halted") return { status: 503, code: "halted", message: "The demo is paused." };
  return { status: 429, code: "budget", message: BUDGET_TEXT };
}

export function jsonError(b: Blocked): Response {
  return Response.json({ error: b.code, message: b.message }, { status: b.status });
}
