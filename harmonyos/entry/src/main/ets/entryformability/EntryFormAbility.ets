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
    const dimension = typeof want?.parameters?.[formInfo.FormParam.DIMENSION_KEY] === 'number'
      ? (want.parameters?.[formInfo.FormParam.DIMENSION_KEY] as number)
      : 3; // 2=2*2, 3=2*4

    // 未接入真实数据前，默认值必须显式标识为示例，避免演示时把演示数值当成真实项目状态
    const title = typeof want?.parameters?.['projectTitle'] === 'string' && (want.parameters?.['projectTitle'] as string).trim() !== ''
      ? (want.parameters?.['projectTitle'] as string)
      : '忆程备赛看板（示例数据）';
    const daysLeft = typeof want?.parameters?.['daysLeft'] === 'number'
      ? (want.parameters?.['daysLeft'] as number)
      : 2;
    const readiness = typeof want?.parameters?.['readiness'] === 'number'
      ? (want.parameters?.['readiness'] as number)
      : 80;
    const nextAction = typeof want?.parameters?.['nextAction'] === 'string' && (want.parameters?.['nextAction'] as string).trim() !== ''
      ? (want.parameters?.['nextAction'] as string)
      : '示例：连接后端后显示真实待办';
    const status = typeof want?.parameters?.['status'] === 'string' && (want.parameters?.['status'] as string).trim() !== ''
      ? (want.parameters?.['status'] as string)
      : '示例数据';

    return {
      'formDimension': dimension,
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
