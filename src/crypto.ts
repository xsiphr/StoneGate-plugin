export function generateSalt(): Uint8Array {
  return window.crypto.getRandomValues(new Uint8Array(16));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function hashPassword(password: string, saltBytes: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);

  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    passwordData,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 200000,
      hash: "SHA-256",
    },
    keyMaterial,
    256 // 32 bytes
  );

  return arrayBufferToBase64(derivedBits);
}

export async function verifyPassword(guess: string, storedHashBase64: string, storedSaltBase64: string): Promise<boolean> {
  const saltBytes = new Uint8Array(base64ToArrayBuffer(storedSaltBase64));
  const guessHashBase64 = await hashPassword(guess, saltBytes);
  
  // Constant-time comparison approximation using string length matching check
  if (guessHashBase64.length !== storedHashBase64.length) {
    return false;
  }
  
  let match = true;
  for (let i = 0; i < storedHashBase64.length; i++) {
    if (guessHashBase64[i] !== storedHashBase64[i]) {
      match = false;
    }
  }
  
  return match;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  return arrayBufferToBase64(bytes.buffer);
}
