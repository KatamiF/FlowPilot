const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadAutoRunControllerApi() {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);
}

const FULL_NODE_IDS = [
  'open-chatgpt',
  'submit-signup-email',
  'fill-password',
  'fetch-signup-code',
  'fill-profile',
  'wait-registration-success',
  'oauth-login',
  'fetch-login-code',
  'confirm-oauth',
  'platform-verify',
];

const EMPTY_REGISTRATION_EMAIL_STATE = {
  current: '',
  previous: '',
  source: '',
  updatedAt: 0,
};

const PHONE_NUMBER = '+6612345';
const PHONE_ACTIVATION = {
  activationId: 'signup-completed',
  phoneNumber: PHONE_NUMBER,
};

function createNodeStatuses(completedNodeIds = []) {
  const completedSet = new Set(completedNodeIds);
  return Object.fromEntries(
    FULL_NODE_IDS.map((nodeId) => [nodeId, completedSet.has(nodeId) ? 'completed' : 'pending'])
  );
}

function createBaseState() {
  return {
    activeFlowId: 'openai',
    flowId: 'openai',
    signupMethod: 'phone',
    resolvedSignupMethod: 'phone',
    mailProvider: '163',
    emailGenerator: 'cloudflare-temp-email',
    autoRunFallbackThreadIntervalMinutes: 0,
    autoRunSkipFailures: false,
    stepExecutionRangeByFlow: {
      openai: {
        enabled: true,
        fromStep: 1,
        toStep: 3,
      },
    },
    nodeStatuses: createNodeStatuses([]),
    stepStatuses: {},
  };
}

