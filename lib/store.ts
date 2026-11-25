// RE: L1 -> @langchain/core VectorStore abstract class + pgvector cosine operator (<=>), public docs
import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { VectorStore } from "@langchain/core/vectorstores";
import type pg from "pg";

/** pgvector literal, e.g. "[0.1,0.2]". */
const toVector = (v: number[]) => `[${v.join(",")}]`;

/** Anything with pg's `query` (a Pool or a checked-out client inside a transaction). */
type Queryable = Pick<pg.Pool, "query">;

/**
 * Minimal LangChain `VectorStore` over our own `chunks` table.
 * A thin custom store keeps the schema, the exact-cosine query and the score semantics
 * (similarity, not distance) explicit in ~40 lines. `<=>` is pgvector's cosine distance,
 * so similarity = 1 - distance. No index: exact scan over ~100 rows.
 */
export class PgVectorStore extends VectorStore {
  declare FilterType: Record<string, never>;

  constructor(
    embeddings: EmbeddingsInterface,
    private readonly db: Queryable,
  ) {
    super(embeddings, {});
  }

  _vectorstoreType(): string {
    return "pgvector-chunks";
  }

  async addVectors(vectors: number[][], documents: Document[]): Promise<void> {
    for (let i = 0; i < documents.length; i++) {
      const d = documents[i]!;
      const m = d.metadata as { docId: string; docTitle: string; lang: string; chunkIndex: number };
      await this.db.query(
        `INSERT INTO chunks (doc_id, doc_title, lang, chunk_index, content, embedding)
         VALUES ($1,$2,$3,$4,$5,$6::vector)`,
        [m.docId, m.docTitle, m.lang, m.chunkIndex, d.pageContent, toVector(vectors[i]!)],
      );
    }
  }

  async addDocuments(documents: Document[]): Promise<void> {
    const vectors = await this.embeddings.embedDocuments(documents.map((d) => d.pageContent));
    await this.addVectors(vectors, documents);
  }

  async similaritySearchVectorWithScore(query: number[], k: number): Promise<[Document, number][]> {
    const { rows } = await this.db.query(
      `SELECT doc_id, doc_title, lang, chunk_index, content,
              1 - (embedding <=> $1::vector) AS score
         FROM chunks
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [toVector(query), k],
    );
    return rows.map((r) => [
      new Document({
        pageContent: r.content as string,
        metadata: { docId: r.doc_id, docTitle: r.doc_title, lang: r.lang, chunkIndex: r.chunk_index },
      }),
      Number(r.score),
    ]);
  }
}
