import { Project } from './Project';

export class UserInfo {
  id: string = '';
  username: string = '';
  displayName: string = '';
}

export class LoginInput {
  /** 兼容字段：承载用户名或已绑定邮箱；服务端按同一字段解析，旧客户端无需改协议。 */
  username: string = '';
  password: string = '';
  client: string = 'harmony';
}

export class LoginResponse {
  user: UserInfo = new UserInfo();
  accessToken: string = '';
  expiresAt: string = '';
  projects: Project[] = [];
}

export class MeResponse {
  user: UserInfo = new UserInfo();
  projects: Project[] = [];
}

export class AccountCapabilities {
  registrationEnabled: boolean = false;
  passwordResetEnabled: boolean = false;
}

export class RegisterInput {
  username: string = '';
  email: string = '';
  password: string = '';
  confirmPassword: string = '';
}

export class AccountEmailInput {
  email: string = '';
}

export class AccountMessage {
  message: string = '';
}

export class RegisterResponse {
  verificationRequired: boolean = true;
  message: string = '';
}
