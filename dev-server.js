// YOO 私有网盘本地局域网开发与预览服务
// 零外部依赖，使用 Node.js 原生 http/https/fs/path 模块
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8080;
const HOST = '0.0.0.0';
const BACKEND_TARGET = 'https://yooy.cc.cd';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // 1. 如果是 /api/* 或 /i/* 接口，反向代理到线上真实 EdgeOne / S3 后端
  if (pathname.startsWith('/api/') || pathname.startsWith('/i/')) {
    const targetUrl = new URL(pathname + reqUrl.search, BACKEND_TARGET);
    const headers = { ...req.headers, host: targetUrl.host };
    delete headers['accept-encoding']; // 简化流式转发，避免 gzip 解析损耗

    const proxyReq = https.request(targetUrl, {
      method: req.method,
      headers: headers
    }, (proxyRes) => {
      const respHeaders = { ...proxyRes.headers };
      // 关键修复：局域网使用 HTTP 访问，必须移除 Cookie 中的 Secure 标志，否则手机浏览器会静默拒绝保存登录 Cookie
      if (respHeaders['set-cookie']) {
        if (Array.isArray(respHeaders['set-cookie'])) {
          respHeaders['set-cookie'] = respHeaders['set-cookie'].map(c => c.replace(/;\s*Secure/gi, ''));
        } else if (typeof respHeaders['set-cookie'] === 'string') {
          respHeaders['set-cookie'] = respHeaders['set-cookie'].replace(/;\s*Secure/gi, '');
        }
      }
      console.log(`[API 代理] ${req.method} ${pathname} -> 状态码 ${proxyRes.statusCode}`);
      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[代理失败] ${req.method} ${pathname}:`, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '代理后端请求失败: ' + err.message }));
    });

    req.pipe(proxyReq);
    return;
  }

  // 2. 静态页面与前端资源处理
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.join(__dirname, relativePath);

  // 安全检查：防止目录遍历
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 尝试补齐 .html 后缀
      if (!path.extname(filePath)) {
        const htmlPath = filePath + '.html';
        if (fs.existsSync(htmlPath)) {
          filePath = htmlPath;
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
          return;
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 YOO · 私有云盘局域网服务已启动 (0.0.0.0:${PORT})`);
  console.log(`   本机访问: http://localhost:${PORT}/`);
  console.log(`   局域网手机访问: http://192.168.1.189:${PORT}/`);
  console.log(`   文件管理: http://192.168.1.189:${PORT}/browser.html`);
  console.log(`   手机图册: http://192.168.1.189:${PORT}/photos.html`);
  console.log(`   大文件上传: http://192.168.1.189:${PORT}/upload.html`);
  console.log(`   后端代理目标: ${BACKEND_TARGET}`);
  console.log(`======================================================\n`);
});
