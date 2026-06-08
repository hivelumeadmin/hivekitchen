import { describe, it, expect } from 'vitest';
import { detectFamilyLanguageTerms, FAMILY_LANGUAGE_RATIFY_THRESHOLD } from './family-language.detector.js';

describe('detectFamilyLanguageTerms', () => {
  it('detects "Nani" case-insensitively and title-cases the term', () => {
    const result = detectFamilyLanguageTerms('I called NANI this morning');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ term: 'Nani', maps_to: 'grandmother', occurrences: 1 });
  });

  it('counts two occurrences in one message', () => {
    const result = detectFamilyLanguageTerms('nani made it, then nani called');
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrences).toBe(2);
  });

  it('does NOT match "Nanika" (word-boundary, not substring)', () => {
    expect(detectFamilyLanguageTerms('Nanika is a name')).toEqual([]);
  });

  it('does NOT match generic English kinship words', () => {
    expect(detectFamilyLanguageTerms('grandma and nana came over')).toEqual([]);
  });

  it('detects multiple distinct terms in one message', () => {
    const result = detectFamilyLanguageTerms('abuela and abuelo are visiting');
    const terms = result.map((r) => r.term).sort();
    expect(terms).toEqual(['Abuela', 'Abuelo']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(detectFamilyLanguageTerms('what is for lunch?')).toEqual([]);
  });

  it('exposes the ratification threshold as 2', () => {
    expect(FAMILY_LANGUAGE_RATIFY_THRESHOLD).toBe(2);
  });
});
