const STORAGE_KEY = 'yoo-image-manager-items';

// ── Theme Toggle (must run immediately, before any paint) ──
(function initTheme() {
  const saved = localStorage.getItem('yoo-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('yoo-theme', next);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#themeToggle').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
  if (window.lucide) lucide.createIcons();
});

// ── SVG Icons ──
const ICONS = {
  upload: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  refresh: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  view: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  copy: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  rename: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  check: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  x: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  info: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
};

// ── Toast ──
function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  var iconMap = { success: ICONS.check, error: ICONS.x, info: ICONS.info };
  toast.innerHTML = (iconMap[type] || ICONS.info) + '<span>' + message + '</span>';
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
}

// ── Storage ──
function getSavedList() {
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch (e) { return []; }
}

function saveList(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  updateCount(items);
}

function updateCount(items) {
  var el = document.getElementById('totalCount');
  if (el) el.textContent = items.length + ' 张图片';
}

// ── Render List ──
function renderList(items) {
  var listRoot = document.getElementById('imageList');
  if (!listRoot) return;

  var searchInput = document.getElementById('searchInput');
  var query = searchInput ? searchInput.value.toLowerCase() : '';
  var filtered = query ? items.filter(function(item) {
    return item.name.toLowerCase().includes(query);
  }) : items;

  if (!filtered.length) {
    listRoot.innerHTML = '<div class="empty">暂无图片，上传一张试试吧</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var item = filtered[i];
    html += '<div class="image-item" data-key="' + item.key + '">' +
      '<img src="' + item.url + '" alt="' + item.name + '" loading="lazy" />' +
      '<div class="image-meta">' +
        '<strong title="' + item.name + '">' + item.name + '</strong>' +
        '<div class="muted">' + (item.size || '') + (item.localOnly ? ' · 本地' : '') + '</div>' +
        '<div class="row-inline">' +
          '<button class="small-btn" data-action="view" data-key="' + item.key + '" title="在新窗口打开">' + ICONS.view + ' 查看</button>' +
          '<button class="small-btn" data-action="copy" data-key="' + item.key + '" title="复制链接">' + ICONS.copy + ' 复制</button>' +
          '<button class="small-btn" data-action="rename" data-key="' + item.key + '" title="重命名">' + ICONS.rename + ' 重命名</button>' +
          '<button class="small-btn danger" data-action="delete" data-key="' + item.key + '" title="删除">' + ICONS.trash + ' 删除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  listRoot.innerHTML = html;

  var buttons = listRoot.querySelectorAll('button');
  for (var j = 0; j < buttons.length; j++) {
    (function(btn) {
      btn.addEventListener('click', async function() {
        var action = btn.dataset.action;
        var targetKey = btn.dataset.key;
        var target = filtered.find(function(item) { return item.key === targetKey; });
        if (!target) return;

        if (action === 'view') {
          window.open(target.url, '_blank');
        }

        if (action === 'copy') {
          navigator.clipboard.writeText(target.url).then(function() {
            showToast('URL 已复制到剪贴板', 'success');
          }).catch(function() {
            showToast('复制失败', 'error');
          });
        }

        if (action === 'rename') {
          var nextName = window.prompt('请输入新文件名', target.name);
          if (!nextName || !nextName.trim()) return;
          var updated = getSavedList().map(function(item) {
            return item.key === targetKey ? Object.assign({}, item, { name: nextName.trim() }) : item;
          });
          saveList(updated);
          renderList(updated);
          showToast('重命名成功', 'success');
        }

        if (action === 'delete') {
          if (!window.confirm('确定删除「' + target.name + '」？')) return;

          var origHtml = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = '<svg style="animation:spin 1s linear infinite;width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 删除中...';

          try {
            var serverDeleted = false;
            if (!target.localOnly) {
              serverDeleted = await deleteImageFromServer(target.key);
            } else {
              serverDeleted = true;
            }
            var updated2 = getSavedList().filter(function(item) { return item.key !== targetKey; });
            saveList(updated2);
            renderList(updated2);
            if (serverDeleted) {
              showToast('图片已删除', 'success');
            } else {
              showToast('已从本地移除（服务器删除失败）', 'info');
            }
          } catch (err) {
            showToast('删除失败，请重试', 'error');
          } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
          }
        }
      });
    })(buttons[j]);
  }
}

