process.env.PROJECT_EPISODES_ENABLED = "1";
process.env.PROJECT_STATE_ENABLED = "1";

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  confirmEpisodeRevision,
  getProjectEpisode,
  previewProjectEpisode,
} from "@/lib/services/projectEpisodeService";
import { proposeTemporalRelation, confirmRelation, revokeRelation } from "@/lib/services/temporalLedgerService";
import { refreshProjectState } from "@/lib/services/projectStateService";

const createdProjectIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) {
    await db.project.delete({ where: { id } }).catch(() => {});
  }
});

async function newProject(title: string) {
  const project = await db.project.create({
    data: { title, description: "防漂移测试", goal: "R2-2 验收", scenario: "RESEARCH" },
  });
  createdProjectIds.push(project.id);
  return project;
}

async function seedCard(projectId: string, title: string, importance = 3) {
  const capture = await db.capture.create({
    data: { projectId, rawText: title, sourceType: "测试" },
  });
  return db.knowledgeCard.create({
    data: {
      projectId,
      captureId: capture.id,
      type: "experiment_log",
      title,
      summary: `${title} 摘要`,
      keywords: ["测试"],
      relatedTasks: [],
      nextActions: [],
      importance,
    },
  });
}

async function createPublishedEpisode(projectId: string, cardTitles: string[]) {
  for (const title of cardTitles) await seedCard(projectId, title);
  await refreshProjectState(projectId).catch(() => {});
  const result = await previewProjectEpisode(projectId, {
    windowStart: new Date(Date.now() - 60_000).toISOString(),
    windowEnd: new Date().toISOString(),
  });
  await confirmEpisodeRevision(projectId, result.episode.id, {
    revision: result.episode.revisions[0].revision,
    requestId: `staleness-${result.episode.id}`,
  });
  return result.episode;
}

