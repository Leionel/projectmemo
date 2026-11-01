import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { commandPersonalMemory, listPersonalMemory, personalEntryDetail, type PersonalCommandInput } from "@/lib/memory/personalMemoryService";
import { admitPersonalMemory } from "@/lib/memory/personalAdmission";
import { readPolicy } from "@/lib/memory/userMemoryPolicy";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const commandSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  operation: z.enum(["ADD_EXPLICIT", "ADD_FROM_EXPRESSION", "UPDATE", "PAUSE", "RESUME", "WITHDRAW", "DELETE", "DELETE_ALL"]),
  expectedPolicyVersion: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().positive().optional(),
  claimId: z.string().min(1).max(64).optional(),
  quote: z.string().max(2000).optional(),
  kind: z.string().max(40).optional(),
  topics: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const url = new URL(request.url);
    const claimId = url.searchParams.get("claimId");
    if (claimId) return NextResponse.json(await personalEntryDetail(user.id, claimId));
    const includeStopped = url.searchParams.get("includeStopped") === "1";
    const list = await listPersonalMemory(user.id, { includeStopped });
    const policy = await readPolicy(user.id);
    return NextResponse.json({ ...list, policy: policy ? {
      useInContextEnabled: policy.useInContextEnabled, explicitCaptureEnabled: policy.explicitCaptureEnabled,
      candidateInferenceEnabled: policy.candidateInferenceEnabled, cloudProcessingEnabled: policy.cloudProcessingEnabled,
      settingsVersion: policy.settingsVersion, privacyRevision: policy.privacyRevision,
      extractionNotBefore: policy.extractionNotBefore?.toISOString() ?? null } : null });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const input = commandSchema.parse(await request.json()) as PersonalCommandInput;
    const result = await commandPersonalMemory(user.id, input);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

/** 表单提交前的即时准入预览：不落库，让用户在保存前看到分类与澄清问题。 */
export async function PUT(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const body = z.object({ quote: z.string().max(2000) }).parse(await request.json());
    void user;
    return NextResponse.json(admitPersonalMemory(body.quote));
  } catch (error) {
    return apiError(error);
  }
}
