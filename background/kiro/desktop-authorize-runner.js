(function attachBackgroundKiroDesktopAuthorizeRunner(root, factory) {
  root.MultiPageBackgroundKiroDesktopAuthorizeRunner = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundKiroDesktopAuthorizeRunnerModule(root) {
  const kiroStateApi = root.MultiPageBackgroundKiroState || null;
  const desktopClientApi = root.MultiPageBackgroundKiroDesktopClient || null;
  const DEFAULT_REGION = kiroStateApi?.DEFAULT_REGION || desktopClientApi?.DEFAULT_REGION || 'us-east-1';
  const MAIL_2925_FILTER_LOOKBACK_MS = 10 * 60 * 1000;
  const KIRO_DESKTOP_SOURCE_ID = 'kiro-desktop-authorize';
  const KIRO_AWS_VERIFICATION_CODE_PATTERNS = Object.freeze([
    Object.freeze({
      source: '(?:verification\\s*code|验证码|Your code is|code is)[：:\\s]*(\\d{6})',
      flags: 'gi',
    }),
    Object.freeze({
      source: '^\\s*(\\d{6})\\s*$',
      flags: 'gm',
    }),
    Object.freeze({
      source: '>\\s*(\\d{6})\\s*<',
      flags: 'g',
    }),
  ]);
  const KIRO_AWS_SENDER_FILTERS = Object.freeze([
    'no-reply@signin.aws',
    'no-reply@login.awsapps.com',
    'noreply@amazon.com',
    'account-update@amazon.com',
    'no-reply@aws.amazon.com',
    'noreply@aws.amazon.com',
    'aws',
  ]);
  const KIRO_AWS_SUBJECT_FILTERS = Object.freeze([
    'aws builder id',
    'verification',
    '验证码',
    'code',
    'aws',
  ]);
  const KIRO_AWS_REQUIRED_KEYWORDS = Object.freeze([
    'verification',
    '验证码',
    'code',
    'aws',
  ]);

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneValue(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneValue(entry));
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [key, cloneValue(entryValue)])
      );
    }
    return value;
  }

  function deepMerge(baseValue, patchValue) {
    if (Array.isArray(patchValue)) {
      return patchValue.map((entry) => cloneValue(entry));
    }
    if (!isPlainObject(patchValue)) {
      return patchValue === undefined ? cloneValue(baseValue) : patchValue;
    }

    const baseObject = isPlainObject(baseValue) ? baseValue : {};
    const next = {
      ...cloneValue(baseObject),
    };
    Object.entries(patchValue).forEach(([key, value]) => {
      next[key] = deepMerge(baseObject[key], value);
    });
    return next;
  }

  function cleanString(value = '') {
    return String(value ?? '').trim();
  }

  function readKiroRuntime(state = {}) {
    if (typeof kiroStateApi?.ensureRuntimeState === 'function') {
      return kiroStateApi.ensureRuntimeState(state);
    }
    return deepMerge(
      typeof kiroStateApi?.buildDefaultRuntimeState === 'function'
        ? kiroStateApi.buildDefaultRuntimeState()
        : {},
      state?.kiroRuntime || {}
    );
  }

  function mergeRuntimePatch(currentState = {}, patch = {}) {
    return {
      kiroRuntime: deepMerge(readKiroRuntime(currentState), patch),
    };
  }

  function normalizePositiveInteger(value, fallback) {
    const numeric = Math.floor(Number(value));
    if (Number.isInteger(numeric) && numeric > 0) {
      return numeric;
    }
    return fallback;
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error ?? '未知错误');
  }

  function parseDesktopCallbackUrl(rawUrl, expectedState = '', expectedPort = 0) {
    const normalizedUrl = cleanString(rawUrl);
    if (!normalizedUrl) {
      return null;
    }
    let parsed = null;
    try {
      parsed = new URL(normalizedUrl);
    } catch (_error) {
      return null;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return null;
    }
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      return null;
    }
    if (expectedPort && Number(parsed.port || 0) !== Number(expectedPort)) {
      return null;
    }
    if (parsed.pathname !== '/oauth/callback') {
      return null;
    }
    const stateValue = cleanString(parsed.searchParams.get('state'));
    if (expectedState && stateValue && stateValue !== cleanString(expectedState)) {
      return {
        url: normalizedUrl,
        state: stateValue,
        error: `回调 state 不匹配：expected=${cleanString(expectedState)} actual=${stateValue}`,
      };
    }
    const error = cleanString(parsed.searchParams.get('error_description') || parsed.searchParams.get('error'));
    const code = cleanString(parsed.searchParams.get('code'));
    if (error) {
      return {
        url: normalizedUrl,
        state: stateValue,
        error,
      };
    }
    if (!code) {
      return null;
    }
    return {
      url: normalizedUrl,
      state: stateValue,
      code,
    };
  }

  function createDesktopCallbackTracker(chromeApi) {
    const pendingSessions = new Map();
    const resolvedSessions = new Map();
    let listenersInstalled = false;

    function installListeners() {
      if (listenersInstalled || !chromeApi) {
        return;
      }
      listenersInstalled = true;

      const handleNavigation = (details = {}) => {
        const url = cleanString(details.url);
        if (!url) {
          return;
        }
        for (const [stateKey, session] of pendingSessions.entries()) {
          const parsed = parseDesktopCallbackUrl(url, session.expectedState, session.redirectPort);
          if (!parsed) {
            continue;
          }
          const result = {
            ...parsed,
            tabId: Number.isInteger(details.tabId) ? details.tabId : (Number.isInteger(session.tabId) ? session.tabId : null),
          };
          resolvedSessions.set(stateKey, result);
          const waiters = Array.isArray(session.waiters) ? session.waiters.splice(0, session.waiters.length) : [];
          pendingSessions.set(stateKey, {
            ...session,
            resolved: result,
            waiters: [],
          });
          waiters.forEach(({ resolve }) => resolve(result));
          const targetTabId = Number.isInteger(result.tabId) ? result.tabId : (Number.isInteger(session.tabId) ? session.tabId : null);
          if (Number.isInteger(targetTabId) && chromeApi.tabs?.remove) {
            chromeApi.tabs.remove(targetTabId).catch(() => {});
          }
          break;
        }
      };

      chromeApi.webNavigation?.onBeforeNavigate?.addListener?.(handleNavigation);
      chromeApi.webNavigation?.onCommitted?.addListener?.(handleNavigation);
      chromeApi.webRequest?.onBeforeRequest?.addListener?.(
        handleNavigation,
        { urls: ['http://127.0.0.1/*', 'http://localhost/*'] }
      );
    }

    function registerPending(params = {}) {
      installListeners();
      const expectedState = cleanString(params.expectedState);
      if (!expectedState) {
        throw new Error('缺少桌面授权 state，无法注册回调监听。');
      }
      const existingResolved = resolvedSessions.get(expectedState);
      const existingPending = pendingSessions.get(expectedState);
      pendingSessions.set(expectedState, {
        expectedState,
        redirectPort: Number(params.redirectPort || 0) || 0,
        tabId: Number.isInteger(params.tabId) ? params.tabId : (existingPending?.tabId ?? null),
        waiters: existingPending?.waiters || [],
        resolved: existingResolved || existingPending?.resolved || null,
      });
      return existingResolved || null;
    }

    function consumeResolved(expectedState = '') {
      const stateKey = cleanString(expectedState);
      if (!stateKey || !resolvedSessions.has(stateKey)) {
        return null;
      }
      const result = resolvedSessions.get(stateKey) || null;
      resolvedSessions.delete(stateKey);
      pendingSessions.delete(stateKey);
      return result;
    }

    function waitForResolved(expectedState = '', timeoutMs = 120000) {
      const stateKey = cleanString(expectedState);
      const immediate = consumeResolved(stateKey);
      if (immediate) {
        return Promise.resolve(immediate);
      }
      const session = pendingSessions.get(stateKey);
      if (!session) {
        return Promise.reject(new Error(`未注册桌面授权回调监听：${stateKey}`));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const nextSession = pendingSessions.get(stateKey);
          if (nextSession) {
            nextSession.waiters = (nextSession.waiters || []).filter((entry) => entry.reject !== reject);
            pendingSessions.set(stateKey, nextSession);
          }
          reject(new Error('等待桌面授权回调超时。'));
        }, Math.max(1000, Math.floor(Number(timeoutMs) || 120000)));
        session.waiters.push({
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        pendingSessions.set(stateKey, session);
      });
    }

    function clear(expectedState = '') {
      const stateKey = cleanString(expectedState);
      if (!stateKey) {
        return;
      }
      const session = pendingSessions.get(stateKey);
      if (session && Array.isArray(session.waiters)) {
        session.waiters.forEach(({ reject }) => reject(new Error('桌面授权回调监听已清理。')));
      }
      pendingSessions.delete(stateKey);
      resolvedSessions.delete(stateKey);
    }

    return {
      clear,
      consumeResolved,
      registerPending,
      waitForResolved,
    };
  }

  function createKiroDesktopAuthorizeRunner(deps = {}) {
    const {
      addLog = async () => {},
      chrome = (typeof globalThis !== 'undefined' ? globalThis.chrome : null),
      completeNodeFromBackground,
      ensureContentScriptReadyOnTab = null,
      ensureIcloudMailSession = null,
      ensureMail2925MailboxSession = null,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getMailConfig = null,
      getState = async () => ({}),
      getTabId = async () => null,
      HOTMAIL_PROVIDER = 'hotmail-api',
      LUCKMAIL_PROVIDER = 'luckmail-api',
      CLOUDFLARE_TEMP_EMAIL_PROVIDER = 'cloudflare-temp-email',
      CLOUD_MAIL_PROVIDER = 'cloudmail',
      YYDS_MAIL_PROVIDER = 'yyds-mail',
      MAIL_2925_VERIFICATION_INTERVAL_MS = 15000,
      MAIL_2925_VERIFICATION_MAX_ATTEMPTS = 15,
      isTabAlive = async () => false,
      KIRO_DESKTOP_AUTHORIZE_INJECT_FILES = null,
      pollCloudflareTempEmailVerificationCode = null,
      pollCloudMailVerificationCode = null,
      pollHotmailVerificationCode = null,
      pollLuckmailVerificationCode = null,
      pollYydsMailVerificationCode = null,
      registerTab = async () => {},
      reuseOrCreateTab = async () => null,
      sendToContentScriptResilient = null,
      sendToMailContentScriptResilient = null,
      setState = async () => {},
      sleepWithStop = async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      },
      throwIfStopped = () => {},
      waitForTabStableComplete = null,
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('Kiro desktop authorize runner requires completeNodeFromBackground.');
    }
    if (!desktopClientApi) {
      throw new Error('Kiro desktop authorize runner requires desktop client module.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('Kiro desktop authorize runner requires fetch support.');
    }

    const callbackTracker = createDesktopCallbackTracker(chrome);

    async function log(message, level = 'info', nodeId = '') {
      await addLog(message, level, nodeId ? { nodeId } : {});
    }

    async function activateTab(tabId) {
      if (!Number.isInteger(tabId) || !chrome?.tabs?.update) {
        return;
      }
      await chrome.tabs.update(tabId, { active: true });
    }

    async function getExecutionState(state = {}) {
      if (state && typeof state === 'object' && !Array.isArray(state) && Object.keys(state).length) {
        return state;
      }
      return getState();
    }

    async function applyRuntimeState(currentState = {}, patch = {}, extraState = {}) {
      const runtimePatch = mergeRuntimePatch(currentState, patch);
      const nextPatch = {
        ...runtimePatch,
        ...extraState,
      };
      await setState(nextPatch);
      return nextPatch;
    }

    async function persistFailure(currentState = {}, message = '') {
      await setState(mergeRuntimePatch(currentState, {
        session: {
          lastError: message,
        },
        desktopAuth: {
          status: 'error',
        },
      }));
    }

    async function ensureDesktopAuthorizeTab(state = {}, options = {}) {
      const runtimeState = readKiroRuntime(state);
      let tabId = Number.isInteger(runtimeState.session?.desktopTabId)
        ? runtimeState.session.desktopTabId
        : await getTabId(KIRO_DESKTOP_SOURCE_ID);
      const authorizeUrl = cleanString(runtimeState.desktopAuth?.authorizeUrl);

      if (Number.isInteger(tabId) && await isTabAlive(KIRO_DESKTOP_SOURCE_ID)) {
        return tabId;
      }
      if (!authorizeUrl) {
        throw new Error(options.missingUrlMessage || '缺少桌面授权地址，请先执行步骤 7。');
      }
      tabId = await reuseOrCreateTab(KIRO_DESKTOP_SOURCE_ID, authorizeUrl);
      if (!Number.isInteger(tabId)) {
        throw new Error(options.openFailedMessage || '无法打开桌面授权页，请重试步骤 7。');
      }
      await registerTab(KIRO_DESKTOP_SOURCE_ID, tabId);
      await setState(mergeRuntimePatch(state, {
        session: {
          desktopTabId: tabId,
        },
      }));
      return tabId;
    }

    async function activateDesktopAuthorizeTab(state = {}, options = {}) {
      const tabId = await ensureDesktopAuthorizeTab(state, options);
      await activateTab(tabId);
      return tabId;
    }

    async function reattachDesktopAuthorizePage(tabId, options = {}) {
      if (!Number.isInteger(tabId)) {
        throw new Error('缺少 Kiro 桌面授权页标签页，无法重新连接内容脚本。');
      }
      if (typeof waitForTabStableComplete === 'function') {
        await waitForTabStableComplete(tabId, {
          timeoutMs: 45000,
          retryDelayMs: 300,
          stableMs: Number(options.stableMs) || 1200,
          initialDelayMs: Number(options.initialDelayMs) || 120,
        });
      }
      if (typeof ensureContentScriptReadyOnTab === 'function') {
        await ensureContentScriptReadyOnTab(KIRO_DESKTOP_SOURCE_ID, tabId, {
          inject: Array.isArray(KIRO_DESKTOP_AUTHORIZE_INJECT_FILES) ? KIRO_DESKTOP_AUTHORIZE_INJECT_FILES : null,
          injectSource: KIRO_DESKTOP_SOURCE_ID,
          timeoutMs: 45000,
          retryDelayMs: 800,
          logMessage: options.injectLogMessage || 'Kiro 桌面授权页已跳转，正在重新连接内容脚本...',
        });
      }
    }

    function buildDesktopRetryRecovery(tabId, options = {}) {
      return async () => {
        await reattachDesktopAuthorizePage(tabId, {
          stableMs: Number(options.recoveryStableMs) || Number(options.stableMs) || 1200,
          initialDelayMs: Number(options.recoveryInitialDelayMs) || 120,
          injectLogMessage: options.recoveryInjectLogMessage || options.injectLogMessage || 'Kiro 桌面授权页已跳转，正在重新连接内容脚本...',
        });
      };
    }

    async function getDesktopAuthorizePageState(tabId, options = {}) {
      if (!Number.isInteger(tabId)) {
        throw new Error('缺少 Kiro 桌面授权页标签页，无法继续执行。');
      }
      if (typeof waitForTabStableComplete === 'function') {
        await waitForTabStableComplete(tabId, {
          timeoutMs: 45000,
          retryDelayMs: 300,
          stableMs: Number(options.stableMs) || 1200,
          initialDelayMs: Number(options.initialDelayMs) || 120,
        });
      }
      if (typeof ensureContentScriptReadyOnTab === 'function') {
        await ensureContentScriptReadyOnTab(KIRO_DESKTOP_SOURCE_ID, tabId, {
          inject: Array.isArray(KIRO_DESKTOP_AUTHORIZE_INJECT_FILES) ? KIRO_DESKTOP_AUTHORIZE_INJECT_FILES : null,
          injectSource: KIRO_DESKTOP_SOURCE_ID,
          timeoutMs: 45000,
          retryDelayMs: 800,
          logMessage: options.injectLogMessage || 'Kiro 桌面授权页内容脚本未就绪，正在等待页面恢复...',
        });
      }
      const result = await sendToContentScriptResilient(KIRO_DESKTOP_SOURCE_ID, {
        type: 'GET_KIRO_DESKTOP_AUTHORIZE_STATE',
        step: options.step || 0,
        source: 'background',
      }, {
        timeoutMs: 30000,
        retryDelayMs: 700,
        onRetryableError: buildDesktopRetryRecovery(tabId, options),
        logMessage: options.readyLogMessage || '正在读取 Kiro 桌面授权页状态...',
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || { state: '', url: '' };
    }

    async function executeDesktopAction(tabId, action, payload = {}, options = {}) {
      const result = await sendToContentScriptResilient(KIRO_DESKTOP_SOURCE_ID, {
        type: 'EXECUTE_KIRO_DESKTOP_AUTHORIZE_ACTION',
        step: options.step || 0,
        source: 'background',
        payload: {
          action,
          ...payload,
        },
      }, {
        timeoutMs: 30000,
        retryDelayMs: 700,
        onRetryableError: buildDesktopRetryRecovery(tabId, options),
        logMessage: options.logMessage || '正在执行 Kiro 桌面授权动作...',
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || { state: '', url: '' };
    }

    function resolveDesktopLoginPassword(state = {}) {
      const password = String(state?.customPassword || state?.password || '');
      if (!password) {
        throw new Error('缺少已注册账号密码，无法完成桌面授权重登。');
      }
      return password;
    }

    function getExpectedMail2925MailboxEmail(state = {}) {
      if (Boolean(state?.mail2925UseAccountPool)) {
        const currentAccountId = String(state?.currentMail2925AccountId || '').trim();
        const accounts = Array.isArray(state?.mail2925Accounts) ? state.mail2925Accounts : [];
        const currentAccount = accounts.find((account) => String(account?.id || '') === currentAccountId) || null;
        const accountEmail = String(currentAccount?.email || '').trim().toLowerCase();
        if (accountEmail) {
          return accountEmail;
        }
      }
      return String(state?.mail2925BaseEmail || '').trim().toLowerCase();
    }

    async function focusOrOpenMailTab(mail) {
      if (!mail?.source) {
        return;
      }
      const alive = await isTabAlive(mail.source);
      if (alive) {
        if (mail.navigateOnReuse) {
          await reuseOrCreateTab(mail.source, mail.url, {
            inject: mail.inject,
            injectSource: mail.injectSource,
          });
          return;
        }
        const tabId = await getTabId(mail.source);
        if (Number.isInteger(tabId)) {
          await activateTab(tabId);
        }
        return;
      }
      await reuseOrCreateTab(mail.source, mail.url, {
        inject: mail.inject,
        injectSource: mail.injectSource,
      });
    }

    function buildDesktopOtpPollPayload(step, state = {}, mail = {}, filterAfterTimestamp = 0) {
      const runtimeState = readKiroRuntime(state);
      const targetEmail = cleanString(runtimeState.register?.email || state?.email).toLowerCase();
      const targetEmailHints = targetEmail ? [targetEmail] : [];
      const isMail2925Provider = String(mail?.provider || '').trim().toLowerCase() === '2925';
      const normalizedProvider = String(mail?.provider || '').trim().toLowerCase();
      const maxAttempts = normalizedProvider === String(LUCKMAIL_PROVIDER || '').trim().toLowerCase()
        ? 3
        : (isMail2925Provider ? MAIL_2925_VERIFICATION_MAX_ATTEMPTS : 5);
      const intervalMs = normalizedProvider === String(LUCKMAIL_PROVIDER || '').trim().toLowerCase()
        ? 15000
        : (isMail2925Provider ? MAIL_2925_VERIFICATION_INTERVAL_MS : 3000);

      return {
        flowId: 'kiro',
        step,
        targetEmail,
        targetEmailHints,
        filterAfterTimestamp,
        senderFilters: [...KIRO_AWS_SENDER_FILTERS],
        subjectFilters: [...KIRO_AWS_SUBJECT_FILTERS],
        requiredKeywords: [...KIRO_AWS_REQUIRED_KEYWORDS],
        codePatterns: [...KIRO_AWS_VERIFICATION_CODE_PATTERNS],
        mail2925MatchTargetEmail: isMail2925Provider
          && String(state?.mail2925Mode || '').trim().toLowerCase() === 'receive',
        maxAttempts,
        intervalMs,
      };
    }

    function getMailPollingResponseTimeoutMs(payload = {}) {
      const maxAttempts = Math.max(1, Math.floor(Number(payload?.maxAttempts) || 1));
      const intervalMs = Math.max(1, Number(payload?.intervalMs) || 3000);
      return Math.max(45000, maxAttempts * intervalMs + 25000);
    }

    async function pollDesktopOtpCode(step, state = {}, nodeId = '') {
      if (typeof getMailConfig !== 'function') {
        throw new Error('Kiro 桌面授权验证码步骤缺少邮箱配置能力，无法继续执行。');
      }
      const mail = getMailConfig(state);
      if (mail?.error) {
        throw new Error(mail.error);
      }

      const runtimeState = readKiroRuntime(state);
      const requestedAt = Math.max(0, Number(runtimeState.desktopAuth?.otpRequestedAt) || Date.now());
      const filterAfterTimestamp = mail.provider === '2925'
        ? Math.max(0, requestedAt - MAIL_2925_FILTER_LOOKBACK_MS)
        : requestedAt;
      const pollPayload = buildDesktopOtpPollPayload(step, state, mail, filterAfterTimestamp);

      if (mail.source === 'icloud-mail' && typeof ensureIcloudMailSession === 'function') {
        await log(`步骤 ${step}：正在确认 ${mail.label || 'iCloud 邮箱'} 登录状态...`, 'info', nodeId);
        await ensureIcloudMailSession({
          state,
          step,
          actionLabel: `步骤 ${step}：确认 iCloud 邮箱登录状态`,
        });
      }

      if (mail.provider === HOTMAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'Hotmail'} 轮询桌面授权验证码...`, 'info', nodeId);
        return pollHotmailVerificationCode(step, state, pollPayload);
      }
      if (mail.provider === LUCKMAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'LuckMail'} 轮询桌面授权验证码...`, 'info', nodeId);
        return pollLuckmailVerificationCode(step, state, pollPayload);
      }
      if (mail.provider === CLOUDFLARE_TEMP_EMAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'Cloudflare Temp Email'} 轮询桌面授权验证码...`, 'info', nodeId);
        return pollCloudflareTempEmailVerificationCode(step, state, pollPayload);
      }
      if (mail.provider === CLOUD_MAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'Cloud Mail'} 轮询桌面授权验证码...`, 'info', nodeId);
        return pollCloudMailVerificationCode(step, state, pollPayload);
      }
      if (mail.provider === YYDS_MAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'YYDS Mail'} 轮询桌面授权验证码...`, 'info', nodeId);
        return pollYydsMailVerificationCode(step, state, pollPayload);
      }

      if (mail.provider === '2925' && typeof ensureMail2925MailboxSession === 'function') {
        await log(`步骤 ${step}：正在确认 ${mail.label || '2925 邮箱'} 登录状态...`, 'info', nodeId);
        await ensureMail2925MailboxSession({
          accountId: state.currentMail2925AccountId || null,
          forceRelogin: false,
          allowLoginWhenOnLoginPage: Boolean(state?.mail2925UseAccountPool),
          expectedMailboxEmail: getExpectedMail2925MailboxEmail(state),
          actionLabel: `步骤 ${step}：确认 2925 邮箱登录状态`,
        });
      } else {
        await log(`步骤 ${step}：正在打开 ${mail.label || '邮箱'}...`, 'info', nodeId);
        await focusOrOpenMailTab(mail);
      }

      if (typeof sendToMailContentScriptResilient !== 'function') {
        throw new Error('Kiro 桌面授权验证码步骤缺少邮箱内容脚本通信能力，无法继续执行。');
      }

      const responseTimeoutMs = getMailPollingResponseTimeoutMs(pollPayload);
      const result = await sendToMailContentScriptResilient(
        mail,
        {
          type: 'POLL_EMAIL',
          step,
          source: 'background',
          payload: pollPayload,
        },
        {
          timeoutMs: responseTimeoutMs,
          responseTimeoutMs,
          maxRecoveryAttempts: 2,
          logStep: step,
          logStepKey: 'kiro-complete-desktop-authorize',
        }
      );

      if (result?.error) {
        throw new Error(result.error);
      }
      if (!result?.code) {
        throw new Error(`步骤 ${step}：邮箱轮询结束，但未获取到桌面授权验证码。`);
      }
      return result;
    }

    async function executeKiroStartDesktopAuthorize(state = {}) {
      const nodeId = String(state?.nodeId || 'kiro-start-desktop-authorize').trim();
      const currentState = await getExecutionState(state);
      try {
        const runtimeState = readKiroRuntime(currentState);
        if (!cleanString(runtimeState.register?.email || currentState?.email)) {
          throw new Error('缺少已注册邮箱，请先完成注册页步骤。');
        }

        const client = await desktopClientApi.registerDesktopClient({
          region: DEFAULT_REGION,
          clientName: 'Kiro IDE',
        }, fetchImpl);
        const pkce = await desktopClientApi.generatePkcePair();
        const stateToken = cleanString(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        const redirectPort = desktopClientApi.chooseRedirectPort();
        const redirectUri = desktopClientApi.buildRedirectUri(redirectPort);
        const authorizeUrl = desktopClientApi.buildAuthorizeUrl({
          region: client.region,
          clientId: client.clientId,
          redirectUri,
          state: stateToken,
          codeChallenge: pkce.codeChallenge,
        });

        callbackTracker.registerPending({
          expectedState: stateToken,
          redirectPort,
        });

        const tabId = await reuseOrCreateTab(KIRO_DESKTOP_SOURCE_ID, authorizeUrl);
        if (!Number.isInteger(tabId)) {
          throw new Error('无法打开 Kiro 桌面授权页，请重试步骤 7。');
        }
        await registerTab(KIRO_DESKTOP_SOURCE_ID, tabId);
        callbackTracker.registerPending({
          expectedState: stateToken,
          redirectPort,
          tabId,
        });

        const payload = await applyRuntimeState(currentState, {
          session: {
            currentStage: 'desktop-authorize',
            desktopTabId: tabId,
            pageState: '',
            pageUrl: authorizeUrl,
            lastError: '',
            lastWarning: '',
          },
          desktopAuth: {
            region: client.region,
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            clientIdHash: client.clientIdHash,
            state: stateToken,
            codeVerifier: pkce.codeVerifier,
            codeChallenge: pkce.codeChallenge,
            redirectUri,
            redirectPort,
            authorizeUrl,
            authorizationCode: '',
            accessToken: '',
            refreshToken: '',
            status: 'waiting_callback',
            authorizedAt: 0,
            otpRequestedAt: 0,
            tokenSource: 'desktop_authorization_code_pkce',
          },
          upload: {
            status: 'waiting_desktop_authorize',
            error: '',
            credentialId: null,
            lastMessage: '',
            lastUploadedAt: 0,
          },
        });
        await activateTab(tabId);
        await log('步骤 7：Kiro 桌面授权页已打开，下一步将继续完成授权并抓取回调。', 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = getErrorMessage(error);
        await persistFailure(currentState, message);
        throw error;
      }
    }

    async function executeKiroCompleteDesktopAuthorize(state = {}) {
      const nodeId = String(state?.nodeId || 'kiro-complete-desktop-authorize').trim();
      const currentState = await getExecutionState(state);
      let runtimeState = readKiroRuntime(currentState);
      const desktopState = cleanString(runtimeState.desktopAuth?.state);
      try {
        if (!desktopState) {
          throw new Error('缺少桌面授权 state，请先执行步骤 7。');
        }
        if (!cleanString(runtimeState.desktopAuth?.clientId) || !cleanString(runtimeState.desktopAuth?.clientSecret)) {
          throw new Error('缺少桌面授权客户端凭据，请先执行步骤 7。');
        }
        if (!cleanString(runtimeState.desktopAuth?.redirectUri) || !runtimeState.desktopAuth?.redirectPort) {
          throw new Error('缺少桌面授权回调地址，请先执行步骤 7。');
        }
        if (!cleanString(runtimeState.desktopAuth?.codeVerifier)) {
          throw new Error('缺少桌面授权 PKCE verifier，请先执行步骤 7。');
        }

        callbackTracker.registerPending({
          expectedState: desktopState,
          redirectPort: runtimeState.desktopAuth.redirectPort,
          tabId: runtimeState.session?.desktopTabId,
        });

        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          throwIfStopped();

          const resolvedCallback = callbackTracker.consumeResolved(desktopState);
          if (resolvedCallback) {
            if (resolvedCallback.error) {
              throw new Error(`桌面授权回调失败：${resolvedCallback.error}`);
            }
            const tokenResult = await desktopClientApi.exchangeDesktopAuthorizationCode({
              region: runtimeState.desktopAuth.region || DEFAULT_REGION,
              clientId: runtimeState.desktopAuth.clientId,
              clientSecret: runtimeState.desktopAuth.clientSecret,
              redirectUri: runtimeState.desktopAuth.redirectUri,
              code: resolvedCallback.code,
              codeVerifier: runtimeState.desktopAuth.codeVerifier,
            }, fetchImpl);
            const payload = await applyRuntimeState(currentState, {
              session: {
                currentStage: 'upload',
                pageState: 'callback_captured',
                pageUrl: resolvedCallback.url,
                lastError: '',
              },
              desktopAuth: {
                authorizationCode: resolvedCallback.code,
                accessToken: tokenResult.accessToken,
                refreshToken: tokenResult.refreshToken,
                status: 'authorized',
                authorizedAt: Date.now(),
              },
              upload: {
                status: 'ready_to_upload',
                error: '',
              },
            });
            await log('步骤 8：桌面授权回调已捕获，Token 换取成功。', 'ok', nodeId);
            await completeNodeFromBackground(nodeId, payload);
            return;
          }

          const tabId = await activateDesktopAuthorizeTab(currentState, {
            missingUrlMessage: '缺少桌面授权地址，请先执行步骤 7。',
            openFailedMessage: '无法恢复桌面授权页，请重新执行步骤 7。',
          });

          const pageState = await getDesktopAuthorizePageState(tabId, {
            step: 8,
            injectLogMessage: '步骤 8：Kiro 桌面授权页内容脚本未就绪，正在等待页面恢复...',
            readyLogMessage: '步骤 8：正在读取 Kiro 桌面授权页当前状态...',
          });

          await setState(mergeRuntimePatch(currentState, {
            session: {
              pageState: pageState?.state || '',
              pageUrl: pageState?.url || '',
              lastError: '',
            },
          }));

          if (pageState.state === 'relogin_email') {
            const email = cleanString(runtimeState.register?.email || currentState?.email);
            await log(`步骤 8：桌面授权页要求重新输入邮箱，正在填写 ${email}...`, 'info', nodeId);
            await executeDesktopAction(tabId, 'submit-email', { email }, {
              step: 8,
              logMessage: '步骤 8：正在向桌面授权页提交邮箱...',
            });
            await sleepWithStop(1200);
            continue;
          }

          if (pageState.state === 'relogin_password') {
            const password = resolveDesktopLoginPassword(currentState);
            await log('步骤 8：桌面授权页要求重新输入密码，正在填写密码...', 'info', nodeId);
            await executeDesktopAction(tabId, 'submit-password', { password }, {
              step: 8,
              logMessage: '步骤 8：正在向桌面授权页提交密码...',
            });
            await sleepWithStop(1200);
            continue;
          }

          if (pageState.state === 'otp_page') {
            runtimeState = readKiroRuntime(currentState);
            if (!runtimeState.desktopAuth?.otpRequestedAt) {
              await setState(mergeRuntimePatch(currentState, {
                desktopAuth: {
                  otpRequestedAt: Date.now(),
                  status: 'waiting_otp',
                },
              }));
            }
            const codeResult = await pollDesktopOtpCode(8, currentState, nodeId);
            const code = cleanString(codeResult?.code);
            if (!code) {
              throw new Error('未获取到桌面授权验证码。');
            }
            await log(`步骤 8：已获取桌面授权验证码 ${code}，正在提交...`, 'info', nodeId);
            await executeDesktopAction(tabId, 'submit-otp', { code }, {
              step: 8,
              logMessage: '步骤 8：正在向桌面授权页提交验证码...',
            });
            await sleepWithStop(1200);
            continue;
          }

          if (pageState.state === 'consent_page') {
            await log('步骤 8：正在确认 Kiro 桌面授权访问...', 'info', nodeId);
            await executeDesktopAction(tabId, 'confirm-consent', {}, {
              step: 8,
              logMessage: '步骤 8：正在确认桌面授权访问...',
            });
            await sleepWithStop(1200);
            continue;
          }

          if (pageState.state === 'callback_page') {
            const parsedCallback = parseDesktopCallbackUrl(pageState.url, desktopState, runtimeState.desktopAuth?.redirectPort);
            if (parsedCallback) {
              callbackTracker.registerPending({
                expectedState: desktopState,
                redirectPort: runtimeState.desktopAuth?.redirectPort,
                tabId,
              });
              if (parsedCallback.code) {
                await setState(mergeRuntimePatch(currentState, {
                  session: {
                    pageState: 'callback_page',
                    pageUrl: parsedCallback.url,
                  },
                }));
              }
            }
          }

          await sleepWithStop(1000);
        }

        const lastResult = await callbackTracker.waitForResolved(desktopState, 2000).catch(() => null);
        if (lastResult?.error) {
          throw new Error(`桌面授权回调失败：${lastResult.error}`);
        }
        if (lastResult?.code) {
          const tokenResult = await desktopClientApi.exchangeDesktopAuthorizationCode({
            region: runtimeState.desktopAuth.region || DEFAULT_REGION,
            clientId: runtimeState.desktopAuth.clientId,
            clientSecret: runtimeState.desktopAuth.clientSecret,
            redirectUri: runtimeState.desktopAuth.redirectUri,
            code: lastResult.code,
            codeVerifier: runtimeState.desktopAuth.codeVerifier,
          }, fetchImpl);
          const payload = await applyRuntimeState(currentState, {
            session: {
              currentStage: 'upload',
              pageState: 'callback_captured',
              pageUrl: lastResult.url,
              lastError: '',
            },
            desktopAuth: {
              authorizationCode: lastResult.code,
              accessToken: tokenResult.accessToken,
              refreshToken: tokenResult.refreshToken,
              status: 'authorized',
              authorizedAt: Date.now(),
            },
            upload: {
              status: 'ready_to_upload',
              error: '',
            },
          });
          await log('步骤 8：桌面授权回调已捕获，Token 换取成功。', 'ok', nodeId);
          await completeNodeFromBackground(nodeId, payload);
          return;
        }

        throw new Error('等待桌面授权回调超时。');
      } catch (error) {
        callbackTracker.clear(desktopState);
        const message = getErrorMessage(error);
        await persistFailure(currentState, message);
        throw error;
      }
    }

    return {
      executeKiroCompleteDesktopAuthorize,
      executeKiroStartDesktopAuthorize,
      parseDesktopCallbackUrl,
    };
  }

  return {
    createDesktopCallbackTracker,
    createKiroDesktopAuthorizeRunner,
    parseDesktopCallbackUrl,
  };
});
