import { useState } from 'react';
import {
  type CulturalLanguagePreference,
  type UserProfile,
  CULTURAL_LANGUAGE_VALUES,
} from '@hivekitchen/types';
import { HkApiError } from '@/lib/fetch.js';
import { useCulturalLanguageMutation } from './mutations.js';

const CULTURAL_LANGUAGE_LABELS: { [K in CulturalLanguagePreference]: string } = {
  default: 'English (Grandma, Grandpa)',
  south_asian: 'South Asian (Nani, Nana, Dadi, Dada)',
  hispanic: 'Spanish (Abuela, Abuelo)',
  east_african: 'East African (Swahili)',
  middle_eastern: 'Middle Eastern (Teta, Jiddo)',
  east_asian: 'East Asian',
  caribbean: 'Caribbean',
};

const CULTURAL_LANGUAGE_OPTIONS = CULTURAL_LANGUAGE_VALUES.map((value) => ({
  value,
  label: CULTURAL_LANGUAGE_LABELS[value],
}));

interface FamilyLanguagePanelProps {
  profile: UserProfile;
}

export function FamilyLanguagePanel({ profile }: FamilyLanguagePanelProps) {
  const [culturalError, setCulturalError] = useState<string | null>(null);
  const culturalLanguage = useCulturalLanguageMutation();
  const culturalLanguageLocked = profile.cultural_language !== 'default';

  function handleChange(value: CulturalLanguagePreference) {
    setCulturalError(null);
    culturalLanguage.mutate(value, {
      onError: (err) => {
        if (err instanceof HkApiError && err.status === 409) {
          setCulturalError('Family language cannot be changed back once set.');
        } else if (err instanceof HkApiError && err.status === 400) {
          setCulturalError('That option is not valid.');
        } else {
          setCulturalError('Could not update family language. Please try again.');
        }
      },
    });
  }

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="font-serif text-xl text-fg">Family language</h2>
      <p className="text-sm text-fg-muted">
        How Lumi refers to family members in your household.
      </p>
      <select
        aria-label="Family language"
        value={profile.cultural_language}
        onChange={(e) => handleChange(e.target.value as CulturalLanguagePreference)}
        disabled={culturalLanguage.isPending}
        className="w-full rounded border border-border px-3 py-2"
      >
        {CULTURAL_LANGUAGE_OPTIONS.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            disabled={opt.value === 'default' && culturalLanguageLocked}
          >
            {opt.label}
          </option>
        ))}
      </select>
      {culturalLanguageLocked && (
        <p className="text-sm text-fg-muted">
          Family language cannot be changed back once set.
        </p>
      )}
      {culturalError && (
        <p role="alert" className="text-sm text-safety-red">{culturalError}</p>
      )}
    </section>
  );
}
