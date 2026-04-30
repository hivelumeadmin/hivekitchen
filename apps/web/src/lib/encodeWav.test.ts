import { describe, it, expect } from 'vitest';
import { encodeWav } from './encodeWav.js';

describe('encodeWav', () => {
  it('produces a canonical 44-byte WAV header for a known input', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWav(samples, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(wav.byteLength).toBe(44 + samples.length * 2);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(samples.length * 2); // data size
  });

  it('clamps samples outside [-1, 1] before quantising', () => {
    const samples = new Float32Array([2, -2]);
    const wav = encodeWav(samples, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x7fff);
  });

  it('quantises 0 to int16 0', () => {
    const samples = new Float32Array([0]);
    const wav = encodeWav(samples, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(view.getInt16(44, true)).toBe(0);
  });
});
