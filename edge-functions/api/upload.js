import { getStore } from '@edgeone/pages-blob';

/**
 * EdgeOne Pages Function - Image Upload API
 * 
 * Endpoints:
 *   POST /api/upload   - Upload image (multipart/base64/raw)
 *   GET  /api/list     - List all images
 *   DELETE /api/delete - Delete image by key
 * 
 * Deployment: edge-functions/api/upload.js
 * Domain: https://yooy.cc.cd
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });

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
      const store = getStore();
      const { blobs } = await store.list({ prefix: 'images/' });

      const items = blobs.map(blob => ({
        key: blob.key,
        url: `https://yooy.cc.cd/${blob.key}`,
        size: blob.size || 0,
        contentType: blob.contentType || 'application/octet-stream',
        uploadedAt: blob.uploadedAt || new Date().toISOString()
      }));

      return json({ ok: true, items, total: items.length });
    }

    // ─── DELETE /api/delete?key=... ──────────────────────────────────
    if (context.request.method === 'DELETE' && path === '/api/delete') {
      const key = url.searchParams.get('key');
      if (!key) {
        return json({ ok: false, error: 'Missing key parameter' }, 400);
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
      fileBuffer = Buffer.from(await file.arrayBuffer());
      filename = file.name || filename;
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
      const clean = source.replace(/^data:image\/[a-zA-Z0-9+-.]+;base64,/, '').trim();
      fileBuffer = Buffer.from(clean, 'base64');
      filename = body.filename || body.name || filename;
      mimeType = body.contentType || mimeType;
    }
    // 3. Raw binary / base64 text
    else {
      const text = await request.text();
      const trimmed = text.trim();
      if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 0) {
        fileBuffer = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
      } else {
        // Treat as raw binary
        fileBuffer = Buffer.from(text);
      }
      const inferred = contentType.startsWith('image/') ? contentType : 'image/png';
      mimeType = inferred;
    }

    // Validate: must be non-empty
    if (!fileBuffer || fileBuffer.length === 0) {
      return json({ ok: false, error: 'Empty file data' }, 400);
    }

    // Generate unique key
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '-');
    const dateStr = new Date().toISOString().slice(0, 10);
    const key = `images/${dateStr}/${Date.now()}-${safeName}`;

    // Upload to EdgeOne Blob Storage
    const store = getStore();
    const presignedUrl = await store.createUploadUrl(key, {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000'
    });

    const uploadRes = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: fileBuffer
    });

    if (!uploadRes.ok) {
      return json({ ok: false, error: 'Storage upload failed' }, 500);
    }

    return json({
      ok: true,
      key,
      url: `https://yooy.cc.cd/${key}`,
      size: fileBuffer.length,
      contentType: mimeType
    }, 200);

  } catch (error) {
    console.error('[upload.js] Unexpected error:', error);
    return json({ ok: false, error: error.message || 'Internal server error' }, 500);
  }
}
