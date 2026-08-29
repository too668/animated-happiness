function normalizeFileName(inputName = 'upload') {
  const raw = String(inputName || 'upload').trim();
  const base = raw.split(/[\\/]+/).pop() || 'upload';
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
  return safe || 'upload';
}

function pickFileName(fileName, fallbackExt = 'png') {
  const normalized = normalizeFileName(fileName || 'upload');
  if (normalized.includes('.')) return normalized;
  return `${normalized}.${fallbackExt}`;
}

function getContentTypeFromExtension(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function decodeBase64Input(value) {
  const clean = String(value || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
  if (!clean) {
    throw new Error('Base64 payload is empty');
  }
  return Buffer.from(clean, 'base64');
}

function getBase64String(data) {
  if (typeof data === 'string') {
    if (data.startsWith('data:')) return data.split(',')[1];
    return data;
  }
  return Buffer.from(data).toString('base64');
}

export async function parseUploadRequest(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') || formData.get('image') || formData.get('upload');

    if (!file) {
      throw new Error('No file uploaded. Use key file/image/upload in multipart form-data.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = pickFileName(file.name || 'upload.png');
    return {
      buffer,
      filename,
      contentType: file.type || getContentTypeFromExtension(filename)
    };
  }

  if (contentType.includes('application/json')) {
    const body = await request.json();

    if (!body) {
      throw new Error('Empty JSON body provided');
    }

    const source = body.base64 || body.data || body.image || body.file;

    if (typeof source !== 'string') {
      throw new Error('JSON body must include base64/data/image or file string');
    }

    const buffer = decodeBase64Input(source);
    const filename = pickFileName(body.filename || body.name || 'upload.png');
    const inferredType = body.contentType || getContentTypeFromExtension(filename);
    return { buffer, filename, contentType: inferredType };
  }

  const rawText = await request.text();
  if (!rawText) {
    throw new Error('Request body is empty');
  }

  const maybeJson = (() => {
    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  })();

  if (maybeJson && typeof maybeJson === 'object') {
    const source = maybeJson.base64 || maybeJson.data || maybeJson.image || maybeJson.file;
    if (typeof source === 'string') {
      const buffer = decodeBase64Input(source);
      const filename = pickFileName(maybeJson.filename || maybeJson.name || 'upload.png');
      return { buffer, filename, contentType: maybeJson.contentType || getContentTypeFromExtension(filename) };
    }
  }

  if (/^(?:[A-Za-z0-9+/]+={0,2})+$/.test(rawText.trim()) && rawText.trim().length > 0) {
    const buffer = Buffer.from(rawText.trim(), 'base64');
    return { buffer, filename: pickFileName('upload.png'), contentType: 'image/png' };
  }

  const buffer = Buffer.from(rawText, 'utf-8');
  return { buffer, filename: pickFileName('upload.png'), contentType: 'text/plain' };
}

export async function uploadToGitHub({
  githubToken,
  owner,
  repo,
  branch,
  filename,
  buffer,
  contentType
}) {
  if (!githubToken || !owner || !repo) {
    throw new Error('Missing GitHub auth config: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO');
  }

  const dateDir = new Date().toISOString().slice(0, 10);
  const unsafeName = normalizeFileName(filename || 'upload.png');
  const path = `images/${dateDir}/${unsafeName}`;
  const base64Content = buffer.toString('base64');

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'edgeone-image-uploader',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Upload image ${unsafeName}`,
      content: base64Content,
      branch: branch || 'main'
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMessage = data?.message || 'GitHub upload failed';
    throw new Error(`GitHub upload failed: ${errorMessage}`);
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch || 'main'}/${path}`;
  const htmlUrl = `https://github.com/${owner}/${repo}/blob/${branch || 'main'}/${path}`;

  return {
    ok: true,
    path,
    url: rawUrl,
    htmlUrl,
    sha: data.content?.sha,
    contentType,
    filename: unsafeName
  };
}

export function getGithubEnv(context) {
  const env = context?.env || {};
  return {
    githubToken: env.GITHUB_TOKEN || process.env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER || process.env.GITHUB_OWNER,
    repo: env.GITHUB_REPO || process.env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH || process.env.GITHUB_BRANCH || 'main'
  };
}

export function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
