import { describe, it, expect, beforeEach } from 'vitest';
import type { LumiContextSignal, Turn } from '@hivekitchen/types';
import { useLumiStore } from './lumi.store.js';

const planningSignal: LumiContextSignal = {
  surface: 'planning',
  recent_actions: [],
};

const heartNoteSignal: LumiContextSignal = {
  surface: 'heart-note',
  recent_actions: [],
};

const turn = (id: string): Turn =>
  ({
    turn_id: id,
    thread_id: '00000000-0000-4000-8000-000000000000',
    server_seq: 1,
    sender: { kind: 'user', user_id: '00000000-0000-4000-8000-000000000001' },
    body: { kind: 'message', text: id },
    created_at: '2026-04-30T00:00:00.000Z',
  }) as unknown as Turn;

describe('useLumiStore', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
  });

  it('starts with sensible defaults — surface "general", presence at rest, no talk session', () => {
    const s = useLumiStore.getState();

    expect(s.surface).toBe('general');
    expect(s.contextSignal).toBeNull();
    expect(s.threadIds).toEqual({});
    expect(s.turns).toEqual([]);
    expect(s.presenceState).toBe('atRest');
    expect(s.panelMode).toBe('text');
    expect(s.talkSessionId).toBeNull();
    expect(s.voiceStatus).toBe('idle');
    expect(s.captionOnlyMode).toBe(false);
  });

  it('setCaptionOnlyMode toggles captionOnlyMode (Slice 5-S13)', () => {
    useLumiStore.getState().setCaptionOnlyMode(true);
    expect(useLumiStore.getState().captionOnlyMode).toBe(true);
    useLumiStore.getState().setCaptionOnlyMode(false);
    expect(useLumiStore.getState().captionOnlyMode).toBe(false);
  });

  // Epic 13-s10 — the plan-edit scope (frontend-only routing state).
  it('setPlanEditScope arms the scope; summon carries it', () => {
    useLumiStore.getState().setPlanEditScope({
      planId: 'plan-1',
      weekOf: '2026-06-29',
      day: 'tue',
      dayLabel: 'Tuesday',
    });
    useLumiStore.getState().summon('text');
    const s = useLumiStore.getState();
    expect(s.presenceState).toBe('summoned');
    expect(s.planEditScope?.planId).toBe('plan-1');
    expect(s.planEditScope?.day).toBe('tue');
  });

  it('recede clears the plan-edit scope (restores the general path)', () => {
    useLumiStore.getState().setPlanEditScope({ planId: 'plan-1', weekOf: '2026-06-29' });
    useLumiStore.getState().summon('text');
    useLumiStore.getState().recede();
    expect(useLumiStore.getState().planEditScope).toBeNull();
    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('setContext clears any stale plan-edit scope on a new surface', () => {
    useLumiStore.getState().setPlanEditScope({ planId: 'plan-1', weekOf: '2026-06-29' });
    useLumiStore.getState().setContext(planningSignal);
    expect(useLumiStore.getState().planEditScope).toBeNull();
  });

  it('dismissNudge clears the plan-edit scope', () => {
    useLumiStore.getState().setPlanEditScope({ planId: 'plan-1', weekOf: '2026-06-29' });
    useLumiStore.getState().dismissNudge();
    expect(useLumiStore.getState().planEditScope).toBeNull();
  });

  it('setContext updates surface + signal, clears turns + isHydrating; preserves talk session (AC #4)', () => {
    const { setContext, hydrateThread, setTalkSession } = useLumiStore.getState();

    setContext(planningSignal);
    hydrateThread('planning', '11111111-1111-4111-8111-111111111111', [turn('a'), turn('b')]);
    setTalkSession('22222222-2222-4222-8222-222222222222');
    useLumiStore.setState({ isHydrating: true });

    setContext(heartNoteSignal);

    const s = useLumiStore.getState();
    expect(s.surface).toBe('heart-note');
    expect(s.contextSignal).toEqual(heartNoteSignal);
    expect(s.turns).toEqual([]);
    expect(s.isHydrating).toBe(false);
    expect(s.talkSessionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(s.voiceStatus).toBe('connecting');
  });

  it('appendAction appends to recent_actions and caps at 5 with FIFO eviction (AC #5)', () => {
    const { setContext, appendAction } = useLumiStore.getState();
    setContext(planningSignal);

    appendAction('a');
    appendAction('b');
    appendAction('c');
    appendAction('d');
    appendAction('e');
    appendAction('f');

    const actions = useLumiStore.getState().contextSignal?.recent_actions;
    expect(actions).toEqual(['b', 'c', 'd', 'e', 'f']);
  });

  it('appendAction is a no-op when contextSignal is null', () => {
    useLumiStore.getState().appendAction('lonely');

    expect(useLumiStore.getState().contextSignal).toBeNull();
  });

  it('hydrateThread sets threadIds[surface], replaces turns, and clears isHydrating (AC #6)', () => {
    const { setContext, hydrateThread } = useLumiStore.getState();
    setContext(planningSignal);
    useLumiStore.setState({ isHydrating: true });

    const turns = [turn('x'), turn('y')];
    hydrateThread('planning', '33333333-3333-4333-8333-333333333333', turns);

    const s = useLumiStore.getState();
    expect(s.threadIds.planning).toBe('33333333-3333-4333-8333-333333333333');
    expect(s.turns).toEqual(turns);
    expect(s.isHydrating).toBe(false);
  });

  it('hydrateThread for a stale surface does not overwrite active turns or isHydrating (TOCTOU guard)', () => {
    const { setContext, hydrateThread } = useLumiStore.getState();
    setContext(planningSignal);
    useLumiStore.setState({ isHydrating: true });

    // Surface switches mid-flight to heart-note
    setContext(heartNoteSignal);

    // Stale fetch for planning resolves — must NOT clobber heart-note's turns or isHydrating
    hydrateThread('planning', '55555555-5555-4555-8555-555555555555', [turn('stale')]);

    const s = useLumiStore.getState();
    expect(s.threadIds.planning).toBe('55555555-5555-4555-8555-555555555555'); // ID recorded
    expect(s.turns).toEqual([]); // heart-note turns untouched
    expect(s.isHydrating).toBe(false); // reset by setContext
  });

  it('appendTurn pushes a single turn without touching threadIds', () => {
    const { setContext, appendTurn } = useLumiStore.getState();
    setContext(planningSignal);

    appendTurn(turn('a'));
    appendTurn(turn('b'));

    const s = useLumiStore.getState();
    expect(s.turns).toHaveLength(2);
    expect(s.threadIds).toEqual({});
  });

  it('endTalkSession clears voice fields but leaves presenceState alone', () => {
    const { setTalkSession, setVoiceStatus, summon, endTalkSession } =
      useLumiStore.getState();
    setTalkSession('44444444-4444-4444-8444-444444444444');
    setVoiceStatus('active');
    summon('voice');

    endTalkSession();

    const s = useLumiStore.getState();
    expect(s.talkSessionId).toBeNull();
    expect(s.voiceStatus).toBe('idle');
    expect(s.isSpeaking).toBe(false);
    expect(s.voiceError).toBeNull();
    // Ending a voice session does not recede the sheet — the user closes it.
    expect(s.presenceState).toBe('summoned');
  });

  it('setLumiThinking toggles the non-verbal pulse flag (5-S6)', () => {
    const { setLumiThinking } = useLumiStore.getState();
    expect(useLumiStore.getState().lumiThinking).toBe(false);

    setLumiThinking(true);
    expect(useLumiStore.getState().lumiThinking).toBe(true);

    setLumiThinking(false);
    expect(useLumiStore.getState().lumiThinking).toBe(false);
  });

  it('endTalkSession clears a hanging lumiThinking pulse (5-S6)', () => {
    const { setTalkSession, setLumiThinking, endTalkSession } = useLumiStore.getState();
    setTalkSession('44444444-4444-4444-8444-444444444444');
    setLumiThinking(true);

    endTalkSession();

    expect(useLumiStore.getState().lumiThinking).toBe(false);
  });

  it('setVoiceError flips status to error; clearing reverts to idle', () => {
    const { setVoiceError } = useLumiStore.getState();

    setVoiceError('mic blocked');
    expect(useLumiStore.getState().voiceStatus).toBe('error');
    expect(useLumiStore.getState().voiceError).toBe('mic blocked');

    setVoiceError(null);
    expect(useLumiStore.getState().voiceStatus).toBe('idle');
    expect(useLumiStore.getState().voiceError).toBeNull();
  });

  it('summon clears a pending nudge so the dot stops breathing (12-S12 AC#10)', () => {
    const { setNudge, summon } = useLumiStore.getState();
    setNudge(turn('nudge'));
    expect(useLumiStore.getState().pendingNudge).not.toBeNull();

    summon();

    expect(useLumiStore.getState().pendingNudge).toBeNull();
  });

  it('summon sets presenceState to "summoned"; recede returns it to "atRest" (Epic 13-s2)', () => {
    const { summon, recede } = useLumiStore.getState();

    summon();
    expect(useLumiStore.getState().presenceState).toBe('summoned');

    recede();
    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('summon preserves prior panelMode when invoked without an argument', () => {
    const { summon, recede } = useLumiStore.getState();
    summon('voice');
    recede();

    summon();

    const s = useLumiStore.getState();
    expect(s.presenceState).toBe('summoned');
    expect(s.panelMode).toBe('voice');
  });

  it('summon("voice") sets voice mode', () => {
    useLumiStore.getState().summon('voice');

    const s = useLumiStore.getState();
    expect(s.presenceState).toBe('summoned');
    expect(s.panelMode).toBe('voice');
  });

  it('reset() restores presenceState to "atRest" regardless of prior state (AC1)', () => {
    useLumiStore.getState().summon('voice');
    expect(useLumiStore.getState().presenceState).toBe('summoned');

    useLumiStore.getState().reset();

    expect(useLumiStore.getState().presenceState).toBe('atRest');
    expect(useLumiStore.getState().panelMode).toBe('text');
  });

  it('whisper() sets presenceState to "whisper" (13-s3 AC1)', () => {
    useLumiStore.getState().whisper();

    expect(useLumiStore.getState().presenceState).toBe('whisper');
  });

  it('recede() from "whisper" returns to "atRest" (13-s3 AC1)', () => {
    useLumiStore.getState().whisper();
    useLumiStore.getState().recede();

    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('summon() from "whisper" transitions to "summoned" and clears pendingNudge (13-s3 AC1)', () => {
    const { setNudge, whisper, summon } = useLumiStore.getState();
    setNudge(turn('n1'));
    whisper();
    expect(useLumiStore.getState().presenceState).toBe('whisper');

    summon();

    expect(useLumiStore.getState().presenceState).toBe('summoned');
    expect(useLumiStore.getState().pendingNudge).toBeNull();
  });

  it('reset() from "whisper" returns to "atRest" (13-s3 AC1)', () => {
    useLumiStore.getState().whisper();
    useLumiStore.getState().reset();

    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('dismissNudge() atomically clears pendingNudge and recedes to atRest (13-s3 patch)', () => {
    useLumiStore.getState().setNudge(turn('n1'));
    useLumiStore.getState().whisper();

    useLumiStore.getState().dismissNudge();

    const s = useLumiStore.getState();
    expect(s.pendingNudge).toBeNull();
    expect(s.presenceState).toBe('atRest');
  });
});

// Story 14-s6 — the atRest→whisper trigger gate, lifted out of the SSE
// dispatcher (sse.ts handleNudge) into the presence slice so the conditions are
// testable without an EventSource.
describe('useLumiStore — tryWhisper() gate', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
  });

  it('whispers from atRest when nudges are opted in', () => {
    const fired = useLumiStore.getState().tryWhisper();

    expect(fired).toBe(true);
    expect(useLumiStore.getState().presenceState).toBe('whisper');
  });

  it('stays silent when the parent opted out of proactive nudges', () => {
    useLumiStore.getState().setProactiveNudges(false);

    const fired = useLumiStore.getState().tryWhisper();

    expect(fired).toBe(false);
    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('does not interrupt an open sheet — no whisper while summoned', () => {
    useLumiStore.getState().summon();

    const fired = useLumiStore.getState().tryWhisper();

    expect(fired).toBe(false);
    expect(useLumiStore.getState().presenceState).toBe('summoned');
  });

  it('does not re-whisper when a line is already showing', () => {
    useLumiStore.getState().whisper();

    const fired = useLumiStore.getState().tryWhisper();

    expect(fired).toBe(false);
    expect(useLumiStore.getState().presenceState).toBe('whisper');
  });

  it('leaves an already-set pendingNudge untouched — the gate only moves presence', () => {
    useLumiStore.getState().setNudge(turn('n1'));

    useLumiStore.getState().tryWhisper();

    expect(useLumiStore.getState().pendingNudge).not.toBeNull();
  });
});
