# YOO 图床

基于腾讯 EdgeOne Makers（Edge Functions + Blob Storage）的个人图床。前端是三个静态页，后端是两个函数路由。

线上地址：<https://yooy.cc.cd> · 管理后台：`/upload.html` · API 文档：`/api.html`

## 目录结构

```txt
.
├── edge-functions/
│   ├── api/[[default]].js     # /api/*  控制面：签名地址、中转上传、列表、元信息、删除、健康检查
│   └── i/[[default]].js       # /i/*    图片 serve：把字节从存储读出来吐回给访问者
├── index.html                 # 首页
├── upload.html                # 管理后台（上传 / 列表 / 复制 / 删除）
├── api.html                   # API 文档
├── script.js                  # 前端逻辑，被上面三个页面共用
├── styles.css                 # 主题、布局、明暗切换
├── .well-known/               # 域名校验文件，别删
└── package.json
```

只有一个运行时（Edge Functions），没有 `cloud-functions/`。原因见下面「为什么不需要 Cloud Functions」。

## 两个必须先理解的事实

这两条决定了整个设计，跟直觉相反，所以写在最前面。

### 1. Blob 存储没有任何公开读取地址

官方文档原话：

> Blob 面向 Makers Functions 的运行时数据需要（如读写、查询、加工），**不建议作为公网图床或 CDN 使用**。

SDK 的全部方法里也没有 `getDownloadUrl` 之类的东西，而 `createUploadUrl` 签出来的地址被绑死成只能 `PUT`，拿来 `GET` 会 403。

**结论**：`https://域名/<key>` 这种链接不可能成立（实测 404）。图片必须由一个函数路由把字节读出来再吐回去。这就是 `/i/` 路由存在的原因，也是你的图片链接的真正形态：

```txt
https://yooy.cc.cd/i/2026/08/6f20444f3562-demo.png
                 └key──────────────────────────┘
```

### 2. Edge 的 1MB 限制只管「进来的」，不管「出去的」

平台限制表：

| 运行时 | 请求体 | 响应体 | CPU / 执行时长 |
| --- | --- | --- | --- |
| Edge Functions | 1 MB | **文档未设上限** | 200ms CPU（不含 I/O 等待） |
| Cloud Functions | 6 MB | **6 MB**（有专属错误码 `500 CLOUD_FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE`） | 默认 30s，最大 120s |

实测：一张 2.6MB 的原图经 `/i/` 返回，**逐字节与原件一致**，耗时 0.85s。

**结论**：往外发大图放在 Edge 反而比 Cloud 更宽松——Cloud 有硬性的 6MB 响应上限。所以整个后端只用 Edge Functions，不需要 Cloud Functions，也顺带避开了两个运行时抢同一条 `/api/*` 路由的未定义行为（官方模板自己的做法就是给两个运行时各分一个不重叠的路径前缀）。

## 上传：两条路

文件要进存储，区别只在**字节是否经过边缘函数**。

| | 压缩中转 | 原图直传 |
| --- | --- | --- |
| 路径 | `PUT/POST /api/upload` | `POST /api/upload-url` → 客户端 `PUT` |
| 谁送字节进存储 | 函数 | 浏览器 |
| 上限 | 950KB | 20MB（存储单值 25MB） |
| 格式 | 仅图片 | **任意** |
| 是否压缩 | 超限自动压 | 原图字节，不动 |
| 典型用途 | 脚本、`curl` 一行传小图 | 网页端传手机原图、HEIC、大图 |

直传时字节不路过函数，所以 1MB 那个请求体上限压根不会被触发——这是能传大图的唯一办法。

### 中转的前端压缩逻辑

`script.js` 的 `compressToLimit()` 用 canvas 逐步降尺寸和质量，压到 950KB 以下再上传。**GIF 和 SVG 不压**：canvas 会让 GIF 丢动画、让 SVG 变成栅格图，这两种超限时提示改用直传。

## 配置

改代码里两处即可，两边必须一致：

```js
const STORE_NAME = 'yoo-images';   // edge-functions/api/[[default]].js
const STORE_NAME = 'yoo-images';   // edge-functions/i/[[default]].js
```

存储桶**不需要预先创建**，`getStore()` 首次写入时自动建（已实测：`/api/health` 对新桶名返回 `storage.ok: true`）。

