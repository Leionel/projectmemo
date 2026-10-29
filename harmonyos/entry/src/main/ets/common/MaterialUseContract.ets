import { ReadbackMaterialFact } from '../models/MissionReadback';
export function materialUseSummary(facts: ReadbackMaterialFact[]): string {
  const adoption = facts.find((f: ReadbackMaterialFact) => f.kind === 'ARTIFACT_ADOPTION');
  if (adoption !== undefined) return `已归入成果 · 草稿版本 ${adoption.revision}`;
  const output = facts.find((f: ReadbackMaterialFact) => f.kind === 'OUTPUT_REFERENCE');
  if (output !== undefined) return `草稿版本 ${output.revision} 中已引用`;
  if (facts.some((f: ReadbackMaterialFact) => f.kind === 'CONTEXT_POINTER')) return '已进入原委托的来源索引，正文读取范围未记录';
  if (facts.some((f: ReadbackMaterialFact) => f.kind === 'BOUND')) return '已绑定原委托，尚未找到后续引用';
  if (facts.some((f: ReadbackMaterialFact) => f.kind === 'ASSOCIATED')) return '已关联这个问题，尚未接续';
  if (facts.some((f: ReadbackMaterialFact) => f.kind === 'CANDIDATE')) return '候选资料，等待核对';
  return '已保存，当前范围未找到使用位置';
}
