// RE: n/a (NEITHER - original app configuration, no external surface)
/** Central configuration. Everything tunable lives here so the README can point at one file. */

export const MODEL_ID = "claude-sonnet-5-5";
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const EMBEDDING_DIMS = 384;

/** Retrieval */
export const TOP_K = 4;
export const CHUNK_SIZE = 550;
export const CHUNK_OVERLAP = 80;
/**
 * Cosine-similarity floor below which we refuse without calling the model.
 * Calibrated on probe questions (see README, "Refusal threshold"): off-topic questions scored 0.72-0.78 and in-corpus ones 0.81-0.91 -- e5 scores are compressed
 * into roughly 0.7-0.9, so a sensible floor is far higher than intuition suggests. Borderline cases (0.80-0.83) are left to the model, which is told to refuse.
 */
export const REFUSAL_THRESHOLD = 0.8;

/** Input / output limits */
export const MAX_QUESTION_CHARS = 500;
export const MAX_ANSWER_TOKENS = 700;
export const MAX_DRAFT_TOKENS = 500;

/** Spend protection (EUR) and rate limit */
export const DAILY_CAP_EUR = 2;
export const MONTHLY_CAP_EUR = 20;
export const RATE_LIMIT_PER_HOUR = 10;
export const HALT_FILE = process.env.HALT_FILE ?? "/data/halt";

/** Sonnet 5.5 list prices, USD per million tokens, and the conversion used for the ledger. */
export const PRICE_USD_PER_MTOK = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } as const;
export const USD_TO_EUR = 0.92;

export const REFUSAL_TEXT = "I can't find this in the documents.";
export const BUDGET_TEXT = "Daily demo budget reached — try again tomorrow.";

/**
 * Query expansion: one small-model call returns the question in German and in English so that retrieval does not
 * depend on the cross-language strength of a small embedding model. Priced at the Sonnet rates above on purpose:
 * Haiku is cheaper, so the ledger can only over-count, never under-count.
 */
export const EXPAND_MODEL_ID = "claude-haiku-5-5";
export const MAX_EXPAND_TOKENS = 150;
