export default async function onRequest(context) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });

  try {
    if (context.request.method === 'OPTIONS') {
      return json({ ok: true, message: 'CORS preflight OK' });
    }

    if (context.request.method !== 'POST') {
      return json({ ok: false, error: 'Only POST method is supported' }, 405);
    }

    const env = context.env || {};
    const token = env.GITHUB_TOKEN;
    const owner = env.GITHUB_OWNER;
    const repo = env.GITHUB_REPO;
    const branch = env.GITHUB_BRANCH || 'main';

    if (!token || !owner || !repo) {
      return json({ ok: false, error: 'Missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO env vars' }, 500);
    }

    const request = context.request;
    const contentType = request.headers.get('content-type') || '';
    let buffer;
    let filename = 'upload.png';
    let mimeType = 'image/png';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') || formData.get('image') || formData.get('upload');

      if (!file) {
        return json({ ok: false, error: 'Missing file field in multipart/form-data' }, 400);
      }

      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      filename = file.name || filename;
      mimeType = file.type || mimeType;
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      const source = body.base64 || body.data || body.image || body.file;

      if (typeof source !== 'string') {
        return json({ ok: false, error: 'JSON body must contain base64/data/image/file string' }, 400);
      }

      const cleaned = source.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
      buffer = Buffer.from(cleaned, 'base64');
      filename = body.filename || body.name || filename;
      mimeType = body.contentType || mimeType;
    } else if (contentType.startsWith('image/') || contentType.includes('octet-stream')) {
      buffer = Buffer.from(await request.arrayBuffer());
      filename = 'upload.png';
      mimeType = contentType || mimeType;
    } else {
      const text = await request.text();
      const trimmed = text.trim();
      if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 0) {
        buffer = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
      } else {
        const parsed = JSON.parse(trimmed);
        const source = parsed.base64 || parsed.data || parsed.image || parsed.file;
        if (typeof source !== 'string') {
          return json({ ok: false, error: 'Unsupported request body format' }, 400);
        }
        const cleaned = source.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
        buffer = Buffer.from(cleaned, 'base64');
        filename = parsed.filename || parsed.name || filename;
        mimeType = parsed.contentType || mimeType;
      }
    }

    const safeName = String(filename || 'upload.png').replace(/[^a-zA-Z0-9._-]/g, '-');
    const dateDir = new Date().toISOString().slice(0, 10);
    const path = `images/${dateDir}/${Date.now()}-${safeName}`;

    const githubRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'edgeone-pages-uploader',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Upload image ${safeName}`,
        content: buffer.toString('base64'),
        branch
      })
    });

    const githubData = await githubRes.json();
    if (!githubRes.ok) {
      return json({ ok: false, error: githubData?.message || 'GitHub upload failed' }, githubRes.status || 500);
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    const htmlUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;

    return json({
      ok: true,
      message: 'Image uploaded successfully',
      url: rawUrl,
      htmlUrl,
      path,
      filename: safeName,
      contentType: mimeType,
      sha: githubData?.content?.sha
    }, 200);
  } catch (error) {
    return json({ ok: false, error: error.message || 'Unknown upload error' }, 400);
  }
}
