// ======================
// KONFIGURASI APLIKASI
// ======================
const APP_CONFIG = {
  storageKey: 'chatAppData',
  pollInterval: 2000,
  apiBase: window.location.hostname === 'localhost' 
    ? 'http://localhost:8888' 
    : ''
};

// ======================
// STATE APLIKASI
// ======================
let state = {
  currentRoom: null,
  secretKey: null,
  isPolling: false
};

// ======================
// INISIALISASI APLIKASI
// ======================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Aplikasi diinisialisasi...');
  
  if (document.body.id === 'chat-page') {
    await initChatPage();
  } else {
    initHomePage();
  }
});

// ======================
// FUNGSI UTAMA// Pastikan fungsi enkripsi/dekripsi tersedia
if (!window.encryptData || !window.decryptData) {
  showError('Fungsi enkripsi tidak tersedia');
  disableChatInput();
}

function disableChatInput() {
  const input = document.getElementById('messageInput');
  const button = document.getElementById('sendButton');
  if (input) input.disabled = true;
  if (button) button.disabled = true;
}
// ======================
async function initChatPage() {
  try {
    const savedData = JSON.parse(localStorage.getItem(APP_CONFIG.storageKey)) || {};
    if (!savedData.currentRoomId) {
      throw new Error('Room ID tidak ditemukan');
    }

    state = {
      currentRoom: savedData.currentRoomId,
      secretKey: await deriveSecretKey(savedData.currentRoomId),
      isPolling: false,
      pollingInterval: null,
      lastMessageTimestamp: 0
    };

    document.getElementById('currentRoomId').textContent = state.currentRoom;
    setupEventListeners();
    startPolling();

  } catch (error) {
    console.error('Init error:', error);
    showError('Gagal memuat chat');
    window.location.href = 'index.html';
    stopPolling();
  }
}

function initHomePage() {
  document.getElementById('joinRoom').addEventListener('click', joinRoom);
  document.getElementById('createRoom').addEventListener('click', createRoom);
}

// ======================
// MANAJEMEN ROOM
// ======================
async function joinRoom() {
  const roomId = document.getElementById('roomId').value.trim();
  if (!roomId) {
    showError('Masukkan Room ID');
    return;
  }

  await setupRoom(roomId);
  window.location.href = 'room.html';
}

async function createRoom() {
  const roomId = generateRoomId();
  document.getElementById('roomId').value = roomId;
  await joinRoom();
}

async function setupRoom(roomId) {
  state.currentRoom = roomId;
  state.secretKey = await deriveSecretKey(roomId);
  
  localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify({
    currentRoomId: roomId,
    lastActive: Date.now()
  }));
}

