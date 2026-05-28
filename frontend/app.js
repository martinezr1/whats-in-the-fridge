const API = '';

// --- State ---
let fridgeItems = [];
let libraryItems = [];
let pendingImageFile = null;
let pendingSuggestedUrl = null;
let editImageFile = null;
let fridgeView = localStorage.getItem('fridgeView') || 'list';
let libraryView = localStorage.getItem('libraryView') || 'list';
let fridgeSort = localStorage.getItem('fridgeSort') || 'date_added';
let librarySort = localStorage.getItem('librarySort') || 'alpha';

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  setTodayDate();
  setupTabs();
  applyView();
  applyLibraryView();
  document.getElementById('fridge-sort').value = fridgeSort;
  document.getElementById('library-sort').value = librarySort;
  setupForm();
  setupUpload();
  setupEditUpload();
  setupLibrarySearch();
  loadFridge();
  loadLibrary();
});

// --- Tabs ---
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

// --- Date helpers ---
function setTodayDate() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('item-date').value = today;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysSince(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// --- Toast ---
let toastTimer;
function toast(msg, ms = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// --- Image Upload ---
function setupUpload() {
  const area = document.getElementById('upload-area');
  const input = document.getElementById('item-image');
  const preview = document.getElementById('upload-preview');
  const previewImg = document.getElementById('preview-img');
  const clearBtn = document.getElementById('clear-img');

  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) setImageFile(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) setImageFile(input.files[0]);
  });

  clearBtn.addEventListener('click', () => {
    pendingImageFile = null;
    input.value = '';
    preview.style.display = 'none';
    area.style.display = 'block';
  });

  function setImageFile(file) {
    if (!file.type.startsWith('image/')) { toast('Please select an image file'); return; }
    pendingImageFile = file;
    pendingSuggestedUrl = null;
    hideSuggestion();
    const reader = new FileReader();
    reader.onload = e => {
      previewImg.src = e.target.result;
      preview.style.display = 'inline-block';
      area.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
}

// --- Edit image upload ---
function setupEditUpload() {
  const area = document.getElementById('edit-upload-area');
  const input = document.getElementById('edit-image-input');
  const preview = document.getElementById('edit-upload-preview');
  const previewImg = document.getElementById('edit-preview-img');
  const clearBtn = document.getElementById('edit-clear-img');

  input.addEventListener('change', () => {
    if (input.files[0]) setEditImageFile(input.files[0]);
  });

  clearBtn.addEventListener('click', () => {
    editImageFile = null;
    input.value = '';
    preview.style.display = 'none';
    area.style.display = 'block';
  });

  function setEditImageFile(file) {
    if (!file.type.startsWith('image/')) { toast('Please select an image file'); return; }
    editImageFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      previewImg.src = e.target.result;
      preview.style.display = 'inline-block';
      area.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
}

// --- Add Item Form ---
function setupForm() {
  const form = document.getElementById('add-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Adding…';

    const fd = new FormData();
    fd.append('name', document.getElementById('item-name').value.trim());
    fd.append('description', document.getElementById('item-desc').value.trim());
    fd.append('date_added', document.getElementById('item-date').value);
    fd.append('quantity', document.getElementById('item-qty').value || '1');
    const expVal = document.getElementById('item-exp').value;
    if (expVal) fd.append('expiration_date', expVal);
    if (pendingImageFile) {
      fd.append('image', pendingImageFile);
    } else if (pendingSuggestedUrl) {
      fd.append('image_url', pendingSuggestedUrl);
    }

    try {
      const item = await apiFetch('/api/fridge', { method: 'POST', body: fd });
      fridgeItems.unshift(item);
      renderFridge();

      if (document.getElementById('save-to-library').checked) {
        const saved = await apiFetch(`/api/fridge/${item.id}/save-to-library`, { method: 'POST' });
        if (!libraryItems.some(i => i.id === saved.id)) {
          libraryItems.push(saved);
          libraryItems.sort((a, b) => a.name.localeCompare(b.name));
          renderLibrary();
        }
        toast(`"${item.name}" added to fridge and library!`);
      } else {
        toast(`"${item.name}" added to fridge!`);
      }

      form.reset();
      setTodayDate();
      document.getElementById('item-qty').value = '1';
      document.getElementById('item-exp').value = '';
      pendingImageFile = null;
      pendingSuggestedUrl = null;
      hideSuggestion();
      document.getElementById('upload-preview').style.display = 'none';
      document.getElementById('upload-area').style.display = 'block';
      document.getElementById('save-to-library').checked = false;

      // Switch to fridge tab
      document.querySelector('[data-tab="fridge"]').click();
    } catch (err) {
      toast('Error adding item. Please try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Add to Fridge';
    }
  });
}

// --- API helper ---
async function apiFetch(url, opts = {}) {
  const res = await fetch(API + url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// --- Image suggestions ---
async function findPhoto() {
  const raw = document.getElementById('item-name').value.trim();
  if (!raw) { toast('Enter a name first'); return; }
  const q = raw.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (!q) { toast('Enter a name first'); return; }
  const btn = document.getElementById('find-photo-btn');
  btn.disabled = true;
  btn.textContent = '🔍 Searching…';
  await fetchSuggestion(q);
  btn.disabled = false;
  btn.textContent = '🔍 Find Photo';
}

async function fetchSuggestion(q) {
  if (pendingImageFile) return;
  try {
    const data = await apiFetch(`/api/suggest-image?q=${encodeURIComponent(q)}`);
    if (data.image_url && !pendingImageFile) {
      pendingSuggestedUrl = data.image_url;
      document.getElementById('suggestion-img').src = data.image_url;
      document.getElementById('suggestion-label').textContent = `Suggested photo for "${q}"`;
      document.getElementById('suggestion-area').style.display = 'flex';
    }
  } catch (err) {
    hideSuggestion();
    toast(err.message?.includes('configured') ? 'Image search not configured — check API key' : 'No photo found for that name');
  }
}

function useSuggestedImage() {
  document.getElementById('preview-img').src = document.getElementById('suggestion-img').src;
  document.getElementById('upload-preview').style.display = 'inline-block';
  document.getElementById('upload-area').style.display = 'none';
  hideSuggestion();
}

function dismissSuggestion() {
  pendingSuggestedUrl = null;
  hideSuggestion();
}

function hideSuggestion() {
  document.getElementById('suggestion-area').style.display = 'none';
}

// --- Expiration helper ---
function expirationDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
  const exp = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((exp - today) / 86400000);
  const label = exp.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (diff < 0)  return `<div class="card-exp exp-expired">⚠️ Expired ${label}</div>`;
  if (diff === 0) return `<div class="card-exp exp-soon">⚠️ Expires today</div>`;
  if (diff <= 2)  return `<div class="card-exp exp-soon">⏰ Expires in ${diff} day${diff === 1 ? '' : 's'}</div>`;
  return `<div class="card-exp exp-ok">📆 Expires ${label}</div>`;
}

// --- Image helper ---
function imgSrc(path) {
  return path ? `/uploads/${path}` : null;
}

function cardImage(imagePath, fallback = '🥡') {
  if (imagePath) {
    return `<div class="card-img"><img src="${imgSrc(imagePath)}" alt="food" loading="lazy"></div>`;
  }
  return `<div class="card-img">${fallback}</div>`;
}

// --- View toggle ---
function setView(v) {
  fridgeView = v;
  localStorage.setItem('fridgeView', v);
  applyView();
  renderFridge();
}

function applyView() {
  const grid = document.getElementById('fridge-grid');
  grid.classList.toggle('grid-compact', fridgeView === 'grid');
  grid.classList.toggle('grid-rows',    fridgeView === 'rows');
  document.getElementById('view-btn-list').classList.toggle('active', fridgeView === 'list');
  document.getElementById('view-btn-rows').classList.toggle('active', fridgeView === 'rows');
  document.getElementById('view-btn-grid').classList.toggle('active', fridgeView === 'grid');
}

// --- Sort ---
function setFridgeSort(v) {
  fridgeSort = v;
  localStorage.setItem('fridgeSort', v);
  renderFridge();
}

function setLibrarySort(v) {
  librarySort = v;
  localStorage.setItem('librarySort', v);
  renderLibrary();
}

function sortedFridgeItems() {
  const items = fridgeFilter
    ? fridgeItems.filter(i =>
        i.name.toLowerCase().includes(fridgeFilter) ||
        (i.description || '').toLowerCase().includes(fridgeFilter))
    : [...fridgeItems];
  if (fridgeSort === 'alpha') {
    items.sort((a, b) => a.name.localeCompare(b.name));
  } else if (fridgeSort === 'expiration') {
    items.sort((a, b) => {
      if (!a.expiration_date && !b.expiration_date) return 0;
      if (!a.expiration_date) return 1;
      if (!b.expiration_date) return -1;
      return a.expiration_date.localeCompare(b.expiration_date);
    });
  } else {
    items.sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  }
  return items;
}

function sortedLibraryItems(items) {
  const sorted = [...items];
  if (librarySort === 'date_added') {
    sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

// --- Library view toggle ---
function setLibraryView(v) {
  libraryView = v;
  localStorage.setItem('libraryView', v);
  applyLibraryView();
  renderLibrary();
}

function applyLibraryView() {
  const grid = document.getElementById('library-grid');
  grid.classList.toggle('grid-compact', libraryView === 'grid');
  grid.classList.toggle('grid-rows',    libraryView === 'rows');
  document.getElementById('lib-view-btn-list').classList.toggle('active', libraryView === 'list');
  document.getElementById('lib-view-btn-rows').classList.toggle('active', libraryView === 'rows');
  document.getElementById('lib-view-btn-grid').classList.toggle('active', libraryView === 'grid');
}

// --- Fridge ---
async function loadFridge() {
  try {
    fridgeItems = await apiFetch('/api/fridge');
    renderFridge();
  } catch {
    toast('Could not load fridge items');
  }
}

function renderFridge() {
  const grid = document.getElementById('fridge-grid');
  const badge = document.getElementById('fridge-count');
  applyView();

  if (fridgeItems.length === 0) {
    badge.style.display = 'none';
    grid.innerHTML = '<div class="empty"><div class="empty-icon">❄️</div><p>Your fridge is empty. Add some items!</p></div>';
    return;
  }

  badge.textContent = fridgeItems.length;
  badge.style.display = 'inline';

  grid.innerHTML = sortedFridgeItems().map(item => `
    <div class="card" data-id="${item.id}">
      ${cardImage(item.image_path)}
      <div class="card-body">
        <div class="card-name">${esc(item.name)}</div>
        ${item.description ? `<div class="card-desc">${esc(item.description)}</div>` : ''}
        <div class="card-date">📅 ${formatDate(item.date_added)} · ${daysSince(item.date_added)}</div>
        <div class="card-qty">Qty: <strong>${item.quantity}</strong></div>
        ${expirationDisplay(item.expiration_date)}
      </div>
      <div class="card-actions">
        ${fridgeView === 'rows' ? `
        <button class="btn btn-ghost btn-sm icon-btn" title="Edit"           onclick="openEditModal('fridge', ${item.id})">✏️</button>
        <button class="btn btn-success btn-sm icon-btn" title="Save to Library" onclick="saveToLibrary(${item.id}, '${esc(item.name)}')">📚</button>
        <button class="btn btn-danger btn-sm icon-btn" title="Remove"        onclick="removeFromFridge(${item.id}, '${esc(item.name)}')">🗑</button>
        ` : `
        <button class="btn btn-ghost btn-sm" onclick="openEditModal('fridge', ${item.id})">✏️ Edit</button>
        <button class="btn btn-success btn-sm" onclick="saveToLibrary(${item.id}, '${esc(item.name)}')">📚 Save</button>
        <button class="btn btn-danger btn-sm" onclick="removeFromFridge(${item.id}, '${esc(item.name)}')">🗑 Remove</button>
        `}
      </div>
    </div>
  `).join('');
}

async function removeFromFridge(id, name) {
  try {
    const result = await apiFetch(`/api/fridge/${id}`, { method: 'DELETE' });
    if (result.quantity > 0) {
      const item = fridgeItems.find(i => i.id === id);
      if (item) item.quantity = result.quantity;
      renderFridge();
      toast(`Removed one "${name}" — ${result.quantity} remaining`);
    } else {
      fridgeItems = fridgeItems.filter(i => i.id !== id);
      renderFridge();
      toast(`"${name}" removed from fridge`);
    }
  } catch {
    toast('Could not remove item');
  }
}

async function saveToLibrary(id, name) {
  try {
    const saved = await apiFetch(`/api/fridge/${id}/save-to-library`, { method: 'POST' });
    const alreadyExists = libraryItems.some(i => i.id === saved.id);
    if (alreadyExists) {
      toast(`"${name}" is already in the library`);
    } else {
      libraryItems.push(saved);
      libraryItems.sort((a, b) => a.name.localeCompare(b.name));
      renderLibrary();
      renderQuickAdd();
      toast(`"${name}" saved to library!`);
    }
  } catch {
    toast('Could not save to library');
  }
}

// --- Library ---
async function loadLibrary() {
  try {
    libraryItems = await apiFetch('/api/library');
    renderLibrary();
    renderQuickAdd();
  } catch {
    toast('Could not load library');
  }
}

let libraryFilter = '';
let fridgeFilter = '';

function setupLibrarySearch() {
  document.getElementById('fridge-search').addEventListener('input', e => {
    fridgeFilter = e.target.value.toLowerCase();
    renderFridge();
  });

  document.getElementById('library-search').addEventListener('input', e => {
    libraryFilter = e.target.value.toLowerCase();
    renderLibrary();
  });

  document.getElementById('new-library-btn').addEventListener('click', () => {
    document.querySelector('[data-tab="add"]').click();
    document.getElementById('item-name').focus();
    document.getElementById('save-to-library').checked = true;
  });
}

function renderLibrary() {
  const grid = document.getElementById('library-grid');
  const badge = document.getElementById('library-count');
  applyLibraryView();
  const filtered = sortedLibraryItems(libraryItems.filter(i =>
    i.name.toLowerCase().includes(libraryFilter) ||
    (i.description || '').toLowerCase().includes(libraryFilter)
  ));

  badge.textContent = libraryItems.length;
  badge.style.display = libraryItems.length ? 'inline' : 'none';

  if (filtered.length === 0) {
    grid.innerHTML = libraryFilter
      ? '<div class="empty"><div class="empty-icon">🔍</div><p>No matches found</p></div>'
      : '<div class="empty"><div class="empty-icon">📚</div><p>No saved foods yet. Add items and save them to the library!</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(item => `
    <div class="card" data-id="${item.id}">
      ${cardImage(item.default_image_path, '🥘')}
      <div class="card-body">
        <div class="card-name">${esc(item.name)}</div>
        ${item.description ? `<div class="card-desc">${esc(item.description)}</div>` : ''}
      </div>
      <div class="card-actions">
        ${libraryView === 'rows' ? `
        <button class="btn btn-ghost btn-sm icon-btn"   title="Edit"   onclick="openEditModal('library', ${item.id})">✏️</button>
        <button class="btn btn-primary btn-sm icon-btn" title="Add to Fridge" onclick="addFromLibrary(${item.id}, '${esc(item.name)}')">➕</button>
        <button class="btn btn-danger btn-sm icon-btn"  title="Delete" onclick="deleteFromLibrary(${item.id}, '${esc(item.name)}')">🗑</button>
        ` : `
        <button class="btn btn-ghost btn-sm" onclick="openEditModal('library', ${item.id})">✏️ Edit</button>
        <button class="btn btn-primary btn-sm" onclick="addFromLibrary(${item.id}, '${esc(item.name)}')">➕ Add</button>
        <button class="btn btn-danger btn-sm" onclick="deleteFromLibrary(${item.id}, '${esc(item.name)}')">🗑</button>
        `}
      </div>
    </div>
  `).join('');
}

function renderQuickAdd() {
  const section = document.getElementById('quick-add-section');
  const grid = document.getElementById('quick-add-grid');

  if (libraryItems.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  grid.innerHTML = libraryItems.slice(0, 8).map(item => `
    <div class="card" style="cursor:pointer;" onclick="quickAddFromLibrary(${item.id}, '${esc(item.name)}')">
      ${cardImage(item.default_image_path, '🥘')}
      <div class="card-body">
        <div class="card-name" style="font-size:0.9rem;">${esc(item.name)}</div>
      </div>
    </div>
  `).join('');
}

function addFromLibrary(id, name) {
  openAddModal(id, name);
}

function quickAddFromLibrary(id, name) {
  openAddModal(id, name);
}

async function deleteFromLibrary(id, name) {
  try {
    await apiFetch(`/api/library/${id}`, { method: 'DELETE' });
    libraryItems = libraryItems.filter(i => i.id !== id);
    renderLibrary();
    renderQuickAdd();
    toast(`"${name}" removed from library`);
  } catch {
    toast('Could not delete from library');
  }
}

// --- Add from library modal ---
let pendingLibraryAdd = null;

function openAddModal(id, name) {
  pendingLibraryAdd = { id, name };
  document.getElementById('add-modal-title').textContent = `Add "${name}" to Fridge`;
  document.getElementById('add-modal-exp').value = '';
  document.getElementById('add-modal').style.display = 'flex';
  document.getElementById('add-modal-exp').focus();
}

function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
  pendingLibraryAdd = null;
}

function handleAddModalOverlayClick(e) {
  if (e.target === document.getElementById('add-modal')) closeAddModal();
}

async function confirmAddFromLibrary() {
  if (!pendingLibraryAdd) return;
  const { id, name } = pendingLibraryAdd;
  const expDate = document.getElementById('add-modal-exp').value || null;
  const btn = document.getElementById('add-modal-btn');
  btn.disabled = true;
  try {
    const item = await apiFetch(`/api/library/${id}/add-to-fridge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiration_date: expDate }),
    });
    const idx = fridgeItems.findIndex(i => i.id === item.id);
    if (idx !== -1) {
      fridgeItems[idx] = item;
      toast(`"${name}" qty updated to ${item.quantity}`);
    } else {
      fridgeItems.unshift(item);
      toast(`"${name}" added to fridge!`);
    }
    renderFridge();
    closeAddModal();
    document.querySelector('[data-tab="fridge"]').click();
  } catch {
    toast('Could not add to fridge');
  } finally {
    btn.disabled = false;
  }
}

// --- Edit modal ---
let editState = { type: null, id: null };

function openEditModal(type, id) {
  const item = type === 'fridge'
    ? fridgeItems.find(i => i.id === id)
    : libraryItems.find(i => i.id === id);
  if (!item) return;

  editState = { type, id };

  document.getElementById('modal-title').textContent = type === 'fridge' ? 'Edit Fridge Item' : 'Edit Library Item';
  document.getElementById('edit-name').value = item.name;
  document.getElementById('edit-desc').value = item.description || '';

  const dateGroup = document.getElementById('edit-date-group');
  const qtyGroup = document.getElementById('edit-qty-group');

  const expGroup = document.getElementById('edit-exp-group');
  if (type === 'fridge') {
    dateGroup.style.display = 'block';
    qtyGroup.style.display = 'flex';
    expGroup.style.display = 'block';
    document.getElementById('edit-date').value = new Date(item.date_added).toISOString().split('T')[0];
    document.getElementById('edit-qty').value = item.quantity;
    document.getElementById('edit-exp').value = item.expiration_date ? item.expiration_date.split('T')[0] : '';
  } else {
    dateGroup.style.display = 'none';
    qtyGroup.style.display = 'none';
    expGroup.style.display = 'none';
  }

  // Reset image picker
  editImageFile = null;
  document.getElementById('edit-image-input').value = '';
  document.getElementById('edit-upload-preview').style.display = 'none';
  document.getElementById('edit-upload-area').style.display = 'block';

  // Show current image if present
  const imagePath = type === 'fridge' ? item.image_path : item.default_image_path;
  const currentImgDiv = document.getElementById('edit-current-img');
  if (imagePath) {
    document.getElementById('edit-current-img-el').src = imgSrc(imagePath);
    currentImgDiv.style.display = 'block';
  } else {
    currentImgDiv.style.display = 'none';
  }

  document.getElementById('edit-modal').style.display = 'flex';
  document.getElementById('edit-name').focus();
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editState = { type: null, id: null };
  editImageFile = null;
}

function handleModalOverlayClick(e) {
  if (e.target === document.getElementById('edit-modal')) closeEditModal();
}

async function saveEdit() {
  const { type, id } = editState;
  if (!type || !id) return;

  const name = document.getElementById('edit-name').value.trim();
  if (!name) { toast('Name is required'); return; }

  const btn = document.getElementById('edit-save-btn');
  btn.disabled = true;

  try {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('description', document.getElementById('edit-desc').value.trim());
    if (type === 'fridge') {
      fd.append('date_added', document.getElementById('edit-date').value);
      fd.append('quantity', String(parseInt(document.getElementById('edit-qty').value) || 1));
      fd.append('expiration_date', document.getElementById('edit-exp').value || '');
    }
    if (editImageFile) fd.append('image', editImageFile);

    const updated = await apiFetch(
      type === 'fridge' ? `/api/fridge/${id}` : `/api/library/${id}`,
      { method: 'PATCH', body: fd }
    );

    if (type === 'fridge') {
      const idx = fridgeItems.findIndex(i => i.id === id);
      if (idx !== -1) fridgeItems[idx] = updated;
      renderFridge();
    } else {
      const idx = libraryItems.findIndex(i => i.id === id);
      if (idx !== -1) libraryItems[idx] = updated;
      libraryItems.sort((a, b) => a.name.localeCompare(b.name));
      renderLibrary();
      renderQuickAdd();
    }

    closeEditModal();
    toast(`"${updated.name}" updated`);
  } catch {
    toast('Could not save changes');
  } finally {
    btn.disabled = false;
  }
}

// --- Utility ---
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
