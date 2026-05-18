# Kiro Flow 独立重构开发方案

## 1. 方案目标

本方案的目标不是继续修补当前 Kiro 实现，而是把 Kiro flow 作为一套独立系统重建，最终形成一条正确、可扩展、可维护的链路：

1. 自动完成 Kiro / AWS Builder ID 注册页面流程
2. 在注册完成后，获取 **桌面端 Kiro 凭据**
3. 将正确的凭据上传到 `kiro.rs`

本方案明确遵守以下边界：

- **当前不做验活**：暂不把额度查询、模型查询、余额查询作为交付前置条件
- **不做向后兼容**：不保留旧字段别名、不保留旧流程兜底、不保留旧 Kiro device auth 方案
- **Kiro 与 OpenAI flow 分开设计**：Kiro 不再挂靠 OpenAI 的流程假设
- **只复用真正共享的能力**：账户密码、邮箱服务、IP 代理、通用节点执行框架可以复用；OpenAI 的 Plus、接码、平台回调、贡献模式等逻辑不复用

---

## 2. 已完成的代码阅读范围

### 2.1 本仓库已阅读模块

- `shared/flow-registry.js`
- `shared/settings-schema.js`
- `shared/flow-capabilities.js`
- `shared/source-registry.js`
- `data/step-definitions.js`
- `sidepanel/sidepanel.html`
- `sidepanel/sidepanel.js`
- `background.js`
- `background/runtime-state.js`
- `background/auto-run-controller.js`
- `background/message-router.js`
- `background/steps/kiro-device-auth.js`
- `content/kiro-device-auth-page.js`
- Kiro 相关测试文件

### 2.2 对照项目已阅读模块

- `any-auto-register/platforms/kiro/core.py`
- `any-auto-register/platforms/kiro/plugin.py`
- `any-auto-register/platforms/kiro/account_manager_upload.py`
- `kirox/internal/core/kiro_auth.go`
- `kirox/internal/core/kiro_exchange.go`
- `k_i_r_o-register/kiro_register.py`
- `k_i_r_o-register/roxy_register.py`
- `kiro.rs/src/admin/types.rs`
- `kiro.rs/admin-ui/src/components/kam-import-dialog.tsx`
- `kiro.rs/src/kiro/machine_id.rs`
- `kiro.rs/src/kiro/token_manager.rs`

---

## 3. 当前实现的根因分析

## 3.1 当前扩展拿到的是错误类型的 Kiro 凭据

当前扩展的核心问题不在页面点击顺序，而在 **凭据获取协议本身就是错的**。

当前实现位于 `background/steps/kiro-device-auth.js`，它在步骤 1 中调用：

- `/client/register`
- `/device_authorization`
- 后续 `/token` 轮询 `device_code`

也就是说，当前扩展走的是：

- `device_code + refresh_token`

但对照可正常使用的 Kiro 项目后可以确认，真正稳定的链路是：

- `authorization_code + PKCE + refresh_token`

并且这条链路对应的是 **桌面端 Kiro / Builder ID 凭据**，不是当前扩展这条 device auth 结果。

结论：

- 当前扩展虽然能“走完页面”
- 也能“上传 refreshToken / clientId / clientSecret”
- 但上传上去的并不是后续 `kiro.rs` 稳定使用所需的那类凭据

这就是为什么“流程成功了，但导入 `kiro.rs` 还是 400 / 后续不可用”。

## 3.2 `kiro.rs` 的新增凭据接口并不需要 `profileArn`

从 `kiro.rs/src/admin/types.rs` 可以确认，`AddCredentialRequest` 只接收：

- `refreshToken`
- `authMethod`
- `clientId`
- `clientSecret`
- `region / authRegion / apiRegion`
- `machineId`
- `email`
- `proxy`
- `endpoint`

它 **不接收 `profileArn`**。

因此这里要明确两点：

1. `profileArn` 不是当前扩展上传失败的缺失字段
2. “给扩展补一个 profileArn 上传字段”不是根因修复

`profileArn` 出现在：

- `k_i_r_o-register`
- 本地 Kiro 账号管理脚本
- 使用额度查询逻辑

它属于另一类本地账号体系或后续消费链路，不是当前 `kiro.rs` 新增凭据的必要输入。

