import { Project } from './Project';

export class UserInfo {
  id: string = '';
  username: string = '';
  displayName: string = '';
}

export class LoginInput {
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
