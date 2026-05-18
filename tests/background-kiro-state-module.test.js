const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadKiroStateApi() {
  const source = fs.readFileSync('background/kiro/state.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundKiroState;`)(globalScope);
}

test('background imports kiro state module and routes Kiro runtime through dedicated helpers', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/kiro\/state\.js/);
  assert.match(source, /const kiroStateHelpers = self\.MultiPageBackgroundKiroState/);
  assert.match(source, /kiroStateHelpers\?\.buildStateView/);
  assert.match(source, /kiroStateHelpers\?\.buildSessionStatePatch/);
  assert.match(source, /kiroStateHelpers\?\.buildDownstreamResetPatch/);
  assert.match(source, /kiroStateHelpers\?\.applyNodeCompletionPayload/);
});

test('kiro state module exposes canonical nested kiroRuntime view', () => {
  const api = loadKiroStateApi();
  const view = api.buildStateView({
    kiroTargetId: 'kiro-rs',
    kiroRuntime: {
      session: {
        currentStage: 'desktop-authorize',
        registerTabId: 88,
        pageState: 'name_entry',
        pageUrl: 'https://view.awsapps.com/start',
      },
      register: {
        email: 'aws-user@example.com',
        fullName: 'Ada Lovelace',
        userCode: 'ABCD-1234',
        loginUrl: 'https://device.example.com/complete',
        status: 'waiting_name',
      },
      desktopAuth: {
        clientId: 'client-001',
        clientSecret: 'secret-001',
        refreshToken: 'refresh-001',
        status: 'authorized',
      },
      upload: {
        targetId: 'kiro-rs',
        status: 'ready_to_upload',
        credentialId: 321,
      },
    },
  });

  assert.equal(view.kiroTargetId, 'kiro-rs');
  assert.equal(view.kiroRuntime.session.currentStage, 'desktop-authorize');
  assert.equal(view.kiroRuntime.session.registerTabId, 88);
  assert.equal(view.kiroRuntime.register.email, 'aws-user@example.com');
  assert.equal(view.kiroRuntime.register.userCode, 'ABCD-1234');
  assert.equal(view.kiroRuntime.desktopAuth.clientId, 'client-001');
  assert.equal(view.kiroRuntime.desktopAuth.refreshToken, 'refresh-001');
  assert.equal(view.kiroRuntime.upload.status, 'ready_to_upload');
  assert.equal(view.kiroRuntime.upload.credentialId, 321);
});

test('kiro state session patch accepts canonical nested runtime updates', () => {
  const api = loadKiroStateApi();
  const patch = api.buildSessionStatePatch({
    kiroRuntime: api.buildDefaultRuntimeState(),
  }, {
    kiroRuntime: {
      session: {
        currentStage: 'register',
        pageState: 'otp_page',
        pageUrl: 'https://signin.aws/register',
      },
      register: {
        email: 'aws-user@example.com',
        fullName: 'Ada Lovelace',
        verificationRequestedAt: 1700000000000,
      },
      desktopAuth: {
        status: 'waiting_callback',
      },
      upload: {
        status: 'waiting_register',
      },
    },
  });

  assert.equal(patch.kiroRuntime.session.currentStage, 'register');
  assert.equal(patch.kiroRuntime.session.pageState, 'otp_page');
  assert.equal(patch.kiroRuntime.session.pageUrl, 'https://signin.aws/register');
  assert.equal(patch.kiroRuntime.register.email, 'aws-user@example.com');
  assert.equal(patch.kiroRuntime.register.fullName, 'Ada Lovelace');
  assert.equal(patch.kiroRuntime.register.verificationRequestedAt, 1700000000000);
  assert.equal(patch.kiroRuntime.desktopAuth.status, 'waiting_callback');
  assert.equal(patch.kiroRuntime.upload.status, 'waiting_register');
});

test('kiro state reset helpers clear downstream runtime and fresh keep-state preserves only target selection', () => {
  const api = loadKiroStateApi();
  const currentState = {
    kiroTargetId: 'kiro-rs',
    kiroRuntime: {
      session: {
        currentStage: 'upload',
        registerTabId: 88,
      },
      register: {
        email: 'aws-user@example.com',
        fullName: 'Ada Lovelace',
        status: 'completed',
      },
      desktopAuth: {
        clientId: 'client-001',
        clientSecret: 'secret-001',
        refreshToken: 'refresh-001',
        status: 'authorized',
      },
      upload: {
        targetId: 'kiro-rs',
        status: 'uploaded',
        credentialId: 321,
      },
    },
  };

  const resetPatch = api.buildDownstreamResetPatch('kiro-submit-email', currentState);
  assert.equal(resetPatch.kiroRuntime.session.currentStage, 'register');
  assert.equal(resetPatch.kiroRuntime.register.email, '');
  assert.equal(resetPatch.kiroRuntime.register.fullName, '');
  assert.equal(resetPatch.kiroRuntime.desktopAuth.refreshToken, '');
  assert.equal(resetPatch.kiroRuntime.upload.status, '');
  assert.equal(resetPatch.kiroRuntime.upload.credentialId, null);

  const keepState = api.buildFreshKeepState(currentState);
  assert.equal(keepState.kiroTargetId, 'kiro-rs');
  assert.equal(keepState.kiroRuntime.register.email, '');
  assert.equal(keepState.kiroRuntime.desktopAuth.refreshToken, '');
  assert.equal(keepState.kiroRuntime.upload.status, '');
  assert.equal(keepState.kiroRuntime.upload.targetId, 'kiro-rs');
});
