const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadDesktopAuthorizeRunnerApi() {
  const stateSource = fs.readFileSync('background/kiro/state.js', 'utf8');
  const clientSource = fs.readFileSync('background/kiro/desktop-client.js', 'utf8');
  const runnerSource = fs.readFileSync('background/kiro/desktop-authorize-runner.js', 'utf8');
  const globalScope = {};
  new Function('self', `${stateSource}; ${clientSource}; ${runnerSource}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundKiroDesktopAuthorizeRunner;
}

test('kiro desktop authorize runner exposes a factory and callback parser', () => {
  const api = loadDesktopAuthorizeRunnerApi();
  assert.equal(typeof api?.createKiroDesktopAuthorizeRunner, 'function');
  assert.equal(typeof api?.parseDesktopCallbackUrl, 'function');
});

test('parseDesktopCallbackUrl validates state and redirect port', () => {
  const api = loadDesktopAuthorizeRunnerApi();

  const success = api.parseDesktopCallbackUrl(
    'http://127.0.0.1:43121/oauth/callback?code=auth-code-001&state=state-001',
    'state-001',
    43121
  );
  assert.deepEqual(success, {
    url: 'http://127.0.0.1:43121/oauth/callback?code=auth-code-001&state=state-001',
    code: 'auth-code-001',
    state: 'state-001',
  });

  const badState = api.parseDesktopCallbackUrl(
    'http://127.0.0.1:43121/oauth/callback?code=auth-code-001&state=wrong-state',
    'state-001',
    43121
  );
  assert.equal(Object.prototype.hasOwnProperty.call(badState, 'code'), false);
  assert.match(badState.error, /state/i);

  const badPort = api.parseDesktopCallbackUrl(
    'http://127.0.0.1:43122/oauth/callback?code=auth-code-001&state=state-001',
    'state-001',
    43121
  );
  assert.equal(badPort, null);
});