function createHarness({ completedNodeIds = [] } = {}) {
  const api = loadAutoRunControllerApi();
  let sessionSeed = 1000;
  let currentState = createBaseState();
  let runCalls = 0;

  const clone = (value) => JSON.parse(JSON.stringify(value));

  async function getState() {
    return clone(currentState);
  }

  async function setState(updates = {}) {
    currentState = {
      ...currentState,
      ...updates,
      nodeStatuses: updates.nodeStatuses ? { ...updates.nodeStatuses } : currentState.nodeStatuses,
      stepStatuses: updates.stepStatuses ? { ...updates.stepStatuses } : currentState.stepStatuses,
    };
  }

  async function resetState() {
    currentState = {
      activeFlowId: currentState.activeFlowId,
      flowId: currentState.flowId,
      signupMethod: currentState.signupMethod,
      resolvedSignupMethod: currentState.resolvedSignupMethod,
      mailProvider: currentState.mailProvider,
      emailGenerator: currentState.emailGenerator,
      autoRunFallbackThreadIntervalMinutes: currentState.autoRunFallbackThreadIntervalMinutes,
      autoRunSkipFailures: currentState.autoRunSkipFailures,
      stepExecutionRangeByFlow: clone(currentState.stepExecutionRangeByFlow),
      nodeStatuses: createNodeStatuses([]),
      stepStatuses: {},
      currentPhoneActivation: currentState.currentPhoneActivation,
      phoneNumber: currentState.phoneNumber,
      accountIdentifierType: currentState.accountIdentifierType,
      accountIdentifier: currentState.accountIdentifier,
      signupPhoneNumber: currentState.signupPhoneNumber,
      signupPhoneActivation: currentState.signupPhoneActivation,
      signupPhoneCompletedActivation: currentState.signupPhoneCompletedActivation,
      signupPhoneVerificationRequestedAt: currentState.signupPhoneVerificationRequestedAt,
      signupPhoneVerificationPurpose: currentState.signupPhoneVerificationPurpose,
      email: null,
      registrationEmailState: { ...EMPTY_REGISTRATION_EMAIL_STATE },
      currentPhoneVerificationCode: currentState.currentPhoneVerificationCode,
      currentPhoneVerificationCountdownEndsAt: currentState.currentPhoneVerificationCountdownEndsAt,
      currentPhoneVerificationCountdownWindowIndex: currentState.currentPhoneVerificationCountdownWindowIndex,
      currentPhoneVerificationCountdownWindowTotal: currentState.currentPhoneVerificationCountdownWindowTotal,
      lastEmailTimestamp: currentState.lastEmailTimestamp,
      lastSignupCode: currentState.lastSignupCode,
      lastLoginCode: currentState.lastLoginCode,
      bindEmailSubmitted: currentState.bindEmailSubmitted,
    };
  }

  async function runAutoSequenceFromNode() {
    runCalls += 1;
    if (runCalls === 2) {
      assert.equal(currentState.email, null);
      assert.equal(currentState.currentPhoneActivation, null);
      assert.equal(currentState.phoneNumber, '');
      assert.equal(currentState.signupPhoneNumber, '');
      assert.equal(currentState.accountIdentifierType, null);
      assert.equal(currentState.accountIdentifier, '');
      assert.equal(currentState.signupPhoneActivation, null);
      assert.equal(currentState.signupPhoneCompletedActivation, null);
    }
    await setState({
      accountIdentifierType: 'phone',
      accountIdentifier: PHONE_NUMBER,
      currentPhoneActivation: PHONE_ACTIVATION,
      phoneNumber: PHONE_NUMBER,
      signupPhoneNumber: PHONE_NUMBER,
      signupPhoneActivation: PHONE_ACTIVATION,
      signupPhoneCompletedActivation: PHONE_ACTIVATION,
      currentPhoneVerificationCode: '222222',
      currentPhoneVerificationCountdownEndsAt: Date.now() + 60000,
      currentPhoneVerificationCountdownWindowIndex: 1,
      currentPhoneVerificationCountdownWindowTotal: 2,
      email: 'bound.user@example.com',
      registrationEmailState: {
        current: 'bound.user@example.com',
        previous: 'old.bound@example.com',
        source: 'bind_email',
        updatedAt: 123,
      },
      step8VerificationTargetEmail: 'bound.user@example.com',
      lastEmailTimestamp: 456,
      lastSignupCode: '111111',
      lastLoginCode: '222222',
      bindEmailSubmitted: true,
      nodeStatuses: createNodeStatuses(completedNodeIds),
    });
  }

  const runtime = {
    state: {
      autoRunActive: false,
      autoRunCurrentRun: 0,
      autoRunTotalRuns: 1,
      autoRunAttemptRun: 0,
      autoRunSessionId: 0,
    },
    get() {
      return { ...this.state };
    },
    set(updates = {}) {
      this.state = { ...this.state, ...updates };
    },
  };

  const controller = api.createAutoRunController({
    addLog: async () => {},
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 3,
    AUTO_RUN_RETRY_DELAY_MS: 3000,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async (phase, payload = {}, extraState = {}) => {
      await setState({
        ...extraState,
        autoRunning: phase !== 'idle',
        autoRunPhase: phase,
        autoRunCurrentRun: payload.currentRun || 0,
        autoRunTotalRuns: payload.totalRuns || 1,
        autoRunAttemptRun: payload.attemptRun || 0,
        autoRunSessionId: payload.sessionId || 0,
      });
    },
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => {
      sessionSeed += 1;
      return sessionSeed;
    },
    getAutoRunStatusPayload: (phase, payload = {}) => ({
      autoRunning: phase !== 'idle',
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun || 0,
      autoRunTotalRuns: payload.totalRuns || 1,
      autoRunAttemptRun: payload.attemptRun || 0,
      autoRunSessionId: payload.sessionId || 0,
    }),
    getErrorMessage: (error) => error?.message || String(error || ''),
    getFirstUnfinishedNodeId: () => 'open-chatgpt',
    getNodeIdsForState: () => FULL_NODE_IDS.slice(),
    getPendingAutoRunTimerPlan: () => null,
    getRunningNodeIds: () => [],
    getState,
    getStopRequested: () => false,
    hasSavedNodeProgress: () => false,
    isRestartCurrentAttemptError: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: () => 0,
    persistAutoRunTimerPlan: async () => {},
    resetState,
    runAutoSequenceFromNode,
    runtime,
    setState,
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningNodesToFinish: getState,
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
      },
    },
  });

  return {
    controller,
    currentStateRef: () => currentState,
  };
}

