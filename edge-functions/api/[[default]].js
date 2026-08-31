import { getStore } from '@edgeone/pages-blob';

// EdgeOne Makers 图床 —— 控制面（路由 /api/*）
//
// 图片 serve 在同域的 /i/*（见 edge-functions/i/[[default]].js）。
// Blob 存储没有公开读取地址，store.get() 是唯一读路径，所以链接必须走函数。

const STORE_NAME = 'yoo-images';

const RELAY_MAX_BYTES = 950 * 1024; // Edge 请求体上限 1MB，留出余量
const DIRECT_MAX_BYTES = 20 * 1024 * 1024; // Blob 单值上限 25MB
const S3_MAX_BYTES = 5 * 1024 * 1024 * 1024; // S3 上限 5GB

// iDrive e2 S3 配置（HTTP/SigV4）
const IDRIVE_ENDPOINT = 'https://s3.ap-northeast-1.idrivee2.com';
const IDRIVE_REGION = 'ap-northeast-1';

function envVar(context, name) {
  const envVars = (context && context.env) || globalThis.env || {};
  const v = envVars[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function isS3Configured(context) {
  return !!(envVar(context, 'IDRIVE_BUCKET') && envVar(context, 'IDRIVE_ACCESS_KEY_ID') && envVar(context, 'IDRIVE_SECRET_ACCESS_KEY'));
}
const UPLOAD_URL_TTL = 600;
const LIST_DEFAULT_LIMIT = 100;
const LIST_MAX_LIMIT = 500;

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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const control = getStore({ name: STORE_NAME, consistency: 'strong' });
const cached = getStore(STORE_NAME);

const json = (data, status = 200, extra) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...(extra || {}) }
  });

const fail = (error, status = 400) => json({ ok: false, error }, status);

// ── 管理后台密码门禁 ─────────────────────────────────────────
// 密码只存在于环境变量 ADMIN_PASSWORD（EdgeOne 控制台配置），代码与前端均不持明文。
// 登录成功下发 httpOnly Cookie（值 = sha256 派生 token），7 天有效，刷新不重填。
// 环境变量未配置时门禁开放（enabled:false），避免配置前把所有人锁在外面。
const AUTH_COOKIE = 'yoo_auth';
const AUTH_MAX_AGE = 7 * 24 * 3600;

function envPassword(context) {
  return envVar(context, 'ADMIN_PASSWORD');
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const tokenFor = (password) => sha256Hex('yoo-admin:' + password);

function ctEqual(a, b) {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function requestToken(request) {
  const header = request.headers.get('cookie') || '';
  const m = header.match(/(?:^|;\s*)yoo_auth=([^;]+)/);
  return m ? m[1] : '';
}

async function authState(context, request) {
  const password = envPassword(context);
  if (!password) return { enabled: false, authed: true };
  const token = requestToken(request);
  if (!token) return { enabled: true, authed: false };
  return { enabled: true, authed: ctEqual(token, await tokenFor(password)) };
}

const authCookie = (token, maxAge) =>
  `${AUTH_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;

// ── API key ─────────────────────────────────────────────────
// 记录存 Upstash Redis（环境变量 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN），
// 与图片桶完全隔离：平台凭证哪怕泄露，key 记录也不会跟着漏。
// 库里只有 secret 的 sha256 哈希，明文只在创建时返回一次。
// redis key = 'yookey:' + sha256('yoo-key:'+secret)：拿到密钥一次 GET 就能定位，无需扫描；
// 'yookeys:index'（SET）维护记录全集，供面板列表。Redis 强一致，吊销立即生效。
const KEY_PREFIX = 'yookey:';
const KEY_INDEX = 'yookeys:index';
const VALID_PERMS = ['upload', 'list', 'delete'];
const KEY_RE_SECRET = /^yoo_[0-9a-f]{24}$/i;

// Upstash REST：POST 命令数组，响应里取 result 字段
async function redis(context, cmd) {
  const url = envVar(context, 'UPSTASH_REDIS_REST_URL');
  const token = envVar(context, 'UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) {
    throw new Error('Redis 未配置：缺环境变量 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const data = await r.json();
  if (data && data.error) throw new Error('Redis: ' + data.error);
  return data ? data.result : null;
}

const keyHashFor = (secret) => sha256Hex('yoo-key:' + secret);

// 密钥来源二选一：Authorization: Bearer yoo_... 或 ?key= / ?apikey=
// ?key= 与图片 key 参数同名，靠 yoo_ 前缀区分
function extractApiKey(request, url) {
  const header = request.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (m && KEY_RE_SECRET.test(m[1])) return m[1].toLowerCase();
  for (const v of url.searchParams.getAll('key')) {
    if (KEY_RE_SECRET.test(String(v).trim())) return String(v).trim().toLowerCase();
  }
  const alt = String(url.searchParams.get('apikey') || '').trim();
  if (KEY_RE_SECRET.test(alt)) return alt.toLowerCase();
  return '';
}

function normalizePerms(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const p of input) {
    if (!VALID_PERMS.includes(p)) return null;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

// 身份解析：管理 Cookie 全权限；否则查 key；都没有 → role:null
async function resolveAuth(context, request, url) {
  const admin = await authState(context, request);
  if (admin.authed) return { role: 'admin', perms: VALID_PERMS };
  const secret = extractApiKey(request, url);
  if (!secret) return { role: null, perms: [] };
  let record = null;
  try {
    const raw = await redis(context, ['GET', KEY_PREFIX + (await keyHashFor(secret))]);
    record = raw ? JSON.parse(raw) : null;
  } catch { /* 存储异常按未授权处理 */ }
  if (!record) return { role: null, perms: [] };
  return { role: 'key', perms: normalizePerms(record.perms) || [], id: record.id };
}

function permGate(auth, perm) {
  if (!auth.role) {
    return fail('未授权：请携带 API key（Authorization: Bearer yoo_... 或 ?key=），或先在管理后台登录', 401);
  }
  if (!auth.perms.includes(perm)) {
    return fail(`当前 API key 没有 ${perm} 权限`, 403);
  }
  return null;
}

// 面板按 id 改/吊销：索引 + MGET 定位记录
async function findKeyRecord(context, id) {
  const hashes = (await redis(context, ['SMEMBERS', KEY_INDEX])) || [];
  if (!hashes.length) return null;
  const recs = (await redis(context, ['MGET', ...hashes])) || [];
  for (let i = 0; i < hashes.length; i++) {
    if (!recs[i]) continue;
    try {
      const rec = JSON.parse(recs[i]);
      if (rec && rec.id === id) return { rkey: hashes[i], rec };
    } catch { /* 单条坏数据跳过 */ }
  }
  return null;
}

const extOf = (name) => {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i).toLowerCase() : '';
};

const MIME_BY_EXT = IMAGE_TYPES;

function extFromMime(mime) {
  const hit = Object.keys(MIME_BY_EXT).find((key) => MIME_BY_EXT[key] === mime);
  return hit || '.bin';
}

function publicUrl(origin, key) {
  return `${origin}/i/${key}`;
}

function slugify(name) {
  const base = String(name || '').split(/[\\/]/).pop() || 'image';
  const stem = base.slice(0, base.lastIndexOf('.') > 0 ? base.lastIndexOf('.') : undefined);
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'image';
}

function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const randomId = () => randomHex(6);

// key 形如 2026/08/4f9a2c7b1e3d-my-photo.png
function buildKey(name, folder) {
  const ext = extOf(name) || '.bin';
  const base = `${randomId()}-${slugify(name)}${ext}`;
  if (folder) return `${folder}/${base}`;
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${base}`;
}

function isValidKey(key) {
  return typeof key === 'string' && key.length <= 300 &&
    /^[a-zA-Z0-9._/-]+$/.test(key) && !key.includes('..') &&
    !key.startsWith('/') && !key.endsWith('/');
}

function isValidFolder(f) {
  if (!f || typeof f !== 'string' || f.length > 200) return false;
  return f.split('/').every(s => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(s));
}

// key 也可能以完整链接的形式被用户粘贴回来
function keyFromAny(input) {
  if (!input) return '';
  let s = String(input).trim();
  const marker = '/i/';
  const at = s.indexOf(marker);
  if (at >= 0) s = s.slice(at + marker.length);
  try { s = decodeURIComponent(s); } catch { /* 保留原值 */ }
  return s.split('?')[0].split('#')[0];
}

// store.set() 不接受 Uint8Array，只接受 string|ArrayBuffer|Blob|ReadableStream
function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError('unsupported binary value');
}

