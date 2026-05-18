(function attachBackgroundKiroRegisterRunner(root, factory) {
  root.MultiPageBackgroundKiroRegisterRunner = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundKiroRegisterRunnerModule(root) {
  const kiroStateApi = root.MultiPageBackgroundKiroState || null;
  const DEFAULT_REGION = kiroStateApi?.DEFAULT_REGION || 'us-east-1';
  const DEFAULT_TARGET_ID = kiroStateApi?.DEFAULT_TARGET_ID || 'kiro-rs';
  const DEVICE_LOGIN_START_URL = 'https://view.awsapps.com/start';
  const DEFAULT_SCOPES = Object.freeze([
    'codewhisperer:completions',
    'codewhisperer:analysis',
    'codewhisperer:conversations',
    'codewhisperer:transformations',
    'codewhisperer:taskassist',
  ]);
  const KIRO_REGISTER_PAGE_SOURCE_ID = 'kiro-register-page';
  const KIRO_STEP1_COOKIE_CLEAR_DOMAINS = Object.freeze([
    'awsapps.com',
    'view.awsapps.com',
    'login.awsapps.com',
    'amazonaws.com',
    'signin.aws',
    'signin.aws.amazon.com',
    'profile.aws',
    'profile.aws.amazon.com',
  ]);
  const KIRO_STEP1_COOKIE_CLEAR_ORIGINS = Object.freeze([
    'https://view.awsapps.com',
    'https://login.awsapps.com',
    'https://oidc.us-east-1.amazonaws.com',
    'https://signin.aws',
    'https://signin.aws.amazon.com',
    'https://profile.aws',
    'https://profile.aws.amazon.com',
  ]);
  const MAIL_2925_FILTER_LOOKBACK_MS = 10 * 60 * 1000;
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

  function normalizeRegion(value = '', fallback = DEFAULT_REGION) {
    return cleanString(value) || fallback;
  }

  function normalizePositiveInteger(value, fallback) {
    const numeric = Math.floor(Number(value));
    if (Number.isInteger(numeric) && numeric > 0) {
      return numeric;
    }
    return fallback;
  }

  function buildOidcBaseUrl(region = DEFAULT_REGION) {
    return `https://oidc.${normalizeRegion(region)}.amazonaws.com`;
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

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error ?? '未知错误');
  }

  async function readResponse(response) {
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return { text, json };
  }

  function normalizeKiroCookieDomain(domain = '') {
    return String(domain || '').trim().replace(/^\.+/, '').toLowerCase();
  }

  function matchesKiroNamedHostFamily(domain = '', family = '') {
    const normalizedDomain = normalizeKiroCookieDomain(domain);
    const normalizedFamily = normalizeKiroCookieDomain(family);
    if (!normalizedDomain || !normalizedFamily) {
      return false;
    }
    return normalizedDomain === normalizedFamily
      || normalizedDomain.endsWith(`.${normalizedFamily}`)
      || normalizedDomain.startsWith(`${normalizedFamily}.`)
      || normalizedDomain.includes(`.${normalizedFamily}.`);
  }

  function shouldClearKiroStep1Cookie(cookie) {
    const domain = normalizeKiroCookieDomain(cookie?.domain);
    if (!domain) {
      return false;
    }
    return KIRO_STEP1_COOKIE_CLEAR_DOMAINS.some((target) => (
      domain === target
      || domain.endsWith(`.${target}`)
      || matchesKiroNamedHostFamily(domain, target)
    ));
  }

  function buildKiroStep1CookieRemovalUrl(cookie) {
    const host = normalizeKiroCookieDomain(cookie?.domain);
    const rawPath = String(cookie?.path || '/');
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return `https://${host}${path}`;
  }

  async function collectKiroStep1Cookies(chromeApi) {
    if (!chromeApi?.cookies?.getAll) {
      return [];
    }

    const stores = chromeApi.cookies.getAllCookieStores
      ? await chromeApi.cookies.getAllCookieStores()
      : [{ id: undefined }];
    const cookies = [];
    const seen = new Set();

    for (const store of stores) {
      const storeId = store?.id;
      const batch = await chromeApi.cookies.getAll(storeId ? { storeId } : {});
      for (const cookie of batch || []) {
        if (!shouldClearKiroStep1Cookie(cookie)) {
          continue;
        }
        const key = [
          cookie.storeId || storeId || '',
          cookie.domain || '',
          cookie.path || '',
          cookie.name || '',
          cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
        ].join('|');
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        cookies.push(cookie);
      }
    }

    return cookies;
  }

  async function removeKiroStep1Cookie(chromeApi, cookie) {
    const details = {
      url: buildKiroStep1CookieRemovalUrl(cookie),
      name: cookie.name,
    };
    if (cookie.storeId) {
      details.storeId = cookie.storeId;
    }
    if (cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey;
    }

    try {
      const result = await chromeApi.cookies.remove(details);
      return Boolean(result);
    } catch (error) {
      console.warn('[MultiPage:kiro-register] remove cookie failed', {
        domain: cookie?.domain,
        name: cookie?.name,
        message: getErrorMessage(error),
      });
      return false;
    }
  }

  async function startBuilderIdDeviceLogin(region, fetchImpl) {
    const normalizedRegion = normalizeRegion(region);
    const oidcBaseUrl = buildOidcBaseUrl(normalizedRegion);
    const registerResponse = await fetchImpl(`${oidcBaseUrl}/client/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientName: 'Codex Registration Extension',
        clientType: 'public',
        scopes: DEFAULT_SCOPES,
        grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
        issuerUrl: DEVICE_LOGIN_START_URL,
      }),
    });
    const registerBody = await readResponse(registerResponse);
    if (!registerResponse.ok) {
      throw new Error(`Builder ID 客户端注册失败：${cleanString(registerBody.text || registerResponse.statusText) || registerResponse.status}`);
    }

    const clientId = cleanString(registerBody.json?.clientId);
    const clientSecret = String(registerBody.json?.clientSecret || '');
    if (!clientId || !clientSecret) {
      throw new Error('Builder ID 客户端注册响应缺少凭据。');
    }

    const authorizationResponse = await fetchImpl(`${oidcBaseUrl}/device_authorization`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        startUrl: DEVICE_LOGIN_START_URL,
      }),
    });
    const authorizationBody = await readResponse(authorizationResponse);
    if (!authorizationResponse.ok) {
      throw new Error(`Builder ID 设备授权失败：${cleanString(authorizationBody.text || authorizationResponse.statusText) || authorizationResponse.status}`);
    }

    const deviceCode = String(authorizationBody.json?.deviceCode || '');
    const userCode = cleanString(authorizationBody.json?.userCode);
    const verificationUri = cleanString(authorizationBody.json?.verificationUri);
    const verificationUriComplete = cleanString(
      authorizationBody.json?.verificationUriComplete || verificationUri
    );
    const interval = normalizePositiveInteger(authorizationBody.json?.interval, 5);
    const expiresIn = normalizePositiveInteger(authorizationBody.json?.expiresIn, 600);
    if (!deviceCode || !userCode || !verificationUriComplete) {
      throw new Error('Builder ID 设备授权响应缺少必要字段。');
    }

    return {
      clientId,
      clientSecret,
      deviceCode,
      expiresAt: Date.now() + expiresIn * 1000,
      expiresIn,
      interval,
      region: normalizedRegion,
      userCode,
      verificationUri,
      verificationUriComplete,
    };
  }

  function createKiroRegisterRunner(deps = {}) {
    const {
      addLog = async () => {},
      chrome = (typeof globalThis !== 'undefined' ? globalThis.chrome : null),
      completeNodeFromBackground,
      ensureContentScriptReadyOnTab = null,
      ensureIcloudMailSession = null,
      ensureMail2925MailboxSession = null,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      generatePassword = null,
      generateRandomName = null,
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
      KIRO_REGISTER_INJECT_FILES = null,
      pollCloudflareTempEmailVerificationCode = null,
      pollCloudMailVerificationCode = null,
      pollHotmailVerificationCode = null,
      pollLuckmailVerificationCode = null,
      pollYydsMailVerificationCode = null,
      registerTab = async () => {},
      resolveSignupEmailForFlow = null,
      reuseOrCreateTab = async () => null,
      sendToContentScriptResilient = null,
      sendToMailContentScriptResilient = null,
      setPasswordState = async () => {},
      setState = async () => {},
      sleepWithStop = async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      },
      throwIfStopped = () => {},
      waitForTabStableComplete = null,
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('Kiro register runner requires completeNodeFromBackground.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('Kiro register runner requires fetch support.');
    }

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

    async function persistFailure(currentState = {}, message = '', extraPatch = {}) {
      const runtimeState = readKiroRuntime(currentState);
      const stage = runtimeState.session?.currentStage || 'register';
      const status = runtimeState.register?.status || '';
      const patch = mergeRuntimePatch(currentState, {
        session: {
          currentStage: stage,
          lastError: message,
        },
        register: {
          status: status || 'error',
        },
      });
      await setState({
        ...patch,
        ...extraPatch,
      });
    }

    async function clearKiroCookiesBeforeStep1() {
      if (!chrome?.cookies?.getAll || !chrome.cookies?.remove) {
        await log('步骤 1：当前浏览器不支持 cookies API，跳过打开 Kiro 注册页前的 cookie 清理。', 'warn');
        return;
      }

      await log('步骤 1：打开 Kiro 注册页前清理 AWS Builder ID 相关 cookies...', 'info');
      const cookies = await collectKiroStep1Cookies(chrome);
      let removedCount = 0;
      for (const cookie of cookies) {
        if (await removeKiroStep1Cookie(chrome, cookie)) {
          removedCount += 1;
        }
      }

      if (chrome.browsingData?.removeCookies) {
        try {
          await chrome.browsingData.removeCookies({
            since: 0,
            origins: KIRO_STEP1_COOKIE_CLEAR_ORIGINS,
          });
        } catch (error) {
          await log(`步骤 1：browsingData 补扫 cookies 失败：${getErrorMessage(error)}`, 'warn');
        }
      }

      await log(`步骤 1：已清理 ${removedCount} 个 AWS Builder ID 相关 cookies。`, 'ok');
    }

    async function ensureKiroRegisterTab(state = {}, options = {}) {
      const runtimeState = readKiroRuntime(state);
      let tabId = Number.isInteger(runtimeState.session?.registerTabId)
        ? runtimeState.session.registerTabId
        : await getTabId(KIRO_REGISTER_PAGE_SOURCE_ID);
      const loginUrl = cleanString(runtimeState.register?.loginUrl);

      if (Number.isInteger(tabId) && await isTabAlive(KIRO_REGISTER_PAGE_SOURCE_ID)) {
        return tabId;
      }

      if (!loginUrl) {
        throw new Error(options.missingUrlMessage || '缺少 Kiro 注册页地址，请先执行步骤 1。');
      }

      tabId = await reuseOrCreateTab(KIRO_REGISTER_PAGE_SOURCE_ID, loginUrl);
      if (!Number.isInteger(tabId)) {
        throw new Error(options.openFailedMessage || '无法打开 Kiro 注册页，请重试步骤 1。');
      }
      await registerTab(KIRO_REGISTER_PAGE_SOURCE_ID, tabId);
      await setState(mergeRuntimePatch(state, {
        session: {
          registerTabId: tabId,
        },
      }));
      return tabId;
    }

    async function activateKiroRegisterTab(state = {}, options = {}) {
      const tabId = await ensureKiroRegisterTab(state, options);
      await activateTab(tabId);
      return tabId;
    }

    async function reattachKiroRegisterPage(tabId, options = {}) {
      if (!Number.isInteger(tabId)) {
        throw new Error('缺少 Kiro 注册页标签页，无法重新连接内容脚本。');
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
        await ensureContentScriptReadyOnTab(KIRO_REGISTER_PAGE_SOURCE_ID, tabId, {
          inject: Array.isArray(KIRO_REGISTER_INJECT_FILES) ? KIRO_REGISTER_INJECT_FILES : null,
          injectSource: KIRO_REGISTER_PAGE_SOURCE_ID,
          timeoutMs: 45000,
          retryDelayMs: 800,
          logMessage: options.injectLogMessage || 'Kiro 注册页已跳转，正在重新连接内容脚本...',
        });
      }
    }

    function buildKiroRetryRecovery(tabId, options = {}) {
      return async () => {
        await reattachKiroRegisterPage(tabId, {
          stableMs: Number(options.recoveryStableMs) || Number(options.stableMs) || 1200,
          initialDelayMs: Number(options.recoveryInitialDelayMs) || 120,
          injectLogMessage: options.recoveryInjectLogMessage || options.injectLogMessage || 'Kiro 注册页已跳转，正在重新连接内容脚本...',
        });
      };
    }

    async function ensureKiroPageState(tabId, options = {}) {
      if (!Number.isInteger(tabId)) {
        throw new Error('缺少 Kiro 注册页标签页，无法继续执行。');
      }
      if (typeof waitForTabStableComplete === 'function') {
        await waitForTabStableComplete(tabId, {
          timeoutMs: 45000,
          retryDelayMs: 300,
          stableMs: Number(options.stableMs) || 1500,
          initialDelayMs: Number(options.initialDelayMs) || 150,
        });
      }
      if (typeof ensureContentScriptReadyOnTab === 'function') {
        await ensureContentScriptReadyOnTab(KIRO_REGISTER_PAGE_SOURCE_ID, tabId, {
          inject: Array.isArray(KIRO_REGISTER_INJECT_FILES) ? KIRO_REGISTER_INJECT_FILES : null,
          injectSource: KIRO_REGISTER_PAGE_SOURCE_ID,
          timeoutMs: 45000,
          retryDelayMs: 800,
          logMessage: options.injectLogMessage || 'Kiro 注册页内容脚本未就绪，正在等待页面恢复...',
        });
      }
      if (typeof sendToContentScriptResilient !== 'function') {
        return {
          state: Array.isArray(options.targetStates) ? options.targetStates[0] || '' : '',
          url: '',
        };
      }
      const result = await sendToContentScriptResilient(KIRO_REGISTER_PAGE_SOURCE_ID, {
        type: 'ENSURE_KIRO_PAGE_STATE',
        step: options.step || 0,
        source: 'background',
        payload: {
          targetStates: Array.isArray(options.targetStates) ? options.targetStates : [],
          timeoutMs: Number(options.pageTimeoutMs) || 30000,
          retryDelayMs: Number(options.pageRetryDelayMs) || 250,
          timeoutMessage: options.timeoutMessage || '',
        },
      }, {
        timeoutMs: Math.max(30000, Number(options.pageTimeoutMs) || 30000),
        retryDelayMs: 700,
        onRetryableError: buildKiroRetryRecovery(tabId, options),
        logMessage: options.readyLogMessage || '正在等待 Kiro 页面进入下一状态...',
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || { state: '', url: '' };
    }

    async function waitForKiroPageChange(tabId, options = {}) {
      if (!Number.isInteger(tabId)) {
        throw new Error('缺少 Kiro 注册页标签页，无法继续执行。');
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
        await ensureContentScriptReadyOnTab(KIRO_REGISTER_PAGE_SOURCE_ID, tabId, {
          inject: Array.isArray(KIRO_REGISTER_INJECT_FILES) ? KIRO_REGISTER_INJECT_FILES : null,
          injectSource: KIRO_REGISTER_PAGE_SOURCE_ID,
          timeoutMs: 45000,
          retryDelayMs: 800,
          logMessage: options.injectLogMessage || 'Kiro 注册页切换中，正在等待页面恢复...',
        });
      }
      if (typeof sendToContentScriptResilient !== 'function') {
        return { state: '', url: '' };
      }
      const result = await sendToContentScriptResilient(KIRO_REGISTER_PAGE_SOURCE_ID, {
        type: 'ENSURE_KIRO_STATE_CHANGE',
        step: options.step || 0,
        source: 'background',
        payload: {
          fromStates: Array.isArray(options.fromStates) ? options.fromStates : [],
          timeoutMs: Number(options.pageTimeoutMs) || 30000,
          retryDelayMs: Number(options.pageRetryDelayMs) || 250,
          timeoutMessage: options.timeoutMessage || '',
        },
      }, {
        timeoutMs: Math.max(30000, Number(options.pageTimeoutMs) || 30000),
        retryDelayMs: 700,
        onRetryableError: buildKiroRetryRecovery(tabId, options),
        logMessage: options.readyLogMessage || '正在等待 Kiro 页面完成跳转...',
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || { state: '', url: '' };
    }

    function resolveKiroFullName(state = {}) {
      const runtimeState = readKiroRuntime(state);
      const cachedName = cleanString(runtimeState.register?.fullName);
      if (cachedName) {
        return cachedName;
      }
      if (typeof generateRandomName !== 'function') {
        throw new Error('Kiro 姓名步骤缺少随机姓名能力，无法继续执行。');
      }
      const generated = generateRandomName();
      if (typeof generated === 'string') {
        const normalized = cleanString(generated);
        if (normalized) {
          return normalized;
        }
      }
      const firstName = cleanString(generated?.firstName);
      const lastName = cleanString(generated?.lastName);
      const fullName = cleanString(`${firstName} ${lastName}`);
      if (!fullName) {
        throw new Error('Kiro 姓名步骤未生成有效姓名。');
      }
      return fullName;
    }

    function resolveKiroPassword(state = {}) {
      const existingPassword = String(state?.customPassword || state?.password || '');
      if (existingPassword) {
        return {
          password: existingPassword,
          mode: state?.customPassword ? 'custom' : 'reused',
        };
      }
      if (typeof generatePassword !== 'function') {
        throw new Error('Kiro 密码步骤缺少公共密码生成能力，无法继续执行。');
      }
      return {
        password: String(generatePassword() || ''),
        mode: 'generated',
      };
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

    function buildKiroVerificationPollPayload(step, state = {}, mail = {}, filterAfterTimestamp = 0) {
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

    async function pollKiroVerificationCode(step, state = {}, nodeId = '') {
      if (typeof getMailConfig !== 'function') {
        throw new Error('Kiro 验证码步骤缺少邮箱配置能力，无法继续执行。');
      }
      const mail = getMailConfig(state);
      if (mail?.error) {
        throw new Error(mail.error);
      }

      const runtimeState = readKiroRuntime(state);
      const requestedAt = Math.max(0, Number(runtimeState.register?.verificationRequestedAt) || Date.now());
      const filterAfterTimestamp = mail.provider === '2925'
        ? Math.max(0, requestedAt - MAIL_2925_FILTER_LOOKBACK_MS)
        : requestedAt;
      const pollPayload = buildKiroVerificationPollPayload(step, state, mail, filterAfterTimestamp);

      if (mail.source === 'icloud-mail' && typeof ensureIcloudMailSession === 'function') {
        await log(`步骤 ${step}：正在确认 ${mail.label || 'iCloud 邮箱'} 登录状态...`, 'info', nodeId);
        await ensureIcloudMailSession({
          state,
          step,
          actionLabel: `步骤 ${step}：确认 iCloud 邮箱登录状态`,
        });
      }

      throwIfStopped();
      if (mail.provider === HOTMAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'Hotmail'} 轮询验证码...`, 'info', nodeId);
        return pollHotmailVerificationCode(step, state, pollPayload);
      }
      if (mail.provider === LUCKMAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'LuckMail'} 轮询验证码...`, 'info', nodeId);
        return pollLuckmailVerificationCode(step, state, pollPayload);
      }
      if (mail.provider === CLOUDFLARE_TEMP_EMAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'Cloudflare Temp Email'} 轮询验证码...`, 'info', nodeId);
        return pollCloudflareTempEmailVerificationCode(step, state, pollPayload);
      }
      if (mail.provider === CLOUD_MAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'Cloud Mail'} 轮询验证码...`, 'info', nodeId);
        return pollCloudMailVerificationCode(step, state, pollPayload);
      }
      if (mail.provider === YYDS_MAIL_PROVIDER) {
        await log(`步骤 ${step}：正在通过 ${mail.label || 'YYDS Mail'} 轮询验证码...`, 'info', nodeId);
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
        throw new Error('Kiro 验证码步骤缺少邮箱内容脚本通信能力，无法继续执行。');
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
          logStepKey: 'kiro-submit-verification-code',
        }
      );

      if (result?.error) {
        throw new Error(result.error);
      }
      if (!result?.code) {
        throw new Error(`步骤 ${step}：邮箱轮询结束，但未获取到验证码。`);
      }
      return result;
    }

    async function executeKiroOpenRegisterPage(state = {}) {
      const nodeId = String(state?.nodeId || 'kiro-open-register-page').trim();
      const currentState = await getExecutionState(state);
      try {
        await clearKiroCookiesBeforeStep1();
        const auth = await startBuilderIdDeviceLogin(DEFAULT_REGION, fetchImpl);
        const loginUrl = cleanString(auth.verificationUriComplete || auth.verificationUri);
        const tabId = loginUrl ? await reuseOrCreateTab(KIRO_REGISTER_PAGE_SOURCE_ID, loginUrl) : null;
        if (!Number.isInteger(tabId)) {
          throw new Error('无法打开 Kiro 注册页，请重试步骤 1。');
        }
        await registerTab(KIRO_REGISTER_PAGE_SOURCE_ID, tabId);
        await activateTab(tabId);

        const landingResult = await ensureKiroPageState(tabId, {
          step: 1,
          targetStates: ['email_entry'],
          stableMs: 2500,
          initialDelayMs: 300,
          injectLogMessage: '步骤 1：Kiro 注册页内容脚本未就绪，正在等待页面恢复...',
          readyLogMessage: '步骤 1：正在等待 Kiro 注册页邮箱输入框加载完成...',
        });

        const nextPatch = {
          session: {
            currentStage: 'register',
            registerTabId: tabId,
            startedAt: Date.now(),
            pageState: landingResult?.state || '',
            pageUrl: landingResult?.url || loginUrl,
            lastError: '',
            lastWarning: '',
          },
          register: {
            email: '',
            fullName: '',
            verificationRequestedAt: 0,
            entryClientId: auth.clientId,
            entryClientSecret: auth.clientSecret,
            entryDeviceCode: auth.deviceCode,
            userCode: auth.userCode,
            loginUrl,
            verificationUri: auth.verificationUri,
            verificationUriComplete: loginUrl,
            entryExpiresAt: auth.expiresAt,
            entryIntervalSeconds: auth.interval,
            status: 'waiting_email',
            completedAt: 0,
          },
          desktopAuth: {
            region: DEFAULT_REGION,
            clientId: '',
            clientSecret: '',
            clientIdHash: '',
            state: '',
            codeVerifier: '',
            codeChallenge: '',
            redirectUri: '',
            redirectPort: 0,
            authorizeUrl: '',
            authorizationCode: '',
            accessToken: '',
            refreshToken: '',
            status: '',
            authorizedAt: 0,
            otpRequestedAt: 0,
            tokenSource: 'desktop_authorization_code_pkce',
          },
          upload: {
            targetId: cleanString(currentState?.kiroTargetId || readKiroRuntime(currentState).upload?.targetId) || DEFAULT_TARGET_ID,
            status: 'waiting_register',
            error: '',
            credentialId: null,
            lastMessage: '',
            lastUploadedAt: 0,
          },
        };

        const payload = await applyRuntimeState(currentState, nextPatch);
        await log(`Kiro 注册页已就绪，请在下一步中获取邮箱并继续。当前授权码：${auth.userCode}`, 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = getErrorMessage(error);
        await persistFailure(currentState, message);
        throw error;
      }
    }

    async function executeKiroSubmitEmail(state = {}) {
      const nodeId = String(state?.nodeId || 'kiro-submit-email').trim();
      const currentState = await getExecutionState(state);
      try {
        if (typeof resolveSignupEmailForFlow !== 'function') {
          throw new Error('Kiro 邮箱步骤缺少公共邮箱解析能力，无法继续执行。');
        }

        const tabId = await activateKiroRegisterTab(currentState, {
          missingUrlMessage: '缺少 Kiro 注册页地址，请先执行步骤 1。',
          openFailedMessage: '无法恢复 Kiro 注册页，请重新执行步骤 1。',
        });
        await ensureKiroPageState(tabId, {
          step: 2,
          targetStates: ['email_entry'],
          stableMs: 2500,
          initialDelayMs: 300,
          injectLogMessage: '步骤 2：Kiro 注册页内容脚本未就绪，正在等待页面恢复...',
          readyLogMessage: '步骤 2：正在等待 Kiro 注册页邮箱输入框加载完成...',
        });

        const resolvedEmail = await resolveSignupEmailForFlow(currentState, {
          preserveAccountIdentity: true,
        });
        await log(`步骤 2：已获取邮箱 ${resolvedEmail}，正在提交到 Kiro 注册页...`, 'info', nodeId);

        await activateTab(tabId);
        const submitResult = await sendToContentScriptResilient(KIRO_REGISTER_PAGE_SOURCE_ID, {
          type: 'EXECUTE_NODE',
          nodeId: 'kiro-submit-email',
          step: 2,
          source: 'background',
          payload: {
            email: resolvedEmail,
          },
        }, {
          timeoutMs: 30000,
          retryDelayMs: 700,
          onRetryableError: buildKiroRetryRecovery(tabId, {}),
          logMessage: '步骤 2：正在向 Kiro 注册页提交邮箱...',
        });
        if (submitResult?.error) {
          throw new Error(submitResult.error);
        }

        const landingResult = await ensureKiroPageState(tabId, {
          step: 2,
          targetStates: ['name_entry'],
          stableMs: 1500,
          initialDelayMs: 150,
          injectLogMessage: '步骤 2：邮箱提交后页面切换中，正在等待 Kiro 注册页恢复...',
          readyLogMessage: '步骤 2：邮箱已提交，正在等待 Kiro 姓名页加载完成...',
          timeoutMessage: '邮箱提交后未进入姓名页，请检查当前邮箱是否已注册或页面是否异常。',
        });

        const payload = await applyRuntimeState(currentState, {
          session: {
            currentStage: 'register',
            pageState: landingResult?.state || '',
            pageUrl: landingResult?.url || '',
            lastError: '',
          },
          register: {
            email: resolvedEmail,
            fullName: '',
            verificationRequestedAt: 0,
            status: 'waiting_name',
          },
          upload: {
            status: 'waiting_register',
            error: '',
          },
        });
        await log(`步骤 2：邮箱 ${resolvedEmail} 已提交，当前已进入姓名页。`, 'ok', nodeId);
        await completeNodeFromBackground(nodeId, {
          ...payload,
          email: resolvedEmail,
          accountIdentifierType: 'email',
          accountIdentifier: resolvedEmail,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        await persistFailure(currentState, message);
        throw error;
      }
    }

    async function executeKiroSubmitName(state = {}) {
      const nodeId = String(state?.nodeId || 'kiro-submit-name').trim();
      const currentState = await getExecutionState(state);
      try {
        const runtimeState = readKiroRuntime(currentState);
        if (!cleanString(runtimeState.register?.email || currentState?.email)) {
          throw new Error('缺少 Kiro 注册邮箱，请先完成步骤 2。');
        }

        const tabId = await activateKiroRegisterTab(currentState, {
          missingUrlMessage: '缺少 Kiro 注册页地址，请先执行步骤 1。',
          openFailedMessage: '无法恢复 Kiro 注册页，请重新执行步骤 1。',
        });
        await ensureKiroPageState(tabId, {
          step: 3,
          targetStates: ['name_entry'],
          stableMs: 1500,
          initialDelayMs: 150,
          injectLogMessage: '步骤 3：Kiro 姓名页内容脚本未就绪，正在等待页面恢复...',
          readyLogMessage: '步骤 3：正在等待 Kiro 姓名页加载完成...',
        });

        const fullName = resolveKiroFullName(currentState);
        const verificationRequestedAt = Date.now();
        await log(`步骤 3：正在填写姓名 ${fullName} 并继续...`, 'info', nodeId);

        const submitResult = await sendToContentScriptResilient(KIRO_REGISTER_PAGE_SOURCE_ID, {
          type: 'EXECUTE_NODE',
          nodeId: 'kiro-submit-name',
          step: 3,
          source: 'background',
          payload: {
            fullName,
          },
        }, {
          timeoutMs: 30000,
          retryDelayMs: 700,
          onRetryableError: buildKiroRetryRecovery(tabId, {}),
          logMessage: '步骤 3：正在向 Kiro 姓名页提交姓名...',
        });
        if (submitResult?.error) {
          throw new Error(submitResult.error);
        }

        const landingResult = await ensureKiroPageState(tabId, {
          step: 3,
          targetStates: ['otp_page'],
          stableMs: 1500,
          initialDelayMs: 150,
          injectLogMessage: '步骤 3：姓名提交后页面切换中，正在等待 Kiro 注册页恢复...',
          readyLogMessage: '步骤 3：姓名已提交，正在等待 Kiro 验证码页加载完成...',
          timeoutMessage: '姓名提交后未进入验证码页，请检查当前页面状态。',
        });
        const payload = await applyRuntimeState(currentState, {
          session: {
            currentStage: 'register',
            pageState: landingResult?.state || '',
            pageUrl: landingResult?.url || '',
            lastError: '',
          },
          register: {
            fullName,
            verificationRequestedAt,
            status: 'waiting_otp',
          },
          upload: {
            status: 'waiting_register',
            error: '',
          },
        });
        await log('步骤 3：姓名已提交，当前已进入验证码页。', 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = getErrorMessage(error);
        await persistFailure(currentState, message);
        throw error;
      }
    }

    async function executeKiroSubmitVerificationCode(state = {}) {
      const nodeId = String(state?.nodeId || 'kiro-submit-verification-code').trim();
      const currentState = await getExecutionState(state);
      try {
        const runtimeState = readKiroRuntime(currentState);
        if (!cleanString(runtimeState.register?.email || currentState?.email)) {
          throw new Error('缺少 Kiro 注册邮箱，请先完成步骤 2。');
        }

        const tabId = await activateKiroRegisterTab(currentState, {
          missingUrlMessage: '缺少 Kiro 注册页地址，请先执行步骤 1。',
          openFailedMessage: '无法恢复 Kiro 注册页，请重新执行步骤 1。',
        });
        await ensureKiroPageState(tabId, {
          step: 4,
          targetStates: ['otp_page'],
          stableMs: 1500,
          initialDelayMs: 150,
          injectLogMessage: '步骤 4：Kiro 验证码页内容脚本未就绪，正在等待页面恢复...',
          readyLogMessage: '步骤 4：正在等待 Kiro 验证码页加载完成...',
        });

        const codeResult = await pollKiroVerificationCode(4, currentState, nodeId);
        const code = cleanString(codeResult?.code);
        if (!code) {
          throw new Error('未能获取到 Kiro 邮箱验证码。');
        }
        await log(`步骤 4：已获取验证码 ${code}，正在返回 Kiro 注册页提交...`, 'info', nodeId);

        await activateTab(tabId);
        const submitResult = await sendToContentScriptResilient(KIRO_REGISTER_PAGE_SOURCE_ID, {
          type: 'EXECUTE_NODE',
          nodeId: 'kiro-submit-verification-code',
          step: 4,
          source: 'background',
          payload: {
            code,
          },
        }, {
          timeoutMs: 30000,
          retryDelayMs: 700,
          onRetryableError: buildKiroRetryRecovery(tabId, {}),
          logMessage: '步骤 4：正在向 Kiro 验证码页提交验证码...',
        });
        if (submitResult?.error) {
          throw new Error(submitResult.error);
        }

        const landingResult = await ensureKiroPageState(tabId, {
          step: 4,
          targetStates: ['password_page'],
          stableMs: 1500,
          initialDelayMs: 150,
          injectLogMessage: '步骤 4：验证码提交后页面切换中，正在等待 Kiro 注册页恢复...',
          readyLogMessage: '步骤 4：验证码已提交，正在等待 Kiro 密码页加载完成...',
          timeoutMessage: '验证码提交后未进入密码页，请检查验证码是否失效或页面是否异常。',
        });
        const payload = await applyRuntimeState(currentState, {
          session: {
            currentStage: 'register',
            pageState: landingResult?.state || '',
            pageUrl: landingResult?.url || '',
            lastError: '',
          },
          register: {
            status: 'waiting_password',
          },
          upload: {
            status: 'waiting_register',
            error: '',
          },
        });
        await log('步骤 4：验证码已提交，当前已进入密码页。', 'ok', nodeId);
        await completeNodeFromBackground(nodeId, {
          ...payload,
          code,
          emailTimestamp: Number(codeResult?.emailTimestamp || 0) || 0,
          mailId: String(codeResult?.mailId || ''),
        });
      } catch (error) {
        const message = getErrorMessage(error);
        await persistFailure(currentState, message);
        throw error;
      }
    }

    async function executeKiroSubmitPassword(state = {}) {
      const nodeId = String(state?.nodeId || 'kiro-submit-password').trim();
      const currentState = await getExecutionState(state);
      try {
        const tabId = await activateKiroRegisterTab(currentState, {
          missingUrlMessage: '缺少 Kiro 注册页地址，请先执行步骤 1。',
          openFailedMessage: '无法恢复 Kiro 注册页，请重新执行步骤 1。',
        });
        await ensureKiroPageState(tabId, {
          step: 5,
          targetStates: ['password_page'],
          stableMs: 1500,
          initialDelayMs: 150,
          injectLogMessage: '步骤 5：Kiro 密码页内容脚本未就绪，正在等待页面恢复...',
          readyLogMessage: '步骤 5：正在等待 Kiro 密码页加载完成...',
        });

        const passwordResolution = resolveKiroPassword(currentState);
        const password = passwordResolution.password;
        if (!password) {
          throw new Error('未生成有效的 Kiro 账户密码。');
        }
        if (typeof setPasswordState === 'function') {
          await setPasswordState(password);
        } else {
          await setState({ password });
        }

        const passwordModeLabel = passwordResolution.mode === 'custom'
          ? '自定义密码'
          : (passwordResolution.mode === 'reused' ? '复用现有密码' : '自动生成密码');
        await log(`步骤 5：正在填写 Kiro 账户密码（${passwordModeLabel}，${password.length} 位）...`, 'info', nodeId);

        const submitResult = await sendToContentScriptResilient(KIRO_REGISTER_PAGE_SOURCE_ID, {
          type: 'EXECUTE_NODE',
          nodeId: 'kiro-submit-password',
          step: 5,
          source: 'background',
          payload: {
            password,
          },
        }, {
          timeoutMs: 30000,
          retryDelayMs: 700,
          onRetryableError: buildKiroRetryRecovery(tabId, {}),
          logMessage: '步骤 5：正在向 Kiro 密码页提交密码...',
        });
        if (submitResult?.error) {
          throw new Error(submitResult.error);
        }

        const landingResult = await waitForKiroPageChange(tabId, {
          step: 5,
          fromStates: ['password_page'],
          stableMs: 1200,
          initialDelayMs: 120,
          injectLogMessage: '步骤 5：密码提交后页面切换中，正在等待 Kiro 注册页恢复...',
          readyLogMessage: '步骤 5：密码已提交，正在等待 Kiro 注册页完成跳转...',
          timeoutMessage: '密码提交后页面未离开密码页，请检查密码规则或当前页面提示。',
        });
        const nextRegisterStatus = landingResult?.state === 'success_page'
          ? 'completed'
          : 'waiting_consent';
        const payload = await applyRuntimeState(currentState, {
          session: {
            currentStage: 'register',
            pageState: landingResult?.state || '',
            pageUrl: landingResult?.url || '',
            lastError: '',
          },
          register: {
            status: nextRegisterStatus,
          },
          upload: {
            status: 'waiting_register',
            error: '',
          },
        });
        await log(`步骤 5：密码已提交，当前页面状态：${landingResult?.state || 'unknown'}。`, 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = getErrorMessage(error);
        await persistFailure(currentState, message);
        throw error;
      }
    }

    async function executeKiroCompleteRegisterConsent(state = {}) {
      const nodeId = String(state?.nodeId || 'kiro-complete-register-consent').trim();
      const currentState = await getExecutionState(state);
      try {
        const tabId = await activateKiroRegisterTab(currentState, {
          missingUrlMessage: '缺少 Kiro 注册页地址，请先执行步骤 1。',
          openFailedMessage: '无法恢复 Kiro 注册页，请重新执行步骤 1。',
        });
        let landingResult = await ensureKiroPageState(tabId, {
          step: 6,
          targetStates: ['authorization_page', 'success_page'],
          stableMs: 1500,
          initialDelayMs: 150,
          injectLogMessage: '步骤 6：Kiro 授权确认页内容脚本未就绪，正在等待页面恢复...',
          readyLogMessage: '步骤 6：正在等待 Kiro 授权确认页加载完成...',
          timeoutMessage: '未进入 Kiro 授权确认页，请检查当前页面状态。',
        });

        if (landingResult?.state !== 'success_page') {
          await log('步骤 6：正在确认访问并完成 Kiro 注册授权...', 'info', nodeId);
          const submitResult = await sendToContentScriptResilient(KIRO_REGISTER_PAGE_SOURCE_ID, {
            type: 'EXECUTE_NODE',
            nodeId: 'kiro-complete-register-consent',
            step: 6,
            source: 'background',
            payload: {
              maxActions: 3,
            },
          }, {
            timeoutMs: 60000,
            retryDelayMs: 700,
            onRetryableError: buildKiroRetryRecovery(tabId, {}),
            logMessage: '步骤 6：正在处理 Kiro 注册授权确认页...',
          });
          if (submitResult?.error) {
            throw new Error(submitResult.error);
          }
          landingResult = {
            state: String(submitResult?.state || ''),
            url: String(submitResult?.url || ''),
          };
        }

        const payload = await applyRuntimeState(currentState, {
          session: {
            currentStage: 'desktop-authorize',
            pageState: landingResult?.state || '',
            pageUrl: landingResult?.url || '',
            lastError: '',
          },
          register: {
            status: 'completed',
            completedAt: Date.now(),
          },
          upload: {
            status: 'waiting_desktop_authorize',
            error: '',
          },
        });
        await log('步骤 6：注册页授权已完成，Builder ID 浏览器会话已建立。', 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = getErrorMessage(error);
        await persistFailure(currentState, message);
        throw error;
      }
    }

    return {
      executeKiroCompleteRegisterConsent,
      executeKiroOpenRegisterPage,
      executeKiroSubmitEmail,
      executeKiroSubmitName,
      executeKiroSubmitPassword,
      executeKiroSubmitVerificationCode,
      startBuilderIdDeviceLogin,
    };
  }

  return {
    createKiroRegisterRunner,
    startBuilderIdDeviceLogin,
  };
});
