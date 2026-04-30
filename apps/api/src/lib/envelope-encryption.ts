import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DEK_BYTES = 32;
const NOOP_PREFIX = 'NOOP:';

export function generateDek(): Buffer {
  return randomBytes(DEK_BYTES);
}

export function encryptField(data: unknown, dek: Buffer | null): string {
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  if (dek === null) {
    return NOOP_PREFIX + plaintext.toString('base64');
  }
  return aesGcmEncrypt(plaintext, dek);
}

export function decryptField<T>(ciphertext: string, dek: Buffer | null): T {
  // NOOP: branch takes priority — dev rows leaking into staging decode cleanly
  // here rather than being mis-parsed as AES bytes.
  if (ciphertext.startsWith(NOOP_PREFIX)) {
    const payload = Buffer.from(ciphertext.slice(NOOP_PREFIX.length), 'base64');
    return JSON.parse(payload.toString('utf8')) as T;
  }
  if (dek === null) {
    // A non-NOOP ciphertext with no DEK means ENVELOPE_ENCRYPTION_MASTER_KEY is
    // missing from the environment while real encrypted data exists in the DB.
    // Attempting JSON.parse on AES-GCM bytes would silently produce garbage or
    // crash without an integrity check — throw explicitly instead.
    throw new Error(
      'Cannot decrypt: ciphertext is not NOOP-prefixed but DEK is null. ' +
        'ENVELOPE_ENCRYPTION_MASTER_KEY may be missing from the environment.',
    );
  }
  const plaintext = aesGcmDecrypt(ciphertext, dek);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export function wrapDek(dek: Buffer, kek: Buffer): string {
  return aesGcmEncrypt(dek, kek);
}

export function unwrapDek(encryptedDek: string, kek: Buffer): Buffer {
  return aesGcmDecrypt(encryptedDek, kek);
}

function aesGcmEncrypt(plaintext: Buffer, key: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, authTag, ciphertext]).toString('base64');
}

function aesGcmDecrypt(payload: string, key: Buffer): Buffer {
  const buf = Buffer.from(payload, 'base64');
  const minLen = NONCE_BYTES + AUTH_TAG_BYTES;
  if (buf.length < minLen) {
    throw new Error(
      `malformed ciphertext: expected at least ${minLen} bytes, got ${buf.length}`,
    );
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const authTag = buf.subarray(NONCE_BYTES, NONCE_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  // Intentionally NOT wrapped in try/catch — authTag verification failure must
  // surface as an error, never silently return wrong plaintext.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
