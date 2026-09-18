import formInfo from '@ohos.app.form.formInfo';
import formBindingData from '@ohos.app.form.formBindingData';
import formProvider from '@ohos.app.form.formProvider';
import FormExtensionAbility from '@ohos.app.form.FormExtensionAbility';
import Want from '@ohos.app.ability.Want';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { WidgetDataService } from '../services/WidgetDataService';

const TAG = 'EntryFormAbility';
const DOMAIN = 0x0000;

export default class EntryFormAbility extends FormExtensionAbility {
  private buildFormData(want?: Want): Record<string, string | number> {
    const dimension = typeof want?.parameters?.[formInfo.FormParam.DIMENSION_KEY] === 'number'
      ? (want.parameters?.[formInfo.FormParam.DIMENSION_KEY] as number)
      : 3; // 2=2*2, 3=2*4

    // 优先从真实本地持久化数据中加载已同步的项目看板
    const cachedData = WidgetDataService.getCachedWidgetDataSync(this.context);

    const title = typeof want?.parameters?.['projectTitle'] === 'string' && (want.parameters?.['projectTitle'] as string).trim() !== ''
      ? (want.parameters?.['projectTitle'] as string)
      : (cachedData['projectTitle'] as string);

    const daysLeft = typeof want?.parameters?.['daysLeft'] === 'number'
      ? (want.parameters?.['daysLeft'] as number)
      : (cachedData['daysLeft'] as number);

    const readiness = typeof want?.parameters?.['readiness'] === 'number'
      ? (want.parameters?.['readiness'] as number)
      : (cachedData['readiness'] as number);

    const nextAction = typeof want?.parameters?.['nextAction'] === 'string' && (want.parameters?.['nextAction'] as string).trim() !== ''
      ? (want.parameters?.['nextAction'] as string)
      : (cachedData['nextAction'] as string);

    const status = typeof want?.parameters?.['status'] === 'string' && (want.parameters?.['status'] as string).trim() !== ''
      ? (want.parameters?.['status'] as string)
      : (cachedData['status'] as string);

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
    try {
      const formId = want?.parameters?.[formInfo.FormParam.IDENTITY_KEY] as string;
      if (formId) {
        WidgetDataService.registerFormId(this.context, formId).catch((err: Error) => {
          hilog.error(DOMAIN, TAG, 'Failed to register formId in onAddForm: %{public}s', err.message);
        });
      }

      const formData = this.buildFormData(want);
      return formBindingData.createFormBindingData(formData);
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'onAddForm error fallback: %{public}s', JSON.stringify(err));
      return formBindingData.createFormBindingData({
        'formDimension': 3,
        'projectTitle': '忆程项目看板',
        'daysLeft': 0,
        'readiness': 0,
        'nextAction': '打开应用同步项目待办',
        'status': '待同步'
      });
    }
  }

  onCastToNormalForm(formId: string): void {
    hilog.info(DOMAIN, TAG, 'onCastToNormalForm formId: %{public}s', formId);
  }

  onUpdateForm(formId: string): void {
    hilog.info(DOMAIN, TAG, 'onUpdateForm formId: %{public}s', formId);
    try {
      if (formId) {
        WidgetDataService.registerFormId(this.context, formId).catch((err: Error) => {
          hilog.error(DOMAIN, TAG, 'Failed to register formId in onUpdateForm: %{public}s', err.message);
        });
      }
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
    if (formId) {
      WidgetDataService.unregisterFormId(this.context, formId).catch((err: Error) => {
        hilog.error(DOMAIN, TAG, 'Failed to unregister formId in onRemoveForm: %{public}s', err.message);
      });
    }
  }

  onAcquireFormState(want: Want): formInfo.FormState {
    return formInfo.FormState.READY;
  }
}

