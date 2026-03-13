import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs", "tests/**/*.test.js"],
    environment: "node",
    globals: false,
    testTimeout: 15000
  }
});
