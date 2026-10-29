import { ApiClient } from './ApiClient';
import { RepoCiGrant } from '../models/RepoSignal';
import { SessionStore } from './SessionStore';
import { ApiError } from '../models/Project';
import { ConnectionActionBody, ConnectionCreateBody, ConnectionMutationReply, RepoSignalListReply, SignalActionBody, SignalActionReply } from '../models/RepoSignal';

/** P3-B 仓库感知：列表 / 建连接 / 刷新 / 撤销 / 采纳 / 忽略；服务端执行外部请求，客户端不直连 GitHub。 */
export class RepoSignalService {
  async ciGrant(projectId: string, id: string, body: RepoCiGrant): Promise<void> { this.authorize(); await this.client.post<ConnectionMutationReply>(`/api/projects/${encodeURIComponent(projectId)}/repo-signals/connections/${encodeURIComponent(id)}/ci-grant`, body); }
  private client: ApiClient;
  constructor(client?: ApiClient) { this.client = client ?? new ApiClient(); }
  private authorize(): void {
    if (!SessionStore.isTokenValid()) {
      SessionStore.handleSessionExpired();
      throw new ApiError('UNAUTHORIZED', '请先登录，再查看仓库信号', 401);
    }
  }
  async list(projectId: string): Promise<RepoSignalListReply> {
    this.authorize();
    return this.client.get<RepoSignalListReply>(`/api/projects/${encodeURIComponent(projectId)}/repo-signals`);
  }
  async create(projectId: string, body: ConnectionCreateBody): Promise<ConnectionMutationReply> {
    this.authorize();
    return this.client.post<ConnectionMutationReply>(`/api/projects/${encodeURIComponent(projectId)}/repo-signals`, body);
  }
  async refresh(projectId: string, connectionId: string, body: ConnectionActionBody): Promise<ConnectionMutationReply> {
    this.authorize();
    return this.client.post<ConnectionMutationReply>(`/api/projects/${encodeURIComponent(projectId)}/repo-signals/connections/${encodeURIComponent(connectionId)}`, body);
  }
  async revoke(projectId: string, connectionId: string, body: ConnectionActionBody): Promise<ConnectionMutationReply> {
    this.authorize();
    return this.client.post<ConnectionMutationReply>(`/api/projects/${encodeURIComponent(projectId)}/repo-signals/connections/${encodeURIComponent(connectionId)}`, body);
  }
  async act(projectId: string, signalId: string, body: SignalActionBody): Promise<SignalActionReply> {
    this.authorize();
    return this.client.post<SignalActionReply>(`/api/projects/${encodeURIComponent(projectId)}/repo-signals/signals/${encodeURIComponent(signalId)}`, body);
  }
}
