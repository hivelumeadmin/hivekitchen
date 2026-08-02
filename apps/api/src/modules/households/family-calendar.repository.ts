import type {
  CalendarException,
  CalendarExceptionKind,
  CalendarSource,
  CalendarTerm,
} from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

const TERM_COLUMNS =
  'id, household_id, child_id, label, start_date, end_date, weekdays, source, created_at';
const EXCEPTION_COLUMNS =
  'id, household_id, child_id, on_date, kind, note, source, created_at';

export interface CreateCalendarTermParams {
  householdId: string;
  childId: string | null;
  label: string;
  startDate: string;
  endDate: string;
  weekdays: number[];
  source: CalendarSource;
}

export interface CreateCalendarExceptionParams {
  householdId: string;
  childId: string | null;
  onDate: string;
  kind: CalendarExceptionKind;
  note: string | null;
  source: CalendarSource;
}

export interface FamilyCalendarWeek {
  terms: CalendarTerm[];
  exceptions: CalendarException[];
}

// Story 15-s1 — the Family Calendar (Epic 15 / canonical-data-model-v2 §4.6).
// Terms carry the recurring rhythm, exceptions the one-off overrides; whether a
// date needs a lunch is derived by family-calendar.resolver.ts, never stored.
export class FamilyCalendarRepository extends BaseRepository {
  async createTerm(input: CreateCalendarTermParams): Promise<CalendarTerm> {
    const { data, error } = await this.client
      .from('calendar_terms')
      .insert({
        household_id: input.householdId,
        child_id: input.childId,
        label: input.label,
        start_date: input.startDate,
        end_date: input.endDate,
        weekdays: input.weekdays,
        source: input.source,
      })
      .select(TERM_COLUMNS)
      .single();
    if (error) throw error;
    return data as CalendarTerm;
  }

  async createException(
    input: CreateCalendarExceptionParams,
  ): Promise<CalendarException> {
    const { data, error } = await this.client
      .from('calendar_exceptions')
      .insert({
        household_id: input.householdId,
        child_id: input.childId,
        on_date: input.onDate,
        kind: input.kind,
        note: input.note,
        source: input.source,
      })
      .select(EXCEPTION_COLUMNS)
      .single();
    if (error) throw error;
    return data as CalendarException;
  }

  async findByHousehold(householdId: string): Promise<FamilyCalendarWeek> {
    const [termsRes, exceptionsRes] = await Promise.all([
      this.client
        .from('calendar_terms')
        .select(TERM_COLUMNS)
        .eq('household_id', householdId)
        .order('start_date', { ascending: true }),
      this.client
        .from('calendar_exceptions')
        .select(EXCEPTION_COLUMNS)
        .eq('household_id', householdId)
        .order('on_date', { ascending: true }),
    ]);
    if (termsRes.error) throw termsRes.error;
    if (exceptionsRes.error) throw exceptionsRes.error;
    return {
      terms: (termsRes.data as CalendarTerm[] | null) ?? [],
      exceptions: (exceptionsRes.data as CalendarException[] | null) ?? [],
    };
  }

  // Date-range overlap for one composition week. Mirrors the query shape used by
  // CulturalCalendarService.getUpcomingObservances: a term is relevant when its
  // range intersects [weekOf, weekEnd] at all, not when it contains the whole week.
  async findForWeek(householdId: string, weekOf: string, weekEnd: string): Promise<FamilyCalendarWeek> {
    const [termsRes, exceptionsRes] = await Promise.all([
      this.client
        .from('calendar_terms')
        .select(TERM_COLUMNS)
        .eq('household_id', householdId)
        .lte('start_date', weekEnd)
        .gte('end_date', weekOf),
      this.client
        .from('calendar_exceptions')
        .select(EXCEPTION_COLUMNS)
        .eq('household_id', householdId)
        .gte('on_date', weekOf)
        .lte('on_date', weekEnd),
    ]);
    if (termsRes.error) throw termsRes.error;
    if (exceptionsRes.error) throw exceptionsRes.error;
    return {
      terms: (termsRes.data as CalendarTerm[] | null) ?? [],
      exceptions: (exceptionsRes.data as CalendarException[] | null) ?? [],
    };
  }

  async deleteTerm(termId: string, householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('calendar_terms')
      .delete()
      .eq('id', termId)
      .eq('household_id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }

  async deleteException(exceptionId: string, householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('calendar_exceptions')
      .delete()
      .eq('id', exceptionId)
      .eq('household_id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }
}
