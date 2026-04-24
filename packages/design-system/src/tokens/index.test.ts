import { describe, it, expect } from 'vitest';
import { tokenPresets } from './index.js';

const stops = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const colorGroups = [
  { key: 'sacred', prefix: 'sacred-plum' },
  { key: 'lumi-terracotta', prefix: 'lumi-terracotta' },
  { key: 'safety-cleared', prefix: 'safety-cleared-teal' },
  { key: 'memory-provenance', prefix: 'memory-provenance' },
  { key: 'honey-amber', prefix: 'honey-amber' },
  { key: 'foliage', prefix: 'foliage' },
  { key: 'warm-neutral', prefix: 'warm-neutral' },
] as const;

describe('tokenPresets', () => {
  it('has an extend key', () => {
    expect(tokenPresets.extend).toBeDefined();
  });

  describe('colors', () => {
    it('has all 7 color groups', () => {
      const colors = tokenPresets.extend!.colors as Record<string, unknown>;
      for (const { key } of colorGroups) {
        expect(colors[key], `missing color group: ${key}`).toBeDefined();
      }
    });

    it('each group has all 10 stops referencing the correct CSS custom property', () => {
      const colors = tokenPresets.extend!.colors as Record<string, Record<number, string>>;
      for (const { key, prefix } of colorGroups) {
        for (const stop of stops) {
          expect(colors[key][stop]).toBe(`var(--${prefix}-${stop})`);
        }
      }
    });

    it('sacred-500 references the correct custom property', () => {
      const colors = tokenPresets.extend!.colors as Record<string, Record<number, string>>;
      expect(colors['sacred'][500]).toBe('var(--sacred-plum-500)');
    });

    it('lumi-terracotta has a warmed variant', () => {
      const colors = tokenPresets.extend!.colors as Record<string, Record<string, string>>;
      expect(colors['lumi-terracotta']['warmed']).toBe('var(--lumi-terracotta-warmed)');
    });
  });

  describe('fontFamily', () => {
    it('has serif referencing --font-serif', () => {
      const fontFamily = tokenPresets.extend!.fontFamily as Record<string, string>;
      expect(fontFamily['serif']).toBe('var(--font-serif)');
    });

    it('has sans referencing --font-sans', () => {
      const fontFamily = tokenPresets.extend!.fontFamily as Record<string, string>;
      expect(fontFamily['sans']).toBe('var(--font-sans)');
    });
  });

  describe('motion tokens', () => {
    it('has sacred-ease timing function', () => {
      const ttf = tokenPresets.extend!.transitionTimingFunction as Record<string, string>;
      expect(ttf['sacred-ease']).toBe('var(--sacred-ease)');
    });

    it('has fast / medium / slow durations', () => {
      const td = tokenPresets.extend!.transitionDuration as Record<string, string>;
      expect(td['fast']).toBe('var(--motion-fast)');
      expect(td['medium']).toBe('var(--motion-medium)');
      expect(td['slow']).toBe('var(--motion-slow)');
    });
  });

  describe('focus indicator tokens', () => {
    it('has outline color', () => {
      const oc = tokenPresets.extend!.outlineColor as Record<string, string>;
      expect(oc['focus-indicator']).toBe('var(--focus-indicator-color)');
    });

    it('has outline width', () => {
      const ow = tokenPresets.extend!.outlineWidth as Record<string, string>;
      expect(ow['focus-indicator']).toBe('var(--focus-indicator-width)');
    });

    it('has outline offset', () => {
      const oo = tokenPresets.extend!.outlineOffset as Record<string, string>;
      expect(oo['focus-indicator']).toBe('var(--focus-indicator-offset)');
    });
  });
});
