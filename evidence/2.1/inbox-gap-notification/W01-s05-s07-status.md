# W01 S05–S07 状态回执

日期：2026-08-27

## S05 Inbox

状态：`PARTIAL`

- 鸿蒙端已有图片 Picker、PDF Picker、multipart 上传、真实提取状态显示和失败重试入口。
- Backend 已覆盖 MIME/魔数校验、大小边界、去重、异常清理、PDF 文本提取和 `NEEDS_OCR` 真实状态。
- 本地 `tests/attachment.test.ts` 当前覆盖 2 个测试：不可读 PDF 如实保留并去重、可执行文件拒绝；这不是计划要求的图片 5 份 + PDF 5 份模拟器样例，因此不计为完整 Gate。
- Vision/OCR 在当前模拟器条件下不宣称通过。扫描 PDF 应保持 `NEEDS_OCR`，不由客户端生成记忆。

## S06 Deliverable Gap

状态：`PARTIAL`（本地规则回归通过，App 运行矩阵未完成）

- `tests/deliverableGap.test.ts` 包含 30 个规则表格 case，另有 2 个集成场景；覆盖未确认 evidence、错误类型、重复项、顺序、Unicode 和无计划项目。
- `npm.cmd test` 全量通过；确认关系仍必须显式绑定对应 deliverable，未确认 evidence 不关闭 Gap。
- 计划要求的 10 次 App 操作和 Gap Accuracy 数据集，因 AVD 启动失败尚未形成运行回执。

## S07 Notification

状态：`BLOCKED`（运行环境）

- 代码已有 NotificationKit 权限检查、稳定通知 ID、WantAgent 项目/介入深链、去重更新、冷/热启动路由和 Snooze `deliveryTime` 重排。
- `harmonyos/entry/src/test/ApiContract.test.ets` 覆盖 Snooze 请求体契约；这不等同于系统通知运行验收。
- 目标 AVD 无法启动，`hdc list targets` 返回 `[Empty]`，因此权限允许/拒绝、重复触发、点击、冷/热启动、Snooze 和重启后调度均未宣称通过。
- App 内 Intervention 列表和详情仍是通知不可用时的保底入口；详细环境证据见 `../ui-matrix/W01-emulator-blocked.txt`。
