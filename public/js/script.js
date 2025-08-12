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
    // Load state dari localStorage
    const savedData = JSON.parse(localStorage.getItem(APP_CONFIG.storageKey)) || {};
    if (!savedData.currentRoomId) {
      throw new Error('Room ID tidak ditemukan');
    }

    state.currentRoom = savedData.currentRoomId;
    state.secretKey = await deriveSecretKey(state.currentRoom);

    // Update UI
    document.getElementById('currentRoomId').textContent = state.currentRoom;
    setupEventListeners();
    startPolling();

  } catch (error) {
    console.error('Gagal inisialisasi chat:', error);
    window.location.href = 'index.html';
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
  
  if (!message) {
    showError('Pesan tidak boleh kosong');
    return;
  }

  if (!state.currentRoom) {
    showError('Room ID tidak valid');
    return;
  }

  // Definisikan tempId di awal fungsi
  const tempId = `temp-${Date.now()}`;
  let shouldRestoreMessage = true;

  try {
    const encrypted = await window.encryptData(message, state.secretKey);
    
    // Tampilkan pesan sebagai outgoing
    displayMessage('Anda', message, encrypted, tempId);
    input.value = '';
    pendingMessages.add(tempId);
    shouldRestoreMessage = false; // Jangan restore jika sudah berhasil sampai sini

    // Data yang akan dikirim
    const postData = {
      action: 'send',
      roomId: state.currentRoom,
      message: encrypted, // Pastikan key ini sesuai dengan yang diharapkan server
      messageId: tempId, // Beberapa server mengharapkan key messageId
      sender: 'user',
      timestamp: Date.now()
    };

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
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    updateMessageId(tempId, result.messageId || tempId);
    shouldRestoreMessage = false;

  } catch (error) {
    console.error('Send error:', error);
    
    // Gunakan tempId yang sudah didefinisikan di awal
    if (tempId) {
      removePendingMessage(tempId);
    }
    
    showError(error.message || 'Gagal mengirim pesan');
    
    if (shouldRestoreMessage && message) {
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
  if (!state.currentRoom || state.isPolling) return;

  state.isPolling = true;
  
  try {
    const response = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get',
        roomId: state.currentRoom
      })
    });

    if (!response.ok) return [];
    
    const data = await response.json();
    return Array.isArray(data.messages) ? data.messages : [];

  } catch (error) {
    console.error('Gagal mengambil pesan:', error);
    return [];
  } finally {
    state.isPolling = false;
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
}

async function processMessages(processedMessageIds) {
  if (document.hidden) {
    setTimeout(() => processMessages(processedMessageIds), APP_CONFIG.pollInterval * 3);
    return;
  }

  try {
    const messages = await fetchMessages();
    
    for (const msg of messages) {
      // Skip jika:
      // 1. Sudah diproses
      // 2. Tidak ada ID
      // 3. Dari pengguna sendiri
      if (processedMessageIds.has(msg.id) || 
          !msg.id ||
          msg.sender === 'user') {
        continue;
      }

      const decryptedText = await window.decryptData(msg.encrypted_message, state.secretKey);
      displayMessage(
        'Partner', 
        decryptedText,
        msg.encrypted_message,
        msg.id
      );
      
      processedMessageIds.add(msg.id);
    }
  } catch (error) {
    console.error('Polling error:', error);
  } finally {
    setTimeout(() => processMessages(processedMessageIds), APP_CONFIG.pollInterval);
  }
}

function startPolling() {
  const processedMessageIds = new Set();
  processMessages(processedMessageIds); // Start the polling loop
}

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