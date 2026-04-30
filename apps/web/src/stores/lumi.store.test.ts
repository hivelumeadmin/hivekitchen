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

  it('starts with sensible defaults — surface "general", panel closed, no talk session', () => {
    const s = useLumiStore.getState();

    expect(s.surface).toBe('general');
    expect(s.contextSignal).toBeNull();
    expect(s.threadIds).toEqual({});
    expect(s.turns).toEqual([]);
    expect(s.isPanelOpen).toBe(false);
    expect(s.panelMode).toBe('text');
    expect(s.talkSessionId).toBeNull();
    expect(s.voiceStatus).toBe('idle');
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

  it('endTalkSession clears voice fields but leaves panel open state alone', () => {
    const { setTalkSession, setVoiceStatus, openPanel, endTalkSession } =
      useLumiStore.getState();
    setTalkSession('44444444-4444-4444-8444-444444444444');
    setVoiceStatus('active');
    openPanel('voice');

    endTalkSession();

    const s = useLumiStore.getState();
    expect(s.talkSessionId).toBeNull();
    expect(s.voiceStatus).toBe('idle');
    expect(s.isSpeaking).toBe(false);
    expect(s.voiceError).toBeNull();
    expect(s.isPanelOpen).toBe(true);
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

  it('openPanel preserves prior panelMode when invoked without an argument', () => {
    const { openPanel, closePanel } = useLumiStore.getState();
    openPanel('voice');
    closePanel();

    openPanel();

    const s = useLumiStore.getState();
    expect(s.isPanelOpen).toBe(true);
    expect(s.panelMode).toBe('voice');
  });
});