## 3.3 可正常工作的对照项目，核心都不是 device auth

### `any-auto-register`

它的可用性关键点是：

- 注册桌面 OIDC client
- 使用 `authorization_code + refresh_token`
- 使用 `redirectUris`
- 使用 PKCE
- 缺少桌面 token 时，自动补抓桌面 token

### `kirox`

它进一步证明了两件事：

1. 正确链路仍然是 **桌面端授权码链路**
2. 就算没有本地 HTTP 回调服务，也可以通过协议方式拿到最终 `code`

### `k_i_r_o-register`

它的注册链路同样也是：

- 桌面 client 注册
- 本地回调 / URL 抓取
- `authorization_code` 兑换 token

也就是说，这三个对照项目虽然实现细节不同，但核心方向是一致的，当前扩展反而是偏离方向的那一个。

## 3.4 当前 Kiro flow 的“独立化”只做了一半

从代码结构上看，Kiro 已经有独立的：

- `activeFlowId = kiro`
- `step-definitions`
- `flow-capabilities`
- `content/kiro-device-auth-page.js`

但这套“独立化”并没有彻底完成，至少存在以下结构性问题：

### 问题 A：`kiroSourceId` 命名错误

当前 UI 里的 Kiro “来源”本质上是：

- 上传目标
- 发布目标
- `kiro.rs` 接收端

它不是页面来源，也不是运行时 source family。

但代码里却叫：

- `kiroSourceId`

这会导致概念混乱：

- runtime source
- integration target
- publication target
- UI selector value

被混成一个词。

### 问题 B：flow registry 合同并不完整

`sidepanel.js` 和 `background.js` 中多处在调用：

- `normalizeSourceId`
- `getSourceOptions`
- `getDefaultSourceId`

但 `shared/flow-registry.js` 当前并没有把这套合同完整实现出来，很多地方靠 fallback 字符串逻辑硬兜。

这说明当前“flow-aware 架构”在 Kiro 这里并没有彻底闭合。

### 问题 C：Kiro 运行态是扁平字段，且分散在多个入口

当前 Kiro 运行态字段散落在：

- `background/steps/kiro-device-auth.js`
- `background.js` 的重置逻辑
- `background/runtime-state.js`
- `handleNodeData`
- `auto-run fresh reset`
- `sidepanel` 显示逻辑

只要 Kiro 新增一步，就可能同时要改：

- 步骤定义
- 背景执行器
- 状态清理
- 节点完成回写
- 自动运行恢复
- UI 显示

这不是正确的可维护设计。

### 问题 D：文档与代码已经明显不一致

仓库内现有说明文档仍然把 Kiro 写成：

- 3 节点 workflow
- `kiro-await-device-login`

但真实代码已经是：

- 7 节点
- 注册页面逐步执行

这说明当前文档层已经过期，继续在这个基础上开发只会放大混乱。

### 问题 E：Kiro 还残留“隐形配置面”

`background/steps/kiro-device-auth.js` 仍然读取：

- `kiroRsPriority`
- `kiroRsEndpoint`
- `kiroRsAuthRegion`
- `kiroRsApiRegion`

但这些字段：

- 不在当前 Kiro UI 上
- 不在当前 Kiro settings schema 的显式配置面里
- 只有零散状态、历史测试或旧文档提到

这属于典型的“代码里还有逻辑入口，但产品面已经没有正式定义”，后续维护风险很高。

---

## 4. 结论：当前 Kiro flow 不能继续修补，必须整体换协议

结论非常明确：

- 当前 Kiro flow 的页面自动化并不是主要矛盾
- 主要矛盾是：**注册后拿错了 token 类型**

所以后续开发不能再围绕这些方向继续补丁：

- 继续加强 device auth
- 继续给上传接口补 `profileArn`
- 继续在旧 `kiro-device-auth.js` 上堆更多字段
- 继续保留 `kiroSourceId` / fallback / alias

这几条路都会让代码越来越乱，但不会从根上解决上传后不可用的问题。

---

## 5. 重构目标

## 5.1 产品目标

新的 Kiro flow 必须做到：

1. 用户在扩展内完成 Kiro 注册页流程
2. 注册完成后，扩展继续完成 **桌面端 Kiro 授权**
3. 扩展拿到正确的桌面端 `refreshToken / clientId / clientSecret`
4. 扩展把这组凭据上传到 `kiro.rs`

