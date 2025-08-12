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
// FUNGSI UTAMA
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
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  
  if (!message || !state.currentRoom) return;

  try {
    const encrypted = await window.encryptData(message, state.secretKey);
    const response = await fetch(`${APP_CONFIG.apiBase}/.netlify/functions/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        roomId: state.currentRoom,
        encryptedMsg: encrypted
      })
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    input.value = '';
    displayMessage('Anda', message, encrypted);

  } catch (error) {
    console.error('Gagal mengirim pesan:', error);
    showError('Gagal mengirim pesan: ' + error.message);
  }
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

function startPolling() {
  const processMessages = async () => {
    const messages = await fetchMessages();
    messages.forEach(async msg => {
      if (!document.querySelector(`[data-message-id="${msg.id}"]`)) {
        const decrypted = await window.decryptData(msg.encrypted_message, state.secretKey);
        displayMessage('Partner', decrypted, msg.encrypted_message, msg.id);
      }
    });
    setTimeout(processMessages, APP_CONFIG.pollInterval);
  };
  processMessages();
}

function displayMessage(sender, content, encrypted, id) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const messageId = id || Date.now();
  
  if (!document.querySelector(`[data-message-id="${messageId}"]`)) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${sender === 'Anda' ? 'sent' : 'received'}`;
    messageEl.dataset.messageId = messageId;
    messageEl.innerHTML = `
      <div class="sender">${sender}</div>
      <div class="text">${content}</div>
      <div class="encrypted" title="Pesan terenkripsi">
        🔒 ${encrypted.substring(0, 30)}...
      </div>
    `;
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }
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