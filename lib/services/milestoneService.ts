import { db } from "@/lib/db";
import { requireProject } from "@/lib/repositories/projects";

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

export async function confirmDeliverableEvidence(input: ConfirmDeliverableEvidenceInput) {
  await requireProject(input.projectId);
  const deliverable = await db.deliverable.findFirst({
    where: { id: input.deliverableId, milestone: { projectId: input.projectId } },
  });
  if (!deliverable) throw new Error("Deliverable not found in this project");

  if (!input.cardId && !input.attachmentId) {
    throw new Error("A cardId or attachmentId is required");
  }
  if (input.cardId) {
    const card = await db.knowledgeCard.findFirst({ where: { id: input.cardId, projectId: input.projectId } });
    if (!card) throw new Error("Knowledge card not found in this project");
  }
  if (input.attachmentId) {
    const attachment = await db.attachment.findFirst({ where: { id: input.attachmentId, projectId: input.projectId } });
    if (!attachment) throw new Error("Attachment not found in this project");
  }

  const existing = await db.deliverableEvidence.findFirst({
    where: {
      deliverableId: input.deliverableId,
      evidenceType: input.evidenceType,
      cardId: input.cardId ?? null,
      attachmentId: input.attachmentId ?? null,
    },
  });
  if (existing) {
    return db.deliverableEvidence.update({
      where: { id: existing.id },
      data: { confirmed: input.confirmed },
    });
  }
  return db.deliverableEvidence.create({
    data: {
      deliverableId: input.deliverableId,
      evidenceType: input.evidenceType,
      cardId: input.cardId ?? null,
      attachmentId: input.attachmentId ?? null,
      confirmed: input.confirmed,
    },
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
