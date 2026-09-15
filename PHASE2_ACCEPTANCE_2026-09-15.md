# ProjectMemo 第一阶段复审与第二阶段验收

日期：2026-09-15
范围：第一阶段 A1/A2/A3 复审修复；第二阶段 B1/B2/B3/B4。
边界：未新增 Scheduling、GitHub/Calendar 连接器或 Memory Consolidation；未部署、推送远端、上传参赛材料或使用历史临时 API Key。

## 1. 第一阶段复审结论

复审不是对旧实施记录的照录，而是重新核对当前源码、测试和独立数据库证据。

| 批次 | 复审结果 | 证据与剩余限制 |
|---|---|---|
| A1 | 通过代码复审并修复一项阻断 | 发现 `AgentRun(provider, externalRequestId)` 的全局唯一约束会让不同项目复用同一 requestId 时发生错误冲突；`processCaptureWithRequest` 现以 `projectId:requestId` 命名空间化执行占位，同时保留原 requestId 追踪。并发、冲突、不同 ID、跨项目回归通过。设备录入和重启恢复仍未验收。 |
| A2 | 通过现有代码与回归 | 提案绑定、版本/hash/changeId、截止日期基线、事务内执行权和部分冲突回滚保持有效；鸿蒙 409 后交互未在设备验收。 |
| A3 | 通过现有代码与回归 | 最终依赖集合、版本校验、归属/自依赖/环路检查和当前数据评估保持有效；设备端编辑流程未验收。 |

复审提交已单独完成：`97db547 review(phase1): verify and scope capture idempotency`。

## 2. 第二阶段实际实现

### B1：Memory Lifecycle 一致性

- 在 `lib/memory/temporalLedger.ts` 建立统一顶层状态 `CURRENT/SUPERSEDED/CONTESTED/UNKNOWN`，保留细分 reason 和证据引用。
- 卡片、搜索、问答、项目快照、变化简报、成果审计、Web 展示和鸿蒙记忆/归档路径改用同一有效性规则；人工确认只表示确认来源/用户选择，不证明事实真实，`UNKNOWN` 不转成 `False`。
- 新增归档列表和恢复路径；归档不改变时态，恢复不复活已取代事实。来源修订、撤销、删除或待确认关系会重新评估当前结论，历史版本仍可定位。

### B2：Snapshot / Diff 与新鲜度

- 新增持久化 `ProjectStateFreshness`，记录 `FRESH/REFRESHING/STALE/FAILED`、失败原因和关联快照版本。
- 业务事实保存后由 `refreshProjectStateAfterMutation` 统一做写后补偿刷新；刷新失败保留旧快照并标记过期，避免假 0% 或诱导重复写入。项目目标、交付证据、时态关系等原先漏掉的入口已接入。
- 并发刷新按当前版本收敛；规则版本与业务变化分开；“已了解”只推进实际展示的快照，游标不倒退/跳过未读变化。首次、无变化、功能关闭、来源失效和请求失败都有明确状态。

### B3：预算、反馈和偏好闭环

- 新增持久 `InterventionBudgetLedger`、项目级 `InterventionPreference` 和通知 `InterventionDelivery` 回执。
- 预算使用条件更新实现并发扣减；项目偏好按项目隔离。FIRE、实际曝光、用户反馈和系统通知送达分别记录。
- 同键反馈和通知回执幂等；统计只采用最新明确反馈，延期/未曝光/无反馈不当作忽略。降频建议须用户确认、可撤销和恢复。`PUBLISHED` 只表示系统通知 API 接受发布，不表示用户已经看到。

### B4：简报、会议和行动交互

- 变化简报保留字段、观察时间、内容哈希和证据定位；无变化不编造进展，阅读简报不自动创建行动。
- 主动提醒接受用持久 `dedupeKey` 原子去重；会议确认和依赖编辑继续使用 A2/A3 的提案冲突、版本校验、最终集合和当前评估规则。
- Web 与鸿蒙模型、服务、状态面板、记忆时间线和变化简报字段已同步；设备端完整主线仍需真实设备验收。

## 3. 验证结果

| 检查 | 结果 |
|---|---|
| A1–A3/B1–B4 针对性回归 | 通过；7 files / 62 tests |
| `npm.cmd test` | 通过；30 files / 225 tests |
| `npm.cmd exec tsc -- --noEmit` | 通过 |
| `npm.cmd run lint` | 通过；0 errors，7 warnings，均为既有 warning |
| `npm.cmd run build` | 通过；Next.js production build；保留既有 NFT whole-project trace warning |
| `npm.cmd run test:e2e` | 通过；使用隔离数据库和 production server |
| `npm.cmd run harmony:test` | 通过；27/27 |
| `npm.cmd run harmony:build` | 通过；unsigned HAP，2,697,157 bytes，SHA-256 `148182cf6e30fb34f55321a2987cf47290052be16e1ee45d649fc78e4720c27c` |

## 4. 数据库和迁移

- 独立空 SQLite：预创建空文件后从 0 个业务表执行当前迁移，16 个迁移全部成功。
- 独立旧库副本：先应用前 14 个迁移，再应用本轮两个增量迁移，完成 14→16 升级；验证了 `ProjectStateFreshness`、`InterventionBudgetLedger`、`InterventionDelivery`、`InterventionPreference` 和 `ActionItem.dedupeKey`。
- 未对真实开发库运行 seed、demo-reset 或破坏性迁移。迁移和回归结果见 `evidence/phase2-20260915-085607/`。

## 5. 未关闭验收与 Deviations

1. `harmonyos/build-profile.json5` 的 `signingConfigs` 为空，当前 HAP 仅证明构建，不是最终签名交付包。
2. 当前环境无可用 `hdc` 命令/设备目标，未完成安装、启动、杀进程、重启和真实鸿蒙主线验收。
3. `Constants.ets` 中 `BUILD_FLAVOR` 仍为 development，使用模拟器地址 `http://10.0.2.2:4400`；`REVIEW_BASE_URL` 为空。没有编造评审域名，因此 SUB-01 和非开发网络验收保持 BLOCKED。
4. 未公开部署，未检查真实托管环境的访问控制、匿名写入边界、备份恢复和附件持久化；SUB-08 保持 NOT_RUN/BLOCKED。
5. 本机对不存在 SQLite 文件的 Prisma schema engine 返回空错误，迁移验证先创建零字节独立文件再执行部署；这不影响空库重放及旧库副本升级的范围结论。
6. `InterventionDelivery.PUBLISHED` 是系统发布接口接受的回执，不等同于实际曝光；原生通知可见性需设备验证。

实现提交：本文件随实现提交落盘；复审提交为 `97db547`，最终实现哈希以 Git 回执为准。
