"use client";

import type { WorkspaceArea, WorkspaceChangeDetail } from "@/lib/projectDashboard";

export const workspaceChangeEvent = "projectmemo:workspace-changed";

export function emitWorkspaceChange(projectId: string, areas: WorkspaceArea[]) {
  window.dispatchEvent(new CustomEvent<WorkspaceChangeDetail>(workspaceChangeEvent, { detail: { projectId, areas } }));
}

export function subscribeWorkspaceChange(projectId: string, areas: WorkspaceArea[], listener: (detail: WorkspaceChangeDetail) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<WorkspaceChangeDetail>).detail;
    if (!detail || detail.projectId !== projectId || !detail.areas.some((area) => areas.includes(area))) return;
    listener(detail);
  };
  window.addEventListener(workspaceChangeEvent, handler);
  return () => window.removeEventListener(workspaceChangeEvent, handler);
}