## 5.2 架构目标

新的 Kiro flow 必须做到：

1. **Kiro 独立建模**
2. **Kiro 独立运行态**
3. **Kiro 独立步骤定义**
4. **Kiro 独立页面驱动**
5. **Kiro 独立发布器**
6. **只复用共享服务，不复用 OpenAI 业务流程**

## 5.3 代码目标

新的 Kiro flow 必须做到：

1. 不再依赖 `device_code`
2. 不再依赖 `kiroSourceId`
3. 不再依赖隐藏字段
4. 不再让 `background.js` 手写维护大段 Kiro 字段列表
5. 不再让 `sidepanel.js` 通过 fallback 猜测 Kiro 目标

---

## 6. 明确设计决策

## 6.1 不保留旧 Kiro device auth 方案

旧的 `background/steps/kiro-device-auth.js` 不继续扩展，最终应当被拆解并移除。

不能做的事情：

- 同时保留 device auth 和 desktop auth 两套链路
- 通过“配置开关”选择旧/新协议
- 保留旧字段做兜底

原因：

- 这会制造双协议并存
- 测试面翻倍
- 状态字段翻倍
- 出问题后无法快速判断到底跑的是哪条链路

## 6.2 Kiro 的“来源”改为真正的“目标”

内部命名统一改为：

- `targetId`
- `integrationTargetId`
- `publicationTargetId`

而不是继续使用：

- `kiroSourceId`

UI 上是否继续显示“来源”，可以由 flow 自己定义标签；但内部数据模型不能继续叫 source。

## 6.3 Kiro 运行态单独命名空间化

Kiro 运行态不再用满天飞的平铺字段，统一收敛到独立命名空间，建议采用：

```js
kiroRuntime: {
  session: {},
  register: {},
  desktopAuth: {},
  upload: {},
}
```

这样后续新增步骤时，只需要改 Kiro 模块本身，不需要再在全局状态处理器里东补一处西补一处。

## 6.4 选择“浏览器授权页 + 回调 URL 捕获”作为桌面授权方案

桌面端凭据获取方案，采用：

1. 后台注册桌面 OIDC client
2. 生成 PKCE 参数
3. 打开桌面 authorize URL
4. 用浏览器现有 Builder ID 会话完成授权
5. 通过浏览器导航事件捕获 `http://127.0.0.1:<port>/oauth/callback?...`
6. 从回调 URL 中提取 `code`
7. 后台兑换 token

这个方案的优点：

- 符合扩展擅长的能力边界
- 不需要本地 HTTP 服务
- 不需要额外进程
- 不需要手工抓 SSO bearer token
- 与 `any-auto-register` / `k_i_r_o-register` 的核心协议一致

## 6.5 当前阶段不做自动验活

当前阶段上传前后只做：

- 结构合法性校验
- token 兑换结果校验
- 上传响应校验

不做：

- 额度查询
- 余额查询
- 模型查询
- 真实可用性压测

这些能力后续可以作为独立阶段添加，但不应该阻塞本次重构主线。

---

## 7. 目标架构设计

## 7.1 模块划分

建议新增并替换为以下 Kiro 专属模块：

### 背景层

- `background/kiro/state.js`
  - Kiro 运行态初始值
  - Kiro 节点下游清理规则
  - Kiro payload 合法字段筛选
  - Kiro auto-run keep-state 构建

- `background/kiro/register-runner.js`
  - 注册页面步骤 1-6 的编排
  - cookie 清理
  - 标签页管理
  - 页面状态推进

- `background/kiro/desktop-client.js`
  - 桌面 OIDC client 注册
  - PKCE 生成
  - authorize URL 组装
  - auth code 换 token

- `background/kiro/desktop-authorize-runner.js`
  - 打开桌面授权页
  - 监听授权标签页
  - 捕获 localhost 回调 URL
  - 执行 relogin / OTP / consent

- `background/kiro/publisher-kiro-rs.js`
  - 上传 payload 构建
  - `kiro.rs` API 请求
  - machineId 生成

- `background/kiro/index.js`
  - 暴露 Kiro 所有节点执行器

### 内容脚本层

- `content/kiro/register-page.js`
  - 只处理注册页 1-6

