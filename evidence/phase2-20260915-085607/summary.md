# ProjectMemo Phase 2 evidence — 2026-09-15

本目录记录第一阶段复审修复和第二阶段 B1–B4 的本地验证。所有写入测试使用独立 SQLite；未运行 seed/demo-reset 清空开发库，未使用聊天中的 API Key，未部署、推送或上传。

## 第一阶段复审

- 复审提交：`97db547 review(phase1): verify and scope capture idempotency`。
- A1/A2/A3 的关键行为回归通过。复审发现并修复 A1 的跨项目 requestId 冲突：`AgentRun` 的全局唯一外部请求键改为以 `projectId` 命名空间化，同时保留 Capture 的项目内幂等约束和原始 requestId 追踪。
- 设备/交付阻断仍真实存在：当前没有可用 `hdc` 命令/设备目标，`harmonyos/build-profile.json5` 的 `signingConfigs` 为空，`Constants.ets` 的 `REVIEW_BASE_URL` 为空且构建 flavor 仍为 development。

## 第二阶段实现覆盖

- B1：统一 `CURRENT/SUPERSEDED/CONTESTED/UNKNOWN` 与 reason/evidence refs；Web、搜索、问答、快照、简报、成果审计和鸿蒙记忆/归档路径复用时态账本。
- B2：新增项目状态 freshness 持久回执；业务写入后的补偿刷新、失败保留旧快照、并发刷新收敛、规则版本隔离、A→B→A 历史和单调已了解游标。
- B3：新增持久预算账本、项目级偏好和通知发布回执；预算/反馈/曝光/系统通知分开计量，反馈与通知回执同键幂等，已发布回执不会被失败重试降级。
- B4：主动提醒接受以 `dedupeKey` 原子去重；变化简报保留字段、观察时间和内容哈希，证据导航打开准确卡片；会议和依赖路径继续复用 A2/A3 的冲突与当前状态校验。
- 增量迁移：`20260915080000_phase2_consistency`、`20260915084500_notification_delivery_receipt`。

## 验证结果

| 检查 | 退出码 | 结果 |
|---|---:|---|
| A1–A3/B1–B4 针对性回归（7 files） | 0 | 62 tests passed |
| `npm.cmd test` | 0 | 30 files / 225 tests passed |
| `npm.cmd exec tsc -- --noEmit` | 0 | passed |
| `npm.cmd run lint` | 0 | 0 errors；7 warnings，均为既有 warning |
| `npm.cmd run build` | 0 | Next.js production build passed；保留既有 NFT whole-project trace warning |
| `npm.cmd run test:e2e` | 0 | isolated database and production E2E passed |
| `npm.cmd run harmony:test` | 0 | 27/27 passed |
| `npm.cmd run harmony:build` | 0 | unsigned HAP built；2,697,157 bytes；SHA-256 `148182cf6e30fb34f55321a2987cf47290052be16e1ee45d649fc78e4720c27c` |

## 迁移与边界验证

- 空库重放：预创建的独立空 SQLite 文件从 0 个业务表开始，16 个迁移全部成功，包含两个本轮迁移；新增表和 `ActionItem.dedupeKey` 已检查。
- 旧库升级：独立副本先应用前 14 个迁移，再用当前迁移目录增量应用两个本轮迁移，最终 16 个迁移全部成功；未接触开发库。
- 设备、签名、评审网络和托管：未验收。没有设备安装/启动/重启、真实评审地址、最终签名 HAP、公开访问控制、备份恢复或平台提交证据。

## Deviations

1. 本机 Prisma schema engine 对不存在的 SQLite 文件返回空错误；迁移验证因此先创建明确的零字节临时数据库文件，再执行 `migrate deploy`。数据库在部署前为空，验证仍覆盖空库重放和旧库副本增量升级。
2. `InterventionDelivery.PUBLISHED` 的口径是系统通知 API 接受发布，不等同于用户实际看到；实际曝光仍由独立曝光接口记录。
3. 未提供真实评审后端地址和签名材料；只验证配置校验、开发 flavor、本地单测和 unsigned HAP 构建，不宣称可提交复赛。
