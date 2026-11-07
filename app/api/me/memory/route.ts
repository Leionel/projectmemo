import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { commandPersonalMemory, listPersonalMemory, listPendingCandidates, personalEntryDetail, type PersonalCommandInput } from "@/lib/memory/personalMemoryService";
import { admitPersonalMemory } from "@/lib/memory/personalAdmission";
import { readPolicy } from "@/lib/memory/userMemoryPolicy";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const commandSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  operation: z.enum(["ADD_EXPLICIT", "ADD_FROM_EXPRESSION", "UPDATE", "PAUSE", "RESUME", "WITHDRAW", "DELETE", "DELETE_ALL", "CONFIRM_CANDIDATE", "REJECT_CANDIDATE"]),
  expectedPolicyVersion: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().positive().optional(),
  claimId: z.string().min(1).max(64).optional(),
  quote: z.string().max(2000).optional(),
  kind: z.string().max(40).optional(),
  topics: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  frozenContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  confirmedStatement: z.string().max(2000).optional(),
  useScope: z.object({ mode: z.enum(["ALL", "PROJECTS"]), projectIds: z.array(z.string().max(64)).max(8).optional() }).strict().optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const url = new URL(request.url);
    const claimId = url.searchParams.get("claimId");
    if (claimId) return NextResponse.json(await personalEntryDetail(user.id, claimId));
    if (url.searchParams.get("candidates") === "1") return NextResponse.json(await listPendingCandidates(user.id));
    const includeStopped = url.searchParams.get("includeStopped") === "1";
    const list = await listPersonalMemory(user.id, { includeStopped });
    const policy = await readPolicy(user.id);
    // 账号还没有策略行时按数据库默认值返回，否则客户端的开关会全部显示为关闭且不可操作。
    return NextResponse.json({ ...list, policy: {
      useInContextEnabled: policy?.useInContextEnabled ?? true, explicitCaptureEnabled: policy?.explicitCaptureEnabled ?? true,
      candidateInferenceEnabled: policy?.candidateInferenceEnabled ?? false, expressionSuggestEnabled: policy?.expressionSuggestEnabled ?? true,
      cloudProcessingEnabled: policy?.cloudProcessingEnabled ?? false, settingsVersion: policy?.settingsVersion ?? 1, privacyRevision: policy?.privacyRevision ?? 1,
      extractionNotBefore: policy?.extractionNotBefore?.toISOString() ?? null } });
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
