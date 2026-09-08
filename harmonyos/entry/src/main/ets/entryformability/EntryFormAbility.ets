import formInfo from '@ohos.app.form.formInfo';
import formBindingData from '@ohos.app.form.formBindingData';
import formProvider from '@ohos.app.form.formProvider';
import FormExtensionAbility from '@ohos.app.form.FormExtensionAbility';
import Want from '@ohos.app.ability.Want';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'EntryFormAbility';
const DOMAIN = 0x0000;

export default class EntryFormAbility extends FormExtensionAbility {
  private buildFormData(want?: Want): Record<string, string | number> {
    const title = typeof want?.parameters?.['projectTitle'] === 'string'
      ? (want.parameters?.['projectTitle'] as string)
      : '忆程 ProjectMemo 备赛看板';
    const daysLeft = typeof want?.parameters?.['daysLeft'] === 'number'
      ? (want.parameters?.['daysLeft'] as number)
      : 2;
    const readiness = typeof want?.parameters?.['readiness'] === 'number'
      ? (want.parameters?.['readiness'] as number)
      : 80;
    const nextAction = typeof want?.parameters?.['nextAction'] === 'string'
      ? (want.parameters?.['nextAction'] as string)
      : '完成端侧轻量方案消融测试';
    const status = typeof want?.parameters?.['status'] === 'string'
      ? (want.parameters?.['status'] as string)
      : '备赛决胜阶段';

    return {
      'projectTitle': title,
      'daysLeft': daysLeft,
      'readiness': readiness,
      'nextAction': nextAction,
      'status': status
    };
  }

  onAddForm(want: Want): formBindingData.FormBindingData {
    hilog.info(DOMAIN, TAG, 'onAddForm called');
    const formData = this.buildFormData(want);
    return formBindingData.createFormBindingData(formData);
  }

  onCastToNormalForm(formId: string): void {
    hilog.info(DOMAIN, TAG, 'onCastToNormalForm formId: %{public}s', formId);
  }

  onUpdateForm(formId: string): void {
    hilog.info(DOMAIN, TAG, 'onUpdateForm formId: %{public}s', formId);
    try {
      const updatedData = this.buildFormData();
      const bindingData = formBindingData.createFormBindingData(updatedData);
      formProvider.updateForm(formId, bindingData).catch((err: Error) => {
        hilog.error(DOMAIN, TAG, 'Failed to updateForm: %{public}s', err.message);
      });
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'Error in onUpdateForm: %{public}s', JSON.stringify(e));
    }
  }

  onChangeFormVisibility(newStatus: Record<string, number>): void {}

  onFormEvent(formId: string, message: string): void {
    hilog.info(DOMAIN, TAG, 'onFormEvent formId: %{public}s, message: %{public}s', formId, message);
  }

  onRemoveForm(formId: string): void {
    hilog.info(DOMAIN, TAG, 'onRemoveForm formId: %{public}s', formId);
  }

  onAcquireFormState(want: Want): formInfo.FormState {
    return formInfo.FormState.READY;
  }
}
