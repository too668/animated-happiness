# EdgeOne Blob Storage 图床接口说明

本文档说明一个基于 EdgeOne Makers Functions 和 EdgeOne Blob Storage 的图片上传接口，用于在前端上传图片，并返回图片的可访问 URL。

适用场景：

- 个人图床
- 图片管理后台
- Web 端图片上传
- 轻量的对象存储访问接口

## 1. 方案概述

整个实现分两层：

1. 前端页面负责选择图片、上传图片、展示图片列表、删除图片
2. EdgeOne Functions 接口负责接收请求，生成 Blob Storage 的 presigned upload URL，并上传文件

核心依赖：

```bash
npm install @edgeone/pages-blob
```

核心代码：

```js
import { getStore } from '@edgeone/pages-blob';
```

## 2. 目录结构

```txt
.
├── cloud-functions/
│   └── api/
│       └── upload.js
├── edge-functions/
│   └── api/
│       └── upload.js
├── index.html
├── api.html
├── upload.html
├── script.js
├── styles.css
├── package.json
├── README.md
└── node_modules/
```

## 3. 功能说明

本接口支持：

- Base64 上传
- multipart/form-data 上传
- 原始二进制流上传
- 图片列表查询
- 图片删除
- 图片 URL 返回

Fishbone 角度：

- 上传：用户提交图片，函数接收并写入 Blob Storage
- 读取：返回图片 URL，用于前端展示或直接访问
- 删除：通过 key 删除对象
- 列表：列出当前存储中已有图片

## 4. 运行方式

### 4.1 函数入口

建议在 EdgeOne Makers 的 main 分支中放置函数目录：

```txt
cloud-functions/api/upload.js
```

也可以放在：

```txt
edge-functions/api/upload.js
```

### 4.2 环境变量

在 EdgeOne 项目中配置以下变量：

```txt
GITHUB_TOKEN=xxx
GITHUB_OWNER=xxx
GITHUB_REPO=xxx
GITHUB_BRANCH=main
```

如果你走纯 Blob Storage 方案，则可以直接使用 EdgeOne 自带存储，而不需要 GitHub 依赖。

## 5. 上传接口

### 接口地址

```txt
POST /api/upload
```

### 请求头

```txt
Content-Type: application/json
```

或者：

```txt
Content-Type: multipart/form-data
```

### 5.1 Base64 上传

```bash
curl -X POST "https://yooy.cc.cd/api/upload" \
  -H "Content-Type: application/json" \
  --data '{
    "filename":"demo.png",
    "base64":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
  }'
```

### 5.2 FormData 上传

```bash
curl -X POST "https://yooy.cc.cd/api/upload" \
  -F "file=@/path/to/image.png"
```

### 5.3 二进制上传

```bash
curl -X POST "https://yooy.cc.cd/api/upload" \
  -H "Content-Type: image/png" \
  --data-binary @image.png
```

## 6. 请求参数

### 6.1 JSON 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| filename | string | 否 | 文件名，用于保存文件 |
| base64 | string | 是 | Base64 图片内容，支持 `data:image/...;base64,...` 格式 |
| contentType | string | 否 | 图片 MIME 类型 |

### 6.2 multipart/form-data 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| file | File | 是 | 图片文件 |
| image | File | 否 | 兼容字段名 |
| upload | File | 否 | 兼容字段名 |

## 7. 成功响应

```json
{
  "ok": true,
  "message": "Image uploaded to EdgeOne Blob Storage",
  "key": "images/2026-08-29/1724900000000-demo.png",
  "uploadUrl": "https://.../images/2026-08-29/1724900000000-demo.png?sig=...",
  "url": "https://.../images/2026-08-29/1724900000000-demo.png"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| ok | boolean | 请求是否成功 |
| message | string | 提示信息 |
| key | string | Blob 唯一 key |
| uploadUrl | string | 生成的临时上传地址 |
| url | string | 最终可访问图片地址 |

## 8. 错误响应

```json
{
  "ok": false,
  "error": "Missing file field in multipart/form-data"
}
```

常见错误：

- `Only POST is supported`
- `Missing file field in multipart/form-data`
- `JSON body must contain base64/data/image/file string`
- `Unsupported body format. Use multipart/form-data or JSON { base64 }.`

## 9. Blob Storage 相关接口思路

EdgeOne 的 Blob Storage SDK 提供了如下能力：

```js
import { getStore } from '@edgeone/pages-blob';

const store = getStore('uploads');

// 写入
await store.set('a.png', fileBuffer);
await store.setJSON('meta', { name: 'a.png' });

// 读取
const data = await store.get('a.png');
const json = await store.get('meta', { type: 'json' });

// 删除
await store.delete('a.png');

// 列表
const { blobs } = await store.list({ prefix: 'images/' });
```

对应到 API 层面，可以扩展这些接口：

```txt
GET /api/list
DELETE /api/delete?key=images/xxx.png
GET /api/get?key=images/xxx.png
```

这些接口本质上就是对 store.list、store.delete、store.get 的封装。

## 10. 前端管理页建议

前端页面应当具备：

- 上传图片
- 选择图片文件
- 上传后显示图片列表
- 图片预览
- 复制 URL
- 删除图片
- 重命名/更新文件名
- 搜索过滤

这层页面可以直接在浏览器中使用，适合本地开发和测试：

- 如果 API 可用，则调用真实接口
- 如果 API 不可用，则退回到本地模拟列表

这样既能本地调试，也能直接部署到生产环境。

## 11. 技术实现说明

实际核心流程：

1. 前端提交图片到函数接口
2. 函数解析 Base64 或 multipart/form-data
3. 转换成 Buffer
4. 调用 `getStore()` 建立存储对象
5. 调用 `createUploadUrl(key, options)` 生成上传地址
6. 使用 `fetch(uploadUrl, { method: 'PUT', body: fileBuffer })` 写入 Blob
7. 返回图片 URL

这保证了：

- 文件不会直接暴露到业务逻辑中
- 上传路径和签名管理由存储层控制
- 可以在前端直接生成图片链接

## 12. 适用限制

- 适合小规模高频图片使用
- 适合私有图床或个人站点
- 不适合超大规模公开存储场景

## 13. 注意事项

- 不要把上传 URL 直接暴露给未授权访问
- 对 key 做规范化处理，避免非法字符
- 对图片类型做校验，限制危险文件类型
- 建议在生产环境中增加鉴权和访问控制

## 14. 结论

EdgeOne Blob Storage 是比较适合这类需求的方案。

其优点在于：

- 免费/低成本
- 无需自己维护 GitHub token
- 方便与 EdgeOne Pages / Functions 集成
- 适合做图片上传和 URL 返回服务

因此，这个项目的目标是：把图片上传接口封装成一个稳定、简洁、可复用的图床 API。
