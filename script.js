// ── YOO 图片管理 ──
// 两条上传路径：
//   原图直传 —— 向 /api/upload-url 要签名地址，浏览器把字节直接 PUT 给 Blob（任意格式，≤20MB）
//   压缩中转 —— 仅图片，体积压到 Edge 1MB 请求体上限以下，用原始字节 PUT 给 /api/upload

var RELAY_LIMIT = 950 * 1024;
var DIRECT_LIMIT = 20 * 1024 * 1024;
var IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'];
var NO_COMPRESS_EXT = ['gif', 'svg']; // canvas 会丢动画 / 会把矢量栅格化

var STORAGE_KEY = 'yoo-image-manager-items';
var ALIAS_KEY = 'yoo-image-manager-aliases';

// ── THEME ──
(function () {
  var saved = localStorage.getItem('yoo-theme');
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
})();

function toggleTheme() {
  var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('yoo-theme', next);
}

// ── ICONS ──
var ICONS = {
  upload: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  refresh: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  view: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  copy: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  alias: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  check: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  x: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  spinner: '<svg style="animation:spin 1s linear infinite;width:14px;height:14px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
};

// ── TOAST ──
function showToast(msg, type) {
  type = type || 'info';
  var box = document.getElementById('toastContainer');
  if (!box) return;
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = ({ success: ICONS.check, error: ICONS.x, info: ICONS.info })[type] + '<span>' + esc(msg) + '</span>';
  box.appendChild(t);
  setTimeout(function () {
    t.style.opacity = '0';
    t.style.transform = 'translateX(10px)';
    t.style.transition = 'all 0.3s ease';
    setTimeout(function () { t.remove(); }, 300);
  }, 4000);
}

// ── HELPERS ──
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extOf(name) {
  var s = String(name || '');
  var i = s.lastIndexOf('.');
  return i > 0 ? s.slice(i + 1).toLowerCase() : '';
}

function humanSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

// 前端和 API 同源部署，接口地址就跟着当前来源走
function getApiBase() {
  return location.origin;
}

function getAliases() {
  try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function asyncJson(url, options) {
  return fetch(url, options).then(function (r) {
    return r.text().then(function (text) {
      var data = null;
      try { data = JSON.parse(text); } catch (e) { /* 非 JSON 响应 */ }
      if (!r.ok || !data || data.ok !== true) {
        throw new Error((data && data.error) || 'HTTP ' + r.status + (text ? ' · ' + text.slice(0, 60) : ''));
      }
      return data;
    });
  });
}

// ── 压缩：把图片压到 Edge 请求体上限以下 ──
function compressToLimit(file, limit) {
  if (file.size <= limit && IMAGE_EXT.indexOf(extOf(file.name)) >= 0) {
    return Promise.resolve(file);
  }
  if (NO_COMPRESS_EXT.indexOf(extOf(file.name)) >= 0 || extOf(file.name) === 'bmp') {
    return Promise.reject(new Error(
      extOf(file.name) === 'bmp'
        ? 'BMP 不压缩且体积通常超限，请改用「原图直传」'
        : 'GIF / SVG 压缩会丢动画或变栅格图，请改用「原图直传」'
    ));
  }

  return createImageBitmap(file).then(function (bitmap) {
    var maxEdge = 4096;
    var quality = 0.85;
    var attempt = 0;

    function tryOnce() {
      attempt++;
      var scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);

      var type = extOf(file.name) === 'png' ? 'image/png' : 'image/jpeg';
      var outName = file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg');

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('压缩失败'));
          if (blob.size <= limit || attempt >= 5) {
            if (blob.size > limit) {
              return reject(new Error('压缩 5 次仍超过 ' + humanSize(limit) + '，请改用「原图直传」'));
            }
            blob.name = outName;
            resolve({ blob: blob, name: outName, from: file.size, to: blob.size });
          } else {
            quality *= 0.7;
            maxEdge = Math.round(maxEdge * 0.75);
            resolve(tryOnce());
          }
        }, type, quality);
      });
    }

    return tryOnce();
  });
}

