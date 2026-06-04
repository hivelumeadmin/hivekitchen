import { PassThrough, type Readable } from 'node:stream';
import PDFDocument from 'pdfkit';
import type {
  AllergyEventEntry,
  AllergyTransparencyLog,
} from '@hivekitchen/contracts';
import type { AuditRepository } from '../../audit/audit.repository.js';
import type { AllergyAuditRow } from '../../audit/audit.types.js';

// Slice 4-S17 — deterministic event_type → human-readable label mapping. No
// LLM, no agent: a fixed table the parent can rely on for incident review.
const LABELS: Record<AllergyAuditRow['event_type'], string> = {
  'allergy.guardrail_rejection': 'Plan blocked due to allergen conflict',
  'allergy.uncertainty': 'Ingredient safety could not be confirmed',
  'allergy.check_overridden': 'Parent overrode allergy safety check',
};

// Joins an array metadata field (conflicts / flagged_items) into a comma list.
// Returns null when the field is absent or not a non-empty array.
function joinList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const joined = value.map((v) => String(v)).join(', ');
  return joined.length > 0 ? joined : null;
}

function detailFor(row: AllergyAuditRow): string | null {
  switch (row.event_type) {
    case 'allergy.guardrail_rejection':
      return joinList(row.metadata.conflicts);
    case 'allergy.uncertainty':
      return joinList(row.metadata.flagged_items);
    case 'allergy.check_overridden': {
      const reason = row.metadata.reason;
      return reason !== null && reason !== undefined ? String(reason) : null;
    }
    default:
      return null;
  }
}

function mapRow(row: AllergyAuditRow): AllergyEventEntry {
  return {
    id: row.id,
    // Normalize to a Z-suffixed ISO string so the contract's .datetime()
    // accepts it regardless of how Postgres serializes the timestamptz offset.
    timestamp: new Date(row.created_at).toISOString(),
    event_type: row.event_type,
    label: LABELS[row.event_type],
    detail: detailFor(row),
  };
}

export class AllergyTransparencyService {
  constructor(private readonly auditRepo: AuditRepository) {}

  async exportAsJson(householdId: string): Promise<AllergyTransparencyLog> {
    const rows = await this.auditRepo.findAllergyEventsByHousehold(householdId);
    const events = rows.map(mapRow);
    return {
      household_id: householdId,
      exported_at: new Date().toISOString(),
      event_count: events.length,
      events,
    };
  }

  async exportAsPdf(householdId: string): Promise<Readable> {
    const rows = await this.auditRepo.findAllergyEventsByHousehold(householdId);
    const events = rows.map(mapRow);

    const doc = new PDFDocument({
      info: { Title: 'Allergy Transparency Log', Author: 'HiveKitchen' },
    });
    // Stream the PDF through a PassThrough — never buffer the whole document.
    const pass = new PassThrough();
    doc.pipe(pass);
    doc.on('error', (err) => pass.destroy(err));

    doc.font('Helvetica-Bold').fontSize(18).text('Allergy Transparency Log');
    doc.font('Helvetica').fontSize(10).moveDown(0.5);
    doc.text(`Generated ${new Date().toISOString()}`);
    // Last 8 chars only — enough to identify the household without printing the
    // full UUID on a downloadable document.
    doc.text(`Household …${householdId.slice(-8)}`);
    doc.text(`${events.length} events recorded`);
    doc.moveDown();

    if (events.length === 0) {
      doc
        .fontSize(12)
        .text('No allergy events have been recorded for your household.');
    } else {
      for (const entry of events) {
        doc.font('Courier').fontSize(9).text(entry.timestamp);
        doc.font('Helvetica-Bold').fontSize(12).text(entry.label);
        if (entry.detail !== null) {
          doc.font('Helvetica').fontSize(10).text(entry.detail);
        }
        doc.moveDown(0.5);
      }
    }

    doc.end();
    return pass;
  }
}
