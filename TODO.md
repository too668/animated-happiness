# TODO / 待办方案

> 2026-09-04 已完成一批安全与健壮性修复并推送（commit 2a2b69a）。
> 以下为剩余事项，按优先级排列。

## 已完成

### 第一批（commit 2a2b69a）
- 删除 `force-clean` 高危接口（含认证绕过）
- `/api/albums` GET/POST/DELETE 补权限校验（list/upload/delete）
- SVG 存储型 XSS 防护（强制下载 + CSP sandbox）
- S3 出图改流式转发（防 5GB 文件 OOM）
- S3 列表分页（IsTruncated + continuation token），列表接口改单页+游标
- 文件夹删除/重命名防丢文件（全量遍历 + 游标翻页）
- S3 路径 URI 编码 + XML 实体解码
- 文件夹名校验收紧为安全字符集
- 登录防爆破（按 IP 限流，独立存储 yoo-internal）
- 错误信息不再透传内部细节
- API key 列表前缀修正、前端翻页带 storage、总数显示

### 第二批（commit 0ec3f64）
- 所有 fetch 加统一超时（8s，防上游挂起）
- deploy.yml 从空壳改为真实语法检查 CI
- albums POST 的 path/storage 参数校验

### 第三批（本次优化与修复）
- **核心修复**：修复 `script.js` 中 `currentMode` 作用域问题导致的 `ReferenceError` 运行时报错（上传功能恢复）
- **核心修复**：修复 `browser.html` 中「复制副本」含空格与中文导致后端 `isValidKey` 400 报错（改用标准 `-copy` 后缀）
- **核心修复**：修复 `browser.html` 中批量与单文件移动 S3 文件丢失 `uploads/` 前缀导致后续出图 404
- **核心修复**：修复 `gallery.html` 中 S3 文件数显示为 `undefined`，API 统一补齐 `total`、`storage` 字段
- **安全与健壮性**：修复 `/api/delete` S3 删除接口提取 key 未过滤 `yoo_` API key 且缺少 `isValidKey` 格式校验
- **出图修复**：修复 `/i/` 正则对单字符文件名（如 `1.png`、`a.jpg`）误判 404
- **跨域与标准**：`/i/` 出图路由增加完整 CORS 支持与 OPTIONS 预检（`Access-Control-Allow-Origin: *`），支持博客/Canvas跨域引用
- **缓存性能**：`/i/` 增加完整的 ETag / `If-None-Match` 校验，命中时返回 HTTP 304，极大节省带宽与边缘节点流量
- **签名修复**：`/i/` 补齐 S3 SigV4 请求路径的规范化 URI 编码（`awsPathEncode`），与控制面保持一致
- **性能飞跃**：实现 S3 批量删除（`s3DeleteObjects` XML 单次最多删 1000 项），彻底告别串行网络超时
- **并发加速**：Blob 文件夹删除与两端文件夹重命名加入分块并发处理（5~10 并发），大幅缩短处理时长
- **数据联动**：`POST /api/upload-url` 携带 `folder` 时自动同步写入 Supabase `folders` 表
- **体验优化**：前端一键复制增加 `execCommand` 兜底兼容；查看器增加「下载原图」按钮；管理后台原图直传上限随 S3 (5GB) / Blob (20MB) 动态显示；新建/重命名文件夹增加安全字符提示

## 待办

### 1. 代码质量（需 EdgeOne 支持本地 import 方可实施）
- 官方示例的 edge-functions 为单文件自包含，抽公共 SigV4 模块有构建风险，保持单文件自包含现状。

### 2. 可选后续规划
- `/i/` 防盗链（Referer 白名单或限时签名 URL）
- `s3ListAll` 上限 10000 条，如超大规模需对接分页流式处理
- 相册（albums）增加前端批量导入与排序自定义

## 部署注意
- 环境变量在 EdgeOne 控制台配置（ADMIN_PASSWORD / SUPABASE_URL / SUPABASE_SECRET_KEY / IDRIVE_*），不在代码里
- 新增了独立存储 `yoo-internal`（登录限流用），首次写入自动建桶
