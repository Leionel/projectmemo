// P3-B 仓库感知：双端共享契约的 ArkTS 侧模型。
// 信号只是候选资料；采纳需用户确认；commit/CI 不构成现实完成证明。

export interface SignalView {
  id: string;
  connectionId: string;
  kind: string;
  sha: string;
  title: string;
  authorName: string;
  committedAt: string | null;
  url: string;
  status: string;
  adoptedAt: string | null;
  adoptedCaptureId: string | null;
  linkedActionId: string | null;
}

export interface ConnectionView {
  id: string;
  repo: string;
  ref: string;
  status: string;
  lastFetchedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  candidateCount: number;
  adoptedCount: number;
}

export interface RepoSignalListReply {
  enabled: boolean;
  note: string;
  connections: ConnectionView[];
  signals: SignalView[];
}

export class ConnectionCreateBody {
  repo: string = '';
  ref: string = 'main';
  requestId: string = '';
}

export class ConnectionActionBody {
  action: string = 'REFRESH';
  requestId: string = '';
  reason?: string;
}

export class SignalActionBody {
  action: string = 'ADOPT';
  requestId: string = '';
  actionId?: string;
}
