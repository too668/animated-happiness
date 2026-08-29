import { getStore } from '@edgeone/pages-blob';

export default async function onRequest(context) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });

  try {
    // Handle CORS preflight
    if (context.request.method === 'OPTIONS') {
      return json({ ok: true, message: 'CORS preflight OK' });
    }

    const url = new URL(context.request.url);
    const path = url.pathname;

    // GET /api/list - List all images
    if (context.request.method === 'GET' && path === '/api/list') {
      const store = getStore();
      const { blobs } = await store.list({ prefix: 'images/' });
      
      const items = blobs.map(blob => ({
        key: blob.key,
        url: `https://yooy.cc.cd/${blob.key}`,
        size: blob.size,
        contentType: blob.contentType || 'application/octet-stream',
        uploadedAt: blob.uploadedAt || new Date().toISOString()
      }));

      return json({ ok: true, items });
    }

    // DELETE /api/delete?key=...
    if (context.request.method === 'DELETE' && path === '/api/delete') {
      const key = url.searchParams.get('key');
      if (!key) {
        return json({ ok: false, error: 'Missing key parameter' }, 400);
      }

      const store = getStore();
      await store.delete(key);
      return json({ ok: true, message: 'Image deleted successfully' });
    }

    // POST /api/upload - Upload image
    if (context.request.method !== 'POST' || path !== '/api/upload') {
      return json({ ok: false, error: 'Not found' }, 404);
    }

    const request = context.request;
    const contentType = request.headers.get('content-type') || '';
    let fileBuffer;
    let filename = 'upload.png';
    let mimeType = 'image/png';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') || formData.get('image') || formData.get('upload');
      if (!file) {
        return json({ ok: false, error: 'Missing file field in multipart/form-data' }, 400);
      }
      fileBuffer = Buffer.from(await file.arrayBuffer());
      filename = file.name || filename;
      mimeType = file.type || mimeType;
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      const source = body.base64 || body.data || body.image || body.file;
      if (typeof source !== 'string') {
        return json({ ok: false, error: 'JSON body must contain base64/data/image/file string' }, 400);
      }
      const clean = source.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
      fileBuffer = Buffer.from(clean, 'base64');
      filename = body.filename || body.name || filename;
      mimeType = body.contentType || mimeType;
    } else {
      const text = await request.text();
      const trimmed = text.trim();
      if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 0) {
        fileBuffer = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
      } else {
        return json({ ok: false, error: 'Unsupported body format' }, 400);
      }
    }

    const safeName = String(filename || 'upload.png').replace(/[^a-zA-Z0-9._-]/g, '-');
    const dateStr = new Date().toISOString().slice(0, 10);
    const key = `images/${dateStr}/${Date.now()}-${safeName}`;
    const store = getStore();

    const uploadUrl = await store.createUploadUrl(key, {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000'
    });

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: fileBuffer
    });

    if (!uploadRes.ok) {
      return json({ ok: false, error: 'EdgeOne Blob upload failed' }, 500);
    }

    return json({
      ok: true,
      message: 'Image uploaded to EdgeOne Blob Storage',
      key,
      url: `https://yooy.cc.cd/${key}`
    }, 200);
  } catch (error) {
    return json({ ok: false, error: error.message || 'Unknown error' }, 400);
  }
}
