# Track C Web 证据说明（EV2）

- 生成时间：2026-11-03T07:45:53.068Z → 2026-11-03T07:50:24.991Z
- 候选：codex/final-c-workspace-ux @ 21cb961（dirty=true）
- 环境：http://127.0.0.1:34112 · 隔离库 D:\Projects\hongmen-final-c-workspace-ux\prisma\final-preparation.db · provider=mock · 无 Worker
- fixture 身份：`evidence/final-c/20261103/fixture-identity.json`

## 检查汇总
- 检查：64，PASS 62，FAIL 2，NOT_RUN 0
- 退出码：1

## 用例
- 001-focus · 登录后进入 /focus（今日项目焦点，原 primaryContext 入口） · REAL_ISOLATED_DATABASE · 截图 4 张
  - request audit：业务写 0，页面内部 POST 3，外部域 0
- 002-waiting-user-detail · 原 Mission 详情：顶部四问可见 + 原问题主操作导航 · REAL_ISOLATED_DATABASE · 截图 6 张
  - request audit：业务写 1，页面内部 POST 0，外部域 0
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
- [006-legacy-missing-workpacket] abnormal.legacy.noFakeSuccess：{"message":"旧后端缺工作包时读回区域出现成功语义：/已独立支持/"}
- [009-http-401] abnormal.401.privateLoaded：{"message":"首次读取没有拿到私有回执内容"}

## 发现（不修改产品源码，交 Lead 裁决）
- F-EV2-PAGE-COMPONENT-POSTS（INFO_RISK）读取页仍会触发既有 GoalQuestion 组件的呈现/曝光回执 POST
  - 观察：共 5 次 POST /api/projects/{id}/goal-question（PRESENT/EXPOSED 遥测回执）。
  - 期望：合同要求的读取页“只 GET、无业务写 POST”是严格口径；该 POST 不是 Mission 业务命令，也不改委托状态，但仍是写请求。
  - 分类：既有产品组件行为，不属于 C1/C2/C3 本轮新增；未在本次修复（不改产品源码），由 Lead 决定是否裁决为例外或安排后续修复。
  - 证据：logs/requests-*.json 的 pageComponentPosts 与各 case requestAudit

## 实际回执身份
```json
{
  "receiptIdentity": {
    "outputId": "cmw0dv8o7000sys8ouyw7xfa6",
    "receiptId": "cmw0dv8p7000yys8oiahgg8sv",
    "artifactId": "cmw0dv8p2000xys8o06j2ice7",
    "actionId": "cmw0dv8o2000rys8oc3t2tsgx",
    "resultCardId": "cmw0dv8nx000qys8o37utpv4x"
  },
  "actualReceiptHrefs": {
    "resultCardHrefs": [
      "/projects/cmw0dv8ja0001ys8o56d7s65c/knowledge#card-cmw0dv8nx000qys8o37utpv4x",
      "/projects/cmw0dv8ja0001ys8o56d7s65c/knowledge#card-cmw0dv8nx000qys8o37utpv4x"
    ],
    "actionHrefs": [
      "/projects/cmw0dv8ja0001ys8o56d7s65c/actions#action-cmw0dv8o2000rys8oc3t2tsgx",
      "/projects/cmw0dv8ja0001ys8o56d7s65c/actions#action-cmw0dv8o2000rys8oc3t2tsgx"
    ],
    "artifactHrefs": [
      "/projects/cmw0dv8ja0001ys8o56d7s65c/generate?artifact=cmw0dv8p2000xys8o06j2ice7&type=weekly_report"
    ]
  },
  "answeredQuestion": {
    "requestId": "6b266583-0788-4606-a842-c08473cc071c",
    "questionId": "cmw0dv8kx0008ys8ons8g1pyy",
    "expectedVersion": 1,
    "httpStatus": 202,
    "responseMission": {
      "id": "cmw0dv8k40005ys8owcp79k3s",
      "status": "READY",
      "version": 2
    },
    "answerChars": 68
  }
}
```

## 数据来源与限制
- REAL_ISOLATED_DATABASE：真实隔离库种子状态（真实服务读回，不是截获）。
- INTERCEPTED_A2_SAMPLE：旧后端缺 workPacket 使用 A2 真实 JSON 样本 readback 截获，已标注非真实旧后端。
- REAL_RESPONSE_MUTATED / INTERCEPTED_RESPONSE：VERSION_ADVANCED、409、401/403/404 为截获变体。
- 浏览器无法证明服务端到 provider 的模型调用数；本环境 LLM_MODE=mock。
- 旧后端缺 workPacket 是 A2 真实序列化样本的截获响应，不是真实旧后端实例。
- VERSION_ADVANCED 与 409/401/403/404 是 Playwright route 截获变体，不是真实并发/真实权限变化。
- 浏览器无法证明服务端到 provider 的模型调用数；本环境为 mock。
- 未测试 Worker 执行、真实模型质量、真实用户数据与生产部署。