// ── 上传 ──
function uploadDirect(file) {
  var base = getApiBase();
  var contentType = file.type || 'application/octet-stream';
  var storage = document.getElementById('storageSelect') ? document.getElementById('storageSelect').value : 'blob';
  
  return asyncJson(base + '/api/upload-url?storage=' + encodeURIComponent(storage), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, size: file.size, contentType: contentType })
  }).then(function (signed) {
    // Content-Type 被签进了地址，必须原样回传。注意：被拒的写不会给可读的 403，
    // 存储网关直接掐断连接，fetch 是以 TypeError('Failed to fetch') 拒绝的。
    return fetch(signed.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': signed.contentType || contentType } })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('直传写入失败 HTTP ' + r.status + (t ? ' · ' + t.slice(0, 80) : '')); });
        return { key: signed.key, url: signed.url, name: file.name, size: file.size, mode: '直传', storage: signed.storage || storage };
      })
      .catch(function (e) {
        if (e instanceof TypeError) throw new Error('直传连接被中断，文件未上传成功。请重试，或改用「压缩中转」模式');
        throw e;
      });
  });
}

function uploadRelay(file) {
  if (IMAGE_EXT.indexOf(extOf(file.name)) < 0 && !/^image\//.test(file.type || '')) {
    return Promise.reject(new Error('中转只收图片，请用「原图直传」'));
  }
  var base = getApiBase();
  var storage = document.getElementById('storageSelect') ? document.getElementById('storageSelect').value : 'blob';
  
  return compressToLimit(file, RELAY_LIMIT).then(function (r) {
    var blob = r.blob || file;
    var name = r.name || file.name;
    return asyncJson(base + '/api/upload?name=' + encodeURIComponent(name) + '&storage=' + encodeURIComponent(storage), {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'image/png' },
      body: blob
    }).then(function (res) {
      if (r.to) showToast(name + '：' + humanSize(r.from) + ' → ' + humanSize(r.to), 'info');
      return { key: res.key, url: res.url, name: name, size: res.size, mode: '中转', storage: res.storage || storage };
    });
  });
}

function uploadFiles(files) {
  if (!files || !files.length) { showToast('请选择文件', 'error'); return Promise.resolve(); }
  var buttons = document.querySelectorAll('#dropZone button, #uploadBtn');
  Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
  var zone = document.getElementById('dropZone');
  var zoneText = zone ? zone.querySelector('p strong') : null;
  var original = zoneText ? zoneText.textContent : '';

  var list = getSavedList();
  var ok = 0, failed = [];
  var chain = Promise.resolve();

  var mode = currentMode();
  function runUpload(file) {
    if (mode === 'relay') {
      return uploadRelay(file).catch(function (e) {
        // 非图片 / GIF / SVG / BMP 中转不支持，自动退回原图直传
        if (/只收图片|GIF|SVG|BMP/.test(e.message)) return uploadDirect(file);
        throw e;
      });
    }
    return uploadDirect(file);
  }

  Array.prototype.forEach.call(files, function (file, i) {
    chain = chain.then(function () {
      if (zoneText) zoneText.textContent = '上传中 ' + (i + 1) + '/' + files.length + '：' + file.name;
      return runUpload(file).then(function (item) {
        list.unshift({ key: item.key, url: item.url, name: item.name, size: item.size, uploadedAt: Date.now() });
        ok++;
      }).catch(function (e) {
        failed.push(file.name + '：' + e.message);
      });
    });
  });

  return chain.then(function () {
    saveList(list);
    renderList(list);
    if (zoneText) zoneText.textContent = original;
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
    if (ok) showToast('成功上传 ' + ok + ' 个文件', 'success');
    if (failed.length) {
      showToast(failed.length + ' 个文件上传失败：' + failed[0], 'error');
      console.warn('上传失败明细:', failed);
    }
    if (ok) return syncFromServer();
  });
}

// ── STORAGE ──
function getSavedList() {
  try {
    var s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(s) ? s : [];
  } catch (e) { return []; }
}

function saveList(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  updateCounts(items);
}

function updateCounts(items) {
  var el = document.getElementById('totalCount');
  if (el) el.textContent = items.length;
  var label = document.getElementById('countLabel');
  if (label) label.textContent = '共 ' + items.length + ' 张';
}

// ── 服务器同步 ──
var nextCursor = null;

function syncFromServer() {
  var storage = document.getElementById('storageSelect') ? document.getElementById('storageSelect').value : 'blob';
  return asyncJson(getApiBase() + '/api/list?limit=100&storage=' + encodeURIComponent(storage))
    .then(function (res) {
      var aliases = getAliases();
      var items = res.items.map(function (it) {
        return {
          key: it.key,
          name: aliases[it.key] || it.name,
          aliasOnly: Boolean(aliases[it.key]),
          url: it.url,
          type: it.type,
          storage: it.storage || 'blob',
          uploadedAt: null
        };
      });
      saveList(items);
      if (typeof res.total === 'number') {
        var tc = document.getElementById('totalCount');
        if (tc) tc.textContent = res.total;
        var cl = document.getElementById('countLabel');
        if (cl) cl.textContent = '共 ' + res.total + ' 张';
      }
      renderList(items);
      nextCursor = res.nextCursor || null;
      return items;
    })
    .catch(function (e) {
      showToast('读取服务器列表失败：' + e.message, 'error');
      return getSavedList();
    });
}

