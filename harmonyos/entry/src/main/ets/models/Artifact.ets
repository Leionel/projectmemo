export class ArtifactItem {
  id: string = '';
  projectId: string = '';
  artifactType: string = '';
  content: string = '';
  createdAt: string = '';
  updatedAt: string = '';
}

export class ArtifactsResponse {
  artifacts: ArtifactItem[] = [];
}

export class ArtifactGenerateResponse {
  artifact: ArtifactItem = new ArtifactItem();
}

export class ArtifactGenerateInput {
  artifactType: string = '';
  content: string | undefined = undefined;
}

// ---- 成果证据审计（R1：生成时回执 + 当前重新检查两个时间口径） ----

export class ArtifactGenerationRef {
  cardId: string = '';
  observedAt: string = '';
  titleSnapshot: string = '';
  summarySnapshot: string = '';
}

export class ArtifactAuditRecheckItem {
  cardId: string = '';
  titleSnapshot: string = '';
  summarySnapshot: string = '';
  supportState: string = 'INSUFFICIENT';
  statusLabel: string = '证据不足';
  supersededByTitle: string | null = null;
  supersededConfirmedAt: string | null = null;
  supersededReason: string | null = null;
}

export class ArtifactAuditResponse {
  artifactId: string = '';
  artifactType: string = '';
  generatedAt: string = '';
  untraceable: boolean = false;
  message: string = '';
  generationRefs: ArtifactGenerationRef[] = [];
  recheck: ArtifactAuditRecheckItem[] = [];
  recheckedAt: string = '';
}
