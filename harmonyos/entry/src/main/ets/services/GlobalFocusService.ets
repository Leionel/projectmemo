import { ApiClient } from './ApiClient';
import { GlobalFocusReply } from '../models/GlobalFocus';
export class GlobalFocusService {
  private client: ApiClient = new ApiClient();
  async read(archived: boolean = false): Promise<GlobalFocusReply> {
    return this.client.get<GlobalFocusReply>(`/api/workspace/focus${archived ? '?archived=1' : ''}`);
  }
}
