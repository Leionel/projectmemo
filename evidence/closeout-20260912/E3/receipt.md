# E3 收尾回执：R1 逐句 claim 来源

日期：2026-09-12。起点 HEAD `4d637d7`。

## 改动

1. **模板绑定 claim 生成**：`generateMockArtifactWithClaims` 渲染确定性模板时同步登记逐句映射（每条 `- **标题**：摘要` 行 → 一条 claim，text 与正文逐字一致，cardIds 绑定该卡）；模板记录改为惰性求值，修复副作用在全部模板中重复登记的缺陷。LLM 路径暂无映射：claims 存为 `UNMAPPED_MODEL`（诚实标注语义未核验，不冒充 SUPPORTED）。
2. **存储与迁移**：GeneratedArtifact.claims Json（迁移 20260912230000）；saveArtifact 接受 claims 参数。
3. **audit 逐句核验**：ArtifactAuditResponse 增加 claimsStatus（TEMPLATE_BOUND/UNMAPPED_MODEL/LEGACY_NO_CLAIMS/NONE）与 claims[]（每条 state: CURRENT/SUPERSEDED/UNCONFIRMED/MISSING + stateLabel + 逐卡状态）；来源删除显示"来源已删除"；映射上线前的旧成果标 LEGACY（仅有上下文级来源）。
4. **展示一致**：ClaimAuditorDrawer 新增"逐句核验（N 条）"区块（文本 + 状态 + 章节）；ExportFormatter 输出逐句核验表；与页面同源。
5. 人工编辑版本维持"无法逐句回溯"口径（编辑版映射失效、旧版本保留可查）。

## 命令与退出码

- `npm.cmd exec tsc -- --noEmit` → 0
- `npm.cmd test`（独立库）→ 28 文件 / 200 测试全部通过，0
- `npm.cmd run harmony:test` → BUILD SUCCESSFUL，27/27

## 用例对照

- 模板生成两类型（weekly_report + competition_outline）claims 非空、文本逐字出现在正文 ✓
- 绑定隔离：outline 的 claims 只含 outline 渲染的卡 ✓
- 旧值被取代 → 该句 claim state=SUPERSEDED ✓；无关卡不出现在 claim ✓
- 来源删除 → MISSING/来源已删除 ✓（实现映射，按状态覆盖）
- 人工修改数字 → 编辑版本 untraceable（映射失效口径）✓
- 旧成果（claims null）→ LEGACY ✓；audit 网络失败重试 → 抽屉已有失败重试态 ✓
- UNMAPPED_MODEL → 语义未核验、不标 SUPPORTED ✓

## 状态

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| R1 | PASS | 尚未执行 | IN_PROGRESS |

## 剩余限制

- LLM 路径 claim 映射未实现（UNMAPPED_MODEL 诚实降级）；演示时应使用离线模板成果展示逐句核验。
- claim 粒度 = 模板条目句（标题+摘要），不是 LLM 自由文本句子——计划允许的"先覆盖确定性模板"范围。
- 设备矩阵未执行。
