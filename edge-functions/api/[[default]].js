import { getStore } from '@edgeone/pages-blob';

/**
 * EdgeOne Pages Function - Image Upload API (Rebuilt & Hardened)
 * 
 * Features:
 *   - URL 子链生成：保留原始文件扩展名
 *   - 多种上传方式 (multipart/form-data, base64, raw binary)
 *   - 图片列表分页 (?limit=&cursor=)
 *   - 安全删除验证
 *   - CORS 支持
 *   - 严格的输入验证和错误处理
 *   - 文件大小和类型限制
 * 
 * Endpoints:
 *   POST   /api/upload   - Upload image
 *   GET    /api/list     - List all images (supports ?limit=&cursor=)
 *   DELETE /api/delete   - Delete image by key
 *   OPTIONS              - CORS preflight
 * 
 * Deployment: edge-functions/api/upload.js
 * Domain: https://yooy.cc.cd
 */

// Configuration Center
const CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 100,
  CACHE_CONTROL: 'public, max-age=31536000',
  BASE_URL: 'https://yooy.cc.cd'
};

// CORS Headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8'
};

// Helper: JSON response
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });

// Helper: Validate image MIME type
function isValidImageType(mimeType) {
  if (!mimeType) return false;
  return CONFIG.ALLOWED_TYPES.includes(mimeType.toLowerCase());
}

// Helper: Validate file extension
function isValidExtension(filename) {
  const ext = '.' + filename.split('.').pop().toLowerCase();
  return CONFIG.ALLOWED_EXTENSIONS.includes(ext);
}

// Helper: Sanitize filename
function sanitizeFilename(filename) {
  return String(filename || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
}

// Helper: Extract extension from filename or MIME type
function getFileExtension(filename, mimeType) {
  // Try to get from filename first
  if (filename && filename.includes('.')) {
    const ext = '.' + filename.split('.').pop().toLowerCase();
    if (isValidExtension(ext)) {
      return ext;
    }
  }
  
  // Fallback to MIME type mapping
  const mimeToExt = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
  };
  
  return mimeToExt[mimeType?.toLowerCase()] || '.png';
}

// Helper: Generate unique key with original extension (URL 子链生成)
function generateKey(filename, mimeType) {
  const ext = getFileExtension(filename, mimeType);
  const safeName = sanitizeFilename(filename.replace(/\.[^.]+$/, ''));
  const dateStr = new Date().toISOString().slice(0, 10);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  
  // URL 子链生成：保留原始扩展名
  return `images/${dateStr}/${timestamp}-${random}-${safeName}${ext}`;
}

