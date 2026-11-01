import { ApiClient } from './ApiClient';
import { DeploymentList, DeploymentPending } from '../models/Deployment';
export class DeploymentService {
  private client: ApiClient = new ApiClient();
  list(projectId: string): Promise<DeploymentList> { return this.client.get<DeploymentList>(`/api/projects/${encodeURIComponent(projectId)}/deployment-connections`); }
  async mutate(pending: DeploymentPending): Promise<void> {
    if(pending.method === 'POST') await this.client.post<Object>(pending.path, pending.body);
    else await this.client.patch<Object>(pending.path, pending.body);
  }
}
