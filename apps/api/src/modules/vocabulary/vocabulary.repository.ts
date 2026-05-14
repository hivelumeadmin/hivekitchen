import type {
  AllergenTagRow,
  CulturalTagRow,
  CuisineTagRow,
  DietaryTagRow,
} from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

export interface RawVocabularyData {
  allergens: AllergenTagRow[];
  dietary: DietaryTagRow[];
  cultural: CulturalTagRow[];
  cuisines: CuisineTagRow[];
}

/**
 * Slice A0.5 — reads the four vocabulary tables (migration 20260514005000)
 * in parallel. Inactive rows are not filtered here; the service decides
 * how to treat them (include for display, exclude for new tag assignment).
 */
export class VocabularyRepository extends BaseRepository {
  async loadAll(): Promise<RawVocabularyData> {
    const [allergens, dietary, cultural, cuisines] = await Promise.all([
      this.client.from('allergen_tags').select('*').order('sort_order'),
      this.client.from('dietary_tags').select('*').order('sort_order'),
      this.client.from('cultural_tags').select('*').order('sort_order'),
      this.client.from('cuisine_tags').select('*').order('sort_order'),
    ]);

    if (allergens.error) throw allergens.error;
    if (dietary.error) throw dietary.error;
    if (cultural.error) throw cultural.error;
    if (cuisines.error) throw cuisines.error;

    return {
      allergens: (allergens.data ?? []) as AllergenTagRow[],
      dietary: (dietary.data ?? []) as DietaryTagRow[],
      cultural: (cultural.data ?? []) as CulturalTagRow[],
      cuisines: (cuisines.data ?? []) as CuisineTagRow[],
    };
  }
}
