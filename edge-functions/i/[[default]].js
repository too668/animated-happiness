import { getStore } from '@edgeone/pages-blob';

const STORE_NAME = 'yoo-images';

const IDRIVE_ENDPOINT = 'https://s3.ap-northeast-1.idrivee2.com';
const IDRIVE_REGION = 'ap-northeast-1';

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

const store = getStore(STORE_NAME);

const BLOB_KEY_RE = /^\d{4}\/\d{2}\/[0-9a-f]{12}(-[a-z0-9.-]{1,48})?\.[a-z0-9]{1,8}$/;
const S3_KEY_RE = /^uploads\/\d{4}\/\d{2}\/[0-9a-f]{12}(-[a-z0-9._-]{1,64})?\.[a-z0-9]{1,8}$/;

const notFound = () =>
  new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });

function envVar(context, name) {
  const envVars = (context && context.env) || globalThis.env || {};
  const v = envVars[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

// ── S3 SigV4 (只读 GET) ─────────────────────────────────────
const enc = new TextEncoder();

function awsUriEncode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  );
}

async function s3Hmac(key, data) {
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', ck, enc.encode(data));
}

async function s3Hash(data) {
  return crypto.subtle.digest('SHA-256', enc.encode(data));
}

function s3Hex(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function s3Ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function s3Ymdhms(d) { return d.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z'; }

async function s3SigningKey(secret, date, region) {
  const kDate = await s3Hmac(enc.encode('AWS4' + secret), date);
  const kRegion = await s3Hmac(kDate, region);
  const kService = await s3Hmac(kRegion, 's3');
  return s3Hmac(kService, 'aws4_request');
}

async function s3SignedGet(context, key) {
  const bucket = envVar(context, 'IDRIVE_BUCKET');
  const accessKey = envVar(context, 'IDRIVE_ACCESS_KEY_ID');
  const secret = envVar(context, 'IDRIVE_SECRET_ACCESS_KEY');
  const host = `${bucket}.${new URL(IDRIVE_ENDPOINT).host}`;
  const pathname = '/' + key;
  const d = new Date();
  const date = s3Ymd(d);
  const datetime = s3Ymdhms(d);
  const scope = `${date}/${IDRIVE_REGION}/s3/aws4_request`;

  const url = `https://${host}${pathname}`;
  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const headers = {
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': datetime
  };

  const sortedKeys = Object.keys(headers).sort();
  const signedHeaders = sortedKeys.join(';');
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n';

  const canonical = ['GET', pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, s3Hex(await s3Hash(canonical))].join('\n');
  const sk = await s3SigningKey(secret, date, IDRIVE_REGION);
  const sig = s3Hex(await s3Hmac(sk, toSign));

  return fetch(url, {
    method: 'GET',
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`
    }
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  let key = url.pathname.replace(/^\/i\/?/, '');
  try { key = decodeURIComponent(key); } catch { return notFound(); }
  key = key.replace(/^\/+|\/+$/g, '');

  const isS3 = key.startsWith('uploads/');
  const isBlob = !isS3;

  if (isS3 && !S3_KEY_RE.test(key)) return notFound();
  if (isBlob && !BLOB_KEY_RE.test(key)) return notFound();

  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  const knownType = IMAGE_TYPES[ext];
  const contentType = knownType || 'application/octet-stream';
  const download = url.searchParams.get('download') === '1';
  const name = key.split('/').pop();

  const respHeaders = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
    'X-Content-Type-Options': knownType ? 'nosniff' : 'default'
  };

  // ── S3 出图 ──
  if (isS3) {
    if (!envVar(context, 'IDRIVE_BUCKET')) return notFound();
    try {
      const s3Resp = await s3SignedGet(context, key);
      if (!s3Resp.ok) return notFound();
      const body = await s3Resp.arrayBuffer();
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: respHeaders });
      return new Response(body, { status: 200, headers: respHeaders });
    } catch {
      return notFound();
    }
  }

  // ── Blob 出图 ──
  let body = null;
  let etag = null;

  try { body = await store.get(key, { type: 'stream' }); } catch { body = null; }
  if (!body) {
    try { body = await store.get(key, { type: 'arrayBuffer' }); } catch { body = null; }
    if (!body) return notFound();
  }

  try {
    const meta = await store.getMetadata(key);
    etag = meta && meta.etag ? `"${meta.etag}"` : null;
  } catch { /* 元信息拿不到不影响出图 */ }

  if (etag) respHeaders.ETag = etag;
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: respHeaders });
  return new Response(body, { status: 200, headers: respHeaders });
}
