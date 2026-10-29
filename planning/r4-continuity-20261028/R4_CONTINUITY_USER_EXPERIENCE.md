# Web / HarmonyOS 自然协作与生成式UI

## 1. 体验目标

用户可以自然改方向、纠错、接续，不必学习Intent/manifest/Runner。常态回答先讲判断；发生改变、冲突、交接或授权时，才显示能帮助决定的结构。主界面沿用原Focus与Conversation，不增“长期记忆管理平台”。

模型继续根据任务选择短文、证据、目标差距、比较、时间线和控制面板，决定顺序与强调；服务端只负责真实对象/版本/权限/状态和可用动作，不把所有回答排成同一套卡片。

## 2. 六种核心交互

| 场景 | 自然表达示例 | 交互及真实后果 |
|---|---|---|
| 改方向 | 用户：“这周先把演示稳住，先别加功能。” Agent：“这周先保演示稳定。我会围绕安装、启动和关键流程查阻碍；扩功能的旧建议已暂停采用。” | 明确唯一范围直接保存私人工作指令；一行新旧变化、适用至哪天、撤回。共享目标修改另有原预览，不挤在首屏。 |
| 纠正 | 用户：“52ms只是我说的，没有日志。” Agent：“明白，这项按你的报告记录，独立验证仍未完成。接下来先找同条件的原始日志。” | 绑定原结果解释，保存纠正；若日志确实写了不同数字，显示分歧而不覆盖原值。选择范围仅在有歧义时出现。 |
| 证据冲突 | “新页面写的是下届要求，本周交付仍适用旧版。当前先补安装回执。” | 证据对照有版次/生效期/页码；可继续查或保留计划。未经证实不宣布旧计划失败。 |
| 接续 | “上次停在设备验证。安装结果已保存，现在还等启动日志；原任务没有重跑。” | 原Mission/Action与等待对象；“查看已得结果”“继续查缺口”。只有许可、预算和工具都可用才显示可继续。 |
| 主动关注 | “当前提交的启动测试失败，会挡住周五演示。失败定位已整理，需要你选择修复范围。” | 原AttentionDecision说明为何现在提示；稍后/只放摘要/停止关注。Agent已经获准的只读调查仍可继续。 |
| 结果经验 | “这个补丁解决了启动失败；还没有覆盖离线流程。后续遇到同版本启动问题，我会优先读这份日志。” | 显示原结果与适用条件；查看源记录/不再参考。长期过程经验仍沿原SHADOW激活，不自动变成所有项目规则。 |

“已保存/已暂停采用/已开始”只能在服务端真实提交后出现。失败保留用户原句和草稿，显示实际状态；不以聊天文案补偿持久化失败。

## 3. DTO与控制命令

沿ConversationBlocks schemaVersion 1增加可选 `continuity?: ContinuityProjectionV1`；原content/refs/presentation继续存在。原十类semantic blocks继续使用。新增一个受限 `continuity` 语义块，内部panelKind为 `INTENT_CHANGE / CORRECTION / CONFLICT / HANDOFF / ATTENTION / OUTCOME`；避免六套独立动作系统。

新能力通过capabilities暴露 `continuityReadVersion`、`continuityControlsVersion`、`investigationDelegationAvailable`。客户端不支持时服务端给自然正文和原对象入口，关键判断/回执不丢失；不发送看似能点却无服务支持的按钮。

拟议完整示例（合成规划fixture，当前Zod尚未接入）：

```json
{
  "schemaVersion": 1,
  "projectionId": "fixture-continuity-01",
  "intentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "panels": [
    {
      "panelId": "intent-week-01",
      "panelKind": "INTENT_CHANGE",
      "state": "APPLIED",
      "statement": "本周先保证演示稳定，暂不增加功能",
      "scope": { "kind": "PROJECT", "projectId": "fixture-project-a" },
      "source": { "kind": "AUTHENTICATED_MESSAGE", "id": "fixture-user-message-03" },
      "effectiveUntil": "2026-11-02T00:00:00-08:00",
      "targetVersion": "directive-seq-3",
      "affected": [
        { "kind": "PROPOSAL", "id": "fixture-old-expansion", "state": "STALE" }
      ],
      "controlBindingIds": ["fixture-withdraw-03"]
    },
    {
      "panelId": "handoff-01",
      "panelKind": "HANDOFF",
      "state": "WAITING_USER",
      "nextActor": "USER",
      "statement": "安装结果已保存，还需补充启动日志",
      "originalRef": { "kind": "MISSION", "id": "fixture-mission-01", "projectId": "fixture-project-a" },
      "waitingFor": [{ "kind": "SOURCE", "description": "目标设备的启动日志" }],
      "lastOutcomeRef": { "kind": "ACTION_RESULT", "id": "fixture-result-card-01" },
      "verification": "REPORTED",
      "targetVersion": "mission-version-7",
      "controlBindingIds": ["fixture-open-result-01"]
    }
  ],
  "controls": [
    {
      "bindingId": "fixture-withdraw-03",
      "controlKind": "WITHDRAW_DIRECTIVE",
      "label": "撤回这次调整",
      "targetRef": "fixture-directive-03",
      "targetVersion": "directive-seq-3",
      "expectedContextHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "payloadHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "expiresAt": "2026-10-28T12:15:00-07:00",
      "enabled": true,
      "disabledReason": null
    },
    {
      "bindingId": "fixture-open-result-01",
      "controlKind": "OPEN_ORIGINAL",
      "label": "查看已保存结果",
      "targetRef": "fixture-result-card-01",
      "targetVersion": "result-revision-1",
      "expectedContextHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "payloadHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "expiresAt": "2026-10-28T12:15:00-07:00",
      "enabled": true,
      "disabledReason": null
    }
  ]
}
```

