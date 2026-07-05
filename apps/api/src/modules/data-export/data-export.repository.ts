import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';

// Story 7-S10 — assembles the full household snapshot for the data-portability
// export. Each method is a thin Supabase read. Envelope-encrypted fields
// (children allergens, heart-note content) are decrypted by reusing the
// existing ChildrenRepository + HeartNoteRepository — NEVER re-implemented here.
export class DataExportRepository {
  private readonly children: ChildrenRepository;
  private readonly heartNotes: HeartNoteRepository;

  constructor(
    private readonly client: SupabaseClient,
    kek: Buffer | null,
  ) {
    // ChildrenRepository needs the allergens adapter (per-child allergens live in
    // household_allergens post-3-DM-B2). The kek Buffer drives envelope decryption.
    const childAllergens = new ChildAllergensRepository(client, kek);
    this.children = new ChildrenRepository(client, kek, childAllergens);
    this.heartNotes = new HeartNoteRepository(client, kek);
  }

  async getHousehold(householdId: string) {
    const { data, error } = await this.client
      .from('households')
      .select('*')
      .eq('id', householdId)
      .single();
    if (error) throw error;
    return data;
  }

  async getChildren(householdId: string) {
    // ChildrenRepository.findByHouseholdId handles envelope decryption of
    // sensitive fields and overlays per-child allergens.
    return this.children.findByHouseholdId(householdId);
  }

  async getMemoryNodes(householdId: string) {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async getRecentPlans(householdId: string) {
    // Last 12 weeks (84 days). ISO date string cutoff.
    const cutoff = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await this.client
      .from('plans')
      .select('*')
      .eq('household_id', householdId)
      .gte('week_of', cutoff)
      .order('week_of', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getHeartNotes(householdId: string) {
    // HeartNoteRepository.findAllForHousehold handles envelope decryption of
    // `content` and returns the full set (no 50-row UI cap).
    return this.heartNotes.findAllForHousehold(householdId);
  }

  async getLunchLinkSessions(householdId: string) {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getVpcConsents(householdId: string) {
    const { data, error } = await this.client
      .from('vpc_consents')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getConsentAuditSubset(householdId: string) {
    const CONSENT_TYPES = [
      'vpc.consented',
      'parental_notice.acknowledged',
      'account.created',
      'account.updated',
      'account.deleted',
    ] as const;
    const { data, error } = await this.client
      .from('audit_log')
      .select('*')
      .eq('household_id', householdId)
      .in('event_type', CONSENT_TYPES)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
}
