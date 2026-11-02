import {WorkState} from './WorkState';
import { EvidenceReviewHistory } from './EvidenceFit';
import { MissionOutput } from './Mission';
export class MissionReadTarget { questionId: string = ''; approvalId: string = ''; outputId: string = ''; revision: string = ''; receiptId: string = ''; sourceId: string = ''; }
export class ReadbackQuestion { id: string = ''; text: string = ''; historical: boolean = false; }
export class ReadbackApproval { id: string = ''; status: string = ''; }
export class ReadbackReceipt { id: string = ''; outputId: string = ''; outputRevision: number = 0; artifactId: string = ''; }
export class ReadbackSelected { question: ReadbackQuestion | null = null; approval: ReadbackApproval | null = null; output: MissionOutput | null = null; receipt: ReadbackReceipt | null = null; }
export class ReadbackAdoption { receiptId: string = ''; outputId: string = ''; outputRevision: number = 0; artifactId: string = ''; artifactType: string = ''; artifactCreatedAt: string = ''; title: string = ''; }
export class ReadbackAction { id: string = ''; title: string = ''; status: string = ''; resultCardId: string | null = null; isSimulated: boolean = false; }
export class ReadbackConversation { sourceRunId: string = ''; href: string = ''; }
export class ReadbackMaterialFact { kind: string = ''; refId: string = ''; revision?: number; artifactId?: string; }
export class ReadbackMaterialPointer { id: string = ''; hash: string = ''; }
export class ReadbackMaterialCoverage { truncated: boolean = false; extractionStatus: string = ''; }
export class ReadbackMaterial { sourcePointer: ReadbackMaterialPointer = new ReadbackMaterialPointer(); title: string = ''; availability: string = ''; facts: ReadbackMaterialFact[] = []; excerpt: string | null = null; coverage: ReadbackMaterialCoverage | null = null; }
export class ReadbackMaterialUses { schemaVersion: number = 1; questionId: string | null = null; items: ReadbackMaterial[] = []; }
export class MissionReadback {workState?:WorkState; evidenceReviews?: EvidenceReviewHistory; materialUses?: ReadbackMaterialUses; reviewProgress?: ReadbackReviewProgress; resourceUsage?: ReadbackResourceUsage; callCoverage?: ReadbackCallCoverage; missionId: string = ''; projectId: string = ''; missionVersion: number = 0; observedAt: string = ''; sourceConversation: ReadbackConversation | null = null; selected: ReadbackSelected = new ReadbackSelected(); adoptions: ReadbackAdoption[] = []; actionReceipts: ReadbackAction[] = []; }
export class MissionReadbackReply { readback: MissionReadback = new MissionReadback(); }
export function missionReadbackQuery(target: MissionReadTarget): string {
  const values: string[] = [];
  if (target.sourceId !== '') values.push(`sourceId=${encodeURIComponent(target.sourceId)}`);
  if (target.questionId !== '') values.push(`questionId=${encodeURIComponent(target.questionId)}`);
  if (target.approvalId !== '') values.push(`approvalId=${encodeURIComponent(target.approvalId)}`);
  if (target.outputId !== '') values.push(`outputId=${encodeURIComponent(target.outputId)}`);
  if (target.revision !== '') values.push(`revision=${encodeURIComponent(target.revision)}`);
  if (target.receiptId !== '') values.push(`receiptId=${encodeURIComponent(target.receiptId)}`);
  return values.join('&');
}

// 结果分类只是原 Step/Output/Action/回执的只读投影，不是新的完成真值。
export class ReadbackProgressClass {
  key: string = '';
  label: string = '';
  count: number = 0;
  note: string = '';
}

export class ReadbackReviewProgress {
  schemaVersion: number = 1;
  classes: ReadbackProgressClass[] = [];
  policy: string = '';
}

export class ReadbackCallCounts {
  total: number = 0;
  succeeded: number = 0;
  failed: number = 0;
  usageRecorded: number = 0;
  usageUnknown: number = 0;
}

export class ReadbackToolCallCounts {
  total: number = 0;
  succeeded: number = 0;
  failed: number = 0;
  unknown: number = 0;
  pending: number = 0;
}

export class ReadbackCallInspected {
  agentRuns: number = 0;
  steps: number = 0;
  limit: number = 20;
  truncated: boolean = false;
}

export class ReadbackCallPricing {
  state: string = 'UNPRICED';
  estimate: string | null = null;
  billedAmount: string | null = null;
  currency: string | null = null;
  reason: string = '';
}

/** 原 AgentRun/Step 的只读调用覆盖；不是账单。 */
export class ReadbackCallCoverage {
  schemaVersion: number = 1;
  scope: string = '';
  inspected: ReadbackCallInspected = new ReadbackCallInspected();
  models: ReadbackCallCounts = new ReadbackCallCounts();
  tools: ReadbackToolCallCounts = new ReadbackToolCallCounts();
  failedCodes: string[] = [];
  pricing: ReadbackCallPricing = new ReadbackCallPricing();
  summary: string = '';
  notes: string[] = [];
}

export class ReadbackResourceUsage {
  schemaVersion: number = 1;
  scope: string = '';
  models: number | null = null;
  tools: number | null = null;
  inputTokens: number | null = null;
  outputTokens: number | null = null;
  unknownCalls: number | null = null;
  monetaryCost: string | null = null;
  pricingState: string = 'UNPRICED';
  summary: string = '';
  coverageNote: string = '';
  costNote: string = '';
}