panel身份、日期、旧提案状态和controls均由服务端生成；模型仅选择真实panel catalog及展示位置、写简明解释。示例里的周截止日演示跨DST，实际使用用户政策/客户端明确时区，绝不复制固定日期。

现有AllowedAction的CONFIRM要求PROPOSAL和executionId，**不能把撤回指令伪装成原业务提案**。新增CONTROL分支或独立typed controls解析，`performConversationUIAction`按白名单交给指令/Anchor/原服务；客户端仅提交messageId、bindingId、requestId及版本，不提交任意payload/URL/动作名称。不同命令使用自身目标CAS，新的无关聊天消息不应无故使“停止关注”不可用。

## 4. 自然语言与UI状态机

```text
用户明确工作指令 → 认证/范围解析 → 实际APPLIED回执 + 就近撤回
有歧义的解释 → CANDIDATE → 只问影响决定的一项 → APPLIED / DECLINED
来源反驳 → CONTESTED → 原始证据调查 → 保持分歧 / 证据支持的修订
后台调查委托 → 具体范围/总预算预览 → 原确认 → RUNNABLE / WAITING / STOPPED
旧控件 → 重新绑定当前版本 → 可执行 / STALE解释 + 保留草稿
```

撤回不抹掉历史；撤回后展示当前真正生效的目标。已执行的业务操作仍显示原回执。用户说“撤回刚才改动”有多个候选时列最多必要的差异供选，不能猜测并撤销已经对外发送的内容。

后台运行展示真实阶段，例如“正在读这次提交的失败检查”“已比较两份规则，继续核对生效期”。无worker/权限/预算时如实显示等待原因；不显示假百分比或虚构工具日志。

## 5. Web与ArkTS落点

| 层 | 现有入口 | 实施要求 |
|---|---|---|
| 共享合同/绑定 | `lib/types/conversation.ts`、`agentExperience.ts`、`conversation/presentationRuntime.ts`、`uiActions.ts` | 可选DTO、catalog、控制命令hash/期限、旧消息可读；continuity refs单独typed scope，不伪造projectId |
| Web | `components/ConversationPanel.tsx`、`AgentMessageBlocks.tsx`、`ConversationWorkCard.tsx`、`ConversationAnchorPanel.tsx` | 同一会话原位差异/回执；复杂证据折叠；返回原项目/任务后保留草稿与定位 |
| HarmonyOS | `harmonyos/entry/src/main/ets/`下`models/Conversation.ets`、`services/ConversationService.ets`、`components/AgentMessageBlocks.ets`、`pages/FocusConversation.ets` | 相同JSON语义和绑定；底部sheet展示修改范围/证据；不照搬桌面双栏 |
| 草稿 | `lib/client/conversationDrafts.ts`、`ConversationDraftStore.ets` | 按user+conversation+object+control identity；新消息不重建整段表单；变更版本提示复核但不清空 |

首屏突出当前判断和一项主要操作；不重复“策略、约束、目标、意图”四种标签。小范围已生效回执通常一行即可；用户点开才看原话、期限和影响路径。

Web测桌面与360/390/430；ArkTS正文沿原约16fp、触控约44vp，长中文、深色、系统字体放大、输入法安全区、读屏标签和焦点返回必须验收。系统通知被接受发布、应用内未读、实际曝光和用户阅读继续分开。

## 6. UI验收反例

- 用户说“只这一次”，界面默认显示“长期记住”；失败。
- 仅模型输出了APPLIED，DB未提交却显示“已更新”；失败。
- 切到B项目仍套用A的限制或操作binding；失败。
- 旧意图版本的业务确认仍有效；失败。
- 新消息到达清空正在修改的纠正/结果草稿；失败。
- 旧客户端静默丢失关键冲突、只留下“已完成”；失败。
- 每次轻微偏好都再弹一次确认或每条回答固定六张卡；体验失败。
- 用户已批准持续调查，Agent仍每一步要求手动点工具，或无理由停在摘要；能力失败。

同一输入但不同证据/意图，应出现合理不同的合法布局；布局变化必须服务理解和行动，不以“块种类更多”作为生成式UI成功指标。
