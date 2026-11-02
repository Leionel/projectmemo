# S2 实施记录

起点 `24004cf91800635e179c651a0599a16e586019f8`，工作树 `D:/Projects/hongmen-s2`，分支 `codex/s2-product-enhancements`。用户在 S1 修复及指南完成后同意开始 S2。本阶段首先交付原第 5 节的结果/成本读回增量，不修改原执行器或计价账本。

## 第一批：原委托的进展依据和本次用量

用户是离开后回来核对委托的学生，想知道任务实际留下了什么、已知用了多少资源及费用为什么仍未知。原读回已有六类依据和 Action/resultCardId，原责任已有累计预算；费用字段固定 null，读回没有直接消费用量。鸿蒙还存在真实字段错配：后端发送 `reviewProgress.classes`，客户端读取 `divisions`，ApiClient 没有转换。

本批目标：在原结果页读回同一 Mission 的依据与累计计数，明确“已记录 token”及 UNKNOWN，不把缺失记录补零。缺少绑定费率/账单时继续报告不能核算费用。只读操作不改变目标、授权、预算、结果或执行状态；没有新增权限。范围仅当前 Mission 的已有累计计数，不合并所有项目、Intake 或独立 Conversation 的成本。

产品裁决（本地项目建议，不是平台强制规则）：

- 复用原读回中的内联展开，保留原 Action/成果跳转，不建新页：`rule/smallest-intervention`、`rule/inline-before-modal`。
- 缺失、未知、历史结果和不支持计价分别说明；不显示“总费用 0”：`rule/cover-reachable-states`。
- 修复鸿蒙真实 JSON 字段映射，避免用户已有结果区域不可用；保持原 token/session/generation 栅栏：`rule/preserve-mental-model`。
- 不用模型再写一次成果总结，不引入新调用、费率猜测或现实成效推断。成功信号是同一原回执＋累计计数两端一致，未知未被藏掉。

真实设备、计价覆盖、跨入口任务成本、分享和 Intents 仍沿原 S2 条件推进。

## 本批结果

业务提交 `6a9042396f3cbfaa2b2b5e83b977cf2720012d51`。复用 `/api/missions/:id/readback`，只增加 `resourceUsage` 投影；没有 schema、Runner、模型请求或外部写入。直接读原 `budgetUsedJson`，重复读取不重新按事件加总、不清零预算。非法/缺失 token 保持 null，已有 token 为 0 时保留 0；费用仍为 null/UNPRICED，明确未绑定费率和账单。

Web 入口：长期委托 → 执行详情与回执 → 本次用量。鸿蒙沿原结果与回执区域展开，不新增页面。新客户端把用量字段设为 optional，旧后端无该字段时继续读原结果；`reviewProgress` 改为消费后端已有的 `classes`，不保留另一套别名。

| 验证 | 结果 | 边界 |
|---|---|---|
| 定向单元/集成 | 4 文件 / 28 项通过 | 原鉴权与读回、重复读取无业务写入、未知费用、Web 展开与原接续回归 |
| 类型/lint | 退出 0；9 条既有 warning | 未添加 ignore |
| Web 生产构建及任务纵向 E2E | setup 1＋业务 1 通过，0 跳过/失败/flaky，retries=0 | 原任务创建→问题→材料→批准→成果→用量→再次复用，属于定向旅程；没有声称 S2 全量 E2E 已跑 |
| Web 1280 / 390 | 已生成并查看截图，390 无水平溢出 | 桌面元素截图上边缘受到原固定导航遮挡，不能当完整桌面页面验收；本批用量内容可见 |
| 鸿蒙单测 | 103 通过，0 失败/错误/忽略 | 新增实际 JSON 字段、未知价格、旧服务兼容合同；不等于设备 UI 操作 |
| HAP | unsigned 构建通过 | 7,914,013 字节；SHA-256 `31b69c6a4f11307d4abc083b401c0bad448e8d10e7bf7f838f3a51748a132e20`；未安装 |

证据：`evidence/s2-resource-readback/20261102/`。本批没有付费调用，没有部署、推送、合并 master 或迁移真实库。原主目录的三项 tracked 修改和其他 worktree 保留。

## 下一批与未完成范围

- 先补 Intake 实际材料覆盖提示，避免“上传 PDF＝模型已读全文”。原项目后续深读继续保留，不改成固定调查流程。
- 结果与成本包还需要绑定工具/模型版本和费率来源后才可估价；当前只交付可核查用量和未计价状态，不声称完整任务账单。Intake 与其他独立讨论的跨入口成本关联仍待后续沿原身份核对。
- 分享与 Intents 先做实际设备/注册探针；未拿到条件不开发伪入口。Personal/Adaptive 与失败改进继续检查原 PM 与样本同意 Gate，不能重复实现。
- 真实模型、设备与自然日轨继续按用户指南独立留证据。原 S1 全量检查不能替 S2 全量或这些真实轨签收。

本批设计采用 product-design 的 shape，Web 采用 ui-design 的既有样式增量实现，鸿蒙采用 harmonyos-design 的现有工程实现模式。读取了产品规则/判断/表面状态、Web aesthetic-direction/design-guidelines/general/typography/section-layout/colors；沿原 Token，无主题或动效重绘。
