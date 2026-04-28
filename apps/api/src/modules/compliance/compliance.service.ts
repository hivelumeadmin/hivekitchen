import type { FastifyBaseLogger } from 'fastify';
import { ConflictError, ParentalNoticeRequiredError } from '../../common/errors.js';
import type { ComplianceRepository } from './compliance.repository.js';
import { CONSENT_DECLARATION_V1 } from './consent-declarations/v1.js';
import {
  PARENTAL_NOTICE_V1_CONTENT,
  PARENTAL_NOTICE_V1_DATA_CATEGORIES,
  PARENTAL_NOTICE_V1_PROCESSORS,
  PARENTAL_NOTICE_V1_RETENTION,
  type ProcessorEntry,
  type RetentionEntry,
} from './parental-notices/v1.js';

const MECHANISM = 'soft_signed_declaration' as const;
const CURRENT_DECLARATION_VERSION = 'v1' as const;
const CURRENT_PARENTAL_NOTICE_VERSION = 'v1' as const;

const DECLARATIONS: Readonly<Record<typeof CURRENT_DECLARATION_VERSION, string>> = {
  v1: CONSENT_DECLARATION_V1,
};

interface ParentalNoticeBundle {
  readonly content: string;
  readonly processors: readonly ProcessorEntry[];
  readonly data_categories: readonly string[];
  readonly retention: readonly RetentionEntry[];
}

const PARENTAL_NOTICES: Readonly<
  Record<typeof CURRENT_PARENTAL_NOTICE_VERSION, ParentalNoticeBundle>
> = {
  v1: {
    content: PARENTAL_NOTICE_V1_CONTENT,
    processors: PARENTAL_NOTICE_V1_PROCESSORS,
    data_categories: PARENTAL_NOTICE_V1_DATA_CATEGORIES,
    retention: PARENTAL_NOTICE_V1_RETENTION,
  },
};

export interface SubmitVpcConsentInput {
  userId: string;
  householdId: string;
  documentVersion: string;
  requestId: string;
}

export interface SubmitVpcConsentResult {
  household_id: string;
  signed_at: string;
  mechanism: typeof MECHANISM;
  document_version: string;
}

export interface AcknowledgeParentalNoticeInput {
  userId: string;
  documentVersion: string;
  requestId: string;
  log: FastifyBaseLogger;
}

export interface AcknowledgeParentalNoticeResult {
  result: {
    acknowledged_at: string;
    document_version: string;
  };
  // True only when this call actually wrote the row. Idempotent re-acknowledge
  // returns false; the route MUST NOT set request.auditContext when false to
  // avoid double-firing the audit event on every page reload.
  isNewAcknowledgment: boolean;
}

export interface ParentalNoticeView {
  document_version: string;
  content: string;
  processors: readonly ProcessorEntry[];
  data_categories: readonly string[];
  retention: readonly RetentionEntry[];
}

export class ComplianceService {
  private readonly declarationContent: string;
  private readonly parentalNotice: ParentalNoticeView;

  constructor(
    private readonly repository: ComplianceRepository,
    private readonly logger: FastifyBaseLogger,
  ) {
    const declaration = DECLARATIONS[CURRENT_DECLARATION_VERSION];
    if (declaration.trim().length === 0) {
      throw new Error(
        `consent declaration ${CURRENT_DECLARATION_VERSION} is empty`,
      );
    }
    this.declarationContent = declaration;

    const notice = PARENTAL_NOTICES[CURRENT_PARENTAL_NOTICE_VERSION];
    if (notice.content.trim().length === 0) {
      throw new Error(
        `parental notice ${CURRENT_PARENTAL_NOTICE_VERSION} is empty`,
      );
    }
    // Must match the six named enum values in ProcessorEntrySchema (packages/contracts/src/compliance.ts).
    const KNOWN_PROCESSOR_COUNT = PARENTAL_NOTICE_V1_PROCESSORS.length;
    if (notice.processors.length !== KNOWN_PROCESSOR_COUNT) {
      throw new Error(
        `parental notice ${CURRENT_PARENTAL_NOTICE_VERSION} must list exactly ${KNOWN_PROCESSOR_COUNT} processors`,
      );
    }
    this.parentalNotice = {
      document_version: CURRENT_PARENTAL_NOTICE_VERSION,
      content: notice.content,
      processors: notice.processors,
      data_categories: notice.data_categories,
      retention: notice.retention,
    };
  }

  getConsentDeclaration(): { document_version: string; content: string } {
    return {
      document_version: CURRENT_DECLARATION_VERSION,
      content: this.declarationContent,
    };
  }

  async submitVpcConsent(input: SubmitVpcConsentInput): Promise<SubmitVpcConsentResult> {
    const existing = await this.repository.findConsent(
      input.householdId,
      MECHANISM,
      input.documentVersion,
    );
    if (existing !== null) {
      throw new ConflictError(
        'consent already recorded for this household and document version',
      );
    }

    const row = await this.repository.insertConsent({
      household_id: input.householdId,
      mechanism: MECHANISM,
      signed_by_user_id: input.userId,
      document_version: input.documentVersion,
    });

    this.logger.info(
      {
        module: 'compliance',
        action: 'vpc.consented',
        request_id: input.requestId,
        household_id: input.householdId,
        user_id: input.userId,
        document_version: row.document_version,
      },
      'VPC consent recorded',
    );

    return {
      household_id: row.household_id,
      signed_at: row.signed_at,
      mechanism: MECHANISM,
      document_version: row.document_version,
    };
  }

  getParentalNotice(): ParentalNoticeView {
    return this.parentalNotice;
  }

  async acknowledgeParentalNotice(
    input: AcknowledgeParentalNoticeInput,
  ): Promise<AcknowledgeParentalNoticeResult> {
    // Atomic conditional write via stored function: stamps acknowledged_at with
    // DB-server NOW() and returns isNewAcknowledgment = false if the same version
    // was already acknowledged (prevents duplicate audit events on concurrent
    // double-clicks without application-level locking).
    const { acknowledged_at, document_version, isNewAcknowledgment } =
      await this.repository.markParentalNoticeAcknowledged(input.userId, input.documentVersion);

    input.log.info(
      {
        module: 'compliance',
        action: isNewAcknowledgment
          ? 'parental_notice.acknowledged'
          : 'parental_notice.acknowledged_no_op',
        request_id: input.requestId,
        user_id: input.userId,
        document_version,
      },
      isNewAcknowledgment
        ? 'Parental notice acknowledged'
        : 'Parental notice already acknowledged for this version',
    );

    return {
      result: { acknowledged_at, document_version },
      isNewAcknowledgment,
    };
  }

  async assertParentalNoticeAcknowledged(userId: string): Promise<void> {
    const state = await this.repository.findUserAcknowledgmentState(userId);
    if (state === null || state.acknowledged_at === null) {
      throw new ParentalNoticeRequiredError();
    }
  }
}
