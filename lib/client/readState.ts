export type ReadState = "fresh" | "lastKnown" | "unavailable";
export function failedReadState(
  hasPrevious: boolean,
  status: number,
): ReadState {
  return [401, 403, 404].includes(status) || !hasPrevious
    ? "unavailable"
    : "lastKnown";
}
export function mayApplyRead(
  requestGeneration: number,
  currentGeneration: number,
  requestIdentity: string,
  currentIdentity: string,
) {
  return (
    requestGeneration === currentGeneration &&
    requestIdentity === currentIdentity
  );
}
