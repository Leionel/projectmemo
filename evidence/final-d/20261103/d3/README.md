# D3 证据包索引（环境/设备/签名/FROZEN 候选测试与 unsigned 构建/用例矩阵/同身份读回）

Owner：d3-device（Track D3）　日期：2026-11-03（UTC+8）　工作树：`D:/Projects/hongmen-final-d-harmony-native`（分支 `codex/final-d-harmony-native`，固定 HEAD `4b696141435825a3582816e8e449c0e0cf013f29`）

> **当前结论（一句话）**：环境 OK；FROZEN 候选快照上原生测试 **133/133 PASS（exit 0）**、unsigned HAP 构建 **exit 0**；但**无受权签名 ⇒ signed 安装/系统交互 NOT_RUN**；**无稳定设备/无真机 ⇒ 设备轨 BLOCKED/NOT_RUN**；同身份读回服务层探针 **PASS（隔离库合成数据，已清理归零）**。unsigned HAP 不是签名证据，只绑定 FROZEN 候选源码快照。

## 1. 文件索引

| 文件 | 内容 | 状态 |
|---|---|---|
| `ENVIRONMENT_PROBE.json` | DevEco 6.1.1.300、SDK API24(6.1.1.125)、hvigor 6.24.4、ohpm 6.1.2.285、node/npm、hdc 3.2.0d、targets/tconn 时间线、模拟器 AVD 身份、隔离库只读核对、端口快照、raw 日志索引 | 完成 |
| `DEVICE_STATUS.md` | 设备时间线、模拟器身份（Pura 90 / HarmonyOS 6.1.1(24) / x86_64 / PHEMU-FD00，非真机）、两次实例退出、BLOCKED 原因、恢复条件与执行分支 | 完成 |
| `DEVICE_TARGETS.log` | 低频被动 `hdc list targets -v` 采样（时间戳/进程数/端口监听数） | 完成（含 15:07:42 采样：无 5555、无 emulator 进程） |
| `SIGNING_INVENTORY.md` | `signingConfigs: []`、hvigor "Will skip sign"、树内 0 签名材料、无 .env、候选 unsigned HAP 记账、FS-E01 风险、signed 核验方法与恢复条件 | 完成 |
| `SIGNING_EVIDENCE.log` | 紧凑签名核对证据（tracked/disk 材料、build-profile、hvigor 报告行、HAP hash） | 完成 |
| `CASE_MATRIX.md` | 12 项用例（D-WP-01/02/03、D-HO-01/02、D-TTL-01/02、D-ACC-01、D-REC-01、D-SRC-01、D-UI-01 + E-HAP-01/FS-E01）：前置/步骤/期望/证据/**设备 NOT_RUN + 本地契约预检 PASS（FROZEN 133/133）**/恢复条件 | 完成 |
| `BASELINE_TREE_STATE.md` | 任务书"Lead 改动前基线窗口已错过"的事实、14:49 快照、attempt1 mid-edit 说明、旧 109 不沿用 | 完成（历史） |
| `BASELINE_TEST_ATTEMPT1_MIDEDIT.log/.exit.json/.meta.txt` | 14:46:20–14:47:57 `harmony:test`（mid-edit 源码编译错误，**不记基线 FAIL**） | 历史证据保留 |
| **`FROZEN_SNAPSHOT.json`** | Lead FROZEN 快照：HEAD/branch/20 个 dirty 文件 status/size/mtime/SHA-256 + `source_tree_digest`（221 文件） | **完成（15:14:38）** |
| **`BASELINE_TEST.log` / `BASELINE_TEST.exit`** | `npm.cmd run harmony:test`：exit 0、62.2s、真实分母 **Tests run: 133, Failure: 0, Error: 0, Pass: 133, Ignore: 0**、result_status=PASS | **完成** |
| **`BASELINE_BUILD.log` / `BASELINE_BUILD.exit.json`** | `npm.cmd run harmony:build`：exit 0、286.4s、唯一产物 unsigned HAP | **完成** |
| **`BASELINE_UNSIGNED_HAP.json`** | unsigned HAP 路径/size/mtime/SHA-256，绑定候选 HEAD+dirty 清单+digest；显式列全部 HAP；明确非签名证据；含 signed 检测更正记录 | **完成** |
| `FROZEN_TEST_BUILD_RESULT.md` | FROZEN 测试/构建结果汇总（命令、时间、退出码、分母、HAP、签名结论、限制） | 完成 |
| `BACKEND_READBACK_PLAN.md` | 本地后端/Web 同身份读回方案（隔离库/端口/阶段/命令/HTTP 腿暂缓/确认事项） | 完成（计划） |
| `BACKEND_READBACK_RESULT.md` | 进程内探针执行结果：PASS 19/19、隔离库前后行数归零、边界说明 | 完成（已执行） |
| `PROBE_RUN.log` / `PROBE_RUN.exit.json` | 探针原始输出、退出码 0、耗时 5.6s、命令与隔离声明 | 完成 |
| `BACKEND_READBACK_PROBE_RESULT.json` | 探针结构化报告（步骤/断言/created IDs/cleanup） | 完成 |
| `PROBE_DB_STATE_BEFORE.json` / `PROBE_DB_STATE_AFTER.json` | 隔离库只读前后快照（全表 0 行、d3- 残留 0、无 WAL/SHM、size/mtime） | 完成 |
| `raw/` | 环境/设备/数据库/树状态原始日志（13 个，只读采集，不含密钥） | 归档 |
| `MANIFEST.sha256` | 本目录证据文件 SHA-256 清单 | 完成（最后生成） |

