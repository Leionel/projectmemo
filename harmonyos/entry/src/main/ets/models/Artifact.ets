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
