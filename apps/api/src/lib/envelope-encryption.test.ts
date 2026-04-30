import { Buffer } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import {
  decryptField,
  encryptField,
  generateDek,
  unwrapDek,
  wrapDek,
} from './envelope-encryption.js';

describe('envelope-encryption — encryptField / decryptField', () => {
  it('round-trips a string[] value with a real DEK', () => {
    const dek = generateDek();
    const value = ['peanuts', 'tree-nuts', 'shellfish'];

    const ciphertext = encryptField(value, dek);
    const restored = decryptField<string[]>(ciphertext, dek);

    expect(restored).toEqual(value);
    expect(ciphertext).not.toContain('peanuts');
    expect(ciphertext.startsWith('NOOP:')).toBe(false);
  });

  it('round-trips a Record<string, unknown> value with a real DEK', () => {
    const dek = generateDek();
    const value = { school: 'PS-101', notes: 'no nuts on premises', flags: [1, 2, 3] };

    const ciphertext = encryptField(value, dek);
    const restored = decryptField<typeof value>(ciphertext, dek);

    expect(restored).toEqual(value);
  });

  it('NOOP path (dek === null) produces NOOP: prefix and round-trips correctly', () => {
    const value = ['halal', 'vegetarian'];

    const ciphertext = encryptField(value, null);
    const restored = decryptField<string[]>(ciphertext, null);

    expect(ciphertext.startsWith('NOOP:')).toBe(true);
    expect(restored).toEqual(value);
  });

  it('NOOP-prefixed ciphertext with a non-null DEK still decodes (NOOP branch wins)', () => {
    const dek = generateDek();
    const value = { legacy: true };

    const noopCiphertext = encryptField(value, null);
    const restored = decryptField<typeof value>(noopCiphertext, dek);

    expect(restored).toEqual(value);
  });

  it('tampered ciphertext causes decryptField to throw', () => {
    const dek = generateDek();
    const value = ['secret-allergen'];
    const ciphertext = encryptField(value, dek);

    const buf = Buffer.from(ciphertext, 'base64');
    // Flip a byte well past the nonce + authTag region so the AES-GCM
    // authTag verification fails on decryption.
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0x01;
    const tampered = buf.toString('base64');

    expect(() => decryptField<string[]>(tampered, dek)).toThrow();
  });
});

describe('envelope-encryption — wrapDek / unwrapDek', () => {
  it('round-trips DEK bytes exactly through wrap+unwrap', () => {
    const kek = generateDek();
    const dek = generateDek();

    const wrapped = wrapDek(dek, kek);
    const unwrapped = unwrapDek(wrapped, kek);

    expect(Buffer.compare(unwrapped, dek)).toBe(0);
    expect(unwrapped.length).toBe(32);
  });

  it('produces different ciphertext for the same DEK across two wraps (random nonce)', () => {
    const kek = generateDek();
    const dek = generateDek();

    const wrapped1 = wrapDek(dek, kek);
    const wrapped2 = wrapDek(dek, kek);

    expect(wrapped1).not.toBe(wrapped2);
  });
});

describe('envelope-encryption — generateDek', () => {
  it('produces a 32-byte buffer', () => {
    const dek = generateDek();
    expect(dek.length).toBe(32);
  });

  it('produces distinct values across calls', () => {
    const a = generateDek();
    const b = generateDek();
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});
