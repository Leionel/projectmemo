/**
 * POST 独立验收聚合器：把 AFTER 复验 JSON + BEFORE 基线 + git 边界扫描汇总为
 * evidence/final-a/20261103/post-checkpoint/verify/a-post-checkpoint-verification.json。
 *
 * 用法（仓库根目录）：npx.cmd tsx evidence/final-a/20261103/post-checkpoint/verify/fixtures/build-post-verification.ts <verifyDir> <outJson>
 * 仅读本地 JSON/日志，不读库、不联网；tsc 可类型检查（不 import 产品代码）。
 */
import fs from "node:fs";
import path from "node:path";

const verifyDir = process.argv[2];
const outPath = process.argv[3];
if (!verifyDir || !outPath) throw new Error("用法：tsx build-post-verification.ts <verifyDir> <outJson>");

type Check = { id: string; question?: string; verdict: string; observed?: unknown; note?: string };
type Section = {
  id: string; title: string; verdict: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
  evidence: string[]; checks?: Check[]; totals?: { total: number; pass: number; fail: number }; detail?: unknown; residual?: string[];
};

const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p: string): boolean => fs.existsSync(p);
const rel = (p: string): string => path.relative(path.resolve(verifyDir, "../..", "../..", "../..", "../.."), p).replaceAll("\\", "/");
const postRuns = path.join(verifyDir, "post-runs");
const postLogs = path.join(verifyDir, "post-logs");
const load = (name: string): any => {
  const p = path.join(postRuns, name);
  return exists(p) ? readJson(p) : null;
};
const exitOf = (name: string): number | null => {
  const p = path.join(postLogs, name + ".exit");
  return exists(p) ? Number(fs.readFileSync(p, "utf8").trim()) : null;
};
const isPass = (checks: Check[] | undefined): boolean => Array.isArray(checks) && checks.length > 0 && checks.every((c) => c.verdict === "PASS");
const checkTotals = (checks: Check[] | undefined) => {
  const list = checks ?? [];
  return { total: list.length, pass: list.filter((c) => c.verdict === "PASS").length, fail: list.filter((c) => c.verdict !== "PASS").length };
};

const sections: Section[] = [];

/* ---------- 1) 终态入口 ---------- */
{
  const after = load("after-post-terminal.json");
  const before = load("before-post-terminal.json");
  const checks: Check[] = after?.checks ?? [];
  sections.push({
    id: "terminal-entry",
    title: "终态（SUCCEEDED/CANCELLED）+ 未结算 UNKNOWN 从现有摘要入口找回（identity/version、旧客户端、非 Owner、零变更、截断诚实）",
    verdict: after ? (isPass(checks) ? "PASS" : "FAIL") : "NOT_RUN",
    evidence: ["post-runs/after-post-terminal.json", "post-logs/after-post-terminal.exit", "baseline-a-terminal.json"],
    checks, totals: checkTotals(checks),
    detail: {
      afterSummary: after?.summary ?? null, afterExit: exitOf("after-post-terminal"),
      beforeSummary: before?.summary ?? null, beforeExit: exitOf("before-post-terminal"),
      globalFocusResidual: after?.scenarios?.main?.globalFocus ?? null,
    },
    residual: [
      "终态窗口有界：missionWorkspaceSummary 只检查本项目最近 7 条终态（limit=6+1），GlobalFocus 只检查当前授权范围内最近 7 条；窗口内未找到≠全库没有，更早/跨项目终态委托仍应从原项目或委托列表核对。",
      "终态条目只提示核对，不结算 UNKNOWN、不改变终态/版本/updatedAt；不构成新的执行资格。",
    ],
  });
}

