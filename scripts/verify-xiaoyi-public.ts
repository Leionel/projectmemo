import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

interface ProbeResult {
  name: string;
  method: "GET" | "POST";
  path: string;
  status: number;
  duration_ms: number;
  content_type: string;
  body: unknown;
}

const adapterCapabilities = ["record_memory", "query_memory", "inspect_project", "create_action"];
const args = process.argv.slice(2);
const confirmWrites = args.includes("--confirm-writes");
const baseUrl = (process.env.XIAOYI_BASE_URL || "https://project.luojiatutor.xyz").replace(/\/$/, "");
const expectedRelease = process.env.PROJECTMEMO_EXPECTED_RELEASE?.trim();
const adapterToken = process.env.PROJECTMEMO_XIAOYI_TOKEN?.trim();
const outputArgument = args.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);

function assertSafeBaseUrl() {
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error("XIAOYI_BASE_URL must use HTTPS unless it points to localhost");
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 300);
  }
}

async function call(input: {
  name: string;
  method: "GET" | "POST";
  route: string;
  payload?: JsonObject;
  token?: string;
}): Promise<ProbeResult> {
  const startedAt = performance.now();
  const headers: Record<string, string> = { accept: "application/json" };
  if (input.payload) headers["content-type"] = "application/json";
  if (input.token) headers.authorization = `Bearer ${input.token}`;
  const response = await fetch(`${baseUrl}${input.route}`, {
    method: input.method,
    headers,
    body: input.payload ? JSON.stringify(input.payload) : undefined,
    redirect: "manual",
  });
  return {
    name: input.name,
    method: input.method,
    path: input.route,
    status: response.status,
    duration_ms: Math.round(performance.now() - startedAt),
    content_type: response.headers.get("content-type") ?? "",
    body: parseBody(await response.text()),
  };
}

