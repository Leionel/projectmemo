# D 树签名分账（D3）

日期：2026-11-03（UTC+8）　Owner：d3-device（Track D3）　基线 HEAD：`4b696141435825a3582816e8e449c0e0cf013f29`

> 结论先行：**D 工作树没有任何受权签名配置与签名材料；现有唯一 HAP 是 unsigned。signed 安装、系统交互、系统投递、卡片系统刷新本次一律 NOT_RUN。** 不复制主目录/用户目录私钥，不卸载旧 App，不清用户数据，不绕过签名。

## 1. 结论表

| 项目 | 实测结果 | 证据 |
|---|---|---|
| `harmonyos/build-profile.json5` `app.signingConfigs` | `[]`（空数组） | 文件 L3；同文件 L7 product `"signingConfig": "default"` 只是引用名，未定义配置 |
| 签名材料（p12/cer/keystore/jks/p7b/pem/key/bks） | D 树内 **0 个**（排除 `node_modules`/`oh_modules`/`build`/`.hvigor`） | `git ls-files` 无匹配；磁盘扫描无匹配 |
| tracked 签名相关文件 | **0 个** | `git ls-files` 过滤 |
| `.env` | **不存在**（仅 `.env.example`，无密钥默认值） | 磁盘与 git 核对 |
| hvigor 签名阶段 | 跳过签名 | `harmonyos/.hvigor/report/report-202611031117314110.json`：`"Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project. If needed, configure the signingConfigs in .../harmonyos/build-profile.json5."`；同类 `"No signingConfig found, initRemoteHspCache failed."` |
| 现有 HAP（FROZEN 候选，最新） | `harmonyos/entry/build/default/outputs/default/entry-default-unsigned.hap`，**8,273,912 bytes，mtime 2026-11-03T15:20:40.808+08:00，SHA-256 `9c935302a720a34c2cf845f9a0528806d502f23364f07788650d0e9020164629`** | FROZEN 快照（HEAD `4b69614` + 20 dirty，source_tree_digest `39646e8f…`）`harmonyos:build` exit 0；构建日志 `WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured...`；**unsigned，不是签名证据，也不是设备/安装 PASS** |
| 历史 HAP（已被候选构建覆盖） | 旧 `entry-default-unsigned.hap` 8,047,574 bytes / 2026-11-03 11:18:09.914 / SHA-256 `2d64b3da8a803022e500f9ec51d423fdf8fd869fb8841db54a96b4acc455ed2f` | 485d485 准备期产物；同名文件已被 FROZEN 候选构建覆盖，旧 hash 仅作历史记录，不得用于候选/签名证据 |
| signed 产物 | **不存在** | `outputs/default/` 下无 `entry-default-signed.hap` |
| 用户主目录 DevEco 默认签名材料 | `%USERPROFILE%\.ohos\config` 下存在两套（mtime 2026-09-28、2026-11-02，含 .p12/.cer/.csr/.p7b） | 只记录存在性；**未复制、未使用、不假设受权或有效** |

## 2. unsigned / signed 判定方法（不靠文件名猜测）

本树产物判定采用三重核对：

1. **配置源**：`harmonyos/build-profile.json5` 的 `app.signingConfigs` 为空 ⇒ 工程没有签名目标；hvigor 在 `SignHap` 阶段打印 `Will skip sign 'hos_hap'`。
2. **产物目录**：`harmonyos/entry/build/default/outputs/default/` 只有 `entry-default-unsigned.hap` + `pack.info`，无 `entry-default-signed.hap`；无签名中间物（如 signed 前体/签名 profile 输出）。
3. **产物绑定**：对唯一 HAP 记录 size/mtime/SHA-256，并注明其所属候选源码（FROZEN_SNAPSHOT 的 HEAD + dirty 清单 + `source_tree_digest`）；历史产物 hash 与本候选分开记账。

> 注意：**文件名不是充分证据**。旧 signed 也可能残留在构建目录；反之 `entry-default-unsigned.hap` 也可能被自行改名。真正签名验收必须在候选构建时显式列出 signed 路径、mtime、SHA-256、非敏感签名身份，并用 SDK 签名工具核验（见 §5）。

## 2.1 FROZEN 候选构建的签名结论（2026-11-03 15:15:56–15:20:42）

