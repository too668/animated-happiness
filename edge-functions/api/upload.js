import { getStore } from '@edgeone/pages-blob';

/**
 * EdgeOne Pages Function - Image Upload API (Optimized Version)
 * 
 * Features:
 *   - Multiple upload methods (multipart/form-data, base64, raw binary)
 *   - Image list with pagination
 *   - Delete by key
 *   - CORS support
 *   - Input validation and sanitization
 *   - Error handling
 * 
 * Endpoints:
 *   POST /api/upload   - Upload image
 *   GET  /api/list     - List all images (supports ?limit=&cursor=)
 *   DELETE /api/delete - Delete image by key
 *   OPTIONS            - CORS preflight
 * 
 * Deployment: edge-functions/api/upload.js
 * Domain: https://yooy.cc.cd
 */

// Configuration
const CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
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

// Helper: Validate image type
function isValidImageType(mimeType) {
  if (!mimeType) return false;
  return CONFIG.ALLOWED_TYPES.includes(mimeType.toLowerCase());
}

// Helper: Sanitize filename
function sanitizeFilename(filename) {
  return String(filename || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 100);
}

// Helper: Generate unique key
function generateKey(filename) {
  const safeName = sanitizeFilename(filename);
  const dateStr = new Date().toISOString().slice(0, 10);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `images/${dateStr}/${timestamp}-${random}-${safeName}`;
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

      const store = getStore();
      const options = { prefix: 'images/', limit };
      if (cursor) options.cursor = cursor;

      const result = await store.list(options);

      const items = (result.blobs || []).map(blob => ({
        key: blob.key,
        url: `${CONFIG.BASE_URL}/${blob.key}`,
        size: blob.size || 0,
        contentType: blob.contentType || 'application/octet-stream',
        uploadedAt: blob.uploadedAt || new Date().toISOString()
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
      if (!key || !key.startsWith('images/')) {
        return json({ ok: false, error: 'Invalid or missing key parameter' }, 400);
      }

      const store = getStore();
      await store.delete(key);
      return json({ ok: true, message: 'Deleted successfully' });
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

      // Validate file type
      if (!isValidImageType(file.type)) {
        return json({ 
          ok: false, 
          error: 'Invalid file type. Allowed: ' + CONFIG.ALLOWED_TYPES.join(', ') 
        }, 400);
      }

      fileBuffer = Buffer.from(await file.arrayBuffer());
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
      if (clean.length > CONFIG.MAX_FILE_SIZE * 1.37) { // base64 expands by ~37%
        return json({ ok: false, error: 'Base64 data too large' }, 400);
      }

      fileBuffer = Buffer.from(clean, 'base64');
      filename = body.filename || body.name || `upload-${Date.now()}.png`;
      mimeType = body.contentType || mimeType;
    }
    // 3. Raw binary / base64 text
    else {
      const text = await request.text();
      const trimmed = text.trim();
      
      // Try to decode as base64 first
      if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 0) {
        fileBuffer = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
      } else {
        // Treat as raw binary
        fileBuffer = Buffer.from(text);
      }

      // Validate size
      if (fileBuffer.length > CONFIG.MAX_FILE_SIZE) {
        return json({ ok: false, error: 'File too large' }, 400);
      }

      const inferred = contentType.startsWith('image/') ? contentType : 'image/png';
      mimeType = isValidImageType(inferred) ? inferred : 'image/png';
    }

    // Final validation: must be non-empty
    if (!fileBuffer || fileBuffer.length === 0) {
      return json({ ok: false, error: 'Empty file data' }, 400);
    }

    // Generate unique key
    const key = generateKey(filename);

    // Upload to EdgeOne Blob Storage
    const store = getStore();
    const presignedUrl = await store.createUploadUrl(key, {
      contentType: mimeType,
      cacheControl: CONFIG.CACHE_CONTROL
    });

    const uploadRes = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: fileBuffer
    });

    if (!uploadRes.ok) {
      console.error('Storage upload failed:', uploadRes.status, uploadRes.statusText);
      return json({ ok: false, error: 'Storage upload failed' }, 500);
    }

    return json({
      ok: true,
      key,
      url: `${CONFIG.BASE_URL}/${key}`,
      size: fileBuffer.length,
      contentType: mimeType,
      filename: sanitizeFilename(filename)
    }, 200);

  } catch (error) {
    console.error('[upload.js] Unexpected error:', error);
    return json({ 
      ok: false, 
      error: error.message || 'Internal server error' 
    }, 500);
  }
}
