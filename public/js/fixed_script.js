// ======================
// KONFIGURASI APLIKASI
// ======================
const APP_CONFIG = {
  storageKey: 'chatAppData',
  pollInterval: 2000,
  // Pakai origin saat ini (Netlify/Vercel) agar tidak kena CORS.
  // Saat dev pakai Netlify CLI: http://localhost:8888
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
  secretKey: null, // CryptoKey
  lastMessageTimestamp: 0,
  isPolling: false
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

// ======================
// MANAJEMEN POLLING
// ======================
class PollingService {
  constructor() {
    this.intervalId = null;
    this.processedIds = new Set();
  }

  start(roomId, callback, interval) {
    this.stop();
    this.intervalId = setInterval(async () => {
      if (document.hidden || state.isPolling) return;
      state.isPolling = true;
      try {
        const messages = await this.fetchMessages(roomId);
        callback(messages);
      } catch (error) {
        console.error('Polling error:', error);
      } finally {
        state.isPolling = false;
      }
    }, interval);
  }

  async fetchMessages(roomId) {
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
    const { messages } = await response.json();
    if (!Array.isArray(messages)) throw new Error('Invalid response format');

    const newMessages = messages.filter(msg => msg.id && !this.processedIds.has(msg.id));
    if (newMessages.length > 0) {
      state.lastMessageTimestamp = Math.max(
        ...newMessages.map(m => new Date(m.timestamp).getTime())
      );
    }

    return newMessages;
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

    document.getElementById('currentRoomId').textContent = state.currentRoom;
    setupEventListeners();

    // Mulai polling
    messagePoller.start(
      state.currentRoom,
      handleNewMessages,
      APP_CONFIG.pollInterval
    );
  } catch (error) {
    console.error('Init error:', error);
    showError('Gagal memulai chat');
    location.href = 'index.html';
  }
}

function initHomePage() {
  const joinBtn = document.getElementById('joinRoom');
  const createBtn = document.getElementById('createRoom');
  const roomInput = document.getElementById('roomId');

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
async function handleNewMessages(messages) {
  for (const msg of messages) {
    try {
      // Skip jika dari diri sendiri (di-tag 'user')
      if (msg.sender === 'user') continue;
      const decrypted = await window.decryptData(msg.message, state.secretKey);
      displayMessage('Partner', decrypted ?? '[gagal dekripsi]', msg.message, msg.id);
      messagePoller.processedIds.add(msg.id);
    } catch (error) {
      console.error('Message processing error:', error);
    }
  }
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');

  if (!input || !sendButton) return;
  const message = input.value.trim();
  if (!message) return showError('Pesan tidak boleh kosong');

  // Loading state
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
        sender: 'user'
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    updateMessageId(tempId, result.id);
  } catch (error) {
    console.error('Send error:', error);
    showError(`Gagal mengirim: ${error.message}`);
    input.value = message;
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = 'Kirim';
  }
}

// ======================
// FUNGSI BANTU UI
// ======================
function setupEventListeners() {
  const sendButton = document.getElementById('sendButton');
  const messageInput = document.getElementById('messageInput');
  const leaveButton = document.getElementById('leaveRoom');

  sendButton?.addEventListener('click', (e) => {
    e.preventDefault();
    sendMessage();
  });

  messageInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  leaveButton?.addEventListener('click', (e) => {
    e.preventDefault();
    const saved = loadLocal();
    delete saved.currentRoomId;
    saveLocal(saved);
    // Hentikan polling dan redirect
    messagePoller.stop();
    location.href = 'index.html';
  });
}

function displayMessage(sender, content, encrypted, messageId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `message ${sender === 'Anda' ? 'sent' : 'received'}`;
  el.dataset.messageId = messageId;
  el.innerHTML = `
    <div class="sender">${sender}</div>
    <div class="content">
      <div class="text">${content ?? ''}</div>
      ${encrypted ? `<div class="encrypted">🔒 ${String(encrypted).slice(0, 20)}...</div>` : ''}
    </div>
  `;

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

// Cleanup saat window ditutup
window.addEventListener('beforeunload', () => {
  messagePoller.stop();
});
