# P2 生产验收核对（2026-10-24）

站点：https://project.luojiatutor.xyz，账号：复赛演示账号 contest-demo（本人数据）。验收动作按 deploy/alibaba-cloud-linux/P2_UPDATE.md 的"更新后核对"清单执行；未触碰其他用户数据，未运行 seed/reset。

## 结论

- **health.release**：`d618f8c37a91ab11e3bc073a4da3964aa46d4655`（= 本地 HEAD，含 P2 全部代码的部署修复提交）。capabilities 四项在列。
- **链路A 方案对比/采用/同Mission回执读回：通过**。
  - 演示 Mission `cmvhu98tl…`（人工智能创意赛项目）：规则模式生成方案（requestModelAdvice=false，零模型调用）→ BASELINE/VERIFY_FIRST/DELIVER_FIRST 三案 READY。
  - 采用 VERIFY_FIRST：planRevision 1→2、missionVersion 17→18（adopt.json）。
  - GET 读回：status=CONFIRMED、stale=false、receipt 与采用回执完全一致（readback.json）。
  - 同 requestId 重放：返回同一回执，无重复推进（replay.json）。
- **链路B 影响链：端点正常**。`/api/projects/{id}/impact` 返回 schemaVersion=1、coverage COMPLETE、空 rootIds（当前演示数据无待处理影响，impact.json）。"来源变化使旧预览409"需制造来源变化，未在生产执行；该行为由 P2 本地浏览器验收覆盖（evidence/p2）。
- **链路C 问题恢复：当前演示数据不可测**。两个项目 goal-question 返回 NO_ACTIONABLE_QUESTION / 焦点指向 PAUSED 委托；"不知道/稍后/停止/恢复"链路由 P2 本地浏览器验收覆盖。未为验收在生产制造新委托或影响。
- **链路D 隔离：通过**。无效/不存在方案 id → 404；未认证 → 401。

## 对生产演示数据的实际改动

仅在演示账号自己的数据上：新建一条方案提案并采用（Mission `cmvhu98tl` planRevision 1→2）。这是 P2_UPDATE.md 核对清单的预期动作，未回滚。

## 原始文件

create.txt/create.json（生成）、adopt.json（采用回执）、readback.json（GET 读回）、replay.json（幂等重放）、impact.json（影响评估）、goal-question.json（问题空态）。未保存任何令牌或密钥。
