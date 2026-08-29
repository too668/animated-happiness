const STORAGE_KEY = 'edgeone-image-manager-items';

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
}

function renderList(items) {
  const listRoot = document.getElementById('imageList');
  if (!listRoot) return;

  const query = (document.getElementById('searchInput') || {}).value || '';
  const filtered = items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));

  if (!filtered.length) {
    listRoot.innerHTML = '<div class="empty">暂无图片</div>';
    return;
  }

  listRoot.innerHTML = filtered.map((item) => `
    <div class="image-item">
      <img src="${item.url}" alt="${item.name}" />
      <div class="image-meta">
        <strong>${item.name}</strong>
        <div class="muted">${item.size || 'image'}</div>
        <div class="row-inline">
          <button class="small-btn" data-action="view" data-key="${item.key}">查看</button>
          <button class="small-btn" data-action="copy" data-key="${item.key}">复制</button>
          <button class="small-btn" data-action="rename" data-key="${item.key}">重命名</button>
          <button class="small-btn danger" data-action="delete" data-key="${item.key}">删除</button>
        </div>
      </div>
    </div>
  `).join('');

  listRoot.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      const targetKey = button.dataset.key;
      const target = filtered.find((item) => item.key === targetKey);

      if (!target) return;

      if (action === 'view') {
        window.open(target.url, '_blank');
      }

      if (action === 'copy') {
        navigator.clipboard.writeText(target.url);
      }

      if (action === 'rename') {
        const nextName = window.prompt('请输入新文件名', target.name);
        if (!nextName || !nextName.trim()) return;
        const currentItems = getSavedList();
        const next = currentItems.map((item) => item.key === targetKey ? { ...item, name: nextName.trim() } : item);
        saveList(next);
        renderList(next);
      }

      if (action === 'delete') {
        const currentItems = getSavedList();
        const next = currentItems.filter((item) => item.key !== targetKey);
        saveList(next);
        renderList(next);
      }
    });
  });
}

async function uploadFiles() {
  const uploadInput = document.getElementById('uploadInput');
  const apiEndpoint = document.getElementById('apiEndpoint');
  const files = uploadInput ? uploadInput.files : [];

  if (!files || !files.length) {
    alert('请选择图片文件');
    return;
  }

  const currentItems = getSavedList();
  const endpoint = (apiEndpoint && apiEndpoint.value.trim()) || 'https://yooy.cc.cd/api/upload';

  for (const file of files) {
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error || '上传失败');
      }

      currentItems.unshift({
        key: result.key || `${Date.now()}-${file.name}`,
        name: file.name,
        url: result.url || '#',
        size: `${Math.ceil(file.size / 1024)} KB`
      });
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
  uploadInput.value = '';
}

function attachEvents() {
  const uploadBtn = document.getElementById('uploadBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', uploadFiles);
  }

  const refreshBtn = document.getElementById('refreshListBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => renderList(getSavedList()));
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => renderList(getSavedList()));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = getSavedList();
  renderList(saved);
  attachEvents();
});