test('auto-run clears bound email runtime only after the full workflow completes', async () => {
  const { controller, currentStateRef } = createHarness({
    completedNodeIds: FULL_NODE_IDS,
  });

  await controller.autoRunLoop(1, { mode: 'restart', autoRunSkipFailures: false });

  const currentState = currentStateRef();
  assert.equal(currentState.email, null);
  assert.deepEqual(currentState.registrationEmailState, EMPTY_REGISTRATION_EMAIL_STATE);
  assert.equal(currentState.step8VerificationTargetEmail, '');
  assert.equal(currentState.lastEmailTimestamp, null);
  assert.equal(currentState.lastSignupCode, '');
  assert.equal(currentState.lastLoginCode, '');
  assert.equal(currentState.bindEmailSubmitted, false);
  assert.equal(currentState.currentPhoneActivation, null);
  assert.equal(currentState.currentPhoneVerificationCode, '');
  assert.equal(currentState.currentPhoneVerificationCountdownEndsAt, 0);
  assert.equal(currentState.currentPhoneVerificationCountdownWindowIndex, 0);
  assert.equal(currentState.currentPhoneVerificationCountdownWindowTotal, 0);
  assert.equal(currentState.accountIdentifierType, null);
  assert.equal(currentState.accountIdentifier, '');
  assert.equal(currentState.phoneNumber, '');
  assert.equal(currentState.signupPhoneNumber, '');
  assert.equal(currentState.signupPhoneActivation, null);
  assert.equal(currentState.signupPhoneCompletedActivation, null);
});

test('auto-run keeps bound email runtime when only part of the workflow completed', async () => {
  const { controller, currentStateRef } = createHarness({
    completedNodeIds: [
      'open-chatgpt',
      'submit-signup-email',
      'fill-password',
    ],
  });

  await controller.autoRunLoop(1, { mode: 'restart', autoRunSkipFailures: false });

  const currentState = currentStateRef();
  assert.equal(currentState.email, 'bound.user@example.com');
  assert.deepEqual(currentState.registrationEmailState, {
    current: 'bound.user@example.com',
    previous: 'old.bound@example.com',
    source: 'bind_email',
    updatedAt: 123,
  });
  assert.equal(currentState.step8VerificationTargetEmail, 'bound.user@example.com');
  assert.equal(currentState.lastEmailTimestamp, 456);
  assert.equal(currentState.lastSignupCode, '111111');
  assert.equal(currentState.lastLoginCode, '222222');
  assert.equal(currentState.bindEmailSubmitted, true);
  assert.deepEqual(currentState.currentPhoneActivation, PHONE_ACTIVATION);
  assert.equal(currentState.currentPhoneVerificationCode, '222222');
  assert.equal(currentState.currentPhoneVerificationCountdownEndsAt > 0, true);
  assert.equal(currentState.currentPhoneVerificationCountdownWindowIndex, 1);
  assert.equal(currentState.currentPhoneVerificationCountdownWindowTotal, 2);
  assert.equal(currentState.accountIdentifierType, 'phone');
  assert.equal(currentState.accountIdentifier, PHONE_NUMBER);
  assert.equal(currentState.phoneNumber, PHONE_NUMBER);
  assert.equal(currentState.signupPhoneNumber, PHONE_NUMBER);
  assert.deepEqual(currentState.signupPhoneActivation, PHONE_ACTIVATION);
  assert.deepEqual(currentState.signupPhoneCompletedActivation, PHONE_ACTIVATION);
});

test('auto-run clears phone and email runtime so the next run cannot reuse them', async () => {
  const { controller, currentStateRef } = createHarness({
    completedNodeIds: FULL_NODE_IDS,
  });

  await controller.autoRunLoop(2, { mode: 'restart', autoRunSkipFailures: false });

  const currentState = currentStateRef();
  assert.equal(currentState.email, null);
  assert.equal(currentState.currentPhoneActivation, null);
  assert.equal(currentState.phoneNumber, '');
  assert.equal(currentState.signupPhoneNumber, '');
  assert.equal(currentState.accountIdentifierType, null);
  assert.equal(currentState.accountIdentifier, '');
  assert.equal(currentState.signupPhoneActivation, null);
  assert.equal(currentState.signupPhoneCompletedActivation, null);
  assert.equal(currentState.bindEmailSubmitted, false);
});
