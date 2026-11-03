# 基线快照状态与 attempt1 说明（D3）

日期：2026-11-03（UTC+8）　Owner：d3-device　HEAD：`4b696141435825a3582816e8e449c0e0cf013f29`（分支 `codex/final-d-harmony-native`）

## 1. 事实

- 14:38:30 首次核对：`git status --porcelain` **空**（工作树干净），HEAD 为 4b69614。
- 14:45:21 再核对：工作树已被修改（` M` 3 个文件 + 4 个新增文件）；14:48:40 仍在变化（又新增 `MissionWidgetContract.ets` 等修改）。编辑者为 Lead/D1-D2 在途工作，不是 D3。
- 因此任务书要求的"Lead 代码改动前、基于 4b69614 当前源码"的**纯净基线窗口已经错过**；D3 未做 reset/stash/clean，不触碰他人未提交修改。
- 按 Lead 指示（2026-11-03 会话内）：**构建槽由 Lead 迭代占用，D3 在收到明确 FROZEN 信号后才跑正式候选 `harmony:test` → `harmony:build`**。本文件之后不再有 D3 发起的 hvigor 调用。

## 2. attempt1（无效基线，保留为历史证据）

| 项 | 值 |
|---|---|
| 命令 | `npm.cmd run harmony:test` |
| cwd | `D:/Projects/hongmen-final-d-harmony-native` |
| 开始 | 2026-11-03T14:46:20.580+08:00 |
| 结束 | 2026-11-03T14:47:57.798+08:00 |
| 时长 | 97.2 s |
| 退出码 | -1（hvigor BUILD FAILED，`harmony-test.ts` 以 `status ?? 1` 退出；Windows 下记录为 -1） |
| 结果 | **FAIL（mid-edit 源码编译错误，不是基线结论）** |
| 错误 | `WorkPacketContract.test.ets:107`：Property `lastNoNewInformationAtKnown` does not exist on type `WorkPacketObservationView`（该测试文件与模型文件当时正在被编辑，先后不一致） |
| 证据 | `BASELINE_TEST_ATTEMPT1_MIDEDIT.log`、`BASELINE_TEST_ATTEMPT1_MIDEDIT.exit.json`、`BASELINE_TEST_ATTEMPT1_MIDEDIT.meta.txt`、`raw/tree_state_1449.log` |

**为什么不算基线 FAIL**：编译错误来自 Lead/D1-D2 在途编辑（14:40:46–14:48:40 持续写入），不是 4b69614 纯净源码的结果，也不是环境缺失（hvigor、ArkTS 编译器、JDK 均正常启动并执行到 ArkTS 编译阶段）。按 `03_鸿蒙与独立验收职责.md` §5.3，不用它填当前候选的分母。

## 3. 14:49 工作树快照（只读记录，会被 Lead 的后续修改覆盖）

| 文件 | 状态 | size | mtime（UTC+8） | SHA-256 |
|---|---|---|---|---|
| `harmonyos/entry/src/main/ets/common/MissionWidgetContract.ets` | M | 7,433 | 14:48:40.803 | `fd40d714f332c3e0663f0230a9ab0ccdf1b893158353ffb34f7143e4abbada9a` |
| `harmonyos/entry/src/main/ets/components/MissionReadbackView.ets` | M | 21,218 | 14:45:40.745 | `23565f67793e74ae87dbe09142ea60fc8e9df219666a016174601ec9fe550e87` |
| `harmonyos/entry/src/main/ets/pages/MissionDetail.ets` | M | 72,777 | 14:43:54.976 | `e4fabd321d5801c38e280dc18ff6a6dd4c1d31a17c2010aca14a3f08c67a8bd8` |
| `harmonyos/entry/src/test/List.test.ets` | M | 1,474 | 14:45:03.932 | `ab2d0adfb30dc5df962344040af794f21d4757f406632f17b3ca45167b7706e3` |
| `harmonyos/entry/src/main/ets/components/MissionWorkPacketView.ets` | ?? | 11,074 | 14:45:59.616 | `ec0fd3241eb54941207e7bdc7d1e25fa72f239ba0ef7fcccf1ede53a6625c288` |
| `harmonyos/entry/src/main/ets/models/WorkPacket.ets` | ?? | 46,203 | 14:40:46.385 | `4bdb426643162f45d2fa69e48e0dc799196806d9c5b6d1e7fd2166a0df3dcaf3` |
| `harmonyos/entry/src/test/WorkPacketContract.test.ets` | ?? | 13,519 | 14:44:58.943 | `83300459190889f5723aacd4bec8339d1b2972392ce270e7a85f630ada30b15e` |
| `harmonyos/entry/src/test/WorkPacketFixtures.ets` | ?? | 81,298 | 14:44:27.411 | `8d01950f7cfa162252a225bc9eba4cad39cb1cf2c53b4ba339b7221f370d8eaa` |

> 该快照只是时间点记录，不用于任何候选；FROZEN 后 D3 会重新记录 HEAD + `git status --porcelain` + 每个 dirty 文件 SHA-256 作为正式快照身份。

## 4. 历史 109 项与旧 test_result.txt

- 旧 `harmonyos/entry/.test/default/intermediates/test/coverage_data/test_result.txt`（mtime 2026-11-03 11:10:09，`Tests run: 109, Failure: 0, Error: 0, Pass: 109, Ignore: 0`）属于 485d485 准备期产物，**不得沿用为 4b69614/候选结果**。
- `scripts/harmony-test.ts` 在每次运行前按设计删除该文件（L27），因此 attempt1 启动后旧文件被删除；其尾部内容已在 D3 只读探测时记录（`raw/` 与本文档说明），不作为新结论。
- 正式分母以 FROZEN 后本次运行的 `test_result.txt` 行为准；若退出 0 但缺汇总行，按 `03_鸿蒙与独立验收职责.md` §5.1 记 **UNKNOWN**，不沿用旧数字。

## 5. 下一步（D3）

1. 等 Lead 明确 FROZEN（含候选源码 SHA/提交或冻结快照）→ 记录 HEAD/`git status`/dirty 文件 SHA-256。
2. `npm.cmd run harmony:test`：记录命令/开始结束/退出码/`test_result.txt` 真实汇总（Tests run…）；存 `BASELINE_TEST.log` + `.exit`。
3. `npm.cmd run harmony:build`：记录退出码、unsigned HAP 路径/size/mtime/SHA-256 → `BASELINE_UNSIGNED_HAP.json`，明确"unsigned，不是签名证据"，并把候选源码 SHA 与 dirty 清单绑进证据。
4. 完成后立即报告 Lead；Lead 提交后 D3 复核 signed 缺失结论（提交内容无签名材料、`signingConfigs` 仍为 `[]`）。
