import { writeTransaction } from "@/lib/copilot/confirmation";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertProject, type Tx } from "@/lib/conversation/repository";
import type { ConversationActor } from "@/lib/types/conversation";
import { directiveScopeSchema } from "@/lib/types/continuity";
import { json, jsonHash } from "@/lib/mission/contracts";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { invalidateContinuityConsumers } from "@/lib/continuity/invalidation";
import { claimOriginSchema, claimTextHash, validateClaimLocator } from "./claimLocator";
import { claimControlState } from "./claimEffective";
import { readClaimSourceText } from "./claimReadable";

const commandSchema = z.object({ requestId: z.string().min(1).max(128), scope: directiveScopeSchema,
  expectedSeq: z.number().int().nonnegative(), expectedOwnerUserId: z.string().min(1).max(180).optional(), expectedRevision: z.number().int().positive().optional(),
  origin: claimOriginSchema, operation: z.enum(["CORRECT", "WITHDRAW"]),
  userQuote: z.string().trim().min(1).max(2000).optional(), validUntil: z.string().datetime().optional(),
}).strict();

export async function resolveClaimText(actor: ConversationActor, projectId: string, kind: string, id: string, tx: Tx = db) {
  await assertProject(actor, projectId, tx);
  const text = await readClaimSourceText(actor.userId, projectId, kind, id, tx);
  if (text === undefined) throw new AppError("CLAIM_SOURCE_NOT_FOUND", "原内容不存在或不可访问", 404);
  return { kind, id, text, contentHash: claimTextHash(text), offsetEncoding: "UTF16_CODE_UNITS" as const, normalization: "RAW_V1" as const };
}

export async function correctClaim(actor: ConversationActor, raw: unknown) {
  const input = commandSchema.parse(raw), payloadHash = jsonHash(input);
  if (input.expectedOwnerUserId && input.expectedOwnerUserId !== actor.userId) throw new AppError("ACCOUNT_CHANGED", "账号已变化，请重新核对后提交", 409);
  if (input.operation === "CORRECT" && !input.userQuote) throw new AppError("CORRECTION_REQUIRED", "请说明这句话应怎样理解", 422);
  return writeTransaction("claim-control:" + actor.userId, async tx => {
    await assertProject(actor, input.scope.projectId, tx);
    await tx.user.updateMany({ where: { id: actor.userId }, data: { continuitySeq: { increment: 0 } } });
    const previous = await tx.agentClaimEvent.findUnique({ where: { ownerUserId_requestId: { ownerUserId: actor.userId, requestId: input.requestId } } });
    if (previous) {
      if (previous.payloadHash !== payloadHash) throw new AppError("REQUEST_CONFLICT", "该请求编号已用于其他内容", 409);
      return { claimId: previous.claimId, eventId: previous.id, revision: previous.revision, seq: previous.controlSeq };
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.continuitySeq !== input.expectedSeq) throw new AppError("DIRECTIVE_CHANGED", "另一端已调整理解或工作指引，请核对后重试", 409);
    if (input.scope.conversationId && !await tx.conversation.findFirst({ where: { id: input.scope.conversationId, ownerUserId: actor.userId,
      OR: [{ homeProjectId: input.scope.projectId }, { projects: { some: { projectId: input.scope.projectId } } }] } }))
      throw new AppError("CONVERSATION_NOT_FOUND", "讨论不存在或不可访问", 404);
    if (input.scope.missionId && !await tx.agentMission.findFirst({ where: { id: input.scope.missionId, projectId: input.scope.projectId, ownerUserId: actor.userId } }))
      throw new AppError("MISSION_NOT_FOUND", "委托不存在或不可访问", 404);
    const origin = input.origin;
    const scopeKey = jsonHash(input.scope), originKey = jsonHash(origin);
    let claim = await tx.agentClaim.findUnique({ where: { ownerUserId_scopeKey_originKey: { ownerUserId: actor.userId, scopeKey, originKey } } });
    if (claim && claim.currentRevision !== input.expectedRevision) throw new AppError("CLAIM_CHANGED", "这条理解已更新，请重读后操作", 409);
    if (!claim && (input.expectedRevision || input.operation === "WITHDRAW")) throw new AppError("CLAIM_CHANGED", "原纠正记录不存在，请重新核对", 409);
    if (input.operation === "CORRECT") {
      const source = await resolveClaimText(actor, input.scope.projectId, origin.kind, origin.id, tx);
      validateClaimLocator(source.text, origin);
    }
    const until = input.operation === "CORRECT" && input.validUntil ? new Date(input.validUntil) : null;
    if (until && +until <= Date.now()) throw new AppError("CORRECTION_EXPIRED", "有效期已过，请重新核对", 422);
    if (!claim) claim = await tx.agentClaim.create({ data: { ownerUserId: actor.userId, projectId: input.scope.projectId,
      scopeKey, conversationId: input.scope.conversationId, missionId: input.scope.missionId, originKey,
      originJson: json(origin), kind: "INTERPRETATION", canonicalStatement: origin.quote, conditionsJson: {} } });
    const revision = input.expectedRevision ? input.expectedRevision + 1 : 1;
    const event = await tx.agentClaimEvent.create({ data: { claimId: claim.id, ownerUserId: actor.userId, revision,
      requestId: input.requestId, payloadHash, eventKind: input.operation === "CORRECT" ? "USER_CORRECTION" : "WITHDRAW_CORRECTION",
      actorKind: "USER", userQuote: input.userQuote, targetHash: origin.contentHash, evidenceManifestJson: [], assessmentJson: {},
      validUntil: until, controlSeq: user.continuitySeq + 1 } });
    await tx.agentClaim.update({ where: { id: claim.id }, data: { currentRevision: revision } });
    await tx.user.update({ where: { id: actor.userId }, data: { continuitySeq: { increment: 1 } } });
    await invalidateContinuityConsumers(tx, actor.userId, input.scope, [event.id]);
    return { claimId: claim.id, eventId: event.id, revision, seq: event.controlSeq };
  });
}

export async function readClaimCorrections(actor: ConversationActor, projectId: string) {
  return db.$transaction(async tx => {
    await assertProject(actor, projectId, tx);
    const scope = { projectId }, state = await claimControlState(actor.userId, scope, tx);
    const view = await effectiveContinuity(actor.userId, scope, tx);
    const corrections: typeof state.corrections = [];
    for (const correction of state.corrections) {
      const claim = await tx.agentClaim.findFirst({ where: { id: correction.claimId, projectId, ownerUserId: actor.userId } });
      if (claim && await readClaimSourceText(actor.userId, projectId, "CLAIM", claim.id, tx) !== undefined) corrections.push(correction);
    }
    return { ...state, corrections, ownerUserId: actor.userId, seq: view.seq, reusePolicyHash: view.reusePolicyHash, nextBoundary: view.nextBoundary };
  });
}
