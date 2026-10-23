import { AuthService } from '../services/AuthService';
import { AccountCapabilities, RegisterInput, AccountEmailInput, AccountMessage } from '../models/Auth';
import { ApiError } from '../models/Project';
import { buildRegisterInput, registrationError, accountEmailError } from '../common/AccountContract';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily } from '../common/DesignTokens';

@Component
export struct LoginView {
  @State username: string = '';
  @State email: string = '';
  @State password: string = '';
  @State confirmPassword: string = '';
  @State mode: string = 'login';
  @State isSubmitting: boolean = false;
  @State isChecking: boolean = true;
  @State errorMessage: string = '';
  @State successMessage: string = '';
  @State mailStatus: string = '';
  @State capabilities: AccountCapabilities = new AccountCapabilities();
  public onLoginSuccess?: () => void;
  private authService: AuthService = new AuthService();
  private active: boolean = false;
  private version: number = 0;

  aboutToAppear(): void { this.active = true; this.loadCapabilities(); }
  aboutToDisappear(): void { this.active = false; this.version++; this.password = ''; this.confirmPassword = ''; }

  private async loadCapabilities(): Promise<void> {
    this.isChecking = true;
    try {
      const result: AccountCapabilities = await this.authService.capabilities();
      if (!this.active) return;
      this.capabilities = result;
      this.mailStatus = result.registrationEnabled ? '' : '邮件服务尚未配置，注册和找回密码暂不可用。已有账号仍可登录。';
    } catch (_e) {
      if (!this.active) return;
      this.mailStatus = '暂时无法确认账号服务状态。你仍可尝试登录，或重新检查服务。';
    } finally { if (this.active) this.isChecking = false; }
  }

  private changeMode(next: string): void {
    if (this.isSubmitting) return;
    this.mode = next; this.password = ''; this.confirmPassword = ''; this.errorMessage = ''; this.successMessage = '';
  }

  private title(): string {
    if (this.mode === 'register') return '创建你的账号';
    if (this.mode === 'forgot') return '找回密码';
    if (this.mode === 'resend') return '重发验证邮件';
    return '登录忆程';
  }

  private canSubmit(): boolean {
    if (this.isSubmitting) return false;
    if (this.mode === 'login') return this.username.trim() !== '' && this.password !== '';
    if (this.mode === 'register') return this.capabilities.registrationEnabled && this.username.trim() !== '' && this.email.trim() !== '' && this.password !== '' && this.confirmPassword !== '';
    return this.capabilities.passwordResetEnabled && this.email.trim() !== '';
  }