- `content/kiro/desktop-authorize-page.js`
  - 只处理桌面授权页 7-8

- `content/kiro/error-page.js`
  - 统一 Kiro 错误页识别
  - CloudFront 403 / callback error / consent stuck 等

### 共享定义层

- `shared/flow-registry.js`
  - 改成完整 flow 合同
  - 显式提供 target 选项与 normalize 方法

- `shared/settings-schema.js`
  - Kiro 目标配置与共享服务配置

- `data/step-definitions.js`
  - Kiro 独立 9 步定义

### UI 层

- `sidepanel/sidepanel.js`
  - 流选择器 / 目标选择器通用化
  - Kiro 运行态展示改为读取 `kiroRuntime`

---

## 7.2 统一的 flow 合同

当前 flow 合同不完整，新的 flow registry 必须显式提供以下能力：

- `getRegisteredFlowIds()`
- `normalizeFlowId()`
- `getFlowLabel()`
- `getDefaultTargetId(flowId)`
- `normalizeTargetId(flowId, targetId, fallback)`
- `getTargetOptions(flowId)`
- `getVisibleGroupIds(flowId, targetId)`
- `getRuntimeSourceDefinitions()`
- `getDriverDefinitions()`

注意：

- OpenAI 的 legacy `panelMode` 是否保留，是 OpenAI 自己的问题
- **Kiro 不能再新增任何 legacy alias**

也就是说，新设计中不再接受：

- `kiroSourceId`
- `sourceId === kiro-rs`
- `panelMode` 映射到 Kiro

Kiro 内部只认：

- `activeFlowId = "kiro"`
- `targetId = "kiro-rs"`

---

## 7.3 Kiro 设置模型

建议新的 Kiro 设置模型为：

```js
settingsState: {
  services: {
    account: {
      customPassword: "",
    },
    email: {
      provider: "duck",
    },
    proxy: {
      enabled: false,
      provider: "711proxy",
      mode: "account",
      ...
    },
  },
  flows: {
    kiro: {
      targetId: "kiro-rs",
      targets: {
        "kiro-rs": {
          baseUrl: "",
          apiKey: "",
        },
      },
      autoRun: {
        stepExecutionRange: {
          enabled: false,
          fromStep: 1,
          toStep: 9,
        },
      },
    },
  },
}
```

### 关键约束

- Kiro 不再保留 `kiroRsPriority`
- Kiro 不再保留 `kiroRsEndpoint`
- Kiro 不再保留 `kiroRsAuthRegion`
- Kiro 不再保留 `kiroRsApiRegion`

如果协议需要 region：

- 在内部写死 `us-east-1`
- 不暴露成用户配置项

这是因为当前用户要求里，Kiro 只需要：

- 来源下拉
- `kiro.rs` 账户信息
- 邮箱服务
- IP 代理
- 公共账户密码

不存在额外 region / endpoint / profile 之类配置需求。

---

## 7.4 Kiro 运行态模型

建议新的 Kiro 运行态结构为：

```js
kiroRuntime: {
  session: {
    currentStage: "",
    registerTabId: null,
    desktopTabId: null,
    startedAt: 0,
    lastError: "",
    lastWarning: "",
  },
  register: {
    email: "",
    fullName: "",
    verificationRequestedAt: 0,
    pageState: "",
    pageUrl: "",
    completedAt: 0,
  },
  desktopAuth: {
    region: "us-east-1",
    clientId: "",
    clientSecret: "",
    clientIdHash: "",
    codeVerifier: "",
    state: "",
    redirectUri: "",
    authorizeUrl: "",
    authorizationCode: "",
    accessToken: "",
    refreshToken: "",
    tokenSource: "desktop_authorization_code_pkce",
  },
  upload: {
    targetId: "kiro-rs",
    status: "",
    error: "",
    credentialId: null,
    lastMessage: "",
    lastUploadedAt: 0,
  },
}
```

### 该设计解决的问题

1. Kiro 状态不再散成 20 多个平铺字段
2. `background.js` 不再需要手写大段 Kiro 字段白名单
3. `handleNodeData` 不再需要枚举 Kiro 字段
4. `getDownstreamStateResets` 不再由全局函数硬编码 Kiro 细节
5. sidepanel 不再混用“虚构的 `flows.kiro.auth.*` 路径”和真实平铺字段

