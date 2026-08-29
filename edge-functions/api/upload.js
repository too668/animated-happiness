import { createJsonResponse, getGithubEnv, parseUploadRequest, uploadToGitHub } from '../../lib/github-upload.js';

export default async function onRequest(context) {
  try {
    if (context.request.method === 'OPTIONS') {
      return createJsonResponse({ ok: true, message: 'CORS preflight OK' }, 200);
    }

    if (context.request.method !== 'POST') {
      return createJsonResponse({ ok: false, error: 'Only POST is supported' }, 405);
    }

    const { githubToken, owner, repo, branch } = getGithubEnv(context);
    const { buffer, filename, contentType } = await parseUploadRequest(context.request);

    const result = await uploadToGitHub({
      githubToken,
      owner,
      repo,
      branch,
      filename,
      buffer,
      contentType
    });

    return createJsonResponse({
      ok: true,
      message: 'Image uploaded successfully',
      url: result.url,
      htmlUrl: result.htmlUrl,
      path: result.path,
      filename: result.filename,
      contentType: result.contentType,
      sha: result.sha
    }, 200);
  } catch (error) {
    return createJsonResponse({
      ok: false,
      error: error.message || 'Unknown upload error'
    }, 400);
  }
}
