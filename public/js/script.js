// Cek apakah komponen UI ada
document.addEventListener('DOMContentLoaded', () => {
  console.log('Cek elemen UI:');
  console.log('Send Button:', document.getElementById('sendButton'));
  console.log('Message Input:', document.getElementById('messageInput'));
  console.log('Chat Container:', document.getElementById('chatMessages'));
});


// ======================
// KONFIGURASI APLIKASI
// ======================
const APP_CONFIG = {
  storageKey: 'chatAppData',
  pollInterval: 2000,
  apiBase: window.location.hostname === 'localhost' 
    ? 'http://localhost:8888' 
    : 'https://your-netlify-site.netlify.app'
};

// ======================
// STATE APLIKASI
// ======================
const state = {
  currentRoom: null,
  secretKey: null,
  lastMessageTimestamp: 0,
  isPolling: false
};

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
// FUNGSI UTAMA
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
    const savedData = JSON.parse(localStorage.getItem(APP_CONFIG.storageKey)) || {};
    if (!savedData.currentRoomId) throw new Error('Room ID tidak ditemukan');

    state.currentRoom = savedData.currentRoomId;
    state.secretKey = await deriveSecretKey(state.currentRoom);

    document.getElementById('currentRoomId').textContent = state.currentRoom;
    setupEventListeners();
    
    messagePoller.start(
      state.currentRoom,
      handleNewMessages,
      APP_CONFIG.pollInterval
    );

  } catch (error) {
    console.error('Init error:', error);
    showError('Gagal memulai chat');
    window.location.href = 'index.html';
  }
}

function initHomePage() {
  document.getElementById('joinRoom').addEventListener('click', joinRoom);
  document.getElementById('createRoom').addEventListener('click', createRoom);
}

// ======================
// MANAJEMEN PESAN
// ======================
async function handleNewMessages(messages) {
  for (const msg of messages) {
    try {
      const decrypted = await window.decryptData(msg.message, state.secretKey);
      displayMessage('Partner', decrypted, msg.message, msg.id);
      messagePoller.processedIds.add(msg.id);
    } catch (error) {
      console.error('Message processing error:', error);
    }
  }
}

// 1. Fungsi utama pengiriman pesan (tetap menggunakan sendMessage seperti di kode asli Anda)
async function sendMessage() {
  console.log('[Debug] Memulai proses pengiriman...');
  
  const input = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  
  // Validasi
  if (!input || !sendButton) {
    console.error('Elemen tidak ditemukan');
    return;
  }

  const message = input.value.trim();
  if (!message) {
    showError('Pesan tidak boleh kosong');
    return;
  }

  // Tampilkan loading state
  sendButton.disabled = true;
  sendButton.textContent = 'Mengirim...';

  try {
    // Enkripsi dan tampilkan pesan
    const encrypted = await window.encryptData(message, state.secretKey);
    const tempId = `temp-${Date.now()}`;
    displayMessage('Anda', message, encrypted, tempId);
    input.value = '';

    // Kirim ke server
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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    updateMessageId(tempId, result.id);

  } catch (error) {
    console.error('Send error:', error);
    showError(`Gagal mengirim: ${error.message}`);
    input.value = message; // Kembalikan pesan jika gagal
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = 'Kirim';
  }
}

// 2. Fungsi untuk menerima pesan baru (handleNewMessages yang sudah ada di kode Anda)
async function handleNewMessages(messages) {
  console.log('[Debug] Memproses pesan baru:', messages.length);
  
  for (const msg of messages) {
    try {
      // Skip jika pesan sudah diproses atau dari diri sendiri
      if (messagePoller.processedIds.has(msg.id)) continue;
      if (msg.sender === 'user') continue;

      const decrypted = await window.decryptData(msg.message, state.secretKey);
      displayMessage('Partner', decrypted, msg.message, msg.id);
      messagePoller.processedIds.add(msg.id);

    } catch (error) {
      console.error('Error proses pesan:', error);
    }
  }
}

// ======================
// FUNGSI BANTU
// ======================
function setupEventListeners() {
  const sendButton = document.getElementById('sendButton');
  const messageInput = document.getElementById('messageInput');

  // Handler klik tombol
  sendButton?.addEventListener('click', (e) => {
    e.preventDefault();
    sendMessage(); // Memanggil fungsi utama yang sudah ada
  });

  // Handler tekan Enter
  messageInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage(); // Memanggil fungsi utama yang sudah ada
    }
  });
}

function displayMessage(sender, content, encrypted, messageId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const messageEl = document.createElement('div');
  messageEl.className = `message ${sender === 'Anda' ? 'sent' : 'received'}`;
  messageEl.dataset.messageId = messageId;
  messageEl.innerHTML = `
    <div class="sender">${sender}</div>
    <div class="content">${content}</div>
    ${encrypted ? `<div class="meta">🔒 ${encrypted.substring(0, 10)}...</div>` : ''}
  `;
  container.appendChild(messageEl);
  container.scrollTop = container.scrollHeight;
}

function updateMessageId(tempId, newId) {
  const msgElement = document.querySelector(`[data-message-id="${tempId}"]`);
  if (msgElement) msgElement.dataset.messageId = newId;
}

function removePendingMessage(messageId) {
  document.querySelector(`[data-message-id="${messageId}"]`)?.remove();
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
  errorEl.className = `alert ${type}`;
  errorEl.style.display = 'block';
  
  setTimeout(() => {
    errorEl.style.display = 'none';
  }, 5000);
}

// Cleanup saat window ditutup
window.addEventListener('beforeunload', () => {
  messagePoller.stop();
});