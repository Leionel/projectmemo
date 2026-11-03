# D3 用例矩阵（HarmonyOS 目标设备可用性）

日期：2026-11-03（UTC+8）　Owner：d3-device　基线 HEAD：`4b696141435825a3582816e8e449c0e0cf013f29`

来源：`docs/FINAL/ProjectMemo_2026_11_03-12_决赛冲刺规划/07_执行准备/03_鸿蒙与独立验收职责.md` §4（D 组 11 例 + FS-E01/E-HAP-01 签收项）。

**状态口径**
- **当前状态（设备证据）**：一律 `NOT_RUN`。原因统一为：① 无受权签名 ⇒ 无 signed HAP 可安装（SIGNING_INVENTORY.md）；② 模拟器仅短暂 `127.0.0.1:5555 TCP Connected`，两次实例退出，`hdc shell` 未成功，无稳定设备（DEVICE_STATUS.md）。不把无设备写成 PASS，不伪造截图。
- **本地契约预检**：`PASS（FROZEN 133/133）`。2026-11-03 FROZEN 快照（HEAD `4b69614`，dirty 20，source_tree_digest `39646e8f…`）上 `npm.cmd run harmony:test` 退出 0，`test_result.txt` 真实分母 **Tests run: 133, Failure: 0, Error: 0, Pass: 133, Ignore: 0**；下列各例列出的 native 用例均在该次运行中 `result=Success`（已逐条核对，见 `BASELINE_TEST.exit`/`BASELINE_TEST.log`）。这只是**逻辑契约**证据，**不是设备/UI/签名/Worker PASS**。
- 设备侧 PASS 需要：受权 signed 候选（路径+mtime+SHA-256+签名身份）+ 稳定设备 + 安装/操作日志 + 截图（标注设备类型/API/时间/HAP hash）。

> **FROZEN 工程结果（2026-11-03）**：候选快照 `harmony:test` 133/133 PASS（exit 0）；`harmony:build` exit 0，唯一产物 `harmonyos/entry/build/default/outputs/default/entry-default-unsigned.hap`，8,273,912 bytes，mtime 2026-11-03T15:20:40.808+08:00，SHA-256 `9c935302a720a34c2cf845f9a0528806d502f23364f07788650d0e9020164629`（**unsigned，非签名证据**）。无 signed 产物；本矩阵设备列状态**不变**（NOT_RUN）。详见 README.md 与 BASELINE_UNSIGNED_HAP.json。

## 总览

| Case ID | 场景 | 设备状态 | 本地契约预检 | 恢复条件 |
|---|---|---|---|---|
| D-WP-01 | WAITING_INPUT 打开工作包并补料 | NOT_RUN | PASS（FROZEN 133/133） | signed 候选 + 稳定设备 |
| D-WP-02 | 旧后端缺工作包/可选字段；真实 JSON null | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-WP-03 | 观察失败/未观察/已核对无变化三态区分 | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-HO-01 | 有效卡片冷/热启动进入原问题 | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-HO-02 | FS-D01：卡片有效但审批已替代/版本已变 | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-TTL-01 | 无新事件跨过 expiresAt（含等于边界） | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-TTL-02 | 登录等待跨过卡片期限；断网再打开 | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-ACC-01 | A 账号请求在途→退出→B 登录→旧响应到达 | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-REC-01 | 原批准/补料响应丢失、重试 | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-SRC-01 | 展开证据时原来源撤回或修订 | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| D-UI-01 | 中文输入法/大字/长标题/键盘/Sheet/系统返回 | NOT_RUN | PASS（FROZEN 133/133） | 同上 |
| E-HAP-01（FS-E01） | unsigned/signed 同时存在及旧 signed 残留 | NOT_RUN（候选仅 unsigned，无 signed） | 无需 native 用例；配置侧已核对（无 signingConfig），候选 unsigned 已记账 | 受权签名配置 + 重建 signed 候选 |

---

## D-WP-01 WAITING_INPUT 打开工作包并补料

- **前置**：已安装 signed 候选 App；已登录合成/授权账号；后端可达；存在 `WAITING_INPUT` 委托（由合成 mission 产生，question 含 questionId）。
- **步骤**：焦点/原项目 → 打开委托 → 工作包四问 → 点唯一主操作"回答/补料" → 填答并提交 → Web 同账号打开同一 mission readback。
- **期望**：打开原 mission/question（不新建同义任务）；只一项主要动作；提交后 Web 同身份读回同一 missionId/questionId 且版本前进；拒绝/超时不当成功。
- **所需证据**：设备类型/API/时间；候选 HAP hash；页面截图（工作包+提交后）；服务端读回 JSON（missionId/questionId/version）；`requestId`/`expectedVersion` 日志。
- **当前状态**：设备 NOT_RUN。本地契约预检 PASS（FROZEN 133/133）；候选 native 用例：`WorkPacketContract.waiting_approval_packet_keeps_single_primary_action_and_blockers`、`WidgetHandoff.valid_handoff_keeps_exact_question_and_approval_identity`。
- **恢复条件/分支**：有 signed 候选 + 稳定设备后按上述步骤执行；模拟器通过只签收模拟器。无设备期间仅保留本地契约预检，不写 PASS。