// ── S3 SigV4 签名 ───────────────────────────────────────────
const enc = new TextEncoder();

function awsUriEncode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  );
}

async function s3Hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
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

function s3Host(context) {
  const endpointHost = new URL(IDRIVE_ENDPOINT).host;
  return `${envVar(context, 'IDRIVE_BUCKET')}.${endpointHost}`;
}

async function s3PresignPut(context, pathname, contentType, expireSeconds) {
  const bucket = envVar(context, 'IDRIVE_BUCKET');
  const accessKey = envVar(context, 'IDRIVE_ACCESS_KEY_ID');
  const secret = envVar(context, 'IDRIVE_SECRET_ACCESS_KEY');
  const host = s3Host(context);
  const d = new Date();
  const date = s3Ymd(d);
  const datetime = s3Ymdhms(d);
  const scope = `${date}/${IDRIVE_REGION}/s3/aws4_request`;
  const credential = `${accessKey}/${scope}`;

  const params = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', datetime],
    ['X-Amz-Expires', String(expireSeconds)],
    ['X-Amz-SignedHeaders', 'content-type;host']
  ];

  const qs = params.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${awsUriEncode(k)}=${awsUriEncode(v)}`)
    .join('&');

  const canonical = [
    'PUT', pathname, qs,
    `content-type:${contentType}\nhost:${host}\n`,
    'content-type;host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, s3Hex(await s3Hash(canonical))].join('\n');
  const key = await s3SigningKey(secret, date, IDRIVE_REGION);
  const sig = s3Hex(await s3Hmac(key, toSign));

  return `https://${host}${pathname}?${qs}&X-Amz-Signature=${sig}`;
}

