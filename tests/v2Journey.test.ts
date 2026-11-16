import { afterAll, beforeAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-journey"));
import fs from "node:fs";
import { db } from "@/lib/db";

beforeAll(() => {
  Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true",
    MISSION_INVESTIGATION_DELEGATION_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true" });
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

test("continuous revision journey: first draft, new material, restriction, redirect, delivered versions and pause", async () => {
  const { JOURNEYS, runJourney } = await import("@/lib/evaluation/journey");
  const { protocolChecks, contentChecks } = await import("@/lib/evaluation/journeyChecks");
  const definition = JOURNEYS.find(journey => journey.id === "developer")!;
  const record = await runJourney(definition, "fixture", { tokenCeiling: 200000, modelCeiling: 40 });
  expect(record.failures).toEqual([]);
  expect(record.versions).toHaveLength(3);
  expect(record.versions.map(version => version.revision)).toEqual([1, 2, 3]);
  expect(record.versions[1].sourceRefs.map(ref => ref.id)).toEqual(expect.arrayContaining(record.versionIds));
  expect(protocolChecks(record).filter(check => !check.passed)).toEqual([]);
  expect(contentChecks(record).filter(check => !check.passed)).toEqual([]);
}, 120000);

test("decision hooks record usage and refuse dispatch before an authorized token window is exceeded", async () => {
  const { JOURNEYS, runJourney } = await import("@/lib/evaluation/journey");
  const { AppError } = await import("@/lib/api");
  const definition = JOURNEYS.find(journey => journey.id === "research")!;
  let guardCalls = 0, usageCalls = 0, tokens = 0;
  const record = await runJourney(definition, "fixture", { tokenCeiling: 200000, modelCeiling: 40,
    beforeDecision: () => { guardCalls++; if (guardCalls > 2) throw new AppError("EVAL_TOKEN_BUDGET", "评测 token 预算已达授权上限，停止下一次派发", 409); },
    onDecisionUsage: usage => { usageCalls++; tokens += Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0); } });
  expect(usageCalls).toBe(2);
  expect(tokens).toBe(60);
  expect(guardCalls).toBeGreaterThan(usageCalls);
  expect(record.failures.length).toBeGreaterThan(0);
}, 120000);

test("pause and cancel end dispatch while delivered versions stay readable", async () => {
  const { JOURNEYS, runJourney } = await import("@/lib/evaluation/journey");
  const definition = JOURNEYS.find(journey => journey.id === "course")!;
  const record = await runJourney(definition, "fixture", { tokenCeiling: 200000, modelCeiling: 40 });
  expect(record.control.ending).toMatchObject({ action: "cancel", status: "CANCELLED", extraDispatch: false, outputCountAfter: 3 });
  expect(record.versions).toHaveLength(3);
}, 120000);
