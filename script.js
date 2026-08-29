const STORAGE_KEY = 'yoo-image-manager-items';

// SVG Icon 定义
const ICONS = {
  upload: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  refresh: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  view: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  copy: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  rename: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  delete: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  success: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  error: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  info: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
};

// Toast notification system
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const iconMap = { success: ICONS.success, error: ICONS.error, info: ICONS.info };
  toast.innerHTML = `${iconMap[type] || ICONS.info}<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function getSavedList() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveList(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  updateCount(items);
}

function updateCount(items) {
  const el = document.getElementById('totalCount');</div>';
    return;
  }

  listRoot.innerHTML = filtered.map((item) => `
    <div class="image-item" data-key="${item.key}">
      <img src="${item.url}" alt="${item.name}" loading="lazy" />
      <div class="image-meta">
        <strong title="${item.name}">${item.name}</strong>
        <div class="muted">${item.size || 'image'}${item.localOnly ? ' · 本地' : ''}</div>
        <div class="row-inline">
          <button class="small-btn" data-action="view" data-key="${item.key}">${ICONS.view}</button>
          <button class="small-btn" data-action="copy" data-key="${item.key}">${ICONS.copy}</button>
          <button class="small-btn" data-action="rename" data-key="${item.key}">${ICONS.rename}</button>
          <button class="small-btn danger" data-action="delete" data-key="${item.key}">${ICONS.delete}
    return;
  }

  listRoot.innerHTML = filtered.map((item) => `
    <div class="image-item" data-key="${item.key}">
      <img src="${item.url}" alt="${item.name}" loading="lazy" />
      <div class="image-meta">
        <strong title="${item.name}">${item.name}</strong>
        <div class="muted">${item.size || 'image'}${item.localOnly ? ' · 本地' : ''}</div>
        <div class="row-inline">
          <button class="small-btn" data-action="view" data-key="${item.key}">👁 查看</button>
          <button class="small-btn" data-action="copy" data-key="${item.key}">📋 复制</button>
          <button class="small-btn" data-action="rename" data-key="${item.key}">✏️ 重命名</button>
          <button class="small-btn danger" data-action="delete" data-key="${item.key}">🗑 删除</button>
        </div>
      </div>
    </div>
  `).join('');

  listRoot.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      const targetKey = button.dataset.key;
      const target = filtered.find((item) => item.key === targetKey);
      if (!target) return;

      if (action === 'view') window.open(target.url, '_blank');
      
      if (action === 'copy') {
        navigator.clipboard.writeText(target.url).then(() => showToast('URL 已复制到剪贴板', 'success'));
      }
      
      if (action === 'rename') {
        const nextName = window.prompt('请输入新文件名', target.name);
        if (!nextName?.trim()) return;
        const currentItems = getSavedList();
        saveList(currentItems.map((item) => item.key === targetKey ? { ...item, name: nextName.trim() } : item));
        renderList(getSavedList());
      }
      
      if (action === 'delete') {
        if (!window.confirm(`确定删除 ${target.name}？`)) return;
        
        const btn = button;
        btn.disabled = true;
        btn.textContent = '⏳ 删除中...';
        
        try {
          const serverDeleted = await deleteImageFromServer(target.key);
          const currentItems = getSavedList();

          if (serverDeleted) {
            saveList(currentItems.filter((item) => item.key !== targetKey));
          }

          renderList(getSavedList());
          showToast('图片已删除', 'success');
        } catch (error) {
          showToast('删除失败，请重试', 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = ICONS.delete;
        }
      }
    });
  });
}

async function fetchFromApi(endpoint, options = {}) {
  const apiEndpoint = document.getElementById('apiEndpoint');
  const baseUrl = (apiEndpoint?.value.trim()) || 'https://yooy.cc.cd';
  const url = `${baseUrl}${endpoint}`;
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('API 请求失败:', error);
    throw error;
  }
}

async function loadImagesFromServer() {
  try {
    const result = await fetchFromApi('/api/list');
    if (result.ok && Array.isArray(result.items)) {
      const items = result.items.map(item => ({
        key: item.key,
        name: item.key.split('/').pop() || 'image',
        url: item.url,
        size: item.size ? `${Math.ceil(item.size / 1024)} KB` : '未知',
        contentType: item.contentType
      }));
      saveList(items);
      renderList(items);
      showToast(`已同步 ${items.length} 张图片`, 'success');
      return items;
    }
  } catch (error) {
    console.warn('从服务器加载失败，使用本地数据:', error);
  }
  return getSavedList();
}

async function deleteImageFromServer(key) {
  try {
    await fetchFromApi(`/api/delete?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    return true;
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

  const apiEndpoint = document.getElementById('apiEndpoint');
  const currentItems = getSavedList();
  const endpoint = (apiEndpoint?.value.trim()) || 'https://yooy.cc.cd/api/upload';

  let successCount = 0;
  
  for (const file of files) {
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);

      const response = await fetch(endpoint, { method: 'POST', body: formData });
      const result = await response.json();

      if (!response.ok || !result.ok) throw new Error(result.error || '上传失败');

      currentItems.unshift({
        key: result.key || `${Date.now()}-${file.name}`,
        name: file.name,
        url: result.url || '#',
        size: `${Math.ceil(file.size / 1024)} KB`
      });
      successCount++;
    } catch (error) {
      currentItems.unshift({
        key: `${Date.now()}-${file.name}`,
        name: file.name,
        url: URL.createObjectURL(file),
        size: `${Math.ceil(file.size / 1024)} KB`,
        localOnly: true
      });
    }
  }

  saveList(currentItems);
  renderList(currentItems);
  
  if (successCount > 0) {
    showToast(`成功上传 ${successCount} 张图片`, 'success');
    setTimeout(() => loadImagesFromServer(), 500);
  }
}

function attachEvents() {
  // Upload button
  const uploadBtn = document.getElementById('uploadBtn');
  if (uploadBtn) uploadBtn.addEventListener('click', () => {
    const input = document.getElementById('uploadInput');
    if (input) uploadFiles(input.files);
  });

  // Refresh button
  const refreshBtn = document.getElementById('refreshListBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', async () => {
    const btn = refreshBtn;
    btn.disabled = true;
    btn.textContent = '⏳ 加载中...';
    try {
      await loadImagesFromServer();
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 刷新';
    }
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.addEventListener('input', () => renderList(getSavedList()));

  // Drop zone
  const dropZone = document.getElementById('dropZone');
  const uploadInput = document.getElementById('uploadInput');
  
  if (dropZone && uploadInput) {
    dropZone.addEventListener('click', () => uploadInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      uploadFiles(e.dataTransfer.files);
    });
    
    uploadInput.addEventListener('change', () => {
      if (uploadInput.files.length) uploadFiles(uploadInput.files);
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const saved = await loadImagesFromServer();
  renderList(saved);
  attachEvents();
});
