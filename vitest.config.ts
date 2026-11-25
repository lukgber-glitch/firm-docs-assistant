import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests run against the real pipeline; they need the local pgvector container (compose.dev.yml, port 54329).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://docs:docs@127.0.0.1:54329/docs";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
