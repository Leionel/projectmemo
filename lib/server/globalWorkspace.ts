import { db } from "@/lib/db";
import { knowledgeTypes, type KnowledgeTypeValue, type TemporalTopLevelState } from "@/lib/types";
import { readableRecord } from "@/lib/recordPresentation";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";

export type WorkspaceFilters = {
  q?: string | string[]; project?: string | string[]; type?: string | string[]; page?: string | string[]; archived?: string | string[];
};
const PAGE_SIZE = 30;

/** Read-only aggregation. Membership belongs in every data query, including filtered IDs. */
export async function loadGlobalWorkspace(userId: string, mode: "memory" | "actions", input: WorkspaceFilters) {
  const value = (key: keyof WorkspaceFilters) => typeof input[key] === "string" ? input[key] as string : "";
  const q = value("q").trim().slice(0, 200);
  const page = Math.min(10000, Math.max(1, Number.parseInt(value("page") || "1", 10) || 1));
  const archived = value("archived") === "1";
  const project = value("project");
  const type = mode === "memory" && knowledgeTypes.includes(value("type") as KnowledgeTypeValue) ? value("type") as KnowledgeTypeValue : "";
  const scope = { memberships: { some: { userId } }, ...(archived ? {} : { archivedAt: null }) };
  const projectWhere = { ...scope, ...(project ? { id: project } : {}) };
  const projects = await db.project.findMany({ where: scope, select: { id: true, title: true }, orderBy: [{ title: "asc" }, { id: "asc" }] });
  const filters = { q, project, type, page, archived };
  const text = q ? { OR: [{ title: { contains: q } }, { [mode === "memory" ? "summary" : "description"]: { contains: q } }] } : {};
  const pagination = { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 };
  const projectSelect = { select: { id: true, title: true, archivedAt: true } };
  if (mode === "memory") {
    const cards = await db.knowledgeCard.findMany({
      where: { project: projectWhere, archivedAt: null, ...(type ? { type } : {}), ...text },
      select: { id: true, title: true, summary: true, type: true, createdAt: true, project: projectSelect },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...pagination,
    });
    const listed = cards.slice(0, PAGE_SIZE);
    // 时态来自既有 temporalLedger 投影，按项目分组读取；不新建状态，也不据此判定事实真伪。
    const temporalByCard = new Map<string, { topLevelState: TemporalTopLevelState; displayReason: string }>();
    const cardIdsByProject = new Map<string, string[]>();
    for (const card of listed) cardIdsByProject.set(card.project.id, [...(cardIdsByProject.get(card.project.id) ?? []), card.id]);
    await Promise.all([...cardIdsByProject.entries()].map(async ([projectId, cardIds]) => {
      const states = await getTemporalSearchStates(projectId, cardIds);
      for (const [cardId, item] of states) temporalByCard.set(cardId, { topLevelState: item.topLevelState, displayReason: item.displayReason });
    }));
    return { projects, filters, cards: listed.map(card => ({ ...card, ...readableRecord(card.title, card.summary), temporal: temporalByCard.get(card.id) })), actions: [], reminders: [], hasMore: cards.length > PAGE_SIZE };
  }
  const now = new Date();
  const [actions, reminders] = await Promise.all([
    db.actionItem.findMany({
      where: { project: projectWhere, isSimulated: false, status: { in: ["TODO", "DOING"] }, ...text },
      select: { id: true, title: true, description: true, status: true, dueAt: true, priority: true, project: projectSelect },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }], ...pagination,
    }),
    db.agentIntervention.findMany({
      where: { project: projectWhere, isSimulated: false, AND: [
        { OR: [{ status: "OPEN" }, { status: "SNOOZED", snoozedUntil: { lte: now } }] },
        ...(q ? [{ OR: [{ title: { contains: q } }, { content: { contains: q } }] }] : []),
      ] },
      select: { id: true, title: true, content: true, severity: true, project: projectSelect },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }, { id: "desc" }], ...pagination,
    }),
  ]);
  return { projects, filters, cards: [], actions: actions.slice(0, PAGE_SIZE), reminders: reminders.slice(0, PAGE_SIZE), hasMore: actions.length > PAGE_SIZE || reminders.length > PAGE_SIZE };
}
