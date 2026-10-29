# 低内存 ECS 构建修复验证（2026-10-24）

数据来源：本地 Windows 开发机（win32，Node 24，next 16.2.11），对本次待发布工作树执行。无模型调用、无真实用户数据；构建使用本地 `.env` 指向的开发库，仅编译不产生业务写入。ECS 实机验证仍需按新命令重新发布。

## 现象核对（Next.js 16.2.11 源码）

- `next build` 的 "Running TypeScript" 阶段（`next/dist/build/type-check.js`）会启动一个 jest-worker 子进程运行完整类型检查，与持有 webpack 编译产物的主进程并行驻留内存；OOM 日志中被杀进程 anon-rss 1440580 kB 与此一致。
- `typescript.ignoreBuildErrors=true` 时打印 "Skipping validation of types"，不启动该子进程，仅保留进程内 tsconfig 校验。
- worker 数量由 `CIRCLE_NODE_TOTAL` / `experimental.cpus` 控制；`next typegen`（16.2.11 内置命令）用 AST 生成 `<distDir>/types` 路由类型并按 distDir 重写 `next-env.d.ts`，不运行编译。

## 探针结果（与 safe-update.sh 新流程同序同参）

1. `npm exec next -- typegen` 成功（typegen.log）。
2. `tsc --noEmit` 在 `NODE_OPTIONS=--max-old-space-size=1024` 下通过，无错误输出（tsc-heap1024.log）。1024 MiB 即够用，ECS 停服后自适应堆上限（约 1.2–1.4 GiB）留有余量。
3. `next build --webpack` 在 1024 MiB 堆、`CIRCLE_NODE_TOTAL=1`、`PROJECTMEMO_BUILD_SKIP_TYPECHECK=1` 下完成：日志含 "✓ Compiled successfully"、"Skipping validation of types"，无 "Running TypeScript"，BUILD_ID 生成（build-skip-types-heap1024.log）。

## 回归检查

- `tests/deployUpdate.test.ts` 14/14 通过（含 bash 语法、阶段顺序、跳过开关仅对构建生效、停服前预检与停服后自适应堆的取值表、回滚保护）。
- `npm run lint` 通过。
- 探针改写的 `next-env.d.ts`、`tsconfig.json` 已 `git restore`；`tsconfig.tsbuildinfo`、`.next-oom-probe/` 已删除。
