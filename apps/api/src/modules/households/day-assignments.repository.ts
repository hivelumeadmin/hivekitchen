import { BaseRepository } from '../../repository/base.repository.js';

export interface DayAssignmentRow {
  household_id: string;
  date: string;
  packer_user_id: string | null;
  assigned_by: string;
  assigned_at: string;
}

// Slice 5-S3 — day_assignments persistence. Composite PK (household_id, date)
// is the UPSERT conflict target, so re-assigning a day overwrites in place.
export class DayAssignmentsRepository extends BaseRepository {
  async upsert(
    householdId: string,
    date: string,
    packerUserId: string | null,
    assignedBy: string,
  ): Promise<DayAssignmentRow> {
    const { data, error } = await this.client
      .from('day_assignments')
      .upsert(
        { household_id: householdId, date, packer_user_id: packerUserId, assigned_by: assignedBy, assigned_at: new Date().toISOString() },
        { onConflict: 'household_id,date' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as DayAssignmentRow;
  }

  async findByHousehold(householdId: string): Promise<DayAssignmentRow[]> {
    const { data, error } = await this.client
      .from('day_assignments')
      .select('*')
      .eq('household_id', householdId)
      .order('date', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DayAssignmentRow[];
  }
}
