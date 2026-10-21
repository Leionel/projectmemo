export class MissionWidgetSnapshot {
  ownerId: string = ''; projectId: string = ''; missionId: string = '';
  status: string = ''; pendingCount: number = 0; updatedAt: string = ''; expiresAt: number = 0;
}
export function visibleMissionWidget(snapshot: MissionWidgetSnapshot, ownerId: string, projectId: string, now: number): boolean {
  return ownerId !== '' && projectId !== '' && snapshot.ownerId === ownerId && snapshot.projectId === projectId &&
    snapshot.missionId !== '' && snapshot.expiresAt > now;
}
