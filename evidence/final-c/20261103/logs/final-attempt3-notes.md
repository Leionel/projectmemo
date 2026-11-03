# Track C Web 证据说明（EV2）

- 生成时间：2026-11-03T08:14:25.787Z → 2026-11-03T08:19:08.297Z
- 候选：codex/final-c-workspace-ux @ 2d61578（dirty=true）
- 环境：http://127.0.0.1:34112 · 隔离库 D:\Projects\hongmen-final-c-workspace-ux\prisma\final-preparation.db · provider=mock · 无 Worker
- fixture 身份：`evidence/final-c/20261103/fixture-identity.json`

## 检查汇总
- 检查：68，PASS 68，FAIL 0，NOT_RUN 0
- 退出码：0

## 用例
- 001-focus · 登录后进入 /focus（今日项目焦点，原 primaryContext 入口） · REAL_ISOLATED_DATABASE · 截图 4 张
  - request audit：业务写 0，页面内部 POST 4，外部域 0
- 002-waiting-user-detail · 原 Mission 详情：顶部四问可见 + 原问题主操作导航 · REAL_ISOLATED_DATABASE · 截图 6 张
  - request audit：业务写 1，页面内部 POST 1，外部域 0
- 003-basis-evidence · 依据 / 原文 / 纠正入口：来源 SUPPRESSED / CHANGED / UNKNOWN · REAL_ISOLATED_DATABASE · 截图 5 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 004-results-receipts · 结果与 Action/resultCardId 回执：显示身份与 fixture-identity.json 一致 · REAL_ISOLATED_DATABASE · 截图 4 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 005-keyboard-motion · 键盘 Tab 顺序、焦点返回与 prefers-reduced-motion · REAL_ISOLATED_DATABASE · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 006-legacy-missing-workpacket · 旧后端缺 workPacket：退回原详情、不构造默认成功事实 · INTERCEPTED_A2_SAMPLE（截获真实 A 样本 readback，非真实旧后端） · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 007-version-advanced · VERSION_ADVANCED：读回快照版本推进提示 · REAL_RESPONSE_MUTATED（真实隔离库响应 + 注入 snapshot.consistency=VERSION_ADVANCED，非真实并发推进） · 截图 2 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 008-409-authority-changed · 409 WORK_PACKET_AUTHORITY_CHANGED：读回失败提示且不自动沿用旧资格 · INTERCEPTED_RESPONSE（截获 409 + error.code=WORK_PACKET_AUTHORITY_CHANGED） · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 009-http-401 · 401 读回失败：确认私有缓存清空、不保留上一次结果 · INTERCEPTED_RESPONSE（先显示真实隔离库结果，再截获 401） · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 010-http-403 · 403 读回失败：确认私有缓存清空、不保留上一次结果 · INTERCEPTED_RESPONSE（先显示真实隔离库结果，再截获 403） · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 011-http-404 · 404 读回失败：确认私有缓存清空、不保留上一次结果 · INTERCEPTED_RESPONSE（先显示真实隔离库结果，再截获 404） · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 012-stopped · 停止在途（真实种子）：RUNNING + pauseRequestedAt · REAL_ISOLATED_DATABASE · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 013-cancelled · 取消（真实种子）：CANCELLED，不显示成功完成 · REAL_ISOLATED_DATABASE · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 014-terminal-unknown · UNKNOWN + 终态（真实种子）：终态与未结算效果并列 · REAL_ISOLATED_DATABASE · 截图 2 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 015-failed · 失败（真实种子）：为何停 / 复核原因 · REAL_ISOLATED_DATABASE · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 016-old-question · 旧问题（真实种子）：历史问题只读，不替换当前问题 · REAL_ISOLATED_DATABASE · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 017-old-approval · 旧审批（真实种子）：过期提案不能作为当前批准依据 · REAL_ISOLATED_DATABASE · 截图 1 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0
- 018-long-copy · 长文案 390（真实种子）：长标题项目 + 长问题 · REAL_ISOLATED_DATABASE · 截图 2 张
  - request audit：业务写 0，页面内部 POST 0，外部域 0

## 失败检查
（无）

## 发现（不修改产品源码，交 Lead 裁决）
- F-EV2-PAGE-COMPONENT-POSTS（INFO_RISK）读取页仍会触发既有 GoalQuestion 组件与焦点页锚点同步的写请求
  - 观察：pageComponentPosts=5 次（POST /api/projects/{id}/goal-question 的 PRESENT/EXPOSED 回执）；pageInternalPosts=5 次（POST /api/conversations/sync）。
  - 期望：合同严格要求读取页只 GET；这些写不是 Mission 业务命令、也不改委托状态，但严格口径下仍是写请求。
  - 分类：PRE_EXISTING_PAGE_BEHAVIOR：GoalQuestion 与 FocusAgentWorkspace 挂载行为，不属于 C1/C2/C3 本轮新增；未在本次修复（不改产品源码），由 Lead 裁决例外或后续修复。
  - 证据：logs/requests-*.json 的 pageComponentPosts/pageInternalPosts；components/GoalQuestion.tsx、components/FocusAgentWorkspace.tsx

