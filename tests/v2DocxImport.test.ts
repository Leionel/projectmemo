import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("m2-docx"));
import fs from "node:fs";
import { strToU8 } from "fflate";
import { db } from "@/lib/db";
import { extractDocxText } from "@/lib/intake/docx";
import { docxMaterial } from "../scripts/fixtures/docx-material";
import { xlsxMaterial } from "../scripts/fixtures/xlsx-material";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { createSession } from "@/lib/auth/session";
import { POST } from "@/app/api/projects/[id]/material-extract/route";
import { previewV2Delegation, confirmV2Delegation } from "@/lib/mission/v2DelegationService";
Object.assign(process.env, { MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

test("worker bytes survive bundler metadata being added to workerData", async () => {
  const result = await new Promise<{ ok: boolean; text: string }>((resolve, reject) => {
    const worker = new Worker(path.resolve("lib/intake/docxWorker.cjs"), {
      workerData: { schemaVersion: 1, bytes: docxMaterial("打包后仍保留原文"), __turbopack_globals__: {} },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    worker.once("message", value => { void worker.terminate(); resolve(value); });
    worker.once("error", reject);
  });
  expect(result.ok).toBe(true); expect(result.text).toContain("打包后仍保留原文");
});

test("DOCX imports Chinese body and table cells as text, preserving leading zeroes", async () => {
  const text = await extractDocxText(docxMaterial());
  expect(text).toContain("客户需求"); expect(text).toContain("验收口径尚未确认");
  expect(text).toContain("编号"); expect(text).toContain("001"); expect(text).toContain("分享入口待核对");
  expect(text).not.toContain("<w:");
});
test.each([
  ["corrupt", new Uint8Array([0, 1, 2, 3])],
  ["oversized archive", new Uint8Array(2 * 1024 * 1024 + 1)],
  ["expanded limit", docxMaterial("合成", { "word/bomb.xml": strToU8("x".repeat(5 * 1024 * 1024)) })],
  ["macro", docxMaterial("合成", { "word/vbaProject.bin": strToU8("not executable") })],
  ["entities", docxMaterial("合成", { "word/evil.xml": strToU8('<!DOCTYPE test [<!ENTITY file SYSTEM "file:///not-readable">]><test>&file;</test>') })],
  ["excess text", docxMaterial("文".repeat(21000))],
])("DOCX rejects %s without creating project state", async (_label, bytes) => {
  await expect(extractDocxText(bytes)).rejects.toThrow();
});
test("extraction API checks owner, writes nothing, and extracted text enters normal confirmation", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成Word导入", passwordHash: "unused" } });
  const p = await db.project.create({ data: { title: "Word资料", goal: "交付说明", description: "合成", scenario: "RESEARCH", memberships: { create: { userId: u.id, role: "OWNER" } } } });
  const token = (await createSession(u.id)).token;
  const makeRequest = () => {
    const form = new FormData(); form.append("file", new File([Buffer.from(docxMaterial())], "客户brief.docx"));
    return new Request("http://localhost/api/projects/" + p.id + "/material-extract", { method: "POST", headers: { Authorization: "Bearer " + token }, body: form });
  };
  const result = await POST(makeRequest(), { params: Promise.resolve({ id: p.id }) });
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
  const value = await result.json(); expect(value.text).toContain("客户需求");
  expect(await db.capture.count({ where: { projectId: p.id } })).toBe(0);
  expect(await db.agentRun.count({ where: { projectId: p.id } })).toBe(0);
  expect(await db.agentMission.count({ where: { projectId: p.id } })).toBe(0);
  expect((await POST(makeRequest(), { params: Promise.resolve({ id: "another-project" }) })).status).toBe(404);
  const body = { goal: "整理客户交付说明", presetId: "client", materialName: value.name, materialText: value.text, expiresInDays: 7 };
  const preview = await previewV2Delegation(u.id, p.id, body);
  expect(preview.material.format).toBe("DOCX_TEXT");
  await confirmV2Delegation(u.id, p.id, { ...body, requestId: "docx-confirm", previewHash: preview.previewHash, expiresAt: preview.expiresAt });
  expect((await db.capture.findFirstOrThrow({ where: { projectId: p.id } })).rawText).toBe(value.text);
});

test("XLSX extraction API returns bounded cell text and enters normal confirmation", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成表格导入", passwordHash: "unused" } });
  const p = await db.project.create({ data: { title: "表格资料", goal: "发布说明", description: "合成", scenario: "RESEARCH", memberships: { create: { userId: u.id, role: "OWNER" } } } });
  const token = (await createSession(u.id)).token;
  const makeRequest = () => {
    const form = new FormData(); form.append("file", new File([Buffer.from(xlsxMaterial())], "发布记录.xlsx"));
    return new Request("http://localhost/api/projects/" + p.id + "/material-extract", { method: "POST", headers: { Authorization: "Bearer " + token }, body: form });
  };
  const result = await POST(makeRequest(), { params: Promise.resolve({ id: p.id }) });
  expect(result.status).toBe(200);
  const value = await result.json();
  expect(value.format).toBe("XLSX_TEXT");
  expect(value.text).toContain("工作表：发布记录");
  expect(value.text).toContain("系统分享");
  expect(await db.capture.count({ where: { projectId: p.id } })).toBe(0);
  const body = { goal: "整理发布说明", presetId: "client", materialName: value.name, materialText: value.text, expiresInDays: 7 };
  const preview = await previewV2Delegation(u.id, p.id, body);
  expect(preview.material.format).toBe("XLSX_TEXT");
  await confirmV2Delegation(u.id, p.id, { ...body, requestId: "xlsx-confirm", previewHash: preview.previewHash, expiresAt: preview.expiresAt });
  expect((await db.capture.findFirstOrThrow({ where: { projectId: p.id } })).rawText).toBe(value.text);
});
