// 5-S16 — standard-tier weekly voice cap shared by the WS turn path
// (LumiService.processVoiceUtterance) and the session-creation pre-check
// (POST /v1/lumi/voice/sessions). Kept here so the cap value and the user-facing
// copy stay identical across both gates (AC2 and AC4 require the same message).
// Full per-tier lookup from a subscriptions table moves to Epic 8.

export const STANDARD_TIER_CAP_MS = 600_000; // 10 minutes

export const VOICE_CAP_COPY = "You've used this week's voice time. Text still works.";

// Returns the Monday-UTC date of the current week as 'YYYY-MM-DD'. Each Monday
// begins a new voice_usage row; prior weeks are retained as history (AC8).
export function getWeekStart(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysToMonday);
  return d.toISOString().split('T')[0]!; // 'YYYY-MM-DD'
}
