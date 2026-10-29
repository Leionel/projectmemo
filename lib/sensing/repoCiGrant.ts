import { z } from "zod";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash } from "@/lib/mission/contracts";
import { writeTransaction } from "@/lib/copilot/confirmation";

const schema = z.object({ requestId: z.string().min(1).max(128), expectedRevision: z.number().int().nonnegative(),
  access: z.enum(["COMMITS", "COMMITS_AND_CI", "COMMITS_CI_LOGS"]), confirmed: z.literal(true) }).strict();
/** Explicit connection control, never a model-generated grant. Receipt and revision change commit together. */
export async function grantRepositoryCiAccess(userId: string, projectId: string, connectionId: string, raw: unknown) {
  const input = schema.parse(raw), hash = jsonHash({ projectId, connectionId, input });
  if (input.access !== "COMMITS" && !isFeatureEnabled("REPO_CI_OBSERVER_ENABLED", false)) throw new AppError("CI_OBSERVER_DISABLED", "CI 观察暂未开启", 503);
  return writeTransaction("repo-ci-grant:" + connectionId, async tx => {
    await tx.user.updateMany({ where: { id: userId }, data: { continuitySeq: { increment: 0 } } });
    if (!await tx.projectMembership.findFirst({ where: { userId, projectId, role: "OWNER" } })) throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不可访问", 404);
    const c = await tx.sourceConnection.findFirst({ where: { id: connectionId, ownerUserId: userId, projectId } });
    if (!c) throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不可访问", 404);
    const receiptId = "repo-ci-grant:" + jsonHash({ userId, requestId: input.requestId });
    const prior = await tx.agentRun.findUnique({ where: { id: receiptId } });
    if (prior) { if ((prior.trace as { hash?: string }).hash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他授权", 409); return prior.resultJson; }
    if (c.status !== "ACTIVE" || c.revokedAt || c.revision !== input.expectedRevision) throw new AppError("CONNECTION_CHANGED", "连接或授权已变化，请刷新", 409);
    const updated = await tx.sourceConnection.update({ where: { id: c.id }, data: { signalKind: input.access, revision: { increment: 1 } } });
    const result = { connectionId: c.id, revision: updated.revision, access: updated.signalKind };
    await tx.agentRun.create({ data: { id: receiptId, projectId, runType: "CHAT", status: "SUCCESS", provider: "USER_CONFIRMED_CONNECTION_CONTROL",
      trace: json({ hash, userId, connectionId, previous: c.signalKind, access: input.access }), resultJson: json(result) } });
    return result;
  });
}
