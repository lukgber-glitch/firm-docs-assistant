// RE: L1 -> @langchain/textsplitters RecursiveCharacterTextSplitter (public docs)
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "./config";
import { ensureSchema, getPool } from "./db";
import { LocalE5Embeddings } from "./embeddings";
import { PgVectorStore } from "./store";

const CORPUS_DIR = process.env.CORPUS_DIR ?? path.join(process.cwd(), "corpus");

/** Crude language tag for the UI badge: German umlauts and function words versus English ones. */
export function detectLang(text: string): "de" | "en" {
  const de = (text.match(/\b(und|der|die|das|nicht|wir|Sie|ist|mit|für)\b|[äöüß]/g) ?? []).length;
  const en = (text.match(/\b(and|the|of|we|you|is|with|for|not)\b/g) ?? []).length;
  return de > en ? "de" : "en";
}

/**
 * Idempotent: a hash over file contents + chunking parameters is stored in corpus_meta.
 * Same hash -> nothing to do. Different hash -> replace all chunks in one transaction
 * (the corpus is ~100 chunks, so a full rebuild is simpler and safer than diffing).
 */
export async function ingest(opts: { log?: (m: string) => void } = {}): Promise<{ skipped: boolean; chunks: number }> {
  const log = opts.log ?? console.log;
  await ensureSchema();
  const pool = getPool();

  const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith(".md")).sort();
  const raw = await Promise.all(
    files.map(async (f) => ({ id: f.replace(/\.md$/, ""), text: await readFile(path.join(CORPUS_DIR, f), "utf8") })),
  );
  const hash = createHash("sha256").update(JSON.stringify({ CHUNK_SIZE, CHUNK_OVERLAP, raw })).digest("hex");

  const prev = await pool.query("SELECT v FROM corpus_meta WHERE k = 'hash'");
  const count = Number((await pool.query("SELECT count(*) FROM chunks")).rows[0].count);
  if (prev.rows[0]?.v === hash && count > 0) {
    log(`ingest: corpus unchanged (${files.length} docs, ${count} chunks) - skipped`);
    return { skipped: true, chunks: count };
  }

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP });
  const docs: Document[] = [];
  for (const { id, text } of raw) {
    const docTitle = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? id;
    const lang = detectLang(text);
    const parts = await splitter.splitText(text);
    parts.forEach((content, chunkIndex) =>
      docs.push(new Document({ pageContent: content, metadata: { docId: id, docTitle, lang, chunkIndex } })),
    );
  }

  // The document title is part of the embedded text so a chunk such as "Rush work" keeps its context;
  // the stored (and displayed) content is the plain chunk.
  const embeddings = new LocalE5Embeddings();
  const vectors = await embeddings.embedDocuments(docs.map((d) => `${d.metadata.docTitle}\n${d.pageContent}`));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM chunks");
    await new PgVectorStore(embeddings, client).addVectors(vectors, docs);
    await client.query(
      "INSERT INTO corpus_meta (k, v) VALUES ('hash', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
      [hash],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  log(`ingest: ${files.length} docs -> ${docs.length} chunks`);
  return { skipped: false, chunks: docs.length };
}
