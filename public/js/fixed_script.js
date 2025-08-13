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
  deletedIds: new Set(),
  mediaRecorder: null,
  recordingChunks: []
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
// BASE64 helpers
// ======================
function bytesToBase64(bytes) {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ======================
// CRYPTO untuk FILE
// ======================
async function encryptBytes(arrayBuffer, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    arrayBuffer
  );
  return {
    iv: Array.from(iv),
    data: bytesToBase64(new Uint8Array(ct))
  };
}

async function decryptBytes(payload, key) {
  const iv = new Uint8Array(payload.iv || payload.i || []);
  const data = base64ToBytes(payload.data || payload.d || '');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return pt; // ArrayBuffer
}

// ======================
// MANAJEMEN POLLING
// ======================
class PollingService {
  constructor() { this.intervalId = null; }

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
    ensureMediaUI();
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

      // Coba parse sebagai payload media
      let payload;
      try { payload = JSON.parse(msg.message); } catch { payload = null; }

      if (payload && payload.t && payload.data && payload.iv) {
        // Media atau text baru dengan format payload
        if (payload.t === 'text') {
          // teks terenkripsi (via encryptBytes)
          const ab = await decryptBytes(payload, state.secretKey);
          const text = new TextDecoder().decode(ab);
          displayMessage('Partner', text, '[encrypted]', msg.id);
        } else if (payload.t === 'image' || payload.t === 'audio' || payload.t === 'voice') {
          const ab = await decryptBytes(payload, state.secretKey);
          const blob = new Blob([ab], { type: payload.mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          displayMediaMessage('Partner', payload.t, url, payload, msg.id);
        } else {
          // fallback unknown type
          displayMessage('Partner', '[jenis pesan tidak dikenal]', null, msg.id);
        }
      } else {
        // Legacy: anggap string terenkripsi untuk teks dengan window.decryptData
        const decrypted = await (window.decryptData
          ? window.decryptData(msg.message, state.secretKey)
          : Promise.resolve('[encryption helper missing]'));
        displayMessage('Partner', decrypted ?? '[gagal dekripsi]', msg.message, msg.id);
      }

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
    // Gunakan payload format baru berbasis bytes agar konsisten dengan file
    const ab = new TextEncoder().encode(message);
    const enc = await encryptBytes(ab, state.secretKey);
    const payload = {
      t: 'text',
      iv: enc.iv,
      data: enc.data
    };

    const tempId = `temp-${Date.now()}`;
    displayMessage('Anda', message, '[encrypted]', tempId);
    input.value = '';

    const response = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        roomId: state.currentRoom,
        message: JSON.stringify(payload),
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
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = 'Kirim';
  }
}

// ======================
// MEDIA UI (upload & voice)
// ======================
function ensureMediaUI() {
  const toolbar = $('.chat-header') || document.querySelector('.toolbar') || document.body;
  const mediaBar = document.createElement('div');
  mediaBar.className = 'media-toolbar';
  mediaBar.innerHTML = `
    <input type="file" id="fileInput" accept="image/*,audio/*" style="display:none" />
    <button id="attachBtn" class="btn-secondary">📎 Lampirkan</button>
    <button id="voiceBtn" class="btn-secondary">🎤 Rekam</button>
  `;
  toolbar.appendChild(mediaBar);

  $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', onFileChosen);
  $('#voiceBtn').addEventListener('click', toggleVoiceRecording);
}

async function onFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const enc = await encryptBytes(buf, state.secretKey);
    const kind = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('audio/') ? 'audio' : 'file');

    const payload = {
      t: kind,
      mime: file.type || 'application/octet-stream',
      name: file.name || '',
      size: file.size || 0,
      iv: enc.iv,
      data: enc.data
    };

    await sendPayloadMessage(payload, { preview: file });
  } catch (err) {
    console.error('attach error', err);
    showError('Gagal melampirkan file');
  } finally {
    e.target.value = ''; // reset
  }
}

async function toggleVoiceRecording() {
  const btn = $('#voiceBtn');
  if (!state.mediaRecorder) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      state.mediaRecorder = mr;
      state.recordingChunks = [];
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) state.recordingChunks.push(ev.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(state.recordingChunks, { type: 'audio/webm' });
        const buf = await blob.arrayBuffer();
        const enc = await encryptBytes(buf, state.secretKey);
        const payload = {
          t: 'voice',
          mime: 'audio/webm',
          name: `voice-${Date.now()}.webm`,
          size: blob.size,
          iv: enc.iv,
          data: enc.data
        };
        await sendPayloadMessage(payload, { preview: blob });
        state.mediaRecorder = null;
        state.recordingChunks = [];
        btn.textContent = '🎤 Rekam';
      };
      mr.start();
      btn.textContent = '⏺️ Rekam... (klik utk stop)';
    } catch (err) {
      console.error('mic error', err);
      showError('Tidak bisa akses mikrofon');
      state.mediaRecorder = null;
      state.recordingChunks = [];
    }
  } else {
    try {
      state.mediaRecorder.stop();
    } catch {}
  }
}

async function sendPayloadMessage(payload, { preview } = {}) {
  const tempId = `temp-${Date.now()}`;

  // Tampilkan preview
  if (payload.t === 'image') {
    const url = URL.createObjectURL(preview);
    displayMediaMessage('Anda', 'image', url, payload, tempId);
  } else if (payload.t === 'audio' || payload.t === 'voice') {
    const url = URL.createObjectURL(preview);
    displayMediaMessage('Anda', 'audio', url, payload, tempId);
  } else {
    displayMessage('Anda', `[${payload.t}] ${payload.name || ''}`, '[encrypted]', tempId);
  }

  try {
    const res = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        roomId: state.currentRoom,
        message: JSON.stringify(payload),
        messageId: tempId,
        sender: state.senderId
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = await res.json();
    updateMessageId(tempId, out.id);
    state.processedIds.add(out.id);
  } catch (err) {
    console.error('send media error', err);
    showError('Gagal mengirim media');
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
      ${encrypted ? `<div class="encrypted">🔒</div>` : ''}
    </div>
  `;

  el.addEventListener('click', () => {
    if (!state.selectionMode) return;
    toggleMessageSelection(el);
  });

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function displayMediaMessage(sender, kind, url, payload, messageId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `message ${sender === 'Anda' ? 'sent' : 'received'}`;
  el.dataset.messageId = messageId;

  let inner = `<div class="sender">${sender}</div><div class="content">`;
  if (kind === 'image') {
    inner += `<img src="${url}" alt="${escapeHTML(payload.name || 'image')}" class="media-image" />`;
  } else if (kind === 'audio' || kind === 'voice') {
    inner += `<audio controls src="${url}" class="media-audio"></audio>`;
  } else {
    inner += `<div class="file">${escapeHTML(payload.name || 'file')}</div>`;
  }
  inner += `<div class="encrypted">🔒</div></div>`;

  el.innerHTML = inner;

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

function showErrorInline(message) { alert(message); }

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[ch]));
}

window.addEventListener('beforeunload', () => { messagePoller.stop(); });
