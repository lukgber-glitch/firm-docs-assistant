import { execSync } from "node:child_process";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests run against the real pipeline; they need the local pgvector container (compose.dev.yml, port 54329).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://docs:docs@127.0.0.1:54329/docs";

// Query expansion calls a real (small) model. Locally the key comes from `keyget`; never printed, never written to disk.
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    process.env.ANTHROPIC_API_KEY = execSync("keyget ANTHROPIC_API_KEY", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // tests that need expansion will then fail loudly instead of silently falling back
  }
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
