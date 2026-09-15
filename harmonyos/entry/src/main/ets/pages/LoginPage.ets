import router from '@ohos.router';
import { LoginView } from '../components/LoginView';

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