describe("ProjectEpisode staleness (R2-2)", () => {
  it("attachment correction only expires claims citing the old revision", async () => {
    const project = await newProject("附件纠错局部失效");
    const attachment = await db.attachment.create({
      data: {
        projectId: project.id,
        type: "FILE",
        storageKey: "test/staleness.txt",
        fileName: "实验记录v1.txt",
        mimeType: "text/plain",
        size: 10,
        sha256: "staleness-attachment-hash",
      },
    });
    const revision0 = await db.attachmentRevision.create({
      data: { attachmentId: attachment.id, revisionIndex: 0, text: "原始提取文本", source: "EXTRACTION" },
    });
    const episode = await createPublishedEpisode(project.id, ["附件相关的实验结论A"]);

    await db.attachmentRevision.create({
      data: { attachmentId: attachment.id, revisionIndex: 1, text: "人工纠错后的文本", source: "CORRECTION" },
    });

    const detail = await getProjectEpisode(project.id, episode.id);
    expect(detail.status).toBe("PARTIALLY_STALE");
    const staleRef = detail.freshness!.sources.find((item) => item.entityId === revision0.id);
    expect(staleRef?.state).toBe("SUPERSEDED");
    const rev = detail.revisions[detail.revisions.length - 1];
    const staleClaim = rev.claims.find((claim) => claim.sourceRefIds.includes(staleRef!.refId));
    expect(staleClaim).toBeTruthy();
    expect(detail.freshness!.affectedClaims.some((item) => item.claimId === staleClaim!.claimId)).toBe(true);
    // 未受影响的 claim 不会全部过期
    const affectedIds = new Set(detail.freshness!.affectedClaims.map((item) => item.claimId));
    expect(affectedIds.size).toBeLessThan(rev.claims.length);
  });

  it("superseded card marks its claim affected while others stay fresh", async () => {
    const project = await newProject("关系取代局部失效");
    const episode = await createPublishedEpisode(project.id, ["被取代的结论A"]);
    const newer = await seedCard(project.id, "取代A的新结论B");
    const older = await db.knowledgeCard.findFirstOrThrow({ where: { projectId: project.id, title: "被取代的结论A" } });

    const relation = await proposeTemporalRelation(project.id, newer.id, {
      relatedCardId: older.id,
      relationType: "SUPERSEDES",
      reason: "实验结果更新",
    });
    await confirmRelation(project.id, relation.id);

    const detail = await getProjectEpisode(project.id, episode.id);
    expect(detail.status).toBe("PARTIALLY_STALE");
    const rev = detail.revisions[0];
    const staleClaim = rev.claims.find((claim) => claim.text.includes("被取代的结论A"));
    expect(staleClaim).toBeTruthy();
    expect(detail.freshness!.affectedClaims.some((item) => item.claimId === staleClaim!.claimId)).toBe(true);
  });

  it("marks only the cited claim stale when a frozen card is edited", async () => {
    const project = await newProject("来源内容修改局部失效");
    const episode = await createPublishedEpisode(project.id, ["将修改的结论", "保持不变的结论"]);
    const changed = await db.knowledgeCard.findFirstOrThrow({ where: { projectId: project.id, title: "将修改的结论" } });
    await db.knowledgeCard.update({ where: { id: changed.id }, data: { summary: "发布检查点后修改的新摘要" } });

    const detail = await getProjectEpisode(project.id, episode.id);
    expect(detail.status).toBe("PARTIALLY_STALE");
    const source = detail.freshness!.sources.find((item) => item.entityId === changed.id && item.kind === "CARD");
    expect(source?.state).toBe("CHANGED");
    const changedClaim = detail.revisions[0].claims.find((claim) => claim.text.includes("将修改的结论"));
    const unchangedClaim = detail.revisions[0].claims.find((claim) => claim.text.includes("保持不变的结论"));
    expect(detail.freshness!.affectedClaims.some((item) => item.claimId === changedClaim!.claimId)).toBe(true);
    expect(detail.freshness!.affectedClaims.some((item) => item.claimId === unchangedClaim!.claimId)).toBe(false);
  });

  it("tracks a relation as its own source and expires its claim after revocation", async () => {
    const project = await newProject("关系撤销局部失效");
    const current = await seedCard(project.id, "当前方案");
    const related = await seedCard(project.id, "支撑记录");
    const relation = await proposeTemporalRelation(project.id, current.id, {
      relatedCardId: related.id,
      relationType: "SUPPORTS",
      reason: "实验结果支持当前方案",
    });
    await confirmRelation(project.id, relation.id);
    await refreshProjectState(project.id).catch(() => {});
    const preview = await previewProjectEpisode(project.id, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    await confirmEpisodeRevision(project.id, preview.episode.id, {
      revision: 1,
      requestId: `relation-${preview.episode.id}`,
    });
    const frozen = preview.episode.revisions[0];
    const relationRef = frozen.sourceRefs.find((ref) => ref.kind === "RELATION" && ref.entityId === relation.id);
    expect(relationRef).toBeTruthy();
    const relationClaim = frozen.claims.find((claim) => claim.sourceRefIds.includes(relationRef!.refId));
    expect(relationClaim).toBeTruthy();

    await revokeRelation(project.id, relation.id);
    const detail = await getProjectEpisode(project.id, preview.episode.id);
    expect(detail.status).toBe("PARTIALLY_STALE");
    expect(detail.freshness!.sources.find((item) => item.refId === relationRef!.refId)?.state).toBe("REVOKED");
    expect(detail.freshness!.affectedClaims.some((item) => item.claimId === relationClaim!.claimId)).toBe(true);
  });

  it("deleted source keeps the checkpoint openable and reports the source unavailable", async () => {
    const project = await newProject("来源删除局部失效");
    const episode = await createPublishedEpisode(project.id, ["将被删除的结论C", "仍然有效的结论D"]);
    const doomed = await db.knowledgeCard.findFirstOrThrow({ where: { projectId: project.id, title: "将被删除的结论C" } });
    await db.knowledgeCard.delete({ where: { id: doomed.id } });

    const detail = await getProjectEpisode(project.id, episode.id);
    expect(detail.status).toBe("PARTIALLY_STALE");
    const rev = detail.revisions[0];
    const doomedClaim = rev.claims.find((claim) => claim.text.includes("将被删除的结论C"));
    expect(doomedClaim).toBeTruthy();
    const doomedRef = rev.sourceRefs.find((ref) => doomedClaim!.sourceRefIds.includes(ref.refId));
    const source = detail.freshness!.sources.find((item) => item.refId === doomedRef!.refId);
    expect(source?.state).toBe("DELETED");
    expect(detail.freshness!.affectedClaims.some((item) => item.claimId === doomedClaim!.claimId)).toBe(true);

    const survivorClaim = rev.claims.find((claim) => claim.text.includes("仍然有效的结论D"));
    expect(detail.freshness!.affectedClaims.some((item) => item.claimId === survivorClaim!.claimId)).toBe(false);
  });

  it("policyVersion change on the end snapshot marks the checkpoint STALE", async () => {
    const project = await newProject("规则升级整份过期");
    const episode = await createPublishedEpisode(project.id, ["规则升级测试结论E"]);
    await db.projectStateSnapshot.updateMany({
      where: { projectId: project.id, id: episode.revisions[0].endSnapshotId! },
      data: { policyVersion: "legacy-1" },
    });

    const detail = await getProjectEpisode(project.id, episode.id);
    expect(detail.status).toBe("STALE");
  });
});
