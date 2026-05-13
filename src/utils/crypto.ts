import CryptoJS from 'crypto-js';

const SECRET = import.meta.env.VITE_ENCRYPTION_SECRET || 'fallback_secret';

export const encryptApiKey = (apiKey: string): string => {
  return CryptoJS.AES.encrypt(apiKey, SECRET).toString();
};

export const decryptApiKey = (encryptedApiKey: string): string | null => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedApiKey, SECRET);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || null;
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
};
