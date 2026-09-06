export class SettingsResponse {
  llmMode: string = 'mock'; // 'mock' | 'openai-compatible'
  llmBaseUrl: string = '';
  llmModelName: string = 'deepseek-v4-flash';
  hasApiKey: boolean = false;
  apiKeyMasked: string = '';
  editable: boolean = true;
  message: string | undefined = undefined;
}

export class UpdateSettingsInput {
  llmMode: string = 'mock';
  llmBaseUrl: string = '';
  llmApiKey: string = '';
  llmModelName: string = 'deepseek-v4-flash';
}

export class ProbeInput {
  llmBaseUrl: string | undefined = undefined;
  llmApiKey: string | undefined = undefined;
  llmModelName: string | undefined = undefined;
}

export class ProbeResponse {
  success: boolean = false;
  latencyMs: number = 0;
  model: string = '';
  reply: string = '';
  message: string = '';
  error: string = '';
}
