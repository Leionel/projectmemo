# Claude 鸿蒙原型定向评审

评审基线：当前 master `e87b8ee`；原型 `prototypes/harmony-redesign-v1/index.html` 自述基于 `df2368b`。**视觉信息层次值得采用；执行设计需要更新到当前 R4 合同。** 不改变 CT-4 → CT-5 → CT-6 的既定实施顺序。

## 上下文卡

| 项 | 本次范围 |
|---|---|
| 目标设备与输入 | 原型为 360×760 手机框，触摸优先；平板、折叠、大字体及朗读未验收 |
| 主题 | HTML 有浅/深色变量；当前 ArkUI 已有 PMColors/PMSpacing 等 token |
| 任务 | 焦点 → 对话 → 原委托/行动/资料 → 确认 → 原回执 |
| 证据 | 原型 HTML、当前 ArkTS/服务代码、撤销采纳隔离库探针 |
| 边界 | 源码与静态方案评审，没有渲染后原型或目标设备验收；本次不修改原型或业务代码 |

规则 ID 对应 review-harmonyos-design 的十三项标准。以下均为 H4 项目证据和建议，属于 evergreen/foundation 或 project 层，不将样式偏好当作鸿蒙官方规范。

## Findings

| 优先级 | 规则 ID | 证据 | 问题 | 用户影响 | 建议 | ArkUI 落点 | 来源等级 | 置信度 |
|---|---|---|---|---|---|---|---|---|
| MAJOR | S08 状态真实 | HTML:399–405；FocusConversation.ets:257–258；types/agentExperience.ts:153 | 原型拟从首句和“尚未确认”标题推断结构，当前 R4 已有 prose/evidence/goal_gap/question/approval/receipt | 句式变化会丢失未知或动作，出现第二套展示解释 | 用原 HydratedBlock 表达层次；旧消息保持原文回退，不用首句生成权威结论 | AgentMessageBlocks、FocusConversation | H4 | 高 |
| MAJOR | S08 状态真实 | HTML:567–590；mission/modelAdapter.ts:12；MissionDetail.ets:445–465 | 通用“重试”和“改为本地整理”没有完整能力合同 | UNKNOWN/撤权/到期不能被当成格式错误；本地模式不能承诺继续真实模型委托 | 由服务端 recovery、许可和累计预算决定主操作；本地整理若实现，明确只整理已有资料 | MissionDetail、MissionInvestigationDelegation | H4 | 高 |
| MAJOR | S08 状态真实 | workspaceContextService.ts:110；mission/memorySearch.ts:40 | sourceTime 在原检索 assessment 中存在，工作空间桥接只带 observedAt | “后天 ddl”等旧记录仍可能被理解成当前时间 | 原样保留 createdAt/sourceTime/时区和适用期；另加展示日期，日期和状态码不只做中文替换 | 资料列表、引用详情、对话来源 DTO | H4 | 高 |
| MAJOR | S08 状态真实 | ProjectHome.ets:624；NotificationService.ets:119 | 进入项目会再 publish，isAlertOnce=false；原型提出的去重尚未实现 | 同一条高风险提醒反复打断 | 沿原个人策略、去重键和 Delivery 回执判断；新事实/新版本可重新评估，不永久静音整个主题 | NotificationService、ProjectHome | H4 | 高 |
| MAJOR | S08 状态真实 | sensing/repoSource.ts:225–267；隔离探针见下 | 原型要求“已撤销不可采纳”，当前服务端仍允许撤销连接的 CANDIDATE → ADOPTED | 前端收起不能保护资料写入；与撤回的用户预期不一致 | 采纳事务中核对连接归属、状态和版本；保留历史与合法幂等回执，拒绝新采纳 | RepoSignalPanel；服务端 actOnSignal | H4 | 高 |
| NOTE | S01 导航 | Index.ets:691；EntryAbility.ets:13–26；WidgetCard.ets:37 | 焦点内部值确为 4；targetTab 写入 AppStorage，Index 未消费 | 改一个数字仍不能修复入口路由 | 沿现有导航补消费、校验和设备跳转，不能仅凭 0–3 推定越界 | EntryAbility、Index、WidgetCard | H4 | 高 |
| NOTE | S11/S12 原型/无障碍 | HTML:138–158；页面中按钮、导航多为静态绘制 | 固定手机框、overflow:hidden 和静态控件无法验证真实滚动/大字体/操作面积 | 静态稿不能作为移动端交互放行证据 | 用现有 ArkUI 控件落地后验证滚动、键盘、朗读、深色和大字体 | 页面容器、PMButton、导航 | H4 | 高 |