function loadMore() {
  if (!nextCursor) return Promise.resolve();
  var storage = document.getElementById('storageSelect') ? document.getElementById('storageSelect').value : 'blob';
  return asyncJson(getApiBase() + '/api/list?limit=100&storage=' + encodeURIComponent(storage) + '&cursor=' + encodeURIComponent(nextCursor))
    .then(function (res) {
      var existing = {};
      var items = getSavedList();
      items.forEach(function (it) { existing[it.key] = true; });
      var merged = items.concat(res.items.filter(function (it) { return !existing[it.key]; }));
      nextCursor = res.nextCursor || null;
      saveList(merged);
      renderList(merged);
      if (!res.hasMore) showToast('已经到底了', 'info');
    })
    .catch(function (e) { showToast('加载更多失败：' + e.message, 'error'); });
}

function deleteItem(key) {
  var storage = document.getElementById('storageSelect') ? document.getElementById('storageSelect').value : 'blob';
  return asyncJson(getApiBase() + '/api/delete?key=' + encodeURIComponent(key) + '&storage=' + encodeURIComponent(storage), { method: 'DELETE' })
    .then(function () { return true; })
    .catch(function (e) {
      if (/不存在/.test(e.message)) return true; // 服务器上已经没有了，本地照清
      throw e;
    });
}

// ── RENDER ──
function renderList(items) {
  var root = document.getElementById('imageList');
  if (!root) return;
  var input = document.getElementById('searchInput');
  var q = input ? input.value.trim().toLowerCase() : '';
  var filtered = q ? items.filter(function (it) { return String(it.name).toLowerCase().indexOf(q) >= 0; }) : items;

  var moreBtn = '';
  if (!q && nextCursor) {
    moreBtn = '<button id="loadMoreBtn" class="button secondary" type="button" style="grid-column:1/-1;justify-self:center;margin-top:8px;">加载更早的图片</button>';
  }

  if (!filtered.length) {
    root.innerHTML = '<div class="empty"><i data-lucide="image" class="icon-lg" style="opacity:0.3;"></i><p>' +
      (q ? '没有匹配「' + esc(q) + '」的图片' : '暂无图片，上传第一张吧！') + '</p></div>' + moreBtn;
    refreshIcons();
    bindMore();
    return;
  }

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var it = filtered[i];
    var ext = extOf(it.key || it.name).toUpperCase();
    var storageLabel = it.storage === 's3' ? '<span class="badge info" style="font-size:0.65rem;margin-left:6px;">S3</span>' : '<span class="badge success" style="font-size:0.65rem;margin-left:6px;">Blob</span>';
    html += '<div class="image-item" data-key="' + esc(it.key) + '">' +
      '<img src="' + esc(it.url) + '" alt="' + esc(it.name) + '" loading="lazy" />' +
      '<div class="image-meta">' +
        '<strong title="' + esc(it.name) + '">' + esc(it.name) + '</strong>' +
        '<div class="muted">' + esc(ext || '文件') + (it.size ? ' · ' + esc(humanSize(it.size)) : '') + (it.aliasOnly ? ' · 别名' : '') + '</div>' +
        '<div class="row-inline">' +
          '<button class="small-btn" data-a="view" data-k="' + esc(it.key) + '" title="新标签页打开">' + ICONS.view + '</button>' +
          '<button class="small-btn" data-a="copy" data-k="' + esc(it.key) + '" title="复制链接">' + ICONS.copy + '</button>' +
          '<button class="small-btn" data-a="alias" data-k="' + esc(it.key) + '" title="设置显示别名">' + ICONS.alias + '</button>' +
          '<button class="small-btn danger" data-a="delete" data-k="' + esc(it.key) + '" title="删除">' + ICONS.trash + '</button>' +
        '</div></div><div class="row-inline" style="margin-top:4px;">' + storageLabel + '</div></div>';
  }
  root.innerHTML = html + moreBtn;
  refreshIcons();
  bindMore();

  Array.prototype.forEach.call(root.querySelectorAll('.small-btn'), function (btn) {
    btn.addEventListener('click', function () {
      var act = btn.dataset.a;
      var key = btn.dataset.k;
      var target = getSavedList().find(function (it) { return it.key === key; });
      if (!target) return;

      if (act === 'view') {
        window.open(target.url, '_blank');
      } else if (act === 'copy') {
        copyText(target.url);
      } else if (act === 'alias') {
        var nn = window.prompt('设置显示别名（只影响本浏览器的显示，不会改服务器上的文件名）', target.name);
        if (!nn || !nn.trim()) return;
        var aliases = getAliases();
        aliases[key] = nn.trim();
        localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases));
        var up = getSavedList().map(function (it) {
          return it.key === key ? Object.assign({}, it, { name: nn.trim(), aliasOnly: true }) : it;
        });
        saveList(up); renderList(up);
        showToast('已设置别名（本地显示）', 'success');
      } else if (act === 'delete') {
        if (!window.confirm('删除这张图？存储里的原件会立刻消失；由于边缘节点有缓存，旧链接最多还会被人看到一小时，之后变成 404。')) return;
        var orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = ICONS.spinner;
        deleteItem(key).then(function () {
          var aliases = getAliases();
          delete aliases[key];
          localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases));
          var up2 = getSavedList().filter(function (it) { return it.key !== key; });
          saveList(up2); renderList(up2);
          showToast('已删除', 'success');
        }).catch(function (e) {
          showToast('删除失败：' + e.message, 'error');
        }).finally(function () {
          btn.disabled = false;
          btn.innerHTML = orig;
        });
      }
    });
  });
}

