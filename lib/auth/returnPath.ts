/** Keep authentication redirects inside the existing workspace routes. */
export function workspaceReturnPath(requestedPath: string | null): string {
  return requestedPath && /^\/(?:projects(?:\/|[?#]|$)|(?:focus|memory|actions)(?:[?#]|$))/.test(requestedPath) && !requestedPath.includes("\\")
    ? requestedPath : "/focus";
}