// ======================
// MANAJEMEN PESAN
// ======================
// Variabel global untuk tracking pesan
const pendingMessages = new Set();

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  
  // Validasi lebih ketat
  if (!message || message.length > 500) {
    showError('Pesan harus 1-500 karakter');
    return;
  }

  if (!state.currentRoom || !state.secretKey) {
    showError('Sesi tidak valid, muat ulang halaman');
    return;
  }

  const tempId = `temp-${Date.now()}`;
  let sendSuccess = false;

  try {
    // Tampilkan pesan segera di UI
    displayMessage('Anda', message, '', tempId, true);
    input.value = '';
    pendingMessages.add(tempId);

    // Enkripsi dan siapkan data
    const encrypted = await window.encryptData(message, state.secretKey);
    const postData = {
      action: 'send',
      roomId: state.currentRoom,
      message: encrypted,
      messageId: tempId,
      sender: 'user',
      timestamp: new Date().toISOString()
    };

    // Kirim ke server
    const response = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': tempId
      },
      body: JSON.stringify(postData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error ${response.status}`);
    }

    const result = await response.json();
    updateMessageId(tempId, result.id);
    sendSuccess = true;

  } catch (error) {
    console.error('Send failed:', error);
    showError(`Gagal mengirim: ${error.message}`);
    
    // Hapus pesan pending jika gagal
    if (tempId) {
      removePendingMessage(tempId);
    }
    
    // Kembalikan pesan ke input jika belum ditampilkan di UI
    if (!sendSuccess && message) {
      input.value = message;
    }
  }
}

function updateMessageId(tempId, newId) {
  if (!tempId || !newId) return;
  
  const msgElement = document.querySelector(`[data-message-id="${tempId}"]`);
  if (msgElement) {
    msgElement.dataset.messageId = newId;
    msgElement.classList.remove('pending');
    pendingMessages.delete(tempId);
  }
}

function removePendingMessage(tempId) {
  if (!tempId) return;
  
  const messageElement = document.querySelector(`[data-message-id="${tempId}"]`);
  if (messageElement) {
    messageElement.remove();
  }
  pendingMessages.delete(tempId);
}

async function fetchMessages() {
  if (!state.currentRoom) return [];

  try {
    const response = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Request-ID': `fetch-${Date.now()}`
      },
      body: JSON.stringify({
        action: 'get',
        roomId: state.currentRoom,
        lastUpdate: state.lastMessageTimestamp || 0
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (!Array.isArray(data.messages)) {
      throw new Error('Invalid messages format');
    }

    // Update timestamp terakhir
    if (data.messages.length > 0) {
      state.lastMessageTimestamp = Math.max(
        ...data.messages
          .map(m => m.timestamp ? new Date(m.timestamp).getTime() : 0)
          .filter(t => !isNaN(t))
      );
    }

    return data.messages;
  } catch (error) {
    console.error('Fetch failed:', error);
    return [];
  }
}


// ======================
// FUNGSI BANTU
// ======================
function setupEventListeners() {
  const sendButton = document.getElementById('sendButton');
  const messageInput = document.getElementById('messageInput');
  const leaveButton = document.getElementById('leaveRoom');

  if (!sendButton || !messageInput || !leaveButton) {
    throw new Error('Elemen UI tidak ditemukan');
  }

  sendButton.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  leaveButton.addEventListener('click', () => {
    localStorage.removeItem(APP_CONFIG.storageKey);
    window.location.href = 'index.html';
  });

   window.addEventListener('unload', stopPolling);
  document.getElementById('leaveRoom').addEventListener('click', () => {
    stopPolling();
    localStorage.removeItem(APP_CONFIG.storageKey);
    window.location.href = 'index.html';
  });

}

let isProcessing = false;
let pollingActive = true;

async function processMessages(processedMessageIds) {
  if (!pollingActive || isProcessing || !state.currentRoom) return;

  isProcessing = true;
  
  try {
    const messages = await fetchMessages();
    const newMessages = messages.filter(msg => 
      msg.id && 
      !processedMessageIds.has(msg.id) && 
      msg.sender !== 'user'
    );

    for (const msg of newMessages) {
      try {
        const decrypted = await window.decryptData(msg.message, state.secretKey);
        displayMessage('Partner', decrypted, msg.message, msg.id);
        processedMessageIds.add(msg.id);
      } catch (decryptError) {
        console.error('Decryption failed:', decryptError);
      }
    }
  } catch (error) {
    console.error('Polling error:', error);
  } finally {
    isProcessing = false;
    if (pollingActive) {
      setTimeout(() => processMessages(processedMessageIds), APP_CONFIG.pollInterval);
    }
  }
}

// Variabel state untuk polling
let pollingInterval = null;
let processedMessageIds = new Set();

// Fungsi polling yang diperbaiki
function startPolling() {
  // Hentikan polling sebelumnya jika ada
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  
  // Mulai polling baru
  pollingInterval = setInterval(async () => {
    if (document.hidden) return; // Jangan polling jika tab tidak aktif
    
    try {
      const messages = await fetchMessages();
      
      for (const msg of messages) {
        if (!processedMessageIds.has(msg.id)) {
          const decrypted = await window.decryptData(msg.message, state.secretKey);
          displayMessage('Partner', decrypted, msg.message, msg.id);
          processedMessageIds.add(msg.id);
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, APP_CONFIG.pollInterval);
}

// Fungsi untuk menghentikan polling
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Panggil stopPolling saat komponen unmount atau halaman ditutup
window.addEventListener('beforeunload', stopPolling);

function displayMessage(sender, content, encrypted, messageId, isSender = false) {
  const container = document.getElementById('chatMessages');
  // Skip jika pesan sudah ada
  if (!container || document.querySelector(`[data-message-id="${messageId}"]`)) return;

  const messageEl = document.createElement('div');
  messageEl.className = `message ${sender === 'Anda' ? 'sent' : 'received'}`;
  messageEl.dataset.messageId = messageId;
  messageEl.innerHTML = `
    <div class="sender">${sender}</div>
    <div class="text">${content}</div>
    ${encrypted ? `<div class="encrypted">🔒 ${encrypted.substring(0, 20)}...</div>` : ''}
  `;
  container.appendChild(messageEl);
  container.scrollTop = container.scrollHeight;
}

function generateRoomId() {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  return `room-${array[0].toString(36).slice(-8)}`;
}

async function deriveSecretKey(roomId) {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(roomId),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  
  return window.crypto.subtle.deriveKey(
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

function showError(message) {
  const errorEl = document.getElementById('errorAlert');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    setTimeout(() => errorEl.style.display = 'none', 5000);
  }
  console.error(message);
}

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  showError('Terjadi kesalahan sistem');
});

// Handle offline state
window.addEventListener('offline', () => {
  showError('Koneksi terputus, mencoba menyambung kembali...');
});

window.addEventListener('online', () => {
  showError('Koneksi pulih', 'success');
});

// Debounce untuk pesan masuk
let processing = false;
async function processMessages(processedMessageIds) {
  if (processing) return;
  processing = true;
  
  try {
    // ... existing code ...
  } finally {
    processing = false;
    setTimeout(() => processMessages(processedMessageIds), APP_CONFIG.pollInterval);
  }
}

// Cache untuk pesan yang sudah dienkripsi
const encryptionCache = new Map();
async function encryptData(data, key) {
  const cacheKey = `${data}-${key}`;
  if (encryptionCache.has(cacheKey)) {
    return encryptionCache.get(cacheKey);
  }
  
  const encrypted = await window.encryptData(data, key);
  encryptionCache.set(cacheKey, encrypted);
  return encrypted;
}

async function fetchMessagesWithRetry(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchMessages();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}