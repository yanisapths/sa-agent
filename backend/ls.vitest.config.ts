import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["agents/evaluators/**/*.eval.?(c|m)[jt]s"],
    reporters: ["langsmith/vitest/reporter"],
    setupFiles: ["dotenv/config"],
    environment: "node",
    testTimeout: 30_000,
    env: {
      LANGSMITH_TEST_TRACKING:
        process.env.LANGSMITH_TEST_TRACKING ??
        (process.env.LANGSMITH_API_KEY ? "true" : "false"),
    },
  },
});
