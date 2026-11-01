import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { policyInTx } from "@/lib/memory/userMemoryPolicy";
import { invalidatePersonalMemoryConsumers } from "@/lib/memory/personalInvalidation";

export const runtime = "nodejs";

const policySchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().positive().optional(),
  useInContextEnabled: z.boolean().optional(),
  cloudProcessingEnabled: z.boolean().optional(),
  candidateInferenceEnabled: z.boolean().optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const policy = await db.userMemoryPolicy.findUnique({ where: { ownerUserId: user.id } });
    return NextResponse.json({ policy: policy ?? null, explanation: {
      useInContext: "保存的条目才会进入你自己的对话与委托上下文；关闭后项目资料与原任务照常可用。",
      cloudProcessing: "账户个人正文默认不发给远端模型或检索服务；开启后仍受当轮原有云模型许可约束。",
      candidates: "模型归纳的候选理解默认关闭；显式保存不受影响。" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const input = policySchema.parse(await request.json());
    const payloadHash = JSON.stringify(input);
    const result = await db.$transaction(async tx => {
      await tx.user.updateMany({ where: { id: user.id }, data: { continuitySeq: { increment: 0 } } });
      const prior = await tx.userMemoryControlReceipt.findUnique({ where: { ownerUserId_requestId: { ownerUserId: user.id, requestId: input.requestId } } });
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new Error("REQUEST_CONFLICT");
        return { replayed: true, policy: await tx.userMemoryPolicy.findUniqueOrThrow({ where: { ownerUserId: user.id } }) };
      }
      const current = await policyInTx(tx, user.id);
      if (input.expectedVersion !== undefined && input.expectedVersion !== current.settingsVersion) throw new Error("POLICY_CHANGED");
      const policy = await tx.userMemoryPolicy.update({ where: { ownerUserId: user.id }, data: {
        ...(input.useInContextEnabled !== undefined ? { useInContextEnabled: input.useInContextEnabled } : {}),
        ...(input.cloudProcessingEnabled !== undefined ? { cloudProcessingEnabled: input.cloudProcessingEnabled } : {}),
        ...(input.candidateInferenceEnabled !== undefined ? { candidateInferenceEnabled: input.candidateInferenceEnabled } : {}),
        settingsVersion: { increment: 1 }, privacyRevision: { increment: 1 } } });
      // 策略变化也是三类变更之一：同步推进 privacyRevision，并让所有活跃消费者重协调。
      await invalidatePersonalMemoryConsumers(tx, user.id, ["policy:" + policy.settingsVersion]);
      await tx.userMemoryControlReceipt.create({ data: { ownerUserId: user.id, requestId: input.requestId, operation: "POLICY_UPDATE",
        payloadHash, resultVersionJson: { policyVersion: policy.settingsVersion, privacyRevision: policy.privacyRevision }, purgeJson: {} } });
      return { replayed: false, policy };
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "REQUEST_CONFLICT") throw Object.assign(new Error("该请求编号已用于其他内容"), { name: "RequestConflict" });
      if (error instanceof Error && error.message === "POLICY_CHANGED") throw Object.assign(new Error("记忆使用策略已变化，请核对后重试"), { name: "PolicyChanged" });
      throw error;
    });
    return NextResponse.json({ replayed: result.replayed, policy: { settingsVersion: result.policy.settingsVersion, privacyRevision: result.policy.privacyRevision,
      useInContextEnabled: result.policy.useInContextEnabled, cloudProcessingEnabled: result.policy.cloudProcessingEnabled,
      candidateInferenceEnabled: result.policy.candidateInferenceEnabled } });
  } catch (error) {
    return apiError(error);
  }
}
