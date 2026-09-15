import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { AuthService } from '../services/AuthService';
import { ApiError } from '../models/Project';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily, PMInteraction } from '../common/DesignTokens';
import { BookOpenIcon } from '../components/PMIcons';

@Component
export struct LoginView {
  @State username: string = '';
  @State password: string = '';
  @State showPassword: boolean = false;
  @State isSubmitting: boolean = false;
  @State errorMessage: string = '';

  public onLoginSuccess?: () => void;
  private authService: AuthService = new AuthService();

  private canSubmit(): boolean {
    return this.username.trim().length > 0 && this.password.length > 0 && !this.isSubmitting;
  }

  private async handleLogin(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      await this.authService.login({
        username: this.username.trim(),
        password: this.password,
        client: 'harmony',
      });

      this.password = '';
      if (this.onLoginSuccess) {
        this.onLoginSuccess();
      }
    } catch (e) {
      this.password = '';
      if (e instanceof ApiError) {
        if (e.code === 'AUTH_FAILED') {
          this.errorMessage = '账号或密码错误，请核对后重试';
        } else if (e.code === 'NETWORK_ERROR') {
          this.errorMessage = '网络连接失败，请检查服务地址与网络状态';
        } else if (e.code === 'RATE_LIMITED') {
          this.errorMessage = '尝试次数过多，请稍候再试';
        } else {
          this.errorMessage = e.message;
        }
      } else {
        this.errorMessage = '登录失败，请检查网络设置';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  build() {
    Scroll() {
      Column() {
        // 顶部品牌区
        Column() {
          Row() {
            BookOpenIcon({ iconSize: 32, color: PMColors.BRAND })
          }
          .width(64)
          .height(64)
          .borderRadius(PMRadius.MD)
          .backgroundColor(PMColors.BRAND_LIGHT)
          .justifyContent(FlexAlign.Center)
          .margin({ bottom: PMSpacing.MD })

          Text('忆程 ProjectMemo')
            .fontSize(PMFontSize.DISPLAY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .fontFamily(PMFontFamily.SANS)

          Text('登录复赛演示环境')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_SECONDARY)
            .margin({ top: PMSpacing.XS })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .margin({ top: 40, bottom: 32 })

        // 表单卡片
        Column() {
          // 演示账号提示与一键填入
          Row() {
            Column() {
              Text('预置复赛演示账号')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.BRAND)
              Text('contest-demo / contest-demo-2026')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Button('一键填入')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.XS)
              .height(32)
              .onClick(() => {
                this.username = 'contest-demo';
                this.password = 'contest-demo-2026';
                this.errorMessage = '';
              })
          }
          .width('100%')
          .padding(PMSpacing.SM)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.SM)
          .border({ width: 1, color: PMColors.BORDER_SUBTLE })
          .margin({ bottom: PMSpacing.MD })

          if (this.errorMessage !== '') {
            Row() {
              Text('⚠ ' + this.errorMessage)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.RISK)
                .maxLines(2)
            }
            .width('100%')
            .padding(PMSpacing.SM)
            .backgroundColor('#FFF1F0')
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: '#FFA39E' })
            .margin({ bottom: PMSpacing.MD })
          }

          // 用户名
          Column() {
            Text('账号')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .margin({ bottom: PMSpacing.XS })

            TextInput({ placeholder: '请输入复赛演示账号', text: this.username })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .borderRadius(PMRadius.SM)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .border({ width: 1, color: PMColors.BORDER_SUBTLE })
              .onChange((val: string) => {
                this.username = val;
                this.errorMessage = '';
              })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .margin({ bottom: PMSpacing.MD })

          // 密码
          Column() {
            Text('密码')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .margin({ bottom: PMSpacing.XS })

            Stack({ alignContent: Alignment.End }) {
              TextInput({
                placeholder: '请输入演示环境密码',
                text: this.password,
              })
                .type(this.showPassword ? InputType.Normal : InputType.Password)
                .fontSize(PMFontSize.BODY)
                .height(48)
                .width('100%')
                .borderRadius(PMRadius.SM)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .border({ width: 1, color: PMColors.BORDER_SUBTLE })
                .onChange((val: string) => {
                  this.password = val;
                  this.errorMessage = '';
                })

              Button(this.showPassword ? '隐藏' : '显示')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(Color.Transparent)
                .height(36)
                .margin({ right: 6 })
                .onClick(() => {
                  this.showPassword = !this.showPassword;
                })
            }
            .width('100%')
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .margin({ bottom: PMSpacing.LG })

          // 登录按钮
          Button(this.isSubmitting ? '登录中...' : '进入演示空间')
            .width('100%')
            .height(48)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(Color.White)
            .backgroundColor(this.canSubmit() ? PMColors.INK_PRIMARY : PMColors.INK_MUTED)
            .borderRadius(PMRadius.SM)
            .enabled(this.canSubmit())
            .onClick(() => {
              this.handleLogin();
            })
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .shadow({ radius: 8, color: '#0A000000', offsetY: 2 })

        // 底部提示说明卡片
        Column() {
          Text('关于复赛演示环境')
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ bottom: 4 })

          Text('本项目由服务端强制验证身份与项目归属。请使用组委会提供的演示账号与密码登录；未授权访问或无效凭证将被服务端安全拒绝。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
        }
        .width('100%')
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .margin({ top: PMSpacing.LG, bottom: 40 })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}

@Entry
@Component
struct LoginPage {
  build() {
    Column() {
      LoginView({
        onLoginSuccess: () => {
          router.replaceUrl({ url: 'pages/Index' });
        }
      })
    }
    .width('100%')
    .height('100%')
  }
}