---

## 7.5 Kiro 步骤设计

建议最终步骤定义改为 9 步：

1. `kiro-open-register-page`
2. `kiro-submit-email`
3. `kiro-submit-name`
4. `kiro-submit-verification-code`
5. `kiro-submit-password`
6. `kiro-complete-register-consent`
7. `kiro-start-desktop-authorize`
8. `kiro-complete-desktop-authorize`
9. `kiro-upload-credential`

### 每一步的职责边界

#### 1. `kiro-open-register-page`

- 清理 Builder ID 相关 cookies
- 打开注册页
- 等待邮箱输入页可用

#### 2. `kiro-submit-email`

- 通过共享邮箱服务拿邮箱
- 返回注册页
- 填邮箱并继续
- 等待姓名页

#### 3. `kiro-submit-name`

- 生成或读取姓名
- 提交姓名
- 等待验证码页

#### 4. `kiro-submit-verification-code`

- 通过共享邮箱服务轮询验证码
- 提交验证码
- 等待密码页

#### 5. `kiro-submit-password`

- 使用共享账户密码逻辑
- 若为空则自动生成
- 提交密码
- 等待授权确认页

#### 6. `kiro-complete-register-consent`

- 处理“确认并继续 / 允许访问”
- 直到注册流程页面完成
- 确保 Builder ID 浏览器会话已经建立

#### 7. `kiro-start-desktop-authorize`

- 注册桌面 OIDC client
- 生成 PKCE
- 生成 `redirectUri`
- 构建 authorize URL
- 打开桌面授权页

#### 8. `kiro-complete-desktop-authorize`

- 处理桌面授权页上的：
  - 可能的邮箱重输
  - 可能的密码重输
  - 可能的 OTP
  - 可能的 consent
- 监听 localhost 回调 URL
- 提取 `code`
- 兑换 desktop token

#### 9. `kiro-upload-credential`

- 构建 `kiro.rs` payload
- 上传凭据
- 保存上传结果

### 设计说明

- Kiro 步骤数未来可以继续扩展
- 但扩展只能发生在 `data/step-definitions.js` 与 Kiro 自己的执行器里
- 不能再回到“每加一步都去全局散改”的模式

---

## 7.6 桌面端 OIDC 授权设计

## 7.6.1 为什么必须改成桌面授权

因为真正可用的 Kiro 凭据来源不是：

- device auth token

而是：

- desktop OIDC token

## 7.6.2 协议流程

新的桌面授权流程固定为：

1. `POST /client/register`
   - `grantTypes = ["authorization_code", "refresh_token"]`
   - `redirectUris = ["http://127.0.0.1:<port>/oauth/callback"]`
   - `issuerUrl = "https://view.awsapps.com/start"`

2. 生成：
   - `state`
   - `codeVerifier`
   - `codeChallenge`

3. 打开：

```text
https://oidc.us-east-1.amazonaws.com/authorize?... 
```

4. 在浏览器中完成授权

5. 捕获：

```text
http://127.0.0.1:<port>/oauth/callback?code=...&state=...
```

6. 后台调用：

```text
POST /token
grantType=authorization_code
```

7. 得到：

- `accessToken`
- `refreshToken`

## 7.6.3 为什么不启本地回调 HTTP 服务

扩展环境下，最稳妥的做法不是开本地 HTTP 服务，而是：

- 直接监听浏览器导航事件
- 在导航命中 localhost callback 时截获 URL

原因：

- 扩展天然擅长标签页和导航监听
- 不需要额外守护进程
- 不会引入端口占用、进程残留、权限管理等复杂度

## 7.6.4 必须处理的桌面授权页状态

桌面授权页内容脚本必须能识别：

- `relogin_email`
- `relogin_password`
- `otp_page`
- `consent_page`
- `redirecting`
- `callback_error`
- `success`

它不能再复用当前注册页 `content/kiro-device-auth-page.js` 的状态机，因为那套状态机只覆盖注册页面，不覆盖桌面端 authorize 页。

---

## 7.7 上传到 `kiro.rs` 的数据设计

建议最终上传 payload 为：

