# R3.4 独立审查与修复

范围：原生 Mission 模型/服务/详情页、原有登录与卡片调用方、小艺受限接续。独立审查代理只读，不实施修复。

1. 事件游标参数 `after` 与后端 `afterSeq` 不一致：已统一；真实 ArkTS 服务转译调用 Next 路由，125 条追加事件跨 100 条分页读回通过。
2. 401 清 token 先于页面 catch，导致旧私有内容留屏：增加会话失效监听，清空任务、候选、表单、草稿预览和审批；迟到读取也核对 generation/token。
3. 已归入外部资料的 Artifact 丢失 knowledgeClass：保留 EXTERNAL_REFERENCE/MIXED 并据此显示，不能升级为项目已验证事实。
4. 小艺授权快照与 resume 之间撤销许可竞态：将 READ_ANALYZE、LOW_RISK_READ_ANALYZE、模型上下文授权及预算检查移入原 Mission 命令事务锁。独立临时库复跑在快照后注入真实撤销命令，即使携带撤销后的版本，仍返回 XIAOYI_MISSION_APP_REQUIRED，任务保持 PAUSED/MANUAL，RESUME 事件为0。
5. Widget 退出与迟到 updateMission 交错复活旧摘要：先持久清认证，再清卡片；Mission 缓存更新排队并检查 generation、当前持久身份和过期时间。实际 ArkTS 转译加 Preferences/Form mock 复跑后，token、snapshot 和卡片 Mission 均为空，旧标题及行动变为登录引导。

两项原 P1 竞态探针独立复跑关闭。来源及会话修复已经源码复核。未使用真实模型、搜索、小艺平台或设备，源码转译和 mock 不替代设备验收。
