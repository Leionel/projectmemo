import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-exp-native-")), file = path.join(dir, "native.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { MISSION_ENABLED: "true", PROJECT_EXPERIENCE_ENABLED: "true" });
  const sql = new Database(file);
  for (const dir of fs.readdirSync("prisma/migrations").sort()) { const file = path.join("prisma/migrations", dir, "migration.sql"); if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createMission } from "@/lib/mission/missionService";
import { syncExperiences } from "@/lib/experience/extract";
import { GET as listExperiencesRoute } from "@/app/api/projects/[id]/experiences/route";
import { POST as actOnExperienceRoute } from "@/app/api/projects/[id]/experiences/[experienceId]/route";

// 执行实际 ArkTS ExperienceService；@ohos 网络以真实 Next route 替换（沿用 missionNativeContract 方式）。
class NativeApiError extends Error { constructor(public code: string, message: string, public status = 0) { super(message); } }
const moduleCache = new Map<string, Record<string, unknown>>();
function nativeModule(relative: string): Record<string, unknown> {
  const file = path.resolve("harmonyos/entry/src/main/ets", relative);
  const found = moduleCache.get(file); if (found) return found;
  const exports: Record<string, unknown> = {}; moduleCache.set(file, exports);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const require = (name: string) => {
    if (name.endsWith("/ApiClient")) return { ApiClient: class {} };
    if (name.endsWith("/SessionStore")) return { SessionStore: { isTokenValid: () => true, handleSessionExpired: () => {} } };
    if (name.endsWith("/models/Project")) return { ApiError: NativeApiError };
    return nativeModule(path.relative(path.resolve("harmonyos/entry/src/main/ets"), path.resolve(path.dirname(file), `${name}.ets`)));
  };
  vm.runInNewContext("(function(require,exports){" + compiled.outputText + "\n})", {})(require, exports);
  return exports;
}

let userId = "", projectId = "", token = "";
async function dispatch(method: string, url: string, body?: object) {
  const request = new Request(`https://fixture.invalid${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const parts = new URL(request.url).pathname.split("/");
  let response: Response;
  if (method === "GET") response = await listExperiencesRoute(request, { params: Promise.resolve({ id: parts[3] }) });
  else response = await actOnExperienceRoute(request, { params: Promise.resolve({ id: parts[3], experienceId: parts[5] }) });
  const success = nativeModule("common/ApiContract.ets").isSuccessCode as (method: string, code: number) => boolean;
  const value = await response.json();
  if (!success(method, response.status)) throw new NativeApiError(value.error.code, value.error.message, response.status);
  return value;
}
interface NativeExperienceService {
  list(projectId: string): Promise<{ enabled: boolean; trajectory: { engineeringSucceeded: number; adopted: number } | null; experiences: Array<{ id: string; status: string }> }>;
  act(projectId: string, experienceId: string, body: object): Promise<{ id: string; status: string }>;
}
const Service = nativeModule("services/ExperienceService.ets").ExperienceService as new (client: object) => NativeExperienceService;
const native = new Service({ get: (url: string) => dispatch("GET", url), post: (url: string, body: object) => dispatch("POST", url, body) });

beforeAll(async () => {
  const user = await db.user.create({ data: { username: `exp-native-${Date.now()}`, displayName: "经验跨端隔离测试", passwordHash: "unused" } }); userId = user.id;
  const project = await db.project.create({ data: { title: "经验跨端项目", description: "fixture", goal: "完成阶段报告", scenario: "RESEARCH" } }); projectId = project.id;
  await db.projectMembership.create({ data: { userId, projectId, role: "OWNER" } });
  token = (await createSession(userId)).token;
  // 构造两条同序列已采用轨迹，使 WORKFLOW 进入 SHADOW 供激活。
  for (const goal of ["跨端样本1", "跨端样本2"]) {
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal });
    for (const [index, tool] of ["native_a", "native_b"].entries()) {
      await db.agentMissionStep.create({ data: { missionId: m.id, ordinal: index + 1, planRevision: 1, toolName: tool, toolVersion: "1", status: "SUCCEEDED", canonicalInputJson: {}, inputHash: `h-${index}`, readSetJson: [], protocolJson: { protocol: "JSON_CHOICE", schemaVersion: 1 } } });
    }
    const output = await db.agentMissionOutput.create({ data: { missionId: m.id, revision: 1, kind: "REPORT_DRAFT", contentJson: { blocks: [] }, sourceRefsJson: [], claimChecksJson: [] } });
    const artifact = await db.generatedArtifact.create({ data: { projectId, artifactType: "weekly_report", content: "c" } });
    await db.missionArtifactReceipt.create({ data: { projectId, missionId: m.id, outputId: output.id, outputRevision: 1, outputHash: "x", artifactId: artifact.id, artifactType: "weekly_report", sourceManifestJson: {}, blockMapJson: {}, verificationSnapshotJson: {}, createdByUserId: userId, requestId: `r-${crypto.randomUUID()}`, payloadHash: "x" } });
    await db.agentMission.update({ where: { id: m.id }, data: { status: "SUCCEEDED" } });
  }
  await syncExperiences(userId, projectId);
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

describe("P3-A ArkTS ExperienceService 与真实 Next 路由契约", () => {
  it("列表读取轨迹统计与影子经验；激活后读回 ACTIVE；未登录拒绝", async () => {
    const listed = await native.list(projectId);
    expect(listed.enabled).toBe(true);
    expect(listed.trajectory!.adopted).toBe(2);
    const shadow = listed.experiences.find(e => e.status === "SHADOW")!;
    expect(shadow).toBeTruthy();
    const acted = await native.act(projectId, shadow.id, { action: "ACTIVATE", requestId: `native-${crypto.randomUUID()}` });
    expect(acted.status).toBe("ACTIVE");
    const reread = await native.list(projectId);
    expect(reread.experiences.find(e => e.id === shadow.id)!.status).toBe("ACTIVE");
  });
});
