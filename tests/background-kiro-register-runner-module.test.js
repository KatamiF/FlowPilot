const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadRegisterRunnerApi() {
  const stateSource = fs.readFileSync('background/kiro/state.js', 'utf8');
  const runnerSource = fs.readFileSync('background/kiro/register-runner.js', 'utf8');
  const globalScope = {};
  new Function('self', `${stateSource}; ${runnerSource}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundKiroRegisterRunner;
}

test('kiro register runner module exposes a factory and device login bootstrap helper', () => {
  const api = loadRegisterRunnerApi();
  assert.equal(typeof api?.createKiroRegisterRunner, 'function');
  assert.equal(typeof api?.startBuilderIdDeviceLogin, 'function');
});

test('startBuilderIdDeviceLogin registers Builder ID client and returns login bootstrap payload', async () => {
  const api = loadRegisterRunnerApi();
  const requests = [];
  const result = await api.startBuilderIdDeviceLogin('us-east-1', async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/client/register')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          clientId: 'client-001',
          clientSecret: 'secret-001',
        }),
      };
    }
    if (url.endsWith('/device_authorization')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          deviceCode: 'device-code-001',
          userCode: 'ABCD-1234',
          verificationUri: 'https://view.awsapps.com/start',
          verificationUriComplete: 'https://view.awsapps.com/start?user_code=ABCD-1234',
          interval: 7,
          expiresIn: 600,
        }),
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://oidc.us-east-1.amazonaws.com/client/register');
  assert.equal(requests[1].url, 'https://oidc.us-east-1.amazonaws.com/device_authorization');
  assert.equal(result.clientId, 'client-001');
  assert.equal(result.clientSecret, 'secret-001');
  assert.equal(result.deviceCode, 'device-code-001');
  assert.equal(result.userCode, 'ABCD-1234');
  assert.equal(result.verificationUriComplete, 'https://view.awsapps.com/start?user_code=ABCD-1234');
  assert.equal(result.interval, 7);
  assert.equal(result.region, 'us-east-1');
});