/* ---------- 2) 证据审查窗口 ---------- */
{
  const after = load("after-post-evidence-window.json");
  const before = load("before-post-evidence-window.json");
  const checks: Check[] = after?.checks ?? [];
  sections.push({
    id: "evidence-window",
    title: "证据审查有界窗口：先按选中原问题筛再限额（命中 ≤3、截断真、无 question 不回退、读零写入）",
    verdict: after ? (isPass(checks) ? "PASS" : "FAIL") : "NOT_RUN",
    evidence: ["post-runs/after-post-evidence-window.json", "post-logs/after-post-evidence-window.exit", "baseline-a-evidence-window.json"],
    checks, totals: checkTotals(checks),
    detail: { afterSummary: after?.summary ?? null, afterExit: exitOf("after-post-evidence-window"), beforeSummary: before?.summary ?? null, beforeExit: exitOf("before-post-evidence-window") },
  });
}

/* ---------- 3) requires ---------- */
{
  const after = load("after-post-requires.json");
  const before = load("before-post-requires.json");
  const checks: Check[] = after?.postChecks ?? [];
  const postPass = isPass(checks);
  const matrix = after?.verdict ?? null;
  sections.push({
    id: "requires",
    title: "primaryAction.requires：真实端点接受/拒绝矩阵、401/404、真实 409 错误码、requiredSourceRevisions 非请求字段与服务端重导出",
    verdict: after ? (postPass ? "PASS" : "FAIL") : "NOT_RUN",
    evidence: ["post-runs/after-post-requires.json", "post-logs/after-post-requires.exit", "baseline-a-requires.json"],
    checks, totals: checkTotals(checks),
    detail: {
      afterExit: exitOf("after-post-requires"),
      matrixCells: matrix?.matrixCells ?? null,
      entryRejectedCells: matrix?.entryRejectedCells ?? null,
      blindForwardAll422: matrix?.allEndpointsRejectBlindRequiresForward ?? null,
      beforeSummary: before?.summary ?? null,
      beforeExit: exitOf("before-post-requires"),
    },
  });
}

