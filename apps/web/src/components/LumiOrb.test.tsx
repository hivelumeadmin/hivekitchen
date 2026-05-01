import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useLumiStore } from '@/stores/lumi.store.js';
import type { Turn } from '@hivekitchen/types';
import { LumiOrb } from './LumiOrb.js';

const fakeTurn: Turn = {
  id: '00000000-0000-4000-8000-000000000001',
  thread_id: '00000000-0000-4000-8000-000000000000',
  server_seq: 1,
  created_at: '2026-04-30T00:00:00.000Z',
  role: 'lumi',
  body: { type: 'message', content: 'hi' },
};

describe('LumiOrb', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders an accessible button labeled "Open Lumi" when the panel is closed', () => {
    render(<LumiOrb />);

    const orb = screen.getByRole('button', { name: /open lumi/i });
    expect(orb).toBeDefined();
    expect(orb.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking the orb opens the panel via the store', () => {
    render(<LumiOrb />);

    fireEvent.click(screen.getByRole('button', { name: /open lumi/i }));

    expect(useLumiStore.getState().isPanelOpen).toBe(true);
  });

  it('relabels and closes the panel when clicked while open', () => {
    useLumiStore.getState().openPanel();
    render(<LumiOrb />);

    const orb = screen.getByRole('button', { name: /lumi is open/i });
    expect(orb.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(orb);

    expect(useLumiStore.getState().isPanelOpen).toBe(false);
  });

  it('applies the breathing animation when a pending nudge is present', () => {
    useLumiStore.getState().setNudge(fakeTurn);
    render(<LumiOrb />);

    const orb = screen.getByRole('button');
    expect(orb.className).toContain('animate-pulse');
    expect(orb.className).toContain('motion-reduce:animate-none');
  });

  it('applies the voice-pulse animation when voiceStatus is active', () => {
    useLumiStore.getState().setVoiceStatus('active');
    const { container } = render(<LumiOrb />);

    // animate-ping lives on a decorative child overlay, not the button itself,
    // so the button remains stable and clickable at animation peak.
    const orb = screen.getByRole('button');
    expect(orb.className).not.toContain('animate-ping');
    const overlay = container.querySelector('span[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.className).toContain('animate-ping');
    expect(overlay!.className).toContain('motion-reduce:animate-none');
  });

  it('voice pulse takes precedence over the nudge breathing animation', () => {
    useLumiStore.getState().setNudge(fakeTurn);
    useLumiStore.getState().setVoiceStatus('active');
    const { container } = render(<LumiOrb />);

    const orb = screen.getByRole('button');
    expect(orb.className).not.toContain('animate-pulse');
    expect(orb.className).not.toContain('animate-ping');
    const overlay = container.querySelector('span[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.className).toContain('animate-ping');
  });

  it('suppresses the breathing animation when the panel is open (AC4)', () => {
    useLumiStore.getState().setNudge(fakeTurn);
    useLumiStore.getState().openPanel();
    render(<LumiOrb />);

    const orb = screen.getByRole('button');
    expect(orb.className).not.toContain('animate-pulse');
  });
});
