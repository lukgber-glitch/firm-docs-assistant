# Ask the firm's documents

A small retrieval-augmented generation (RAG) app: ask a question in German or English about the internal documents of an **invented** tax-advisory firm and get a streamed answer with numbered citations, plus one agent step that drafts a client email grounded in a cited passage.

**Live demo:** https://docs-demo.lgweb.work  
**Corpus:** 13 synthetic markdown documents (about half German, half English) in [`corpus/`](corpus). The firm, people and numbers are fictional.

![Screenshot of an answer with citations](docs/screenshot.png)

## Stack

TypeScript (strict), Next.js App Router, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`), LangChain JS (text splitter, `Embeddings`, `VectorStore`), PostgreSQL 16 with pgvector, Claude Sonnet 5.5 for answers and the agent step, local `multilingual-e5-small` embeddings, Docker Compose behind Caddy.

## Architecture

```mermaid
flowchart LR
  subgraph Ingest["Ingest (idempotent, at deploy)"]
    MD["corpus/*.md"] --> SPL["LangChain<br/>RecursiveCharacterTextSplitter"]
    SPL --> EMB1["LocalE5Embeddings<br/>'passage: ' prefix"]
    EMB1 --> PG[("Postgres 16<br/>pgvector chunks")]
  end
  subgraph Ask["Request path"]
    UI["Next.js page"] -->|question| API["/api/ask"]
    API --> GUARD["rate limit, halt file,<br/>daily/monthly budget"]
    GUARD --> EXP["Query expansion<br/>claude-haiku-5-5: question in DE + EN"]
    EXP -->|"original + DE + EN"| EMB2["LocalE5Embeddings<br/>'query: ' prefix"]
    EMB2 --> RET["PgVectorStore<br/>exact cosine per query,<br/>best score per chunk, top-4"]
    PG --> RET
    RET -->|"top score < 0.80"| REF["fixed refusal<br/>(no model call)"]
    RET -->|passages| LLM["AI SDK streamText<br/>Claude Sonnet 5.5"]
    LLM -->|"tool call"| TOOL["draftClientEmail<br/>(second, grounded call)"]
    LLM -->|"NDJSON stream"| UI
    TOOL --> UI
    EXP --> LEDGER
    LLM --> LEDGER[("spend_ledger<br/>EUR only")]
    TOOL --> LEDGER
  end
