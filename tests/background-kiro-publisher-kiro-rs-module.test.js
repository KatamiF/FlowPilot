const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadPublisherApi() {
  const stateSource = fs.readFileSync('background/kiro/state.js', 'utf8');
  const publisherSource = fs.readFileSync('background/kiro/publisher-kiro-rs.js', 'utf8');
  const globalScope = {};
  new Function('self', `${stateSource}; ${publisherSource}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundKiroPublisherKiroRs;
}

test('kiro publisher exposes a factory and upload payload helpers', () => {
  const api = loadPublisherApi();
  assert.equal(typeof api?.createKiroRsPublisher, 'function');
  assert.equal(typeof api?.buildKiroRsPayload, 'function');
  assert.equal(typeof api?.buildMachineId, 'function');
});

test('kiro publisher builds kiro.rs payload from desktop auth runtime without profileArn', async () => {
  const api = loadPublisherApi();
  const payload = api.buildKiroRsPayload({
    kiroTargetId: 'kiro-rs',
    kiroRsUrl: 'https://kiro.example.com/admin',
    kiroRsKey: 'demo-key',
    ipProxyEnabled: true,
    ipProxyHost: '1.2.3.4',
    ipProxyPort: '8080',
    ipProxyProtocol: 'http',
    ipProxyUsername: 'proxy-user',
    ipProxyPassword: 'proxy-pass',
    kiroRuntime: {
      register: {
        email: 'aws-user@example.com',
      },
      desktopAuth: {
        region: 'us-east-1',
        clientId: 'client-001',
        clientSecret: 'secret-001',
        refreshToken: 'refresh-token-001',
      },
      upload: {
        targetId: 'kiro-rs',
      },
    },
  });
  const machineId = await api.buildMachineId('refresh-token-001');

  assert.deepEqual(payload, {
    targetId: 'kiro-rs',
    region: 'us-east-1',
    email: 'aws-user@example.com',
    refreshToken: 'refresh-token-001',
    clientId: 'client-001',
    clientSecret: 'secret-001',
    authMethod: 'idc',
    authRegion: 'us-east-1',
    apiRegion: 'us-east-1',
    proxyUrl: 'http://1.2.3.4:8080',
    proxyUsername: 'proxy-user',
    proxyPassword: 'proxy-pass',
  });
  assert.equal(machineId.length, 64);
  assert.match(machineId, /^[0-9a-f]{64}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'profileArn'), false);
});
