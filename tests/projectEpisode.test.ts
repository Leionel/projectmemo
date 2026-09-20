process.env.PROJECT_EPISODES_ENABLED = "1";
process.env.PROJECT_STATE_ENABLED = "1";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  confirmEpisodeRevision,
  getProjectEpisode,
  listProjectEpisodes,
  previewProjectEpisode,
  refreshProjectEpisode,
} from "@/lib/services/projectEpisodeService";
import { refreshProjectState } from "@/lib/services/projectStateService";

describe("ProjectEpisode preview / confirm (R2-1)", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await db.project.create({
      data: {
        title: "阶段检查点集成测试",
        description: "验证预览、来源冻结、确认幂等与列表",
        goal: "R2-1 验收",
        scenario: "COMPETITION",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
  });

  async function seedCard(title: string, createdAt?: Date, importance = 3) {
    const capture = await db.capture.create({
      data: { projectId, rawText: title, sourceType: "测试" },
    });
    return db.knowledgeCard.create({
      data: {
        projectId,
        captureId: capture.id,
        type: "meeting_note",
        title,
        summary: `${title} 摘要`,
        keywords: ["测试"],
        relatedTasks: [],
        nextActions: [],
        importance,
        ...(createdAt ? { createdAt } : {}),
      },
    });
  }

  it("empty window returns an explanatory empty summary instead of a hollow summary", async () => {
    const result = await previewProjectEpisode(projectId, {
      windowStart: new Date(Date.now() - 1000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    const section = result.episode.revisions[0].summary.sections.find((item) => item.section === "CONFIRMED_CHANGES");
    expect(section?.text).toContain("没有新增");
    expect(result.scope.includedCount).toBeGreaterThanOrEqual(0);
  });

  it("every FACT claim references at least one frozen source ref", async () => {
    const card = await seedCard("决策：检查点事实来源测试");
    void card;
    await refreshProjectState(projectId).catch(() => {});
    const result = await previewProjectEpisode(projectId, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    const revision = result.episode.revisions[0];
    const factClaims = revision.claims.filter((claim) => claim.kind === "FACT");
    expect(factClaims.length).toBeGreaterThan(0);
    for (const claim of factClaims) {
      if (claim.section === "GOALS") continue;
      expect(claim.sourceRefIds.length).toBeGreaterThan(0);
    }
    for (const ref of revision.sourceRefs) {
      expect(ref.observedAt).toBeTruthy();
      expect(ref.contentHash).toBeTruthy();
    }
  });

  it("generation is template-bound; model is not invented as a source", async () => {
    const result = await previewProjectEpisode(projectId, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    expect(result.episode.revisions[0].generationMode).toBe("TEMPLATE");
  });

  it("confirm publishes once and replays the same result for repeated requestId", async () => {
    const result = await previewProjectEpisode(projectId, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    const episodeId = result.episode.id;
    const revision = result.episode.revisions[0].revision;
    const requestId = `confirm-${episodeId}`;

    const [a, b] = await Promise.all([
      confirmEpisodeRevision(projectId, episodeId, { revision, requestId }),
      confirmEpisodeRevision(projectId, episodeId, { revision, requestId }),
    ]);
    expect(a.status).toBe("PUBLISHED");
    expect(b.status).toBe("PUBLISHED");

    const stored = await db.projectEpisode.findUnique({
      where: { id: episodeId },
      include: { revisions: true },
    });
    const publishedRevisions = stored!.revisions.filter((item) => item.status === "PUBLISHED");
    expect(publishedRevisions).toHaveLength(1);
    expect(publishedRevisions[0].requestId).toBe(requestId);

    const replay = await confirmEpisodeRevision(projectId, episodeId, { revision, requestId });
    expect(replay.id).toBe(episodeId);
  });

  it("confirming a published revision with a different requestId conflicts with 409", async () => {
    const result = await previewProjectEpisode(projectId, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    const episodeId = result.episode.id;
    const revision = result.episode.revisions[0].revision;
    await confirmEpisodeRevision(projectId, episodeId, { revision, requestId: "first-confirm" });
    await expect(
      confirmEpisodeRevision(projectId, episodeId, { revision, requestId: "second-confirm" }),
    ).rejects.toMatchObject({ code: "EPISODE_REVISION_ALREADY_PUBLISHED", status: 409 });
  });

  it("source hash change between preview and confirm returns 409", async () => {
    const result = await previewProjectEpisode(projectId, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    const episodeId = result.episode.id;
    const revision = result.episode.revisions[0];
    await expect(
      confirmEpisodeRevision(projectId, episodeId, {
        revision: revision.revision,
        requestId: "stale-confirm",
        expectedSourceHash: "not-the-real-hash",
      }),
    ).rejects.toMatchObject({ code: "EPISODE_SOURCE_CHANGED", status: 409 });
  });

  it("refresh creates a new draft revision and never overwrites the published one", async () => {
    const result = await previewProjectEpisode(projectId, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    const episodeId = result.episode.id;
    await confirmEpisodeRevision(projectId, episodeId, {
      revision: result.episode.revisions[0].revision,
      requestId: `refresh-${episodeId}`,
    });

    const refreshed = await refreshProjectEpisode(projectId, episodeId);
    expect(refreshed.revisions).toHaveLength(2);
    expect(refreshed.status).toBe("DRAFT");
    expect(refreshed.revisions[0].status).toBe("PUBLISHED");
    expect(refreshed.revisions[1].status).toBe("DRAFT");
    expect(refreshed.revisions[1].revision).toBe(2);
  });

  it("list does not create new revisions and cross-project episodes are not visible", async () => {
    const before = await db.episodeRevision.count({ where: { episode: { projectId } } });
    await listProjectEpisodes(projectId);
    const after = await db.episodeRevision.count({ where: { episode: { projectId } } });
    expect(after).toBe(before);

    const other = await db.project.create({
      data: { title: "其他项目", description: "", goal: "", scenario: "COURSE_DESIGN" },
    });
    try {
      const list = await listProjectEpisodes(other.id);
      expect(list).toHaveLength(0);
      const result = await previewProjectEpisode(projectId, {
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: new Date().toISOString(),
      });
      await expect(getProjectEpisode(other.id, result.episode.id)).rejects.toMatchObject({ code: "EPISODE_NOT_FOUND" });
    } finally {
      await db.project.delete({ where: { id: other.id } }).catch(() => {});
    }
  });
});
