import type { WorkbenchSnapshot, WorkbenchOutput } from "@/lib/types/workbench";
/** Synthetic interaction sample. It never writes a project or pretends to be a model run. */
export function workbenchFixture(revision = 1, research = false): WorkbenchSnapshot {
  const texts = research
    ? ["原始实验记录：不同拆分条件的数据尚不能直接比较。", "新实验记录：补充了同一拆分与评估脚本版本；指标由用户提供，尚未独立复现。"]
    : ["发布记录：登录流程已完成，移动端回归仍待核对。", "新反馈：移动端输入回归已补记录，分享入口仍待核对。"];
  const outputs: WorkbenchOutput[] = Array.from({ length: revision }, (_, i): WorkbenchOutput => {
    const text = texts[Math.min(i, 1)], sourceId = "capture:sample-" + (i + 1);
    const blocks = [{ blockId: "record", text, kind: "PROJECT_OBSERVATION", sourceIds: [sourceId] },
      { blockId: "next", text: "建议先核对未确认的条件，再整理最终交付说明。", kind: "INFERENCE", sourceIds: [] }];
    return { id: "sample-output-" + (i + 1), revision: i + 1, sourceKeys: ["sample-" + i], createdAt: new Date("2026-11-16T08:00:00Z").toISOString(), blocks,
      presentation: { schemaVersion: 1, allowedActions: [], blocks: blocks.map(b => ({
        blockKey: b.blockId, semanticType: "prose", emphasis: "supporting", refs: [], actionBindingIds: [], fallbackText: b.text,
        content: [{ type: "paragraph", spans: [{ kind: "text", text: b.text }] }],
      })) } };
  }).reverse();
  return { id: "sample", projectId: "sample-project", projectTitle: research ? "实验阶段汇报 · 科研对照样例" : "下一版本准备 · 开发样例",
    goal: research ? "整理一份保留条件与未知的实验汇报" : "准备下一版本的交付说明", workingObjective: "核对当前材料，整理有依据的成果",
    status: "WAITING_INPUT", phase: "WAITING_OBSERVATION", reason: "草稿已备好，等待获准新资料", checkedAt: "2026-11-16T08:00:02Z",
    provider: "交互样例 · 未运行模型", version: 1, models: 0, tools: 0, outputs,
    sources: texts.slice(0, revision).map((text, i) => ({ key: "sample-" + i, id: "capture:sample-" + (i + 1), revision: String(i + 1),
      hash: "sample-fingerprint-" + i, text, current: true, kind: "PROJECT" })),
    events: [{ id: "sample-read", label: "样例：读取原项目记录", at: "2026-11-16T08:00:00Z" },
      { id: "sample-handoff", label: "样例：研究交给创作", at: "2026-11-16T08:00:01Z" },
      { id: "sample-output", label: "样例：成果等待新变化", at: "2026-11-16T08:00:02Z" }] };
}
