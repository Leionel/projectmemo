import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { invalidateContinuityConsumers } from "@/lib/continuity/invalidation";
import { deleteAttachmentFile, listProjectAttachmentFiles } from "@/lib/storage/attachmentStorage";

// 清理责任复用 AgentRun 的原幂等回执，projectId=null 使无正文回执在项目级联后仍可查询。
const provider = "project-deletion-v1";
function identity(ownerId: string, projectId: string) { return `${ownerId}:${projectId}`; }
function view(run: { id: string; resultJson: unknown }) {
  const result = record(run.resultJson);
  return { receiptId: run.id, status: String(result.status ?? "PENDING"),
    filesRemaining: Number(result.filesRemaining ?? 0),
    message: result.status === "COMPLETED" ? "项目和应用附件已清除；独立备份与外部副本不在此次清除范围。" : "项目已停用，附件清理待完成；可在项目列表的清除进度中查看。" };
}
export async function projectDeletionStatus(ownerId: string, projectId: string) {
  const run = await db.agentRun.findUnique({ where: { provider_externalRequestId: { provider, externalRequestId: identity(ownerId, projectId) } } });
  if (!run) throw new AppError("PROJECT_NOT_FOUND", "没有可访问的清除回执", 404);
  return view(run);
}
export async function listProjectDeletions(ownerId: string) {
  const rows = await db.agentRun.findMany({ where: { provider, externalRequestId: { startsWith: `${ownerId}:` },
    OR: [{ status: "PARTIAL" }, { createdAt: { gte: new Date(Date.now() - 86_400_000) } }] },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 20 });
  return rows.map(run => ({ ...view(run), projectId: String(record(run.trace).deletedProjectId) }));
}
export async function requestProjectDeletion(ownerId: string, projectId: string, confirmation: string, expectedVersion: string, sessionId: string) {
  return db.$transaction(async tx => {
    await tx.user.updateMany({ where: { id: ownerId }, data: { continuitySeq: { increment: 0 } } });
    if (!await tx.authSession.findFirst({ where: { id: sessionId, userId: ownerId, revokedAt: null, expiresAt: { gt: new Date() } } }))
      throw new AppError("UNAUTHORIZED", "登录状态已变化，未继续删除", 401);
    const key = { provider, externalRequestId: identity(ownerId, projectId) };
    const previous = await tx.agentRun.findUnique({ where: { provider_externalRequestId: key } });
    if (previous) return view(previous);
    // User 写入已取得 SQLite 写槽；不要用 Project 空更新使 @updatedAt 自行变化，破坏待核对版本。
    const member = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId: ownerId, projectId } } });
    if (!member) throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);
    if (member.role !== "OWNER") throw new AppError("PROJECT_OWNER_REQUIRED", "只有项目所有者可以删除项目", 403);
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (confirmation !== projectId || !expectedVersion) throw new AppError("DELETE_CONFIRMATION_REQUIRED", "请刷新项目后明确确认删除", 428);
    if (expectedVersion !== project.updatedAt.toISOString()) throw new AppError("PROJECT_CHANGED", "项目已变化，请刷新后重新确认删除", 409);
    const members = await tx.projectMembership.findMany({ where: { projectId }, select: { userId: true } });
    const files = await tx.attachment.findMany({ where: { projectId }, select: { storageKey: true } });
    // 只属于本项目的讨论会随项目清除；其中“仅用于本次讨论”的附件原件一并进入文件清理清单。
    const conversationFiles = await tx.conversationAttachment.findMany({ where: { conversation: { projects: { some: { projectId }, every: { projectId } } } }, select: { storageKey: true } });
    const storageFiles = [...new Set([...files.map(f => f.storageKey), ...conversationFiles.map(f => f.storageKey), ...await listProjectAttachmentFiles(projectId)])];
    for (const member of members) await invalidateContinuityConsumers(tx, member.userId, { projectId }, ["PROJECT_DELETION"], true);
    await tx.project.update({ where: { id: projectId }, data: { deletionRequestedAt: new Date(), contextRevision: { increment: 1 } } });
    // 立即撤销项目消费资格，清理失败也不能恢复旧权限或继续模型/外部派发。
    await tx.projectMembership.deleteMany({ where: { projectId } });
    const run = await tx.agentRun.create({ data: { ...key, runType: "ACTION", status: "PARTIAL", projectId: null,
      trace: { ownerId, deletedProjectId: projectId, files: storageFiles },
      resultJson: { status: "PENDING", filesRemaining: storageFiles.length, attempts: 0 } } });
    return view(run);
  });
}

/** 有界清理加入原 Worker；文件移除幂等，失败保留清单及原回执，不先丢失清理身份。 */
export async function processProjectDeletions(limit = 5, removeFile = deleteAttachmentFile, now = Date.now()) {
  const runs = await db.agentRun.findMany({ where: { provider, status: "PARTIAL", OR: [
    { confirmedAt: null }, { confirmedAt: { lt: new Date(now - 300_000) } },
  ] }, orderBy: { createdAt: "asc" }, take: limit });
  for (const run of runs) {
    const lease = new Date(now);
    const acquired = await db.agentRun.updateMany({ where: { id: run.id, status: "PARTIAL", confirmedAt: run.confirmedAt }, data: { confirmedAt: lease } });
    if (!acquired.count) continue;
    const trace = record(run.trace), result = record(run.resultJson);
    const files = Array.isArray(trace.files) ? trace.files.filter((key): key is string => typeof key === "string") : [];
    const remaining: string[] = files.slice(50);
    let failedFiles = 0;
    for (const file of files.slice(0, 50)) {
      try { await removeFile(file); } catch { remaining.push(file); failedFiles++; }
    }
    await db.$transaction(async tx => {
      const current = await tx.agentRun.findUnique({ where: { id: run.id } });
      if (!current || current.confirmedAt?.getTime() !== lease.getTime() || current.status !== "PARTIAL") return;
      const projectId = String(trace.deletedProjectId);
      if (!remaining.length) {
        const project = await tx.project.findUnique({ where: { id: projectId } });
        if (project && !project.deletionRequestedAt) throw new AppError("DELETION_FENCE_MISSING", "清除状态不一致，未继续删除", 409);
        // 已停止的原委托/来源/派生项目对象沿原外键级联清除；不删除账户个人记忆。
        await tx.conversation.deleteMany({ where: { projects: { some: { projectId }, every: { projectId } } } });
        await tx.project.deleteMany({ where: { id: projectId, deletionRequestedAt: { not: null } } });
      }
      // 文件故障沿原五分钟过期租约退避，避免最早的失败项目占满每一轮清理批次。
      await tx.agentRun.update({ where: { id: run.id }, data: { status: remaining.length ? "PARTIAL" : "SUCCESS", confirmedAt: failedFiles ? lease : null,
        trace: { ...trace, files: remaining },
        resultJson: { status: remaining.length ? "PENDING" : "COMPLETED", filesRemaining: remaining.length,
          attempts: Number(result.attempts ?? 0) + 1, ...(remaining.length ? { reason: "FILE_CLEANUP_PENDING" } : { completedAt: new Date().toISOString() }) } } });
    });
  }
  return runs.length;
}
