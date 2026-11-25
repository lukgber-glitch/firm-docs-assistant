// RE: n/a (NEITHER - thin composition of our own embeddings + store modules)
import { REFUSAL_THRESHOLD, TOP_K } from "./config";
import { getPool } from "./db";
import { LocalE5Embeddings } from "./embeddings";
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

/** Top-k passages by exact cosine similarity, best first. */
export async function retrieve(question: string, k = TOP_K): Promise<Passage[]> {
  const store = new PgVectorStore(embeddings, getPool());
  const results = await store.similaritySearchVectorWithScore(await embeddings.embedQuery(question), k);
  return results.map(([doc, score]) => ({
    ...(doc.metadata as Omit<Passage, "content" | "score">),
    content: doc.pageContent,
    score,
  }));
}
