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
import projectIntakeContractTest from './ProjectIntake.test';
import s2CoverageContractTest from './S2Coverage.test';
import s1HandoffContractTest from './S1Handoff.test';
import s2ReadbackContractTest from './S2Readback.test';
import workPacketContractTest from './WorkPacketContract.test';
import widgetHandoffTest from './WidgetHandoff.test';
import loginIdentifierTest from './LoginIdentifier.test';

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
  projectIntakeContractTest();
  s2CoverageContractTest();
  s1HandoffContractTest();
  s2ReadbackContractTest();
  workPacketContractTest();
  widgetHandoffTest();
  loginIdentifierTest();
}



