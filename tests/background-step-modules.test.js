const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports workflow step modules including rebuilt Kiro modules', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  [
    'background/steps/open-chatgpt.js',
    'background/steps/submit-signup-email.js',
    'background/steps/fill-password.js',
    'background/steps/fetch-signup-code.js',
    'background/steps/fill-profile.js',
    'background/steps/wait-registration-success.js',
    'background/steps/oauth-login.js',
    'background/steps/fetch-login-code.js',
    'background/steps/confirm-oauth.js',
    'background/steps/platform-verify.js',
    'background/kiro/state.js',
    'background/kiro/register-runner.js',
    'background/kiro/desktop-client.js',
    'background/kiro/desktop-authorize-runner.js',
    'background/kiro/publisher-kiro-rs.js',
  ].forEach((path) => {
    assert.match(source, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  assert.doesNotMatch(source, /background\/steps\/kiro-device-auth\.js/);
});
