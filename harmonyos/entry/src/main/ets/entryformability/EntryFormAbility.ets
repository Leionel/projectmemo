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
  private buildFormData(want?: Want, explicitDimension?: number): Record<string, string | number | boolean> {
    let dimension = explicitDimension;
    if (typeof dimension !== 'number') {
      dimension = typeof want?.parameters?.[formInfo.FormParam.DIMENSION_KEY] === 'number'
        ? (want.parameters?.[formInfo.FormParam.DIMENSION_KEY] as number)
        : 3; // 2=2*2, 3=2*4
    }

    // 优先从真实本地持久化数据中加载已同步的项目看板
    const cachedData = WidgetDataService.getCachedWidgetDataSync(this.context);

    const projectId = typeof want?.parameters?.['projectId'] === 'string' && (want.parameters?.['projectId'] as string).trim() !== ''
      ? (want.parameters?.['projectId'] as string)
      : (cachedData['projectId'] as string);

    const title = typeof want?.parameters?.['projectTitle'] === 'string' && (want.parameters?.['projectTitle'] as string).trim() !== ''
      ? (want.parameters?.['projectTitle'] as string)
      : (cachedData['projectTitle'] as string);

    const daysLeft = typeof want?.parameters?.['daysLeft'] === 'number'
      ? (want.parameters?.['daysLeft'] as number)
      : (cachedData['daysLeft'] as number);

    const hasDeadline = typeof want?.parameters?.['hasDeadline'] === 'boolean'
      ? (want.parameters?.['hasDeadline'] as boolean)
      : (cachedData['hasDeadline'] as boolean);

    const deadlineKind = typeof want?.parameters?.['deadlineKind'] === 'string' && (want.parameters?.['deadlineKind'] as string).trim() !== ''
      ? (want.parameters?.['deadlineKind'] as string)
      : (cachedData['deadlineKind'] as string);

    const deadlineText = typeof want?.parameters?.['deadlineText'] === 'string' && (want.parameters?.['deadlineText'] as string).trim() !== ''
      ? (want.parameters?.['deadlineText'] as string)
      : (cachedData['deadlineText'] as string);

    const readiness = typeof want?.parameters?.['readiness'] === 'number'
      ? (want.parameters?.['readiness'] as number)
      : (cachedData['readiness'] as number);

    const nextActionTitle = typeof want?.parameters?.['nextActionTitle'] === 'string' && (want.parameters?.['nextActionTitle'] as string).trim() !== ''
      ? (want.parameters?.['nextActionTitle'] as string)
      : (cachedData['nextActionTitle'] as string);

    const nextActionReason = typeof want?.parameters?.['nextActionReason'] === 'string' && (want.parameters?.['nextActionReason'] as string).trim() !== ''
      ? (want.parameters?.['nextActionReason'] as string)
      : (cachedData['nextActionReason'] as string);

    const nextAction = typeof want?.parameters?.['nextAction'] === 'string' && (want.parameters?.['nextAction'] as string).trim() !== ''
      ? (want.parameters?.['nextAction'] as string)
      : (cachedData['nextAction'] as string);

    const status = typeof want?.parameters?.['status'] === 'string' && (want.parameters?.['status'] as string).trim() !== ''
      ? (want.parameters?.['status'] as string)
      : (cachedData['status'] as string);

    const statusTone = typeof want?.parameters?.['statusTone'] === 'string' && (want.parameters?.['statusTone'] as string).trim() !== ''
      ? (want.parameters?.['statusTone'] as string)
      : (cachedData['statusTone'] as string);

    const mission = WidgetDataService.missionData(this.context);
    const formData: Record<string, string | number | boolean> = {
      'formDimension': dimension,
      'projectId': projectId,
      'projectTitle': title,
      'daysLeft': daysLeft,
      'hasDeadline': hasDeadline,
      'deadlineKind': deadlineKind,
      'deadlineText': deadlineText,
      'readiness': readiness,
      'nextActionTitle': nextActionTitle || nextAction,
      'nextActionReason': nextActionReason,
      'nextAction': nextAction || nextActionTitle,
      'status': status,
      'statusTone': statusTone,
      'checkpointInfo': cachedData['checkpointInfo']
    };
    // missionData 已核对 owner/会话/期限：过期或换号后这里返回空身份，卡片不会再显示旧委托。
    Object.keys(mission).forEach((key: string) => {
      formData[key] = mission[key];
    });
    return formData;
  }

  onAddForm(want: Want): formBindingData.FormBindingData {
    hilog.info(DOMAIN, TAG, 'onAddForm called');
    try {
      const formId = want?.parameters?.[formInfo.FormParam.IDENTITY_KEY] as string;
      const dimension = typeof want?.parameters?.[formInfo.FormParam.DIMENSION_KEY] === 'number'
        ? (want.parameters?.[formInfo.FormParam.DIMENSION_KEY] as number)
        : 3;
      if (formId) {
        WidgetDataService.registerFormId(this.context, formId, dimension).catch((err: Error) => {
          hilog.error(DOMAIN, TAG, 'Failed to register formId in onAddForm: %{public}s', err.message);
        });
      }

      const formData = this.buildFormData(want, dimension);
      return formBindingData.createFormBindingData(formData);
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'onAddForm error fallback: %{public}s', JSON.stringify(err));
      return formBindingData.createFormBindingData({
        'formDimension': 3,
        'projectId': '',
        'projectTitle': '忆程项目看板',
        'daysLeft': 0,
        'hasDeadline': false,
        'deadlineKind': 'NONE',
        'deadlineText': '待同步',
        'readiness': 0,
        'nextActionTitle': '打开应用同步项目待办',
        'nextActionReason': '',
        'nextAction': '打开应用同步项目待办',
        'status': '待同步',
        'statusTone': 'neutral',
        'checkpointInfo': ''
      });
    }
  }

  onCastToNormalForm(formId: string): void {
    hilog.info(DOMAIN, TAG, 'onCastToNormalForm formId: %{public}s', formId);
  }

  onUpdateForm(formId: string): void {
    hilog.info(DOMAIN, TAG, 'onUpdateForm formId: %{public}s', formId);
    try {
      const dimension = WidgetDataService.getFormDimension(this.context, formId);
      if (formId) {
        WidgetDataService.registerFormId(this.context, formId, dimension).catch((err: Error) => {
          hilog.error(DOMAIN, TAG, 'Failed to register formId in onUpdateForm: %{public}s', err.message);
        });
      }
      const updatedData = this.buildFormData(undefined, dimension);
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
