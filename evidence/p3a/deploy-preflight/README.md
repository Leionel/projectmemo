# P3-A 提交的部署预检（2026-10-24，本地）

目的：在用户执行 ECS 更新前，用与 safe-update.sh 完全相同的参数验证新提交 `57698a4` 的三个构建阶段。本地 Windows 开发机，Node 24。

## 结果

1. `next typegen` 通过（typegen.log）。
2. `tsc --noEmit` 在 1024 MiB 堆上限下 **OOM（exit 134，Ineffective mark-compacts，tsc-heap1024.log）**；1280 MiB 与 1536 MiB 通过（tsc-heap1280.log / tsc-heap1536.log）。P3-A 新增约 1700 行 TS 后独立类型检查的实测堆需求从 ≤1024 升至 ~1280 MiB。
3. `next build --webpack`（跳过构建内类型检查、CIRCLE_NODE_TOTAL=1）在 1280 MiB 堆下通过，BUILD_ID 生成（build-heap1280.log）。

## 由此产生的修正（同日提交）

`safe-update.sh` 的停服后堆下限 1024→1280 MiB（swap≥3 GiB 才允许兜底），否则按 ECS 停服后可用内存 ~1.5 GiB 推算 tsc 必然 OOM。deployUpdate.test.ts 取值表同步更新，14/14 通过。修正后的脚本随本目录对应提交发布，更新命令必须指向该提交。

探针改写的 next-env.d.ts / tsconfig.json 已 git restore，tsconfig.tsbuildinfo 与 .next-p3a-probe/ 已删除。
