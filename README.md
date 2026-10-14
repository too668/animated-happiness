# YOO · 私有云盘 / 网盘

基于腾讯 EdgeOne Functions 与 S3 (iDrive e2) / Blob 双引擎架构的高性能私有云盘系统。支持任意文件格式（文档、音视频、压缩包、安装包等）超大文件直传（最高 5GB~10GB）、树状目录管理、移动端多端适配与专属私有密钥隔离。

- **线上地址**：<https://yooy.cc.cd>
- **云盘文件管理器**：`/browser.html`
- **极速上传后台**：`/upload.html`
- **媒体相册视图**：`/photos.html`
- **API 接口文档**：`/api.html`

---

## 核心设计与特性

1. **极致轻量的前端架构**
   - **技术栈**：纯原生前端（Vanilla HTML5 + 现代化 CSS3 + ES6 原生 JavaScript），零框架（无 React/Vue/Webpack/Vite 构建负担），秒级首屏加载。
   - **极端兼容性（iOS 兼容优化）**：
     - 语法基准收敛在稳定 ES 标准，无可选链 `?.` 与空值合并 `??` 等会导致老版本 Safari（iOS <13.4）白屏崩溃的语法；
     - 针对老旧 WebKit（iOS 11~14）缺失的 `createImageBitmap`，内置基于 `new Image()` 与 `createObjectURL` 的无缝 Polyfill 回退机制；
     - 无论在新版手机还是老款 iPad/iPhone 上，皆能顺畅运行。

2. **超大容量与任意格式存储**
   - **不是图床，是真正的私有云盘**：全面解除图片后缀限制，支持 `.zip`, `.mp4`, `.pdf`, `.dmg`, `.iso`, `.apk` 等任意格式。
   - **S3 协议原生支持（iDrive e2）**：预置支持 5GB~10GB 超大文件客户端直接分片/签名直传（Presigned PUT），字节不路过中间函数，打通真实大文件上传通道。
   - **EdgeOne Blob 降级引擎**：内置 EdgeOne Blob 本地化存储，单文件支持最高 20MB 直传。

3. **隐私与权限隔离**
   - 多级鉴权：管理员独立密码会话隔离，支持生成多权限 API Key（上传、查看、删除）。
   - 外链分发防护：提供原文件直接下载（`?download=1`）及防盗链控制。

---

## 目录结构

```txt
.
├── edge-functions/
│   ├── api/[[default]].js     # /api/*  云盘控制面：S3直传签名、健康检查、目录管理、删除
│   └── i/[[default]].js       # /i/*    文件读取与分发服务：HTTP 304 缓存、ETag、范围请求
├── index.html                 # 网盘门户首页
├── browser.html               # 树状文件浏览器（文件管理、文件夹重命名、移动、批量操作）
├── upload.html                # 大文件直传中心（拖拽、批量、进度指示）
├── photos.html                # 媒体流与相册预览
├── gallery.html               # 存储概览与多媒体看板
├── api.html                   # 开放存储与管理 API 文档
├── script.js                  # 前端核心业务逻辑（全端老旧设备兼容、直传引擎、UI交互）
├── styles.css                 # 响应式布局与明暗主题
├── .well-known/               # 域名与SSL校验配置
└── package.json
```

---

## 存储引擎与上传能力

| 存储方式 | 存储上限 | 支持格式 | 上传机制 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **S3 兼容存储 (iDrive e2)** | **5GB ~ 10GB** | **任意文件** | 客户端 Presigned 直传 | 字节直接上传至 S3 节点，不占函数内存，专为大文件打造 |
| **Blob 签名直传** | **20MB** | **任意文件** | 客户端 `PUT` 临时授权地址 | 绕过边缘函数 1MB 请求体限制，适合中小文件 |
| **Blob 压缩中转** | 950KB | 仅图片 | 函数中转写入 | 适合轻量脚本或命令行快速小文件同步 |

---

## 快速配置

### 1. S3 兼容对象存储配置（以 iDrive e2 / MinIO 为例）
在 EdgeOne Pages / 函数控制台配置如下环境变量：
- `S3_ENDPOINT`：S3 终端节点（例如 `https://s3.ap-northeast-1.idrivee2.com`）
- `S3_REGION`：所属区域（如 `ap-northeast-1`）
- `S3_BUCKET`：存储桶名称（如 `yoo`）
- `S3_ACCESS_KEY_ID`：S3 Access Key
- `S3_SECRET_ACCESS_KEY`：S3 Secret Key

### 2. 元数据与权限数据库（Supabase）
API Key、树状目录及相册结构保存在 Supabase（PostgreSQL）：
- `SUPABASE_URL`：Supabase 项目 API URL
- `SUPABASE_SECRET_KEY`：Supabase Service Role Key

执行以下 SQL 完成数据表初始化：
```sql
create table if not exists api_keys (
  id          text primary key,
  secret_hash text unique not null,
  name        text not null default '未命名',
  perms       jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

create table if not exists folders (
  storage     text not null,
  path        text not null,
  parent_path text not null default '',
  primary key (storage, path)
);

create table if not exists albums (
  id         bigint generated always as identity primary key,
  storage    text not null,
  path       text not null,
  name       text,
  created_at timestamptz not null default now(),
  unique (storage, path)
);
```

---

## 核心接口说明

| 方法 | 路由 | 描述 |
| :--- | :--- | :--- |
| `GET` | `/api/health` | 实时探测 S3 可达性与 Blob 运行状态 |
| `POST` | `/api/upload-url` | 获取 S3 / Blob 签名直传地址（支持超大文件） |
| `GET` | `/api/list` | 分页与目录文件列表查询（支持 `folder`、`search`、`cursor`） |
| `GET` | `/i/<key>` | 文件下载与在线预览（带 `?download=1` 强制触发另存为） |
| `DELETE` | `/api/delete` | 文件与目录批量删除（已接入 S3 Multi-Object Delete） |
| `POST` | `/api/folders` | 新建、移动或重命名树状目录 |

---

## 部署与健康探测

推送到 GitHub `main` 分支后，EdgeOne Pages 将自动完成构建分发。

部署完成后，通过调用健康探针接口即可验证后端与 S3 对象存储的连通性：
```bash
curl https://yooy.cc.cd/api/health
```
响应示例：
```json
{
  "ok": true,
  "s3": {
    "configured": true,
    "accessible": true,
    "endpoint": "https://s3.ap-northeast-1.idrivee2.com",
    "region": "ap-northeast-1",
    "bucket": "yoo",
    "s3MaxBytes": 5368709120
  }
}
```
