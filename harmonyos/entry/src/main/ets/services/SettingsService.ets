import { ApiClient } from './ApiClient';
import { SettingsResponse, UpdateSettingsInput, ProbeInput, ProbeResponse } from '../models/Settings';

export class SettingsService {
  private client: ApiClient;

  constructor(client?: ApiClient) {
    this.client = client ?? new ApiClient();
  }

  async getSettings(): Promise<SettingsResponse> {
    return this.client.get<SettingsResponse>('/api/settings');
  }

  async updateSettings(input: UpdateSettingsInput): Promise<SettingsResponse> {
    return this.client.post<SettingsResponse>('/api/settings', input);
  }

  async probeConnection(input: ProbeInput): Promise<ProbeResponse> {
    return this.client.post<ProbeResponse>('/api/settings/probe', input);
  }
}
