export class MissionSourceTarget {
  url: string = '';
  params: Record<string, string> = {};
}

/** 来源 ID 只用于定位原对象，不进入正文。项目页继续负责归属与可见性检查。 */
export function missionSourceTarget(projectId: string, missionId: string, sourceId: string): MissionSourceTarget | null {
  if (projectId === '' || sourceId === '') return null;
  const target = new MissionSourceTarget();
  target.url = 'pages/ProjectHome';
  target.params['projectId'] = projectId;
  if (sourceId.startsWith('project:')) return sourceId === 'project:' + projectId ? target : null;
  const separator = sourceId.indexOf(':');
  if (separator < 0 || separator === sourceId.length - 1) return null;
  const kind = sourceId.substring(0, separator);
  const id = sourceId.substring(separator + 1);
  if (kind === 'card' || kind === 'capture') {
    target.params['tab'] = 'memory';
    target.params[kind === 'card' ? 'cardId' : 'captureId'] = id;
  } else if (kind === 'action') {
    target.params['tab'] = 'actions'; target.params['actionId'] = id;
  } else if (kind === 'artifact') {
    target.params['artifactId'] = id;
  } else if (kind === 'attachment') {
    target.url = 'pages/AttachmentViewer'; target.params['attachmentId'] = id;
  } else {
    if (missionId === '') return null;
    target.url = 'pages/ConversationWebSource'; target.params['missionId'] = missionId; target.params['sourceId'] = sourceId;
  }
  return target;
}