## D-WP-02 旧后端缺工作包/可选字段；真实 JSON null

- **前置**：同一 signed 候选；后端为缺 `workPacket`/可选字段的旧合同（或注入旧 readback 夹具）；真实 JSON 中字段为 `null`。
- **步骤**：打开委托详情与工作包；对比旧字段缺失、`null`、新枚举三类响应。
- **期望**：原详情继续可用；提示摘要未提供；`null` 不被默认为 0，缺失不被默认为"未观察"/成功；未知不显示为 0。
- **所需证据**：旧 readback 响应片段（脱敏）；页面截图；本地契约测试输出（用例名+分母）。
- **当前状态**：设备 NOT_RUN。本地契约预检 PASS（FROZEN 133/133）；候选用例：`WorkPacketContract.legacy_server_without_work_packet_falls_back_and_keeps_readback`、`explicit_null_observation_is_known_none_not_missing`、`missing_observation_block_stays_unknown_not_not_observed`、`S2Readback.old_backend_without_usage_remains_readable`。
- **恢复条件/分支**：设备侧需 signed 候选 + 设备 + 可控旧后端（隔离库/本地 mock 服务）；只读夹具不得写真实库。

## D-WP-03 观察失败/未观察/已核对无变化三态区分

- **前置**：signed 候选；历史含 `EXECUTION_STOPPED(TOOL)` 观察失败、无观察、以及成功"核对无变化"三类事件（可在隔离库用合成 mission 生成）。
- **步骤**：逐个打开对应委托，读取状态文案、原因与时间；核对观察时间 vs 同步时间。
- **期望**：三态文案/原因/时间明确区分，不统一成"正在跟进"；失败不读成成功；同步时间不冒充观察时间。
- **所需证据**：三组事件原文（脱敏）+ 三张对应页面截图 + 读回 JSON 的 observedAt/readAt 字段；本地契约测试输出。
- **当前状态**：设备 NOT_RUN。本地契约预检 PASS（FROZEN 133/133）；候选用例：`WorkPacketContract.read_time_and_successful_observation_are_separate`、`failed_last_observation_never_reads_as_success`、`S1Handoff.sync_and_observation_are_different_facts`、`WidgetHandoff.observation_time_and_sync_time_never_stand_in_for_each_other`。
- **恢复条件/分支**：隔离库合成三态 mission（见 BACKEND_READBACK_PLAN.md），设备在线后逐项打开；不得用真实用户数据。

## D-HO-01 有效卡片冷启动/热启动进入原问题

- **前置**：signed 候选；桌面卡片存在且未过期（有 pending question 的 mission）；系统卡片已刷新。
- **步骤**：冷启动（进程被杀后点卡片）与热启动（后台→点卡片）各一次；进入后核对 mission/question。
- **期望**：重新鉴权；核对当前对象；打开原问题而非同义新任务；无重复任务；卡片信息与详情同一 missionId。
- **所需证据**：冷/热启动两次录屏或截图序列；`EntryAbility` Want 日志/时间；卡片内容与详情截图；候选 HAP hash。
- **当前状态**：设备 NOT_RUN（依赖系统 Want 投递与卡片，模拟器/真机都必须实机验证）。本地契约预检 PASS（FROZEN 133/133）；候选用例：`S1Handoff.card_opens_the_original_question_not_a_similar_task`、`WidgetHandoff.valid_handoff_keeps_exact_question_and_approval_identity`。
- **恢复条件/分支**：signed 候选 + 稳定设备（真机优先；模拟器仅签收模拟器）；冷/热启动分开记录。

## D-HO-02 FS-D01：卡片仍有效但审批已替代/版本已变

- **前置**：signed 候选；卡片指向旧审批/旧版本，服务端审批已替代、missionVersion 前进。
- **步骤**：点旧卡片进入；核对是否自动选中/批准旧提案；查看提示与可处理对象。
- **期望**：不自动批准旧对象；回当前委托并提示重新核对；旧卡片版本只作历史定位线索（FS-D01 语义待 A/D 明确，但两种选择都不得自动批准已替代提案）。
- **所需证据**：服务端版本/审批状态时间线；设备截图（提示+当前待处理对象）；native 用例输出。
- **当前状态**：设备 NOT_RUN。本地契约预检 PASS（FROZEN 133/133）；候选用例：`S1Handoff.stale_queued_intent_does_not_open_old_question`、`WorkPacketContract.version_advanced_snapshot_blocks_reusing_old_requires`。
- **恢复条件/分支**：signed 候选 + 设备 + 可造旧卡片的隔离数据；E 以旧版本负例独立签收。

