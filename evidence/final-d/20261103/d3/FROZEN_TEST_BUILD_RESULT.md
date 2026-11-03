# FROZEN 候选测试与 unsigned 构建结果（D3）

日期：2026-11-03（UTC+8）　Owner：d3-device　触发：Lead FROZEN 信号（源码冻结，15:14 起）
执行方式：串行，同一时刻只占一个重构建槽（先 test 后 build）；无其他 hvigor 构建并发。

## 1. 冻结快照（候选绑定）

| 项 | 值 |
|---|---|
| 工作树 | `D:/Projects/hongmen-final-d-harmony-native` |
| HEAD | `4b696141435825a3582816e8e449c0e0cf013f29` |
| branch | `codex/final-d-harmony-native` |
| 快照时间 | 2026-11-03T15:14:38.151+08:00（`FROZEN_SNAPSHOT.json`） |
| dirty_count | 20（14 个 ` M` + 6 个 `??`；含 D1/D2 源码/测试与 evidence 目录） |
| source_tree_digest | `sha256(sorted "relpath|sha256" lines, LF)` = `39646e8f6eeb0bd633b02b69b299329c4d9248431544654e0e15a76cbc375e68`，覆盖 221 个文件（`harmonyos/entry/src` + `harmonyos/build-profile.json5`、`harmonyos/entry/build-profile.json5`、`harmonyos/AppScope`、`harmonyos/oh-package.json5`、`harmonyos/entry/oh-package.json5`、`harmonyos/oh-package-lock.json5`；排除 `build/`、`.test/`、`oh_modules/`） |
| 全文清单 | `FROZEN_SNAPSHOT.json`（每个 dirty 文件的 status/size/mtime/SHA-256） |

**构建期间源码一致性**：build 启动时重算 digest 与 test 快照完全相同（`39646e8f…`），verdict=`IDENTICAL`；dirty 增量只允许 evidence 文档，harmonyos 源码无变化。

## 2. `npm.cmd run harmony:test`

| 项 | 值 |
|---|---|
| 命令/cwd | `npm.cmd run harmony:test` / 工作树根 |
| start → end | 2026-11-03T15:14:38.151 → 15:15:40.401（62.2 s） |
| hvigor | `BUILD SUCCESSFUL in 53 s 982 ms` |
| 退出码 | **0** |
| 真实分母（`test_result.txt`，mtime 15:15:39.034，8,922 B） | **Tests run: 133, Failure: 0, Error: 0, Pass: 133, Ignore: 0** |
| result_status | **PASS**（exit 0 且汇总行 Failure/Error=0；log 中 hypium `Failure` 行 0；未出现 exit0+hypium 失败） |
| 交叉核对 | 与 Lead 本地读数 133 一致；候选 27 个映射用例（见 CASE_MATRIX.md）在该次运行中均 `result=Success`（逐条核对） |
| 证据 | `BASELINE_TEST.log`、`BASELINE_TEST.exit` |

> 说明：`scripts/harmony-test.ts` 运行前会删除旧 `test_result.txt`（设计如此），分母只取本次文件，不沿用旧 109。

## 3. `npm.cmd run harmony:build`

| 项 | 值 |
|---|---|
| 命令/cwd | `npm.cmd run harmony:build` / 工作树根 |
| start → end | 2026-11-03T15:15:56.388 → 15:20:42.745（286.4 s） |
| hvigor | `BUILD SUCCESSFUL in 4 min 32 s 737 ms`（CompileArkTS 3m39s805ms） |
| 退出码 | **0** |
| 产物目录实测 | `outputs/default/` 仅 1 个 HAP，无 signed 文件 |
| unsigned HAP | `harmonyos/entry/build/default/outputs/default/entry-default-unsigned.hap`；**8,273,912 bytes；mtime 2026-11-03T15:20:40.808+08:00；SHA-256 `9c935302a720a34c2cf845f9a0528806d502f23364f07788650d0e9020164629`** |
| 签名 | 构建日志：`WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project.` ⇒ **unsigned 非签名证据** |
| 证据 | `BASELINE_BUILD.log`、`BASELINE_BUILD.exit.json`、`BASELINE_UNSIGNED_HAP.json` |

**产物归属**：该 unsigned HAP 只绑定 FROZEN 快照（HEAD `4b69614` + 20 dirty + `source_tree_digest`），不是签名证据、不是安装/设备 PASS；旧 485d485 产物（8,047,574 B / `2d64b3da…`）已被同名覆盖，仅留历史记录。

**一处证据自纠**：`run-frozen-build.ps1` 首版用 `-match 'signed'` 分类 signed 文件名，会误命中 "unsigned" 子串，导致 `signed_present` 初值 true。已改为 `(?<!un)signed` 并按磁盘实测修正为 `false`；**未重跑构建**，HAP 文件/hash/mtime 与本次构建一致，更正记录见 `BASELINE_UNSIGNED_HAP.json` 的 `signed_detection`。

## 4. 结论与未完成

- 候选在冻结快照上：原生测试 **133/133 PASS（exit 0）**；unsigned HAP 构建 **exit 0**。
- **signed 安装/系统交互/系统投递/卡片系统刷新：NOT_RUN**（无受权签名，候选仅 unsigned）。
- **设备轨：BLOCKED/NOT_RUN**（无稳定设备；模拟器两次短暂 Connected 后退出；无真机）——详见 DEVICE_STATUS.md。
- HTTP 读回腿、Web UI E2E 未在本轮执行（Lead 指示 FROZEN 构建后视资源再议；UI 不并入本轮 PASS）。
- 证据目录文件清单与校验：`README.md`、`MANIFEST.sha256`。
