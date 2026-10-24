import { MissionOutput } from './Mission';
export class MissionReadTarget { questionId: string = ''; approvalId: string = ''; outputId: string = ''; revision: string = ''; receiptId: string = ''; }
export class ReadbackQuestion { id: string = ''; text: string = ''; historical: boolean = false; }
export class ReadbackApproval { id: string = ''; status: string = ''; }
export class ReadbackReceipt { id: string = ''; outputId: string = ''; outputRevision: number = 0; artifactId: string = ''; }
export class ReadbackSelected { question: ReadbackQuestion | null = null; approval: ReadbackApproval | null = null; output: MissionOutput | null = null; receipt: ReadbackReceipt | null = null; }
export class ReadbackAdoption { receiptId: string = ''; outputId: string = ''; outputRevision: number = 0; artifactId: string = ''; artifactType: string = ''; artifactCreatedAt: string = ''; title: string = ''; }
export class ReadbackAction { id: string = ''; title: string = ''; status: string = ''; resultCardId: string | null = null; isSimulated: boolean = false; }
export class ReadbackConversation { sourceRunId: string = ''; href: string = ''; }
export class MissionReadback { missionId: string = ''; projectId: string = ''; missionVersion: number = 0; observedAt: string = ''; sourceConversation: ReadbackConversation | null = null; selected: ReadbackSelected = new ReadbackSelected(); adoptions: ReadbackAdoption[] = []; actionReceipts: ReadbackAction[] = []; }
export class MissionReadbackReply { readback: MissionReadback = new MissionReadback(); }
export function missionReadbackQuery(target: MissionReadTarget): string {
  const values: string[] = [];
  if (target.questionId !== '') values.push(`questionId=${encodeURIComponent(target.questionId)}`);
  if (target.approvalId !== '') values.push(`approvalId=${encodeURIComponent(target.approvalId)}`);
  if (target.outputId !== '') values.push(`outputId=${encodeURIComponent(target.outputId)}`);
  if (target.revision !== '') values.push(`revision=${encodeURIComponent(target.revision)}`);
  if (target.receiptId !== '') values.push(`receiptId=${encodeURIComponent(target.receiptId)}`);
  return values.join('&');
}
