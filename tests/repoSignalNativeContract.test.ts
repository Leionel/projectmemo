import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-sense-native-")), file = path.join(dir, "native.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { REPO_SENSING_ENABLED: "true" });
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
import { GET as listRoute } from "@/app/api/projects/[id]/repo-signals/route";
import { POST as createRoute } from "@/app/api/projects/[id]/repo-signals/route";
import { POST as connectionRoute } from "@/app/api/projects/[id]/repo-signals/connections/[connectionId]/route";
import { POST as signalRoute } from "@/app/api/projects/[id]/repo-signals/signals/[signalId]/route";

// 执行实际 ArkTS RepoSignalService；@ohos 网络以真实 Next route 替换。外部 GitHub 请求由注入的 fixture fetch 模拟。
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

const firstSha = "a".repeat(40);
const fixtureFetch = vi.fn(async () => new Response(JSON.stringify([
  { sha: firstSha, html_url: "https://github.com/x/y/commit/a", commit: { message: "跨端契约提交", author: { name: "契约", date: "2026-10-24T00:00:00Z" } } },
]), { status: 200, headers: { etag: "W/\"native\"" } }));

let userId = "", projectId = "", token = "", connectionId = "", signalId = "";
async function dispatch(method: string, url: string, body?: object) {
  const request = new Request(`https://fixture.invalid${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const parts = new URL(request.url).pathname.split("/");
  let response: Response;
  if (parts[5] === "connections") response = await connectionRoute(request, { params: Promise.resolve({ id: parts[3], connectionId: parts[6] }) });
  else if (parts[5] === "signals") response = await signalRoute(request, { params: Promise.resolve({ id: parts[3], signalId: parts[6] }) });
  else if (method === "GET") response = await listRoute(request, { params: Promise.resolve({ id: parts[3] }) });
  else response = await createRoute(request, { params: Promise.resolve({ id: parts[3] }) });
  const success = nativeModule("common/ApiContract.ets").isSuccessCode as (method: string, code: number) => boolean;
  const value = await response.json();
  if (!success(method, response.status)) throw new NativeApiError(value.error.code, value.error.message, response.status);
  return value;
}
interface NativeRepoSignalService {
  list(projectId: string): Promise<{ enabled: boolean; connections: Array<{ id: string }>; signals: Array<{ id: string; status: string }> }>;
  create(projectId: string, body: object): Promise<{ connection: { id: string } }>;
  act(projectId: string, signalId: string, body: object): Promise<{ signal: { id: string; status: string } }>;
}
const Service = nativeModule("services/RepoSignalService.ets").RepoSignalService as new (client: object) => NativeRepoSignalService;
const native = new Service({ get: (url: string) => dispatch("GET", url), post: (url: string, body: object) => dispatch("POST", url, body) });

beforeAll(async () => {
  const user = await db.user.create({ data: { username: `sense-native-${Date.now()}`, displayName: "感知跨端测试", passwordHash: "unused" } }); userId = user.id;
  const project = await db.project.create({ data: { title: "感知跨端项目", description: "fixture", goal: "跟踪仓库", scenario: "RESEARCH" } }); projectId = project.id;
  await db.projectMembership.create({ data: { userId, projectId, role: "OWNER" } });
  token = (await createSession(userId)).token;
  // defaultFetch 在调用时才解析全局 fetch；stub 在此刻生效即可让真实路由使用 fixture 外部响应。
  vi.stubGlobal("fetch", fixtureFetch as unknown as typeof fetch);
});
afterAll(async () => { vi.unstubAllGlobals(); await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

describe("P3-B ArkTS RepoSignalService 与真实 Next 路由契约", () => {
  it("创建连接（fixture fetch）→ 列表读回候选 → 采纳读回已采纳", async () => {
    const created = await native.create(projectId, { repo: "Leionel/fixture-repo", ref: "main", requestId: crypto.randomUUID() });
    connectionId = created.connection.id;
    expect(connectionId).toBeTruthy();
    const listed = await native.list(projectId);
    expect(listed.enabled).toBe(true);
    expect(listed.connections).toHaveLength(1);
    expect(listed.signals).toHaveLength(1);
    signalId = listed.signals[0].id;
    expect(listed.signals[0].status).toBe("CANDIDATE");
    const adopted = await native.act(projectId, signalId, { action: "ADOPT", requestId: crypto.randomUUID() });
    expect(adopted.signal.status).toBe("ADOPTED");
    const reread = await native.list(projectId);
    expect(reread.signals[0].status).toBe("ADOPTED");
    expect(await db.capture.count({ where: { projectId, sourceType: "仓库信号" } })).toBe(1);
  });
});
