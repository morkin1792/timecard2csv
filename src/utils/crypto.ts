// Encrypts the user's Gemini API key for at-rest storage in the browser.
//
// This is intentionally NOT real security — a fully client-side app can never
// truly hide a key from code running in its own origin. The only goal is to make
// casual leaks less damaging:
//
//   * No secret in the JS bundle. (The old hardcoded .env secret shipped to every
//     visitor, so it protected nothing.)
//   * The encryption key is a *non-extractable* Web Crypto key: JS can use it to
//     encrypt/decrypt but can never read its raw bytes, so dumping the key store
//     yields an unusable handle rather than the key itself.
//   * The key lives in IndexedDB while the ciphertext lives in localStorage, in
//     separate stores. A leak of only one store cannot decrypt anything.
//
// A determined attacker who can execute JS in the user's browser/profile can
// still use the key to decrypt — that is an inherent limit of browser storage.

const DB_NAME = 'timecard2csv';
const STORE = 'crypto';
const KEY_ID = 'apiKeyWrappingKey';
const IV_BYTES = 12;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const idbGet = <T>(db: IDBDatabase, key: string): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });

const idbPut = (db: IDBDatabase, key: string, value: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

// Loads the per-device AES-GCM key, creating + persisting a non-extractable one
// on first use. Storing a CryptoKey object in IndexedDB preserves the
// non-extractable guarantee (the raw bytes are never exposed to JS).
const loadOrCreateKey = async (): Promise<CryptoKey> => {
  const db = await openDb();
  const existing = await idbGet<CryptoKey>(db, KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable = false
    ['encrypt', 'decrypt']
  );
  await idbPut(db, KEY_ID, key);
  return key;
};

// Cache the key per page load; reset the cache if loading fails so a transient
// error doesn't permanently break encryption for the session.
let cachedKey: Promise<CryptoKey> | null = null;
const getKey = (): Promise<CryptoKey> => {
  if (!cachedKey) {
    cachedKey = loadOrCreateKey().catch((e) => {
      cachedKey = null;
      throw e;
    });
  }
  return cachedKey;
};

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const encryptApiKey = async (apiKey: string): Promise<string> => {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey))
  );
  // Persist IV + ciphertext together, base64-encoded.
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return toBase64(combined);
};

export const decryptApiKey = async (stored: string): Promise<string | null> => {
  try {
    const key = await getKey();
    const combined = fromBase64(stored);
    const iv = combined.slice(0, IV_BYTES);
    const ciphertext = combined.slice(IV_BYTES);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plain);
  } catch (e) {
    // Wrong/rotated key, cleared IndexedDB, or legacy ciphertext: ask again.
    console.error('Failed to decrypt stored API key:', e);
    return null;
  }
};
