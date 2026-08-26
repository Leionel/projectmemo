import { describe, it, expect } from "vitest";
import { evaluateProjectContext } from "@/lib/services/agentContextService";
import { confirmDeliverableEvidence, createProjectMilestone } from "@/lib/services/milestoneService";
import { db } from "@/lib/db";
import { getMissingEvidenceTypes } from "@/lib/milestones/evidenceGap";

const ruleCases: Array<[string, string[], Array<{ evidenceType: string; confirmed: boolean }>, string[]]> = [
  ["empty", [], [], []],
  ["one missing", ["a"], [], ["a"]],
  ["one confirmed", ["a"], [{ evidenceType: "a", confirmed: true }], []],
  ["unconfirmed ignored", ["a"], [{ evidenceType: "a", confirmed: false }], ["a"]],
  ["wrong type", ["a"], [{ evidenceType: "b", confirmed: true }], ["a"]],
  ["two missing", ["a", "b"], [], ["a", "b"]],
  ["first confirmed", ["a", "b"], [{ evidenceType: "a", confirmed: true }], ["b"]],
  ["second confirmed", ["a", "b"], [{ evidenceType: "b", confirmed: true }], ["a"]],
  ["both confirmed", ["a", "b"], [{ evidenceType: "a", confirmed: true }, { evidenceType: "b", confirmed: true }], []],
  ["mixed confirmations", ["a", "b"], [{ evidenceType: "a", confirmed: false }, { evidenceType: "b", confirmed: true }], ["a"]],
  ["duplicate expected", ["a", "a"], [], ["a"]],
  ["duplicate evidence", ["a"], [{ evidenceType: "a", confirmed: true }, { evidenceType: "a", confirmed: true }], []],
  ["blank expected", ["", "a"], [], ["a"]],
  ["blank evidence", ["a"], [{ evidenceType: "", confirmed: true }], ["a"]],
  ["trim expected", [" a "], [{ evidenceType: "a", confirmed: true }], []],
  ["trim evidence", ["a"], [{ evidenceType: " a ", confirmed: true }], []],
  ["case sensitive", ["PDF"], [{ evidenceType: "pdf", confirmed: true }], ["PDF"]],
  ["experiment confirmed", ["experiment_log"], [{ evidenceType: "experiment_log", confirmed: true }], []],
  ["paper unconfirmed", ["paper_note"], [{ evidenceType: "paper_note", confirmed: false }], ["paper_note"]],
  ["attachment type", ["pdf_attachment"], [{ evidenceType: "pdf_attachment", confirmed: true }], []],
  ["three all missing", ["a", "b", "c"], [], ["a", "b", "c"]],
  ["three one missing", ["a", "b", "c"], [{ evidenceType: "a", confirmed: true }, { evidenceType: "c", confirmed: true }], ["b"]],
  ["three two missing", ["a", "b", "c"], [{ evidenceType: "b", confirmed: true }], ["a", "c"]],
  ["extra evidence", ["a"], [{ evidenceType: "x", confirmed: true }, { evidenceType: "a", confirmed: true }], []],
  ["extra unconfirmed", ["a"], [{ evidenceType: "x", confirmed: false }], ["a"]],
  ["later confirmed wins", ["a"], [{ evidenceType: "a", confirmed: false }, { evidenceType: "a", confirmed: true }], []],
  ["later false does not revoke", ["a"], [{ evidenceType: "a", confirmed: true }, { evidenceType: "a", confirmed: false }], []],
  ["unicode type", ["实验记录"], [{ evidenceType: "实验记录", confirmed: true }], []],
  ["unicode mismatch", ["实验记录"], [{ evidenceType: "论文笔记", confirmed: true }], ["实验记录"]],
  ["preserve expected order", ["c", "a", "b"], [{ evidenceType: "a", confirmed: true }], ["c", "b"]],
];

describe("S06: Deliverable Gap Detection and Evidence Spine Generation", () => {
  it.each(ruleCases)("evaluates evidence rule: %s", (_name, expected, evidences, missing) => {
    expect(getMissingEvidenceTypes(expected, evidences)).toEqual(missing);
  });

  it("should trigger DELIVERABLE_GAP when active milestone deliverables lack expected evidence", async () => {
    const testProject = await db.project.create({
      data: {
        title: "Deliverable Gap Test Project",
        description: "Testing deliverable gap detection",
        goal: "Verify milestone and evidence gap rules",
        scenario: "COMPETITION",
      },
    });

    try {
      // 创建里程碑：要求 experiment_log 证据
      const milestone = await createProjectMilestone({
        projectId: testProject.id,
        title: "核心算法验证",
        deliverables: [
          {
            title: "消融实验基线评测",
            expectedEvidence: ["experiment_log"],
          },
        ],
      });

      // 首次评估：缺少 experiment_log，应触发 DELIVERABLE_GAP
      const eval1 = await evaluateProjectContext(testProject.id);
      const gapIntervention1 = eval1.interventions.find((i) => i.triggerType === "DELIVERABLE_GAP");

      expect(gapIntervention1).toBeDefined();
      expect(gapIntervention1?.title).toContain("消融实验基线评测");
      expect(gapIntervention1?.severity).toBe(4);
      const evidence = gapIntervention1?.evidence as { facts?: string[] } | null;
      expect(evidence?.facts?.some((fact: string) => fact.includes("当前缺失证据"))).toBe(true);

      // 补充符合期望的 experiment_log 卡片
      const capture = await db.capture.create({
        data: { projectId: testProject.id, rawText: "完成了对比 Baseline 模型的消融实验记录" },
      });
      const card = await db.knowledgeCard.create({
        data: {
          projectId: testProject.id,
          captureId: capture.id,
          type: "experiment_log",
          title: "消融实验记录一",
          summary: "消融实验对比结果",
          keywords: ["消融", "实验"],
          relatedTasks: [],
          nextActions: [],
          importance: 4,
        },
      });

      // 仅仅存在同类型卡片不能消除缺口：必须明确关联并由用户确认。
      const eval2 = await evaluateProjectContext(testProject.id);
      const gapIntervention2 = eval2.created.find((i) => i.triggerType === "DELIVERABLE_GAP");
      expect(gapIntervention2).toBeDefined();

      await confirmDeliverableEvidence({
        projectId: testProject.id,
        deliverableId: milestone.deliverables[0].id,
        evidenceType: "experiment_log",
        cardId: card.id,
        confirmed: true,
      });
      const eval3 = await evaluateProjectContext(testProject.id);
      const gapIntervention3 = eval3.created.find((i) => i.triggerType === "DELIVERABLE_GAP");
      expect(gapIntervention3).toBeUndefined();
    } finally {
      await db.project.delete({ where: { id: testProject.id } });
    }
  });
});
