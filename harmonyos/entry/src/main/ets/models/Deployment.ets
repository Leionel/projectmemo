export class DeploymentConfig {
  schemaVersion: number = 1; environment: string = ''; origin: string = ''; expectedRelease: string = '';
  healthPath: string = '/health'; userPath?: string; logPath?: string; expiresAt: string = ''; freshnessSeconds: number = 600;
}
export interface DeploymentLayer { layer: string; state: string; description: string; }
export interface DeploymentLatest { observedAt: string; validUntil: string; availability: string; layers: DeploymentLayer[]; }
export interface DeploymentConnection { id: string; revision: number; status: string; config: DeploymentConfig; latest: DeploymentLatest | null; }
export interface DeploymentList { enabled: boolean; connections: DeploymentConnection[]; }
export class DeploymentMutation { requestId: string = ''; confirmedReadOnly?: boolean; config?: DeploymentConfig; action?: string; expectedVersion?: number; }
export class DeploymentPending { path: string = ''; method: string = 'POST'; body: DeploymentMutation = new DeploymentMutation(); }

export interface DeploymentSourceMeta { environment: string; expectedRelease: string; observedAt: string; validUntil: string; kind: string; }
