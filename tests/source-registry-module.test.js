const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadSourceRegistry() {
  const flowRegistrySource = fs.readFileSync('shared/flow-registry.js', 'utf8');
  const sourceRegistrySource = fs.readFileSync('shared/source-registry.js', 'utf8');
  const globalScope = {};
  new Function('self', `${flowRegistrySource}; ${sourceRegistrySource}; return self;`)(globalScope);
  return globalScope.MultiPageSourceRegistry.createSourceRegistry();
}

test('background imports shared source registry module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /shared\/flow-registry\.js/);
  assert.match(source, /shared\/settings-schema\.js/);
  assert.match(source, /shared\/source-registry\.js/);
});

test('manifest loads shared source registry before content utils in static bundles', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  for (const entry of manifest.content_scripts || []) {
    const scripts = Array.isArray(entry.js) ? entry.js : [];
    if (!scripts.includes('content/utils.js')) continue;
    assert.ok(scripts.includes('shared/source-registry.js'));
    assert.ok(
      scripts.indexOf('shared/source-registry.js') < scripts.indexOf('content/utils.js'),
      'shared/source-registry.js must load before content/utils.js'
    );
  }
});

test('manifest no longer ships a static Kiro content bundle', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const hasStaticKiroBundle = (manifest.content_scripts || []).some((entry) => {
    const scripts = Array.isArray(entry.js) ? entry.js : [];
    return scripts.includes('content/kiro/register-page.js')
      || scripts.includes('content/kiro/desktop-authorize-page.js');
  });

  assert.equal(hasStaticKiroBundle, false);
});

test('shared source registry exposes canonical Kiro sources and drivers', () => {
  const registry = loadSourceRegistry();

  assert.equal(registry.resolveCanonicalSource('signup-page'), 'openai-auth');
  assert.deepEqual(registry.getSourceKeys('signup-page'), ['openai-auth', 'signup-page']);
  assert.equal(registry.getSourceLabel('openai-auth'), '认证页');

  assert.equal(
    registry.detectSourceFromLocation({
      url: 'https://auth.openai.com/create-account',
      hostname: 'auth.openai.com',
    }),
    'openai-auth'
  );
  assert.equal(
    registry.detectSourceFromLocation({
      url: 'https://view.awsapps.com/start',
      hostname: 'view.awsapps.com',
    }),
    'kiro-register-page'
  );
  assert.equal(
    registry.detectSourceFromLocation({
      injectedSource: 'kiro-desktop-authorize',
      url: 'https://signin.aws/register',
      hostname: 'signin.aws',
    }),
    'kiro-desktop-authorize'
  );
  assert.equal(
    registry.detectSourceFromLocation({
      url: 'https://example.com/',
      hostname: 'example.com',
    }),
    'unknown-source'
  );

  assert.equal(
    registry.matchesSourceUrlFamily(
      'kiro-register-page',
      'https://signin.aws/register',
      'https://view.awsapps.com/start'
    ),
    true
  );
  assert.equal(
    registry.matchesSourceUrlFamily(
      'kiro-desktop-authorize',
      'https://profile.aws/complete',
      'https://signin.aws/register'
    ),
    true
  );
  assert.equal(
    registry.matchesSourceUrlFamily(
      'kiro-desktop-authorize',
      'https://oidc.us-east-1.amazonaws.com/authorize',
      'https://view.awsapps.com/start'
    ),
    true
  );

  assert.equal(registry.shouldReportReadyForFrame('mail-163', true), false);
  assert.equal(registry.shouldReportReadyForFrame('kiro-register-page', true), false);
  assert.equal(registry.shouldReportReadyForFrame('kiro-desktop-authorize', true), false);
  assert.equal(registry.getCleanupOwnerSource('oauth-localhost-callback'), 'openai-auth');

  assert.equal(registry.driverAcceptsCommand('openai-auth', 'submit-signup-email'), true);
  assert.equal(registry.driverAcceptsCommand('content/platform-panel', 'platform-verify'), true);
  assert.equal(registry.driverAcceptsCommand('openai-auth', 'platform-verify'), false);
  assert.equal(registry.driverAcceptsCommand('content/kiro/register-page', 'kiro-submit-password'), true);
  assert.equal(registry.driverAcceptsCommand('content/kiro/desktop-authorize-page', 'kiro-complete-desktop-authorize'), true);
  assert.equal(registry.driverAcceptsCommand('background/kiro-register', 'kiro-open-register-page'), true);
  assert.equal(registry.driverAcceptsCommand('background/kiro-desktop-authorize', 'kiro-start-desktop-authorize'), true);
  assert.equal(registry.driverAcceptsCommand('background/kiro-publisher-kiro-rs', 'kiro-upload-credential'), true);
});
