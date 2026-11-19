# V2 持续运行复查修复

基线：`191cc0c`；工作树：`D:/Projects/hongmen-worktrees/v2-first-loop`。本切片修复复查发现的问题，M2 材料闭环另记回执。

| 复现问题 | 修复与兼容性 |
|---|---|
| Worker 启动用新版本，10 秒心跳重新写成旧版本 | 心跳复用同一能力版本常量；子进程测试等待真实心跳更新 |
| 尚无 V2 行时，检查器允许没有可用 Worker 的环境启用 V2 | 启用即检查进程存活、近期心跳、能力版本和含 V2 开关的环境身份 |
| 关闭 V2 后，存在 V2 行会中止整个新 Worker | 新 Worker 警告并继续认领 V1；V2 认领与清理仍被过滤。旧 Worker 二进制不能据此视为安全 |
| 停用来源后，阶段成果的检查项与未知项仍能泄露原文 | 读取时隐藏依赖已停用来源的元数据；保留原始持久成果 |
| 阶段成果接受不存在的引用与无来源观察段落 | 与报告版本共用段落、引用和项目事实校验 |
| 无关的“仍有未知”能覆盖遗漏的具体未知条件 | 确定性评分要求保留指定条件文本；同义改写仍需人工评审 |
| 两进程竞争测试可能测成两次合法顺序认领 | 用显式屏障保留胜者租约，等另一进程完成认领尝试后释放 |

工作台来源增加可选文件名及补充材料事件标签，均为附加字段；既有来源、AgentPresentation、旧 Mission 状态与工具权限保持原协议。

## 验证

```powershell
npm.cmd test -- tests/contentQuality.test.ts tests/v2WorkerLifecycle.test.ts tests/v2SkillArtifacts.test.ts tests/v2RuntimeReliability.test.ts tests/s0WorkerIdentity.test.ts
npm.cmd test -- tests/v2FaultInjection.test.ts
```

- 第一组 5 文件 / 24 条通过；故障注入 8 条通过。
- 日志：`evidence/v2-first-loop/m2-materials-20261117/review-fixes-final.log`；全量结果随 M2 回执记录。
- 无 Schema 或 Migration 改动；Schema/Migration 唯一负责人仍为 Codex 主代理。
- 使用独立合成 SQLite 与注入模型；本轮无付费模型调用、真实项目写入或部署。
- 生产滚动升级、真实 72 小时运行与旧 Worker 二进制混跑仍需专门验收；V2 默认关闭。
