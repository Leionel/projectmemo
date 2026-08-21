import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { Project, ProjectDashboard, ApiError } from '../models/Project';
import { ProjectDetail } from '../models/Memory';
import { Intervention } from '../models/Intervention';
import { ProjectService } from '../services/ProjectService';
import { InterventionService } from '../services/InterventionService';
import { MemoryService } from '../services/MemoryService';

@Entry
@Component
struct ProjectHome {
  @State projectId: string = '';
  @State project: ProjectDetail = new ProjectDetail();
  @State dashboard: ProjectDashboard = new ProjectDashboard();
  @State interventions: Intervention[] = [];
  @State topOpenIntervention: Intervention | undefined = undefined;
  @State isLoading: boolean = false;
  @State errorMessage: string = '';
  @State routeError: string = '';
  @State isEvaluating: boolean = false;
  @State evaluateError: string = '';
  @State rawText: string = '';
  @State isCapturing: boolean = false;
  @State captureError: string = '';

  private projectService: ProjectService = new ProjectService();
  private interventionService: InterventionService = new InterventionService();
  private memoryService: MemoryService = new MemoryService();

  aboutToAppear(): void {
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    if (params === undefined || params === null) {
      this.routeError = '页面参数缺失';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    if (this.projectId === '') {
      this.routeError = '页面参数缺失';
      return;
    }
    this.loadData();
  }

  private async loadData(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const detailPromise: Promise<ProjectDetail> = this.projectService.getProjectDetail(this.projectId);
      const listPromise: Promise<Project[]> = this.projectService.listProjects();
      const interventionPromise: Promise<Intervention[]> = this.interventionService.list(this.projectId);
      const results: [ProjectDetail, Project[], Intervention[]] =
        await Promise.all([detailPromise, listPromise, interventionPromise]);
      this.project = results[0];
      this.dashboard = this.findDashboard(results[1]);
      this.interventions = results[2];
      this.refreshTopOpenIntervention();
    } catch (e) {
      if (e instanceof ApiError) {
        this.errorMessage = e.message;
      } else {
        this.errorMessage = '未知错误';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private findDashboard(projects: Project[]): ProjectDashboard {
    for (const item of projects) {
      if (item.id === this.projectId) {
        return item.dashboard;
      }
    }
    return new ProjectDashboard();
  }

  private refreshTopOpenIntervention(): void {
    // 后端列表已按 status asc / severity desc 排序，第一个 OPEN 即 severity 最大
    let found: Intervention | undefined = undefined;
    for (const item of this.interventions) {
      if (item.status === 'OPEN') {
        found = item;
        break;
      }
    }
    this.topOpenIntervention = found;
  }

  private async evaluate(): Promise<void> {
    if (this.isEvaluating) {
      return;
    }
    this.isEvaluating = true;
    this.evaluateError = '';
    try {
      await this.projectService.evaluateProject(this.projectId);
      await this.refreshAfterEvaluate();
      promptAction.showToast({ message: '评估完成' });
    } catch (e) {
      if (e instanceof ApiError) {
        this.evaluateError = e.message;
      } else {
        this.evaluateError = '未知错误';
      }
    } finally {
      this.isEvaluating = false;
    }
  }

  private async refreshAfterEvaluate(): Promise<void> {
    const listPromise: Promise<Project[]> = this.projectService.listProjects();
    const interventionPromise: Promise<Intervention[]> = this.interventionService.list(this.projectId);
    const results: [Project[], Intervention[]] = await Promise.all([listPromise, interventionPromise]);
    this.dashboard = this.findDashboard(results[0]);
    this.interventions = results[1];
    this.refreshTopOpenIntervention();
  }

  private async capture(): Promise<void> {
    if (this.isCapturing) {
      return;
    }
    const trimmed: string = this.rawText.trim();
    if (trimmed === '') {
      return;
    }
    this.isCapturing = true;
    this.captureError = '';
    try {
      await this.memoryService.capture(this.projectId, trimmed);
      this.rawText = '';
      promptAction.showToast({ message: '已记录，记忆已更新' });
      await this.refreshProjectDetail();
    } catch (e) {
      if (e instanceof ApiError) {
        this.captureError = e.message;
      } else {
        this.captureError = '未知错误';
      }
    } finally {
      this.isCapturing = false;
    }
  }

  private async refreshProjectDetail(): Promise<void> {
    // 记录成功后重新加载 detail，使 _count.cards 记忆计数更新
    try {
      this.project = await this.projectService.getProjectDetail(this.projectId);
    } catch (_e) {
      // 记录本身已成功，刷新失败不提示；下次进入页面会重新加载
    }
  }

  private openInterventionDetail(): void {
    const intervention: Intervention | undefined = this.topOpenIntervention;
    if (intervention === undefined) {
      return;
    }
    router.pushUrl({
      url: 'pages/InterventionDetail',
      params: { projectId: this.projectId, interventionId: intervention.id }
    });
  }

  build() {
    Column() {
      Row() {
        Text('返回')
          .fontSize(16)
          .fontColor('#007DFF')
          .onClick(() => {
            router.back();
          })
        Text(this.project.title !== '' ? this.project.title : '项目驾驶舱')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ left: 16 })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })

      if (this.routeError !== '') {
        Column() {
          Text(this.routeError)
            .fontSize(16)
            .fontColor('#E84026')
            .margin({ bottom: 16 })
          Button('返回')
            .fontSize(14)
            .onClick(() => {
              router.back();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.isLoading) {
        Column() {
          LoadingProgress()
            .width(48)
            .height(48)
            .color('#007DFF')
          Text('加载中...')
            .fontSize(14)
            .fontColor('#999999')
            .margin({ top: 12 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.errorMessage !== '') {
        Column() {
          Text(this.errorMessage)
            .fontSize(16)
            .fontColor('#E84026')
            .textAlign(TextAlign.Center)
            .margin({ bottom: 16 })
          Button('重试')
            .fontSize(14)
            .onClick(() => {
              this.loadData();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .padding({ left: 32, right: 32 })
      } else if (this.project.id === '') {
        Column() {
          Text('项目无数据')
            .fontSize(16)
            .fontColor('#999999')
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        Scroll() {
          Column() {
            Column() {
              Text('项目状态')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
              Row() {
                Text(this.dashboard.deadline.label !== '' ? this.dashboard.deadline.label : '未设置截止')
                  .fontSize(14)
                  .fontColor(this.dashboard.deadline.label !== '' ? '#E84026' : '#999999')
                Text(`备赛进度 ${this.dashboard.readiness.percentage}%`)
                  .fontSize(14)
                  .fontColor('#007DFF')
                  .margin({ left: 16 })
              }
              .margin({ top: 12 })
              Row() {
                Text(`活跃提醒 ${this.dashboard.activeReminderCount}`)
                  .fontSize(14)
                  .fontColor('#666666')
                Text(`活跃行动 ${this.dashboard.activeActionCount}`)
                  .fontSize(14)
                  .fontColor('#666666')
                  .margin({ left: 16 })
              }
              .margin({ top: 8 })
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)

            Column() {
              Text('ProjectMemo 提醒')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
              if (this.topOpenIntervention !== undefined) {
                Text(`优先级 ${this.topOpenIntervention.severity}`)
                  .fontSize(12)
                  .fontColor('#E84026')
                  .margin({ top: 12 })
                Text(this.topOpenIntervention.title)
                  .fontSize(16)
                  .fontWeight(FontWeight.Medium)
                  .margin({ top: 4 })
                Text(this.topOpenIntervention.content)
                  .fontSize(14)
                  .fontColor('#666666')
                  .maxLines(3)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .margin({ top: 4 })
                Button('查看依据 →')
                  .fontSize(14)
                  .margin({ top: 12 })
                  .onClick(() => {
                    this.openInterventionDetail();
                  })
              } else {
                Text('暂无待处理提醒')
                  .fontSize(14)
                  .fontColor('#999999')
                  .margin({ top: 12 })
              }
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 12 })

            Column() {
              Text('快速记录')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
              Text(`已积累 ${this.project._count.cards} 条记忆`)
                .fontSize(12)
                .fontColor('#999999')
                .margin({ top: 4 })
              TextArea({ text: this.rawText, placeholder: '记录一条项目碎片（至少 5 个字）' })
                .onChange((value: string) => {
                  this.rawText = value;
                })
                .fontSize(14)
                .height(88)
                .margin({ top: 12 })
              if (this.captureError !== '') {
                Text(this.captureError)
                  .fontSize(14)
                  .fontColor('#E84026')
                  .margin({ top: 8 })
              }
              Button(this.isCapturing ? '记录中...' : '记录')
                .fontSize(14)
                .enabled(this.rawText.trim() !== '' && !this.isCapturing)
                .margin({ top: 12 })
                .onClick(() => {
                  this.capture();
                })
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 12 })

            Column() {
              Row() {
                Button(this.isEvaluating ? '评估中...' : '重新评估')
                  .fontSize(14)
                  .enabled(!this.isEvaluating)
                  .onClick(() => {
                    this.evaluate();
                  })
                Button('记忆')
                  .fontSize(14)
                  .margin({ left: 12 })
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/MemoryTimeline', params: { projectId: this.projectId } });
                  })
                Button('行动')
                  .fontSize(14)
                  .margin({ left: 12 })
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/ActionBoard', params: { projectId: this.projectId } });
                  })
              }
              .margin({ top: 16 })
              if (this.evaluateError !== '') {
                Text(this.evaluateError)
                  .fontSize(14)
                  .fontColor('#E84026')
                  .margin({ top: 8 })
              }
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 12 })
          }
          .padding({ left: 16, right: 16, bottom: 24 })
        }
        .width('100%')
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F5F5')
  }
}
