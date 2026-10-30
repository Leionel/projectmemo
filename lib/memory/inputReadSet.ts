import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { record, type Tx } from "@/lib/conversation/repository";
export type ProjectInputRef = { projectId: string; revision: number; role: string };
/** Existing project mutation receipts advance this version; scans and model summaries do not. */
export async function assertProjectInputReadSet(userId: string, value: unknown, tx: Tx = db) {
  if (!Array.isArray(value)) return;
  if (value.length > 64) throw new AppError("COGNITIVE_RECOORDINATE", "输入范围过大，需要重新核对", 409);
  for (const raw of value) {
    const ref = record(raw);
    if (typeof ref.projectId !== "string" || !Number.isInteger(ref.revision)) throw new AppError("COGNITIVE_RECOORDINATE", "原输入版本不完整", 409);
    const member = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId, projectId: ref.projectId } }, include: { project: { select: { contextRevision: true } } } });
    if (!member || member.role !== ref.role || member.project.contextRevision !== ref.revision)
      throw new AppError("COGNITIVE_RECOORDINATE", "项目输入或权限已变化，正在重新协调", 409);
  }
}
