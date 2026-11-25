// Ingests the corpus into the test database once per run, so retrieval tests hit the real pipeline
// (splitter -> local e5 embeddings -> pgvector) rather than mocks.
import { ingest } from "../lib/ingest";
import { closePool } from "../lib/db";

export default async function setup() {
  await ingest({ log: () => {} });
  await closePool();
}
