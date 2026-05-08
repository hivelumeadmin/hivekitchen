import type { SupabaseClient } from '@supabase/supabase-js';

export type CulturalTemplateKey =
  | 'halal'
  | 'kosher'
  | 'hindu_vegetarian'
  | 'south_asian'
  | 'east_african'
  | 'caribbean';

export interface CulturalObservance {
  observance_name: string;
  cultural_template: CulturalTemplateKey;
  start_date: string;
  end_date: string;
  dietary_notes: string | null;
}

export interface GetUpcomingObservancesInput {
  weekOf: string;
  culturalTemplates: readonly CulturalTemplateKey[];
}

const OBSERVANCE_COLUMNS =
  'observance_name, cultural_template, start_date, end_date, dietary_notes';

// Shabbat is encoded as a single year-spanning row per cultural_template
// (kosher). When that row matches, normalise the effective date to the Friday
// of the target plan week so the planner gets a concrete observance date
// instead of a year-long range.
function normaliseShabbat(
  observance: CulturalObservance,
  weekOf: string,
): CulturalObservance {
  if (observance.observance_name !== 'Shabbat') return observance;
  const monday = new Date(`${weekOf}T00:00:00Z`);
  const friday = new Date(monday);
  friday.setUTCDate(friday.getUTCDate() + 4);
  const fridayStr = friday.toISOString().slice(0, 10);
  return { ...observance, start_date: fridayStr, end_date: fridayStr };
}

export class CulturalCalendarService {
  constructor(private readonly client: SupabaseClient) {}

  // Returns observances overlapping the 7-day window [weekOf, weekOf + 6 days]
  // for households whose ratified cultural_priors keys match the observance's
  // cultural_template. Empty culturalTemplates → silence-mode → empty array.
  async getUpcomingObservances(
    input: GetUpcomingObservancesInput,
  ): Promise<CulturalObservance[]> {
    if (input.culturalTemplates.length === 0) return [];

    const weekStart = new Date(`${input.weekOf}T00:00:00Z`);
    if (isNaN(weekStart.getTime())) {
      throw new Error(
        `getUpcomingObservances: invalid weekOf value "${input.weekOf}" — expected ISO date (YYYY-MM-DD)`,
      );
    }
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const { data, error } = await this.client
      .from('cultural_calendar_observances')
      .select(OBSERVANCE_COLUMNS)
      .in('cultural_template', input.culturalTemplates as CulturalTemplateKey[])
      .lte('start_date', weekEndStr)
      .gte('end_date', input.weekOf);

    if (error) throw error;

    const rows = (data as CulturalObservance[] | null) ?? [];
    const normalised = rows.map((row) => normaliseShabbat(row, input.weekOf));

    // Dedup by observance_name + cultural_template: year-boundary weeks can
    // match both the Dec 31 row and the Jan 1 row for Shabbat, producing two
    // identical Friday entries after normalisation.
    const seen = new Set<string>();
    return normalised.filter((o) => {
      const key = `${o.observance_name}::${o.cultural_template}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
