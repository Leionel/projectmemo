import util from '@ohos.util';
import router from '@ohos.router';
import { DeploymentConfig, DeploymentConnection, DeploymentLayer, DeploymentMutation, DeploymentPending } from '../models/Deployment';
import { DeploymentService } from '../services/DeploymentService';
import { ConversationService } from '../services/ConversationService';
import { ConversationCreateInput } from '../models/Conversation';
import { ConversationDraftStore } from '../services/ConversationDraftStore';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { PMColors, PMRadius } from '../common/DesignTokens';
interface DeploymentConversationParams { conversationId: string; projectId: string; }
@Component
export struct DeploymentConnectionsPanel {
  @Prop @Watch('onProjectChange') projectId: string = '';
  @Prop initialOpen: boolean = false;
  @State observerEnabled: boolean = false;
  @State connections: DeploymentConnection[] = [];
  @State open: boolean = false;
  @State editing: boolean = false;
  @State advanced: boolean = false;
  @State config: DeploymentConfig = new DeploymentConfig();
  @State selectedId: string = '';
  @State selectedRevision: number = 0;
  @State busy: boolean = false;
  @State error: string = '';
  @State pending: string = '';
  @State clock: number = Date.now();
  private alive: boolean = false;
  private epoch: number = 0;
  private reading: boolean = false;
  private readSequence: number = 0;
  private timer: number = -1;
  private lastRead: number = 0;
  private draftKey(): string { return 'deployment-controls:' + this.projectId; }
  async aboutToAppear(): Promise<void> {
    this.alive=true;this.epoch++;this.open=this.initialOpen; await ConversationDraftStore.bind(getContext(this),SessionStore.getUser().id);
    if(!this.alive)return;
    this.pending=ConversationDraftStore.read(this.draftKey()).directiveRequest;
    await this.load();
    this.timer=setInterval(()=>{this.clock=Date.now();if(this.open&&!this.busy&&Date.now()-this.lastRead>=30000)this.load();},1000);
  }
  aboutToDisappear(): void { this.alive=false;this.epoch++;if(this.timer>=0)clearInterval(this.timer); }
  private onProjectChange(): void {
    this.epoch++;this.reading=false;this.busy=false;this.connections=[];this.observerEnabled=false;this.editing=false;this.pending=ConversationDraftStore.read(this.draftKey()).directiveRequest;this.load();
  }
  private async load(force: boolean = false): Promise<void> {
    if(this.reading&&!force)return;const token=this.epoch;const sequence=++this.readSequence;this.reading=true;this.lastRead=Date.now();
    try{const reply=await new DeploymentService().list(this.projectId);if(this.alive&&token===this.epoch&&sequence===this.readSequence){this.observerEnabled=reply.enabled;this.connections=reply.connections;this.error='';}}
    catch(e){if(this.alive&&token===this.epoch&&sequence===this.readSequence){const failure=e as ApiError;if(failure.status===401||failure.status===403||failure.status===404){this.observerEnabled=false;this.connections=[];}else this.error=failure.message;}}
    finally{if(token===this.epoch&&sequence===this.readSequence)this.reading=false;}
  }
  private edit(c: DeploymentConnection | null): void {
    this.selectedId=c?.id||'';this.selectedRevision=c?.revision||0;
    this.config=c?JSON.parse(JSON.stringify(c.config)) as DeploymentConfig:new DeploymentConfig();this.editing=true;this.advanced=false;this.error='';
  }
  private async submit(p: DeploymentPending): Promise<void> {
    if(this.busy)return;const token=this.epoch;this.busy=true;this.error='';
    const draft=ConversationDraftStore.read(this.draftKey());draft.directiveRequest=JSON.stringify(p);ConversationDraftStore.save(this.draftKey(),draft);
    this.pending=draft.directiveRequest;
    try{if(!await ConversationDraftStore.flush())throw new ApiError('DRAFT_NOT_SAVED','原请求尚未保存，暂未提交',0);
      if(!this.alive||token!==this.epoch)return;
      await new DeploymentService().mutate(p);if(!this.alive||token!==this.epoch)return;
      const saved=ConversationDraftStore.read(this.draftKey());saved.directiveRequest='';ConversationDraftStore.save(this.draftKey(),saved);this.pending='';this.editing=false;await this.load(true);
    }catch(e){if(!this.alive||token!==this.epoch)return;const failure=e as ApiError;this.error=failure.message;
      if(failure.status>=400&&failure.status<500){const saved=ConversationDraftStore.read(this.draftKey());saved.directiveRequest='';ConversationDraftStore.save(this.draftKey(),saved);this.pending='';if(failure.status===409){await this.load(true);if(this.alive&&token===this.epoch)this.error=failure.message;}}}
    finally{if(this.alive&&token===this.epoch)this.busy=false;}
  }
  private dateLabel(value: string): string {
    const date=new Date(value);
    if(!Number.isFinite(date.getTime()))return '请选择许可期限';
    return `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  }
  private save(): void {
    if(!this.config.environment.trim()||!this.config.origin.trim()||!this.config.expectedRelease.trim()||!Number.isFinite(Date.parse(this.config.expiresAt))){this.error='请填写环境、地址、版本，并选择许可期限';return;}
    const p=new DeploymentPending();p.path=`/api/projects/${encodeURIComponent(this.projectId)}/deployment-connections`;
    p.body.requestId=util.generateRandomUUID(true);p.body.confirmedReadOnly=true;p.body.config=JSON.parse(JSON.stringify(this.config)) as DeploymentConfig;
    if(this.selectedId){p.method='PATCH';p.path+='/'+encodeURIComponent(this.selectedId);p.body.action='REVISE';p.body.expectedVersion=this.selectedRevision;}
    this.submit(p);
  }
  private revoke(c: DeploymentConnection): void {
    const p=new DeploymentPending();p.method='PATCH';p.path=`/api/projects/${encodeURIComponent(this.projectId)}/deployment-connections/${encodeURIComponent(c.id)}`;
    p.body=new DeploymentMutation();p.body.requestId=util.generateRandomUUID(true);p.body.action='REVOKE';p.body.expectedVersion=c.revision;this.submit(p);
  }
  private async discuss(c: DeploymentConnection): Promise<void> {
    const token=this.epoch;this.busy=true;
    try{const input=new ConversationCreateInput();input.requestId=util.generateRandomUUID(true);input.scope='PROJECT';input.projectId=this.projectId;input.entry={kind:'SOURCE_OBSERVATION',projectId:this.projectId,id:c.id};
      const reply=await new ConversationService().entry(input);if(this.alive&&token===this.epoch){const params:DeploymentConversationParams={conversationId:reply.id,projectId:this.projectId};router.pushUrl({url:'pages/FocusConversation',params});}
    }catch(e){if(this.alive&&token===this.epoch)this.error=(e as Error).message;}finally{if(this.alive&&token===this.epoch)this.busy=false;}
  }
  private fresh(c: DeploymentConnection): boolean { return c.status==='ACTIVE'&&Date.parse(c.config.expiresAt)>this.clock&&c.latest?.availability==='CURRENT'&&Date.parse(c.latest.validUntil)>this.clock; }
  private layerLabel(value: string): string { if(value==='BUILD')return '构建';if(value==='DEPLOY')return '部署';if(value==='SERVICE')return '服务自检';if(value==='USER_PATH')return '公共用户路径';if(value==='OBSERVED')return '已观察';if(value==='FAILED')return '未通过';if(value==='UNKNOWN')return '未知';if(value==='PARTIAL')return '部分证据';if(value==='STALE')return '已过期';return '待核对'; }
  build() {
    if(this.observerEnabled||this.connections.length>0||this.error){
      Column({space:12}){
        Button(this.open?'工程验收与环境观察  −':'工程验收与环境观察  ＋').width('100%').constraintSize({minHeight:44}).height('auto').padding(12).fontColor(PMColors.INK_PRIMARY).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.SM).onClick(()=>{this.open=!this.open;if(this.open)this.load();})
        if(this.open){
          ForEach(this.connections,(c:DeploymentConnection)=>{
            Column({space:8}){
              Text(c.config.environment).fontSize(16).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
              Text('期望版本 '+c.config.expectedRelease).fontSize(13).fontColor(PMColors.INK_SECONDARY)
              Text(c.config.origin).fontSize(13).fontColor(PMColors.INK_SECONDARY)
              Text(c.status==='ACTIVE'?Date.parse(c.config.expiresAt)>this.clock?'只读许可期内':'许可已到期':'已撤销').fontSize(13)
              Text(c.latest?'上次观察：'+this.dateLabel(c.latest.observedAt)+(this.fresh(c)?' · 证据在有效期内':c.latest.availability==='SUPPRESSED'?' · 已停止使用':' · 历史观察，需重新核对'):'尚无已保存观察').fontSize(13)
              if(this.fresh(c)&&c.latest){ForEach(c.latest.layers,(l:DeploymentLayer)=>{Text(this.layerLabel(l.layer)+'：'+this.layerLabel(l.state)+'\n'+l.description).fontSize(13)},(l:DeploymentLayer)=>l.layer)}
              if(c.status==='ACTIVE'){
                Button('交给忆程调查').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.SURFACE).backgroundColor(PMColors.BRAND).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending&&this.observerEnabled&&Date.parse(c.config.expiresAt)>this.clock).onClick(()=>{this.discuss(c);})
                Button('修订只读许可').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending&&this.observerEnabled).onClick(()=>{this.edit(c);})
                Button('撤销读取').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending).onClick(()=>{this.revoke(c);})
              }
              if(this.error){Text(this.error).fontSize(13).fontColor(PMColors.RISK);Button('重新读取环境许可').onClick(()=>{this.load();})}
      }.width('100%').padding(12).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.SM).alignItems(HorizontalAlign.Start)
          },(c:DeploymentConnection)=>c.id+':'+c.revision+':'+(c.latest?.sourceId||c.latest?.observedAt||'')+':'+(c.latest?.availability||''))
          if(this.pending){Button('核对上次授权结果').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).enabled(!this.busy).onClick(()=>{this.submit(JSON.parse(this.pending) as DeploymentPending);})}
          if(!this.editing&&this.observerEnabled){Button('连接一个只读环境').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending).onClick(()=>{this.edit(null);})}
          if(this.editing){
            Text('环境名').fontSize(13).fontWeight(FontWeight.Medium)
            TextInput({text:this.config.environment,placeholder:'环境名'}).enabled(!this.busy&&!this.pending&&!this.selectedId).onChange((v:string)=>{this.config.environment=v;})
            Text('公开 HTTPS 服务地址').fontSize(13).fontWeight(FontWeight.Medium)
            TextInput({text:this.config.origin,placeholder:'公开HTTPS服务地址'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.origin=v;})
            Text('期望版本号或提交 SHA').fontSize(13).fontWeight(FontWeight.Medium)
            TextInput({text:this.config.expectedRelease,placeholder:'期望版本号或提交SHA'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.expectedRelease=v;})
            Text('读取许可期限').fontSize(13).fontWeight(FontWeight.Medium)
            Row({space:8}){
              Button('24 小时').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending).onClick(()=>{this.config.expiresAt=new Date(Date.now()+86400000).toISOString();})
              Button('7 天').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending).onClick(()=>{this.config.expiresAt=new Date(Date.now()+7*86400000).toISOString();})
            }
            Text(this.dateLabel(this.config.expiresAt)).fontSize(13).fontColor(PMColors.INK_SECONDARY)
            Button(this.advanced?'收起高级设置':'高级设置 · 固定读取路径').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).onClick(()=>{this.advanced=!this.advanced;})
            if(this.advanced){
              Text('许可到期时间（ISO，含时区）').fontSize(13)
              TextInput({text:this.config.expiresAt,placeholder:'例如 2026-11-01T12:00:00+08:00'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.expiresAt=v;})
              Text('自检 JSON 路径').fontSize(13)
              TextInput({text:this.config.healthPath,placeholder:'/health'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.healthPath=v;})
              Text('公共用户路径（可选）').fontSize(13)
              TextInput({text:this.config.userPath||'',placeholder:'/public/check'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.userPath=v||undefined;})
              Text('公开日志 JSON 路径（另行允许读取）').fontSize(13)
              TextInput({text:this.config.logPath||'',placeholder:'/public/logs'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.logPath=v||undefined;})
            }
            Text('仅允许读取这些公开路径，不携带凭据。由原讨论或委托发起调查，随时可以撤销。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
            if(this.selectedId&&this.connections.some((c:DeploymentConnection)=>c.id===this.selectedId&&c.revision!==this.selectedRevision)){Button('核对最新授权版本，保留修改').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending).onClick(()=>{const latest=this.connections.find((c:DeploymentConnection)=>c.id===this.selectedId);if(latest)this.selectedRevision=latest.revision;})}
            Button('确认这些路径的只读许可').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.SURFACE).backgroundColor(PMColors.BRAND).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending).onClick(()=>{this.save();})
            Button('取消').constraintSize({minHeight:44}).height('auto').padding({left:14,right:14,top:10,bottom:10}).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).enabled(!this.busy&&!this.pending).onClick(()=>{this.editing=false;})
          }
          if(this.busy){Text('正在核对，请稍候…').fontSize(13).fontColor(PMColors.INK_SECONDARY)}
        }
        if(this.error){Text(this.error).fontSize(13).fontColor(PMColors.RISK);Button('重新读取环境许可').onClick(()=>{this.load();})}
      }.width('100%').padding(12).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
    }
  }
}
