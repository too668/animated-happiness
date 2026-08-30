import { getStore } from '@edgeone/pages-blob';

// 图片 serve（路由 /i/*）
//
// Blob 存储没有公开读取地址，store.get() 是唯一读路径 —— 所以图片链接必须由函数把字节吐出去。
// 链接形如 https://<domain>/i/2026/08/4f9a2c7b1e3d-photo.png

const STORE_NAME = 'yoo-images';

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
};

// 只读走默认的最终一致（命中边缘缓存，延迟低）
const store = getStore(STORE_NAME);

const KEY_RE = /^\d{4}\/\d{2}\/[0-9a-f]{12}(-[a-z0-9.-]{1,48})?\.[a-z0-9]{1,8}$/;

const notFound = () =>
  new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  let key = url.pathname.replace(/^\/i\/?/, '');
  try {
    key = decodeURIComponent(key);
  } catch {
    return notFound();
  }
  key = key.replace(/^\/+|\/+$/g, '');

  // 严格白名单：同时挡住路径穿越和任意 key 探测
  if (!KEY_RE.test(key)) return notFound();

  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  const knownType = IMAGE_TYPES[ext];
  const contentType = knownType || 'application/octet-stream';
  const download = url.searchParams.get('download') === '1';
  const name = key.split('/').pop();

  let body = null;
  let etag = null;

  try {
    body = await store.get(key, { type: 'stream' });
  } catch {
    body = null;
  }

  if (!body) {
    // 某些运行时下 stream 不可用，退回整体读取
    try {
      body = await store.get(key, { type: 'arrayBuffer' });
    } catch {
      body = null;
    }
    if (!body) return notFound();
  }

  try {
    const meta = await store.getMetadata(key);
    etag = meta && meta.etag ? `"${meta.etag}"` : null;
  } catch {
    /* 元信息拿不到不影响出图 */
  }

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
    'X-Content-Type-Options': knownType ? 'nosniff' : 'default'
  };
  if (etag) headers.ETag = etag;
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

  return new Response(body, { status: 200, headers });
}
