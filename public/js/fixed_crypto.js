// Key derivation dari string (PBKDF2)
async function deriveKeyFromString(password) {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return await window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode('secure-salt'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Helper: menerima string password ATAU CryptoKey
async function getKey(passOrKey) {
  if (typeof passOrKey === 'string') {
    return deriveKeyFromString(passOrKey);
  }
  // CryptoKey yang valid biasanya memiliki type "secret"
  if (passOrKey && passOrKey.type === 'secret') {
    return passOrKey;
  }
  throw new Error('Invalid key/password');
}

// Enkripsi
window.encryptData = async function (text, passOrKey) {
  try {
    const key = await getKey(passOrKey);
    const encoder = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(text)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode.apply(null, combined));
  } catch (e) {
    console.error('Encryption error:', e);
    return null;
  }
};

// Dekripsi
window.decryptData = async function (encryptedData, passOrKey) {
  try {
    const key = await getKey(passOrKey);
    const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('Decryption error:', e);
    return null;
  }
};
