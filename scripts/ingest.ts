// RE: thin CLI wrapper around lib/ingest.ts (idempotent corpus ingest); run by deploy.sh after compose up.
import { closePool } from "../lib/db";
import { ingest } from "../lib/ingest";

try {
  await ingest();
} finally {
  await closePool();
}
