import { ApiClient } from './ApiClient';
import { ApiError } from '../models/Project';

// 账户个人记忆：只保存用户明确提供的非敏感内容；来源、版本与使用状态可查。
// 复用原 ApiClient 认证与会话失效处理，不新建传输通道。
export class PersonalEntry {
  claimId: string = '';
  quote: string = '';
  basis: string = '';
  contentHash: string = '';
  kind: string = '';
  statement: string = '';
  status: string = '';
  revision: number = 0;
  topics: string[] = [];
  expiresAt: string | undefined = undefined;
  updatedAt: string = '';
}

export class PersonalMemoryPolicy {
  useInContextEnabled: boolean = false;
  explicitCaptureEnabled: boolean = true;
  candidateInferenceEnabled: boolean = false;
  cloudProcessingEnabled: boolean = false;
  settingsVersion: number = 0;
  privacyRevision: number = 0;
}

export class PersonalMemoryListResponse {
  items: PersonalEntry[] = [];
  policy: PersonalMemoryPolicy | undefined = undefined;
}

export class PersonalMemoryCommandResult {
  requestId: string = '';
  receiptId: string = '';
  operation: string = '';
  claimId: string | null = null;
  revision: number | null = null;
  status: string | null = null;
  policyVersion: number = 0;
  privacyRevision: number = 0;
  replayed: boolean = false;
  admissionStatus: string | undefined = undefined;
  admissionReason: string | undefined = undefined;
  admissionQuestion: string | undefined = undefined;
}

export class PersonalMemoryCommandInput {
  requestId: string = '';
  operation: string = '';
  claimId: string | undefined = undefined;
  expectedRevision: number | undefined = undefined;
  quote: string | undefined = undefined;
  kind: string | undefined = undefined;
  topics: string[] | undefined = undefined;
  frozenContentHash: string | undefined = undefined;
  confirmedStatement: string | undefined = undefined;
  useScopeMode: string | undefined = undefined;
  useScopeProjectIds: string[] | undefined = undefined;
}

export class PersonalMemoryDetail {
  entry: PersonalEntry = new PersonalEntry();
  sourceDescription: string = '';
  formedAt: string = '';
  history: PersonalHistoryItem[] = [];
}

export class PersonalHistoryItem {
  revision: number = 0;
  eventKind: string = '';
  at: string = '';
  quote: string | undefined = undefined;
}

export class PersonalMemoryPolicyInput {
  requestId: string = '';
  expectedVersion: number | undefined = undefined;
  useInContextEnabled: boolean | undefined = undefined;
  cloudProcessingEnabled: boolean | undefined = undefined;
}

export class PersonalMemoryPolicyResult {
  replayed: boolean = false;
  settingsVersion: number = 0;
  privacyRevision: number = 0;
}

export class PersonalMemoryService {
  private client: ApiClient = new ApiClient();

  async list(includeStopped: boolean): Promise<PersonalMemoryListResponse> {
    const path = includeStopped ? '/api/me/memory?includeStopped=1' : '/api/me/memory';
    return this.client.get<PersonalMemoryListResponse>(path);
  }

  async listCandidates(): Promise<PersonalEntry[]> {
    const raw = await this.client.get<Record<string, object>>('/api/me/memory?candidates=1');
    const items = raw['items'] as Array<Record<string, object>>;
    const result: PersonalEntry[] = [];
    for (const item of items) {
      const entry = PersonalMemoryService.parseEntry(item);
      entry.basis = typeof item['basis'] === 'string' ? item['basis'] as string : '';
      result.push(entry);
    }
    return result;
  }

  async detail(claimId: string): Promise<PersonalMemoryDetail> {
    const raw = await this.client.get<Record<string, object>>(`/api/me/memory?claimId=${claimId}`);
    const detail = new PersonalMemoryDetail();
    const entry = raw['entry'] as Record<string, object>;
    detail.entry = PersonalMemoryService.parseEntry(entry);
    const source = raw['source'] as Record<string, object>;
    detail.sourceDescription = typeof source['description'] === 'string' ? source['description'] as string : '';
    detail.formedAt = typeof source['formedAt'] === 'string' ? source['formedAt'] as string : '';
    const history = raw['history'] as Array<Record<string, object>>;
    for (const item of history) {
      const row = new PersonalHistoryItem();
      row.revision = typeof item['revision'] === 'number' ? item['revision'] as number : 0;
      row.eventKind = typeof item['eventKind'] === 'string' ? item['eventKind'] as string : '';
      row.at = typeof item['at'] === 'string' ? item['at'] as string : '';
      row.quote = typeof item['quote'] === 'string' ? item['quote'] as string : undefined;
      detail.history.push(row);
    }
    return detail;
  }

  private static parseEntry(entry: Record<string, object>): PersonalEntry {
    const parsed = new PersonalEntry();
    parsed.claimId = typeof entry['claimId'] === 'string' ? entry['claimId'] as string : '';
    parsed.kind = typeof entry['kind'] === 'string' ? entry['kind'] as string : '';
    parsed.statement = typeof entry['statement'] === 'string' ? entry['statement'] as string : '';
    parsed.quote = typeof entry['quote'] === 'string' ? entry['quote'] as string : '';
    parsed.status = typeof entry['status'] === 'string' ? entry['status'] as string : '';
    parsed.revision = typeof entry['revision'] === 'number' ? entry['revision'] as number : 0;
    parsed.updatedAt = typeof entry['updatedAt'] === 'string' ? entry['updatedAt'] as string : '';
    parsed.contentHash = typeof entry['contentHash'] === 'string' ? entry['contentHash'] as string : '';
    const conditions = entry['conditions'] as Record<string, object>;
    const topics = conditions !== undefined && Array.isArray(conditions['topics']) ? conditions['topics'] as Array<object> : [];
    for (const topic of topics) if (typeof topic === 'string') parsed.topics.push(topic);
    parsed.expiresAt = conditions !== undefined && typeof conditions['expiresAt'] === 'string' ? conditions['expiresAt'] as string : undefined;
    return parsed;
  }

  async command(input: PersonalMemoryCommandInput): Promise<PersonalMemoryCommandResult> {
    return this.client.post<PersonalMemoryCommandResult>('/api/me/memory', input);
  }

  async updatePolicy(input: PersonalMemoryPolicyInput): Promise<PersonalMemoryPolicyResult> {
    return this.client.patch<PersonalMemoryPolicyResult>('/api/me/memory/policy', input);
  }
}

export function personalMemoryErrorMessage(e: Object): string {
  return e instanceof ApiError ? e.message : '操作未完成，请稍后重试';
}
