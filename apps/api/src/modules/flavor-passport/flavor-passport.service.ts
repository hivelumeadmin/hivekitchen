import type { FlavorPassportResponse, FlavorPassportStamp } from '@hivekitchen/contracts';
import type { FlavorPassportRepository } from './flavor-passport.repository.js';

// Slice 4-S12 — builds the passport response from deduped stamps. Two ordering
// modes: parent view reads the journey from the beginning (chronological);
// child view leads with what they loved first.

const SLOT_ORDER: Record<FlavorPassportStamp['slot_kind'], number> = {
  main: 0,
  snack: 1,
  extra: 2,
};

function byDateAsc(a: FlavorPassportStamp, b: FlavorPassportStamp): number {
  // signal_date is 'YYYY-MM-DD' so lexical compare == chronological compare.
  if (a.signal_date < b.signal_date) return -1;
  if (a.signal_date > b.signal_date) return 1;
  // Stable tiebreak on recipe_id so same-date stamps order reproducibly.
  return a.recipe_id < b.recipe_id ? -1 : a.recipe_id > b.recipe_id ? 1 : 0;
}

export class FlavorPassportService {
  constructor(private readonly repo: FlavorPassportRepository) {}

  async buildPassport(
    childId: string,
    householdId: string,
    opts: { childFirst: boolean },
  ): Promise<FlavorPassportResponse> {
    const stamps = await this.repo.getStampsForChild(childId, householdId);

    const state: FlavorPassportResponse['state'] =
      stamps.length === 0 ? 'empty' : stamps.length <= 8 ? 'developing' : 'established';

    let ordered: FlavorPassportStamp[];
    if (opts.childFirst) {
      // Loved stamps first, then ok; chronological within each tier.
      const loved = stamps.filter((s) => s.signal_type === 'loved').sort(byDateAsc);
      const ok = stamps.filter((s) => s.signal_type === 'ok').sort(byDateAsc);
      ordered = [...loved, ...ok];
    } else {
      ordered = [...stamps].sort(byDateAsc);
    }

    const response: FlavorPassportResponse = {
      child_id: childId,
      state,
      stamps: ordered,
    };

    if (state === 'established') {
      response.available_filters = {
        cuisines: [...new Set(ordered.flatMap((s) => s.cuisine_tags))].sort(),
        slot_kinds: [...new Set(ordered.map((s) => s.slot_kind))].sort(
          (a, b) => SLOT_ORDER[a] - SLOT_ORDER[b],
        ),
      };
    }

    return response;
  }
}