/* ---------- 4) 性能 ---------- */
{
  const base = readJson(path.join(verifyDir, "baseline-a-readback-instrument.json"));
  const r1 = load("after-post-perf-run1.json");
  const r2 = load("after-post-perf-run2.json");
  const checks: Check[] = [];
  const pick = (r: any) => ({
    stableTransactions: r?.verdict?.stableTransactions ?? null,
    stableQueries: r?.verdict?.stableQueries ?? null,
    retryOnceTransactions: r?.verdict?.retryOnceTransactions ?? null,
    retryOnceRetries: r?.verdict?.retryOnceRetries ?? null,
    continuousTransactions: r?.verdict?.continuousTransactions ?? null,
    continuousRetries: r?.verdict?.continuousRetries ?? null,
    materialUseItemsAtMost8: r?.verdict?.materialUseItemsAtMost8 ?? null,
    sourcePolicyChecks: r?.verdict?.sourcePolicyChecks ?? null,
    readbackZeroSideEffect: r?.verdict?.readbackZeroSideEffect ?? null,
    crossRequestCacheAbsent: r?.verdict?.crossRequestCacheAbsent ?? null,
    noStoreHeader: r?.verdict?.noStoreHeader ?? null,
  });
  const a = pick(r1), b = pick(r2);
  const add = (id: string, question: string, pass: boolean, observed: unknown) => checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed });
  add("PST-PERF-01", "同一脚本两次复跑 AFTER：事务数/查询数/重试数一致（可复算）", !!r1 && !!r2 && JSON.stringify(a) === JSON.stringify(b), { run1: a, run2: b });
  add("PST-PERF-02", "稳定读回事务数恒为 2", JSON.stringify(r1?.verdict?.stableTransactions) === JSON.stringify([2]) && JSON.stringify(r2?.verdict?.stableTransactions) === JSON.stringify([2]), { run1: r1?.verdict?.stableTransactions ?? null, run2: r2?.verdict?.stableTransactions ?? null });
  add("PST-PERF-03", "最多 2 次重读（retryOnce=1、continuous=2）且连续推进以 VERSION_ADVANCED 收敛", r1?.verdict?.retryOnceRetries === 1 && r1?.verdict?.continuousRetries === 2 && r1?.verdict?.continuousConsistency === "VERSION_ADVANCED" && r1?.verdict?.maxTwoRetriesRespected === true, { retryOnce: r1?.verdict?.retryOnceRetries ?? null, continuous: r1?.verdict?.continuousRetries ?? null, consistency: r1?.verdict?.continuousConsistency ?? null });
  add("PST-PERF-04", "SourcePolicy 有界 ≤8（items=8/limit=8/sourceLimitReached=true；新 sourcePolicyChecks ≤ items）", r1?.verdict?.materialUseItemsAtMost8 === true && typeof r1?.verdict?.sourcePolicyChecks === "number" && r1.verdict.sourcePolicyChecks >= 1 && r1.verdict.sourcePolicyChecks <= 8, { materialUseItemsAtMost8: r1?.verdict?.materialUseItemsAtMost8 ?? null, sourcePolicyChecks: r1?.verdict?.sourcePolicyChecks ?? null });
  add("PST-PERF-05", "GET/readback 零副作用（业务行、事件/步骤/输出计数、预算不变）", r1?.verdict?.readbackZeroSideEffect === true && r2?.verdict?.readbackZeroSideEffect === true, { run1: r1?.verdict?.readbackZeroSideEffect ?? null, run2: r2?.verdict?.readbackZeroSideEffect ?? null });
  add("PST-PERF-06", "无跨请求缓存（两次 GET 之间外部推进版本后第二次读到新版本且 readAt 不同）", r1?.verdict?.crossRequestCacheAbsent === true && r2?.verdict?.crossRequestCacheAbsent === true, { run1: r1?.verdict?.crossRequestCacheAbsent ?? null, run2: r2?.verdict?.crossRequestCacheAbsent ?? null });
  add("PST-PERF-07", "GET 响应 cache-control: no-store", r1?.verdict?.noStoreHeader === true && r2?.verdict?.noStoreHeader === true, { run1: r1?.verdict?.noStoreHeader ?? null, run2: r2?.verdict?.noStoreHeader ?? null });
  if (!r1 || !r2) checks.length = 0;
  const baseV = base?.verdict ?? null;
  add("PST-PERF-08", "BEFORE/AFTER 基线数字可对照（BEFORE 已固定：事务 [2]、查询 [118]、retry 4/6）", !!baseV && JSON.stringify(baseV.stableTransactions) === JSON.stringify([2]) && baseV.maxTwoRetriesRespected === true, { before: baseV, after: a });
  sections.push({
    id: "performance",
    title: "readback 性能与只读契约：事务数=2、最多 2 次重读、SourcePolicy≤8、GET 零副作用、无跨请求缓存、BEFORE/AFTER 同一脚本可复算",
    verdict: r1 && r2 ? (isPass(checks) ? "PASS" : "FAIL") : "NOT_RUN",
    evidence: ["post-runs/after-post-perf-run1.json", "post-runs/after-post-perf-run2.json", "baseline-a-readback-instrument.json", "post-logs/after-post-perf-run1.exit", "post-logs/after-post-perf-run2.exit"],
    checks, totals: checkTotals(checks),
    detail: { afterExitRun1: exitOf("after-post-perf-run1"), afterExitRun2: exitOf("after-post-perf-run2"), run1: a, run2: b, before: baseV, latencyBefore: base?.scenarios?.stableReadback?.latencyMs ?? null, latencyAfterRun1: r1?.scenarios?.stableReadback?.latencyMs ?? null },
  });
}

