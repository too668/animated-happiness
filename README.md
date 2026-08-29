# EdgeOne Blob Storage 图床接口文档

这是一个基于 EdgeOne Makers Functions 的图片上传接口，适合快速搭建自己的图床服务。上传成功后，返回图片的公开访问 URL。

## 1. 功能概览

- 支持上传二进制图片
- 支持上传 Base64 图片
- 支持 multipart/form-data 上传
- 自动写入 EdgeOne Blob Storage
- 返回可直接访问的图片 URL

## 2. 接口地址

```txt
POST /api/upload
```

如果你在 EdgeOne Pages 中部署了该函数，实际访问地址一般为：

```txt
https://your-project.pages.dev/api/upload
```

## 3. 请求方式

### 方式 A：Base64 JSON

```bash
curl -X POST "https://your-project.pages.dev/api/upload" \
  -H "Content-Type: application/json" \
  --data '{
    "filename":"demo.png",
    "base64":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
  }'
```

### 方式 B：multipart/form-data

```bash
curl -X POST "https://your-project.pages.dev/api/upload" \
  -F "file=@/path/to/image.png"
```

### 方式 C：直接二进制流

```bash
curl -X POST "https://your-project.pages.dev/api/upload" \
  -H "Content-Type: image/png" \
  --data-binary @image.png
```

## 4. 请求参数

### JSON 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| filename | string | 否 | 文件名，可用于生成保存文件名 |
| base64 | string | 是 | Base64 图片内容，支持 data:image/...;base64, 前缀 |
| contentType | string | 否 | 图片 MIME 类型，如 image/png |

### multipart/form-data 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| file | file | 是 | 图片文件 |
| image | file | 是 | 可兼容 image 字段名 |
| upload | file | 是 | 可兼容 upload 字段名 |

## 5. 成功返回

```json
{
  "ok": true,
  "message": "Image uploaded to EdgeOne Blob Storage",
  "key": "images/2026-08-29/1724900000000-demo.png",
  "uploadUrl": "https://.../images/2026-08-29/1724900000000-demo.png?sig=...",
  "url": "https://.../images/2026-08-29/1724900000000-demo.png"
}
```

### 返回字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| ok | boolean | 是否成功 |
| message | string | 成功提示 |
| key | string | Blob 中的存储 key |
| uploadUrl | string | 签名上传地址 |
| url | string | 公开访问 URL |

## 6. 错误返回

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

## 7. 适用场景

- 个人博客图片托管
- 轻量图床服务
- 在线文档或论坛图片上传
- 需要快速生成图片 URL 的前端业务

## 8. 技术实现说明

该接口使用 EdgeOne Blob Storage 的官方 SDK：

```js
import { getStore } from '@edgeone/pages-blob';
```

流程如下：

1. 接收请求
2. 解析图片内容
3. 生成 Blob key
4. 调用 `createUploadUrl()` 生成签名上传地址
5. 使用 `fetch(uploadUrl, { method: 'PUT', body: fileBuffer })` 上传
6. 返回图片访问地址

## 9. 目录结构

```txt
.
├── cloud-functions/
│   └── api/
│       └── upload.js
├── edge-functions/
│   └── api/
│       └── upload.js
├── package.json
├── README.md
└── node_modules/
```

## 10. 备注

这个方案相比 GitHub 方案更适合直接部署到 EdgeOne Makers：

- 更贴合 EdgeOne 生态
- 不需要自行维护 GitHub token
- 更适合作为轻量图床
- 直接返回可访问的图片 URL

如果你需要，我还可以继续补一份：

- 前端 JavaScript 调用示例
- Vue / React 上传组件示例
- 一个完整的 HTML 上传页面示例
