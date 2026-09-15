import localUnitTest from './LocalUnit.test';
import apiContractTest from './ApiContract.test';
import authContractTest from './AuthContract.test';

export default function testsuite() {
  localUnitTest();
  apiContractTest();
  authContractTest();
}
