import { ApiClient } from './ApiClient';
import {
  ConsolidationProposalResponse,
  ConsolidationReceipt,
  ConsolidationReceiptResponse,
  Episode,
  EpisodeDetailResponse,
  EpisodeListResponse,
  EpisodePreviewResult,
  ReentryData,
  ScheduleCalendarEntry,
  SchedulePlan,
  SchedulePlanResponse
} from '../models/Reentry';

export class EpisodePreviewBody {
  windowStart: string = '';
  windowEnd: string = '';
  kind: string = 'MANUAL';
}

export class EpisodeConfirmBody {
  revision: number = 1;
  requestId: string = '';
  expectedSourceHash?: string;
}

export class ScheduleSlotBody {
  start: string = '';
  end: string = '';
}

export class SchedulePreviewBody {
  requestId: string = '';
  rangeStart: string = '';
  rangeEnd: string = '';
  timezone: string = 'Asia/Shanghai';
  slots: ScheduleSlotBody[] = [];
  actionIds?: string[];
  episodeRevisionId?: string;
}

export class ScheduleConfirmBody {
  requestId: string = '';
  expectedVersion?: number;
}

export class CalendarSyncBody {
  entries: ScheduleCalendarEntry[] = [];
}

export class CalendarRevokeBody {
  action: string = 'revoke';
  blockIds: string[] = [];
}

export class ConsolidationConfirmBody {
  masterCardId: string = '';
  mergedCardIds: string[] = [];
  reason: string = '';
  requestId: string = '';
  similarityScore: number = 0;
}

export class ConsolidationReceiptResult {
  receipt: ConsolidationReceipt = new ConsolidationReceipt();
}

// R2 阶段检查点、可执行安排与 60 秒再入场。
// 确认类操作仍由服务端保证归属与幂等；客户端只负责提交与展示。
export class ReentryService {
  private client: ApiClient;

  constructor(client?: ApiClient) {
    this.client = client ?? new ApiClient();
  }

  async previewEpisode(projectId: string, body: EpisodePreviewBody): Promise<EpisodePreviewResult> {
    return this.client.post<EpisodePreviewResult>(`/api/projects/${projectId}/episodes/preview`, body);
  }

  async confirmEpisode(projectId: string, episodeId: string, body: EpisodeConfirmBody): Promise<EpisodeDetailResponse> {
    return this.client.post<EpisodeDetailResponse>(`/api/projects/${projectId}/episodes/${episodeId}/confirm`, body);
  }

  async listEpisodes(projectId: string): Promise<EpisodeListResponse> {
    return this.client.get<EpisodeListResponse>(`/api/projects/${projectId}/episodes`);
  }

  async getEpisode(projectId: string, episodeId: string): Promise<EpisodeDetailResponse> {
    return this.client.get<EpisodeDetailResponse>(`/api/projects/${projectId}/episodes/${episodeId}`);
  }

  async refreshEpisode(projectId: string, episodeId: string): Promise<EpisodeDetailResponse> {
    return this.client.post<EpisodeDetailResponse>(`/api/projects/${projectId}/episodes/${episodeId}/refresh`, undefined);
  }

  async previewSchedule(projectId: string, body: SchedulePreviewBody): Promise<SchedulePlan> {
    return this.client.post<SchedulePlan>(`/api/projects/${projectId}/schedule/preview`, body);
  }

  async confirmSchedule(projectId: string, planId: string, body: ScheduleConfirmBody): Promise<SchedulePlan> {
    return this.client.post<SchedulePlan>(`/api/projects/${projectId}/schedule/${planId}/confirm`, body);
  }

  async getCurrentSchedule(projectId: string): Promise<SchedulePlanResponse> {
    return this.client.get<SchedulePlanResponse>(`/api/projects/${projectId}/schedule/current`);
  }

  async getReentry(projectId: string): Promise<ReentryData> {
    return this.client.get<ReentryData>(`/api/projects/${projectId}/reentry`);
  }

  /** 上报系统日历写入回执；服务端只登记 ProjectMemo 自己创建的事件 */
  async reportCalendarSync(projectId: string, planId: string, body: CalendarSyncBody): Promise<SchedulePlan> {
    return this.client.post<SchedulePlan>(`/api/projects/${projectId}/schedule/${planId}/calendar`, body);
  }

  async revokeCalendarSync(projectId: string, planId: string, body: CalendarRevokeBody): Promise<SchedulePlan> {
    return this.client.post<SchedulePlan>(`/api/projects/${projectId}/schedule/${planId}/calendar`, body);
  }

  async listConsolidationProposals(projectId: string): Promise<ConsolidationProposalResponse> {
    return this.client.get<ConsolidationProposalResponse>(`/api/projects/${projectId}/consolidation`);
  }

  async confirmConsolidation(projectId: string, body: ConsolidationConfirmBody): Promise<ConsolidationReceiptResult> {
    return this.client.post<ConsolidationReceiptResult>(`/api/projects/${projectId}/consolidation`, body);
  }

  async listConsolidationReceipts(projectId: string): Promise<ConsolidationReceiptResponse> {
    return this.client.get<ConsolidationReceiptResponse>(`/api/projects/${projectId}/consolidation/receipts`);
  }

  async revokeConsolidation(projectId: string, receiptId: string): Promise<ConsolidationReceiptResult> {
    return this.client.post<ConsolidationReceiptResult>(`/api/projects/${projectId}/consolidation/${receiptId}/revoke`, undefined);
  }
}
