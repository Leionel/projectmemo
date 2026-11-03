# D3 设备状态（模拟器/真机分账）

日期：2026-11-03（UTC+8）　Owner：d3-device　结论：**无稳定设备、无真机、无 signed HAP ⇒ 设备轨 BLOCKED / NOT_RUN**（历史曾短暂 Connected，随后实例退出，未完成 shell 身份核验，也未安装任何包）。

## 1. 当前状态（最后采样 2026-11-03T14:53:50.051+08:00）

| 项 | 值 |
|---|---|
| `hdc list targets -v` | `COM3 UART Ready unknown...` / `COM4 UART Ready unknown...`（**无** `127.0.0.1:5555` 行；COM3/COM4 只是 UART 条目，不当作真机） |
| Emulator/qemu 进程数 | 0 |
| 5555 端口监听 | 0 |
| 已安装 HAP | 无（从未执行 install；无 signed 包可用） |
| 截图 | 无（未发生任何设备操作，不提供伪造/占位截图） |
| 真机 | 未连接、未出现 |

## 2. 时间线（只读观察，未杀/未重启用户进程）

| UTC+8 | 观察 | 证据源 |
|---|---|---|
| 14:32（Lead 先前探测，仅引用不采信） | 曾启动 Emulator 进程 PID 55796 | Lead 交接信息 |
| 14:37:00 | 本次探测期间 Emulator.exe 启动（PID 56172），trace_88490_commandPipe；emulator-crash-service PID 47976 | `Win32_Process` 快照、`D:/Huawei/Emulator/deployed/Pura 90/Log/Emulator.log` |
| 14:38:53–14:40 | 只读探测 DevEco/SDK/hvigor/ohpm/node/hdc 版本 | `raw/env_versions.log`、`raw/node_npm_ohpm_hvigor.log`、`raw/sdk_metadata.log` |
| 14:39:28 | `hdc list targets -v`：`127.0.0.1:5555 TCP Offline` + COM3/COM4 UART Ready | `raw/hdc_probe.log` |
| ~14:39:30 | `hdc tconn 127.0.0.1:5555` ⇒ **Connect OK**；随后 targets 显示 `127.0.0.1:5555 TCP Connected` | `raw/hdc_probe.log` |
| 14:39:59 | 实例退出：`Emulator.log` "Stop multiscreen before quit" / "wait for guest os boot completed" / "df command return error data." / "quit emulator"；5555 目标消失 | `Emulator.log` tail |
| 14:40:41 | 新实例启动（PID 33288，trace_96037），crash-service 参数含 `phone,6.1.0.126,x86_64,24,PHEMU-FD00`；14:40:47 起 `hdc shell param get` 失败（target 不存在） | `Emulator.log`、`raw/hdc_shell_probe.log` |
| 14:40:47 | `hdc shell` 全部查询 `[Fail]Not match target founded` | `raw/hdc_shell_probe.log` |
| 14:44:14 | 新实例显示启动动画（ShowBootAnimation） | `Emulator.log` |
| ~14:46:33 | 再次 `hdc tconn 127.0.0.1:5555` ⇒ Connect OK/Connected（短窗口） | 命令输出（本次会话） |
| 14:46:37 | 实例再次退出（正常 QuitEmulator 路径）；之后 targets 只剩 COM3/COM4 | `Emulator.log` tail、`raw/hdc_shell_probe2.log` |
| 14:47:39 | `hdc shell` 仍失败（无 target） | `raw/hdc_shell_probe2.log` |
| 14:53:50 | 被动 `hdc list targets -v`：无 5555；emulator 进程 0；5555 监听 0 | `DEVICE_TARGETS.log` |

## 3. 模拟器身份（来自 AVD 配置与启动参数，非 shell 核验）

| 项 | 值 | 来源 |
|---|---|---|
| 类型 | HarmonyOS **模拟器**（非真机） | Emulator.exe 启动参数 |
| AVD 名 | `Pura 90` | `D:/Huawei/Emulator/deployed/lists.json`、`Pura 90/config.ini` |
| OS / API | HarmonyOS 6.1.1(24) / API **24** | `config.ini` `os.osVersion`、`os.apiVersion` |
| softwareVersion / guest | 6.1.0.126 / HarmonyOS 6.1.0.126(SP1) | `config.ini`、`lists.json` |
| 芯片架构 | `hw.cpu.arch=x86_64`（lists.json 的 `abi` 字段写 `x86`） | `config.ini`、`lists.json` |
| 设备型号标记 | `deviceModel=PHEMU-FD00` | `config.ini`、crash-service trace-params |
| 屏幕/内存 | 1320×2856 @560dpi / 4096MB RAM、4 vCPU | `config.ini`、`lists.json` |
| 镜像 | `C:/Users/Administrator/AppData/Local/Huawei/Sdk/system-image/HarmonyOS-6.1.1/phone_all_x86/` | `hardware-qemu.ini` |
| AVD 目录 | `D:/Huawei/Emulator/deployed/Pura 90`（`userdata.img.qcow2` 1,335,621,376 bytes，mtime 14:40:54） | 目录清单 |

**未完成**：没有任何一次成功的 `hdc shell param get`/`bm dump`/`aa dump`；因此设备内 API/ABI/已安装 App/权限状态均未从 guest 侧核实，本文件的身份只用于“这是模拟器、不是真机”的判定，不用于任何 PASS 声明。

## 4. 为什么判定 BLOCKED（不是产品 FAIL）

1. **签名缺失**：无 signed HAP（见 SIGNING_INVENTORY.md），HarmonyOS 设备不接受未签名包；即使设备在线也无法安装候选。
2. **设备不稳定**：两次实例都在启动/刚可连接后退出；主机内存告警（`crash_server.log` 持续 "memory is low"，16GB 主机空闲约 4.4GB），属于**环境限制**，不是产品行为。
3. **未做绕过**：不卸载旧 App、不清数据、不安装 unsigned、不杀用户进程、不重启模拟器。

## 5. 恢复条件与后续执行分支

**恢复条件（全部满足才进入设备验收）**：
- 候选 signed HAP 存在且绑定到同一候选（路径/mtime/SHA-256/签名身份，见 SIGNING_INVENTORY.md §5）；
- 模拟器稳定在线并可用 `hdc shell` 完成身份核验（API/abi/deviceType），或连接真机（真机结论与模拟器分开）；
- 本地后端可达（仅隔离库、mock，端口见 BACKEND_READBACK_PLAN.md），且 Constants.ets 中的地址被核验为设备真实可达地址（不得直接把 34114 写成已验设备配置）。

**有设备后如何执行**（每个用例的步骤见 CASE_MATRIX.md）：
1. 记录设备类型（模拟器/真机）、OS/API、abi、候选 HAP 路径+hash、安装命令与退出码、UTC+8 时间戳；
2. `hdc install <signed.hap>`（仅 signed；失败如实记录，不绕过）；
3. 按 D-WP-01→D-UI-01 顺序走登录→焦点→原委托→证据→批准/补料→结果→返回；冷/热启动、Want 投递、卡片刷新、换账号、TTL 边界、断网单独记账；
4. 截图只在真实设备操作时提供，并标注设备类型/API/时间/候选 HAP hash；
5. 模拟器通过只签收模拟器；真机另记；签名/设备任一缺失即保持 NOT_RUN。

**当前动作**：按 Lead 指示停止高频重试；仅保留低频被动 `hdc list targets -v` 采样（`DEVICE_TARGETS.log` 续写），不再启动/重启模拟器，不占用构建槽。