## D-TTL-01 不新增事件，停留跨过 expiresAt（含等于边界）

- **前置**：signed 候选；卡片 `expiresAt` 已设置；期间不产生新事件；系统不主动刷新卡片。
- **步骤**：等待跨过 expiresAt（含恰好等于边界的时刻）再打开卡片/详情。
- **期望**：旧缓存不能再作为当前可用内容；打开后重新核对当前状态；不把过期卡片当"无变化"证据。
- **所需证据**：expiresAt 值、打开时刻（UTC+8，含边界秒）、卡片/详情截图、读回时间戳。
- **当前状态**：设备 NOT_RUN（系统刷新与无事件 TTL 必须实机）。本地契约预检 PASS（FROZEN 133/133）；候选用例：`WidgetHandoff.card_ttl_and_session_expiry_take_the_earlier_boundary`、`expired_card_is_not_offered_as_current_content`、`expired_handoff_keeps_mission_identity_but_not_old_question_entry`。
- **恢复条件/分支**：signed 候选 + 设备；边界样本至少两次（早于/等于 expiresAt）；不通过改系统时钟伪造，若需时间注入必须单独记账。

## D-TTL-02 登录等待跨过卡片期限；断网再打开

- **前置**：signed 候选；卡片过期；登录会话过期或断网。
- **步骤**：退出登录→等待过期→点击旧卡片；断网再打开同一入口。
- **期望**：不打开旧问题执行入口；保持原 Mission 身份；解释未核对（UNAVAILABLE/需重核），不显示成功或无变化。
- **所需证据**：断网/过期操作日志（时间、操作）；页面截图；native 用例输出。
- **当前状态**：设备 NOT_RUN。本地契约预检 PASS（FROZEN 133/133）；候选用例：`WidgetHandoff.expired_handoff_keeps_mission_identity_but_not_old_question_entry`、`S1Handoff.stale_queued_intent_does_not_open_old_question`。
- **恢复条件/分支**：signed 候选 + 设备；断网用系统飞行模式/关网并记录；不得清 App 数据绕过。

## D-ACC-01 A 账号请求在途→退出→B 登录→旧响应到达

- **前置**：signed 候选；两个合成账号 A/B（同一隔离库、合成数据）；A 的 readback/写请求在途（可注入延迟）。
- **步骤**：A 发起请求 → 立即退出 → B 登录 → 旧响应到达 → 查看页面与卡片。
- **期望**：B 页面/卡片没有 A 内容；旧写入与刷新被栅栏拒绝；旧响应不重新填回页面。
- **所需证据**：accounts/会话时间线；请求开始/到达/拒绝时间；页面截图；native/服务端日志（session generation）。
- **当前状态**：设备 NOT_RUN。本地契约预检 PASS（FROZEN 133/133）；候选用例：`ReentryMapping.project widget rejects another owner and unowned legacy cache`、`project widget rejects logout and expired or unknown session lifetime`、`AuthContract.session_store_expired_broadcast`。
- **恢复条件/分支**：signed 候选 + 设备 + 隔离库双账号；服务端越权仍以服务拒绝为准，不以 UI 禁用代替。

## D-REC-01 原批准/补料响应丢失、重试

- **前置**：signed 候选；可控网络（丢回包/超时）或服务端注入失败；请求带 requestId/expectedVersion。
- **步骤**：提交批准/补料 → 丢弃响应 → 用同 requestId 重试 → 核对服务端业务结果数量。
- **期望**：同 requestId 查原回执；业务结果只一份；不生成第二个操作；超时/UNKNOWN 查询原请求与回执。
- **所需证据**：两次请求的 requestId/时间/响应；服务端回执记录；页面截图；native 用例输出。
- **当前状态**：设备 NOT_RUN。本地契约预检 PASS（FROZEN 133/133）；候选用例：`MissionContract.event_cursor_merge_is_ordered_and_idempotent`、`RepoSignalContract.action_bodies_carry_request_ids`（服务端 commandReplay 幂等为对照，属集成/服务题）。
- **恢复条件/分支**：signed 候选 + 设备 + 丢包注入；不得用 UI 禁用替代服务端幂等验证。

## D-SRC-01 展开证据时原来源撤回或修订

