import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "lib/generated/**",
    "coverage/**",
    "playwright-report/**",
    // ArkTS is compiled and linted by DevEco/Hvigor. ESLint otherwise scans
    // generated preview/build output and third-party oh_modules as TypeScript.
    "harmonyos/**",
  ]),
]);