/* ---------- 4b) BEFORE 数字可复现性 ---------- */
{
  const rcpPath = path.join(postRuns, "baseline-recompute-check.json");
  if (exists(rcpPath)) {
    const rcp = readJson(rcpPath);
    const rcpChecks: Check[] = (rcp.checks ?? []).map((c: any) => ({ id: c.id, question: c.question, verdict: c.verdict, observed: c.observed }));
    sections.push({
      id: "before-reproducibility",
      title: "BEFORE 基线数字可复现：同一脚本在 4b69614 干净 shadow 重跑，与先前记录的 BEFORE 基线一致",
      verdict: isPass(rcpChecks) ? "PASS" : "FAIL",
      evidence: ["post-runs/baseline-recompute-check.json", "post-runs/baseline-recompute-terminal.json", "post-runs/baseline-recompute-evidence-window.json", "post-runs/baseline-recompute-requires.json", "post-runs/baseline-recompute-readback-instrument.json"],
      checks: rcpChecks, totals: checkTotals(rcpChecks),
      detail: { summary: rcp.summary ?? null, beforeBaselines: ["baseline-a-terminal.json", "baseline-a-evidence-window.json", "baseline-a-requires.json", "baseline-a-readback-instrument.json"] },
    });
  }
}
/* ---------- 5) git 边界 ---------- */
{
  const git = load("git-boundary.json");
  const checks: Check[] = git?.checks ? git.checks.map((c: any) => ({ id: c.id, question: c.question, verdict: c.verdict, observed: c.observed })) : [];
  sections.push({
    id: "git-boundary",
    title: "git 边界：无 schema/迁移/UI/ArkTS/官网/新表/Runner/Planner、docs 未入 git、无密钥",
    verdict: git ? (isPass(checks) ? "PASS" : "FAIL") : "NOT_RUN",
    evidence: ["post-runs/git-boundary.json"],
    checks, totals: checkTotals(checks),
    detail: git ? { branch: git.branch, head: git.head, checkpoint: git.checkpoint, finalSha: git.finalSha, commits: git.commits, changedFileCount: git.changedFileCount, changedFiles: git.changedFiles } : null,
  });
}