```json
{
  "refreshToken": "...",
  "authMethod": "idc",
  "clientId": "...",
  "clientSecret": "...",
  "region": "us-east-1",
  "authRegion": "us-east-1",
  "apiRegion": "us-east-1",
  "machineId": "...",
  "email": "...",
  "proxyUrl": "...",
  "proxyUsername": "...",
  "proxyPassword": "..."
}
```

### 明确说明

- **上传 `refreshToken / clientId / clientSecret`**
- **不上传 `profileArn`**
- **不上传 web token**
- **不上传 session token**
- `clientIdHash` 只作为内部附加信息保留，不参与 `kiro.rs` 新增接口

## 7.7.1 `machineId` 生成策略

建议直接采用与 `kiro.rs` 当前默认逻辑一致的确定性算法：

```text
sha256("KotlinNativeAPI/" + refreshToken)
```

这样做的优点：

- 与 `kiro.rs` 默认生成逻辑一致
- 不依赖本地随机 UUID
- 重试上传时稳定
- 不需要单独维护本地 machineId 持久化

---

## 7.8 日志与错误态设计

Kiro 新链路必须有自己的错误态，不允许继续复用 OpenAI 语义。

### 必须单独定义的错误类别

- 注册页 CloudFront 403
- 注册页卡死 / 页面未切换
- 桌面授权页要求重登
- 桌面授权页 OTP 超时
- localhost callback 未捕获
- callback state 不匹配
- token 兑换失败
- `kiro.rs` 上传失败

### 日志要求

- Kiro 相关日志全部使用清晰中文
- touched Kiro 文件不得继续复制现有乱码字符串
- 注册步骤与桌面授权步骤日志分层输出

---

## 7.9 自动运行 / 重置 / 状态回写设计

Kiro 重构后，以下几类逻辑必须从“全局写死”改为“由 Kiro 模块自己提供”：

### 需要 Kiro 模块自带的能力

- `buildFreshKeepState()`
- `buildDownstreamResetPatch(stepKey)`
- `extractPersistableRuntimeState()`
- `applyNodeCompletionPayload(payload)`

### 这样做的目的

避免后续每改 Kiro 一步，都还要同时去改：

- `background.js`
- `runtime-state.js`
- `auto-run-controller.js`
- `handleNodeData`

全局层只做：

- 调用 Kiro 模块导出的能力
- 不再理解 Kiro 内部字段细节

---

## 8. 方案完整性与正确性自审

## 8.1 是否符合当前需求

符合，原因如下：

1. Kiro 被当作独立 flow 设计
2. 只保留用户要求的公共项：邮箱服务、IP 代理、账户密码
3. 最终目标明确是上传到 `kiro.rs`
4. 当前不做验活，已显式纳入边界

## 8.2 是否完整

完整，已覆盖：

- UI 选择器语义
- settings schema
- runtime state
- steps
- content script
- background runner
- auto-run
- upload payload
- 测试
- 文档更新

## 8.3 是否存在上下设计冲突

当前方案内部无冲突，关键原因：

- “注册页流程”与“桌面授权流程”已经拆成两个页面域
- “targetId”与“runtime source”已经拆开，不再混名
- “共享服务”与“Kiro 业务流程”已分层

## 8.4 是否存在潜在缺陷

存在以下实现风险，但均可控：

### 风险 1：localhost callback 捕获时序问题

解决方式：

- 监听 `chrome.webNavigation` 事件
- 严格按 `host=127.0.0.1`、`port`、`path`、`state` 匹配
- 捕获成功后立即关闭授权标签页

### 风险 2：桌面授权页可能再次要求 OTP

解决方式：

- 步骤 8 继续复用共享邮箱服务
- 不能假设注册页 OTP 用完后桌面授权一定不再要 OTP

### 风险 3：现有仓库 Kiro 文档和测试已过期

解决方式：

- 本次重构最终阶段必须同步清理旧文档与旧测试
- 不允许“代码换了、文档没换”

### 风险 4：乱码继续扩散

解决方式：

- Kiro touched files 全部重新写清晰中文
- 每个阶段结束后搜索 touched files 中是否出现乱码模式

---

## 9. 明确拒绝的方案

以下方案明确不采用：

## 9.1 在当前 `kiro-device-auth.js` 上继续补丁

原因：

- 协议方向错了
- 模块职责已经过载
- 再补只会更乱

