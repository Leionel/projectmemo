# 加强质量评分：确定性结构 + 语义审核分开报告

基线 `9776f9b`。旧的 `USER_REDIRECT_APPLIED` 只要求正文出现“工作重点”或改道词，标题式造假也能通过；已替换为 `lib/evaluation/contentQuality.ts`。

## 判据

确定性结构检查（PASS/FAIL）：

- `CURRENT_HAS_CONTENT`、`EFFECTIVE_REVISION`（差异率 + 变化词，改几个字不算修订）
- `NEW_EVIDENCE_ADDED`（新增材料必须带来新来源）
- `EVIDENCE_BOUND`、`CITATIONS_RESOLVE`、`CITATIONS_RELEVANT`（正文与真实来源有实质重合；引用必须可解析且与所引段落相关）
- `OLD_EVIDENCE_RETAINED`（旧依据仍在引用中，新增无关引用不能冒充保留）
- `NOT_COPY_OF_USER_REQUEST`（复制用户要求、且与来源几乎无重合 → 失败）
- `REDIRECT_ADDRESSED`（改道词命中 + 来源重合 + 与上一版有实际变化）
- `UNKNOWN_PRESERVED`（关键未知不能遗漏）

语义审核（永远 `UNVERIFIED / HUMAN_REVIEW`，不计为通过）：
`SEMANTIC_CLAIM_SUPPORT`、`SEMANTIC_COMPARABILITY`、`SEMANTIC_REDIRECT`、`SEMANTIC_USER_VALUE`。

评测报告分别列出：协议/持久化、结构确定性内容、语义未验证项。`eval:v2` 的 `semanticUnverified` 和各 journey 的 `semantic` 字段即该维度。

## 负例（必须失败）

`tests/contentQuality.test.ts` 7/7 通过，覆盖：

1. 仅复制用户要求 → `EVIDENCE_BOUND`、`NOT_COPY_OF_USER_REQUEST`、`REDIRECT_ADDRESSED` 失败；
2. 无关正文加标题 → `EVIDENCE_BOUND`、`REDIRECT_ADDRESSED` 失败；
3. 无关引用冒充保留旧依据 → `CITATIONS_RESOLVE` 失败；
4. 改几个字冒充修订 → `EFFECTIVE_REVISION` 失败；
5. 遗漏关键未知 → `UNKNOWN_PRESERVED` 失败；
6. 真实有据修订 → 全结构检查通过；
7. 语义项全部保持未验证。

## 冻结 oracle

`tests/skillRouter.test.ts` 新增指纹断言：`docs/v2/evaluation/skill-routing.v1.json` 的 SHA-256 必须保持 `1b71452899c586e4e893477be68301a90dac23e57ad4d4d80258f59b16fce89a`。本轮未修改冻结 64 条，也未放宽评分器。

## 离线评测结果

- fixture：协议 40/40，结构内容 24/24，语义未验证 16 项；
- mock HTTP：协议 40/40，结构内容 24/24，语义未验证 16 项；
- 冻结路由：模式/主能力/序列 64/64，安全违规 0，关键失败 0；完整通过 39/64（25 条内容语义判据按设计判失败）。

## 剩余

- 语义四项需要真实模型输出 + 人工审核；本轮无付费授权，未用真实模型复验。
- 评分器仍是启发式规则，不替代人工对事实准确性的判断。
