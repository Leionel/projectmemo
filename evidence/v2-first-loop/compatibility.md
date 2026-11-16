# Mission v2 调用方裁决与证据

基线检索清单见同目录五份call-sites与caller-inventory。检索包含实现、调用方、脚本、测试和文档；下表按拥有业务含义的入口归类。新字段默认1，v2与工作台均需显式开启。

| 入口 | 裁决 | 当前验证 |
| --- | --- | --- |
| contracts/modelAdapter/runner | v1仍3种Choice，JSON/native均拒绝await_event；仅持久化version=2协商4种。旧请求不插入默认字段，保留幂等hash | v2MissionProtocol、v2ModelProtocol、missionModelProtocol、missionNativeContract |
| finish/resultVerifier/release | v1仍SUCCEEDED；v2有界责任拒绝finish。checkpoint必须是当前创作游标、原验收器通过的本Mission Output；只释放槽，不写finishedAt或重置预算 | missionRuntime、v2MissionProtocol、v2FirstSlice |
| Worker/sourceSignals/continuationService | 原扫描器/租约继续使用；v2观察等待只由获准变化唤醒，用户问题不自动补答；关掉V2时扫描器跳过v2 | missionContinuation、v2FirstSlice、ux3ThreeDayContinuity |
| input/continuation/workService/GoalQuestion | OBSERVATION没有可回答questionId，拒绝旧输入，不回退历史问题 | v2MissionProtocol、agentUxJourney、missionPanel |
| waitNotice/attention/anchorService | 观察等待不发催答邮件，needsUser=false；关注锚点展示等待变化，拒绝旧SOURCE_ARRIVED冒充本轮问题 | missionWaitNotice、conversationAnchor、conversationAnchorContract、v2FirstSlice |
| WorkState/Focus/Workspace/HarmonyOS | 生命周期枚举不变，以WorkState区分等待用户/观察；修正Focus分组和Workspace待回应计数；原生可忽略新增字段 | agentUxWorkState、missionPanel、conversationAnchorContract、v2FirstSlice；尚未构建HAP/真机 |
| Directive/Responsibility/并发 | 明确V2指引在同一事务先失效旧代次再受限接续；旧绑定已过期/暂停/取消/授权扩大均不自动恢复；晚到模型结果不提交Output，原用量保留 | v2FirstSlice、ux3ResponsibilityRevision、continuityStages23、continuitySuppression |
| 持久层/Memory/Source | 只有协议版本列迁移；复用原来源指纹/有效性/抑制策略，不改Capture或历史快照 | v2MissionProtocol旧表升级/空库重放；continuitySuppression；workbench历史指纹读回 |
| decision review/impact/投影fallback | 保留原修订和人工审阅流程，原暂停/失败/终态不因checkpoint变成成功；仅展示用途的旧status字段保持兼容 | 原回归与19文件范围；未穷尽所有组合状态 |

最终回归命令与结果：final-regression.log（19文件174条）；构建build.log；四Skill部署追踪skill-trace.log；浏览器browser-check.log与browser/receipt.json。此前失败中间日志保存在history/，不作为当前验收结果。

数据全部为临时SQLite合成项目/注入模型或模拟HTTP。原工作树末次核对仍为1364项待提交、原HEAD不变，鸿蒙build-profile.json5 SHA256仍为28f5bf49f856a90287c46b1a67a710b93b145eedd68d802e197094db1341996c。
