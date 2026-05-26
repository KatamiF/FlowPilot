const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadPublisherApi() {
  const stateSource = fs.readFileSync('flows/grok/background/state.js', 'utf8');
  const publisherSource = fs.readFileSync('flows/grok/background/publisher-webchat2api.js', 'utf8');
  const globalScope = {};
  new Function('self', `${stateSource}; ${publisherSource}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundGrokPublisherWebchat2Api;
}

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    text: async () => JSON.stringify(payload),
  };
}

function getGrokRuntime(state = {}) {
  return state?.runtimeState?.flowState?.grok || {};
}

test('grok webchat2api publisher exposes helpers and normalizes to origin inject endpoint', () => {
  const api = loadPublisherApi();

  assert.equal(typeof api?.createGrokWebchat2ApiPublisher, 'function');
  assert.equal(
    api.buildWebchat2ApiInjectUrl('https://remote.example.com/admin/deep/path'),
    'https://remote.example.com/api/remote-account/inject'
  );
  assert.equal(
    api.buildWebchat2ApiInjectUrl('remote.example.com/admin'),
    'http://remote.example.com/api/remote-account/inject'
  );
});

test('grok webchat2api publisher requires URL, admin key, and SSO cookie', async () => {
  const api = loadPublisherApi();

  assert.throws(
    () => api.buildWebchat2ApiInjectUrl(''),
    /缺少 webchat2api 地址/
  );
  assert.throws(
    () => api.buildGrokSsoInjectPayload(''),
    /缺少 Grok SSO Cookie/
  );
  await assert.rejects(
    () => api.uploadGrokSsoToWebchat2Api('http://remote.example.com', '', 'sso-cookie', async () => createJsonResponse({})),
    /缺少 webchat2api 管理密钥/
  );
});

test('grok webchat2api publisher posts Grok SSO payload with bearer admin key', async () => {
  const api = loadPublisherApi();
  const requests = [];

  const result = await api.uploadGrokSsoToWebchat2Api(
    'https://remote.example.com/admin/deep/path',
    ' admin-secret ',
    'sso-cookie-001',
    async (url, options = {}) => {
      requests.push({
        url,
        method: options.method,
        authorization: options.headers?.Authorization,
        contentType: options.headers?.['Content-Type'],
        body: JSON.parse(options.body),
      });
      return createJsonResponse({ code: 0, data: { total: 1 }, message: 'ok' });
    }
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://remote.example.com/api/remote-account/inject');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].authorization, 'Bearer admin-secret');
  assert.equal(requests[0].contentType, 'application/json');
  assert.deepEqual(requests[0].body, {
    accounts: [{
      token: 'sso-cookie-001',
      provider: 'grok',
      type: 'sso',
    }],
    strategy: 'merge',
    source_id: 'flowpilot-grok-sso',
    source_name: 'FlowPilot Grok SSO',
    provider: 'grok',
  });
  assert.equal(result.endpointUrl, 'https://remote.example.com/api/remote-account/inject');
  assert.equal(result.message, 'ok');
});

test('grok webchat2api publisher accepts code-zero envelopes and rejects HTTP/API errors', async () => {
  const api = loadPublisherApi();

  const success = await api.uploadGrokSsoToWebchat2Api(
    'http://remote.example.com',
    'admin-secret',
    'sso-cookie',
    async () => createJsonResponse({ code: 0, data: { added: 1 } })
  );
  assert.equal(success.message, '上传成功');

  await assert.rejects(
    () => api.uploadGrokSsoToWebchat2Api(
      'http://remote.example.com',
      'admin-secret',
      'sso-cookie',
      async () => createJsonResponse({ error: 'invalid admin key' }, 403)
    ),
    /webchat2api SSO 上传失败：invalid admin key/
  );

  await assert.rejects(
    () => api.uploadGrokSsoToWebchat2Api(
      'http://remote.example.com',
      'admin-secret',
      'sso-cookie',
      async () => createJsonResponse({ code: 4001, message: 'bad token' })
    ),
    /webchat2api SSO 上传失败：bad token/
  );
});

test('grok webchat2api executor reads latest state and writes upload runtime without leaking secrets to logs', async () => {
  const api = loadPublisherApi();
  const requests = [];
  const logs = [];
  const completed = [];
  let liveState = {
    grokWebchat2ApiUrl: '',
    grokWebchat2ApiAdminKey: '',
    grokSsoCookie: '',
    settingsState: {
      flows: {
        grok: {
          targets: {
            webchat2api: {
              baseUrl: 'https://remote.example.com/admin',
              apiKey: 'live-admin-key',
            },
          },
        },
      },
    },
    runtimeState: {
      flowState: {
        grok: {
          sso: {
            currentCookie: 'live-sso-cookie',
          },
        },
      },
    },
  };
  const publisher = api.createGrokWebchat2ApiPublisher({
    addLog: async (message, level) => {
      logs.push({ message, level });
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      completed.push({ nodeId, payload });
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url,
        authorization: options.headers?.Authorization,
        body: JSON.parse(options.body),
      });
      return createJsonResponse({ code: 0, message: 'uploaded' });
    },
    getState: async () => ({ ...liveState }),
    setState: async (updates = {}) => {
      liveState = {
        ...liveState,
        ...updates,
        runtimeState: {
          ...(liveState.runtimeState || {}),
          ...(updates.runtimeState || {}),
          flowState: {
            ...(liveState.runtimeState?.flowState || {}),
            ...(updates.runtimeState?.flowState || {}),
          },
        },
      };
    },
  });

  await publisher.executeGrokUploadSsoToWebchat2Api({
    nodeId: 'grok-upload-sso-to-webchat2api',
    grokWebchat2ApiAdminKey: 'stale-key',
    grokSsoCookie: 'stale-sso-cookie',
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://remote.example.com/api/remote-account/inject');
  assert.equal(requests[0].authorization, 'Bearer live-admin-key');
  assert.equal(requests[0].body.accounts[0].token, 'live-sso-cookie');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].nodeId, 'grok-upload-sso-to-webchat2api');
  assert.equal(getGrokRuntime(completed[0].payload).upload.status, 'uploaded');
  assert.equal(getGrokRuntime(completed[0].payload).upload.message, 'uploaded');
  assert.equal(getGrokRuntime(completed[0].payload).upload.targetUrl, 'https://remote.example.com/api/remote-account/inject');
  assert.equal(typeof getGrokRuntime(completed[0].payload).upload.uploadedAt, 'number');
  assert.equal(logs.some(({ message }) => message.includes('live-sso-cookie') || message.includes('live-admin-key')), false);
});

test('grok webchat2api executor persists failure state without completing or leaking secrets', async () => {
  const api = loadPublisherApi();
  const logs = [];
  const completed = [];
  let liveState = {
    settingsState: {
      flows: {
        grok: {
          targets: {
            webchat2api: {
              baseUrl: 'https://remote.example.com/admin',
              apiKey: 'secret-admin-key',
            },
          },
        },
      },
    },
    runtimeState: {
      flowState: {
        grok: {
          sso: {
            currentCookie: 'secret-sso-cookie',
          },
        },
      },
    },
  };
  const publisher = api.createGrokWebchat2ApiPublisher({
    addLog: async (message, level) => {
      logs.push({ message, level });
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      completed.push({ nodeId, payload });
    },
    fetchImpl: async () => createJsonResponse({ error: 'invalid admin key' }, 403),
    getState: async () => ({ ...liveState }),
    setState: async (updates = {}) => {
      liveState = {
        ...liveState,
        ...updates,
        runtimeState: {
          ...(liveState.runtimeState || {}),
          ...(updates.runtimeState || {}),
          flowState: {
            ...(liveState.runtimeState?.flowState || {}),
            ...(updates.runtimeState?.flowState || {}),
          },
        },
      };
    },
  });

  await assert.rejects(
    () => publisher.executeGrokUploadSsoToWebchat2Api({ nodeId: 'grok-upload-sso-to-webchat2api' }),
    /webchat2api SSO 上传失败：invalid admin key/
  );

  assert.equal(completed.length, 0);
  assert.equal(getGrokRuntime(liveState).upload.status, 'error');
  assert.equal(getGrokRuntime(liveState).upload.uploadedAt, 0);
  assert.equal(getGrokRuntime(liveState).upload.message, 'webchat2api SSO 上传失败：invalid admin key');
  assert.equal(getGrokRuntime(liveState).upload.targetUrl, 'https://remote.example.com/api/remote-account/inject');
  assert.equal(logs.some(({ message }) => message.includes('secret-sso-cookie') || message.includes('secret-admin-key')), false);
});
