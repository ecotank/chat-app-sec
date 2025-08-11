// Fungsi untuk menghasilkan ID room acak
function generateRoomId() {
    return 'room-' + Math.random().toString(36).substr(2, 9);
}

// Fungsi untuk mengenkripsi pesan
async function encryptMessage(message, secretKey) {
    // Implementasi enkripsi menggunakan Web Crypto API
    // Lihat detail di crypto.js
    return await window.encryptData(message, secretKey);
}

// Fungsi untuk mendekripsi pesan
async function decryptMessage(encryptedMessage, secretKey) {
    // Implementasi dekripsi menggunakan Web Crypto API
    return await window.decryptData(encryptedMessage, secretKey);
}

// Fungsi utama ketika halaman dimuat
document.addEventListener('DOMContentLoaded', function() {
    // Logika untuk halaman utama
    if (document.getElementById('joinRoom')) {
        const joinBtn = document.getElementById('joinRoom');
        const createBtn = document.getElementById('createRoom');
        const roomIdInput = document.getElementById('roomId');
        
        joinBtn.addEventListener('click', function() {
            const roomId = roomIdInput.value.trim();
            if (roomId) {
                // Simpan roomId di sessionStorage
                sessionStorage.setItem('currentRoomId', roomId);
                // Generate secret key dari roomId (bisa diimprove)
                sessionStorage.setItem('secretKey', roomId + '-secret');
                window.location.href = 'room.html';
            }
        });
        
        createBtn.addEventListener('click', function() {
            const newRoomId = generateRoomId();
            roomIdInput.value = newRoomId;
            // Auto-join ke room baru
            joinBtn.click();
        });
    }
    
    // Logika untuk halaman chat room
    if (document.getElementById('currentRoomId')) {
        const roomId = sessionStorage.getItem('currentRoomId');
        const secretKey = sessionStorage.getItem('secretKey');
        document.getElementById('currentRoomId').textContent = roomId;
        
        // Simulasikan WebRTC atau WebSocket untuk komunikasi P2P
        // Ini hanya simulasi - implementasi nyata membutuhkan signaling server
        
        // Event listener untuk kirim pesan
        document.getElementById('sendMessage').addEventListener('click', async function() {
            const messageInput = document.getElementById('messageInput');
            const message = messageInput.value.trim();
            
            if (message) {
                // Enkripsi pesan sebelum "dikirim"
                const encryptedMessage = await encryptMessage(message, secretKey);
                
                // Simulasi pengiriman pesan
                displayMessage('Anda', message, encryptedMessage);
                
                // Dalam implementasi nyata, kirim encryptedMessage ke peer lain
                messageInput.value = '';
            }
        });
        
        // Event listener untuk keluar dari room
        document.getElementById('leaveRoom').addEventListener('click', function() {
            // Hapus data room dari sessionStorage
            sessionStorage.removeItem('currentRoomId');
            sessionStorage.removeItem('secretKey');
            window.location.href = 'index.html';
        });
    }
});

// Fungsi untuk menampilkan pesan
async function displayMessage(sender, plainText, encryptedMessage) {
    const chatMessages = document.getElementById('chatMessages');
    const messageElement = document.createElement('div');
    messageElement.className = 'message ' + (sender === 'Anda' ? 'sent' : 'received');
    
    // Tambahkan tooltip dan struktur bubble baru
    messageElement.innerHTML = `
        <div class="sender">${sender}</div>
        <div class="text">${plainText}</div>
        <div class="encrypted" title="Klik untuk melihat pesan">
            🔒 ${truncateEncrypted(encryptedMessage)}
        </div>
    `;
    
    // Tambahkan event listener untuk klik (alternatif hover)
    messageElement.addEventListener('click', function() {
        this.classList.toggle('show-plaintext');
    });
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Fungsi untuk memotong teks enkripsi yang panjang
function truncateEncrypted(text) {
    return text.length > 50 ? text.substring(0, 50) + '...' : text;
}

// Tambahkan di script.js
document.querySelectorAll('.message').forEach(msg => {
    msg.addEventListener('click', function() {
        this.classList.toggle('show-plaintext');
    });
});

// Fungsi kirim pesan
async function sendMessage() {
  const response = await fetch('/.netlify/functions/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json' // ← Ini wajib!
    },
    body: JSON.stringify({
      action: 'send',
      roomId: 'room-123',
      encryptedMsg: 'encrypted-data-here'
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('Error:', error);
    return;
  }
  
  const data = await response.json();
  console.log('Success:', data);
}

// Fungsi polling untuk update real-time
async function pollMessages() {
  const response = await fetch('/.netlify/functions/chat', {
    method: 'POST',
    body: JSON.stringify({
      action: 'get',
      roomId: localStorage.getItem('currentRoomId')
    })
  });
  
  const messages = await response.json();
  messages.forEach(async msg => {
    const plainText = await decryptMessage(msg.encrypted_message, secretKey);
    displayMessage('Partner', plainText, msg.encrypted_message);
  });
}

// Poll setiap 2 detik
setInterval(pollMessages, 2000); 