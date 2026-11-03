/**
 * 独立验收基线侦察探针（BEFORE A1）：只读纯投影，不连数据库、不调模型/网络。
 *
 * 目的：在 A1 落地前，独立记录 485d485 基线 workState 对 FS-A01（终态+UNKNOWN）
 * 与 FS-A02（RUNNING+停止请求在途）的显示行为，作为我后续独立复现的对照基线。
 *
 * 运行（工作区根目录）：
 *   npm.cmd exec tsx -- evidence/final-a/20261103/verify/probes/baseline-pure-projection.ts \
 *     evidence/final-a/20261103/verify/baseline-before-a1-pure-projection.json
 */
import fs from "node:fs";
import path from "node:path";
import { missionWorkState } from "@/lib/mission/workState";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx baseline-pure-projection.ts <输出JSON路径>");

const fixtureTime = new Date("2026-11-03T03:00:00.000Z");
const lease = new Date(+fixtureTime + 60_000);
const base = { id: "evidence-baseline-mission", version: 3 };

const cases = [
  { id: "FS-A01-SUCCEEDED-PLAIN", note: "基线：无 UNKNOWN 错误", input: { ...base, status: "SUCCEEDED" } },
  {
    id: "FS-A01-SUCCEEDED-UNKNOWN",
    note: "基线：SUCCEEDED 与未结算 UNKNOWN 同时存在（FS-A01 反例）",
    input: { ...base, status: "SUCCEEDED", lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "外部效果未结算" } },
  },
  { id: "FS-A01-CANCELLED-PLAIN", note: "基线：取消无 UNKNOWN", input: { ...base, status: "CANCELLED" } },
  {
    id: "FS-A01-CANCELLED-UNKNOWN",
    note: "基线：CANCELLED 与未结算 UNKNOWN 同时存在（FS-A01 反例）",
    input: { ...base, status: "CANCELLED", lastErrorJson: { code: "EXTERNAL_UNKNOWN" } },
  },
  {
    id: "FS-A02-RUNNING-PAUSE-IN-FLIGHT",
    note: "基线：RUNNING+有效 lease+pauseRequestedAt（FS-A02 反例；基线输入类型无该字段，运行时传入验证是否被忽略）",
    input: { ...base, status: "RUNNING", leaseUntil: lease, pauseRequestedAt: fixtureTime },
  },
  {
    id: "FS-A02-RUNNING-CANCEL-IN-FLIGHT",
    note: "基线：RUNNING+有效 lease+cancelRequestedAt",
    input: { ...base, status: "RUNNING", leaseUntil: lease, cancelRequestedAt: fixtureTime },
  },
  {
    id: "FS-A04-OBSERVED-AT",
    note: "基线：delegation.lastObservedAt 固定，checkedAt 来自 now",
    input: { ...base, status: "WAITING_INPUT", waitStateJson: { waitingFor: "OBSERVATION" }, planJson: { delegation: { lastObservedAt: "2026-11-01T00:00:00.000Z" } }, continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-10T00:00:00.000Z" } },
  },
];

const results = cases.map((c) => ({
  id: c.id,
  note: c.note,
  input: JSON.parse(JSON.stringify(c.input)),
  output: missionWorkState(c.input as never, fixtureTime),
}));

const evidence = {
  generatedAt: new Date().toISOString(),
  stage: "BEFORE_A1",
  role: "independent-verifier",
  mode: "pure-projection-no-database-no-model",
  sourceSha: process.env.VERIFY_HEAD_SHA ?? null,
  branch: process.env.VERIFY_BRANCH ?? null,
  note: "基线显示行为对照，不是修复测试，也不是 PASS/FAIL 验收；A1 落地后由独立 fixture 复测。",
  fixtureTime: fixtureTime.toISOString(),
  cases: results,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: true, outPath, sourceSha: evidence.sourceSha, cases: results.length }));
