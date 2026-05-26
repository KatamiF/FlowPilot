const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadGrokStateApi() {
  const source = fs.readFileSync('flows/grok/background/state.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundGrokState;`)(globalScope);
}

test('grok state view projects canonical runtime state into legacy flat read fields', () => {
  const api = loadGrokStateApi();
  const view = api.buildStateView({
    runtimeState: {
      flowState: {
        openai: {
          preserved: true,
        },
        grok: {
          session: {
            registerTabId: 42,
            pageState: 'profile_entry',
            pageUrl: 'https://accounts.x.ai/sign-up',
          },
          register: {
            email: 'USER@EXAMPLE.COM',
            firstName: 'Ada',
            lastName: 'Lovelace',
            password: 'Secret123!',
            verificationRequestedAt: 1000,
            verificationCode: 'ABC123',
            status: 'verified',
            completedAt: 2000,
          },
          sso: {
            currentCookie: 'cookie-a',
            cookies: ['cookie-a', 'cookie-b', 'cookie-a'],
            extractedAt: 3000,
          },
          upload: {
            status: 'uploaded',
            uploadedAt: 4000,
            message: 'ok',
            targetUrl: 'https://remote.example.com/api/remote-account/inject',
          },
        },
      },
    },
  });

  assert.equal(view.grokRegisterTabId, 42);
  assert.equal(view.grokPageState, 'profile_entry');
  assert.equal(view.grokEmail, 'user@example.com');
  assert.equal(view.grokFirstName, 'Ada');
  assert.equal(view.grokLastName, 'Lovelace');
  assert.equal(view.grokPassword, 'Secret123!');
  assert.equal(view.grokVerificationRequestedAt, 1000);
  assert.equal(view.grokVerificationCode, 'ABC123');
  assert.equal(view.grokRegisterStatus, 'verified');
  assert.equal(view.grokCompletedAt, 2000);
  assert.equal(view.grokSsoCookie, 'cookie-a');
  assert.deepEqual(view.grokSsoCookies, ['cookie-a', 'cookie-b']);
  assert.equal(view.grokSsoExtractedAt, 3000);
  assert.equal(view.grokWebchat2ApiUploadStatus, 'uploaded');
  assert.equal(view.grokWebchat2ApiUploadedAt, 4000);
  assert.equal(view.grokWebchat2ApiUploadMessage, 'ok');
  assert.equal(view.grokWebchat2ApiTargetUrl, 'https://remote.example.com/api/remote-account/inject');
  assert.equal(view.runtimeState.flowState.openai.preserved, true);
  assert.equal(view.runtimeState.flowState.grok.register.email, 'user@example.com');
  assert.equal(view.flowState.grok.sso.currentCookie, 'cookie-a');
  assert.equal(view.flowState.grok.upload.status, 'uploaded');
  assert.equal(view.flows.grok.sso.cookies.length, 2);
});

test('grok completion payloads update canonical runtime state and flat compatibility fields', () => {
  const api = loadGrokStateApi();
  const patch = api.applyNodeCompletionPayload({}, {
    grokEmail: 'GROK@EXAMPLE.COM',
    grokVerificationRequestedAt: 123,
    grokSsoCookie: 'cookie-z',
    grokSsoCookies: ['cookie-z', 'cookie-z', 'cookie-y'],
    grokCompletedAt: 456,
    grokWebchat2ApiUploadStatus: 'uploaded',
    grokWebchat2ApiUploadedAt: 789,
    grokWebchat2ApiUploadMessage: '上传成功',
    grokWebchat2ApiTargetUrl: 'http://remote.example.com/api/remote-account/inject',
  });

  assert.equal(patch.grokEmail, 'grok@example.com');
  assert.equal(patch.grokVerificationRequestedAt, 123);
  assert.equal(patch.grokSsoCookie, 'cookie-z');
  assert.deepEqual(patch.grokSsoCookies, ['cookie-z', 'cookie-y']);
  assert.equal(patch.grokCompletedAt, 456);
  assert.equal(patch.grokSsoExtractedAt, 456);
  assert.equal(patch.grokWebchat2ApiUploadStatus, 'uploaded');
  assert.equal(patch.grokWebchat2ApiUploadedAt, 789);
  assert.equal(patch.grokWebchat2ApiUploadMessage, '上传成功');
  assert.equal(patch.grokWebchat2ApiTargetUrl, 'http://remote.example.com/api/remote-account/inject');
  assert.equal(patch.runtimeState.flowState.grok.register.email, 'grok@example.com');
  assert.equal(patch.runtimeState.flowState.grok.sso.currentCookie, 'cookie-z');
  assert.equal(patch.runtimeState.flowState.grok.upload.status, 'uploaded');
});

test('grok state keeps canonical runtime values when flat compatibility fields are empty', () => {
  const api = loadGrokStateApi();
  const runtimeState = api.ensureRuntimeState({
    grokSsoCookie: '',
    grokSsoCookies: [],
    runtimeState: {
      flowState: {
        grok: {
          sso: {
            currentCookie: 'canonical-cookie',
            cookies: ['canonical-cookie'],
            extractedAt: 1234,
          },
        },
      },
    },
  });

  assert.equal(runtimeState.sso.currentCookie, 'canonical-cookie');
  assert.deepEqual(runtimeState.sso.cookies, ['canonical-cookie']);
  assert.equal(runtimeState.sso.extractedAt, 1234);
});

test('grok fresh keep-state reset clears registration, SSO, and upload runtime', () => {
  const api = loadGrokStateApi();
  const patch = api.buildFreshKeepState({
    runtimeState: {
      flowState: {
        grok: {
          session: {
            registerTabId: 42,
            pageState: 'profile_entry',
          },
          register: {
            email: 'grok@example.com',
            status: 'completed',
            completedAt: 1000,
          },
          sso: {
            currentCookie: 'cookie-a',
            cookies: ['cookie-a', 'cookie-b'],
            extractedAt: 2000,
          },
          upload: {
            status: 'uploaded',
            uploadedAt: 3000,
            message: 'ok',
            targetUrl: 'https://remote.example.com/api/remote-account/inject',
          },
        },
      },
    },
  });

  assert.equal(patch.grokRegisterTabId, null);
  assert.equal(patch.grokPageState, '');
  assert.equal(patch.grokEmail, '');
  assert.equal(patch.grokRegisterStatus, '');
  assert.equal(patch.grokCompletedAt, 0);
  assert.equal(patch.grokSsoCookie, '');
  assert.deepEqual(patch.grokSsoCookies, []);
  assert.equal(patch.grokSsoExtractedAt, 0);
  assert.equal(patch.grokWebchat2ApiUploadStatus, '');
  assert.equal(patch.grokWebchat2ApiUploadedAt, 0);
  assert.equal(patch.grokWebchat2ApiUploadMessage, '');
  assert.equal(patch.grokWebchat2ApiTargetUrl, '');
  assert.equal(patch.runtimeState.flowState.grok.register.email, '');
  assert.equal(patch.runtimeState.flowState.grok.sso.currentCookie, '');
  assert.equal(patch.runtimeState.flowState.grok.upload.status, '');
});

test('grok downstream reset clears only the state owned by the restarted tail', () => {
  const api = loadGrokStateApi();
  const currentState = {
    runtimeState: {
      flowState: {
        grok: {
          session: {
            registerTabId: 7,
            pageState: 'signed_in',
            pageUrl: 'https://grok.com/',
            lastError: 'old-error',
          },
          register: {
            email: 'grok@example.com',
            status: 'completed',
            completedAt: 1000,
          },
          sso: {
            currentCookie: 'cookie-a',
            cookies: ['cookie-a'],
            extractedAt: 2000,
          },
        },
      },
    },
  };

  const profilePatch = api.buildDownstreamResetPatch('grok-submit-profile', currentState);
  assert.equal(profilePatch.grokEmail, 'grok@example.com');
  assert.equal(profilePatch.grokRegisterStatus, 'completed');
  assert.equal(profilePatch.grokSsoCookie, '');
  assert.deepEqual(profilePatch.grokSsoCookies, []);

  const emailPatch = api.buildDownstreamResetPatch('grok-submit-email', currentState);
  assert.equal(emailPatch.grokEmail, '');
  assert.equal(emailPatch.grokRegisterStatus, '');
  assert.equal(emailPatch.grokRegisterTabId, 7);
});
