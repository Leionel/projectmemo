export type MissionReadTarget = {
  questionId?: string;
  approvalId?: string;
  outputId?: string;
  revision?: number;
  receiptId?: string;
};
export function missionNavigationHref(
  projectId: string,
  missionId: string,
  target: MissionReadTarget = {},
) {
  const p = new URLSearchParams({ mission: missionId });
  for (const [key, value] of Object.entries(target))
    if (value !== undefined && value !== "") p.set(key, String(value));
  return `/projects/${encodeURIComponent(projectId)}/missions?${p}`;
}
