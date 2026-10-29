import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".workbuddy/**", // Local build output and agent scratch files, not application source.
    ".next-e2e/**",
    ".next-*/**", // Isolated previews and guarded release builds are generated output.
    "lib/generated/**",
    "coverage/**",
    "playwright-report/**",
    // ArkTS is compiled and linted by DevEco/Hvigor. ESLint otherwise scans
    // generated preview/build output and third-party oh_modules as TypeScript.
    "harmonyos/**",
    "tmp/**",
    "evidence/**", // Archived probes and receipts are validated separately from application source.
    "docs/**", // Research notes and archived probe scripts (e.g. working/*.cjs), not application source.
  ]),
]);
