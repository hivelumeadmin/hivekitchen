import type { LumiSurface } from '@hivekitchen/types';
import { getSurfacePrompt as planning } from './planning.prompt.js';
import { getSurfacePrompt as mealDetail } from './meal-detail.prompt.js';
import { getSurfacePrompt as childProfile } from './child-profile.prompt.js';
import { getSurfacePrompt as groceryList } from './grocery-list.prompt.js';
import { getSurfacePrompt as eveningCheckIn } from './evening-check-in.prompt.js';
import { getSurfacePrompt as heartNote } from './heart-note.prompt.js';
import { getSurfacePrompt as general } from './general.prompt.js';

// LumiSurface has nine members. The seven story-named surfaces get a dedicated
// prompt; the two that don't fall through to the closest fit:
//   - onboarding → general (unreachable: assertAmbientSurface guards the route)
//   - brief      → planning (the Brief IS the weekly-plan ready-answer canvas;
//                  the manual test path even sends surface='planning' for it)
const SURFACE_PROMPTS: Record<LumiSurface, () => string> = {
  planning,
  brief: planning,
  'meal-detail': mealDetail,
  'child-profile': childProfile,
  'grocery-list': groceryList,
  'evening-check-in': eveningCheckIn,
  'heart-note': heartNote,
  general,
  onboarding: general,
};

export function getSurfacePrompt(surface: LumiSurface): string {
  return (SURFACE_PROMPTS[surface] ?? SURFACE_PROMPTS.general)();
}