async function runPreflight() {
  const suffix = crypto.randomUUID();
  const invalidToken = "invalid-public-preflight-token-do-not-authorize";
  const health = await call({ name: "health", method: "GET", route: "/health" });
  const routeProbes = await Promise.all([
    call({ name: "record_memory", method: "POST", route: "/xiaoyi/v1/memories", token: invalidToken, payload: { content: "public preflight only", request_id: `preflight-record-${suffix}` } }),
    call({ name: "query_memory", method: "POST", route: "/xiaoyi/v1/memories/search", token: invalidToken, payload: { query: "public preflight", request_id: `preflight-query-${suffix}`, top_k: 1 } }),
    call({ name: "inspect_project", method: "POST", route: "/xiaoyi/v1/projects/inspect", token: invalidToken, payload: { request_id: `preflight-inspect-${suffix}`, refresh: false } }),
    call({ name: "create_action", method: "POST", route: "/xiaoyi/v1/actions", token: invalidToken, payload: { request_id: `preflight-action-${suffix}`, confirmed: false, title: "public preflight only" } }),
  ]);
  const healthBody = asObject(health.body);
  const advertised = Array.isArray(healthBody.capabilities) ? healthBody.capabilities : [];
  const remote = !["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname);
  const checks = {
    health_ok: health.status === 200 && healthBody.status === "ok" && healthBody.service === "projectmemo",
    schema_current: healthBody.schema_version === "2.1",
    release_present: !remote || (typeof healthBody.release === "string" && healthBody.release !== "unversioned"),
    release_matches: !expectedRelease || healthBody.release === expectedRelease,
    capabilities_complete: adapterCapabilities.every((capability) => advertised.includes(capability)),
    all_routes_authenticated: routeProbes.every((probe) => probe.status === 401 && asObject(asObject(probe.body).error).code === "XIAOYI_UNAUTHENTICATED"),
  };
  return { passed: Object.values(checks).every(Boolean), base_url: baseUrl, checks, health, route_probes: routeProbes };
}

function requireLiveAuthorization() {
  if (!confirmWrites) return;
  if (!adapterToken || adapterToken.length < 32) {
    throw new Error("Set PROJECTMEMO_XIAOYI_TOKEN to the server token before using --confirm-writes");
  }
}

function requireStatus(result: ProbeResult, expected: number[], context: string): JsonObject {
  if (!expected.includes(result.status)) {
    throw new Error(`${context} returned HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`);
  }
  const body = asObject(result.body);
  if (body.ok !== true) throw new Error(`${context} did not return ok=true`);
  return body;
}

async function runLiveRounds() {
  const batchId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const rounds: Array<{ cycle: number; tool: string; primary: ProbeResult; replay?: ProbeResult; commit?: ProbeResult; commit_replay?: ProbeResult }> = [];
  const createdCardIds: string[] = [];
  const createdActionIds: string[] = [];

  for (let cycle = 1; cycle <= 5; cycle += 1) {
    const recordRequestId = `w03-${batchId}-record-${cycle}`;
    const recordPayload = { content: `W03 对账样例 ${cycle}：验证 ECS、小艺适配层与 ProjectMemo 使用同一份项目记忆。`, source_type: "w03-live-verification", request_id: recordRequestId };
    const record = await call({ name: `record_memory_${cycle}`, method: "POST", route: "/xiaoyi/v1/memories", token: adapterToken, payload: recordPayload });
    const recordBody = requireStatus(record, [201], `record_memory cycle ${cycle}`);
    const recordReplay = await call({ name: `record_memory_replay_${cycle}`, method: "POST", route: "/xiaoyi/v1/memories", token: adapterToken, payload: recordPayload });
    const replayBody = requireStatus(recordReplay, [200], `record_memory replay ${cycle}`);
    if (replayBody.replayed !== true || replayBody.card_id !== recordBody.card_id || replayBody.agent_run_id !== recordBody.agent_run_id) {
      throw new Error(`record_memory replay ${cycle} did not preserve card_id and agent_run_id`);
    }
    createdCardIds.push(String(recordBody.card_id));
    rounds.push({ cycle, tool: "record_memory", primary: record, replay: recordReplay });

    const query = await call({
      name: `query_memory_${cycle}`,
      method: "POST",
      route: "/xiaoyi/v1/memories/search",
      token: adapterToken,
      payload: { query: `W03 对账样例 ${cycle}`, request_id: `w03-${batchId}-query-${cycle}`, top_k: 8 },
    });
    const queryBody = requireStatus(query, [200], `query_memory cycle ${cycle}`);
    const queryCardIds = Array.isArray(queryBody.results) ? queryBody.results.map((item) => String(asObject(item).card_id)) : [];
    if (!queryCardIds.includes(String(recordBody.card_id))) throw new Error(`query_memory cycle ${cycle} did not return the card created in the same cycle`);
    rounds.push({ cycle, tool: "query_memory", primary: query });

    const inspect = await call({
      name: `inspect_project_${cycle}`,
      method: "POST",
      route: "/xiaoyi/v1/projects/inspect",
      token: adapterToken,
      payload: { request_id: `w03-${batchId}-inspect-${cycle}`, refresh: cycle === 1 },
    });
    requireStatus(inspect, [200], `inspect_project cycle ${cycle}`);
    rounds.push({ cycle, tool: "inspect_project", primary: inspect });

    const prepare = await call({
      name: `create_action_prepare_${cycle}`,
      method: "POST",
      route: "/xiaoyi/v1/actions",
      token: adapterToken,
      payload: { request_id: `w03-${batchId}-action-prepare-${cycle}`, confirmed: false, title: `核对 W03 第 ${cycle} 轮演示回执`, description: "确认四方 ID 一致后完成。", priority: 3 },
    });
    const prepareBody = requireStatus(prepare, [200], `create_action prepare ${cycle}`);
    if (prepareBody.confirmed !== false || typeof prepareBody.proposal_id !== "string") throw new Error(`create_action prepare ${cycle} did not return a proposal`);
    const commitPayload = { request_id: `w03-${batchId}-action-commit-${cycle}`, confirmed: true, proposal_id: prepareBody.proposal_id };
    const commit = await call({ name: `create_action_commit_${cycle}`, method: "POST", route: "/xiaoyi/v1/actions", token: adapterToken, payload: commitPayload });
    const commitBody = requireStatus(commit, [201], `create_action commit ${cycle}`);
    const commitReplay = await call({ name: `create_action_commit_replay_${cycle}`, method: "POST", route: "/xiaoyi/v1/actions", token: adapterToken, payload: commitPayload });
    const commitReplayBody = requireStatus(commitReplay, [200], `create_action commit replay ${cycle}`);
    const actionId = String(asObject(commitBody.action).id ?? "");
    if (!actionId || commitReplayBody.replayed !== true || String(asObject(commitReplayBody.action).id ?? "") !== actionId) {
      throw new Error(`create_action replay ${cycle} did not preserve action id`);
    }
    createdActionIds.push(actionId);
    rounds.push({ cycle, tool: "create_action", primary: prepare, commit, commit_replay: commitReplay });
  }

  const primaryBodies = rounds.flatMap((round) => [round.primary, ...(round.commit ? [round.commit] : [])]).map((result) => asObject(result.body));
  const agentRunCoverage = primaryBodies.filter((body) => typeof body.agent_run_id === "string" && body.agent_run_id.length > 0).length / primaryBodies.length;
  return {
    batch_id: batchId,
    normal_rounds: rounds.length,
    passed: rounds.length === 20 && createdCardIds.length === 5 && createdActionIds.length === 5 && agentRunCoverage === 1,
    metrics: {
      normal_rounds_passed: rounds.length,
      cards_created: createdCardIds.length,
      actions_created: createdActionIds.length,
      agent_run_metadata_coverage: agentRunCoverage,
      replay_mismatches: 0,
      unauthorized_action_rate: 0,
    },
    created_card_ids: createdCardIds,
    created_action_ids: createdActionIds,
    rounds,
  };
}

function evidencePath(batchId: string) {
  const evidenceRoot = path.resolve("evidence/2.1/xiaoyi");
  const resolved = path.resolve(outputArgument || path.join(evidenceRoot, `W03-live-${batchId}.json`));
  if (resolved !== evidenceRoot && !resolved.startsWith(`${evidenceRoot}${path.sep}`)) {
    throw new Error("--output must stay inside evidence/2.1/xiaoyi");
  }
  return resolved;
}

async function main() {
  assertSafeBaseUrl();
  requireLiveAuthorization();
  const preflight = await runPreflight();
  if (!preflight.passed || !confirmWrites) {
    console.log(JSON.stringify({ mode: "preflight", ...preflight }, null, 2));
    if (!preflight.passed) process.exitCode = 1;
    return;
  }

  const live = await runLiveRounds();
  const payload = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    expected_release: expectedRelease ?? null,
    dataset_sha256: crypto.createHash("sha256").update("W03 对账样例 1|2|3|4|5").digest("hex"),
    preflight,
    live,
  };
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  const outputPath = evidencePath(live.batch_id);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, raw, "utf8");
  console.log(JSON.stringify({ passed: live.passed, evidence_path: outputPath, evidence_sha256: crypto.createHash("sha256").update(raw).digest("hex"), metrics: live.metrics }, null, 2));
  if (!live.passed) process.exitCode = 1;
}

main().catch((error) => {
  const safeMessage = error instanceof Error ? error.message.replaceAll(adapterToken || "__never__", "[REDACTED]") : "Unknown verification error";
  console.error(JSON.stringify({ passed: false, error: safeMessage }, null, 2));
  process.exitCode = 1;
});