async function s3ListObjects(context, limit, prefix, delimiter) {
  const accessKey = envVar(context, 'IDRIVE_ACCESS_KEY_ID');
  const secret = envVar(context, 'IDRIVE_SECRET_ACCESS_KEY');
  const host = s3Host(context);
  const d = new Date();
  const date = s3Ymd(d);
  const datetime = s3Ymdhms(d);
  const scope = `${date}/${IDRIVE_REGION}/s3/aws4_request`;

  const params = [
    ['list-type', '2'],
    ['max-keys', String(limit)]
  ];
  if (prefix) params.push(['prefix', prefix]);
  if (delimiter) params.push(['delimiter', delimiter]);
  params.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

  const qs = params.map(([k, v]) => `${awsUriEncode(k)}=${awsUriEncode(v)}`).join('&');
  const url = `https://${host}/?${qs}`;
  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const headers = {
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': datetime
  };

  const sortedKeys = Object.keys(headers).sort();
  const signedHeaders = sortedKeys.join(';');
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n';

  const canonical = [
    'GET', '/', qs,
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, s3Hex(await s3Hash(canonical))].join('\n');
  const key = await s3SigningKey(secret, date, IDRIVE_REGION);
  const sig = s3Hex(await s3Hmac(key, toSign));

  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { ...headers, Authorization: auth }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`S3 list failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const xml = await res.text();
  const files = [];
  const folders = [];

  const contentRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = contentRe.exec(xml))) {
    const block = m[1];
    const keyM = block.match(/<Key>([^<]+)<\/Key>/);
    const sizeM = block.match(/<Size>(\d+)<\/Size>/);
    if (keyM) {
      const k = keyM[1];
      if (k.endsWith('.folder')) continue;
      files.push({ key: k, size: sizeM ? parseInt(sizeM[1], 10) : null });
    }
  }

  if (delimiter) {
    const prefixRe = /<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/g;
    while ((m = prefixRe.exec(xml))) {
      const p = m[1].replace(/\/$/, '');
      const name = p.split('/').pop();
      if (name) folders.push({ name, path: p });
    }
  }

  return { files, folders };
}

async function s3DeleteObject(context, key) {
  const bucket = envVar(context, 'IDRIVE_BUCKET');
  const accessKey = envVar(context, 'IDRIVE_ACCESS_KEY_ID');
  const secret = envVar(context, 'IDRIVE_SECRET_ACCESS_KEY');
  const host = s3Host(context);
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

  const canonical = [
    'DELETE', pathname, '',
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, s3Hex(await s3Hash(canonical))].join('\n');
  const key2 = await s3SigningKey(secret, date, IDRIVE_REGION);
  const sig = s3Hex(await s3Hmac(key2, toSign));

  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...headers, Authorization: auth }
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`S3 delete failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function s3PutEmpty(context, key) {
  const accessKey = envVar(context, 'IDRIVE_ACCESS_KEY_ID');
  const secret = envVar(context, 'IDRIVE_SECRET_ACCESS_KEY');
  const host = s3Host(context);
  const pathname = '/' + key;
  const d = new Date();
  const date = s3Ymd(d);
  const datetime = s3Ymdhms(d);
  const scope = `${date}/${IDRIVE_REGION}/s3/aws4_request`;

  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const headers = {
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': datetime
  };

  const sortedKeys = Object.keys(headers).sort();
  const signedHeaders = sortedKeys.join(';');
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n';

  const canonical = [
    'PUT', pathname, '',
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, s3Hex(await s3Hash(canonical))].join('\n');
  const signingKey = await s3SigningKey(secret, date, IDRIVE_REGION);
  const sig = s3Hex(await s3Hmac(signingKey, toSign));

  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const res = await fetch(`https://${host}${pathname}`, {
    method: 'PUT',
    headers: { ...headers, Authorization: auth }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`S3 put failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function s3CopyObject(context, srcKey, dstKey) {
  const accessKey = envVar(context, 'IDRIVE_ACCESS_KEY_ID');
  const secret = envVar(context, 'IDRIVE_SECRET_ACCESS_KEY');
  const host = s3Host(context);
  const bucket = envVar(context, 'IDRIVE_BUCKET');
  const pathname = '/' + dstKey;
  const copySource = `/${bucket}/${srcKey}`;
  const d = new Date();
  const date = s3Ymd(d);
  const datetime = s3Ymdhms(d);
  const scope = `${date}/${IDRIVE_REGION}/s3/aws4_request`;

  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const headers = {
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-copy-source': copySource,
    'x-amz-date': datetime
  };

  const sortedKeys = Object.keys(headers).sort();
  const signedHeaders = sortedKeys.join(';');
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n';

  const canonical = [
    'PUT', pathname, '',
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, s3Hex(await s3Hash(canonical))].join('\n');
  const signingKey = await s3SigningKey(secret, date, IDRIVE_REGION);
  const sig = s3Hex(await s3Hmac(signingKey, toSign));

  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const res = await fetch(`https://${host}${pathname}`, {
    method: 'PUT',
    headers: { ...headers, Authorization: auth }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`S3 copy failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function readKeyParam(url) {
  const raws = [...url.searchParams.getAll('key'), ...url.searchParams.getAll('url')];
  const pick = raws.find((v) => v && !/^yoo_/i.test(String(v).trim())) || '';
  const key = keyFromAny(pick);
  if (!key) return { error: '缺少参数 key（或 url）' };
  if (!isValidKey(key)) return { error: 'key 格式不正确' };
  return { key };
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');

  try {
    // ── GET /api/auth-status ───────────────────────────────────────
    if (request.method === 'GET' && route === 'auth-status') {
      const state = await authState(context, request);
      return json({ ok: true, enabled: state.enabled, authed: state.authed });
    }

    // ── POST /api/login ────────────────────────────────────────────
    if (request.method === 'POST' && route === 'login') {
      const password = envPassword(context);
      if (!password) return json({ ok: true, enabled: false, authed: true });

      let body;
      try {
        body = await request.json();
      } catch {
        return fail('需要 JSON 请求体');
      }
      const guess = String(body.password || '');
      if (!guess || !ctEqual(await tokenFor(guess), await tokenFor(password))) {
        return fail('密码错误', 401);
      }
      return json(
        { ok: true, enabled: true, authed: true },
        200,
        { 'Set-Cookie': authCookie(await tokenFor(password), AUTH_MAX_AGE) }
      );
    }

    // ── POST /api/logout ───────────────────────────────────────────
    if (request.method === 'POST' && route === 'logout') {
      return json({ ok: true }, 200, { 'Set-Cookie': authCookie('', 0) });
    }

    // ── GET /api/health ────────────────────────────────────────────
    if (request.method === 'GET' && route === 'health') {
      let probe;
      try {
        const r = await control.list({ limit: 1, paginate: false });
        probe = { ok: true, sampled: (r.blobs || []).length };
      } catch (e) {
        probe = { ok: false, error: e.message };
      }
      let keysProbe;
      try {
        keysProbe = { ok: (await redis(context, ['PING'])) === 'PONG', backend: 'upstash-redis' };
      } catch (e) {
        keysProbe = { ok: false, backend: 'upstash-redis', error: e.message };
      }
      return json({
        ok: true,
        store: STORE_NAME,
        storage: probe,
        keys: keysProbe,
        s3: {
          configured: isS3Configured(context),
          endpoint: IDRIVE_ENDPOINT,
          region: IDRIVE_REGION,
          bucket: isS3Configured(context) ? envVar(context, 'IDRIVE_BUCKET') : ''
        },
        limits: {
          relayMaxBytes: RELAY_MAX_BYTES,
          directMaxBytes: DIRECT_MAX_BYTES,
          s3MaxBytes: S3_MAX_BYTES,
          uploadUrlTtl: UPLOAD_URL_TTL
        },
        time: new Date().toISOString()
      });
    }

    // ── /api/keys（仅管理员 Cookie；API key 不能管理 key）──────────
    if (route === 'keys') {
      const admin = await authState(context, request);
      if (!admin.authed) return fail('仅管理员可操作：请先在管理后台登录', 401);

      // GET —— 列表：索引集合拿全部 redis key，一次 MGET 取记录
      if (request.method === 'GET') {
        const hashes = (await redis(context, ['SMEMBERS', KEY_INDEX])) || [];
        const keys = [];
        if (hashes.length) {
          const recs = (await redis(context, ['MGET', ...hashes])) || [];
          for (const raw of recs) {
            if (!raw) continue;
            try {
              const rec = JSON.parse(raw);
              if (rec && rec.id) {
                keys.push({
                  id: rec.id,
                  name: rec.name || '',
                  prefix: rec.prefix || 'yoo_',
                  perms: normalizePerms(rec.perms) || [],
                  createdAt: rec.createdAt || null
                });
              }
            } catch { /* 单条坏数据跳过 */ }
          }
        }
        keys.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return json({ ok: true, keys }, 200, { 'Cache-Control': 'no-store' });
      }

      // POST {name, perms} —— 创建，明文密钥只返回这一次
      if (request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return fail('需要 JSON 请求体');
        }
        const perms = normalizePerms(body.perms);
        if (!perms || !perms.length) return fail('权限至少选择一项（upload / list / delete）');
        const name = String(body.name || '').trim().slice(0, 40) || '未命名';

        for (let attempt = 0; attempt < 2; attempt++) {
          const secret = 'yoo_' + randomHex(12);
          const record = {
            id: randomId(),
            name,
            perms,
            createdAt: Date.now(),
            prefix: secret.slice(0, 8) // 供面板展示 yoo_xxxx····
          };
          // NX：极小概率撞键时返回 null，换个密钥再来
          const rkey = KEY_PREFIX + (await keyHashFor(secret));
          const set = await redis(context, ['SET', rkey, JSON.stringify(record), 'NX']);
          if (set) {
            await redis(context, ['SADD', KEY_INDEX, rkey]);
            return json(
              { ok: true, id: record.id, name, perms, secret, createdAt: record.createdAt },
              200,
              { 'Cache-Control': 'no-store' }
            );
          }
        }
        return fail('密钥创建失败，请重试', 500);
      }

      // PATCH {id, perms?, name?} —— 改权限 / 改名
      if (request.method === 'PATCH') {
        let body;
        try {
          body = await request.json();
        } catch {
          return fail('需要 JSON 请求体');
        }
        const id = String(body.id || '');
        if (!id) return fail('缺少参数 id');
        const found = await findKeyRecord(context, id);
        if (!found) return fail('API key 不存在', 404);
        const rec = found.rec;
        if (body.perms !== undefined) {
          const perms = normalizePerms(body.perms);
          if (!perms || !perms.length) return fail('权限至少选择一项（upload / list / delete）');
          rec.perms = perms;
        }
        if (body.name !== undefined) {
          rec.name = String(body.name || '').trim().slice(0, 40) || '未命名';
        }
        await redis(context, ['SET', found.rkey, JSON.stringify(rec)]);
        return json({ ok: true, id: rec.id, name: rec.name, perms: rec.perms });
      }

      // DELETE ?id= —— 吊销
      if (request.method === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        if (!id) return fail('缺少参数 id');
        const found = await findKeyRecord(context, id);
        if (!found) return fail('API key 不存在', 404);
        await redis(context, ['DEL', found.rkey]);
        await redis(context, ['SREM', KEY_INDEX, found.rkey]);
        return json({ ok: true, id, message: '已吊销' });
      }
    }

    // ── GET /api/list ──────────────────────────────────────────────
    if (request.method === 'GET' && route === 'list') {
      const gate = permGate(await resolveAuth(context, request, url), 'list');
      if (gate) return gate;
      const storage = url.searchParams.get('storage') || 'blob';
      const want = parseInt(url.searchParams.get('limit'), 10);
      const limit = Math.min(Number.isFinite(want) ? want : LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
      const folderMode = url.searchParams.has('prefix');
      const userPrefix = url.searchParams.get('prefix') || '';

      // ── S3 列表 ──
      if (storage === 's3') {
        if (!isS3Configured(context)) return fail('S3 存储未配置', 503);
        try {
          if (folderMode) {
            const s3Prefix = userPrefix ? `uploads/${userPrefix}/` : 'uploads/';
            const { files, folders } = await s3ListObjects(context, limit, s3Prefix, '/');
            const items = files.map(f => {
              const name = f.key.split('/').pop();
              return {
                key: f.key,
                name,
                url: publicUrl(origin, f.key),
                type: MIME_BY_EXT[extOf(f.key)] || 'application/octet-stream',
                size: f.size,
                storage: 's3'
              };
            });
            const userFolders = folders.map(fo => {
              const relPath = fo.path.startsWith('uploads/') ? fo.path.slice(8) : fo.path;
              return { name: fo.name, path: relPath };
            });
            return json({ ok: true, folders: userFolders, items, total: items.length, prefix: userPrefix, storage: 's3' });
          }
          const { files } = await s3ListObjects(context, limit, '', '');
          const items = files.map(f => {
            const name = f.key.split('/').pop();
            return {
              key: f.key,
              name,
              url: publicUrl(origin, f.key),
              type: MIME_BY_EXT[extOf(f.key)] || 'application/octet-stream',
              size: f.size,
              storage: 's3'
            };
          });
          return json({ ok: true, items, total: items.length, storage: 's3' });
        } catch (e) {
          return fail('S3 列表失败：' + e.message, 500);
        }
      }

      // ── Blob 列表（默认）──
      if (folderMode) {
        const blobPrefix = userPrefix ? userPrefix + '/' : '';
        const result = await control.list({ prefix: blobPrefix, limit: LIST_MAX_LIMIT, paginate: false });
        const allKeys = (result.blobs || []).map(b => b.key).filter(k => !k.endsWith('.folder'));

        const folderSet = new Set();
        const directFiles = [];
        for (const key of allKeys) {
          const relative = blobPrefix ? key.slice(blobPrefix.length) : key;
          const slashIdx = relative.indexOf('/');
          if (slashIdx > 0) {
            folderSet.add(relative.slice(0, slashIdx));
          } else {
            const blob = (result.blobs || []).find(b => b.key === key);
            directFiles.push({
              key,
              name: key.split('/').pop(),
              url: publicUrl(origin, key),
              type: MIME_BY_EXT[extOf(key)] || 'application/octet-stream',
              etag: blob ? blob.etag || null : null
            });
          }
        }

        const folders = [...folderSet].sort().map(name => ({
          name,
          path: blobPrefix ? blobPrefix.slice(0, -1) + '/' + name : name
        }));

        return json({
          ok: true,
          folders,
          items: directFiles.slice(0, limit),
          total: directFiles.length,
          prefix: userPrefix,
          storage: 'blob'
        });
      }

      const cursor = url.searchParams.get('cursor');
      const detail = url.searchParams.get('detail') === '1';

      const options = { limit, paginate: false };
      if (cursor) options.cursor = cursor;
      if (url.searchParams.get('all') === '1') delete options.limit;

      const result = await control.list(options);
      const items = (result.blobs || []).map((blob) => {
        const name = blob.key.split('/').pop();
        const item = {
          key: blob.key,
          name,
          url: publicUrl(origin, blob.key),
          type: MIME_BY_EXT[extOf(blob.key)] || 'application/octet-stream',
          etag: blob.etag || null
        };
        if (detail) item.detail = true;
        return item;
      });

      if (detail) {
        for (const item of items.slice(0, 50)) {
          try {
            const meta = await cached.getMetadata(item.key);
            const headers = (meta && meta.headers) || {};
            const len = headers['content-length'] || headers['Content-Length'];
            item.size = len ? parseInt(len, 10) : null;
            item.contentType = (meta && meta.contentType) || item.type;
          } catch {
            item.size = null;
          }
        }
      }

      return json({
        ok: true,
        items,
        total: items.length,
        nextCursor: result.cursor || null,
        hasMore: Boolean(result.cursor),
        storage: 'blob'
      });
    }

    // ── GET /api/meta ──────────────────────────────────────────────
    if (request.method === 'GET' && route === 'meta') {
      const gate = permGate(await resolveAuth(context, request, url), 'list');
      if (gate) return gate;
      const { key, error } = await readKeyParam(url);
      if (error) return fail(error);
      // 走强一致句柄：最终一致的读会返回已删除对象的旧元信息，谎报存在
      const meta = await control.getMetadata(key);
      if (!meta) return fail('文件不存在', 404);
      return json({ ok: true, key, url: publicUrl(origin, key), meta });
    }

    // ── POST /api/upload-url ───────────────────────────────────────
    // 签名直传：函数只签发一个几十字节的 PUT 地址，文件字节不经过函数。
    // 任意格式、原始字节、不受 Edge 1MB 请求体限制。
    if (request.method === 'POST' && route === 'upload-url') {
      const gate = permGate(await resolveAuth(context, request, url), 'upload');
      if (gate) return gate;
      let body;
      try {
        body = await request.json();
      } catch {
        return fail('需要 JSON 请求体');
      }

      const storage = url.searchParams.get('storage') || 'blob';
      const name = String(body.filename || body.name || 'file').split(/[\\/]/).pop();
      const size = Number(body.size);
      const rawFolder = String(body.folder || '').trim();
      if (rawFolder && !isValidFolder(rawFolder)) return fail('文件夹路径格式不正确');

      const contentType =
        typeof body.contentType === 'string' && /^\w+\/[\w.+-]+$/.test(body.contentType)
          ? body.contentType
          : 'application/octet-stream';

      // ── S3 直传 ──
      if (storage === 's3') {
        if (!isS3Configured(context)) return fail('S3 存储未配置（缺环境变量）', 503);
        if (Number.isFinite(size) && size > S3_MAX_BYTES) {
          return fail(`S3 文件过大，上限 ${Math.floor(S3_MAX_BYTES / 1024 / 1024 / 1024)}GB`);
        }
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `uploads/${buildKey(safeName, rawFolder)}`;
        const pathname = '/' + key;
        const uploadUrl = await s3PresignPut(context, pathname, contentType, UPLOAD_URL_TTL);
        return json({
          ok: true,
          key,
          url: publicUrl(origin, key),
          uploadUrl,
          expiresAt: Date.now() + UPLOAD_URL_TTL * 1000,
          contentType,
          method: 'PUT',
          storage: 's3'
        });
      }

      // ── Blob 直传（默认）──
      if (Number.isFinite(size) && size > DIRECT_MAX_BYTES) {
        return fail(`Blob 文件过大，直传上限 ${Math.floor(DIRECT_MAX_BYTES / 1024 / 1024)}MB`);
      }

      const key = buildKey(name, rawFolder);
      const signed = await control.createUploadUrl(key, {
        expireSeconds: UPLOAD_URL_TTL,
        contentType
      });

      return json({
        ok: true,
        key,
        url: publicUrl(origin, key),
        uploadUrl: signed.url,
        expiresAt: signed.expiresAt,
        contentType,
        method: 'PUT',
        storage: 'blob'
      });
    }

    // ── PUT|POST /api/upload ───────────────────────────────────────
    // 中转：仅图片，字节穿过函数，因此受 Edge 1MB 请求体上限约束。
    if (route === 'upload' && (request.method === 'PUT' || request.method === 'POST')) {
      const gate = permGate(await resolveAuth(context, request, url), 'upload');
      if (gate) return gate;
      let bytes = null;
      let name = '';
      let declaredType = '';

      const ct = request.headers.get('content-type') || '';

      if (request.method === 'PUT') {
        bytes = toArrayBuffer(await request.arrayBuffer());
        name = url.searchParams.get('name') || `image${extOf(ct) || '.png'}`;
        declaredType = ct;
      } else if (ct.includes('multipart/form-data')) {
        // Edge 运行时没有 File 构造器，只能鸭子类型判断
        let form;
        try {
          form = await request.formData();
        } catch (e) {
          return fail(`无法解析 multipart 表单：${e.message}`);
        }
        const file = form.get('file') || form.get('image') || form.get('upload');
        if (!file || typeof file.arrayBuffer !== 'function') {
          return fail('缺少文件字段（期望 file / image / upload）');
        }
        bytes = toArrayBuffer(await file.arrayBuffer());
        name = typeof file.name === 'string' ? file.name : '';
        declaredType = file.type || '';
      } else {
        return fail('中转上传请用 PUT 原始字节，或 POST multipart/form-data');
      }

      if (!bytes || bytes.byteLength === 0) return fail('文件内容为空');
      if (bytes.byteLength > RELAY_MAX_BYTES) {
        return fail(
          `中转上限 ${Math.floor(RELAY_MAX_BYTES / 1024)}KB（Edge 请求体 1MB），` +
          '更大的文件请用 POST /api/upload-url 直传',
          413
        );
      }

      const ext = extOf(name);
      let contentType = IMAGE_TYPES[ext];
      if (!contentType) {
        const headerMime = (declaredType.split(';')[0] || '').trim().toLowerCase();
        if (Object.values(IMAGE_TYPES).includes(headerMime)) contentType = headerMime;
      }
      if (!contentType) {
        return fail('中转仅接受图片：' + Object.keys(IMAGE_TYPES).join(' '));
      }

      const finalName = name || `image${ext || extFromMime(contentType)}`;
      const key = buildKey(finalName);

      // 只能存字节；Content-Type 由 serve 路由按扩展名推导。
      // cacheControl 与 /i/ 路由保持一致（1 小时）：目前出图以路由头为准，
      // 但对象上留个一年值是个地雷，哪天改成透传元信息就会复活「删了还能看一年」。
      await control.set(key, bytes, {
        cacheControl: 'public, max-age=3600'
      });

      return json({
        ok: true,
        key,
        url: publicUrl(origin, key),
        size: bytes.byteLength,
        contentType,
        name: key.split('/').pop()
      });
    }

    // ── POST /api/mkdir ────────────────────────────────────────────
    if (request.method === 'POST' && route === 'mkdir') {
      const gate = permGate(await resolveAuth(context, request, url), 'upload');
      if (gate) return gate;
      let body;
      try { body = await request.json(); } catch { return fail('需要 JSON 请求体'); }
      const folder = String(body.folder || '').trim();
      if (!folder || !isValidFolder(folder)) return fail('文件夹路径格式不正确');
      const storage = url.searchParams.get('storage') || 'blob';

      if (storage === 's3') {
        if (!isS3Configured(context)) return fail('S3 存储未配置', 503);
        try {
          await s3PutEmpty(context, `uploads/${folder}/.folder`);
          return json({ ok: true, folder, storage: 's3' });
        } catch (e) {
          return fail('创建文件夹失败：' + e.message, 500);
        }
      }

      try {
        await control.set(`${folder}/.folder`, new ArrayBuffer(0));
        return json({ ok: true, folder, storage: 'blob' });
      } catch (e) {
        return fail('创建文件夹失败：' + e.message, 500);
      }
    }

    // ── POST /api/rename ───────────────────────────────────────────
    if (request.method === 'POST' && route === 'rename') {
      const auth = await resolveAuth(context, request, url);
      const gate1 = permGate(auth, 'upload');
      if (gate1) return gate1;
      const gate2 = permGate(auth, 'delete');
      if (gate2) return gate2;
      let body;
      try { body = await request.json(); } catch { return fail('需要 JSON 请求体'); }
      const oldKey = keyFromAny(body.oldKey || '');
      const newKey = keyFromAny(body.newKey || '');
      if (!oldKey || !newKey) return fail('缺少 oldKey 或 newKey');
      if (!isValidKey(oldKey) || !isValidKey(newKey)) return fail('key 格式不正确');
      if (oldKey === newKey) return fail('新旧 key 相同');
      const storage = url.searchParams.get('storage') || 'blob';

      if (storage === 's3') {
        if (!isS3Configured(context)) return fail('S3 存储未配置', 503);
        try {
          await s3CopyObject(context, oldKey, newKey);
          await s3DeleteObject(context, oldKey);
          return json({ ok: true, oldKey, newKey, storage: 's3' });
        } catch (e) {
          return fail('重命名失败：' + e.message, 500);
        }
      }

      try {
        const data = await control.get(oldKey, { type: 'arrayBuffer' });
        if (!data) return fail('文件不存在', 404);
        await control.set(newKey, data);
        await control.delete(oldKey);
        return json({ ok: true, oldKey, newKey, storage: 'blob' });
      } catch (e) {
        return fail('重命名失败：' + e.message, 500);
      }
    }

    // ── DELETE /api/delete ─────────────────────────────────────────
    if (request.method === 'DELETE' && route === 'delete') {
      const gate = permGate(await resolveAuth(context, request, url), 'delete');
      if (gate) return gate;
      const storage = url.searchParams.get('storage') || 'blob';

      // ── S3 删除 ──
      if (storage === 's3') {
        if (!isS3Configured(context)) return fail('S3 存储未配置', 503);
        const rawKey = url.searchParams.get('key') || url.searchParams.get('url') || '';
        const key = keyFromAny(rawKey);
        if (!key) return fail('缺少参数 key');
        try {
          await s3DeleteObject(context, key);
          return json({ ok: true, key, message: '已删除', storage: 's3' });
        } catch (e) {
          return fail('S3 删除失败：' + e.message, 500);
        }
      }

      // ── Blob 删除（默认）──
      const { key, error } = await readKeyParam(url);
      if (error) return fail(error);

      const meta = await control.getMetadata(key);
      if (!meta) return fail('文件不存在', 404);

      await control.delete(key);
      return json({ ok: true, key, message: '已删除', storage: 'blob' });
    }

    // ── POST /api/delete-folder ────────────────────────────────────
    if (request.method === 'POST' && route === 'delete-folder') {
      const auth = await resolveAuth(context, request, url);
      const gate = permGate(auth, 'delete');
      if (gate) return gate;
      let body;
      try { body = await request.json(); } catch { return fail('需要 JSON 请求体'); }
      const folder = String(body.folder || '').trim();
      if (!folder || !isValidFolder(folder)) return fail('文件夹路径格式不正确');
      const storage = url.searchParams.get('storage') || 'blob';
      let deleted = 0;

      if (storage === 's3') {
        if (!isS3Configured(context)) return fail('S3 存储未配置', 503);
        try {
          const s3Prefix = `uploads/${folder}/`;
          let hasMore = true;
          while (hasMore) {
            const { files } = await s3ListObjects(context, 1000, s3Prefix, '');
            if (!files.length) { hasMore = false; break; }
            for (const f of files) {
              await s3DeleteObject(context, f.key);
              deleted++;
            }
          }
          try { await s3DeleteObject(context, `uploads/${folder}/.folder`); } catch { /* ok */ }
          const { files: check } = await s3ListObjects(context, 5, s3Prefix, '');
          if (check.length > 0) {
            for (const f of check) { try { await s3DeleteObject(context, f.key); } catch { /* ok */ } }
            try { await s3DeleteObject(context, `uploads/${folder}/.folder`); } catch { /* ok */ }
          }
          return json({ ok: true, folder, deleted, storage: 's3' });
        } catch (e) {
          return fail('删除文件夹失败：' + e.message, 500);
        }
      }

      try {
        const blobPrefix = folder + '/';
        let hasMore = true;
        while (hasMore) {
          const result = await control.list({ prefix: blobPrefix, limit: LIST_MAX_LIMIT, paginate: false });
          const keys = (result.blobs || []).map(b => b.key);
          if (!keys.length) { hasMore = false; break; }
          for (const key of keys) {
            await control.delete(key);
            deleted++;
          }
        }
        return json({ ok: true, folder, deleted, storage: 'blob' });
      } catch (e) {
        return fail('删除文件夹失败：' + e.message, 500);
      }
    }

    // ── POST /api/rename-folder ────────────────────────────────────
    if (request.method === 'POST' && route === 'rename-folder') {
      const auth = await resolveAuth(context, request, url);
      const gate1 = permGate(auth, 'upload');
      if (gate1) return gate1;
      const gate2 = permGate(auth, 'delete');
      if (gate2) return gate2;
      let body;
      try { body = await request.json(); } catch { return fail('需要 JSON 请求体'); }
      const oldPath = String(body.oldPath || '').trim();
      const newPath = String(body.newPath || '').trim();
      if (!oldPath || !newPath) return fail('缺少 oldPath 或 newPath');
      if (!isValidFolder(oldPath) || !isValidFolder(newPath)) return fail('文件夹路径格式不正确');
      if (oldPath === newPath) return fail('新旧路径相同');
      const storage = url.searchParams.get('storage') || 'blob';
      let moved = 0;

      if (storage === 's3') {
        if (!isS3Configured(context)) return fail('S3 存储未配置', 503);
        try {
          const oldPrefix = `uploads/${oldPath}/`;
          const newPrefix = `uploads/${newPath}/`;
          const { files } = await s3ListObjects(context, 1000, oldPrefix, '');
          for (const f of files) {
            const newKey = newPrefix + f.key.slice(oldPrefix.length);
            await s3CopyObject(context, f.key, newKey);
            await s3DeleteObject(context, f.key);
            moved++;
          }
          try { await s3DeleteObject(context, oldPrefix + '.folder'); } catch { /* ok */ }
          try { await s3PutEmpty(context, newPrefix + '.folder'); } catch { /* ok */ }
          return json({ ok: true, oldPath, newPath, moved, storage: 's3' });
        } catch (e) {
          return fail('重命名文件夹失败：' + e.message, 500);
        }
      }

      try {
        const oldBlobPrefix = oldPath + '/';
        const newBlobPrefix = newPath + '/';
        const result = await control.list({ prefix: oldBlobPrefix, limit: LIST_MAX_LIMIT * 2, paginate: false });
        const blobs = result.blobs || [];
        for (const blob of blobs) {
          const newKey = newBlobPrefix + blob.key.slice(oldBlobPrefix.length);
          const data = await control.get(blob.key, { type: 'arrayBuffer' });
          if (data) {
            await control.set(newKey, data);
            await control.delete(blob.key);
            moved++;
          }
        }
        return json({ ok: true, oldPath, newPath, moved, storage: 'blob' });
      } catch (e) {
        return fail('重命名文件夹失败：' + e.message, 500);
      }
    }

    // ── POST /api/copy ─────────────────────────────────────────────
    if (request.method === 'POST' && route === 'copy') {
      const auth = await resolveAuth(context, request, url);
      const gate = permGate(auth, 'upload');
      if (gate) return gate;
      let body;
      try { body = await request.json(); } catch { return fail('需要 JSON 请求体'); }
      const srcKey = keyFromAny(body.srcKey || '');
      const dstKey = keyFromAny(body.dstKey || '');
      if (!srcKey || !dstKey) return fail('缺少 srcKey 或 dstKey');
      if (!isValidKey(srcKey) || !isValidKey(dstKey)) return fail('key 格式不正确');
      const storage = url.searchParams.get('storage') || 'blob';

      if (storage === 's3') {
        if (!isS3Configured(context)) return fail('S3 存储未配置', 503);
        try {
          await s3CopyObject(context, srcKey, dstKey);
          return json({ ok: true, srcKey, dstKey, storage: 's3' });
        } catch (e) {
          return fail('复制失败：' + e.message, 500);
        }
      }

      try {
        const data = await control.get(srcKey, { type: 'arrayBuffer' });
        if (!data) return fail('文件不存在', 404);
        await control.set(dstKey, data);
        return json({ ok: true, srcKey, dstKey, storage: 'blob' });
      } catch (e) {
        return fail('复制失败：' + e.message, 500);
      }
    }

    // ── Albums (Supabase) ─────────────────────────────────────────────
    function supabaseUrl(context) { return envVar(context, 'SUPABASE_URL'); }
    function supabaseKey(context) { return envVar(context, 'SUPABASE_SECRET_KEY'); }
    function supabaseHeaders(context) {
      return {
        'apikey': supabaseKey(context),
        'Authorization': 'Bearer ' + supabaseKey(context),
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      };
    }

    if (route === 'albums' && request.method === 'GET') {
      const base = supabaseUrl(context);
      const key = supabaseKey(context);
      if (!base || !key) return fail('相册服务未配置', 503);
      try {
        const res = await fetch(base + '/rest/v1/albums?order=created_at.asc', {
          headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
        });
        const data = await res.json();
        return json({ ok: true, albums: data });
      } catch (e) {
        return fail('获取相册失败：' + e.message, 500);
      }
    }

    if (route === 'albums' && request.method === 'POST') {
      const base = supabaseUrl(context);
      const key = supabaseKey(context);
      if (!base || !key) return fail('相册服务未配置', 503);
      let body;
      try { body = await request.json(); } catch { return fail('需要 JSON 请求体'); }
      const storage = body.storage || 'blob';
      const path = (body.path || '').trim();
      const name = (body.name || '').trim() || null;
      if (!path) return fail('缺少 path');
      try {
        const res = await fetch(base + '/rest/v1/albums', {
          method: 'POST',
          headers: supabaseHeaders(context),
          body: JSON.stringify({ storage, path, name })
        });
        if (res.status === 409) return fail('该相册已存在', 409);
        const data = await res.json();
        return json({ ok: true, album: data[0] || data });
      } catch (e) {
        return fail('添加相册失败：' + e.message, 500);
      }
    }

    if (route === 'albums' && request.method === 'DELETE') {
      const base = supabaseUrl(context);
      const key = supabaseKey(context);
      if (!base || !key) return fail('相册服务未配置', 503);
      const id = url.searchParams.get('id');
      if (!id) return fail('缺少 id');
      try {
        await fetch(base + '/rest/v1/albums?id=eq.' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: supabaseHeaders(context)
        });
        return json({ ok: true });
      } catch (e) {
        return fail('删除相册失败：' + e.message, 500);
      }
    }

    return fail('接口不存在', 404);
  } catch (error) {
    return fail(`服务端异常：${error && error.message ? error.message : String(error)}`, 500);
  }
}
