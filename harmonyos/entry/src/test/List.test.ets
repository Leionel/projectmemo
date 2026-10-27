import attachmentPresentationTest from './AttachmentPresentation.test';
import localUnitTest from './LocalUnit.test';
import apiContractTest from './ApiContract.test';
import authContractTest from './AuthContract.test';
import reentryMappingTest from './ReentryMapping.test';
import reminderRulesTest from './ReminderRules.test';
import missionContractTest from './MissionContract.test';
import globalFocusPresentationTest from './GlobalFocusPresentation.test';
import experienceContractTest from './ExperienceContract.test';
import repoSignalContractTest from './RepoSignalContract.test';
import agentPresentationContractTest from './AgentPresentationContract.test';

export default function testsuite() {
  localUnitTest();
  apiContractTest();
  authContractTest();
  reentryMappingTest();
  reminderRulesTest();
  missionContractTest();
  globalFocusPresentationTest();
  attachmentPresentationTest();
  experienceContractTest();
  repoSignalContractTest();
  agentPresentationContractTest();
}
