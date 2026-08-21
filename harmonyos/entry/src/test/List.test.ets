import localUnitTest from './LocalUnit.test';
import apiContractTest from './ApiContract.test';

export default function testsuite() {
  localUnitTest();
  apiContractTest();
}
