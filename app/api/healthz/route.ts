// RE: n/a (NEITHER - health endpoint pattern, JSON with the build sha like lgweb-pipelines /healthz)
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let chunks: number | null = null;
  try {
    chunks = Number((await getPool().query("SELECT count(*) FROM chunks")).rows[0].count);
  } catch {
    chunks = null;
  }
  const ok = chunks !== null && chunks > 0;
  return Response.json({ ok, sha: process.env.GIT_SHA ?? "dev", chunks }, { status: ok ? 200 : 503 });
}
