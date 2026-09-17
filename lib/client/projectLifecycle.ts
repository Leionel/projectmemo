"use client";

/**
 * 项目生命周期操作的唯一客户端入口。
 *
 * 项目卡片和项目设置面板都要用这三个动作。两处各写一份 fetch 迟早会在
 * 错误文案和状态处理上分叉，所以这里只留一份实现，调用方只管 UI。
 */

export type ProjectLifecycleAction = "archive" | "restore" | "delete";

export interface ProjectLifecycleResult {
  ok: boolean;
  message: string;
  archivedAt?: string | null;
}

const ACTION_LABEL: Record<ProjectLifecycleAction, string> = {
  archive: "归档",
  restore: "恢复",
  delete: "删除",
};

/**
 * 归档与删除是不同性质的动作，不要互相假装：
 * 归档是可恢复的展示偏好，删除会级联清空该项目的记忆、行动与成果。
 */
export async function runProjectLifecycleAction(
  projectId: string,
  action: ProjectLifecycleAction,
): Promise<ProjectLifecycleResult> {
  let response: Response;
  try {
    response = action === "delete"
      ? await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
      : await fetch(`/api/projects/${projectId}/${action}`, { method: "POST" });
  } catch {
    return { ok: false, message: `网络异常，${ACTION_LABEL[action]}未完成，请重试` };
  }

  const data = response.status === 204
    ? null
    : await response.json().catch(() => null) as { error?: { message?: string }; project?: { archivedAt?: string | null } } | null;

  if (!response.ok) {
    return { ok: false, message: data?.error?.message ?? `${ACTION_LABEL[action]}失败，请稍后重试` };
  }

  return {
    ok: true,
    message: `${ACTION_LABEL[action]}成功`,
    archivedAt: data?.project?.archivedAt ?? null,
  };
}