函数内部 `getStore()` 自动鉴权，**不需要 API token**。只有从 EdgeOne 之外访问存储时才需要 `projectId` + token。

图片域名不写死——serve 与所有返回的链接都用 `new URL(request.url).origin`，所以预览域名下也能得到正确链接。

## API

全部返回 JSON（除 `/i/`），字段含义与 curl 示例见 `/api.html`，那里每条都实测过。

```txt
POST   /api/upload-url   直传第一步：换取签名 PUT 地址     ≤20MB · 任意格式
PUT    /api/upload        中转：原始字节（?name=xxx.png）   ≤950KB · 仅图片
POST   /api/upload        中转：multipart/form-data        ≤950KB · 仅图片
GET    /i/<key>           图片本体，即你要分享的链接        ?download=1 转为下载
GET    /api/list          列表（limit / cursor / detail / all）
GET    /api/meta          单个对象的存储元信息
GET    /api/health        存储可达性 + 各路径上限
DELETE /api/delete        删除（?key= 或 ?url=）
```

一条命令传图：

```bash
curl -X PUT "https://yooy.cc.cd/api/upload?name=demo.png" \
  -H "Content-Type: image/png" --data-binary @demo.png
```

## 部署

推 `main` 到 GitHub，EdgeOne Pages 自动构建。函数依赖由 `package.json` 安装，`node_modules/` 不入库。

上线后第一件事打健康检查，能立刻区分「代码没部署上去」和「存储不通」：

```bash
curl https://yooy.cc.cd/api/health
```

## 写这个仓库时踩到的坑

`@edgeone/pages-blob` 的类型定义（`dist/index.d.ts`）是唯一可靠的依据，文档和直觉在这里都会骗人。下面这些全部是实测崩过的：

| 误用 | 真实情况 |
| --- | --- |
| `file instanceof File` | Edge 运行时**没有 `File` 全局对象**，直接 `ReferenceError`。改用鸭子类型 `typeof file.arrayBuffer === 'function'` |
| `store.set(key, new Uint8Array(...))` | `BlobInput` 只接受 `string \| ArrayBuffer \| Blob \| ReadableStream`。要传 `ArrayBuffer` |
| `store.set(key, buf, { contentType })` | `SetOptions` 里**没有 `contentType`**，被静默丢弃。Content-Type 只能在 serve 路由上决定 |
| `store.head(key)` | 不存在，真实方法是 `getMetadata()`。这个 bug 会让删除对任何文件都返回 404 |
| `store.list({ limit, cursor })` | 默认 `paginate: true` 时自动聚合全部页且**不返回 cursor**，分页永远是假的。必须显式 `paginate: false` |
| 从 `list()` 结果里读 `size` | `BlobInfo` 只有 `{ key, etag }`。要大小只能逐项 `getMetadata()`（即 `?detail=1`） |
| 用默认句柄查「文件还在不在」 | 默认是 `eventual`（最终一致）的读，SDK 文档说明这类读可能给出不新鲜的结果。判存在统一走 `getStore({ name, consistency: 'strong' })`，宁可多花一次强一致读也不谎报存在 |
| 给图片响应打 `max-age=31536000, immutable` | 边缘节点会缓存一年，于是**删掉的图还能继续访问一年**。实测删除一个被反复请求过的链接：后续 6 次请求全部仍返回 200（边缘副本），而 `/api/meta` 已经是 404（源站真的删掉了）。官方文档确认 Makers **没有从函数内部刷新指定 URL 边缘缓存的能力**，所以 `max-age` 就等于删除延迟本身。现值收敛成 `public, max-age=3600`，并去掉 `stale-while-revalidate` / `immutable`（那两个会把窗口拖到近一天、还禁止过期后回源校验） |
| 以为签名直传失败能拿到 403 | 拿 `uploadUrl` 去 `GET` 确实有干净的 403 `SignatureDoesNotMatch`；但**被拒的写**（Content-Type 与签名不符 / 方法不是 PUT / 签名被动过）会被存储网关直接掐断连接：HTTP/2 下是 stream `INTERNAL_ERROR`，curl 记 `000`。不变量是「写入没成功、存储里不留痕」，但错误信号是连接级别的，客户端要按失败处理并重签 |

另有一条平台注意事项：平台的默认预览域名有内容合规限制（预览链接 3 小时过期、大陆访问可能 401），所以这个站点绑了自定义域名。
