# CT-4 文档深读实施检查点 · 2026-10-29

分支 `codex/ct4-document-reader`，基于已合并的 master `e87b8ee`（R3 runtime、PR-6、CT-1/2/3）。Claude 原型评审另见 `docs/FINAL/AGENT_REVIEW/HARMONY_CLAUDE_PROTOTYPE_REVIEW_2026-10-29.md`，未实施整稿改版。

## 实际增量

- 原 Conversation Investigation 和 Mission Runner 增加 inspect_document、read_document_page/section/table；模型仍根据 GoalGap 动态决定下一工具。复用原 Turn/Step、lease/generation、预算、来源校验和待确认行动，没有新 Runner、记忆表或数据库迁移。
- 复用现有 Poppler，以固定参数和 stdin 读取原 PDF；保存文件哈希、附件修订、提取器版本、物理页及文本坐标。目录默认索引前100页，可指定后续单页；覆盖不完整明确返回。表格仅是文本布局候选，表头/跨页关系未经核对。校对文本没有物理页映射时拒绝伪造页码。
- 文档观察沿原附件来源传播 SUPPRESS_USE 与换版失效；读取前后、Step 提交与消费时复核。隔离测试覆盖换版竞态、跨项目、伪造定位、派生 Artifact 与旧 Action 审批失效。
- Web 与 ArkTS 同步来源 DTO、物理页显示、原件入口和调查委托的显式工具选择；旧委托不自动扩权。网页来源 API 保留 PR-6 分支。原生附件查看器展示页定位提示，尚未实现自动跳到该页。
- 真实试跑发现自然语言 informationNeed 逐字比较过于脆弱。现在按同项目唯一的当前 GoalGap 及 goalRevision 绑定读取，保存 canonicalNeed 和 modelNeed；缺失/歧义/跨项目仍拒绝。绑定记录不授予权限，原访问、版本、预算检查照常执行。
- answer prompt 明确：空字段或未知不能自行归因为旧记录、未同步或过期。

## 验证与真实模型证据

证据目录：`evidence/r4-document/20261029/`。全部为独立测试库与合成资料。

- 全量136文件、1167测试通过；最终新增绑定/网页兼容等受影响回归3文件62测试通过。完整运行期间的后续变更以补充回归覆盖，不能将全量数字当作同一最终源码快照。
- 类型、lint 通过；最终检查回执以目录中的 checkpoint/release 文件为准。
- 鸿蒙86测试通过，HAP构建通过：SHA256 `2001a207f35442cbf5aa5a85a04ba130e3a8c74c7c6a529da91eabddf40fac0d`，6465036字节。未安装设备，未部署后端。
- 文档定向 Web E2E 与完整 Web E2E 均通过，含隔离生产构建；完整运行 exit=0，回执保留在 `e2e-all.log/.exit` 和 `e2e-final-report.json`。
- 真实模型 + 真实 Poppler：正式页2026-11-15与2025旧附录对照成功，原 Conversation 回答带两页物理引用；独立调用的同供应商评审5项PASS，不能代替人工评测。模型把未知日期归因为“旧记录未同步”的附加推断没有证据，人工复查没有接受该部分。
- 第一次试跑被评测器旧2000输出限制在发网前拦下，原 Turn UNKNOWN 与保留预算不改写。评测器改为允许现有 Focus 的合法输出上限8192，按实际上限预留费用；原累计16请求/5元上限不变。第一次失败、脚本预检失败、成功两页回合与后续失败分别留存。
- 后续同会话试跑复现信息需求同义改写导致 GOAL_UNBOUND，已改为上述结构绑定并通过负例回归。QUICK 回合真实读取一页且保存新绑定，但后续命中原有累计 token 预算，返回项目状态回退；这不是完整答案质量PASS。该回合中 Goal Reasoning 已明确空日期不能证明未同步。总计13次真实模型请求，费用上界0.150603元，供应商 usage 未知0；原业务 Turn UNKNOWN 仍保留，不能据此称所有运行状态已结清。

## 设计依据与下一轮

比较 [PDF.js](https://github.com/mozilla/pdf.js)（Apache-2.0，约5万star，适合页渲染）与 [pdfplumber](https://github.com/jsvine/pdfplumber)（MIT，约1万star，擅长字符/表格布局）；本批复用仓库已有 Poppler，避免同时引入新 JS/Python 提取运行时。复杂表格、OCR、中文扫描件仍需真实样本验收。

CT-4 工程链路已形成可提交切片；剩余质量探针：未知日期归因的完整最终回答、QUICK静态协议开销与预算适配、真实大文档/OCR、鸿蒙原页导航和设备交互。禁止以扩大预算或清空 UNKNOWN 隐藏本轮失败。

CT-5/6 尚未交付：CT-5 先完成 CSV/JSON 条件比较及原来源回读，再接获批固定脚本与真实沙箱 job；本机 Docker 启动命令返回后仍无可用 daemon，不能把普通 Node 子进程冒充安全沙箱。CT-6 以单一 Crossref metadata adapter 接原公开研究授权/预算，metadata 不冒充全文，全文复用 PR-6/OA/本批附件。已查阅 node-csv（MIT，4.3k star）、Crossref官方REST文档与Docker官方安全说明，尚无对应业务代码落地。
