import router from '@ohos.router';
import { GoalQuestion, GoalQuestionInput } from '../models/DecisionEvolution';
import { DecisionEvolutionService } from '../services/DecisionEvolutionService';
import { SessionStore } from '../services/SessionStore';
import { ConversationService } from '../services/ConversationService';
import { ApiError } from '../models/Project';
import { PMButton } from './PMReferencePrimitives';
import { PMColors, PMFontSize, PMSpacing, PMRadius } from '../common/DesignTokens';
@Component
export struct GoalQuestionPanel {
 @State private conversationEnabled: boolean = false;
 @Prop projectId: string = '';
 @Prop missionId: string = '';
 @Prop compact: boolean = false;
 @State question: GoalQuestion | null = null;
 @State mutedMissionId: string = '';
 @State error: string = '';
 @State busy: boolean = false;
 @State fresh: boolean = false;
 @State showOptions: boolean = false;
 @State feedback: string = '';
 private generation: number = 0;
 private keys: Record<string, string> = {};
 private exposed: string = '';
 private expired: () => void = () => { this.generation++; this.question = null; this.mutedMissionId = ''; this.fresh = false; this.busy = false; };
 aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.load(); const g = this.generation; const token = SessionStore.getToken(); new ConversationService().capabilities().then(v => { if (this.current(g, token)) this.conversationEnabled = v.enabled; }).catch(() => {}); }
 aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
 private input(q: GoalQuestion, action: string): GoalQuestionInput { const body = new GoalQuestionInput(); body.action = action; body.questionId = q.questionId; body.contextHash = q.contextHash; const key = `${q.contextHash}:${action}`; if (this.keys[key] === undefined) this.keys[key] = `question-${Date.now()}-${Math.random().toString(36).slice(2)}`; body.requestId = this.keys[key]; return body; }
 private current(g: number, token: string): boolean { return g === this.generation && token === SessionStore.getToken(); }
 private async load(): Promise<void> {
  if (this.projectId === '') return; const g = ++this.generation; const token = SessionStore.getToken(); this.error = ''; this.busy = true;
  try { const service = new DecisionEvolutionService(); const reply = await service.question(this.projectId); if (!this.current(g, token)) return; this.mutedMissionId = reply.mutedMissionId ?? '';
   if (reply.question === null || this.missionId !== '' && reply.question.missionId !== this.missionId) { this.question = null; this.fresh = true; return; }
   const presented = await service.respond(this.projectId, this.input(reply.question, 'PRESENT')); if (!this.current(g, token)) return; this.question = presented.allowed ? presented.question : null; this.fresh = true;
  } catch (e) { if (!this.current(g, token)) return; this.error = e instanceof ApiError ? e.message : '当前问题暂不可读，保留历史内容'; this.fresh = false; if (e instanceof ApiError && [401, 403, 404].includes(e.status)) this.question = null; }
  finally { if (g === this.generation) this.busy = false; }
 }
 private async respond(action: string): Promise<void> {
  const q = this.question; if (q === null || !this.fresh || this.busy) return; const g = this.generation; const token = SessionStore.getToken(); if (action !== 'EXPOSED') this.busy = true;
  try { await new DecisionEvolutionService().respond(this.projectId, this.input(q, action)); if (!this.current(g, token)) return;
   if (action === 'WORTH_IT') this.feedback = '反馈已保存';
   if (['UNKNOWN', 'LATER', 'STOP', 'NOT_USEFUL'].includes(action)) { this.mutedMissionId = q.missionId; this.question = null; }
  } catch (e) { if (!this.current(g, token)) return; this.error = e instanceof ApiError ? e.message : '反馈未保存，请重试'; if (action === 'EXPOSED') this.exposed = ''; }
  finally { if (g === this.generation) this.busy = false; }
 }
 private async reset(): Promise<void> { if (this.mutedMissionId === '' || this.busy) return; const g = this.generation; const token = SessionStore.getToken(); this.busy = true; try { await new DecisionEvolutionService().resetQuestion(this.mutedMissionId); if (!this.current(g, token)) return; this.mutedMissionId = ''; this.load(); } catch (e) { if (this.current(g, token)) this.error = e instanceof ApiError ? e.message : '恢复提示失败，请重试'; } finally { if (this.current(g, token)) this.busy = false; } }
 build() {
  Column({ space: PMSpacing.SM }) {
   if (this.question !== null) {
    if (!this.compact) {
     Text(this.question.text).fontSize(PMFontSize.BODY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
     Text(this.question.whyNow).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
     PMButton({ label: this.question.kind === 'WAITING_INPUT' ? '补充到原问题' : '核对并接续原委托', disabled: this.busy || !this.fresh, onAction: (): void => {
      router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: this.question!.missionId, questionId: this.question!.kind === 'WAITING_INPUT' ? this.question!.questionId : '' } });
     } })
    }
    if (this.conversationEnabled) { PMButton({ label: '围绕这项问题追问', secondary: true, onAction: (): void => { if (this.question !== null) router.pushUrl({ url: 'pages/FocusConversation', params: { projectId: this.projectId, originKind: 'GOAL_QUESTION', originId: this.question!.questionId } }); } }) }
    Row({ space: PMSpacing.SM }) {
     Button('还不知道').type(ButtonType.Normal).height(44).layoutWeight(1).fontSize(PMFontSize.SECONDARY)
      .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON)
      .enabled(!this.busy && this.fresh).onClick(() => { this.respond('UNKNOWN'); })
     Button('明天再看').type(ButtonType.Normal).height(44).layoutWeight(1).fontSize(PMFontSize.SECONDARY)
      .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON)
      .enabled(!this.busy && this.fresh).onClick(() => { this.respond('LATER'); })
    }.width('100%')
    Button(this.showOptions ? '收起问题选项' : '问题选项与反馈').type(ButtonType.Normal).height(44)
     .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).borderRadius(PMRadius.BUTTON)
     .onClick(() => { this.showOptions = !this.showOptions; })
    if (this.showOptions) {
     Row({ space: PMSpacing.SM }) {
      Button('有帮助').type(ButtonType.Normal).height(44).layoutWeight(1).fontSize(PMFontSize.SECONDARY)
       .fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.BUTTON)
       .enabled(!this.busy && this.fresh).onClick(() => { this.respond('WORTH_IT'); })
      Button('没帮助').type(ButtonType.Normal).height(44).layoutWeight(1).fontSize(PMFontSize.SECONDARY)
       .fontColor(PMColors.INK_SECONDARY).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.BUTTON)
       .enabled(!this.busy && this.fresh).onClick(() => { this.respond('NOT_USEFUL'); })
     }.width('100%')
     Button('停止此委托的主动追问').type(ButtonType.Normal).constraintSize({ minHeight: 44 }).fontSize(PMFontSize.SECONDARY)
      .fontColor(PMColors.RISK).backgroundColor(Color.Transparent).borderRadius(PMRadius.BUTTON)
      .enabled(!this.busy && this.fresh).onClick(() => { this.respond('STOP'); })
    }
    if (this.feedback !== '') { Text(this.feedback).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY) }
   }
   if (this.mutedMissionId !== '') { PMButton({ label: '恢复问题提示', secondary: true, disabled: this.busy, onAction: (): void => { this.reset(); } }) }
   if (this.error !== '') { Text(this.error).fontSize(PMFontSize.CAPTION).fontColor(PMColors.RISK); PMButton({ label: '重新读取问题', secondary: true, disabled: this.busy, onAction: (): void => { this.load(); } }) }
  }.width('100%').alignItems(HorizontalAlign.Start).onVisibleAreaChange([0.5], (visible: boolean, ratio: number) => { if (visible && ratio >= 0.5 && this.question !== null && this.exposed !== this.question.contextHash) { this.exposed = this.question.contextHash; this.respond('EXPOSED'); } })
 }
}
