import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "@next/next/no-img-element": "off" } }, // Original local assets; static export has no image optimisation server.
  {
    files: ["src/domain/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "react",
            "next/*",
            "@/features/*",
            "@/components/*",
            "@/services/*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/services/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["react", "next/*", "@/features/*", "@/components/*"] },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
  ]),
]);
