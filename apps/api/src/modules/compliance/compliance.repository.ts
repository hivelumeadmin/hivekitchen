import { ConflictError, NotFoundError } from '../../common/errors.js';
import { BaseRepository } from '../../repository/base.repository.js';
import { isUniqueViolation } from '../threads/thread.repository.js';

export interface VpcConsentRow {
  id: string;
  household_id: string;
  mechanism: string;
  signed_at: string;
  signed_by_user_id: string;
  document_version: string;
  created_at: string;
}

export interface UserAcknowledgmentState {
  acknowledged_at: string | null;
  acknowledged_version: string | null;
}

const CONSENT_COLUMNS =
  'id, household_id, mechanism, signed_at, signed_by_user_id, document_version, created_at';

const ACK_COLUMNS =
  'parental_notice_acknowledged_at, parental_notice_acknowledged_version';

export class ComplianceRepository extends BaseRepository {
  async findConsent(
    householdId: string,
    mechanism: string,
    documentVersion: string,
  ): Promise<VpcConsentRow | null> {
    const { data, error } = await this.client
      .from('vpc_consents')
      .select(CONSENT_COLUMNS)
      .eq('household_id', householdId)
      .eq('mechanism', mechanism)
      .eq('document_version', documentVersion)
      .maybeSingle();
    if (error) throw error;
    return (data as VpcConsentRow | null) ?? null;
  }

  async insertConsent(input: {
    household_id: string;
    mechanism: string;
    signed_by_user_id: string;
    document_version: string;
  }): Promise<VpcConsentRow> {
    try {
      const { data, error } = await this.client
        .from('vpc_consents')
        .insert(input)
        .select(CONSENT_COLUMNS)
        .single();
      if (error) throw error;
      return data as VpcConsentRow;
    } catch (err) {
      // Concurrency backstop — application-layer guard runs findConsent first,
      // but a race between two simultaneous POSTs can still hit the UNIQUE
      // (household_id, mechanism, document_version) constraint. Map the raw
      // 23505 to a clean 409 ConflictError.
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          'consent already recorded for this household and document version',
        );
      }
      throw err;
    }
  }

  async findUserAcknowledgmentState(
    userId: string,
  ): Promise<UserAcknowledgmentState | null> {
    const { data, error } = await this.client
      .from('users')
      .select(ACK_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    const row = data as {
      parental_notice_acknowledged_at: string | null;
      parental_notice_acknowledged_version: string | null;
    };
    return {
      acknowledged_at: row.parental_notice_acknowledged_at,
      acknowledged_version: row.parental_notice_acknowledged_version,
    };
  }

  async markParentalNoticeAcknowledged(
    userId: string,
    documentVersion: string,
  ): Promise<{ acknowledged_at: string; document_version: string; isNewAcknowledgment: boolean }> {
    // Uses a stored function (ack_parental_notice) to:
    // (a) stamp acknowledged_at with DB-server NOW() — not the API-server clock;
    // (b) apply a conditional UPDATE (WHERE IS DISTINCT FROM) so concurrent
    //     double-clicks result in exactly one audit event, not two.
    const { data, error } = await this.client.rpc('ack_parental_notice', {
      p_user_id: userId,
      p_document_version: documentVersion,
    });
    if (error) throw error;
    const rows = data as Array<{
      parental_notice_acknowledged_at: string;
      parental_notice_acknowledged_version: string;
      is_new_acknowledgment: boolean;
    }> | null;
    if (!rows || rows.length === 0) {
      throw new NotFoundError('User record not found for parental notice acknowledgment');
    }
    const row = rows[0];
    return {
      acknowledged_at: row.parental_notice_acknowledged_at,
      document_version: row.parental_notice_acknowledged_version,
      isNewAcknowledgment: row.is_new_acknowledgment,
    };
  }
}