```

### Request flow

1. The browser posts the question (max 500 characters) to `/api/ask`.
2. The guard checks, in order: per-IP rate limit (10 questions per hour, in memory), the halt file (`/data/halt`), and the EUR budget caps read from the ledger.
3. **Query expansion:** one small-model call (`claude-haiku-5-5`, structured output, at most 150 tokens) returns the question in German and in English. The original plus both versions are embedded locally (`query: ` prefix) and searched with an exact cosine search in Postgres; each chunk keeps its best score over the queries and the top four are kept. If the expansion call fails or times out (8 s), retrieval silently falls back to the original question only. The side panel shows "Searched as: ..." so the expansion is visible.
4. If the best similarity is below the threshold, the server answers with a fixed refusal and **does not call the model**.
5. Otherwise the passages are numbered `[1]..[4]` and sent to the model with a system prompt that demands citations, the question's language, and an exact refusal sentence when the passages do not contain the answer.
6. The answer is streamed to the browser as newline-delimited JSON events (`sources`, `text`, `draft`, `done` or `refusal`). Citations in the text become clickable badges that highlight the passage in the side panel, which shows document title, snippet and similarity score.
7. After the stream, the token usage reported by the AI SDK is converted to EUR and written to the ledger.

## Design decisions

**Why local e5 embeddings.** `Xenova/multilingual-e5-small` (384 dimensions) runs in-process through `@huggingface/transformers` (ONNX, quantised), wrapped as a LangChain `Embeddings` subclass ([`lib/embeddings.ts`](lib/embeddings.ts)). The corpus is German and English, so a multilingual model matters; running it locally means no second vendor, no per-query embedding cost, and the question text only leaves the box for the answer call. The model files are baked into the Docker image at build time, so the read-only production container needs no network access for retrieval. e5 expects role prefixes (`query: `, `passage: `), which the wrapper adds. A small model is weaker across languages than within one, which is handled by query expansion (next section) rather than by a bigger model.

**Why query expansion instead of a bigger embedding model.** Measured on this corpus, with the original question only, German questions whose answer lives only in an English document (and the reverse) usually ranked the wrong document first, or scored below the refusal floor, so a visitor got "I can't find this in the documents." although the answer existed. A larger multilingual embedding model would shrink that gap but not remove it, costs more memory and image size on a 7 GB shared box, and is a change to a binding part of the stack. Expanding the query makes the comparison same-language on both sides: the German question is also searched in English and vice versa, so every document has a same-language query to match against. The price is one extra small-model call per question (about EUR 0.0003 at the conservative Sonnet rate the ledger uses, see below) and about a second of latency. The tests in `test/retrieval.test.ts` contain 12 cross-language questions (6 per direction), each of which must return the right document first and score above the refusal floor.

**Why exact search, no index.** The corpus is a few dozen chunks. A sequential scan with `ORDER BY embedding <=> $1` is exact, fast at this size and has no recall trade-off to explain. An approximate index (HNSW) only pays off at much larger sizes. The vector store is a thin LangChain `VectorStore` subclass ([`lib/store.ts`](lib/store.ts)) instead of a packaged one, so the schema, the SQL and the score semantics (similarity = 1 - cosine distance) are visible in about 40 lines.

**Refusal threshold (two stages).** e5 similarities are compressed: on the probe questions I tried, most off-topic questions (capital of Peru, apple cake, highest mountain) scored roughly 0.72 to 0.79, and in-corpus questions roughly 0.83 to 0.92. The floor is therefore 0.80 ([`lib/config.ts`](lib/config.ts)), set from those probes and pinned by [`test/retrieval.test.ts`](test/retrieval.test.ts). It is a coarse filter, not a classifier: some off-topic questions land above it, for example "Explain quantum computing" (about 0.82, with or without expansion) and "Wie funktioniert ein Verbrennungsmotor?" (0.776 before expansion, about 0.83 after: the English expansion "How does ... work" resembles the English remote-work memo). Expansion can raise an off-topic score because there are more queries to match with, and no single threshold separates these. So stage one (retrieval floor, no model call, no cost) is backed by stage two: the system prompt tells the model to answer with the exact refusal sentence when the passages do not contain the answer, and the UI treats that sentence as a refusal. Both of those questions are covered by a test that requires the model to answer with exactly the refusal sentence. That is a handful of cases, not an evaluation.

**The agent step.** The model has one tool, `draftClientEmail(passage, purpose)` ([`lib/llm.ts`](lib/llm.ts)). If the user asks for an email ("Draft an email to a client explaining how to complain"), the model decides to call it; the tool runs a second, tightly constrained generation that may only use the chosen passage and returns subject and body. The UI renders the result in editable fields. Every cited passage also has a "Draft client email from this passage" button that calls the same function through `/api/draft`. The server reads the passage from the database itself, so a caller cannot make it write about arbitrary text. **Nothing is ever sent.** There is no email transport in the code.

**Cost caps.** Every model call, including the expansion call, is priced from the token usage the AI SDK reports (Sonnet 5.5 list prices: $2 per million input tokens, $10 output, $0.10 cache read; USD to EUR 0.92) and written to a `spend_ledger` table as an amount only. The expansion call is priced at the Sonnet rates too (Haiku is cheaper, so the ledger can only over-count). Before each call the server sums the ledger: EUR 2 per day (UTC) and EUR 20 per month. When a cap is hit the UI shows "Daily demo budget reached — try again tomorrow." Further limits: 10 questions per hour per IP, `maxOutputTokens` of 700 for answers and 500 for drafts, 500 characters per question, and a halt file: if `/data/halt` exists, all model calls are refused. No question text is stored anywhere; the only persisted per-request data is the amount. Caddy writes no access log. Caveat: the check happens before the call and the spend is recorded after it, so concurrent requests can overshoot a cap by a few calls' worth of cents.

**Prompt caching.** The system prompt carries an Anthropic `cacheControl` breakpoint. Anthropic only caches prefixes above a minimum length, so with a prompt this short it may not trigger; the ledger reads cache-read and cache-write tokens separately so it stays correct if it does.

**Provider is swappable via the AI SDK.** The model is created in one place (`const model = () => anthropic(MODEL_ID)` in [`lib/llm.ts`](lib/llm.ts)); pointing it at OpenAI is a one-line change to that function plus a different provider package. That swap is not built or tested here.

## What I'd add in production

- Authentication and per-user audit trails.
- Multi-tenant isolation: per-tenant corpora with row-level security or separate schemas, tenant-scoped retrieval filters.
- A reranker (cross-encoder) between retrieval and generation, and hybrid lexical plus vector search.
- An evaluation harness with a labelled question set, tracked per change (retrieval hit rate and answer faithfulness), instead of hand-picked probes.
- An HNSW index once the corpus is large enough for exact search to hurt.
- A real ingestion pipeline: upload, parsing of PDF and Office formats, OCR, incremental updates with per-document versions, deletion and retention handling.
- Observability: structured logs, traces across retrieval and generation, token and latency dashboards, alerting on the budget caps.
- Stronger prompt-injection defences for untrusted documents, and a shared rate limiter (Redis) when running more than one instance.

## Run it locally

```bash
pnpm install
docker compose -f compose.dev.yml up -d --wait db          # pgvector on 127.0.0.1:54329
pnpm fetch-model                                           # one-off download of the e5 model into ./models
export DATABASE_URL=postgres://docs:docs@127.0.0.1:54329/docs ANTHROPIC_API_KEY=...
pnpm ingest                                                # idempotent
pnpm dev
```

Gate (typecheck, lint, tests, build): `pnpm gate`. The tests run the real splitter, local embeddings and pgvector; there are no mocks for retrieval.

## Deployment

[`scripts/deploy.sh`](scripts/deploy.sh) refuses a dirty tree or a red gate, ships `git archive HEAD` to the server, builds and starts the hardened Compose stack ([`deploy/compose.yml`](deploy/compose.yml): read-only root filesystems, all capabilities dropped, memory limits, healthchecks, log rotation, no host port for Postgres), runs the idempotent ingest, installs the Caddy site with validate and rollback, and waits until `/healthz` reports the deployed commit. Secrets live only in a server-side `.env`. There are no CI workflows; the local gate is the gate. `scripts/live-check.mjs` smoke-tests the public URL.

## Repository layout

```
app/            Next.js pages and route handlers (/api/ask, /api/draft, /api/healthz)
components/     Client UI (streaming, citation badges, editable draft)
lib/            config, db, embeddings, vector store, retrieval, ingest, llm (AI SDK), budget, guard
corpus/         synthetic documents
test/           retrieval tests (real pipeline) and cost / rate-limit tests
scripts/        ingest, model fetch, deploy, live check
deploy/         production Compose file and Caddy site
```

Demo by Lukas Gruber. Synthetic data; no questions are stored.
