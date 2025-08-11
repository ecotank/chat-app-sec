// ======================
// CONSTANTS & STATE
// ======================
const APP_STORAGE_KEY = 'chatAppData';
let currentRoom = null;
let secretKey = null;


// Di bagian atas script.js
const currentPage = document.body.id || 'index'; // Tambahkan id body di HTML

if (currentPage === 'chat-page') {
  initChatPage();
} else {
  initHomePage();
}

function initChatPage() {
  if (!document.getElementById('sendButton')) {
    console.error('Elemen chat tidak ditemukan!');
    return;
  }
  initEventListeners();
  pollMessages();
}
// ======================
// UTILITY FUNCTIONS
// ======================
function generateRoomId() {
    const crypto = window.crypto || window.msCrypto;
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
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

// ======================
// CORE FUNCTIONS
// ======================
async function initRoom() {
    const savedData = JSON.parse(localStorage.getItem(APP_STORAGE_KEY)) || {};
    
    if (savedData.currentRoomId) {
        currentRoom = savedData.currentRoomId;
        secretKey = await deriveSecretKey(currentRoom);
        return true;
    }
    return false;
}

async function setupRoom(roomId) {
    currentRoom = roomId;
    secretKey = await deriveSecretKey(roomId);
    
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({
        currentRoomId: roomId,
        lastActive: Date.now()
    }));
}

// ======================
// MESSAGE HANDLING
// ======================
async function sendMessage() {
  try {
    const response = await fetch('/.netlify/functions/chat', {
      method: 'POST', // ← PASTIKAN METHOD POST
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'send',
        roomId: 'your-room-id',
        encryptedMsg: 'your-encrypted-data'
      })
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to send:', error);
    showError('Gagal mengirim pesan');
  }
}

async function fetchMessages() {
    if (!currentRoom) return [];
    
    try {
        const response = await fetch('/.netlify/functions/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'get',
                roomId: currentRoom
            })
        });
        
        if (!response.ok) throw new Error(await response.text());
        return await response.json();
    } catch (error) {
        console.error('Fetch failed:', error);
        return [];
    }
}

// ======================
// UI FUNCTIONS
// ======================
function displayMessage(sender, content, encrypted) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${sender === 'You' ? 'sent' : 'received'}`;
    messageEl.innerHTML = `
        <div class="sender">${sender}</div>
        <div class="content">${content}</div>
        <div class="encrypted" title="Encrypted payload">
            🔒 ${encrypted.substring(0, 30)}...
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showError(message) {
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.textContent = message;
    document.body.appendChild(errorEl);
    setTimeout(() => errorEl.remove(), 5000);
}

// ======================
// EVENT HANDLERS
// ======================
async function handleSend() {
    const input = document.getElementById('messageInput');
    if (!input || !input.value.trim()) return;
    
    const message = input.value;
    input.value = '';
    
    if (await sendMessage(message)) {
        displayMessage('You', message, await window.encryptData(message, secretKey));
    }
}

async function handleRoomJoin() {
    const input = document.getElementById('roomId');
    if (!input || !input.value.trim()) {
        showError('Masukkan Room ID');
        return;
    }
    
    await setupRoom(input.value.trim());
    window.location.href = 'room.html';
}

function handleRoomCreate() {
    const input = document.getElementById('roomId');
    if (!input) return;
    
    input.value = generateRoomId();
    handleRoomJoin();
}

// ======================
// INITIALIZATION
// ======================
document.addEventListener('DOMContentLoaded', async () => {
    // Home Page Logic
    if (document.getElementById('joinRoom')) {
        document.getElementById('joinRoom').addEventListener('click', handleRoomJoin);
        document.getElementById('createRoom').addEventListener('click', handleRoomCreate);
    }
    
    // Chat Room Logic
    if (document.getElementById('currentRoomId')) {
        const isRoomReady = await initRoom();
        if (!isRoomReady) {
            window.location.href = 'index.html';
            return;
        }
        
        document.getElementById('currentRoomId').textContent = currentRoom;

        function initEventListeners() {
  const sendButton = document.getElementById('sendButton');
  const messageInput = document.getElementById('messageInput');
  
  if (sendButton && messageInput) {
    sendButton.addEventListener('click', sendChatMessage);
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });
  } else {
    console.warn('Elemen tidak ditemukan! Pastikan ID benar dan halaman sudah load');
  }
}

// Panggil setelah DOM siap
document.addEventListener('DOMContentLoaded', initEventListeners);
        
        // Setup message polling
        const poll = async () => {
            const messages = await fetchMessages();
            messages.forEach(async msg => {
                const decrypted = await window.decryptData(msg.encrypted_message, secretKey);
                displayMessage('Partner', decrypted, msg.encrypted_message);
            });
        };
        
        poll(); // Initial load
        setInterval(poll, 2000); // Regular updates
        
        document.getElementById('leaveRoom').addEventListener('click', () => {
            localStorage.removeItem(APP_STORAGE_KEY);
            window.location.href = 'index.html';
        });
    }
});