- 产物目录实测**唯一** HAP = `entry-default-unsigned.hap`（8,273,912 B / 15:20:40.808 / `9c935302…4629`），**无任何 signed 文件**；`all_hap_outputs` 全量列于 `BASELINE_UNSIGNED_HAP.json`。
- 构建日志（`BASELINE_BUILD.log`）再次打印：`WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project.` —— 与 `signingConfigs: []` 一致。
- 结论：候选仍为 unsigned；**signed 安装/系统交互/系统投递/卡片系统刷新继续 NOT_RUN**，恢复条件见 §4。
- 说明：D3 构建脚本首版用 `-match 'signed'` 判断 signed 文件名，会误命中 "unsigned" 子串；已改为 `(?<!un)signed` 并按磁盘实测修正 `signed_present=false`（未重跑构建，HAP 文件/hash/mtime 与本次构建一致），更正记录写在 `BASELINE_UNSIGNED_HAP.json` 的 `signed_detection`。

## 3. FS-E01 风险（构建脚本默认输出 unsigned）

`scripts/harmony-build.ts:57–61` 的产物候选顺序：

```ts
const candidates = [
  .../entry-default-unsigned.hap,
  .../entry-default-signed.hap,
];
const hapPath = candidates.find((candidate) => fs.existsSync(candidate));
```

- 当 unsigned 与 signed **同时存在**时，脚本优先打印 **unsigned** 的路径与 SHA-256；旧 signed 也可能留在目录里。
- 因此 `npm.cmd run harmony:build` 的默认打印**不能**用作“签名包”证据。FS-E01 结论：源码风险已确认（只读核对，不修改公共脚本）；验收时必须显式选择 signed 路径并核对绑定。
- 本轮 D3 基线/候选 unsigned 构建证据只用于工程可构建性，不用于签名验收。

## 4. 本次 NOT_RUN 的范围与恢复条件

| 验收项 | 当前状态 | 原因 | 恢复条件 |
|---|---|---|---|
| signed HAP 构建 | NOT_RUN | 工程无签名配置；无受权签名材料 | 用户在 DevEco Studio 为本工程配置**受权**签名（或提供授权 signingConfig/profile），重建后出现 signed 产物 |
| 设备安装 signed HAP | NOT_RUN | 无 signed 包；且无稳定设备（见 DEVICE_STATUS.md） | 有受权 signed 候选 + 模拟器/真机稳定在线 |
| 登录→焦点→原委托→证据→批准→结果→返回（D3 设备旅程） | NOT_RUN | 同上 | 同上；模拟器通过只签收模拟器，真机另记 |
| 冷/热启动、Want 系统投递、卡片系统刷新、换账号、TTL | NOT_RUN | 依赖已安装 signed App 与系统行为 | 同上 |
| 中文输入法/大字号/键盘遮挡/Sheet/系统返回（设备侧） | NOT_RUN | 依赖真实设备 UI | 同上 |
| 权限（日历等）系统弹窗 | NOT_RUN | 依赖真机授权与签名 | 真机 + 受权签名；模拟器不可代替真机结论 |

**不做的事（明确边界）**：不复制主目录或 `%USERPROFILE%` 的 p12/cer/profile 到本树；不使用 `hdc install` 安装 unsigned 包；不卸载旧 App、不清模拟器数据来绕过签名冲突；不把模拟器/unsigned 结果写成 signed 或真机 PASS。

## 5. 将来 signed 核验的可执行方法（恢复后使用）

1. 候选构建后显式列出：
   - `harmonyos/entry/build/default/outputs/default/entry-default-signed.hap` 是否存在；
   - size、mtime（UTC+8）、SHA-256（`Get-FileHash -Algorithm SHA256`）；
   - 与候选中签名的 `signingConfig` 名称/证书记录（只记录**非敏感**身份：subject/issuer/有效期/证书指纹，不含私钥与口令）。
2. 用 SDK 自带签名工具做产物核验（只读，不产生私钥写入）：
   `D:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\lib\hap-sign-tool.jar`
   （`java -jar ... verify-app -inFile <signed.hap> ...`，以本机 SDK 版本帮助为准）。
3. 只有 signed 路径 + mtime + SHA-256 + 签名身份四者都绑定到**同一候选**，才进入安装验收；安装后再记录设备类型/API、安装命令与退出码、时间戳。
4. E（独立验收）复算 signed 路径/hash/身份，D3 只提供环境与操作证据。

## 6. 安全与完整性

- 本轮未复制、未读取私钥内容、未导出任何签名材料；`%USERPROFILE%\.ohos\config` 只做存在性/大小/mtime 记录。
- 证据文件不含口令、cookie、私钥、个人数据库内容；数据库只读探测（见 ENVIRONMENT_PROBE.json 的 `isolated_database`）。
- 签名缺失结论可在 Lead 完成 git 提交后由 D3 复核：提交内容不得包含签名材料，`signingConfigs` 仍为 `[]`。
