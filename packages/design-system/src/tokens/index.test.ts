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
      const colors = tokenPresets.extend!.colors as unknown as Record<string, Record<number, string>>;
      for (const { key, prefix } of colorGroups) {
        for (const stop of stops) {
          expect(colors[key][stop]).toBe(`var(--${prefix}-${stop})`);
        }
      }
    });

    it('sacred-500 references the correct custom property', () => {
      const colors = tokenPresets.extend!.colors as unknown as Record<string, Record<number, string>>;
      expect(colors['sacred'][500]).toBe('var(--sacred-plum-500)');
    });

    it('lumi-terracotta has a warmed variant', () => {
      const colors = tokenPresets.extend!.colors as unknown as Record<string, Record<string, string>>;
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

  describe('v2.0 semantic aliases', () => {
    const colors = () =>
      tokenPresets.extend!.colors as Record<string, string | Record<string, string>>;

    it('exposes bg, border, honey-accent as flat aliases', () => {
      const c = colors();
      expect(c['bg']).toBe('var(--bg)');
      expect(c['border']).toBe('var(--border)');
      expect(c['honey-accent']).toBe('var(--honey-accent)');
    });

    it('exposes surface DEFAULT and -2 variant', () => {
      const surface = colors()['surface'] as Record<string, string>;
      expect(surface['DEFAULT']).toBe('var(--surface)');
      expect(surface[2]).toBe('var(--surface-2)');
    });

    it('exposes fg DEFAULT and muted variant', () => {
      const fg = colors()['fg'] as Record<string, string>;
      expect(fg['DEFAULT']).toBe('var(--fg)');
      expect(fg['muted']).toBe('var(--fg-muted)');
    });

    it('exposes amber with DEFAULT, soft, warm', () => {
      const amber = colors()['amber'] as Record<string, string>;
      expect(amber['DEFAULT']).toBe('var(--amber)');
      expect(amber['soft']).toBe('var(--amber-soft)');
      expect(amber['warm']).toBe('var(--amber-warm)');
    });

    it('exposes lumi-terracotta DEFAULT and dim alongside scale and warmed', () => {
      const lt = colors()['lumi-terracotta'] as Record<string, string>;
      expect(lt['DEFAULT']).toBe('var(--lumi-terracotta)');
      expect(lt['warmed']).toBe('var(--lumi-terracotta-warmed)');
      expect(lt['dim']).toBe('var(--lumi-terracotta-dim)');
      expect(lt['500']).toBe('var(--lumi-terracotta-500)');
    });

    it('exposes sacred DEFAULT and soft alongside scale', () => {
      const s = colors()['sacred'] as Record<string, string>;
      expect(s['DEFAULT']).toBe('var(--sacred-plum)');
      expect(s['soft']).toBe('var(--sacred-plum-soft)');
      expect(s['500']).toBe('var(--sacred-plum-500)');
    });

    it('exposes foliage DEFAULT and soft alongside scale', () => {
      const f = colors()['foliage'] as Record<string, string>;
      expect(f['DEFAULT']).toBe('var(--foliage)');
      expect(f['soft']).toBe('var(--foliage-soft)');
      expect(f['500']).toBe('var(--foliage-500)');
    });

    it('exposes safety-cleared DEFAULT and fill alongside scale', () => {
      const sc = colors()['safety-cleared'] as Record<string, string>;
      expect(sc['DEFAULT']).toBe('var(--safety-cleared-teal)');
      expect(sc['fill']).toBe('var(--safety-cleared-fill)');
      expect(sc['500']).toBe('var(--safety-cleared-teal-500)');
    });

    it('exposes safety-red as DEFAULT + fill (no scale)', () => {
      const sr = colors()['safety-red'] as Record<string, string>;
      expect(sr['DEFAULT']).toBe('var(--safety-red)');
      expect(sr['fill']).toBe('var(--safety-red-fill)');
    });
  });

  describe('borderRadius scale (v2.0)', () => {
    it('exposes sm / md / lg / xl', () => {
      const br = tokenPresets.extend!.borderRadius as Record<string, string>;
      expect(br['sm']).toBe('var(--r-sm)');
      expect(br['md']).toBe('var(--r-md)');
      expect(br['lg']).toBe('var(--r-lg)');
      expect(br['xl']).toBe('var(--r-xl)');
    });
  });
});
