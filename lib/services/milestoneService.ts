import { db } from "@/lib/db";
import { requireProject } from "@/lib/repositories/projects";
import { AppError } from "@/lib/api";
import { getMissingEvidenceTypes } from "@/lib/milestones/evidenceGap";

export interface CreateMilestoneInput {
  projectId: string;
  title: string;
  targetDate?: string | null;
  deliverables?: Array<{
    title: string;
    expectedEvidence: string[];
  }>;
}

export interface ConfirmDeliverableEvidenceInput {
  projectId: string;
  deliverableId: string;
  evidenceType: string;
  cardId?: string | null;
  attachmentId?: string | null;
  confirmed: boolean;
}

function parseExpectedEvidence(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

export async function confirmDeliverableEvidence(input: ConfirmDeliverableEvidenceInput) {
  await requireProject(input.projectId);

  const evidenceType = input.evidenceType.trim();
  const hasCard = Boolean(input.cardId);
  const hasAttachment = Boolean(input.attachmentId);
  if (hasCard === hasAttachment) {
    throw new AppError("EVIDENCE_SOURCE_REQUIRED", "一次只能关联一张卡片或一个附件", 422);
  }

  return db.$transaction(async (tx) => {
    const deliverable = await tx.deliverable.findFirst({
      where: { id: input.deliverableId, milestone: { projectId: input.projectId } },
      include: { milestone: { select: { id: true } }, evidences: true },
    });
    if (!deliverable) throw new AppError("DELIVERABLE_NOT_FOUND", "交付物不属于当前项目", 404);

    const expectedTypes = parseExpectedEvidence(deliverable.expectedEvidence);
    if (!expectedTypes.includes(evidenceType)) {
      throw new AppError("EVIDENCE_NOT_EXPECTED", "该证据类型不在交付物的期望证据清单中", 422, { expectedTypes });
    }

    if (input.cardId) {
      const card = await tx.knowledgeCard.findFirst({ where: { id: input.cardId, projectId: input.projectId } });
      if (!card) throw new AppError("CARD_NOT_FOUND", "知识卡片不属于当前项目", 404);
    }
    if (input.attachmentId) {
      const attachment = await tx.attachment.findFirst({ where: { id: input.attachmentId, projectId: input.projectId } });
      if (!attachment) throw new AppError("ATTACHMENT_NOT_FOUND", "附件不属于当前项目", 404);
    }

    const existing = deliverable.evidences.find((evidence) =>
      evidence.evidenceType === evidenceType &&
      evidence.cardId === (input.cardId ?? null) &&
      evidence.attachmentId === (input.attachmentId ?? null));
    const evidence = existing
      ? await tx.deliverableEvidence.update({ where: { id: existing.id }, data: { confirmed: input.confirmed } })
      : await tx.deliverableEvidence.create({
        data: {
          deliverableId: input.deliverableId,
          evidenceType,
          cardId: input.cardId ?? null,
          attachmentId: input.attachmentId ?? null,
          confirmed: input.confirmed,
        },
      });

    const allEvidence = existing
      ? deliverable.evidences.map((item) => item.id === existing.id ? { ...item, confirmed: input.confirmed } : item)
      : [...deliverable.evidences, evidence];
    const missing = getMissingEvidenceTypes(expectedTypes, allEvidence);
    await tx.deliverable.update({
      where: { id: deliverable.id },
      data: { status: missing.length === 0 ? "COMPLETED" : "IN_PROGRESS" },
    });

    const siblingDeliverables = await tx.deliverable.findMany({ where: { milestoneId: deliverable.milestone.id } });
    const milestoneComplete = siblingDeliverables.length > 0 && siblingDeliverables.every((item) =>
      item.id === deliverable.id ? missing.length === 0 : item.status === "COMPLETED");
    await tx.milestone.update({
      where: { id: deliverable.milestone.id },
      data: { status: milestoneComplete ? "COMPLETED" : "IN_PROGRESS" },
    });

    return evidence;
  });
}

export async function listProjectMilestones(projectId: string) {
  await requireProject(projectId);
  return db.milestone.findMany({
    where: { projectId },
    include: {
      deliverables: {
        include: {
          evidences: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createProjectMilestone(input: CreateMilestoneInput) {
  const { projectId, title, targetDate, deliverables = [] } = input;
  await requireProject(projectId);

  return db.milestone.create({
    data: {
      projectId,
      title,
      targetDate: targetDate ? new Date(targetDate) : null,
      status: "IN_PROGRESS",
      deliverables: {
        create: deliverables.map((d) => ({
          title: d.title,
          expectedEvidence: JSON.stringify(d.expectedEvidence),
          status: "PENDING",
        })),
      },
    },
    include: {
      deliverables: true,
    },
  });
}

export async function ensureDefaultMilestones(projectId: string) {
  const existing = await db.milestone.findFirst({ where: { projectId } });
  if (existing) return;

  const project = await requireProject(projectId);
  const targetDate = project.deadline ? new Date(project.deadline) : new Date(Date.now() + 7 * 86400000);

  await createProjectMilestone({
    projectId,
    title: "初赛作品材料提交与证据锁定",
    targetDate: targetDate.toISOString(),
    deliverables: [
      {
        title: "算法方案与消融实验记录",
        expectedEvidence: ["experiment_log", "code_issue"],
      },
      {
        title: "理论背景与文献创新点沉淀",
        expectedEvidence: ["paper_note"],
      },
      {
        title: "参赛答辩 PPT 与材料大纲",
        expectedEvidence: ["requirement", "reflection"],
      },
    ],
  });
}

export async function listProjectDeliverables(projectId: string) {
  await requireProject(projectId);
  return db.deliverable.findMany({
    where: { milestone: { projectId } },
    include: { evidences: true, milestone: { select: { id: true, title: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
}