// ── API Helpers ──
function getApiBase() {
  var el = document.getElementById('apiEndpoint');
  return (el ? el.value.trim() : '') || 'https://yooy.cc.cd';
}

async function fetchFromApi(endpoint, options) {
  options = options || {};
  var url = getApiBase() + endpoint;
  try {
    var response = await fetch(url, options);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } catch (error) {
    console.error('API 请求失败:', error);
    throw error;
  }
}

async function loadImagesFromServer() {
  try {
    var result = await fetchFromApi('/api/list');
    if (result.ok && Array.isArray(result.items)) {
      var items = result.items.map(function(item) {
        var name = item.key.split('/').pop() || 'image';
        return {
          key: item.key,
          name: name,
          url: item.url,
          size: item.size ? Math.ceil(item.size / 1024) + ' KB' : '未知',
          contentType: item.contentType
        };
      });
      saveList(items);
      renderList(items);
      showToast('已同步 ' + items.length + ' 张图片', 'success');
      return items;
    }
  } catch (error) {
    console.warn('从服务器加载失败，使用本地数据:', error);
  }
  return getSavedList();
}

async function deleteImageFromServer(key) {
  try {
    var result = await fetchFromApi('/api/delete?key=' + encodeURIComponent(key), { method: 'DELETE' });
    return result && result.ok === true;
  } catch (error) {
    console.error('删除失败:', error);
    return false;
  }
}

async function uploadFiles(files) {
  if (!files || !files.length) {
    showToast('请选择图片文件', 'error');
    return;
  }
  var endpoint = getApiBase() + '/api/upload';
  var currentItems = getSavedList();
  var successCount = 0;

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    try {
      var formData = new FormData();
      formData.append('file', file, file.name);
      var response = await fetch(endpoint, { method: 'POST', body: formData });
      var result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '上传失败');
      currentItems.unshift({
        key: result.key,
        name: file.name,
        url: result.url,
        size: Math.ceil(file.size / 1024) + ' KB'
      });
      successCount++;
    } catch (e) {
      currentItems.unshift({
        key: Date.now() + '-' + file.name,
        name: file.name,
        url: URL.createObjectURL(file),
        size: Math.ceil(file.size / 1024) + ' KB',
        localOnly: true
      });
    }
  }

  saveList(currentItems);
  renderList(currentItems);
  if (successCount > 0) {
    showToast('成功上传 ' + successCount + ' 张图片', 'success');
    setTimeout(function() { loadImagesFromServer(); }, 800);
  }
}

// ── Event Binding ──
function attachEvents() {
  var uploadBtn = document.getElementById('uploadBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', function() {
      var input = document.getElementById('uploadInput');
      if (input) uploadFiles(input.files);
    });
  }

  var refreshBtn = document.getElementById('refreshListBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async function() {
      var btn = refreshBtn;
      btn.disabled = true;
      var origHtml = btn.innerHTML;
      btn.innerHTML = '<svg style="animation:spin 1s linear infinite;width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 加载中...';
      try {
        await loadImagesFromServer();
        showToast('刷新成功', 'success');
      } catch (e) {
        showToast('刷新失败', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    });
  }

  var searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.addEventListener('input', function() { renderList(getSavedList()); });

  var dropZone = document.getElementById('dropZone');
  var uploadInput = document.getElementById('uploadInput');

  if (dropZone && uploadInput) {
    dropZone.addEventListener('click', function() { uploadInput.click(); });

    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      uploadFiles(e.dataTransfer.files);
    });
    uploadInput.addEventListener('change', function() {
      if (uploadInput.files.length) uploadFiles(uploadInput.files);
    });
  }
}

// ── Keyframes ──
var style = document.createElement('style');
style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
document.head.appendChild(style);

// ── Boot ──
document.addEventListener('DOMContentLoaded', async function() {
  var saved = await loadImagesFromServer();
  renderList(saved);
  attachEvents();
  if (window.lucide) lucide.createIcons();
});
