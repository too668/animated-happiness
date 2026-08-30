import { getStore, PreconditionFailedError } from '@edgeone/pages-blob';

// EdgeOne Makers 图床 —— 控制面（路由 /api/*）
//
// 图片 serve 在同域的 /i/*（见 edge-functions/i/[[default]].js）。
// Blob 存储没有公开读取地址，store.get() 是唯一读路径，所以链接必须走函数。

const STORE_NAME = 'yoo-images';

const RELAY_MAX_BYTES = 950 * 1024; // Edge 请求体上限 1MB，留出余量
const DIRECT_MAX_BYTES = 20 * 1024 * 1024; // Blob 单值上限 25MB
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
  const envVars = (context && context.env) || globalThis.env || {};
  const v = envVars.ADMIN_PASSWORD;
  return typeof v === 'string' && v.trim() ? v : '';
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
// 记录存在独立 store：control.list() 列的是整个 yoo-images，key 记录绝不能混进去，
// 否则会顺着 /api/list 泄给所有持有 list 权限的人。
// blob key = 'k/' + sha256('yoo-key:'+secret)：拿到密钥一次 get() 就能定位，无需扫描。
// 强一致句柄是「吊销立即生效」的前提；最终一致读可能让已删的 key 继续通过验证。
const KEY_STORE_NAME = 'yoo-keys';
const KEY_PREFIX = 'k/';
const VALID_PERMS = ['upload', 'list', 'delete'];
const KEY_RE_SECRET = /^yoo_[0-9a-f]{24}$/i;
const keyStore = getStore({ name: KEY_STORE_NAME, consistency: 'strong' });

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
    record = await keyStore.get(KEY_PREFIX + (await keyHashFor(secret)), { type: 'json' });
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
function buildKey(name) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = extOf(name) || '.bin';
  return `${yyyy}/${mm}/${randomId()}-${slugify(name)}${ext}`;
}

function isValidKey(key) {
  return typeof key === 'string' &&
    key.length <= 200 &&
    /^\d{4}\/\d{2}\/[0-9a-f]{12}(-[a-z0-9.-]{1,48})?\.[a-z0-9]{1,8}$/.test(key);
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
      return json({
        ok: true,
        store: STORE_NAME,
        storage: probe,
        limits: {
          relayMaxBytes: RELAY_MAX_BYTES,
          directMaxBytes: DIRECT_MAX_BYTES,
          uploadUrlTtl: UPLOAD_URL_TTL
        },
        time: new Date().toISOString()
      });
    }

    // ── /api/keys（仅管理员 Cookie；API key 不能管理 key）──────────
    if (route === 'keys') {
      const admin = await authState(context, request);
      if (!admin.authed) return fail('仅管理员可操作：请先在管理后台登录', 401);

      // GET —— 列表。BlobInfo 只有 key/etag，记录体逐个 get 出来
      if (request.method === 'GET') {
        const { blobs } = await keyStore.list({ prefix: KEY_PREFIX });
        const keys = [];
        for (const blob of blobs || []) {
          try {
            const rec = await keyStore.get(blob.key, { type: 'json' });
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
          try {
            await keyStore.setJSON(KEY_PREFIX + (await keyHashFor(secret)), record, { onlyIfNew: true });
            return json(
              { ok: true, id: record.id, name, perms, secret, createdAt: record.createdAt },
              200,
              { 'Cache-Control': 'no-store' }
            );
          } catch (e) {
            if (!(e instanceof PreconditionFailedError)) throw e; // 极小概率撞键，换个密钥再来
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
        const { blobs } = await keyStore.list({ prefix: KEY_PREFIX });
        for (const blob of blobs || []) {
          const rec = await keyStore.get(blob.key, { type: 'json' });
          if (!rec || rec.id !== id) continue;
          if (body.perms !== undefined) {
            const perms = normalizePerms(body.perms);
            if (!perms || !perms.length) return fail('权限至少选择一项（upload / list / delete）');
            rec.perms = perms;
          }
          if (body.name !== undefined) {
            rec.name = String(body.name || '').trim().slice(0, 40) || '未命名';
          }
          await keyStore.setJSON(blob.key, rec);
          return json({ ok: true, id: rec.id, name: rec.name, perms: rec.perms });
        }
        return fail('API key 不存在', 404);
      }

      // DELETE ?id= —— 吊销
      if (request.method === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        if (!id) return fail('缺少参数 id');
        const { blobs } = await keyStore.list({ prefix: KEY_PREFIX });
        for (const blob of blobs || []) {
          const rec = await keyStore.get(blob.key, { type: 'json' });
          if (!rec || rec.id !== id) continue;
          await keyStore.delete(blob.key);
          return json({ ok: true, id, message: '已吊销' });
        }
        return fail('API key 不存在', 404);
      }
    }

    // ── GET /api/list ──────────────────────────────────────────────
    if (request.method === 'GET' && route === 'list') {
      const gate = permGate(await resolveAuth(context, request, url), 'list');
      if (gate) return gate;
      const want = parseInt(url.searchParams.get('limit'), 10);
      const limit = Math.min(Number.isFinite(want) ? want : LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
      const cursor = url.searchParams.get('cursor');
      const detail = url.searchParams.get('detail') === '1';

      // paginate:false 才会返回 cursor；默认自动翻页时 cursor 恒为 undefined
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
        hasMore: Boolean(result.cursor)
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

      const name = String(body.filename || body.name || 'file').split(/[\\/]/).pop();
      const size = Number(body.size);
      if (Number.isFinite(size) && size > DIRECT_MAX_BYTES) {
        return fail(`文件过大，直传上限 ${Math.floor(DIRECT_MAX_BYTES / 1024 / 1024)}MB`);
      }

      const contentType =
        typeof body.contentType === 'string' && /^\w+\/[\w.+-]+$/.test(body.contentType)
          ? body.contentType
          : 'application/octet-stream';

      const key = buildKey(name);
      // createUploadUrl 会把 Content-Type 签进地址，客户端 PUT 时必须原样带回，否则 403
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
        method: 'PUT'
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

    // ── DELETE /api/delete ─────────────────────────────────────────
    if (request.method === 'DELETE' && route === 'delete') {
      const gate = permGate(await resolveAuth(context, request, url), 'delete');
      if (gate) return gate;
      const { key, error } = await readKeyParam(url);
      if (error) return fail(error);

      // Store 上没有 head()，判存在要用 getMetadata()
      const meta = await control.getMetadata(key);
      if (!meta) return fail('文件不存在', 404);

      await control.delete(key);
      return json({ ok: true, key, message: '已删除' });
    }

    return fail('接口不存在', 404);
  } catch (error) {
    return fail(`服务端异常：${error && error.message ? error.message : String(error)}`, 500);
  }
}
