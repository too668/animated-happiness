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

### 第二批（commit 即将推送）
- 所有 fetch 加统一超时（8s，防上游挂起）
- deploy.yml 从空壳改为真实语法检查 CI
- albums POST 的 path/storage 参数校验

## 待办

### 1. 代码质量（未做，需先验证 EdgeOne 支持本地 import）
- ⚠️ 已查证：官方示例（pages-templates）的 edge-functions 均为单文件自包含，只 import npm 包，无本地相对 import 先例
- 抽公共 SigV4 模块存在不被打包/被当路由的风险，**不建议做**
- 建议保持现状：两文件重复约 60 行签名代码，改动低频，风险可控

### 2. 可选优化
- `/i/` 防盗链（Referer 白名单或签名 URL），防他人盗链烧流量
- 登录防爆破的计数存储可加过期清理任务
- 大文件夹删除/重命名是串行逐条请求，量大时可改 S3 批量删除（DeleteObjects，一次最多 1000）
- `s3ListAll` 上限 10000 条，超出会截断，需按需调整
- 相册（albums）目前仅数据库记录，前端 photos.html/browser.html 有入口但功能不完整，需确认产品目标

## 部署注意
- 环境变量在 EdgeOne 控制台配置（ADMIN_PASSWORD / SUPABASE_URL / SUPABASE_SECRET_KEY / IDRIVE_*），不在代码里
- 新增了独立存储 `yoo-internal`（登录限流用），首次写入自动建桶
