import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "services/**/test/**/*.test.ts"],
    // integration suites self-skip when DATABASE_URL is unset (see describe.skipIf)
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
