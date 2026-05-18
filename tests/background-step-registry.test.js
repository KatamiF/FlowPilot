const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports node registry and wires the rebuilt Kiro executors', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/steps\/registry\.js/);
  assert.match(source, /data\/step-definitions\.js/);
  assert.match(source, /background\/workflow-engine\.js/);
  assert.match(source, /MultiPageStepDefinitions\?\.getNodes/);
  assert.match(source, /buildNodeRegistry\(definitions/);
  assert.match(source, /const stepRegistryCache = new Map\(\);/);
  assert.match(source, /const definitions = getNodeDefinitionsForState\(state\);/);
  assert.match(source, /stepRegistryCache\.set\(cacheKey, buildStepRegistry\(definitions\)\)/);

  assert.match(source, /background\/kiro\/register-runner\.js/);
  assert.match(source, /background\/kiro\/desktop-client\.js/);
  assert.match(source, /background\/kiro\/desktop-authorize-runner\.js/);
  assert.match(source, /background\/kiro\/publisher-kiro-rs\.js/);
  assert.doesNotMatch(source, /background\/steps\/kiro-device-auth\.js/);

  assert.match(source, /const kiroRegisterRunner = self\.MultiPageBackgroundKiroRegisterRunner\?\.createKiroRegisterRunner\(/);
  assert.match(source, /const kiroDesktopAuthorizeRunner = self\.MultiPageBackgroundKiroDesktopAuthorizeRunner\?\.createKiroDesktopAuthorizeRunner\(/);
  assert.match(source, /const kiroPublisher = self\.MultiPageBackgroundKiroPublisherKiroRs\?\.createKiroRsPublisher\(/);

  assert.match(source, /'kiro-open-register-page': \(state\) => kiroRegisterRunner\.executeKiroOpenRegisterPage\(state\)/);
  assert.match(source, /'kiro-submit-email': \(state\) => kiroRegisterRunner\.executeKiroSubmitEmail\(state\)/);
  assert.match(source, /'kiro-submit-name': \(state\) => kiroRegisterRunner\.executeKiroSubmitName\(state\)/);
  assert.match(source, /'kiro-submit-verification-code': \(state\) => kiroRegisterRunner\.executeKiroSubmitVerificationCode\(state\)/);
  assert.match(source, /'kiro-submit-password': \(state\) => kiroRegisterRunner\.executeKiroSubmitPassword\(state\)/);
  assert.match(source, /'kiro-complete-register-consent': \(state\) => kiroRegisterRunner\.executeKiroCompleteRegisterConsent\(state\)/);
  assert.match(source, /'kiro-start-desktop-authorize': \(state\) => kiroDesktopAuthorizeRunner\.executeKiroStartDesktopAuthorize\(state\)/);
  assert.match(source, /'kiro-complete-desktop-authorize': \(state\) => kiroDesktopAuthorizeRunner\.executeKiroCompleteDesktopAuthorize\(state\)/);
  assert.match(source, /'kiro-upload-credential': \(state\) => kiroPublisher\.executeKiroUploadCredential\(state\)/);

  assert.match(
    source,
    /'kiro-open-register-page',[\s\S]*'kiro-submit-email',[\s\S]*'kiro-submit-name',[\s\S]*'kiro-submit-verification-code',[\s\S]*'kiro-submit-password',[\s\S]*'kiro-complete-register-consent',[\s\S]*'kiro-start-desktop-authorize',[\s\S]*'kiro-complete-desktop-authorize',[\s\S]*'kiro-upload-credential'/
  );
});

test('GoPay approve executor receives debugger click and manual OTP helpers', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /createGoPayApproveExecutor\(\{[\s\S]*clickWithDebugger[\s\S]*requestGoPayOtpInput[\s\S]*\}\)/);
  assert.match(source, /REQUEST_GOPAY_OTP_INPUT/);
});
