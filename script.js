// ── YOO Image Manager - Clean Rebuild ──

var STORAGE_KEY = 'yoo-image-manager-items';
var API_BASE = 'https://yooy.cc.cd';

// ── THEME ──
(function() {
  var saved = localStorage.getItem('yoo-theme');
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('yoo-theme', next);
}

// ── ICONS ──
var ICONS = {
  upload: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  refresh: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  view: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  copy: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  rename: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
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
  var icons = { success: ICONS.check, error: ICONS.x, info: ICONS.info };
  t.innerHTML = (icons[type] || ICONS.info) + '<span>' + msg + '</span>';
  box.appendChild(t);
  setTimeout(function() {
    t.style.opacity = '0';
    t.style.transform = 'translateX(10px)';
    t.style.transition = 'all 0.3s ease';
    setTimeout(function() { t.remove(); }, 300);
  }, 3000);
}

// ── STORAGE ──
function getSavedList() {
  try {
    var s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(s) ? s : [];
  } catch(e) { return []; }
}
function saveList(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  var el = document.getElementById('totalCount');
  if (el) el.textContent = items.length + ' 张图片';
}

// ── HELPERS ──
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getApiBase() {
  var el = document.getElementById('apiEndpoint');
  return (el ? el.value.trim() : '') || API_BASE;
}

async function fetchApi(ep, opts) {
  opts = opts || {};
  var url = getApiBase() + ep;
  var r = await fetch(url, opts);
  if (!r.ok) {
    var txt = await r.text().catch(function(){ return ''; });
    throw new Error('HTTP ' + r.status + (txt ? ': ' + txt.substring(0,80) : ''));
  }
  return await r.json();
}

// ── API CALLS ──
async function loadFromServer() {
  try {
    var res = await fetchApi('/api/list');
    if (res && res.ok && Array.isArray(res.items)) {
      var items = res.items.map(function(it) {
        var name = it.key.split('/').pop() || 'image';
        return { key: it.key, name: name, url: it.url, size: it.size ? Math.ceil(it.size/1024)+' KB' : '未知' };
      });
      saveList(items);
      renderList(items);
      showToast('已同步 ' + items.length + ' 张图片', 'success');
      return items;
    }
  } catch(e) {
    console.warn('Server load failed:', e);
    showToast('服务器同步失败，使用本地缓存', 'info');
  }
  return getSavedList();
}

async function deleteFromServer(key) {
  try {
    var res = await fetchApi('/api/delete?key=' + encodeURIComponent(key), { method: 'DELETE' });
    return res && res.ok === true;
  } catch(e) {
    console.error('Delete failed:', e);
    return false;
  }
}

async function uploadFiles(files) {
  if (!files || !files.length) { showToast('请选择图片文件', 'error'); return; }
  var endpoint = getApiBase() + '/api/upload';
  var list = getSavedList();
  var okCount = 0, failCount = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    try {
      var fd = new FormData();
      fd.append('file', f, f.name);
      var r = await fetch(endpoint, { method: 'POST', body: fd });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed');
      list.unshift({ key: j.key, name: f.name, url: j.url, size: Math.ceil(f.size/1024)+' KB' });
      okCount++;
    } catch(e) {
      list.unshift({ key: Date.now()+'-'+f.name, name: f.name, url: URL.createObjectURL(f), size: Math.ceil(f.size/1024)+' KB', localOnly: true });
      failCount++;
    }
  }
  saveList(list);
  renderList(list);
  if (okCount > 0) {
    showToast('成功上传 ' + okCount + ' 张', 'success');
    setTimeout(function() { loadFromServer(); }, 800);
  }
  if (failCount > 0) showToast('有 ' + failCount + ' 张上传失败，已保存本地', 'error');
}

