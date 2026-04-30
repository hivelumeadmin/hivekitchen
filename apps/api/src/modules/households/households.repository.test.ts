import { describe, it, expect } from 'vitest';
import { generateDek, encryptField } from '../../lib/envelope-encryption.js';
import { decryptCaregiverRelationships } from './households.repository.js';

describe('decryptCaregiverRelationships', () => {
  it('decrypts NOOP-prefixed value (dev/test path)', () => {
    const value = { primary: 'alice', secondary: 'bob' };
    const stored = encryptField(value, null);
    expect(decryptCaregiverRelationships(stored, null)).toEqual(value);
  });

  it('decrypts AES-GCM ciphertext with a real DEK', () => {
    const dek = generateDek();
    const value = { roles: ['caregiver-1', 'caregiver-2'] };
    const stored = encryptField(value, dek);
    expect(decryptCaregiverRelationships(stored, dek)).toEqual(value);
  });

  it('handles legacy jsonb-cast-to-text rows (no NOOP prefix, no encryption)', () => {
    // Story 2.10 migration cast existing jsonb to text via `USING ::text`,
    // producing raw JSON literals. Read path tolerates this until the next
    // application write re-encrypts.
    const legacy = '{"primary":"alice","secondary":"bob"}';
    expect(decryptCaregiverRelationships(legacy, null)).toEqual({
      primary: 'alice',
      secondary: 'bob',
    });
  });

  it('handles legacy array-shaped jsonb rows', () => {
    const legacy = '[{"role":"primary","name":"alice"}]';
    expect(decryptCaregiverRelationships(legacy, null)).toEqual([
      { role: 'primary', name: 'alice' },
    ]);
  });
});
