/**
 * BEFORE 数字可复现性对照：把「先前记录的 BEFORE 基线 JSON」与「最终阶段在同一 4b69614 干净 shadow
 * 用同一脚本重跑得到的结果」逐项对比。只读 JSON，不读库/不联网。
 *
 * 用法：npx.cmd tsx fixtures/compare-baseline.ts <verifyDir>
 * 输出：<verifyDir>/post-runs/baseline-recompute-check.json
 */
import fs from "node:fs";
import path from "node:path";

const verifyDir = process.argv[2];
if (!verifyDir) throw new Error("用法：tsx compare-baseline.ts <verifyDir>");
const read = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p: string): boolean => fs.existsSync(p);
const checks: Array<{ id: string; question: string; verdict: "PASS" | "FAIL" | "NOT_RUN"; observed: unknown }> = [];
const add = (id: string, question: string, pass: boolean, observed: unknown) =>
  checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed });

const baseTerm = read(path.join(verifyDir, "baseline-a-terminal.json"));
const recomputeTerm = exists(path.join(verifyDir, "post-runs/baseline-recompute-terminal.json")) ? read(path.join(verifyDir, "post-runs/baseline-recompute-terminal.json")) : null;
add("RCP-TERM-01", "BEFORE 终态基线可复现：summary/focus 均找不到，detail/readback 可表达 terminal+unsettled", !!recomputeTerm &&
  JSON.stringify(baseTerm.verdict) === JSON.stringify(recomputeTerm.verdict) &&
  recomputeTerm.verdict.summaryCanFindSucceeded === false && recomputeTerm.verdict.focusCanFindSucceeded === false &&
  recomputeTerm.verdict.readbackExpressesSucceededTerminal === true && recomputeTerm.verdict.readbackExpressesUnsettledSucceeded === true && recomputeTerm.verdict.readOnlyZeroChange === true,
  { before: baseTerm.verdict, recompute: recomputeTerm?.verdict ?? null });

const baseWin = read(path.join(verifyDir, "baseline-a-evidence-window.json"));
const recomputeWin = exists(path.join(verifyDir, "post-runs/baseline-recompute-evidence-window.json")) ? read(path.join(verifyDir, "post-runs/baseline-recompute-evidence-window.json")) : null;
const winKey = (x: any) => ({ targetReviewExistsInDb: x.targetReviewExistsInDb, evictedScenarioHit: x.evictedScenarioHit, evictedScenarioItemCount: x.evictedScenarioItemCount, evictedScenarioTruncated: x.evictedScenarioTruncated, controlScenarioHit: x.controlScenarioHit, boundary21ScenarioHit: x.boundary21ScenarioHit, readOnlyZeroChange: x.readOnlyZeroChange });
add("RCP-WIN-01", "BEFORE 证据窗口基线可复现：目标审查在库但被挤出（items=0/truncated=true），对照命中", !!recomputeWin &&
  JSON.stringify(winKey(baseWin.verdict)) === JSON.stringify(winKey(recomputeWin.verdict)) &&
  recomputeWin.verdict.evictedScenarioItemCount === 0 && recomputeWin.verdict.evictedScenarioTruncated === true && recomputeWin.verdict.controlScenarioHit === true,
  { before: winKey(baseWin.verdict), recompute: recomputeWin ? winKey(recomputeWin.verdict) : null });

const baseReq = read(path.join(verifyDir, "baseline-a-requires.json"));
const recomputeReq = exists(path.join(verifyDir, "post-runs/baseline-recompute-requires.json")) ? read(path.join(verifyDir, "post-runs/baseline-recompute-requires.json")) : null;
const reqKey = (x: any) => ({ matrixCells: x.matrixCells, entryRejectedCells: x.entryRejectedCells, blindForwardAll422: x.allEndpointsRejectBlindRequiresForward, fences: x.fenceErrors.map((f: any) => [f.label, f.status, f.errorCode]) });
add("RCP-REQ-01", "BEFORE requires 矩阵基线可复现：132 单元/119 入口拒绝、整包盲发 12/12 422、15 项 fence 错误码一致", !!recomputeReq &&
  JSON.stringify(reqKey(baseReq.verdict)) === JSON.stringify(reqKey(recomputeReq.verdict)) && recomputeReq.verdict.matrixCells === 132 && recomputeReq.verdict.entryRejectedCells === 119,
  { before: reqKey(baseReq.verdict), recompute: recomputeReq ? reqKey(recomputeReq.verdict) : null });

const basePerf = read(path.join(verifyDir, "baseline-a-readback-instrument.json"));
const recomputePerf = exists(path.join(verifyDir, "post-runs/baseline-recompute-readback-instrument.json")) ? read(path.join(verifyDir, "post-runs/baseline-recompute-readback-instrument.json")) : null;
const perfKey = (x: any) => ({ stableTransactions: x.stableTransactions, stableQueries: x.stableQueries, retryOnceTransactions: x.retryOnceTransactions, retryOnceConsistency: x.retryOnceConsistency, continuousTransactions: x.continuousTransactions, continuousRetries: x.continuousRetries, materialUseItemsAtMost8: x.materialUseItemsAtMost8, readbackZeroSideEffect: x.readbackZeroSideEffect, crossRequestCacheAbsent: x.crossRequestCacheAbsent });
add("RCP-PERF-01", "BEFORE 性能基线可复现：事务[2]/查询[118]/retry 4-6/零副作用/无跨请求缓存一致", !!recomputePerf &&
  JSON.stringify(perfKey(basePerf.verdict)) === JSON.stringify(perfKey(recomputePerf.verdict)),
  { before: perfKey(basePerf.verdict), recompute: recomputePerf ? perfKey(recomputePerf.verdict) : null });

const pass = checks.filter((c) => c.verdict === "PASS").length;
const out = { generatedAt: new Date().toISOString(), purpose: "BEFORE 数字可复现性对照（同一脚本在 4b69614 干净 shadow 重跑）", checks, summary: { total: checks.length, pass, fail: checks.length - pass } };
fs.writeFileSync(path.join(verifyDir, "post-runs/baseline-recompute-check.json"), JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, summary: out.summary, checks: checks.map((c) => ({ id: c.id, verdict: c.verdict })) }, null, 2));
process.exit(pass === checks.length ? 0 : 1);
