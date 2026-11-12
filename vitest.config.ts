import "dotenv/config";
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Make sure `.tsx` test files (JSX) are always transformed with the automatic
  // React runtime, regardless of which Vite transformer the installed version uses.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
} as Parameters<typeof defineConfig>[0]);