function bindMore() {
  var b = document.getElementById('loadMoreBtn');
  if (b) b.addEventListener('click', function () {
    b.disabled = true;
    b.innerHTML = ICONS.spinner + ' 加载中...';
    loadMore().then(function () { b.disabled = false; });
  });
}

function copyText(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      function () { showToast(msg || '链接已复制', 'success'); },
      function () { showToast('复制失败，请手动选取', 'error'); }
    );
  } else {
    showToast('此浏览器不支持自动复制', 'error');
  }
}

function refreshIcons() {
  if (window.lucide) { try { window.lucide.createIcons(); } catch (e) { /* 图标库未加载 */ } }
}

// ── EVENTS ──
function attachEvents() {
  var storageSelect = document.getElementById('storageSelect');
  var modeHint = document.getElementById('modeHint');
  var dropHint = document.getElementById('dropHint');

function currentStorage() {
  return document.getElementById('storageSelect') ? document.getElementById('storageSelect').value : 'blob';
}
function currentMode() {
  return document.getElementById('uploadMode') ? document.getElementById('uploadMode').value : 'direct';
}

// 压缩中转只走 Blob（后端 /api/upload 写死 Blob）；S3 下禁掉该选项并强制直传
function syncStorageMode() {
  var relayOpt = document.querySelector('#uploadMode option[value="relay"]');
  if (relayOpt) relayOpt.disabled = currentStorage() === 's3';
  var modeEl = document.getElementById('uploadMode');
  if (modeEl && modeEl.value === 'relay' && currentStorage() === 's3') {
    modeEl.value = 'direct';
  }
  refreshUploadHint();
}

function refreshUploadHint() {
  if (!modeHint) return;
  var s = currentStorage();
  var m = currentMode();
  var storageTxt = s === 's3'
    ? '<strong>iDrive e2 S3</strong>：直传到 S3 桶，最大 5GB，任意格式。'
    : '<strong>腾讯云 Blob</strong>：直传到 Blob 存储，最大 20MB，任意格式。';
  var modeTxt = m === 'relay'
    ? ' <span style="color:var(--warning)">压缩中转：</span>字节经过函数代理，仅收图片，超过 950KB 前端自动压（GIF / SVG 超限请改用直传）。'
    : ' <span style="color:var(--brand)">原图直传：</span>字节不经函数，保留原图，任意格式。';
  modeHint.innerHTML = storageTxt + modeTxt;
}

function applyStorage() {
  syncStorageMode();
  if (dropHint) dropHint.textContent = '任意格式 · 可多选';
  syncFromServer();
}

if (storageSelect) storageSelect.addEventListener('change', applyStorage);
var uploadModeEl = document.getElementById('uploadMode');
if (uploadModeEl) uploadModeEl.addEventListener('change', refreshUploadHint);

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'uploadInput') {
      if (e.target.files.length) {
        uploadFiles(e.target.files);
        e.target.value = '';
      }
    }
  });

  var ubtn = document.getElementById('uploadBtn');
  if (ubtn) ubtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var inp = document.getElementById('uploadInput');
    if (inp) inp.click();
  });

  var rbtn = document.getElementById('refreshListBtn');
  if (rbtn) rbtn.addEventListener('click', function () {
    rbtn.disabled = true;
    var oh = rbtn.innerHTML;
    rbtn.innerHTML = ICONS.spinner + ' 同步中...';
    syncFromServer().then(function () {
      rbtn.disabled = false;
      rbtn.innerHTML = oh;
    });
  });

  var sinp = document.getElementById('searchInput');
  if (sinp) sinp.addEventListener('input', function () { renderList(getSavedList()); });

  var dz = document.getElementById('dropZone');
  var up = document.getElementById('uploadInput');
  if (dz) {
    dz.addEventListener('click', function () { if (up) up.click(); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files.length) {
        uploadFiles(e.dataTransfer.files);
      }
    });
  }

  syncStorageMode();
}

