// RE: n/a (NEITHER - thin composition of our own embeddings + store modules)
import { REFUSAL_THRESHOLD, TOP_K } from "./config";
import { getPool } from "./db";
import { LocalE5Embeddings } from "./embeddings";
import { expandQuery } from "./expand";
import { PgVectorStore } from "./store";

export { REFUSAL_THRESHOLD };

export type Passage = {
  docId: string;
  docTitle: string;
  lang: string;
  chunkIndex: number;
  content: string;
  /** cosine similarity in [-1, 1]; e5 scores cluster in roughly 0.7-0.9 */
  score: number;
};

const embeddings = new LocalE5Embeddings();

/** Top-k passages for ONE query string by exact cosine similarity, best first. */
async function searchOne(query: string, k: number): Promise<Passage[]> {
  const store = new PgVectorStore(embeddings, getPool());
  const results = await store.similaritySearchVectorWithScore(await embeddings.embedQuery(query), k);
  return results.map(([doc, score]) => ({
    ...(doc.metadata as Omit<Passage, "content" | "score">),
    content: doc.pageContent,
    score,
  }));
}

/**
 * Retrieval with query expansion: the question is searched as written and in German and English; every chunk keeps
 * its best score over those queries. `queries` is returned so the UI can show what was actually searched.
 * If expansion fails, `queries` is just the original question.
 */
export async function retrieveWithQueries(question: string, k = TOP_K): Promise<{ passages: Passage[]; queries: string[] }> {
  const queries = await expandQuery(question);
  const best = new Map<string, Passage>();
  for (const hits of await Promise.all(queries.map((q) => searchOne(q, k)))) {
    for (const p of hits) {
      const key = `${p.docId}#${p.chunkIndex}`;
      if (!best.has(key) || best.get(key)!.score < p.score) best.set(key, p);
    }
  }
  const passages = [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  return { passages, queries };
}

export async function retrieve(question: string, k = TOP_K): Promise<Passage[]> {
  return (await retrieveWithQueries(question, k)).passages;
}

/** Direct lookup of one chunk (used by the draft endpoint; no search, no model call). */
export async function getPassage(docId: string, chunkIndex: number): Promise<Passage | null> {
  const { rows } = await getPool().query(
    "SELECT doc_id, doc_title, lang, chunk_index, content FROM chunks WHERE doc_id = $1 AND chunk_index = $2",
    [docId, chunkIndex],
  );
  const r = rows[0];
  return r ? { docId: r.doc_id, docTitle: r.doc_title, lang: r.lang, chunkIndex: r.chunk_index, content: r.content, score: 1 } : null;
}