/* ---------- 5b) 逐提交范围 / 祖先链 / 脚本安全 ---------- */
{
  const gitSection = sections.find((s) => s.id === "git-boundary");
  const manifestForGit = exists(path.join(postRuns, "run-manifest.json")) ? readJson(path.join(postRuns, "run-manifest.json")) : null;
  if (gitSection) {
    const lineagePath = path.join(postRuns, "commit-lineage.json");
    if (exists(lineagePath)) {
      const lineage = readJson(lineagePath);
      for (const c of lineage.checks ?? []) gitSection.checks!.push({ id: c.id, question: c.question, verdict: c.verdict, observed: c.observed });
    }
    const commitKeys: Array<[string, string]> = [["requires", "requires"], ["terminal", "terminal"], ["evidenceWindow", "evidence-window"]];
    for (const [key, label] of commitKeys) {
      const sha = manifestForGit?.commits?.[key];
      if (!sha) continue;
      const p = path.join(postRuns, `git-boundary-${String(sha).slice(0, 12)}.json`);
      if (!exists(p)) continue;
      const g = readJson(p);
      const bad = (g.checks ?? []).filter((c: any) => c.verdict !== "PASS");
      gitSection.checks!.push({ id: `GIT-SCOPE-${label}`, question: `提交 ${String(sha).slice(0, 12)}（${label}）自身范围：无 schema/迁移/UI/ArkTS/官网/新表/Runner/Planner`, verdict: bad.length ? "FAIL" : "PASS", observed: { sha, changedFileCount: g.changedFileCount, changedFiles: g.changedFiles, failed: bad.map((c: any) => c.id) } });
    }
    gitSection.totals = checkTotals(gitSection.checks);
    if (gitSection.verdict !== "NOT_RUN") gitSection.verdict = isPass(gitSection.checks) ? "PASS" : "FAIL";
    gitSection.detail = { ...(gitSection.detail as object ?? {}), commitLineage: exists(path.join(postRuns, "commit-lineage.json")) ? readJson(path.join(postRuns, "commit-lineage.json")) : null };
  }
  const safePath = path.join(postRuns, "script-safety.json");
  if (exists(safePath)) {
    const safe = readJson(safePath);
    const safeChecks: Check[] = (safe.checks ?? []).map((c: any) => ({ id: c.id, question: c.question, verdict: c.verdict, observed: c.observed }));
    sections.push({ id: "aux-scripts", title: "脚本安全：perf 脚本只临时库/无网络/无模型；a1-contract-samples 仅类型对齐且可跑", verdict: isPass(safeChecks) ? "PASS" : "FAIL", evidence: ["post-runs/script-safety.json"], checks: safeChecks, totals: checkTotals(safeChecks), detail: safe.detail ?? null });
  }
}
/* ---------- 汇总 ---------- */
const failures: Array<{ section: string; id: string; question?: string; observed?: unknown }> = [];
for (const s of sections) for (const c of s.checks ?? []) if (c.verdict !== "PASS") failures.push({ section: s.id, id: c.id, question: c.question, observed: c.observed });
const notRun = sections.filter((s) => s.verdict === "NOT_RUN").map((s) => s.id);
const overall = notRun.length > 0 ? "NOT_RUN" : failures.length > 0 ? "FAIL" : "PASS";
const manifestPath = path.join(postRuns, "run-manifest.json");
const manifest = exists(manifestPath) ? readJson(manifestPath) : null;
const result = {
  generatedAt: new Date().toISOString(),
  purpose: "Track A 第二批三项交付的独立 POST 验收（A-新0 第二步）",
  role: "post-checkpoint-verifier（独立验收；未改 lib/tests/app/components/harmonyos/prisma、未 git add/commit/push）",
  checkpoint: "4b696141435825a3582816e8e449c0e0cf013f29",
  branch: "codex/final-a-mission-packet",
  commits: manifest?.commits ?? null,
  environment: manifest?.environment ?? { note: "见 post-runs/run-manifest.json" },
  runs: manifest?.runs ?? null,
  sections,
  failures,
  overallVerdict: overall,
  notRunSections: notRun,
  cannotSignOff: [...failures.map((f) => `${f.section}:${f.id}`), ...notRun.map((id) => `NOT_RUN:${id}`)],
  residualRisks: sections.flatMap((s) => s.residual ?? []),
  denominators: {
    terminalChecks: sections.find((s) => s.id === "terminal-entry")?.totals ?? null,
    evidenceWindowChecks: sections.find((s) => s.id === "evidence-window")?.totals ?? null,
    requiresChecks: sections.find((s) => s.id === "requires")?.totals ?? null,
    performanceChecks: sections.find((s) => s.id === "performance")?.totals ?? null,
    beforeReproducibilityChecks: sections.find((s) => s.id === "before-reproducibility")?.totals ?? null,
    gitChecks: sections.find((s) => s.id === "git-boundary")?.totals ?? null,
  },
  evidenceIndex: {
    baseline: ["baseline-a-terminal.json", "baseline-a-evidence-window.json", "baseline-a-requires.json", "baseline-a-readback-instrument.json", "baseline-summary.md", "baseline-provenance.json"],
    fixtures: ["fixtures/baseline-terminal.ts", "fixtures/baseline-evidence-window.ts", "fixtures/baseline-requires.ts", "fixtures/baseline-readback-instrument.ts", "fixtures/post-terminal-verify.ts", "fixtures/post-evidence-window-verify.ts", "fixtures/post-requires-verify.ts", "fixtures/build-post-verification.ts", "git-boundary.ps1"],
    logs: "post-logs/（每个命令的 .log/.exit）",
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
const failureLog = failures.map((f) => `[FAIL] ${f.section} ${f.id} ${f.question ?? ""}\n  observed=${JSON.stringify(f.observed).slice(0, 1500)}`).join("\n");
fs.writeFileSync(path.join(postRuns, "failures.log"), failures.length ? failureLog + "\n" : "none\n", "utf8");
console.log(JSON.stringify({ ok: true, outPath, overallVerdict: overall, notRunSections: notRun, failures: failures.map((f) => `${f.section}:${f.id}`), sections: sections.map((s) => ({ id: s.id, verdict: s.verdict, totals: s.totals ?? null })) }, null, 2));
process.exit(overall === "PASS" ? 0 : 1);