## 2. FROZEN 结果摘要（2026-11-03）

| 项 | 值 |
|---|---|
| 快照 | HEAD `4b69614`，branch `codex/final-d-harmony-native`，dirty 20，`source_tree_digest` `39646e8f6eeb0bd633b02b69b299329c4d9248431544654e0e15a76cbc375e68`（221 文件） |
| 测试 | `npm.cmd run harmony:test`，exit **0**，15:14:38.151→15:15:40.401（62.2s），**133/133 PASS**，Failure/Error=0 |
| 构建 | `npm.cmd run harmony:build`，exit **0**，15:15:56.388→15:20:42.745（286.4s）；唯一产物 `entry-default-unsigned.hap`，**8,273,912 B / 2026-11-03T15:20:40.808+08:00 / SHA-256 `9c935302a720a34c2cf845f9a0528806d502f23364f07788650d0e9020164629`** |
| 签名 | 无受权签名（`signingConfigs: []`；构建日志 `Will skip sign 'hos_hap'`）⇒ **unsigned 非签名证据**；signed 安装/系统交互 **NOT_RUN** |
| 源码一致性 | build 启动时 `source_tree_digest` 与 test 快照一致（`IDENTICAL`），无 harmonyos 源码变化 |
| 设备 | **BLOCKED/NOT_RUN**（无稳定设备/无真机；未安装任何包、未卸载、未清数据） |

## 3. 裁决口径（不夸大）

- **环境**：OK —— DevEco/SDK/hvigor/ohpm/node 完整；attempt1 已证明 hvigor+ArkTS 编译链能运行（错误来自在途源码，不是缺工具）。
- **设备**：BLOCKED / NOT_RUN —— 模拟器两次短暂 `TCP Connected` 后退出，未完成 `hdc shell` 设备身份核验；无真机；无设备截图。
- **签名**：NOT_RUN —— 本树 `signingConfigs: []`；候选仅 unsigned；signed 安装/系统投递/卡片系统刷新均未执行。
- **候选测试/构建**：PASS（原生测试 133/133、unsigned 构建 exit 0）—— 这是**工程证据**，不是签名/设备/Worker/模型验收。
- **同身份读回（服务层）**：PASS（进程内，隔离库合成数据，已清理）—— 只证明 Web/API 共用 `readMissionBack`/`commandMission` 的同一身份链，不替代 HTTP/Web UI/Worker/签名/设备/模型验收。

## 4. 安全与隔离

- 只用 `prisma/final-preparation.db` 隔离库；不碰真实用户库/测试库/开发库；不 seed 用户数据；不调用模型/外网；探针 `LLM_MODE=mock`、provider 全部脚本化；前后行数归零、无 WAL 残留。
- 不复制、不读取任何签名私钥/口令/cookie；`%USERPROFILE%\.ohos\config` 只记录存在性。
- 未杀/未重启用户进程，未卸载 App，未清设备数据；构建只在 Lead 授予的 FROZEN 槽执行（test/build 串行）。
- 本目录不含密钥、个人数据库内容或未脱敏私人材料；`raw/` 只读采集。

## 5. 复核者最短路径

1. `ENVIRONMENT_PROBE.json` → `SIGNING_INVENTORY.md` → `DEVICE_STATUS.md`（结论与证据）；
2. `FROZEN_TEST_BUILD_RESULT.md` + `FROZEN_SNAPSHOT.json` + `BASELINE_TEST.exit` + `BASELINE_UNSIGNED_HAP.json`（候选工程证据与源码绑定）；
3. `CASE_MATRIX.md`（12 项状态与恢复条件）；
4. `BACKEND_READBACK_RESULT.md` + `PROBE_DB_STATE_*.json`（隔离、同身份、清理）；
5. `MANIFEST.sha256` 校验本目录文件完整性。