## 九条意见的裁决

| 原意见 | 裁决 |
|---|---|
| 排期跨截止 | 四周与 11/15 的算术冲突成立。8–9 人日不是已核实工期；赛前收口线可与 R4 能力线分别记录，不能据此删除长期 Agent 目标。 |
| 故障分四类 | 采用“需要用户决定 / 可重试 / 服务不可用 / 未知”的方向。UNKNOWN 应保留核对路径，排序还要结合真实目标、时限、STOP/LATER 和个人打扰预算。 |
| 记忆时态与相对日期 | 采用；CURRENT 不等于独立核实。“有支持记录”仍应能展开支持来源、时间和冲突。不能只给模型一个翻译后的日期而丢失原时间坐标。 |
| 非竞赛准备项 | 采用。竞赛材料覆盖也不能改叫总体项目进度；原始数量、状态和回执口径保持一致。 |
| 通知去重 | 采用，但用事件/版本和回执去重。“只发一次”不能让重要变化永久不再提示。CT-3 私有任务默认无系统推送，不从 UI 改版扩授权。 |
| GitHub 分组与撤销 | 采用分组、列表和收起表单。撤销采纳检查是确定的业务缺陷；批量忽略应有逐项结果和幂等，不能只以一个成功 Toast 代表全批成功。 |
| 不取首句做项目目标 | 采用。自然语言解释可形成候选，持久目标变更继续走 Directive Admission/确认。 |
| targetTab=4 | 数值判断正确，消费链仍需补齐，不做盲目下标迁移。 |
| 判断接行动 | 采用可点的下一步。优先复用当前 actionBindings 与原提案；需要新模型解释时只生成待确认候选，点击不等于创建行动或扩大权限。 |

## 已复现的撤销采纳问题

在导入 db 前创建独立库，构造本用户的 REVOKED 连接和仍为 CANDIDATE 的信号，调用原 `actOnSignal(ADOPT)`：

```json
{"connectionStatus":"REVOKED","resultStatus":"ADOPTED","capturesCreated":1,"network":"NONE","data":"ISOLATED_SYNTHETIC"}
```

探针仅使用本地合成数据，未访问真实数据库或外部接口。它证明当前检查缺失，不证明 UI 已修复。原型和生产代码均未因本次评审改动。

## 影响与最小修复顺序

1. 先守住撤销采纳、旧时间、未知结果及恢复操作；共享服务改变同时核对 Web。
2. 把原 R4 blocks 套入这份稿的信息层次：主判断、可展开依据、真正待答问题、绑定原操作的按钮；不固定每次必须出现同一组模块。
3. 收紧项目卡、行动卡和仓库列表密度，隐藏演示数据；编辑/取消保留可发现入口，长按可以补充但不能作为唯一入口。
4. 接原 Attention/Delivery 做通知去重，再进行实际手机、深色、大字体、朗读、延迟/超时/乱序/双击/撤回和跨页恢复验收。

应保留的产品特征：项目语境、长期目标、真实来源、用户决定与回执。允许沿用当前绿色和暖背景；不额外套用统一玻璃、统一弹跳或装饰性信息标签。圆角和颜色一致不代表字体缩放、滚动与触控已经一致。

**结论：有条件通过。** 认可视觉方向；上述 Major 合同和设备证据关闭前，不作为整稿直接实施或发布依据。
