// RE: n/a (NEITHER - thin route over lib/llm.draftClientEmail; the per-passage button variant of the agent step)
import { MAX_QUESTION_CHARS } from "@/lib/config";
import { guard, jsonError } from "@/lib/guard";
import { draftClientEmail } from "@/lib/llm";
import { getPassage } from "@/lib/retrieval";
import { ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The client sends the question and the passage it clicked (doc id + chunk index). We read the passage from the
 * database ourselves (no search, no extra model call) so a caller cannot make the model write about arbitrary text. NEVER sends anything.
 */
export async function POST(req: Request): Promise<Response> {
  let body: { question?: unknown; docId?: unknown; chunkIndex?: unknown; n?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }
  const question = String(body.question ?? "").trim();
  const n = Number(body.n);
  if (!question || question.length > MAX_QUESTION_CHARS || !Number.isInteger(n) || n < 1 || n > 20) {
    return Response.json({ error: "bad_request", message: "Invalid request." }, { status: 400 });
  }
  const blocked = await guard(req);
  if (blocked) return jsonError(blocked);

  await ensureSchema();
  const passage = await getPassage(String(body.docId ?? ""), Number(body.chunkIndex));
  if (!passage) return Response.json({ error: "bad_request", message: "Passage not found." }, { status: 404 });
  try {
    const { draft } = await draftClientEmail(passage, `Tell the client what they asked about: "${question}"`, n);
    return Response.json({ draft });
  } catch (e) {
    console.error("draft failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "model_error", message: "The model call failed. Please try again." }, { status: 502 });
  }
}