  private async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.errorMessage = '';
    const registration: RegisterInput = buildRegisterInput(this.username, this.email, this.password, this.confirmPassword);
    const validation: string = this.mode === 'register' ? registrationError(registration) : this.mode === 'login' ? '' : accountEmailError(this.email);
    if (validation !== '') { this.errorMessage = validation; return; }
    const requestVersion: number = ++this.version;
    this.isSubmitting = true;
    try {
      if (this.mode === 'login') {
        await this.authService.login({ username: this.username.trim(), password: this.password, client: 'harmony' });
        if (!this.active || requestVersion !== this.version) return;
        this.password = '';
        if (this.onLoginSuccess) this.onLoginSuccess();
      } else {
        let message: string = '';
        if (this.mode === 'register') {
          const result = await this.authService.register(registration);
          message = result.message;
        } else {
          const input: AccountEmailInput = new AccountEmailInput();
          input.email = this.email.trim().toLowerCase();
          const response: AccountMessage = this.mode === 'forgot' ? await this.authService.requestPasswordReset(input) : await this.authService.resendVerification(input);
          message = response.message;
        }
        if (!this.active || requestVersion !== this.version) return;
        this.successMessage = message;
        this.password = ''; this.confirmPassword = '';
      }
    } catch (e) {
      if (!this.active || requestVersion !== this.version) return;
      this.errorMessage = e instanceof ApiError ? e.message : '请求未完成，请检查网络后重试';
    } finally { if (this.active && requestVersion === this.version) this.isSubmitting = false; }
  }

  @Builder
  FieldLabel(label: string) {
    Text(label).fontSize(PMFontSize.BODY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).margin({ bottom: 8 })
  }

  build() {
    Scroll() {
      Column({ space: 24 }) {
        Column({ space: 10 }) {
          Image($r('app.media.app_icon')).width(48).height(48).borderRadius(12).accessibilityText('忆程 ProjectMemo')
          Text('忆程 ProjectMemo').fontSize(24).fontFamily(PMFontFamily.BRAND_SERIF).fontColor(PMColors.INK_PRIMARY)
          Text('你的个人项目空间').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
        }.width('100%').margin({ top: 32, bottom: 8 })

        Column() {
          Text(this.title()).fontSize(25).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).margin({ bottom: 8 })
          Text(this.mode === 'login' ? '继续查看你的项目、记录和行动。' : '验证和重置通过邮件中的安全链接完成。')
            .fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY).lineHeight(22).margin({ bottom: 24 })

          if (this.successMessage !== '') {
            Text(this.successMessage).fontSize(PMFontSize.BODY).fontColor(PMColors.BRAND).lineHeight(24)
            Text('在邮件中打开链接完成操作，然后返回应用登录。注册成功不代表邮箱已验证。')
              .fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY).lineHeight(22).margin({ top: 16, bottom: 20 })
            Button('返回登录').width('100%').height(48).backgroundColor(PMColors.BRAND).fontColor(Color.White).onClick(() => this.changeMode('login'))
            Button('重新发送验证邮件', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).margin({ top: 12 }).onClick(() => this.changeMode('resend'))
          } else {
            if (this.errorMessage !== '') {
              Text(this.errorMessage).width('100%').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.RISK).lineHeight(22)
                .padding(12).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(8).margin({ bottom: 20 }).accessibilityText(this.errorMessage)
            }
            if (this.mode === 'login' || this.mode === 'register') {
              Column() {
                this.FieldLabel('账号')
                TextInput({ placeholder: '输入你的账号', text: this.username }).height(48).fontSize(PMFontSize.BODY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).border({ width: 1, color: PMColors.BORDER_SUBTLE }).enabled(!this.isSubmitting)
                  .accessibilityText('账号').onChange((value: string) => { this.username = this.mode === 'register' ? value.toLowerCase() : value; })
                if (this.mode === 'register') {
                  Text('3–32 位字母、数字、下划线或短横线，以字母或数字开头。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY).lineHeight(18).margin({ top: 6 })
                }
              }.width('100%').alignItems(HorizontalAlign.Start).margin({ bottom: 18 })
            }
            if (this.mode !== 'login') {
              Column() {
                this.FieldLabel('邮箱')
                TextInput({ placeholder: 'you@example.com', text: this.email }).type(InputType.Email).height(48).fontSize(PMFontSize.BODY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).border({ width: 1, color: PMColors.BORDER_SUBTLE }).enabled(!this.isSubmitting)
                  .accessibilityText('邮箱').onChange((value: string) => { this.email = value; })
              }.width('100%').alignItems(HorizontalAlign.Start).margin({ bottom: 18 })
            }
            if (this.mode === 'login' || this.mode === 'register') {
              Column() {
                this.FieldLabel('密码')
                TextInput({ placeholder: this.mode === 'login' ? '输入你的密码' : '至少 10 个字符', text: this.password }).type(InputType.Password).height(48).fontSize(PMFontSize.BODY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).border({ width: 1, color: PMColors.BORDER_SUBTLE }).enabled(!this.isSubmitting)
                  .accessibilityText('密码').onChange((value: string) => { this.password = value; })
              }.width('100%').alignItems(HorizontalAlign.Start).margin({ bottom: 18 })
            }
            if (this.mode === 'register') {
              Column() {
                this.FieldLabel('确认密码')
                TextInput({ placeholder: '再次输入密码', text: this.confirmPassword }).type(InputType.Password).height(48).fontSize(PMFontSize.BODY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).border({ width: 1, color: PMColors.BORDER_SUBTLE }).enabled(!this.isSubmitting)
                  .accessibilityText('确认密码').onChange((value: string) => { this.confirmPassword = value; })
              }.width('100%').alignItems(HorizontalAlign.Start).margin({ bottom: 18 })
            }
            Button(this.isSubmitting ? '正在提交…' : this.mode === 'login' ? '登录工作台' : this.mode === 'register' ? '注册并发送验证邮件' : this.mode === 'forgot' ? '发送重置邮件' : '发送验证邮件')
              .width('100%').height(48).fontSize(PMFontSize.BODY).fontColor(Color.White).backgroundColor(PMColors.BRAND).borderRadius(10)
              .enabled(this.canSubmit()).onClick(() => this.submit())
            if (this.mode === 'register') {
              Text('验证邮箱后才能登录。新账号不自带云模型调用额度。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY).lineHeight(20).margin({ top: 14 })
            }
            if (this.mode === 'login') {
              Row() {
                if (this.capabilities.registrationEnabled) {
                  Button('创建账号', { type: ButtonType.Normal }).height(44).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.isSubmitting).onClick(() => this.changeMode('register'))
                }
                Blank()
                Button('忘记密码？', { type: ButtonType.Normal }).height(44).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.isSubmitting && this.capabilities.passwordResetEnabled).onClick(() => this.changeMode('forgot'))
              }.width('100%').margin({ top: 16 })
              if (this.capabilities.registrationEnabled) {
                Button('重发邮箱验证', { type: ButtonType.Normal }).height(44).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).enabled(!this.isSubmitting).onClick(() => this.changeMode('resend'))
              }
            } else {
              Button('已有账号？返回登录', { type: ButtonType.Normal }).height(48).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.isSubmitting).margin({ top: 16 }).onClick(() => this.changeMode('login'))
            }
          }
        }.width('100%').padding(24).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER_SUBTLE }).borderRadius(20)

        if (this.mailStatus !== '') {
          Text(this.mailStatus).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY).lineHeight(22)
          Button(this.isChecking ? '正在检查…' : '重新检查账号服务', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.isChecking && !this.isSubmitting).onClick(() => this.loadCapabilities())
        }
        Text('项目资料由服务端保存。原有账号和演示账号继续使用原密码登录。')
          .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY).lineHeight(20).margin({ bottom: 28 })
      }.width('100%').constraintSize({ maxWidth: 480 }).padding({ left: 20, right: 20 })
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}