export default async function onRequest(context) {
  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
  }

  const url = new URL(context.request.url);
  const path = url.pathname;

  try {
    // ─── GET /api/list ────────────────────────────────────────────────
    if (context.request.method === 'GET' && path === '/api/list') {
      const limit = Math.min(
        parseInt(url.searchParams.get('limit')) || CONFIG.DEFAULT_LIMIT,
        CONFIG.MAX_LIMIT
      );
      const cursor = url.searchParams.get('cursor');

      const store = getStore('functions-test');
      const options = { prefix: 'images/', limit };
      if (cursor) options.cursor = cursor;

      const result = await store.list(options);

      const items = (result.blobs || []).map(blob => ({
        key: blob.key,
        url: `${CONFIG.BASE_URL}/${blob.key}`,
        etag: blob.etag || ''
      }));

      return json({
        ok: true,
        items,
        total: items.length,
        nextCursor: result.cursor || null,
        hasMore: !!result.cursor
      });
    }

    // ─── DELETE /api/delete?key=... ──────────────────────────────────
    if (context.request.method === 'DELETE' && path === '/api/delete') {
      const key = url.searchParams.get('key');
      
      // Strict validation: key must exist and start with 'images/'
      if (!key) {
        return json({ ok: false, error: 'Missing required parameter: key' }, 400);
      }
      
      if (!key.startsWith('images/')) {
        return json({ ok: false, error: 'Invalid key format: must start with "images/"' }, 400);
      }

      const store = getStore('functions-test');
      
      // Verify the file exists before deletion
      try {
        await store.head(key);
      } catch (headError) {
        return json({ ok: false, error: 'File not found' }, 404);
      }
      
      await store.delete(key);
      return json({ ok: true, message: 'Deleted successfully', key });
    }

    // ─── POST /api/upload ────────────────────────────────────────────
    if (context.request.method !== 'POST' || path !== '/api/upload') {
      return json({ ok: false, error: 'Not found' }, 404);
    }

    const request = context.request;
    const contentType = request.headers.get('content-type') || '';
    let fileBuffer;
    let filename = 'upload.png';
    let mimeType = 'image/png';

    // Helper: Convert base64 string to Uint8Array (Web API compatible)
    const base64ToUint8Array = (base64) => {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    };

    // 1. multipart/form-data
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') || formData.get('image') || formData.get('upload');
      
      if (!file || !(file instanceof File)) {
        return json({ ok: false, error: 'Missing file field' }, 400);
      }

      // Validate file size
      if (file.size > CONFIG.MAX_FILE_SIZE) {
        return json({ 
          ok: false, 
          error: `File too large. Max size is ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB` 
        }, 400);
      }

      // Validate file type - use file.type for web File objects
      const ftype = file.type || 'application/octet-stream';
      if (!isValidImageType(ftype)) {
        return json({ 
          ok: false, 
          error: 'Invalid file type. Allowed: ' + CONFIG.ALLOWED_TYPES.join(', ') 
        }, 400);
      }

      fileBuffer = new Uint8Array(await file.arrayBuffer());
      // Get filename from web File object
      filename = file.name || `upload-${Date.now()}.png`;
      mimeType = file.type || 'image/png';
    }
    // 2. JSON with base64
    else if (contentType.includes('application/json')) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Invalid JSON body' }, 400);
      }

      const source = body.base64 || body.data || body.image || body.file;
      if (typeof source !== 'string' || !source.trim()) {
        return json({ ok: false, error: 'Missing base64/data/image/file in JSON body' }, 400);
      }

      // Extract MIME type from data URI if present
      const dataUriMatch = source.match(/^data:(image\/[a-zA-Z0-9+-.]+);base64,/);
      if (dataUriMatch) {
        mimeType = dataUriMatch[1];
        if (!isValidImageType(mimeType)) {
          return json({ ok: false, error: 'Invalid image type in data URI' }, 400);
        }
      }

      const clean = source.replace(/^data:image\/[a-zA-Z0-9+-.]+;base64,/, '').trim();
      
      // Validate base64 length (approximate size check)
      if (clean.length > CONFIG.MAX_FILE_SIZE * 1.37) {
        return json({ ok: false, error: 'Base64 data too large' }, 400);
      }

      fileBuffer = base64ToUint8Array(clean);
      filename = body.filename || body.name || `upload-${Date.now()}${getFileExtension('', mimeType)}`;
      mimeType = body.contentType || mimeType;
    }
    // 3. Raw binary / base64 text
    else {
      const text = await request.text();
      const trimmed = text.trim();
      
      // Try to decode as base64 first
      if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 0) {
        fileBuffer = base64ToUint8Array(trimmed.replace(/\s+/g, ''));
      } else {
        // Treat as raw binary
        fileBuffer = new TextEncoder().encode(text);
      }

      // Validate size
      if (fileBuffer.byteLength > CONFIG.MAX_FILE_SIZE) {
        return json({ ok: false, error: 'File too large' }, 400);
      }

      const inferred = contentType.startsWith('image/') ? contentType : 'image/png';
      mimeType = isValidImageType(inferred) ? inferred : 'image/png';
      filename = `upload-${Date.now()}${getFileExtension('', mimeType)}`;
    }

    // Final validation: must be non-empty
    if (!fileBuffer || fileBuffer.length === 0) {
      return json({ ok: false, error: 'Empty file data' }, 400);
    }

    // Generate unique key with original extension (URL 子链生成)
    const key = generateKey(filename, mimeType);

    // Upload to EdgeOne Blob Storage using direct set
    const store = getStore('functions-test');
    console.error('[upload] About to call store.set with key:', key);

    const result = await store.set(key, fileBuffer, {
      contentType: mimeType
    });
    console.error('[upload] Store set result:', result);

    return json({
      ok: true,
      key,
      url: `${CONFIG.BASE_URL}/${key}`,
      size: fileBuffer.byteLength,
      contentType: mimeType,
      filename: sanitizeFilename(filename)
    }, 200);

  } catch (error) {
    console.error('[upload.js] Error:', error);
    return json({
      ok: false,
      error: error.message || 'Internal server error'
    }, 500);
  }
}
