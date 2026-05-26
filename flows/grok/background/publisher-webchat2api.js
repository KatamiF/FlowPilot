(function attachBackgroundGrokPublisherWebchat2Api(root, factory) {
  root.MultiPageBackgroundGrokPublisherWebchat2Api = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGrokPublisherWebchat2ApiModule(root) {
  const grokStateApi = root?.MultiPageBackgroundGrokState || null;
  const WEBCHAT2API_INJECT_PATH = '/api/remote-account/inject';
  const DEFAULT_SOURCE_ID = 'flowpilot-grok-sso';
  const DEFAULT_SOURCE_NAME = 'FlowPilot Grok SSO';

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

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : cleanString(error) || '未知错误';
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

  function readWebchat2ApiResponseMessage(body = {}, fallback = '') {
    return cleanString(
      body?.json?.error?.message
      || body?.json?.error
      || body?.json?.message
      || fallback
    );
  }

  function normalizeWebchat2ApiBaseUrl(value = '') {
    const rawUrl = cleanString(value);
    if (!rawUrl) {
      throw new Error('缺少 webchat2api 地址。');
    }
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
    let parsed = null;
    try {
      parsed = new URL(withProtocol);
    } catch (_error) {
      throw new Error('webchat2api 地址格式无效，请检查配置。');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('webchat2api 地址只支持 http 或 https。');
    }
    return parsed.origin;
  }

  function buildWebchat2ApiInjectUrl(value = '') {
    return `${normalizeWebchat2ApiBaseUrl(value)}${WEBCHAT2API_INJECT_PATH}`;
  }

  function normalizeWebchat2ApiAdminKey(value = '') {
    return cleanString(value);
  }

  function readGrokRuntime(state = {}) {
    return grokStateApi?.ensureRuntimeState
      ? grokStateApi.ensureRuntimeState(state)
      : (isPlainObject(state?.runtimeState?.flowState?.grok)
        ? state.runtimeState.flowState.grok
        : (isPlainObject(state?.flowState?.grok) ? state.flowState.grok : {}));
  }

  function buildCanonicalRuntimePatch(currentState = {}, nextRuntimeState = {}) {
    if (typeof grokStateApi?.buildRuntimeStatePatch === 'function') {
      return grokStateApi.buildRuntimeStatePatch(currentState, nextRuntimeState);
    }
    const baseRuntimeState = isPlainObject(currentState?.runtimeState)
      ? cloneValue(currentState.runtimeState)
      : {};
    const baseFlowState = isPlainObject(baseRuntimeState.flowState)
      ? cloneValue(baseRuntimeState.flowState)
      : {};
    return {
      runtimeState: {
        ...baseRuntimeState,
        flowState: {
          ...baseFlowState,
          grok: deepMerge(readGrokRuntime(currentState), nextRuntimeState),
        },
      },
    };
  }

  function mergeRuntimePatch(currentState = {}, patch = {}) {
    return buildCanonicalRuntimePatch(
      currentState,
      deepMerge(readGrokRuntime(currentState), patch)
    );
  }

  function resolveGrokWebchat2ApiConfig(state = {}) {
    const nestedConfig = state?.settingsState?.flows?.grok?.targets?.webchat2api || {};
    return {
      baseUrl: cleanString(nestedConfig.baseUrl || state?.grokWebchat2ApiUrl),
      apiKey: normalizeWebchat2ApiAdminKey(nestedConfig.apiKey ?? state?.grokWebchat2ApiAdminKey ?? ''),
    };
  }

  function resolveGrokSsoCookie(state = {}) {
    const runtimeState = readGrokRuntime(state);
    return cleanString(runtimeState?.sso?.currentCookie || state?.grokSsoCookie);
  }

  function buildGrokSsoInjectPayload(ssoCookie = '') {
    const normalizedCookie = cleanString(ssoCookie);
    if (!normalizedCookie) {
      throw new Error('缺少 Grok SSO Cookie，请先完成步骤 5。');
    }
    return {
      accounts: [{
        token: normalizedCookie,
        provider: 'grok',
        type: 'sso',
      }],
      strategy: 'merge',
      source_id: DEFAULT_SOURCE_ID,
      source_name: DEFAULT_SOURCE_NAME,
      provider: 'grok',
    };
  }

  async function uploadGrokSsoToWebchat2Api(baseUrl, apiKey, ssoCookie, fetchImpl) {
    const endpointUrl = buildWebchat2ApiInjectUrl(baseUrl);
    const normalizedApiKey = normalizeWebchat2ApiAdminKey(apiKey);
    if (!normalizedApiKey) {
      throw new Error('缺少 webchat2api 管理密钥。');
    }

    const response = await fetchImpl(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedApiKey}`,
      },
      body: JSON.stringify(buildGrokSsoInjectPayload(ssoCookie)),
    });
    const body = await readResponse(response);
    if (!response.ok) {
      const message = readWebchat2ApiResponseMessage(body, response.statusText) || `HTTP ${response.status}`;
      throw new Error(`webchat2api SSO 上传失败：${message}`);
    }
    if (isPlainObject(body.json) && Object.prototype.hasOwnProperty.call(body.json, 'code') && Number(body.json.code) !== 0) {
      const message = readWebchat2ApiResponseMessage(body, `code=${body.json.code}`);
      throw new Error(`webchat2api SSO 上传失败：${message}`);
    }
    return {
      endpointUrl,
      message: readWebchat2ApiResponseMessage(body, '') || '上传成功',
      raw: body.json,
    };
  }

  function createGrokWebchat2ApiPublisher(deps = {}) {
    const {
      addLog = async () => {},
      completeNodeFromBackground,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getState = async () => ({}),
      setState = async () => {},
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('Grok webchat2api publisher requires completeNodeFromBackground.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('Grok webchat2api publisher requires fetch support.');
    }

    async function log(message, level = 'info', nodeId = '') {
      await addLog(message, level, nodeId ? { nodeId } : {});
    }

    async function applyRuntimeState(currentState = {}, patch = {}) {
      const nextPatch = mergeRuntimePatch(currentState, patch);
      await setState(nextPatch);
      return nextPatch;
    }

    async function persistFailure(currentState = {}, message = '', targetUrl = '') {
      const uploadPatch = {
        status: 'error',
        uploadedAt: 0,
        message,
      };
      const normalizedTargetUrl = cleanString(targetUrl);
      if (normalizedTargetUrl) {
        uploadPatch.targetUrl = normalizedTargetUrl;
      }
      const nextPatch = mergeRuntimePatch(currentState, {
        session: {
          lastError: message,
        },
        upload: uploadPatch,
      });
      await setState(nextPatch);
    }

    async function executeGrokUploadSsoToWebchat2Api(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'grok-upload-sso-to-webchat2api';
      const currentState = await getState();
      let failureTargetUrl = '';
      try {
        const targetConfig = resolveGrokWebchat2ApiConfig(currentState);
        const endpointUrl = buildWebchat2ApiInjectUrl(targetConfig.baseUrl);
        failureTargetUrl = endpointUrl;
        const apiKey = normalizeWebchat2ApiAdminKey(targetConfig.apiKey);
        if (!apiKey) {
          throw new Error('缺少 webchat2api 管理密钥。');
        }
        const ssoCookie = resolveGrokSsoCookie(currentState);
        if (!ssoCookie) {
          throw new Error('缺少 Grok SSO Cookie，请先完成步骤 5。');
        }

        await applyRuntimeState(currentState, {
          session: {
            lastError: '',
          },
          upload: {
            status: 'uploading',
            uploadedAt: 0,
            message: '',
            targetUrl: endpointUrl,
          },
        });

        await log('步骤 6：正在上传 Grok SSO 到 webchat2api...', 'info', nodeId);
        const uploadResult = await uploadGrokSsoToWebchat2Api(
          targetConfig.baseUrl,
          apiKey,
          ssoCookie,
          fetchImpl
        );
        const uploadedAt = Date.now();
        const payload = await applyRuntimeState(currentState, {
          session: {
            lastError: '',
          },
          upload: {
            status: 'uploaded',
            uploadedAt,
            message: uploadResult.message || '上传成功',
            targetUrl: uploadResult.endpointUrl,
          },
        });
        await log(`步骤 6：Grok SSO 已上传到 webchat2api，状态：${uploadResult.message || '上传成功'}。`, 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = getErrorMessage(error);
        await persistFailure(currentState, message, failureTargetUrl);
        await log(`步骤 6：${message}`, 'error', nodeId);
        throw error;
      }
    }

    return {
      executeGrokUploadSsoToWebchat2Api,
    };
  }

  return {
    buildGrokSsoInjectPayload,
    buildWebchat2ApiInjectUrl,
    createGrokWebchat2ApiPublisher,
    normalizeWebchat2ApiBaseUrl,
    uploadGrokSsoToWebchat2Api,
  };
});
