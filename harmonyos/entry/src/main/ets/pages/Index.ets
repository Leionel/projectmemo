import { Project } from '../models/Project';
import { ProjectService } from '../services/ProjectService';
import { ApiError } from '../models/Project';

@Entry
@Component
struct Index {
  @State projects: Project[] = [];
  @State isLoading: boolean = false;
  @State errorMessage: string = '';

  private projectService: ProjectService = new ProjectService();

  aboutToAppear(): void {
    this.loadProjects();
  }

  private async loadProjects(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      this.projects = await this.projectService.listProjects();
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

  build() {
    Column() {
      Text('ProjectMemo')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .margin({ top: 24, bottom: 16 })

      if (this.isLoading) {
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
        .height('60%')
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
              this.loadProjects();
            })
        }
        .width('100%')
        .height('60%')
        .justifyContent(FlexAlign.Center)
        .padding({ left: 32, right: 32 })
      } else if (this.projects.length === 0) {
        Column() {
          Text('暂无项目')
            .fontSize(16)
            .fontColor('#999999')
        }
        .width('100%')
        .height('60%')
        .justifyContent(FlexAlign.Center)
      } else {
        List({ space: 12 }) {
          ForEach(this.projects, (project: Project) => {
            ListItem() {
              Column() {
                Text(project.title)
                  .fontSize(18)
                  .fontWeight(FontWeight.Medium)
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(project.description)
                  .fontSize(14)
                  .fontColor('#666666')
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .margin({ top: 4 })
                Row() {
                  Text(`${project._count.cards} 卡片`)
                    .fontSize(12)
                    .fontColor('#999999')
                  Text(`${project._count.artifacts} 成果`)
                    .fontSize(12)
                    .fontColor('#999999')
                    .margin({ left: 12 })
                  if (project.dashboard.deadline.label !== '') {
                    Text(project.dashboard.deadline.label)
                      .fontSize(12)
                      .fontColor('#E84026')
                      .margin({ left: 12 })
                  }
                }
                .margin({ top: 8 })
              }
              .width('100%')
              .padding(16)
              .backgroundColor('#FFFFFF')
              .borderRadius(12)
            }
          }, (project: Project) => project.id)
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 16, right: 16 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F5F5')
  }
}