// ── TABS ──
function initTabs() {
  var tabs = document.querySelectorAll('.admin-tab[data-tab]');
  if (!tabs.length) return;
  var TAB_KEY = 'yoo-admin-tab';

  function activate(name) {
    Array.prototype.forEach.call(tabs, function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var images = document.getElementById('panel-images');
    var keys = document.getElementById('panel-keys');
    if (images) images.classList.toggle('hidden', name !== 'images');
    if (keys) keys.classList.toggle('hidden', name !== 'keys');
    localStorage.setItem(TAB_KEY, name);
  }

  Array.prototype.forEach.call(tabs, function (t) {
    t.addEventListener('click', function () { activate(t.dataset.tab); });
  });
  activate(localStorage.getItem(TAB_KEY) === 'keys' ? 'keys' : 'images');
}

// ── API KEYS ──
var PERMS_ALL = ['upload', 'list', 'delete'];
var PERM_LABEL = { upload: '上传', list: '列表', delete: '删除' };

function fmtDate(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function loadKeys() {
  return asyncJson(getApiBase() + '/api/keys').then(function (res) {
    renderKeys(res.keys || []);
  }).catch(function (e) {
    showToast('读取 API key 列表失败：' + e.message, 'error');
  });
}

function renderKeys(keys) {
  var root = document.getElementById('keyList');
  if (!root) return;
  if (!keys || !keys.length) {
    root.innerHTML = '<p class="muted" style="font-size:0.82rem;margin:0;">还没有 API key，用上面的表单创建一个。</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var perms = '';
    for (var j = 0; j < PERMS_ALL.length; j++) {
      var p = PERMS_ALL[j];
      perms += '<label class="perm-label"><input type="checkbox" data-perm="' + p + '"' +
        (k.perms.indexOf(p) >= 0 ? ' checked' : '') + ' /><span>' + PERM_LABEL[p] + '</span></label>';
    }
    html += '<div class="key-row" data-id="' + esc(k.id) + '">' +
      '<div class="key-info"><strong>' + esc(k.name) + '</strong>' +
      '<div class="muted"><code>' + esc(k.prefix) + '····</code> · 创建于 ' + esc(fmtDate(k.createdAt)) + '</div></div>' +
      '<div class="row-inline">' + perms +
      '<button class="small-btn danger" data-a="delkey" data-k="' + esc(k.id) + '" title="吊销">' + ICONS.trash + '</button>' +
      '</div></div>';
  }
  root.innerHTML = html;

  Array.prototype.forEach.call(root.querySelectorAll('.key-row'), function (row) {
    Array.prototype.forEach.call(row.querySelectorAll('input[data-perm]'), function (cb) {
      cb.addEventListener('change', function () { updateKeyPerms(row); });
    });
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-a="delkey"]'), function (btn) {
    btn.addEventListener('click', function () {
      if (!window.confirm('吊销这个 API key？使用它的脚本会立刻失去访问权限，且无法恢复。')) return;
      deleteKey(btn.dataset.k, btn);
    });
  });
}

function updateKeyPerms(row) {
  var id = row.dataset.id;
  var perms = [];
  var boxes = row.querySelectorAll('input[data-perm]');
  Array.prototype.forEach.call(boxes, function (cb) {
    if (cb.checked) perms.push(cb.dataset.perm);
  });
  if (!perms.length) {
    showToast('至少保留一项权限，如需停用请直接吊销', 'error');
    loadKeys();
    return;
  }
  Array.prototype.forEach.call(boxes, function (cb) { cb.disabled = true; });
  asyncJson(getApiBase() + '/api/keys', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id, perms: perms })
  }).then(function () {
    showToast('权限已更新', 'success');
    loadKeys();
  }).catch(function (e) {
    showToast('更新失败：' + e.message, 'error');
    loadKeys();
  });
}

