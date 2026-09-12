# E6 收尾回执：B1 曝光上报与反馈分母

日期：2026-09-12。起点 HEAD `59724bc`。

## 改动

1. **曝光口径（明确记录的近似口径）**：提醒列表加载即计一次应用内曝光（channel=IN_APP），按 interventionId 幂等去重（复用 InterventionFeedback 唯一键，feedbackType=EXPOSED）。系统通知从未涉及，不产生任何"送达"语义。
2. **批量路由**：`POST /interventions/exposures`（installationId + interventionIds ≤100）；跨项目 id 忽略不打断；返回 exposed/duplicates。
3. **客户端**：InterventionService.list 加载后对 OPEN 非模拟提醒合并待上报队列（AppStorage，上限 100）异步上报；失败保留队列下次合并重试，不阻断用户接受/忽略。
4. 曝光不计入偏好建议统计（仅 IGNORED/ACCEPTED 参与），分母可复算：FIRE（决策日志）≠ 曝光（EXPOSED 反馈）≠ 反馈（ACCEPTED/SNOOZED/IGNORED）。

## 命令与退出码

- `npm.cmd exec tsc -- --noEmit` → 0
- `npm.cmd test` → 28 文件 / 201 测试全部通过，0（新增：曝光幂等/跨项目忽略/不污染建议统计）
- `npm.cmd run harmony:test` → BUILD SUCCESSFUL，27/27

## 状态

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| B1 | PASS | 尚未执行 | IN_PROGRESS |

## 剩余限制

- 50% 可见 + 1 秒停留的精确可见性采集未实现（ArkUI 可见性回调受限，按计划采用近似口径并在此明示）。
- 待上报队列为进程内 AppStorage，App 被杀后丢失（有界、可接受，如实记录）；未做 preferences 持久化。
- 设备矩阵（断网重试、快速返回）未执行。
