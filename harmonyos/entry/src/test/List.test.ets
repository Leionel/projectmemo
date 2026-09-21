import localUnitTest from './LocalUnit.test';
import apiContractTest from './ApiContract.test';
import authContractTest from './AuthContract.test';
import reentryMappingTest from './ReentryMapping.test';
import reminderRulesTest from './ReminderRules.test';

export default function testsuite() {
  localUnitTest();
  apiContractTest();
  authContractTest();
  reentryMappingTest();
  reminderRulesTest();
}