function createKey() {
  var nameEl = document.getElementById('keyName');
  var perms = [];
  if (document.getElementById('permUpload').checked) perms.push('upload');
  if (document.getElementById('permList').checked) perms.push('list');
  if (document.getElementById('permDelete').checked) perms.push('delete');
  if (!perms.length) { showToast('至少选择一项权限', 'error'); return; }

  var btn = document.getElementById('createKeyBtn');
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = ICONS.spinner + ' 创建中...';
  asyncJson(getApiBase() + '/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nameEl.value, perms: perms })
  }).then(function (res) {
    var box = document.getElementById('keySecretBox');
    var txt = document.getElementById('keySecretText');
    if (txt) txt.textContent = res.secret;
    if (box) box.style.display = 'block';
    nameEl.value = '';
    showToast('创建成功，密钥只显示这一次', 'success');
    loadKeys();
  }).catch(function (e) {
    showToast('创建失败：' + e.message, 'error');
  }).finally(function () {
    btn.disabled = false;
    btn.innerHTML = orig;
  });
}

function deleteKey(id, btn) {
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = ICONS.spinner;
  asyncJson(getApiBase() + '/api/keys?id=' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function () {
      showToast('已吊销', 'success');
      loadKeys();
    })
    .catch(function (e) {
      showToast('吊销失败：' + e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = orig;
    });
}

function initKeys() {
  var form = document.getElementById('createKeyForm');
  if (!form) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    createKey();
  });
  var copyBtn = document.getElementById('keySecretCopy');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var txt = document.getElementById('keySecretText');
    if (txt && txt.textContent) copyText(txt.textContent, '密钥已复制');
  });
  loadKeys();
}

// ── 密码门禁 ──
// 密码在后端校验（环境变量 ADMIN_PASSWORD），这里只负责问后端、显隐界面。
function initGate(appId, onAuthed) {
  var gate = document.getElementById('loginGate');
  var app = document.getElementById(appId);
  if (!gate || !app) { onAuthed(); return; }

  var form = document.getElementById('loginForm');
  var input = document.getElementById('loginPassword');
  var errEl = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');

  function enter() {
    gate.hidden = true;
    app.hidden = false;
    onAuthed();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errEl.style.display = 'none';
    btn.disabled = true;
    fetch(getApiBase() + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value })
    }).then(function (r) {
      return r.text().then(function (text) {
        var d = null;
        try { d = JSON.parse(text); } catch (e2) { /* 非 JSON */ }
        return { ok: r.ok, d: d };
      });
    }).then(function (res) {
      btn.disabled = false;
      if (res.ok && res.d && res.d.authed) {
        input.value = '';
        enter();
        showToast('已解锁，7 天内刷新不用重填', 'success');
      } else {
        errEl.textContent = (res.d && res.d.error) || '密码错误';
        errEl.style.display = 'block';
      }
    }).catch(function () {
      btn.disabled = false;
      errEl.textContent = '网络异常，请稍后再试';
      errEl.style.display = 'block';
    });
  });

  var logout = document.getElementById('logoutBtn');
  if (logout) logout.addEventListener('click', function () {
    logout.disabled = true;
    fetch(getApiBase() + '/api/logout', { method: 'POST' })
      .finally(function () { location.reload(); });
  });

  fetch(getApiBase() + '/api/auth-status').then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.ok && d.authed) {
      enter();
    } else {
      gate.hidden = false;
      setTimeout(function () { input.focus(); }, 50);
    }
  }).catch(function () {
    gate.hidden = false;
  });
}

// ── BOOT ──
(function () {
  var st = document.createElement('style');
  st.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(st);

  document.addEventListener('DOMContentLoaded', function () {
    var tb = document.getElementById('themeToggle');
    if (tb) tb.addEventListener('click', toggleTheme);
    refreshIcons();
    if (!document.getElementById('imageList')) return;
    initGate('adminApp', function () {
      var cached = getSavedList();
      updateCounts(cached);
      renderList(cached);
      attachEvents();
      initTabs();
      initKeys();
      syncFromServer();
    });
  });
})();
