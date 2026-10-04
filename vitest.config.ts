import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "service",
          include: ["src/**/*.test.ts"],
          environment: "node",
          retry: 0,
          allowOnly: false,
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./tests/component-setup.ts"],
          retry: 0,
          allowOnly: false,
        },
      },
    ],
    retry: 0,
    allowOnly: false,
    reporters: ["verbose", "json"],
    outputFile: { json: "test-results/unit.json" },
  },
});
