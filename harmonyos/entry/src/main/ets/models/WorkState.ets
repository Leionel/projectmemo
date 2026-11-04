export interface WorkOriginalRef { kind:string; id:string; version:number; }
export interface WorkState {
  phase:string; nextActor:string; requiresUser:boolean; reasonCode:string; reasonText:string; actionLabel:string;
  originalRef:WorkOriginalRef; exactQuestionRef:string|null; exactApprovalRef:string|null;
  checkedAt:string; observedAt:string|null; nextCheckAt:string|null; nextBoundary:string|null; freshness:string;
  /** 增量可选字段：旧服务缺失时为 undefined，不推断为成功或已停止。 */
  terminal?:WorkStateTerminalRef|null; stopRequest?:WorkStateStopRef;
}
export interface WorkStateTerminalRef { status:string; }
export interface WorkStateStopRef { state:string; settled:boolean; }