## 实际回执身份
```json
{
  "receiptIdentity": {
    "outputId": "cmw0evuan000sf08om7wcq7i4",
    "receiptId": "cmw0evub4000yf08okaitr07s",
    "artifactId": "cmw0evub1000xf08o800w2rt6",
    "actionId": "cmw0evuaj000rf08ooi089pkc",
    "resultCardId": "cmw0evuag000qf08ofcfowu9z"
  },
  "actualReceiptHrefs": {
    "resultCardHrefs": [
      "/projects/cmw0evu760001f08obusvfrgj/knowledge#card-cmw0evuag000qf08ofcfowu9z",
      "/projects/cmw0evu760001f08obusvfrgj/knowledge#card-cmw0evuag000qf08ofcfowu9z"
    ],
    "actionHrefs": [
      "/projects/cmw0evu760001f08obusvfrgj/actions#action-cmw0evuaj000rf08ooi089pkc",
      "/projects/cmw0evu760001f08obusvfrgj/actions#action-cmw0evuaj000rf08ooi089pkc"
    ],
    "artifactHrefs": [
      "/projects/cmw0evu760001f08obusvfrgj/generate?artifact=cmw0evub1000xf08o800w2rt6&type=weekly_report"
    ]
  },
  "answeredQuestion": {
    "requestId": "8b52cc06-9f21-4e6e-ab1c-c1f52b43f5e4",
    "questionId": "cmw0evu8d0008f08o85t6q6k2",
    "expectedVersion": 1,
    "httpStatus": 202,
    "responseMission": {
      "id": "cmw0evu7p0005f08o178ka7rn",
      "status": "READY",
      "version": 2
    },
    "answerChars": 68
  }
}
```

## 请求审计分类
- EXPECTED_TEST_WRITE（主线回答原问题，只写隔离库）：1 次
- UNEXPECTED_C_INTERACTION_WRITE（读取页违规业务写，必须为 0）：0 次
- PRE_EXISTING_PAGE_BEHAVIOR（既有页面自动写，单列不计违规）：10 次
  - POST /api/projects/{id}/goal-question：POST http://127.0.0.1:34112/api/projects/{id}/goal-question×5
  - POST /api/conversations/sync：POST http://127.0.0.1:34112/api/conversations/sync×5
  - 依据：components/GoalQuestion.tsx 挂载 PRESENT/EXPOSED 回执；components/FocusAgentWorkspace.tsx 挂载锚点同步。
- 外部域请求（必须为 0）：0 次

## 证据方法和限制
- screenshots：所有应当展示工作包的截图前，显式等待 [data-mission-primary-action] 与“做到哪”可见；主题切换 reload 后重新等待，再重开依据 details 并等待“逐项依据与原文”；不以 reload 后立即截图。
- basisScope：依据截图在“逐项依据与原文”区域展开后拍摄；被抑制来源另拍元素级截图，要求“当前使用资格=当前许可已被撤回”和“修订状态=原修订匹配”两行同时可见。
- readbackVariants：VERSION_ADVANCED 用 Playwright route 对本会话所有 readback 响应生效并记录每次拦截体；409/401/403/404 为截获响应；旧后端缺 workPacket 使用 A2 真实序列化样本回填 readback，页面其它区域仍显示未截获的 /api/missions/:id 原详情真实事实。
- requestClassification：EXPECTED_TEST_WRITE（主线回答原问题，只写隔离库）/ PRE_EXISTING_PAGE_BEHAVIOR（GoalQuestion、FocusAgentWorkspace 挂载写）/ UNEXPECTED_C_INTERACTION_WRITE（应当为 0）/ externalRequests（应当为 0）。
- 迭代记录：iteration-1（候选 5b89ecf/e9f8be1 期间）：64 检查 / 60 PASS / 4 FAIL；失败为 goal-question 既有 POST 归类、legacy 断言跨区域、VERSION_ADVANCED 读取时机。日志保留 logs/capture-web-iteration1.log。
- 迭代记录：iteration-2（候选 21cb961 期间）：64 检查 / 62 PASS / 2 FAIL；legacy 误把“已独立支持”分类标签当成功语义、401 首次读取未等工作包渲染。日志保留 logs/capture-web-iteration2.log。
- 迭代记录：本次（final，候选 2d61578）：命令与退出码见 manifest.exitCode；fail=0。

## 数据来源与限制
- REAL_ISOLATED_DATABASE：真实隔离库种子状态（真实服务读回，不是截获）。
- INTERCEPTED_A2_SAMPLE：旧后端缺 workPacket 使用 A2 真实 JSON 样本 readback 截获，已标注非真实旧后端。
- REAL_RESPONSE_MUTATED / INTERCEPTED_RESPONSE：VERSION_ADVANCED、409、401/403/404 为截获变体。
- 浏览器无法证明服务端到 provider 的模型调用数；本环境 LLM_MODE=mock。
- 旧后端缺 workPacket 是 A2 真实序列化样本的截获响应，不是真实旧后端实例。
- VERSION_ADVANCED 与 409/401/403/404 是 Playwright route 截获变体，不是真实并发/真实权限变化。
- 浏览器无法证明服务端到 provider 的模型调用数；本环境为 mock。
- 未测试 Worker 执行、真实模型质量、真实用户数据与生产部署。

