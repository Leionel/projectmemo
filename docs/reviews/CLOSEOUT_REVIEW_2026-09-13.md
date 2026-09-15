# E1–E7 本轮审查

基准：77342ff；本轮只审查，未修改业务代码。旧 evidence/acceptance-20260912/results.json 已有工作树修改，未覆盖；新探针与结果保存在 evidence/review-20260913/。

## 结论

上一轮核心修复有效，但不支持“七项代码验收全部 PASS”。E2、E4 有复现缺陷，E6 有队列丢失路径，E7 尚未实现证据对象定位；总状态继续 IN_PROGRESS 合理。

## 本轮验证

- npm.cmd test：28 文件 / 201 项通过。
- npm.cmd exec tsc -- --noEmit：退出码 0。
- 独立数据库重放全部迁移，运行新探针：goal A→B→A 最新正确为 A；CONTRADICTS 输出 UNKNOWN/CONFLICT；仅观察时间改变哈希稳定；未确认卡依赖输出 UNKNOWN。认可这四项修复。
- 本轮没有重新构建 HAP，也未进行模拟器/真机交互、小艺或用户验收，不把旧回执升级为新版本验证。

## 1. P1：连续修订制造伪冲突（E2 / M1）

位置：lib/services/attachmentService.ts:380。

每次纠错向该附件所有旧卡创建 SUPERSEDES。350→355→360 三次修订后，350 同时有 355 和 360 两个有效 superseder，现有 Ledger 将其判为 CONFLICT。

隔离探针已复现：第一版的 status/supportState 均为 CONFLICT，而预期是已被取代的历史。正常修订会污染时态、回执和依赖判断。

建议只取代当前有效修订前沿，形成线性链；或在 Ledger 中辨别同链祖先与真正分叉。补“连续三次修订后旧版本仍 SUPERSEDED”断言，不能仅测修订行数和 extractedText。

此外 existing/cards 与相同文本检查仍在事务外，尚未实现请求级幂等和原版本冲突校验；本轮未对并发纠错作故障注入，不将其作为实测重复写入结论。

## 2. P2：清空估时只清界面，数据没有清空（E4 / F1）

位置：harmonyos/entry/src/main/ets/components/ActionFeasibilityEditor.ets:150。

clear 分支发送 estimatedMinutes=undefined；ApiClient JSON.stringify 会删除该字段。后端以 undefined 表示“不修改”，随后界面却显示空字符串。

探针按同样序列化方式发送请求：先保存 90，再清空，服务器仍返回 90。应扩充 ArkTS 输入为可表达 null 的契约，清空显式发送 null，并验证重新进入仍为未估算。另避免 parseInt 将小数或混合文本静默截断为整数。

## 3. P2：跨项目切换会丢待上报曝光（E6 / B1）

位置：InterventionService.ets:32–59；app/api/projects/[id]/interventions/exposures/route.ts:33–37。

客户端全局队列只存提醒 ID、不带项目。A 项目上报失败后切到 B，A 的 ID 被发送到 B 路由；后端忽略不属 B 的 ID 并返回成功，客户端随即清空全部队列，A 的待上报事件永久丢失。这是直接可达的代码路径，本轮未做设备断网操作。

修复：按 projectId/installationId 分区存事件，响应返回已确认 ID，只删除已确认项；未确认项继续保留。上报前按 API 的 100 条限制分批，避免合并后超过上限不断失败。

另外 installationId 当前仅校验/回传，未参与 recordFeedback 的去重身份；“列表加载即曝光”也不是用户确实看见。若保留近似口径，指标应命名为列表加载覆盖率，不据此宣称真实可见曝光有用率。

## 4. P2：证据点击丢弃实体 ID（E7 / C1）

位置：harmonyos/entry/src/main/ets/components/ProjectChangeBrief.ets:11,73。

数据有 entityId，但回调只传 entityKind，实际只能跳类别 Tab，无法定位具体证据，也无法对来源删除给出准确反馈。实施记录承认是页签级定位，但收尾计划明确要求打开具体来源，因此不能将该验收项标 PASS。

修复：回调保留 kind+id，打开对应详情或定位高亮；404 显示来源不可用并可返回简报。至少验证两个同类证据不会打开同一泛列表冒充命中。

## 完成度调整建议

| 项 | 本轮判断 |
|---|---|
| S1 / E1 | 四项历史问题复测通过；本轮未穷尽并发、迁移兼容和设备矩阵 |
| M1 / E2 | 原子保存已有改善；连续修订语义失败，代码验收应重新打开 |
| R1 / E3 | 模板 claim 映射、模型未核验与旧成果边界已实现；本轮未独立遍历所有成果与手动编辑场景 |
| F1 / E4 | UNKNOWN 修复通过、编辑入口存在；清空估时失败 |
| T1 / E5 | 会议导入 UI 已存在；本轮未做交互验收，不宣称完整通过 |
| B1 / E6 | 上报链路存在；队列与指标身份口径待修 |
| C1 / E7 | 简报已有证据控件；具体对象定位未完成 |

修复顺序建议：连续修订 → 清空估时 → 曝光队列 → 证据定位；再做设备矩阵。交接文档尾部仍写“从 T1 界面与 B1 上报开始补齐”，需改为当前具体失败项，避免下一轮重复施工。

HAP 签名、评审后端与安装验收继续独立处理；本轮没有新的通过证据。报告是有界审查，不表示未列出的代码均无问题。
