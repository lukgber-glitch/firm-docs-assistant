// RE: L1 -> Vercel AI SDK v7 streaming pattern (streamText + textStream), sent as NDJSON events
import { costEur, recordSpend, toUsage } from "@/lib/budget";
import { MAX_QUESTION_CHARS, REFUSAL_TEXT, REFUSAL_THRESHOLD } from "@/lib/config";
import { ensureSchema } from "@/lib/db";
import { guard, jsonError } from "@/lib/guard";
import { answerStream } from "@/lib/llm";
import { retrieve } from "@/lib/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Event protocol (one JSON object per line): sources -> text* -> draft* -> done | refusal. */
export async function POST(req: Request): Promise<Response> {
  let question = "";
  try {
    question = String(((await req.json()) as { question?: unknown }).question ?? "").trim();
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }
  if (!question || question.length > MAX_QUESTION_CHARS) {
    return Response.json({ error: "bad_request", message: `Question must be 1-${MAX_QUESTION_CHARS} characters.` }, { status: 400 });
  }

  const blocked = await guard(req);
  if (blocked) return jsonError(blocked);

  await ensureSchema();
  const passages = await retrieve(question);
  const enc = new TextEncoder();
  const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");
  const sources = passages.map((p, i) => ({
    n: i + 1,
    docId: p.docId,
    chunkIndex: p.chunkIndex,
    docTitle: p.docTitle,
    snippet: p.content,
    score: Number(p.score.toFixed(3)),
  }));
  const headers = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };

  // Stage 1 of refusal: retrieval confidence too low -> no model call, no cost.
  if ((passages[0]?.score ?? 0) < REFUSAL_THRESHOLD) {
    return new Response(line({ type: "refusal", text: REFUSAL_TEXT, stage: "retrieval" }), { headers });
  }

  const { result, drafts, errors } = answerStream(question, passages);
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (o: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(line(o));
        } catch {
          open = false; // client went away: keep draining so the spend is still recorded
        }
      };
      try {
        send({ type: "sources", sources });
        let text = "";
        for await (const delta of result.textStream) {
          text += delta;
          send({ type: "text", delta });
        }
        if (errors.length) throw errors[0];
        for (const d of drafts) send({ type: "draft", draft: d });
        // Stage 2 of refusal: the model itself declined (borderline retrieval scores).
        send({ type: "done", refused: text.trim() === REFUSAL_TEXT });
      } catch (e) {
        console.error("ask stream failed", e instanceof Error ? e.message : e);
        send({ type: "error", message: "The model call failed. Please try again." });
      } finally {
        try {
          const eur = costEur(toUsage(await result.usage));
          await recordSpend("answer", eur);
        } catch (e) {
          console.error("ledger write failed", e instanceof Error ? e.message : e);
        }
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, { headers });
}