// ── RENDER ──
function renderList(items) {
  var root = document.getElementById('imageList');
  if (!root) return;
  var q = (document.getElementById('searchInput') || {}).value.toLowerCase() || '';
  var filtered = q ? items.filter(function(it){ return it.name.toLowerCase().includes(q); }) : items;
  if (!filtered.length) {
    root.innerHTML = '<div class="empty"><i data-lucide="image" class="icon-lg" style="opacity:0.3;"></i><p>暂无图片</p></div>';
    if (window.lucide) { try { lucide.createIcons(); } catch(e){} }
    return;
  }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var it = filtered[i];
    html += '<div class="image-item" data-key="' + esc(it.key) + '">' +
      '<img src="' + esc(it.url) + '" alt="' + esc(it.name) + '" loading="lazy" />' +
      '<div class="image-meta">' +
        '<strong title="' + esc(it.name) + '">' + esc(it.name) + '</strong>' +
        '<div class="muted">' + esc(it.size||'') + (it.localOnly ? ' · 本地' : '') + '</div>' +
        '<div class="row-inline">' +
          '<button class="small-btn" data-a="view" data-k="' + esc(it.key) + '" title="查看">' + ICONS.view + '</button>' +
          '<button class="small-btn" data-a="copy" data-k="' + esc(it.key) + '" title="复制">' + ICONS.copy + '</button>' +
          '<button class="small-btn" data-a="rename" data-k="' + esc(it.key) + '" title="重命名">' + ICONS.rename + '</button>' +
          '<button class="small-btn danger" data-a="delete" data-k="' + esc(it.key) + '" title="删除">' + ICONS.trash + '</button>' +
        '</div></div></div>';
  }
  root.innerHTML = html;
  if (window.lucide) { try { lucide.createIcons(); } catch(e){} }

  var btns = root.querySelectorAll('button');
  for (var j = 0; j < btns.length; j++) {
    (function(btn) {
      btn.addEventListener('click', async function() {
        var act = btn.dataset.a;
        var k = btn.dataset.k;
        var target = filtered.find(function(it){ return it.key === k; });
        if (!target) return;
        if (act === 'view') { window.open(target.url, '_blank'); }
        else if (act === 'copy') {
          navigator.clipboard.writeText(target.url)
            .then(function(){ showToast('URL 已复制', 'success'); })
            .catch(function(){ showToast('复制失败', 'error'); });
        }
        else if (act === 'rename') {
          var nn = window.prompt('请输入新文件名', target.name);
          if (!nn || !nn.trim()) return;
          var up = getSavedList().map(function(it){ return it.key===k ? Object.assign({},it,{name:nn.trim()}) : it; });
          saveList(up); renderList(up);
          showToast('重命名成功', 'success');
        }
        else if (act === 'delete') {
          if (!window.confirm('确定删除"' + target.name + '"?')) return;
          var orig = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = ICONS.spinner + ' 删除中...';
          try {
            var delResult = false;
            if (!target.localOnly) delResult = await deleteFromServer(target.key);
            else delResult = true;
            var up2 = getSavedList().filter(function(it){ return it.key !== k; });
            saveList(up2); renderList(up2);
            showToast(delResult ? '图片已删除' : '已从本地移除', delResult ? 'success' : 'info');
          } catch(e) { showToast('删除失败', 'error'); }
          finally { btn.disabled = false; btn.innerHTML = orig; }
        }
      });
    })(btns[j]);
  }
}

// ── EVENTS ──
function attachEvents() {
  var ubtn = document.getElementById('uploadBtn');
  if (ubtn) ubtn.addEventListener('click', function() {
    var inp = document.getElementById('uploadInput');
    if (inp) uploadFiles(inp.files);
  });

  var rbtn = document.getElementById('refreshListBtn');
  if (rbtn) rbtn.addEventListener('click', async function() {
    var b = rbtn;
    b.disabled = true;
    var oh = b.innerHTML;
    b.innerHTML = ICONS.spinner + ' 加载中...';
    try { await loadFromServer(); }
    catch(e) { showToast('刷新失败', 'error'); }
    finally { b.disabled = false; b.innerHTML = oh; }
  });

  var sinp = document.getElementById('searchInput');
  if (sinp) sinp.addEventListener('input', function(){ renderList(getSavedList()); });

  var dz = document.getElementById('dropZone');
  var up = document.getElementById('uploadInput');
  if (dz && up) {
    dz.addEventListener('click', function(){ up.click(); });
    dz.addEventListener('dragover', function(e){ e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', function(){ dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', function(e){ e.preventDefault(); dz.classList.remove('drag-over'); uploadFiles(e.dataTransfer.files); });
    up.addEventListener('change', function(){ if(up.files.length) uploadFiles(up.files); });
  }
}

// ── BOOT ──
(function() {
  var st = document.createElement('style');
  st.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(st);

  document.addEventListener('DOMContentLoaded', async function() {
    var tb = document.getElementById('themeToggle');
    if (tb) tb.addEventListener('click', toggleTheme);
    if (window.lucide) { try { lucide.createIcons(); } catch(e){} }
    var items = await loadFromServer();
    renderList(items);
    attachEvents();
  });
})();
