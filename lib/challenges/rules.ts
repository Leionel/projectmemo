import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import type { Source } from "@/lib/mission/contracts";
import type { ChallengeKind, ChallengeQuestion, ChallengeOption } from "@/lib/types/challenge";

export type FrozenQuestion = ChallengeQuestion & { expected: string[] };
/** Deterministic citation tracing only. A link match never establishes the truth of a claim. */
export function challengeQuestions(kind: ChallengeKind, content: unknown, sources: Source[]): FrozenQuestion[] {
  const body = record(content), blocks = Array.isArray(body.blocks) ? body.blocks.map(record) : [];
  const block = blocks.find(b => b.kind !== "INFERENCE" && typeof b.text === "string" && Array.isArray(b.sourceIds) && b.sourceIds.length > 0);
  if (kind === "EVIDENCE") {
    if (!block || !Array.isArray(block.sourceIds)) throw new AppError("CHALLENGE_NOT_READY", "这版稿还没有适合追溯的引用，可先做交付彩排", 409);
    const linked = [...new Set(block.sourceIds.filter((id): id is string => typeof id === "string"))];
    if (linked.some(id => !sources.some(s => s.id === id))) throw new AppError("CHALLENGE_NOT_READY", "引用缺少原来源，请先核对稿件", 409);
    // The inference option lets a single-source case remain a genuine choice. Multi-source cases
    // require all linked records, not an invented unique answer.
    const options: ChallengeOption[] = [...new Map(sources.map(s => [s.id, s])).values()].map((s, i) => ({ key: s.id, label: "资料 " + (i + 1), sourceKey: s.id + "@" + s.hash }));
    options.push({ key: "NO_REFERENCE", label: "这段没有引用依据", sourceKey: undefined });
    return [{ key: "trace", title: "这段稿件实际引用了哪些记录？请选择全部引用", excerpt: String(block.text), options, expected: linked }];
  }
  const excerpt = blocks.find(b => typeof b.text === "string")?.text;
  if (!excerpt || !sources.length) throw new AppError("CHALLENGE_NOT_READY", "先准备一版有来源的成果，再开始彩排", 409);
  const missing = Array.isArray(body.missingInformation) ? body.missingInformation.filter((v): v is string => typeof v === "string").join("；") : "";
  return [
    { key: "evidence", title: "这段成果的哪一处依据，还值得核对？", excerpt: String(excerpt), options: [], expected: [] },
    { key: "unknown", title: "哪个尚未确认的条件，会影响这次交付？", excerpt: missing || "从原记录找出尚未确认的条件；也可以写“目前不知道”。", options: [], expected: [] },
    { key: "revision", title: "希望忆程下一版具体改进什么？", excerpt: "把刚才发现的缺口变成一条可执行的改稿要求。", options: [], expected: [] },
  ];
}
export function linkVerdict(question: FrozenQuestion, selected: string[]) {
  if (selected.some(key => !question.options.some(option => option.key === key))) throw new AppError("CHALLENGE_OPTION_INVALID", "选项不属于本题，请重新读取", 422);
  return question.expected.length === selected.length && question.expected.every(key => selected.includes(key)) ? "LINK_MATCH" as const : "REVIEW" as const;
}
