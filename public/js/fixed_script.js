// ======================
// KONFIGURASI APLIKASI
// ======================
const APP_CONFIG = {
  storageKey: 'chatAppData',
  pollInterval: 2000,
  apiBase:
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:8888'
      : ''
};

// ======================
// STATE APLIKASI
// ======================
const state = {
  currentRoom: null,
  secretKey: null,
  lastMessageTimestamp: 0,
  isPolling: false,
  senderId: null,
  selectionMode: false,
  selectedIds: new Set(),
  processedIds: new Set(),
  deletedIds: new Set()
};

// ======================
// UTIL
// ======================
function saveLocal(data) {
  localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(data));
}
function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(APP_CONFIG.storageKey)) || {};
  } catch {
    return {};
  }
}
function randomRoomId(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function randomSenderId() {
  return 'user-' + Math.random().toString(36).slice(2, 10);
}

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

// ======================
// MANAJEMEN POLLING
// ======================
class PollingService {
  constructor() {
    this.intervalId = null;
  }

  start(roomId, callback, interval) {
    this.stop();
    this.intervalId = setInterval(async () => {
      if (document.hidden || state.isPolling) return;
      state.isPolling = true;
      try {
        const data = await this.fetchDelta(roomId);
        callback(data);
      } catch (error) {
        console.error('Polling error:', error);
      } finally {
        state.isPolling = false;
      }
    }, interval);
  }

  async fetchDelta(roomId) {
    const response = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get',
        roomId,
        lastUpdate: state.lastMessageTimestamp
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const deletes  = Array.isArray(payload.deletes)  ? payload.deletes  : [];

    const maxCreated = messages.reduce((acc, m) => Math.max(acc, new Date(m.timestamp).getTime()), 0);
    const maxDeleted = deletes.reduce((acc, d) => Math.max(acc, new Date(d.updated_at).getTime()), 0);
    state.lastMessageTimestamp = Math.max(state.lastMessageTimestamp, maxCreated, maxDeleted);

    return { messages, deletes };
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

const messagePoller = new PollingService();

// ======================
// INISIALISASI
// ======================
document.addEventListener('DOMContentLoaded', () => {
  const saved = loadLocal();

  if (!saved.senderId) {
    saved.senderId = randomSenderId();
    saveLocal(saved);
  }
  state.senderId = saved.senderId;

  if (document.body.id === 'chat-page') {
    initChatPage();
  } else {
    initHomePage();
  }
});

async function initChatPage() {
  try {
    const saved = loadLocal();
    if (!saved.currentRoomId) throw new Error('Room ID tidak ditemukan');

    state.currentRoom = saved.currentRoomId;
    state.secretKey = await deriveSecretKey(state.currentRoom);

    $('#currentRoomId').textContent = state.currentRoom;
    setupEventListeners();
    ensureToolbar();
    state.lastMessageTimestamp = 0;

    messagePoller.start(
      state.currentRoom,
      ({ messages, deletes }) => {
        handleDeletes(deletes);
        handleNewMessages(messages);
      },
      APP_CONFIG.pollInterval
    );
  } catch (error) {
    console.error('Init error:', error);
    showError('Gagal memulai chat');
    location.href = 'index.html';
  }
}

function initHomePage() {
  const joinBtn = $('#joinRoom');
  const createBtn = $('#createRoom');
  const roomInput = $('#roomId');

  if (joinBtn) {
    joinBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const room = (roomInput?.value || '').trim();
      if (!room) return showErrorInline('Masukkan Room ID terlebih dahulu');
      const saved = loadLocal();
      saved.currentRoomId = room;
      saveLocal(saved);
      location.href = 'room.html';
    });
  }

  if (createBtn) {
    createBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const room = randomRoomId();
      const saved = loadLocal();
      saved.currentRoomId = room;
      saveLocal(saved);
      location.href = 'room.html';
    });
  }
}

// ======================
// MANAJEMEN PESAN
// ======================
function handleDeletes(deletes) {
  for (const d of deletes) {
    const id = d.id;
    state.deletedIds.add(id);
    state.processedIds.delete(id);
    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (el) el.remove();
  }
}

async function handleNewMessages(messages) {
  for (const msg of messages) {
    try {
      if (!msg.id || state.processedIds.has(msg.id) || state.deletedIds.has(msg.id)) continue;
      if (msg.sender === state.senderId) {
        state.processedIds.add(msg.id);
        continue;
      }
      const decrypted = await window.decryptData(msg.message, state.secretKey);
      displayMessage('Partner', decrypted ?? '[gagal dekripsi]', msg.message, msg.id);
      state.processedIds.add(msg.id);
    } catch (error) {
      console.error('Message processing error:', error);
    }
  }
}

