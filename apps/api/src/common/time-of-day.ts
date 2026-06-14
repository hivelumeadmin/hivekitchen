// 5-S11 — coarse time-of-day band used to modulate Lumi's reply length/tone
// (LumiAgent.buildSystemPrompt). UTC is a deliberate soft proxy: per-household
// timezone awareness is an Epic 8 feature, and the band is a heuristic length
// modifier, not precision logic. Kept alongside voice-tier.ts as a shared
// domain helper (pattern established in 5-S16).

export type TimeOfDayBand = 'morning' | 'afternoon' | 'evening' | 'night';

export function getTimeOfDayBand(date: Date): TimeOfDayBand {
  const hour = date.getUTCHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}
