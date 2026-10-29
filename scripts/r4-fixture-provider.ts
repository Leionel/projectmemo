/** Synthetic deterministic provider for isolated service/browser fixtures. Never registered by the app. */
type Data = { message?: string; focus?: string; directory?: Array<{ id: string }>; projects?: Array<{ id: string; goal: string }>;
  sources?: Array<{ id: string; sourceId: string; excerpt: string }>; materialPointers?: Array<{ projectId: string; sourceId: string; revision: string }>;
  catalog?: Array<{ semanticType: string; dataRefs: unknown[] }> };
export function r4FixtureResponse(body: { messages: Array<{ content: string }> }) {
  const task = body.messages[0].content.match(/^任务 (\S+)/)?.[1], d = JSON.parse(body.messages[1].content).data as Data;
  let output: unknown;
  if (task === "focus.route.v2") output = { intent: "PROPOSE_ACTION", projectIds: [d.focus ?? d.directory![0].id], query: "资料", investigate: true, informationNeeds: ["读取原始条件"] };
  else if (task === "focus.investigate.v1") {
    const p = d.projects![0], raw = d.sources!.find(s => s.sourceId.startsWith("capture:")), source = raw ?? d.sources!.find(s => s.sourceId.startsWith("card:"))!;
    const pointer = d.materialPointers!.find(p => p.sourceId.startsWith("capture:"))!;
    output = { goalAssessments: [{ projectId: p.id, goalQuote: p.goal, criteria: [{ requirement: p.goal, state: raw ? "BLOCKED" : "UNKNOWN",
      explanation: raw ? "原记录显示目标条件仍有差距。" : "摘要没有列出原始条件。", observations: [{ sourceId: source.id, quote: source.excerpt.slice(0, 450),
        applicability: raw ? "DIRECT" : "UNKNOWN", relation: raw ? "CONTRADICTS" : "UNDETERMINED" }] }], blockers: raw ? ["需核对原记录的目标差距"] : [], keyUnknowns: raw ? [] : ["原始条件"], nextInformationNeed: "读取原始条件" }],
      decision: raw ? { decision: "ANSWER_NOW", reason: "原记录已补足关键判断。" } : { decision: "READ_EXISTING", informationNeed: "读取原始条件", expectedObservation: "取得同条件记录。",
        call: { tool: "read_project_material", projectId: p.id, sourceId: pointer.sourceId, revision: pointer.revision } } };
  } else if (task === "focus.answer.v2") {
    const p = d.projects![0], source = d.sources!.find(s => s.sourceId.startsWith("capture:"))!;
    output = { advice: "原记录仍反映出目标条件的差距，建议先核对已有的解决方案。【" + (d.sources!.indexOf(source) + 1) + "】", recommendedProjectId: p.id,
      observations: [{ sourceId: source.id, quote: source.excerpt.slice(0, 450) }], priorities: [{ projectId: p.id, tradeoff: "先解决会影响交付的条件，再继续推进。" }],
      action: { projectId: p.id, title: "核对同条件结果并整理下一步", description: "确认后创建原项目行动；先查已有记录，缺现实条件时停止。", priority: 4 } };
  } else if (task === "focus.ui_plan.v1") output = { schemaVersion: 2, intent: "DECIDE", primaryIntent: "CONSIDER_ACTION", composition: [
    { blockKey: "conclusion", semanticType: "prose", emphasis: "primary", dataRefs: [], content: [{ type: "paragraph", spans: [{ kind: "strong", text: "先处理影响目标的这条差距。" }, { kind: "text", text: "原记录与目标条件不一致，建议先利用已有资料核对，再决定是否增加新工作。" }] }] },
    ...["goal_gap", "evidence", "approval", "investigation"].flatMap(type => { const b = d.catalog!.find(b => b.semanticType === type); return b ? [{ blockKey: "shown-" + type, semanticType: type, emphasis: "supporting", dataRefs: b.dataRefs }] : []; }),
  ] };
  else throw new Error("Unexpected fixture prompt: " + task);
  return new Response(JSON.stringify({ id: "isolated-r4-fixture", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
}