- **前置**：signed 候选；证据展开时来源被撤回/修订（隔离库合成 capture/attachment 修订）。
- **步骤**：打开证据正文 → 在另一入口撤回/修订来源 → 回看已展开正文与引用。
- **期望**：不拼接新旧正文；旧正文不保留为当前依据；保留历史事实但明确当前不可用/需重核。
- **所需证据**：来源修订前后版本与许可状态；页面截图；读回 JSON 的 revisionAvailability/currentUse；native 用例输出。
- **当前状态**：设备 NOT_RUN。本地契约预检 PASS（FROZEN 133/133）；候选用例：`S2Coverage.same_material_id_new_revision_invalidates_original_pages`、`S2Coverage.pagination_must_match_the_material_version_not_only_its_id`、`WorkPacketContract.source_current_use_suppressed_is_not_available_or_independent`、`unavailable_material_without_excerpt_keeps_history_facts`。
- **恢复条件/分支**：signed 候选 + 设备 + 隔离库来源修订夹具；与 A 服务合同一致后执行。

## D-UI-01 中文输入法、大字、长标题、键盘、Sheet、系统返回

- **前置**：signed 候选；设备系统语言中文；输入法可用；大字号设置；长标题/长文本样本；Sheet 场景。
- **步骤**：逐项设置（大字号/长标题/键盘弹出）→ 操作主流程（回答/批准/Sheet/系统返回）→ 记录遮挡与草稿恢复。
- **期望**：主操作可达；无键盘遮挡；草稿可恢复；无遮挡或误提交；系统返回回到正确位置。
- **所需证据**：设置项截图 + 每场景截图/录屏；设备类型/API/时间；候选 HAP hash。
- **当前状态**：设备 NOT_RUN（纯 UI 设备行为，无 native 替代）。本地契约预检 PASS（FROZEN 133/133）（仅能覆盖文案/布局常量的非视觉部分；不足以签收 UI）。
- **恢复条件/分支**：signed 候选 + 稳定设备（真机优先）；模拟器仅签收模拟器。中文输入法/大字号必须真实系统设置。

## E-HAP-01（FS-E01）unsigned/signed 同时存在及旧 signed 残留

- **前置**：候选构建目录内同时存在 unsigned 与（旧）signed；`scripts/harmony-build.ts` 默认优先打印 unsigned。
- **步骤**：核对 `outputs/default/` 全部 HAP 的路径/mtime/SHA-256；显式选择**本候选** signed；用 SDK `hap-sign-tool.jar` 核验；记录非敏感签名身份；安装对象绑定。
- **期望**：不接受默认文件名或构建脚本默认打印的 unsigned hash 推断 signed；旧 signed 不冒充新候选；signed 路径/mtime/hash/身份四者绑定同一候选。
- **所需证据**：目录清单 + 每个 HAP 的 hash/mtime + 签名验证输出 + 签名配置（非敏感身份）+ 安装日志。
- **当前状态**：NOT_RUN——FROZEN 候选构建（15:15:56–15:20:42）后 `outputs/default/` 实测唯一 HAP 为 `entry-default-unsigned.hap`（**8,273,912 bytes / 2026-11-03T15:20:40.808+08:00 / SHA-256 `9c935302a720a34c2cf845f9a0528806d502f23364f07788650d0e9020164629`**），**无 signed 产物**；构建日志再次出现 `WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured...`；配置侧确认 `signingConfigs: []`。历史旧 unsigned（8,047,574B / 11:18:09 / `2d64b3da…ed2f`，485d485 准备期产物）已被本次构建同名覆盖，旧 hash 仅留作历史记录，不作为候选证据。
- **恢复条件/分支**：用户配置受权签名或用授权 signingConfig 重建 → 出现 signed 产物 → 按上述步骤显式核验（比对 FROZEN_SNAPSHOT 的 `source_tree_digest`，确认 signed 与 unsigned 属于同一候选源码）；E 独立复算。FS-E01 脚本源码风险已确认，修复由主控分派，D3 不改公共脚本。

---

## 通用前置与证据规范（所有设备用例）

1. **候选绑定**：每个证据必须带候选源码 SHA（git HEAD + dirty 文件清单/hash）、HAP 路径、size、SHA-256、mtime（UTC+8）。unsigned 只作工程证据，不进入签名/设备 PASS。
2. **设备记账**：设备类型（模拟器/真机）、型号、OS/API、abi、连接方式（TCP/UDP/UART）；模拟器通过只签收模拟器。
3. **时间**：所有操作记录 UTC+8 时间戳；TTL/过期边界记录精确到秒并注明早于/等于/晚于。
4. **数据边界**：只用 `prisma/final-preparation.db` 隔离库的合成数据；不碰用户真实库，不 seed 用户数据，不调用模型（mock）。
5. **禁止替代**：native 测试、unsigned 构建、模拟器、Web 预览、历史 109 项与旧截图均不能替代本矩阵的设备 PASS。
6. **恢复后执行顺序**：FROZEN → `harmony:test`（本地契约预检）→ `harmony:build`（unsigned 工程证据）→ 受权签名 → signed 核验 → 设备安装 → D-WP-01…D-UI-01 → E 独立签收。

