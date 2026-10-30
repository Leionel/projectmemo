export interface WorkOriginalRef { kind:string; id:string; version:number; }
export interface WorkState {
  phase:string; nextActor:string; requiresUser:boolean; reasonCode:string; reasonText:string; actionLabel:string;
  originalRef:WorkOriginalRef; exactQuestionRef:string|null; exactApprovalRef:string|null;
  checkedAt:string; observedAt:string|null; nextCheckAt:string|null; nextBoundary:string|null; freshness:string;
}
