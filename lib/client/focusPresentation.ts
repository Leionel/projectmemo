import type {GlobalFocus, FocusEntry} from "@/lib/types/globalFocus";
/** Same selection as the ArkTS adapter; never choose a different task in the UI. */
export function focusPrimary(view: GlobalFocus): FocusEntry | null {
  const c=view.primaryContext;
  if(c){const n=c.nextStep;return {id:n.entityRef.id,projectId:c.projectId,projectTitle:c.projectTitle,title:n.title,detail:n.reason,status:n.status,
    entityKind:n.entityRef.kind,actionLabel:n.actionLabel,workState:n.workState,activity:"",activityAt:c.observedAt,recordedAt:"",dueAt:"",projectDeadline:"",recordFields:[]};}
  return view.waiting.find(x=>x.workState?x.workState.requiresUser:["WAITING_INPUT","WAITING_APPROVAL"].includes(x.status))
    ??view.reminders[0]??view.actions[0]??view.running[0]??view.waiting[0]??view.records[0]??null;
}

export function workPhaseLabel(phase:string):string {
  const labels:Record<string,string>={QUEUED:"待执行",RUNNING:"正在调查",WAITING_OBSERVATION:"等待新变化",WAITING_USER:"等你补充",WAITING_APPROVAL:"等你确认",PAUSED:"已暂停",FAILED:"这一步未完成",UNKNOWN:"状态待核对",COMPLETED:"已结束",UNAVAILABLE:"状态暂不可用"};
  return labels[phase]??"状态待核对";
}
