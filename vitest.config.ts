import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["node_modules", "dist", "tests", "src/@types/**", "**/*.d.ts"],
    },
    env: {
      NODE_ENV: "test",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_KEY: "test-key",
    },
  },
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "./src/core"),
      "@auth": path.resolve(__dirname, "./src/auth"),
      "@users": path.resolve(__dirname, "./src/users"),
      "@cameras": path.resolve(__dirname, "./src/cameras"),
      "@vector": path.resolve(__dirname, "./src/vector"),
      "@events": path.resolve(__dirname, "./src/events"),
      "@dashboard": path.resolve(__dirname, "./src/dashboard"),
      "@notifications": path.resolve(__dirname, "./src/notifications"),
      "@specter": path.resolve(__dirname, "./src/specter"),
      "@alerts": path.resolve(__dirname, "./src/alerts"),
      "@watchlists": path.resolve(__dirname, "./src/watchlists"),
      "@live": path.resolve(__dirname, "./src/live"),
      "~types": path.resolve(__dirname, "./src/@types"),
    },
  },
});
