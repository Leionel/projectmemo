import type { NextConfig } from "next";

// 仅部署脚本 safe-update.sh 在独立 tsc 阶段通过后设置该变量；
// 见 deploy/alibaba-cloud-linux/safe-update.sh 的类型检查阶段。
const skipBuildTypeCheck = process.env.PROJECTMEMO_BUILD_SKIP_TYPECHECK === "1";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["better-sqlite3"],
  // 设置时跳过构建内并行 TypeScript 子进程，避免低内存机器在
  // "Running TypeScript" 阶段主进程与类型检查子进程同时驻留导致 OOM。
  ...(skipBuildTypeCheck ? { typescript: { ignoreBuildErrors: true } } : {}),
};

export default nextConfig;