## 9.2 保留旧 device auth，再并排加 desktop auth

原因：

- 双协议并存，维护复杂度成倍增加
- 以后排障会非常混乱

## 9.3 给当前上传逻辑补 `profileArn`

原因：

- `kiro.rs` 新增凭据接口本身不接这个字段
- 不是根因修复

## 9.4 继续使用 `kiroSourceId`，只在注释里解释

原因：

- 命名本身已经错了
- 以后会持续误导维护者

## 9.5 为了兼容旧代码保留别名字段

原因：

- 用户已明确要求不做兼容
- 别名只会增加未来维护成本

---

## 10. 分阶段开发清单

下面的开发清单按“每一阶段完成后必须自检，再进入下一阶段”的方式设计。

## 阶段 1：修正 flow 合同与 Kiro 命名

### 目标

- 完成 `flow-registry / settings-schema / sidepanel` 的 Kiro 合同修正
- 去掉 `kiroSourceId` 语义
- 引入正式 `targetId`

### 开发项

1. 在 flow registry 中补齐完整 target 合同
2. sidepanel 通用选择器从 source 语义改为 target 语义
3. settings schema 中将 Kiro 目标配置改为 `flows.kiro.targetId + targets`
4. 删除 Kiro 对 legacy fallback 的依赖

### 阶段自检

- 搜索 touched files，不应再出现 `kiroSourceId`
- 搜索 touched files，不应再出现通过 fallback 猜 `kiro-rs` 的逻辑
- `flow-registry / settings-schema / sidepanel` 的 Kiro 合同必须一一对应
- 不能出现“UI 读一个字段、schema 写另一个字段”
- touched files 无乱码

### 本阶段建议测试

- `tests/flow-registry-settings-schema.test.js`
- `tests/flow-capabilities-module.test.js`
- `tests/sidepanel-flow-source-registry.test.js`

---

## 阶段 2：重建 Kiro 运行态模型

### 目标

- 把 Kiro 运行态改成独立命名空间
- 把 Kiro 重置、回写、keep-state 逻辑从全局硬编码里抽出

### 开发项

1. 新建 `background/kiro/state.js`
2. 定义 `kiroRuntime` 初始值
3. 定义 Kiro 下游重置规则
4. 定义 Kiro payload 回写规则
5. 接管 auto-run fresh keep-state 中的 Kiro 部分

### 阶段自检

- `background.js` 中不应再手写大段 Kiro 字段白名单
- `handleNodeData` 不应再枚举 Kiro 20 多个字段
- `runtime-state.js` 不应继续维护旧 device auth 结构
- Kiro 状态读取路径前后一致
- touched files 无乱码

### 本阶段建议测试

- `tests/auto-run-kiro-flow-selection.test.js`
- Kiro runtime state 新测试

---

## 阶段 3：重建 Kiro 注册页步骤 1-6

### 目标

- 将当前注册页逻辑拆成 Kiro 注册子模块
- 保留正确的页面动作，但去掉 device auth 轮询语义

### 开发项

1. 新建 `content/kiro/register-page.js`
2. 新建 `background/kiro/register-runner.js`
3. 迁移 cookie 清理
4. 迁移邮箱 / 姓名 / OTP / 密码 / consent 编排
5. 将步骤 6 改为“完成注册会话”，不再轮询 device token

### 阶段自检

- 注册页 content script 只处理注册页，不处理桌面授权页
- 步骤 6 不应再依赖 `deviceCode`
- Kiro 注册完成后，必须保留浏览器 Builder ID 会话
- 邮箱服务仍然通过共享能力获取
- 账户密码仍然通过共享能力获取
- touched files 无乱码

### 本阶段建议测试

- 拆分后的 Kiro register runner 单测
- 页面状态识别单测

---

## 阶段 4：实现桌面端 PKCE 授权步骤 7-8

### 目标

- 真正获取桌面端 Kiro 凭据

### 开发项

1. 新建 `background/kiro/desktop-client.js`
2. 实现 client register / PKCE / authorize URL / token exchange
3. 新建 `content/kiro/desktop-authorize-page.js`
4. 新建 `background/kiro/desktop-authorize-runner.js`
5. 实现 localhost callback URL 捕获

### 阶段自检

