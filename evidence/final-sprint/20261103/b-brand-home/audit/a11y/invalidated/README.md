# 隔离：被污染的“基线动态探针”运行

## 为什么在这里

- 本目录原为 `label=baseline` 的 Playwright 探针输出（JSON + 截图）。
- 运行期间（2026-11-03 约 11:51–11:55）实现者开始在工作树写入 B2 修改（`app/page.tsx`、`app/home.module.css`、`components/HomeJourney.tsx`、`components/SiteHeader.tsx` 等，文件时间戳可查），Lead 的 dev server（`http://127.0.0.1:34111`）热加载了未提交实现。
- 结果：同一次运行的前后 section 分别测到基线 DOM（`home-module__txgM7a__*`）与 B2 进行中 DOM（`HomeJourney-module__yeKYWG__*`、`内置公开示例`），**无法作为基线证据**，也不能作为候选证据。

## 处理

- 整体移入本目录，**不用于任何 PASS/FAIL 结论**。
- 基线清点改为 `git show 485d485…` 提取源码后静态清点（见 [../BASELINE_INVENTORY.md](../BASELINE_INVENTORY.md) §1.1 与 [../baseline-src/](../baseline-src/)）。
- Phase 1 在 B2 候选 SHA 提交、工作树稳定后重跑 `probe-a11y.mjs --label=after --sha=<候选SHA>`。

## 保留价值

- `probe-baseline-contaminated.json` 的 `meta.startedAt/finishedAt`、`consoleErrors` 与 `sections.*` 中混合的类名，可用于证明“编辑期间动态测量不可信”，提醒后续不要在实现进行中跑验收。
