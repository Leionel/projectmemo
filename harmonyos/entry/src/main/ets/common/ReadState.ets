export function failedReadState(hasPrevious: boolean, status: number): string {
  return !hasPrevious || [401, 403, 404].includes(status) ? 'unavailable' : 'lastKnown';
}
export function mayApplyRead(requestGeneration: number, currentGeneration: number, requestIdentity: string, currentIdentity: string): boolean {
  return requestGeneration === currentGeneration && requestIdentity === currentIdentity;
}
