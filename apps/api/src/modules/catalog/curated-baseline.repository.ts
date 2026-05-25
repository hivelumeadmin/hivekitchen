import { BaseRepository } from '../../repository/base.repository.js';

// Slice 2.6-s2 — read-only repository for `curated_baseline_items`.
//
// Global reference table (no household FK, no RLS) — read via service-role
// only. Two access paths:
//   - findAllActive()      → initial Stage 0 materialization at household
//                             creation; no cuisine filter (M1/M2 not done)
//   - findActiveByCuisineTags(tags) → M3 re-materialization; cuisine array
//                                      overlap filter using && (GIN-indexed)
//
// Schema reference: 20260909000000_2_6_s2_curated_baseline_items.sql

export interface CuratedBaselineItemRow {
  id: string;
  canonical_name: string;
  allergen_flags: string[];
  dietary_flags: string[];
  cultural_tags: string[];
  cuisine_tags: string[];
  applicable_slots: Array<'main' | 'snack' | 'extra'>;
  notes: string | null;
  is_active: boolean;
}

const BASELINE_COLUMNS =
  'id, canonical_name, allergen_flags, dietary_flags, cultural_tags, cuisine_tags, applicable_slots, notes, is_active';

export class CuratedBaselineRepository extends BaseRepository {
  async findAllActive(): Promise<CuratedBaselineItemRow[]> {
    const { data, error } = await this.client
      .from('curated_baseline_items')
      .select(BASELINE_COLUMNS)
      .eq('is_active', true);
    if (error) throw error;
    return (data ?? []) as CuratedBaselineItemRow[];
  }

  /**
   * M3 re-materialization filter. Returns active rows whose `cuisine_tags`
   * array overlaps the supplied tag set. Empty `tags` returns []  — callers
   * should short-circuit before calling rather than rely on this.
   */
  async findActiveByCuisineTags(
    tags: readonly string[],
  ): Promise<CuratedBaselineItemRow[]> {
    if (tags.length === 0) return [];
    const { data, error } = await this.client
      .from('curated_baseline_items')
      .select(BASELINE_COLUMNS)
      .eq('is_active', true)
      .overlaps('cuisine_tags', tags as string[]);
    if (error) throw error;
    return (data ?? []) as CuratedBaselineItemRow[];
  }
}