async function sendMessage() {
  const input = $('#messageInput');
  const sendButton = $('#sendButton');

  if (!input || !sendButton) return;
  const message = input.value.trim();
  if (!message) return showError('Pesan tidak boleh kosong');

  sendButton.disabled = true;
  sendButton.textContent = 'Mengirim...';

  try {
    const encrypted = await window.encryptData(message, state.secretKey);
    const tempId = `temp-${Date.now()}`;
    displayMessage('Anda', message, encrypted, tempId);
    input.value = '';

    const response = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        roomId: state.currentRoom,
        message: encrypted,
        messageId: tempId,
        sender: state.senderId
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    updateMessageId(tempId, result.id);
    state.processedIds.add(result.id);
  } catch (error) {
    console.error('Send error:', error);
    showError(`Gagal mengirim: ${error.message}`);
    input.value = message;
    const el = document.querySelector(`[data-message-id="${tempId}"]`);
    el?.remove();
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = 'Kirim';
  }
}

// ======================
// SELECTION & DELETE UI
// ======================
function ensureToolbar() {
  let toolbar = $('#selectionToolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'selectionToolbar';
    toolbar.className = 'selection-toolbar';
    toolbar.innerHTML = `
      <button id="toggleSelect" class="btn-secondary">Pilih</button>
      <button id="deleteSelected" class="btn-danger" disabled>Hapus</button>
      <button id="cancelSelect" class="btn-ghost" style="display:none">Batal</button>
    `;
    const header = document.querySelector('.chat-header') || document.body;
    header.appendChild(toolbar);
  }

  $('#toggleSelect').addEventListener('click', toggleSelectionMode);
  $('#cancelSelect').addEventListener('click', exitSelectionMode);
  $('#deleteSelected').addEventListener('click', deleteSelectedMessages);
}

function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  $('#cancelSelect').style.display = state.selectionMode ? 'inline-block' : 'none';
  $('#deleteSelected').disabled = !state.selectionMode || state.selectedIds.size === 0;
  $('#toggleSelect').textContent = state.selectionMode ? 'Pilih (ON)' : 'Pilih';
  document.getElementById('chatMessages')?.classList.toggle('selectable', state.selectionMode);
}

function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedIds.clear();
  $all('.message.selected').forEach(el => el.classList.remove('selected'));
  $('#deleteSelected').disabled = true;
  $('#cancelSelect').style.display = 'none';
  $('#toggleSelect').textContent = 'Pilih';
  document.getElementById('chatMessages')?.classList.remove('selectable');
}

function toggleMessageSelection(el) {
  const id = el.dataset.messageId;
  if (!id) return;
  if (el.classList.toggle('selected')) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  $('#deleteSelected').disabled = state.selectedIds.size === 0;
}

async function deleteSelectedMessages() {
  if (state.selectedIds.size === 0) return;
  const ids = Array.from(state.selectedIds);
  ids.forEach(id => {
    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (el) el.remove();
    state.deletedIds.add(id);
    state.processedIds.delete(id);
  });
  exitSelectionMode();

  try {
    const response = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        roomId: state.currentRoom,
        messageIds: ids
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    console.error('Delete error:', err);
    showError('Gagal menghapus di server, refresh halaman.');
  }
}

// ======================
// FUNGSI BANTU UI
// ======================
function setupEventListeners() {
  const sendButton = $('#sendButton');
  const messageInput = $('#messageInput');
  const leaveButton = $('#leaveRoom');

  sendButton?.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.selectionMode) return;
    sendMessage();
  });

  messageInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.selectionMode) return;
      sendMessage();
    }
  });

  leaveButton?.addEventListener('click', (e) => {
    e.preventDefault();
    const saved = loadLocal();
    delete saved.currentRoomId;
    saveLocal(saved);
    messagePoller.stop();
    location.href = 'index.html';
  });
}

function displayMessage(sender, content, encrypted, messageId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  if (!messageId) messageId = `local-${Date.now()}`;

  const el = document.createElement('div');
  el.className = `message ${sender === 'Anda' ? 'sent' : 'received'}`;
  el.dataset.messageId = messageId;
  el.innerHTML = `
    <div class="sender">${sender}</div>
    <div class="content">
      <div class="text">${escapeHTML(content ?? '')}</div>
      ${encrypted ? `<div class="encrypted">🔒 ${String(encrypted).slice(0, 20)}...</div>` : ''}
    </div>
  `;

  el.addEventListener('click', () => {
    if (!state.selectionMode) return;
    toggleMessageSelection(el);
  });

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function updateMessageId(tempId, newId) {
  const el = document.querySelector(`[data-message-id="${tempId}"]`);
  if (el) el.dataset.messageId = newId;
}

async function deriveSecretKey(roomId) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(roomId),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('secure-salt'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function showError(message, type = 'error') {
  const errorEl = document.getElementById('errorAlert');
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.className = `error-message ${type}`;
  errorEl.style.display = 'block';
  setTimeout(() => (errorEl.style.display = 'none'), 5000);
}

function showErrorInline(message) {
  alert(message);
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[ch]));
}

window.addEventListener('beforeunload', () => {
  messagePoller.stop();
});
