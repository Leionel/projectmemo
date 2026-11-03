# D3 证据包索引（环境/设备/签名/基线/用例矩阵）

Owner：d3-device（Track D3）　日期：2026-11-03（UTC+8）　工作树：`D:/Projects/hongmen-final-d-harmony-native`（分支 `codex/final-d-harmony-native`，固定 HEAD `4b696141435825a3582816e8e449c0e0cf013f29`）

> 本目录是 D3 的全部可检查交付。**当前结论：环境 OK；设备轨 BLOCKED/NOT_RUN（无稳定设备、无真机）；signed 安装/系统交互 NOT_RUN（无受权签名）；本树既有 HAP 是 unsigned 旧产物，不是签名证据；正式候选基线 test/build 等 Lead FROZEN 后在冻结快照上执行。**

## 1. 文件索引

| 文件 | 内容 | 状态 |
|---|---|---|
| `ENVIRONMENT_PROBE.json` | DevEco 6.1.1.300、SDK API24(6.1.1.125)、hvigor 6.24.4、ohpm 6.1.2.285、node/npm、hdc 3.2.0d、targets/tconn 时间线、模拟器 AVD 身份、隔离库只读核对、端口快照、raw 日志索引 | 已完成 |
| `DEVICE_STATUS.md` | 设备时间线、模拟器身份（Pura 90 / HarmonyOS 6.1.1(24) / x86_64 / PHEMU-FD00，非真机）、两次实例退出、BLOCKED 原因、恢复条件与执行分支 | 已完成 |
| `DEVICE_TARGETS.log` | 低频被动 `hdc list targets -v` 采样（含时间戳、进程数、端口监听数） | 持续追加（低频） |
| `SIGNING_INVENTORY.md` | `signingConfigs: []`、hvigor "Will skip sign"、树内 0 签名材料、无 .env、唯一 unsigned HAP 的 hash/归属、FS-E01 风险、signed 核验方法与恢复条件 | 已完成 |
| `SIGNING_EVIDENCE.log` | 紧凑提取的签名核对证据（tracked/disk 材料、build-profile、hvigor 报告行、HAP hash） | 已完成 |
| `CASE_MATRIX.md` | 12 项用例（D-WP-01/02/03、D-HO-01/02、D-TTL-01/02、D-ACC-01、D-REC-01、D-SRC-01、D-UI-01 + E-HAP-01/FS-E01），每项前置/步骤/期望/证据/当前状态（设备 NOT_RUN、本地契约预检 PENDING_FROZEN_TEST）/恢复条件 | 已完成 |
| `BASELINE_TREE_STATE.md` | 基线窗口已错过的事实、14:49 快照（dirty 文件 SHA-256）、attempt1 mid-edit 说明、旧 109 项不可沿用 | 已完成 |
| `BASELINE_TEST_ATTEMPT1_MIDEDIT.log/.exit.json/.meta.txt` | 14:46:20–14:47:57 `harmony:test`（in-progress 源码编译错误，**不记基线 FAIL**） | 历史证据保留 |
| `BACKEND_READBACK_PLAN.md` | 同身份读回方案：隔离库/端口/探针阶段/命令/HTTP 腿（暂缓）/确认事项 | 已完成（计划） |
| `BACKEND_READBACK_RESULT.md` | 进程内探针执行结果：PASS 19/19、隔离库前/后行数归零、边界说明 | 已执行（Lead 批准） |
| `PROBE_RUN.log` / `PROBE_RUN.exit.json` | 探针原始输出、退出码 0、耗时 5.6s、命令与隔离声明 | 已执行 |
| `BACKEND_READBACK_PROBE_RESULT.json` | 探针结构化报告（步骤、断言、created IDs、cleanup） | 已执行 |
| `PROBE_DB_STATE_BEFORE.json` / `PROBE_DB_STATE_AFTER.json` | 隔离库只读前后快照（全表 0 行、d3- 残留 0、无 WAL/SHM、size/mtime） | 已执行 |
| `raw/` | 环境/设备/数据库/树状态原始日志（只读采集，不含密钥） | 归档 |
| `FROZEN_SNAPSHOT.json` | **待生成**：Lead FROZEN 后 HEAD+branch+全部 dirty 文件 status/size/mtime/SHA-256 | 等 FROZEN |
| `BASELINE_TEST.log` / `BASELINE_TEST.exit` | **待生成**：冻结快照 `npm.cmd run harmony:test` 原始日志、退出码、命令、真实 `Tests run:` 汇总（缺汇总记 UNKNOWN，不沿用旧 109） | 等 FROZEN |
| `BASELINE_BUILD.log` / `BASELINE_BUILD.exit.json` | **待生成**：`npm.cmd run harmony:build` 原始日志、退出码、HAP 清单 | 等 FROZEN |
| `BASELINE_UNSIGNED_HAP.json` | **待生成**：unsigned HAP 路径/size/mtime/SHA-256，绑定候选源码 HEAD+dirty 清单；明确非签名证据 | 等 FROZEN |

## 2. 裁决口径（不夸大）

- **环境**：OK —— DevEco/SDK/hvigor/ohpm/node 完整；attempt1 已证明 hvigor+ArkTS 编译链能运行（错误来自在途源码，不是缺工具）。
- **设备**：BLOCKED / NOT_RUN —— 模拟器两次短暂 `TCP Connected` 后退出，未完成 `hdc shell` 设备身份核验；无真机；未安装任何包；无设备截图。
- **签名**：NOT_RUN —— 无受权签名配置；唯一 HAP 是旧 unsigned（485d485 产物）；signed 安装/系统投递/卡片系统刷新均未执行。
- **基线/候选构建**：DEFERRED —— 任务书要求的"Lead 改动前窗口"已错过（源码 14:40:46 起被 D1/D2 修改）；按 Lead 指示等 FROZEN 后在冻结快照上串行执行，并把候选源码 SHA 与 dirty 清单绑定进证据。
- **同身份读回（服务层）**：PASS（进程内，隔离库合成数据，已清理）——只证明 Web/API 共用 `readMissionBack`/`commandMission` 的同一身份链，不替代 HTTP/Web UI/Worker/签名/设备/模型验收。

## 3. 安全与隔离

- 只用 `prisma/final-preparation.db` 隔离库；不碰真实用户库/测试库/开发库；不 seed 用户数据；不调用模型/外网；探针 `LLM_MODE=mock`、provider 全部脚本化。
- 不复制、不读取任何签名私钥/口令/cookie；`%USERPROFILE%\.ohos\config` 只记录存在性。
- 未杀/未重启用户进程，未卸载 App，未清设备数据；构建只在 Lead 授予的冻结槽执行。
- 本目录不含密钥、个人数据库内容或未脱敏私人材料。

## 4. 复核者最短路径

1. `ENVIRONMENT_PROBE.json` → `SIGNING_INVENTORY.md` → `DEVICE_STATUS.md`（结论与证据）；
2. `CASE_MATRIX.md`（12 项状态与恢复条件）；
3. `BACKEND_READBACK_RESULT.md` + `PROBE_DB_STATE_*.json`（隔离、同身份、清理）；
4. FROZEN 后：`FROZEN_SNAPSHOT.json` → `BASELINE_TEST.exit`（真实分母）→ `BASELINE_UNSIGNED_HAP.json`（unsigned 非签名证据）。
