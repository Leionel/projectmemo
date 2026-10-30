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
  @State observerEnabled: boolean = false;
  @State connections: DeploymentConnection[] = [];
  @State open: boolean = false;
  @State editing: boolean = false;
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
  private timer: number = -1;
  private lastRead: number = 0;
  private draftKey(): string { return 'deployment-controls:' + this.projectId; }
  async aboutToAppear(): Promise<void> {
    this.alive=true;this.epoch++; await ConversationDraftStore.bind(getContext(this),SessionStore.getUser().id);
    if(!this.alive)return;
    this.pending=ConversationDraftStore.read(this.draftKey()).directiveRequest;
    await this.load();
    this.timer=setInterval(()=>{this.clock=Date.now();if(this.open&&!this.busy&&Date.now()-this.lastRead>=30000)this.load();},1000);
  }
  aboutToDisappear(): void { this.alive=false;this.epoch++;if(this.timer>=0)clearInterval(this.timer); }
  private onProjectChange(): void {
    this.epoch++;this.reading=false;this.busy=false;this.connections=[];this.observerEnabled=false;this.editing=false;this.pending=ConversationDraftStore.read(this.draftKey()).directiveRequest;this.load();
  }
  private async load(): Promise<void> {
    if(this.reading)return;const token=this.epoch;this.reading=true;this.lastRead=Date.now();
    try{const reply=await new DeploymentService().list(this.projectId);if(this.alive&&token===this.epoch){this.observerEnabled=reply.enabled;this.connections=reply.connections;}}
    catch(e){if(this.alive&&token===this.epoch){const failure=e as ApiError;if(failure.status===401||failure.status===403||failure.status===404){this.observerEnabled=false;this.connections=[];}else this.error=failure.message;}}
    finally{if(token===this.epoch)this.reading=false;}
  }
  private edit(c: DeploymentConnection | null): void {
    this.selectedId=c?.id||'';this.selectedRevision=c?.revision||0;
    this.config=c?JSON.parse(JSON.stringify(c.config)) as DeploymentConfig:new DeploymentConfig();this.editing=true;this.error='';
  }
  private async submit(p: DeploymentPending): Promise<void> {
    if(this.busy)return;const token=this.epoch;this.busy=true;this.error='';
    const draft=ConversationDraftStore.read(this.draftKey());draft.directiveRequest=JSON.stringify(p);ConversationDraftStore.save(this.draftKey(),draft);
    this.pending=draft.directiveRequest;
    try{if(!await ConversationDraftStore.flush())throw new ApiError('DRAFT_NOT_SAVED','原请求尚未保存，暂未提交',0);
      await new DeploymentService().mutate(p);if(!this.alive||token!==this.epoch)return;
      const saved=ConversationDraftStore.read(this.draftKey());saved.directiveRequest='';ConversationDraftStore.save(this.draftKey(),saved);this.pending='';this.editing=false;await this.load();
    }catch(e){if(!this.alive||token!==this.epoch)return;const failure=e as ApiError;this.error=failure.message;
      if(failure.status>=400&&failure.status<500){const saved=ConversationDraftStore.read(this.draftKey());saved.directiveRequest='';ConversationDraftStore.save(this.draftKey(),saved);this.pending='';}}
    finally{if(this.alive&&token===this.epoch)this.busy=false;}
  }
  private save(): void {
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
    if(this.observerEnabled||this.connections.length>0){
      Column({space:12}){
        Button('工程验收与环境观察').height(44).onClick(()=>{this.open=!this.open;})
        if(this.open){
          ForEach(this.connections,(c:DeploymentConnection)=>{
            Column({space:8}){
              Text(c.config.environment+' · '+c.config.expectedRelease).fontWeight(FontWeight.Medium)
              Text(c.config.origin).fontSize(13)
              Text(c.status==='ACTIVE'?Date.parse(c.config.expiresAt)>this.clock?'只读许可期内':'许可已到期':'已撤销').fontSize(13)
              Text(c.latest?'上次观察：'+c.latest.observedAt+(this.fresh(c)?' · 证据在有效期内':' · 历史观察，需重新核对'):'尚无已保存观察').fontSize(13)
              if(this.fresh(c)&&c.latest){ForEach(c.latest.layers,(l:DeploymentLayer)=>{Text(this.layerLabel(l.layer)+'：'+this.layerLabel(l.state)+'\n'+l.description).fontSize(13)},(l:DeploymentLayer)=>l.layer)}
              if(c.status==='ACTIVE'){
                Button('交给忆程调查').height(44).enabled(!this.busy&&!this.pending&&this.observerEnabled&&Date.parse(c.config.expiresAt)>this.clock).onClick(()=>{this.discuss(c);})
                Button('修订只读许可').height(44).enabled(!this.busy&&!this.pending&&this.observerEnabled).onClick(()=>{this.edit(c);})
                Button('撤销读取').height(44).enabled(!this.busy&&!this.pending).onClick(()=>{this.revoke(c);})
              }
            }.width('100%').alignItems(HorizontalAlign.Start)
          },(c:DeploymentConnection)=>c.id)
          if(this.pending){Button('核对上次授权结果').height(44).enabled(!this.busy).onClick(()=>{this.submit(JSON.parse(this.pending) as DeploymentPending);})}
          if(!this.editing&&this.observerEnabled){Button('连接一个只读环境').height(44).enabled(!this.busy&&!this.pending).onClick(()=>{this.edit(null);})}
          if(this.editing){
            TextInput({text:this.config.environment,placeholder:'环境名'}).enabled(!this.busy&&!this.pending&&!this.selectedId).onChange((v:string)=>{this.config.environment=v;})
            TextInput({text:this.config.origin,placeholder:'公开HTTPS服务地址'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.origin=v;})
            TextInput({text:this.config.expectedRelease,placeholder:'期望版本号或提交SHA'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.expectedRelease=v;})
            TextInput({text:this.config.expiresAt,placeholder:'许可到期ISO时间（含时区）'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.expiresAt=v;})
            TextInput({text:this.config.healthPath,placeholder:'自检JSON路径'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.healthPath=v;})
            TextInput({text:this.config.userPath||'',placeholder:'公共用户路径（可选）'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.userPath=v||undefined;})
            TextInput({text:this.config.logPath||'',placeholder:'公开日志JSON路径（另行允许）'}).enabled(!this.busy&&!this.pending).onChange((v:string)=>{this.config.logPath=v||undefined;})
            Text('只允许GET固定公开路径，不携带凭据、不跟随重定向。许可不会部署或确认行动完成。').fontSize(13)
            if(this.selectedId){Button('核对最新授权版本，保留修改').height(44).enabled(!this.busy&&!this.pending).onClick(()=>{const latest=this.connections.find((c:DeploymentConnection)=>c.id===this.selectedId);if(latest)this.selectedRevision=latest.revision;})}
            Button('确认这些路径的只读许可').height(44).enabled(!this.busy&&!this.pending).onClick(()=>{this.save();})
            Button('取消').height(44).enabled(!this.busy&&!this.pending).onClick(()=>{this.editing=false;})
          }
          if(this.error){Text(this.error).fontColor(PMColors.INK_SECONDARY)}
        }
      }.width('100%').padding(12).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
    }
  }
}