- 全仓不得再有 Kiro device auth token 轮询主链路
- Kiro desktop auth 必须输出：
  - `clientId`
  - `clientSecret`
  - `refreshToken`
  - `accessToken`
- callback URL 必须校验 `state`
- 桌面授权页如出现二次 OTP，必须能继续走邮箱服务
- touched files 无乱码

### 本阶段建议测试

- 桌面 client 注册单测
- callback 捕获单测
- token exchange 单测
- 桌面授权页状态机单测

---

## 阶段 5：重写 `kiro.rs` 发布器

### 目标

- 上传正确的 desktop credential
- 删除旧 Kiro 隐形配置面

### 开发项

1. 新建 `background/kiro/publisher-kiro-rs.js`
2. 固化 payload 结构
3. 生成确定性 `machineId`
4. 删除 `kiroRsPriority / Endpoint / AuthRegion / ApiRegion` 旧入口

### 阶段自检

- 上传器不应再读取隐藏旧字段
- 上传器不应再发送 `profileArn`
- 上传器只接收桌面端 token bundle
- `kiro.rs` payload 字段与 `AddCredentialRequest` 一致
- touched files 无乱码

### 本阶段建议测试

- 发布器 payload 构建单测
- 上传成功 / 失败响应处理单测

---

## 阶段 6：更新步骤定义、sidepanel 展示与自动运行接线

### 目标

- 让新的 9 步 Kiro workflow 在 UI、自动运行、状态展示中闭环

### 开发项

1. 更新 `data/step-definitions.js`
2. 更新 Kiro 运行态显示项
3. 更新自动运行 step range 默认值
4. 更新 Kiro 节点注册表

### 阶段自检

- 步骤顺序、节点注册、自动运行首节点三者一致
- sidepanel 展示的 Kiro 运行态字段必须来自新 `kiroRuntime`
- flow 切换后不应回退到 OpenAI flow
- touched files 无乱码

### 本阶段建议测试

- `tests/step-definitions-module.test.js`
- `tests/background-step-registry.test.js`
- `tests/sidepanel-auto-run-content-refresh.test.js`

---

## 阶段 7：清理旧代码、旧测试、旧文档

### 目标

- 移除旧 Kiro device auth 方案残留
- 让仓库说明文档重新与代码一致

### 开发项

1. 删除旧 `background/steps/kiro-device-auth.js`
2. 删除旧 `content/kiro-device-auth-page.js`
3. 删除旧 device auth 测试
4. 更新：
   - `项目完整链路说明.md`
   - `项目文件结构说明.md`
   - 其他 Kiro 相关说明

### 阶段自检

- 搜索仓库，不应再有 Kiro device auth 主链路残留
- 搜索仓库，不应再有旧 3 步 Kiro 文档
- 搜索仓库，不应再有 `kiro-await-device-login`
- 搜索仓库，不应再有 `kiroSourceId`
- touched files 无乱码

---

## 阶段 8：最终全面审查

### 目标

- 在提交前做一次系统级收口

### 全面审查项

1. Kiro 是否仍与 OpenAI 业务逻辑耦合
2. 是否还有旧字段 / alias / fallback
3. 是否还有状态命名冲突
4. 是否还有文档与代码不一致
5. 是否还有 Kiro touched files 中文乱码
6. 是否还有测试命名与真实步骤不一致

### 提交前必须满足

- 设计闭环
- 代码闭环
- 测试闭环
- 文档闭环

---

## 11. 最终判断

这个重构方案是**符合要求、完整、正确、规范一致**的，原因如下：

1. 它从根因出发，修的是协议，不是表面页面动作
2. 它把 Kiro 作为独立系统重建，而不是塞进 OpenAI 的旧壳里
3. 它没有引入兼容层、别名层、回退层
4. 它把设置、运行态、页面驱动、上传器、自动运行、自检标准全部纳入同一张图
5. 它提前识别了与本功能“看似无关但实际关联”的区域：
   - flow registry
   - settings schema
   - sidepanel selector
   - auto-run keep-state
   - background node payload 回写
   - 项目说明文档

如果后续严格按本方案分阶段开发，并且每一阶段都执行文档中的自检清单，那么最终代码可以做到：

- 结构稳定
- 边界清晰
- 后续继续加新 flow 时不会再回到现在这种混乱状态

