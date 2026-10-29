// Runs a copy of the acceptance runner with synthetic credentials and fetch only.
// It never calls a real server or reads a real access token.
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

mkdirSync(resolve('tmp/p3-readonly-review'), { recursive: true });
const directory = mkdtempSync(resolve('tmp/p3-readonly-review/token-fixture-'));
const runnerPath = join(directory, 'runner.mjs');
const statePath = join(directory, 'state.json');
copyFileSync('evidence/p3b/prod-acceptance/runner.mjs', runnerPath);
const fixtureToken = 'SYNTHETIC_AUDIT_TOKEN_NOT_A_CREDENTIAL';
let persistedBeforeFinally = false;
let requests = 0;
process.argv[2] = 'a';
process.env.PM_USER = 'synthetic-audit';
process.env.PM_PASS = 'synthetic-audit';
globalThis.fetch = async () => {
  requests += 1;
  if (requests === 1) {
    return new Response(JSON.stringify({ accessToken: fixtureToken, user: { id: 'synthetic-user' } }), { status: 200 });
  }
  persistedBeforeFinally = existsSync(statePath) && JSON.parse(readFileSync(statePath, 'utf8')).token === fixtureToken;
  throw new Error('AUDIT_STOP_AFTER_LOGIN_NO_NETWORK');
};
try {
  await import(pathToFileURL(runnerPath).href);
} catch (error) {
  if (error.message !== 'AUDIT_STOP_AFTER_LOGIN_NO_NETWORK') throw error;
}
const result = {
  fixture: 'copied runner, synthetic login response, fetch stub, zero network calls',
  persistedBeforeFinally,
  cleanedAfterFinally: !Object.hasOwn(JSON.parse(readFileSync(statePath, 'utf8')), 'token'),
  realTokenRead: false,
};
writeFileSync(resolve('tmp/p3-readonly-review/token-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
