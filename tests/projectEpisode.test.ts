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

  it("rejects confirm when a cited card summary changed after preview", async () => {
    const project = await db.project.create({
      data: { title: "确认期来源重校验", description: "", goal: "", scenario: "RESEARCH" },
    });
    try {
      const capture = await db.capture.create({ data: { projectId: project.id, rawText: "原始结论", sourceType: "测试" } });
      const card = await db.knowledgeCard.create({
        data: {
          projectId: project.id,
          captureId: capture.id,
          type: "experiment_log",
          title: "召回率结论",
          summary: "召回率 78%",
          keywords: [],
          relatedTasks: [],
          nextActions: [],
          importance: 4,
        },
      });

      const preview = await previewProjectEpisode(project.id, {
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: new Date().toISOString(),
      });
      const revision = preview.episode.revisions[0];

      // 预览之后来源内容被改写：即使客户端仍提交旧哈希，服务端重算也必须拒绝
      await db.knowledgeCard.update({ where: { id: card.id }, data: { summary: "召回率 91%（复测修正）" } });

      await expect(
        confirmEpisodeRevision(project.id, preview.episode.id, {
          revision: revision.revision,
          requestId: "stale-source-confirm",
          expectedSourceHash: revision.sourceHash,
        }),
      ).rejects.toMatchObject({ code: "EPISODE_SOURCE_CHANGED", status: 409 });

      // 不带客户端哈希同样被拒：校验不依赖客户端自觉
      await expect(
        confirmEpisodeRevision(project.id, preview.episode.id, {
          revision: revision.revision,
          requestId: "stale-source-confirm-2",
        }),
      ).rejects.toMatchObject({ code: "EPISODE_SOURCE_CHANGED", status: 409 });

      const stored = await db.projectEpisode.findUniqueOrThrow({
        where: { id: preview.episode.id },
        include: { revisions: true },
      });
      expect(stored.status).toBe("DRAFT");
      expect(stored.revisions.every((item) => item.status === "DRAFT")).toBe(true);
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });

  it("reentry reads the newest published revision while older ones stay readable", async () => {
    const project = await db.project.create({
      data: { title: "多版本检查点", description: "", goal: "", scenario: "RESEARCH" },
    });
    try {
      const capture = await db.capture.create({ data: { projectId: project.id, rawText: "V1 来源", sourceType: "测试" } });
      await db.knowledgeCard.create({
        data: {
          projectId: project.id,
          captureId: capture.id,
          type: "meeting_note",
          title: "V1 结论",
          summary: "第一版结论",
          keywords: [],
          relatedTasks: [],
          nextActions: [],
          importance: 3,
        },
      });

      const v1Preview = await previewProjectEpisode(project.id, {
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: new Date().toISOString(),
      });
      const v1 = await confirmEpisodeRevision(project.id, v1Preview.episode.id, {
        revision: 1,
        requestId: "v1-confirm",
      });
      expect(v1.status).toBe("PUBLISHED");
      expect(v1.revisions[0].confirmedAt).not.toBeNull();

      const refreshed = await refreshProjectEpisode(project.id, v1Preview.episode.id);
      expect(refreshed.revisions).toHaveLength(2);
      const v2 = await confirmEpisodeRevision(project.id, v1Preview.episode.id, {
        revision: 2,
        requestId: "v2-confirm",
        expectedSourceHash: refreshed.revisions[1].sourceHash,
      });
      expect(v2.status).toBe("PUBLISHED");

      const { getLatestPublishedEpisode } = await import("@/lib/services/projectEpisodeService");
      const current = await getLatestPublishedEpisode(project.id);
      expect(current?.revisions).toHaveLength(1);
      expect(current?.revisions[0].revision).toBe(2);

      const detail = await getProjectEpisode(project.id, v1Preview.episode.id);
      expect(detail.revisions).toHaveLength(2);
      expect(detail.revisions[0].revision).toBe(1);
      expect(detail.revisions[0].status).toBe("PUBLISHED");
      expect(detail.revisions[1].revision).toBe(2);
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
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
