import { useCallback, useEffect, useState } from 'react';
import { ZodError } from 'zod';
import {
  ListExtraLibraryResponseSchema,
  ExtraLibraryItemSchema,
  UpdateExtraRulesResponseSchema,
} from '@hivekitchen/contracts';
import type {
  CreateExtraLibraryItemInput,
  ExtraLibraryItem,
  ExtraRules,
  UpdateExtraRulesInput,
} from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';

type SaveRulesOutcome =
  | { ok: true; rules: ExtraRules }
  | { ok: false; message: string };

type AddLibraryItemOutcome =
  | { ok: true; item: ExtraLibraryItem }
  | { ok: false; message: string };

interface UseExtraRules {
  rules: ExtraRules;
  setRules: (next: ExtraRules) => void;
  libraryItems: ExtraLibraryItem[];
  loading: boolean;
  savePending: boolean;
  addPending: boolean;
  loadError: string | null;
  saveRules: (next: UpdateExtraRulesInput) => Promise<SaveRulesOutcome>;
  addLibraryItem: (input: CreateExtraLibraryItemInput) => Promise<AddLibraryItemOutcome>;
}

const EMPTY_RULES: ExtraRules = { pins: [], bans: [] };

// Story 3.21 — small client wrapper over the per-child extra-rules patch
// and the household-scoped extra-library list/create endpoints. The form
// holds local rule state until the parent explicitly saves; library items
// post immediately so the picker stays in sync.
export function useExtraRules(opts: {
  childId: string;
  householdId: string;
  initialRules?: ExtraRules;
}): UseExtraRules {
  const { childId, householdId, initialRules } = opts;
  const [rules, setRules] = useState<ExtraRules>(initialRules ?? EMPTY_RULES);
  const [libraryItems, setLibraryItems] = useState<ExtraLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savePending, setSavePending] = useState(false);
  const [addPending, setAddPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initialRules !== undefined) {
      setRules(initialRules);
    }
  }, [initialRules]);

  const reloadLibrary = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const raw = await hkFetch<unknown>(`/v1/households/${householdId}/extra-library`, {
        method: 'GET',
      });
      const parsed = ListExtraLibraryResponseSchema.parse(raw);
      setLibraryItems(parsed.items);
    } catch (err) {
      const message =
        err instanceof HkApiError
          ? "Couldn't load Extra library."
          : err instanceof ZodError
            ? 'Extra library response was unexpected.'
            : "Couldn't load Extra library.";
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void reloadLibrary();
  }, [reloadLibrary]);

  const saveRules = useCallback(
    async (next: UpdateExtraRulesInput): Promise<SaveRulesOutcome> => {
      setSavePending(true);
      try {
        const raw = await hkFetch<unknown>(`/v1/children/${childId}/extra-rules`, {
          method: 'PATCH',
          body: next,
        });
        const parsed = UpdateExtraRulesResponseSchema.parse(raw);
        setRules(parsed.extra_rules);
        return { ok: true, rules: parsed.extra_rules };
      } catch (err) {
        if (err instanceof HkApiError) {
          return { ok: false, message: "Couldn't save Extra rules. Please try again." };
        }
        if (err instanceof ZodError) {
          return {
            ok: false,
            message: 'Rules saved but the response was unexpected. Please refresh.',
          };
        }
        return { ok: false, message: "Couldn't save Extra rules. Please try again." };
      } finally {
        setSavePending(false);
      }
    },
    [childId],
  );

  const addLibraryItem = useCallback(
    async (input: CreateExtraLibraryItemInput): Promise<AddLibraryItemOutcome> => {
      setAddPending(true);
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/extra-library`, {
          method: 'POST',
          body: input,
        });
        const parsed = ExtraLibraryItemSchema.parse(raw);
        setLibraryItems((prev) => [parsed, ...prev]);
        return { ok: true, item: parsed };
      } catch (err) {
        if (err instanceof HkApiError) {
          return { ok: false, message: "Couldn't save the new Extra item." };
        }
        if (err instanceof ZodError) {
          return { ok: false, message: 'Saved, but the response was unexpected.' };
        }
        return { ok: false, message: "Couldn't save the new Extra item." };
      } finally {
        setAddPending(false);
      }
    },
    [householdId],
  );

  return {
    rules,
    setRules,
    libraryItems,
    loading,
    savePending,
    addPending,
    loadError,
    saveRules,
    addLibraryItem,
  };
}
